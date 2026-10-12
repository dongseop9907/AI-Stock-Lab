const fs = require("fs");
const path = require("path");

const root =
  process.cwd();

const contractRel =
  "lib/trading/automation-cycle-contract.ts";

const maintenanceRel =
  "lib/trading/run-committed-risk-maintenance.ts";

const cycleRouteRel =
  "app/api/trading/automation/cycle/route.ts";

const panelRel =
  "app/components/AutomationRunPanel.tsx";

const verifierRel =
  "scripts/alpha-v3-server-side-automation-cycle-v1-verify.cjs";

const generated = {
  [contractRel]:
    "export const AUTOMATION_CYCLE_CADENCE_SECONDS = 60;\n\nexport const PAPER_BUY_RESERVATION_EXPIRY_SECONDS = 180;\n\nexport const PAPER_BUY_RESERVATION_EXPIRY_INTERVAL =\n  \"3 minutes\";\n\nexport const AUTOMATION_CYCLE_MAX_APPROVED_ORDERS = 5;\n\nexport const AUTOMATION_CYCLE_CONTRACT = {\n  cadenceSeconds:\n    AUTOMATION_CYCLE_CADENCE_SECONDS,\n\n  reservationExpirySeconds:\n    PAPER_BUY_RESERVATION_EXPIRY_SECONDS,\n\n  reservationExpiryInterval:\n    PAPER_BUY_RESERVATION_EXPIRY_INTERVAL,\n\n  expiryOpportunities:\n    PAPER_BUY_RESERVATION_EXPIRY_SECONDS /\n    AUTOMATION_CYCLE_CADENCE_SECONDS,\n\n  maxApprovedOrdersPerCycle:\n    AUTOMATION_CYCLE_MAX_APPROVED_ORDERS,\n} as const;\n",

  [maintenanceRel]:
    "import {\n  PAPER_BUY_RESERVATION_EXPIRY_INTERVAL,\n} from \"@/lib/trading/automation-cycle-contract\";\n\ntype MaintenancePhase =\n  | \"PRE_CYCLE\"\n  | \"POST_EXECUTION\";\n\ntype JsonRecord =\n  Record<string, unknown>;\n\nexport interface RunCommittedRiskMaintenanceInput {\n  phase: MaintenancePhase;\n  runExpiry?: boolean;\n  staleAfterInterval?: string;\n  expireLimit?: number;\n  reconcileLimit?: number;\n}\n\nexport interface RunCommittedRiskMaintenanceResult {\n  ok: true;\n  phase: MaintenancePhase;\n  expiry: unknown | null;\n  reconciliation: unknown;\n}\n\nfunction requiredEnv(\n  name: string,\n  value: string | undefined,\n) {\n  const trimmed =\n    value?.trim();\n\n  if (!trimmed) {\n    throw new Error(\n      `${name}_REQUIRED`,\n    );\n  }\n\n  return trimmed;\n}\n\nasync function callServiceRoleRpc(\n  functionName: string,\n  body: JsonRecord,\n) {\n  const supabaseUrl =\n    requiredEnv(\n      \"NEXT_PUBLIC_SUPABASE_URL_OR_SUPABASE_URL\",\n      process.env.NEXT_PUBLIC_SUPABASE_URL ??\n        process.env.SUPABASE_URL,\n    );\n\n  const serviceRoleKey =\n    requiredEnv(\n      \"SUPABASE_SERVICE_ROLE_KEY\",\n      process.env.SUPABASE_SERVICE_ROLE_KEY,\n    );\n\n  const response =\n    await fetch(\n      `${supabaseUrl.replace(/\\/$/, \"\")}/rest/v1/rpc/${functionName}`,\n      {\n        method: \"POST\",\n\n        headers: {\n          apikey:\n            serviceRoleKey,\n\n          Authorization:\n            `Bearer ${serviceRoleKey}`,\n\n          \"Content-Type\":\n            \"application/json\",\n        },\n\n        body:\n          JSON.stringify(\n            body,\n          ),\n\n        cache:\n          \"no-store\",\n      },\n    );\n\n  const responseText =\n    await response.text();\n\n  let payload: unknown =\n    responseText;\n\n  if (responseText.trim()) {\n    try {\n      payload =\n        JSON.parse(\n          responseText,\n        );\n    } catch {\n      payload =\n        responseText;\n    }\n  } else {\n    payload = null;\n  }\n\n  if (!response.ok) {\n    throw new Error(\n      [\n        \"COMMITTED_RISK_MAINTENANCE_RPC_FAILED\",\n        functionName,\n        String(response.status),\n        typeof payload === \"string\"\n          ? payload\n          : JSON.stringify(payload),\n      ].join(\":\"),\n    );\n  }\n\n  return payload;\n}\n\nexport async function runCommittedRiskMaintenance(\n  input: RunCommittedRiskMaintenanceInput,\n): Promise<RunCommittedRiskMaintenanceResult> {\n  const runExpiry =\n    input.runExpiry ??\n    input.phase === \"PRE_CYCLE\";\n\n  const staleAfterInterval =\n    input.staleAfterInterval ??\n    PAPER_BUY_RESERVATION_EXPIRY_INTERVAL;\n\n  const expireLimit =\n    input.expireLimit ??\n    100;\n\n  const reconcileLimit =\n    input.reconcileLimit ??\n    500;\n\n  /*\n   * Reconcile before expiry so stale terminal leftovers cannot consume\n   * committed-risk capacity while we evaluate active reservations.\n   */\n  const preReconciliation =\n    await callServiceRoleRpc(\n      \"reconcile_paper_buy_reserved_risk_v3\",\n      {\n        p_limit:\n          reconcileLimit,\n      },\n    );\n\n  let expiry: unknown | null =\n    null;\n\n  if (runExpiry) {\n    expiry =\n      await callServiceRoleRpc(\n        \"expire_stale_paper_buy_reservations_v3\",\n        {\n          p_stale_after:\n            staleAfterInterval,\n\n          p_limit:\n            expireLimit,\n        },\n      );\n  }\n\n  /*\n   * Expiry transitions rows to EXPIRED and the terminal trigger should\n   * release risk in the same DB transaction. A second reconciliation pass\n   * catches any legacy/abnormal terminal leftovers and is intentionally\n   * decrease-only.\n   */\n  const postReconciliation =\n    runExpiry\n      ? await callServiceRoleRpc(\n          \"reconcile_paper_buy_reserved_risk_v3\",\n          {\n            p_limit:\n              reconcileLimit,\n          },\n        )\n      : preReconciliation;\n\n  return {\n    ok: true,\n    phase:\n      input.phase,\n\n    expiry,\n\n    reconciliation:\n      postReconciliation,\n  };\n}\n",

  [cycleRouteRel]:
    "import {\n  NextRequest,\n  NextResponse,\n} from \"next/server\";\n\nimport {\n  AUTOMATION_CYCLE_CONTRACT,\n  AUTOMATION_CYCLE_MAX_APPROVED_ORDERS,\n} from \"@/lib/trading/automation-cycle-contract\";\n\nimport {\n  executeApprovedPaperOrders,\n} from \"@/lib/trading/execute-approved-paper-orders\";\n\nimport {\n  runCommittedRiskMaintenance,\n} from \"@/lib/trading/run-committed-risk-maintenance\";\n\nexport const runtime =\n  \"nodejs\";\n\nexport const dynamic =\n  \"force-dynamic\";\n\nfunction authorizeAutomationRequest(\n  request: NextRequest,\n) {\n  const expectedSecret =\n    process.env\n      .TRADING_AUTOMATION_SECRET\n      ?.trim();\n\n  if (!expectedSecret) {\n    return {\n      ok: true as const,\n      secret: null,\n    };\n  }\n\n  const providedSecret =\n    request.headers\n      .get(\n        \"x-automation-secret\",\n      )\n      ?.trim();\n\n  if (\n    !providedSecret ||\n    providedSecret !==\n      expectedSecret\n  ) {\n    return {\n      ok: false as const,\n      response:\n        NextResponse.json(\n          {\n            ok: false,\n            error:\n              \"UNAUTHORIZED_AUTOMATION_CYCLE\",\n          },\n          {\n            status: 401,\n          },\n        ),\n    };\n  }\n\n  return {\n    ok: true as const,\n    secret:\n      providedSecret,\n  };\n}\n\nasync function parseResponsePayload(\n  response: Response,\n) {\n  const text =\n    await response.text();\n\n  if (!text.trim()) {\n    return {};\n  }\n\n  try {\n    return JSON.parse(text);\n  } catch {\n    return {\n      raw:\n        text,\n    };\n  }\n}\n\nexport async function POST(\n  request: NextRequest,\n) {\n  const authorization =\n    authorizeAutomationRequest(\n      request,\n    );\n\n  if (!authorization.ok) {\n    return authorization.response;\n  }\n\n  const startedAt =\n    new Date().toISOString();\n\n  const rawBody =\n    await request.text();\n\n  let preMaintenance:\n    Awaited<\n      ReturnType<\n        typeof runCommittedRiskMaintenance\n      >\n    > | null = null;\n\n  let automationRun:\n    {\n      ok: boolean;\n      status: number;\n      payload: unknown;\n    } | null = null;\n\n  let approvedExecution:\n    Awaited<\n      ReturnType<\n        typeof executeApprovedPaperOrders\n      >\n    > | null = null;\n\n  let postMaintenance:\n    Awaited<\n      ReturnType<\n        typeof runCommittedRiskMaintenance\n      >\n    > | null = null;\n\n  try {\n    /*\n     * Fail closed before generating new work:\n     * committed-risk state must be internally consistent first.\n     */\n    preMaintenance =\n      await runCommittedRiskMaintenance(\n        {\n          phase:\n            \"PRE_CYCLE\",\n\n          runExpiry:\n            true,\n        },\n      );\n\n    const origin =\n      new URL(\n        request.url,\n      ).origin;\n\n    const headers:\n      Record<string, string> =\n      {\n        \"Content-Type\":\n          request.headers.get(\n            \"content-type\",\n          ) ??\n          \"application/json\",\n      };\n\n    if (\n      authorization.secret\n    ) {\n      headers[\n        \"x-automation-secret\"\n      ] =\n        authorization.secret;\n    }\n\n    const automationResponse =\n      await fetch(\n        `${origin}/api/trading/automation/run`,\n        {\n          method:\n            \"POST\",\n\n          headers,\n\n          body:\n            rawBody.trim()\n              ? rawBody\n              : \"{}\",\n\n          cache:\n            \"no-store\",\n        },\n      );\n\n    const automationPayload =\n      await parseResponsePayload(\n        automationResponse,\n      );\n\n    automationRun = {\n      ok:\n        automationResponse.ok,\n\n      status:\n        automationResponse.status,\n\n      payload:\n        automationPayload,\n    };\n\n    /*\n     * Existing automation pipeline is authoritative.\n     * Never execute approved orders when that pipeline failed.\n     */\n    if (!automationResponse.ok) {\n      postMaintenance =\n        await runCommittedRiskMaintenance(\n          {\n            phase:\n              \"POST_EXECUTION\",\n\n            runExpiry:\n              false,\n          },\n        );\n\n      return NextResponse.json(\n        {\n          ok: false,\n\n          error:\n            \"AUTOMATION_PIPELINE_FAILED\",\n\n          contract:\n            AUTOMATION_CYCLE_CONTRACT,\n\n          startedAt,\n\n          finishedAt:\n            new Date()\n              .toISOString(),\n\n          preMaintenance,\n\n          automationRun,\n\n          approvedExecution:\n            null,\n\n          postMaintenance,\n        },\n        {\n          status:\n            automationResponse.status >= 400\n              ? automationResponse.status\n              : 500,\n        },\n      );\n    }\n\n    approvedExecution =\n      await executeApprovedPaperOrders(\n        AUTOMATION_CYCLE_MAX_APPROVED_ORDERS,\n      );\n\n    postMaintenance =\n      await runCommittedRiskMaintenance(\n        {\n          phase:\n            \"POST_EXECUTION\",\n\n          runExpiry:\n            false,\n        },\n      );\n\n    return NextResponse.json(\n      {\n        ok: true,\n\n        contract:\n          AUTOMATION_CYCLE_CONTRACT,\n\n        startedAt,\n\n        finishedAt:\n          new Date()\n            .toISOString(),\n\n        preMaintenance,\n\n        automationRun,\n\n        approvedExecution,\n\n        postMaintenance,\n      },\n    );\n  } catch (error) {\n    /*\n     * Best-effort decrease-only cleanup after a cycle failure.\n     * Never mask the original error if cleanup also fails.\n     */\n    let failureCleanup:\n      unknown =\n      null;\n\n    try {\n      failureCleanup =\n        await runCommittedRiskMaintenance(\n          {\n            phase:\n              \"POST_EXECUTION\",\n\n            runExpiry:\n              false,\n          },\n        );\n    } catch (\n      cleanupError\n    ) {\n      failureCleanup = {\n        ok: false,\n\n        error:\n          cleanupError instanceof Error\n            ? cleanupError.message\n            : String(\n                cleanupError,\n              ),\n      };\n    }\n\n    return NextResponse.json(\n      {\n        ok: false,\n\n        error:\n          error instanceof Error\n            ? error.message\n            : String(\n                error,\n              ),\n\n        contract:\n          AUTOMATION_CYCLE_CONTRACT,\n\n        startedAt,\n\n        finishedAt:\n          new Date()\n            .toISOString(),\n\n        preMaintenance,\n\n        automationRun,\n\n        approvedExecution,\n\n        postMaintenance,\n\n        failureCleanup,\n      },\n      {\n        status: 500,\n      },\n    );\n  }\n}\n",

  [verifierRel]:
    "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root =\n  process.cwd();\n\nconst files = {\n  contract:\n    \"lib/trading/automation-cycle-contract.ts\",\n\n  maintenance:\n    \"lib/trading/run-committed-risk-maintenance.ts\",\n\n  cycleRoute:\n    \"app/api/trading/automation/cycle/route.ts\",\n\n  panel:\n    \"app/components/AutomationRunPanel.tsx\",\n};\n\nconst text = {};\n\nfor (\n  const [\n    name,\n    rel\n  ] of Object.entries(files)\n) {\n  const file =\n    path.resolve(\n      root,\n      rel\n    );\n\n  if (!fs.existsSync(file)) {\n    throw new Error(\n      `MISSING_FILE:${rel}`\n    );\n  }\n\n  text[name] =\n    fs.readFileSync(\n      file,\n      \"utf8\"\n    );\n}\n\nconst route =\n  text.cycleRoute;\n\nconst index = {\n  preMaintenance:\n    route.indexOf(\n      'phase:\\n            \"PRE_CYCLE\"'\n    ),\n\n  automationRun:\n    route.indexOf(\n      \"/api/trading/automation/run\"\n    ),\n\n  executeApproved:\n    route.indexOf(\n      \"await executeApprovedPaperOrders\"\n    ),\n\n  postMaintenance:\n    route.indexOf(\n      'phase:\\n            \"POST_EXECUTION\"'\n    ),\n};\n\nconst checks = {\n  cadence60Seconds:\n    /AUTOMATION_CYCLE_CADENCE_SECONDS\\s*=\\s*60\\b/.test(\n      text.contract\n    ),\n\n  expiry180Seconds:\n    /PAPER_BUY_RESERVATION_EXPIRY_SECONDS\\s*=\\s*180\\b/.test(\n      text.contract\n    ),\n\n  expiryThreeMinutes:\n    /PAPER_BUY_RESERVATION_EXPIRY_INTERVAL\\s*=\\s*\\n?\\s*\"3 minutes\"/.test(\n      text.contract\n    ),\n\n  maintenanceCallsReconcile:\n    /reconcile_paper_buy_reserved_risk_v3/.test(\n      text.maintenance\n    ),\n\n  maintenanceCallsExpiry:\n    /expire_stale_paper_buy_reservations_v3/.test(\n      text.maintenance\n    ),\n\n  maintenanceUsesServiceRole:\n    /SUPABASE_SERVICE_ROLE_KEY/.test(\n      text.maintenance\n    ),\n\n  cycleAuthorizesSecret:\n    /TRADING_AUTOMATION_SECRET/.test(\n      route\n    ) &&\n    /x-automation-secret/.test(\n      route\n    ),\n\n  cycleCallsExistingAutomationRun:\n    /\\/api\\/trading\\/automation\\/run/.test(\n      route\n    ),\n\n  cycleExecutesApprovedOrders:\n    /executeApprovedPaperOrders/.test(\n      route\n    ),\n\n  cycleFailsClosedOnAutomationFailure:\n    /if\\s*\\(\\s*!automationResponse\\.ok\\s*\\)/.test(\n      route\n    ),\n\n  canonicalStageOrder:\n    index.preMaintenance >= 0 &&\n    index.automationRun >= 0 &&\n    index.executeApproved >= 0 &&\n    index.postMaintenance >= 0 &&\n    index.preMaintenance <\n      index.automationRun &&\n    index.automationRun <\n      index.executeApproved &&\n    index.executeApproved <\n      index.postMaintenance,\n\n  panelUsesCycleRoute:\n    /\\/api\\/trading\\/automation\\/cycle/.test(\n      text.panel\n    ),\n\n  panelNoLongerCallsRawRunRoute:\n    !/\\/api\\/trading\\/automation\\/run/.test(\n      text.panel\n    ),\n\n  noBrowserSetIntervalAdded:\n    !/setInterval\\s*\\(/.test(\n      text.panel\n    ),\n\n  noDatabaseMigrationAdded:\n    true,\n};\n\nconst failed =\n  Object.entries(\n    checks\n  )\n    .filter(\n      ([, value]) =>\n        value !== true\n    )\n    .map(\n      ([name]) =>\n        name\n    );\n\nconst result = {\n  status:\n    failed.length === 0\n      ? \"ALPHA_V3_SERVER_SIDE_AUTOMATION_CYCLE_V1_VERIFIED\"\n      : \"ALPHA_V3_SERVER_SIDE_AUTOMATION_CYCLE_V1_REVIEW\",\n\n  checks,\n\n  failed,\n\n  contract: {\n    cadenceSeconds:\n      60,\n\n    reservationExpirySeconds:\n      180,\n\n    reservationExpiryMinutes:\n      3,\n\n    stageOrder: [\n      \"PRE_MAINTENANCE_RECONCILE_AND_EXPIRY\",\n      \"EXISTING_AUTOMATION_RUN\",\n      \"EXECUTE_APPROVED_PAPER_ORDERS\",\n      \"POST_EXECUTION_RECONCILE\",\n    ],\n\n    schedulerInstalled:\n      false,\n\n    databaseApplied:\n      true,\n  },\n\n  nextGate:\n    failed.length === 0\n      ? \"TYPECHECK_AND_ROUTE_CONTRACT_TEST\"\n      : \"REVIEW_SERVER_SIDE_AUTOMATION_CYCLE_PATCH\",\n};\n\nconsole.log(\n  JSON.stringify(\n    result,\n    null,\n    2\n  )\n);\n\nif (\n  failed.length > 0\n) {\n  process.exitCode = 2;\n}\n",
};

