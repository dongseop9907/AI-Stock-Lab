const fs = require("fs");
const path = require("path");

const root =
  process.cwd();

const routeRel =
  "app/api/trading/automation/cycle/route.ts";

const routeFile =
  path.resolve(
    root,
    routeRel
  );

if (!fs.existsSync(routeFile)) {
  throw new Error(
    "AUTOMATION_CYCLE_ROUTE_NOT_FOUND"
  );
}

let text =
  fs.readFileSync(
    routeFile,
    "utf8"
  );

const backup =
  `${routeFile}.before-probe-only-v1.bak`;

if (!fs.existsSync(backup)) {
  fs.copyFileSync(
    routeFile,
    backup
  );
}

if (
  !text.includes(
    "ALPHA_V3_PROBE_ONLY_V1"
  )
) {
  const postPattern =
    /export\s+async\s+function\s+POST\s*\([^)]*\)\s*\{/m;

  const match =
    text.match(
      postPattern
    );

  if (
    !match ||
    match.index == null
  ) {
    throw new Error(
      "POST_FUNCTION_OPENING_NOT_FOUND"
    );
  }

  const insertAt =
    match.index +
    match[0].length;

  text =
    text.slice(
      0,
      insertAt
    ) +
    "\n" +
    "\n  /*\n   * ALPHA_V3_PROBE_ONLY_V1\n   *\n   * Authenticated live-route smoke mode.\n   * This branch intentionally returns before:\n   * - committed-risk maintenance\n   * - automation/run\n   * - approved-order execution\n   * - any DB read/write owned by this route\n   *\n   * request.clone() preserves the original body for the normal cycle path.\n   */\n  const __alphaV3ProbeBody =\n    await request\n      .clone()\n      .json()\n      .catch(\n        () => ({}),\n      ) as {\n        probeOnly?: unknown;\n      };\n\n  if (\n    __alphaV3ProbeBody\n      .probeOnly === true\n  ) {\n    const expectedSecret =\n      process.env\n        .TRADING_AUTOMATION_SECRET\n        ?.trim() ??\n      \"\";\n\n    const providedSecret =\n      request.headers\n        .get(\n          \"x-automation-secret\",\n        )\n        ?.trim() ??\n      \"\";\n\n    if (\n      !expectedSecret ||\n      providedSecret !==\n        expectedSecret\n    ) {\n      return NextResponse.json(\n        {\n          ok: false,\n          probeOnly: true,\n          error:\n            \"UNAUTHORIZED_AUTOMATION_CYCLE_PROBE\",\n        },\n        {\n          status: 401,\n        },\n      );\n    }\n\n    return NextResponse.json(\n      {\n        ok: true,\n        probeOnly: true,\n        status:\n          \"AUTOMATION_CYCLE_ROUTE_REACHABLE\",\n        sideEffects: {\n          committedRiskMaintenance:\n            false,\n          automationRun:\n            false,\n          approvedOrderExecution:\n            false,\n          databaseReads:\n            0,\n          databaseWrites:\n            0,\n          ordersCreated:\n            0,\n          ordersChanged:\n            0,\n          positionsChanged:\n            0,\n        },\n      },\n      {\n        status: 200,\n      },\n    );\n  }\n\n" +
    text.slice(
      insertAt
    );

  fs.writeFileSync(
    routeFile,
    text,
    "utf8"
  );
}

const scriptsDir =
  path.resolve(
    root,
    "scripts"
  );

fs.mkdirSync(
  scriptsDir,
  {
    recursive: true
  }
);

fs.writeFileSync(
  path.join(
    scriptsDir,
    "alpha-v3-cycle-probe-only-static-verify.cjs"
  ),
  "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nconst routeFile = path.resolve(\n  root,\n  \"app/api/trading/automation/cycle/route.ts\"\n);\n\nif (!fs.existsSync(routeFile)) {\n  throw new Error(\n    \"AUTOMATION_CYCLE_ROUTE_NOT_FOUND\"\n  );\n}\n\nconst text =\n  fs.readFileSync(\n    routeFile,\n    \"utf8\"\n  );\n\nconst probeMarkerIndex =\n  text.indexOf(\n    \"ALPHA_V3_PROBE_ONLY_V1\"\n  );\n\nconst maintenanceIndex =\n  text.indexOf(\n    \"runCommittedRiskMaintenance\"\n  );\n\nconst automationRunIndex =\n  text.indexOf(\n    \"/api/trading/automation/run\"\n  );\n\nconst executorIndex =\n  text.indexOf(\n    \"executeApprovedPaperOrders\"\n  );\n\nconst checks = {\n  probeMarkerPresent:\n    probeMarkerIndex >= 0,\n\n  usesRequestClone:\n    /request\\s*\\.\\s*clone\\s*\\(\\s*\\)/m.test(\n      text\n    ),\n\n  probeOnlyStrictTrue:\n    /probeOnly\\s*===\\s*true/m.test(\n      text\n    ),\n\n  requiresTradingAutomationSecret:\n    /ALPHA_V3_PROBE_ONLY_V1[\\s\\S]{0,2200}?TRADING_AUTOMATION_SECRET/m.test(\n      text\n    ),\n\n  requiresSecretHeader:\n    /ALPHA_V3_PROBE_ONLY_V1[\\s\\S]{0,2200}?x-automation-secret/m.test(\n      text\n    ),\n\n  unauthorizedProbeReturns401:\n    /UNAUTHORIZED_AUTOMATION_CYCLE_PROBE[\\s\\S]{0,250}?status:\\s*401/m.test(\n      text\n    ),\n\n  probeSuccessReturns200:\n    /AUTOMATION_CYCLE_ROUTE_REACHABLE[\\s\\S]{0,700}?status:\\s*200/m.test(\n      text\n    ),\n\n  probeDeclaresZeroOrderSideEffects:\n    /ordersCreated:\\s*0[\\s\\S]{0,200}?ordersChanged:\\s*0[\\s\\S]{0,200}?positionsChanged:\\s*0/m.test(\n      text\n    ),\n\n  probeBranchBeforeMaintenance:\n    probeMarkerIndex >= 0 &&\n    maintenanceIndex >= 0 &&\n    probeMarkerIndex <\n      maintenanceIndex,\n\n  probeBranchBeforeAutomationRun:\n    probeMarkerIndex >= 0 &&\n    automationRunIndex >= 0 &&\n    probeMarkerIndex <\n      automationRunIndex,\n\n  probeBranchBeforeApprovedExecutor:\n    probeMarkerIndex >= 0 &&\n    executorIndex >= 0 &&\n    probeMarkerIndex <\n      executorIndex,\n};\n\nconst failed =\n  Object.entries(checks)\n    .filter(\n      ([, value]) =>\n        !value\n    )\n    .map(\n      ([key]) =>\n        key\n    );\n\nconsole.log(\n  JSON.stringify(\n    {\n      status:\n        failed.length === 0\n          ? \"ALPHA_V3_CYCLE_PROBE_ONLY_STATIC_VERIFIED\"\n          : \"ALPHA_V3_CYCLE_PROBE_ONLY_STATIC_REVIEW\",\n\n      checks,\n      failed,\n\n      safety: {\n        databaseReads: 0,\n        databaseWrites: 0,\n        networkCalls: 0,\n        cyclePostRequests: 0,\n        ordersCreated: 0,\n        positionsChanged: 0,\n      },\n\n      nextGate:\n        failed.length === 0\n          ? \"RUN_PROBE_ONLY_LIVE_SMOKE\"\n          : \"REVIEW_PROBE_ONLY_PATCH\",\n    },\n    null,\n    2\n  )\n);\n\nif (failed.length > 0) {\n  process.exitCode = 2;\n}\n",
  "utf8"
);