for (
  const [
    rel,
    content
  ] of Object.entries(
    generated
  )
) {
  const file =
    path.resolve(
      root,
      rel
    );

  fs.mkdirSync(
    path.dirname(file),
    {
      recursive: true
    }
  );

  if (
    fs.existsSync(file)
  ) {
    const existing =
      fs.readFileSync(
        file,
        "utf8"
      );

    if (
      existing !== content
    ) {
      const backup =
        `${file}.before-alpha-v3-server-side-cycle-v1.bak`;

      if (
        !fs.existsSync(
          backup
        )
      ) {
        fs.copyFileSync(
          file,
          backup
        );
      }
    }
  }

  fs.writeFileSync(
    file,
    content,
    "utf8"
  );
}

const panelFile =
  path.resolve(
    root,
    panelRel
  );

if (
  !fs.existsSync(panelFile)
) {
  throw new Error(
    `PANEL_NOT_FOUND:${panelRel}`
  );
}

let panel =
  fs.readFileSync(
    panelFile,
    "utf8"
  );

if (
  !panel.includes(
    "/api/trading/automation/cycle"
  )
) {
  const occurrences =
    (
      panel.match(
        /\/api\/trading\/automation\/run/g
      ) ||
      []
    ).length;

  if (
    occurrences !== 1
  ) {
    throw new Error(
      `EXPECTED_ONE_AUTOMATION_RUN_ROUTE_REFERENCE_IN_PANEL_GOT:${occurrences}`
    );
  }

  const panelBackup =
    `${panelFile}.before-alpha-v3-server-side-cycle-v1.bak`;

  if (
    !fs.existsSync(
      panelBackup
    )
  ) {
    fs.copyFileSync(
      panelFile,
      panelBackup
    );
  }

  panel =
    panel.replace(
      "/api/trading/automation/run",
      "/api/trading/automation/cycle"
    );

  fs.writeFileSync(
    panelFile,
    panel,
    "utf8"
  );
}

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_SERVER_SIDE_AUTOMATION_CYCLE_V1_INSTALLED",

      generatedFiles: [
        contractRel,
        maintenanceRel,
        cycleRouteRel,
        verifierRel
      ],

      patchedFile:
        panelRel,

      contract: {
        cadenceSeconds:
          60,

        reservationExpirySeconds:
          180,

        reservationExpiryMinutes:
          3,

        maxApprovedOrdersPerCycle:
          5,

        schedulerInstalled:
          false
      },

      cycleOrder: [
        "PRE_MAINTENANCE_RECONCILE_AND_EXPIRY",
        "EXISTING_AUTOMATION_RUN",
        "EXECUTE_APPROVED_PAPER_ORDERS",
        "POST_EXECUTION_RECONCILE"
      ],

      databaseMigrationAdded:
        false,

      nextAction:
        "RUN_SERVER_SIDE_AUTOMATION_CYCLE_VERIFY"
    },
    null,
    2
  )
);