fs.writeFileSync(
  path.join(
    scriptsDir,
    "alpha-v3-cycle-probe-only-live-smoke.cjs"
  ),
  "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nfunction parseEnvFile(file) {\n  const env = {};\n\n  if (!fs.existsSync(file)) {\n    return env;\n  }\n\n  const text =\n    fs.readFileSync(\n      file,\n      \"utf8\"\n    );\n\n  for (\n    const rawLine of\n      text.split(/\\r?\\n/)\n  ) {\n    const line =\n      rawLine.trim();\n\n    if (\n      !line ||\n      line.startsWith(\"#\")\n    ) {\n      continue;\n    }\n\n    const index =\n      line.indexOf(\"=\");\n\n    if (index <= 0) {\n      continue;\n    }\n\n    const key =\n      line\n        .slice(0, index)\n        .trim();\n\n    let value =\n      line\n        .slice(index + 1)\n        .trim();\n\n    if (\n      (\n        value.startsWith('\"') &&\n        value.endsWith('\"')\n      ) ||\n      (\n        value.startsWith(\"'\") &&\n        value.endsWith(\"'\")\n      )\n    ) {\n      value =\n        value.slice(\n          1,\n          -1\n        );\n    }\n\n    env[key] =\n      value;\n  }\n\n  return env;\n}\n\nconst fileEnv =\n  parseEnvFile(\n    path.resolve(\n      root,\n      \".env.local\"\n    )\n  );\n\nconst env = {\n  ...fileEnv,\n  ...process.env,\n};\n\nconst secret =\n  String(\n    env\n      .TRADING_AUTOMATION_SECRET ??\n    \"\"\n  ).trim();\n\nif (!secret) {\n  throw new Error(\n    \"TRADING_AUTOMATION_SECRET_NOT_CONFIGURED\"\n  );\n}\n\nasync function probeServer(\n  baseUrl\n) {\n  const controller =\n    new AbortController();\n\n  const timer =\n    setTimeout(\n      () =>\n        controller.abort(),\n      1200\n    );\n\n  try {\n    const response =\n      await fetch(\n        baseUrl,\n        {\n          method:\n            \"GET\",\n          signal:\n            controller.signal,\n        }\n      );\n\n    return (\n      response.status >= 100\n    );\n  } catch {\n    return false;\n  } finally {\n    clearTimeout(timer);\n  }\n}\n\nasync function detectBaseUrl() {\n  const configured =\n    String(\n      env\n        .AI_STOCK_LAB_BASE_URL ??\n      \"\"\n    )\n      .trim()\n      .replace(/\\/+$/, \"\");\n\n  const candidates = [];\n\n  if (configured) {\n    candidates.push(\n      configured\n    );\n  }\n\n  for (\n    const port of\n      [3000,3001,3002,3003,3004,3005,3006,3007,3008,3009,3010]\n  ) {\n    const url =\n      `http://localhost:${port}`;\n\n    if (\n      !candidates.includes(\n        url\n      )\n    ) {\n      candidates.push(\n        url\n      );\n    }\n  }\n\n  for (\n    const candidate of\n      candidates\n  ) {\n    if (\n      await probeServer(\n        candidate\n      )\n    ) {\n      return candidate;\n    }\n  }\n\n  return null;\n}\n\nasync function callProbe(\n  baseUrl,\n  withSecret\n) {\n  const headers = {\n    \"content-type\":\n      \"application/json\",\n  };\n\n  if (withSecret) {\n    headers[\n      \"x-automation-secret\"\n    ] =\n      secret;\n  }\n\n  const response =\n    await fetch(\n      `${baseUrl}/api/trading/automation/cycle`,\n      {\n        method:\n          \"POST\",\n\n        headers,\n\n        body:\n          JSON.stringify({\n            probeOnly: true,\n            triggerType:\n              \"SCHEDULED\",\n            autoOrder:\n              false,\n            includeMarketSync:\n              false,\n          }),\n\n        cache:\n          \"no-store\",\n      }\n    );\n\n  const text =\n    await response.text();\n\n  let payload =\n    null;\n\n  try {\n    payload =\n      text\n        ? JSON.parse(text)\n        : null;\n  } catch {\n    payload =\n      text;\n  }\n\n  return {\n    status:\n      response.status,\n    ok:\n      response.ok,\n    payload,\n  };\n}\n\nasync function main() {\n  const baseUrl =\n    await detectBaseUrl();\n\n  if (!baseUrl) {\n    throw new Error(\n      \"NEXT_SERVER_NOT_REACHABLE_3000_TO_3010\"\n    );\n  }\n\n  /*\n   * First prove that probe-only still enforces secret auth.\n   */\n  const unauthorized =\n    await callProbe(\n      baseUrl,\n      false\n    );\n\n  /*\n   * Then make one authenticated zero-side-effect route smoke request.\n   */\n  const authorized =\n    await callProbe(\n      baseUrl,\n      true\n    );\n\n  const unauthorizedPass =\n    unauthorized.status ===\n      401 &&\n    unauthorized.payload\n      ?.probeOnly ===\n      true;\n\n  const authorizedPass =\n    authorized.status ===\n      200 &&\n    authorized.payload\n      ?.ok ===\n      true &&\n    authorized.payload\n      ?.probeOnly ===\n      true &&\n    authorized.payload\n      ?.status ===\n      \"AUTOMATION_CYCLE_ROUTE_REACHABLE\";\n\n  const sideEffects =\n    authorized.payload\n      ?.sideEffects ??\n    {};\n\n  const zeroSideEffectsPass =\n    sideEffects\n      .committedRiskMaintenance ===\n      false &&\n    sideEffects\n      .automationRun ===\n      false &&\n    sideEffects\n      .approvedOrderExecution ===\n      false &&\n    sideEffects\n      .databaseReads ===\n      0 &&\n    sideEffects\n      .databaseWrites ===\n      0 &&\n    sideEffects\n      .ordersCreated ===\n      0 &&\n    sideEffects\n      .ordersChanged ===\n      0 &&\n    sideEffects\n      .positionsChanged ===\n      0;\n\n  const passed =\n    unauthorizedPass &&\n    authorizedPass &&\n    zeroSideEffectsPass;\n\n  const report = {\n    status:\n      passed\n        ? \"ALPHA_V3_PROBE_ONLY_LIVE_SMOKE_VERIFIED\"\n        : \"ALPHA_V3_PROBE_ONLY_LIVE_SMOKE_REVIEW\",\n\n    baseUrl,\n\n    checks: {\n      unauthorizedProbeRejected:\n        unauthorizedPass,\n\n      authenticatedProbeAccepted:\n        authorizedPass,\n\n      zeroSideEffectsDeclared:\n        zeroSideEffectsPass,\n    },\n\n    unauthorized,\n\n    authorized,\n\n    safety: {\n      actualNetworkRequests:\n        2,\n\n      actualCycleProbePostRequests:\n        2,\n\n      committedRiskMaintenanceCalls:\n        0,\n\n      automationRunCalls:\n        0,\n\n      approvedExecutorCalls:\n        0,\n\n      databaseReads:\n        0,\n\n      databaseWrites:\n        0,\n\n      ordersCreated:\n        0,\n\n      ordersChanged:\n        0,\n\n      positionsChanged:\n        0,\n    },\n\n    nextGate:\n      passed\n        ? \"FIX_UI_MANUAL_CYCLE_AUTH_THEN_PREPARE_CONTROLLED_OPERATIONAL_ONE_SHOT\"\n        : \"REVIEW_PROBE_ONLY_LIVE_SMOKE\",\n  };\n\n  const outputFile =\n    path.resolve(\n      root,\n      \"logs/alpha-v3-probe-only-live-smoke.json\"\n    );\n\n  fs.mkdirSync(\n    path.dirname(\n      outputFile\n    ),\n    {\n      recursive: true,\n    }\n  );\n\n  fs.writeFileSync(\n    outputFile,\n    JSON.stringify(\n      report,\n      null,\n      2\n    ) + \"\\n\",\n    \"utf8\"\n  );\n\n  console.log(\n    JSON.stringify(\n      report,\n      null,\n      2\n    )\n  );\n\n  if (!passed) {\n    process.exitCode =\n      2;\n  }\n}\n\nmain().catch(\n  (error) => {\n    console.error(\n      JSON.stringify(\n        {\n          status:\n            \"ALPHA_V3_PROBE_ONLY_LIVE_SMOKE_FATAL\",\n\n          error:\n            error instanceof Error\n              ? error.message\n              : String(error),\n\n          safety: {\n            databaseWrites:\n              0,\n            ordersCreated:\n              0,\n            positionsChanged:\n              0,\n          },\n\n          nextGate:\n            \"REVIEW_PROBE_ONLY_LIVE_SMOKE_FATAL\",\n        },\n        null,\n        2\n      )\n    );\n\n    process.exitCode =\n      2;\n  }\n);\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_CYCLE_PROBE_ONLY_SMOKE_V1_INSTALLED",

      patchedFile:
        routeRel,

      generatedFiles: [
        "scripts/alpha-v3-cycle-probe-only-static-verify.cjs",
        "scripts/alpha-v3-cycle-probe-only-live-smoke.cjs"
      ],

      behavior: {
        probeOnly:
          true,

        strictSecretRequired:
          true,

        requestBodyPreservedWithClone:
          true,

        committedRiskMaintenance:
          false,

        automationRun:
          false,

        approvedOrderExecution:
          false,

        databaseReads:
          0,

        databaseWrites:
          0
      },

      normalCycleBehaviorChanged:
        false,

      nextAction:
        "STATIC_VERIFY_THEN_LIVE_PROBE_ONLY_SMOKE"
    },
    null,
    2
  )
);
