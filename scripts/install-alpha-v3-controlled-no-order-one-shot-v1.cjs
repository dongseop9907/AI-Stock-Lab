const fs = require("fs");
const path = require("path");

const root =
  process.cwd();

const target =
  path.resolve(
    root,
    "scripts/alpha-v3-controlled-no-order-operational-one-shot.cjs"
  );

fs.mkdirSync(
  path.dirname(
    target
  ),
  {
    recursive: true
  }
);

fs.writeFileSync(
  target,
  "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root =\n  process.cwd();\n\nfunction parseEnvFile(file) {\n  const env = {};\n\n  if (!fs.existsSync(file)) {\n    return env;\n  }\n\n  const text =\n    fs.readFileSync(\n      file,\n      \"utf8\"\n    );\n\n  for (\n    const rawLine of\n      text.split(/\\r?\\n/)\n  ) {\n    const line =\n      rawLine.trim();\n\n    if (\n      !line ||\n      line.startsWith(\"#\")\n    ) {\n      continue;\n    }\n\n    const index =\n      line.indexOf(\"=\");\n\n    if (index <= 0) {\n      continue;\n    }\n\n    const key =\n      line\n        .slice(0, index)\n        .trim();\n\n    let value =\n      line\n        .slice(index + 1)\n        .trim();\n\n    if (\n      (\n        value.startsWith('\"') &&\n        value.endsWith('\"')\n      ) ||\n      (\n        value.startsWith(\"'\") &&\n        value.endsWith(\"'\")\n      )\n    ) {\n      value =\n        value.slice(\n          1,\n          -1\n        );\n    }\n\n    env[key] =\n      value;\n  }\n\n  return env;\n}\n\nconst fileEnv =\n  parseEnvFile(\n    path.resolve(\n      root,\n      \".env.local\"\n    )\n  );\n\nconst env = {\n  ...fileEnv,\n  ...process.env\n};\n\nfunction trimBaseUrl(value) {\n  return String(\n    value ?? \"\"\n  )\n    .trim()\n    .replace(/\\/+$/, \"\");\n}\n\nasync function fetchWithTimeout(\n  url,\n  options = {},\n  timeoutMs = 15000\n) {\n  const controller =\n    new AbortController();\n\n  const timer =\n    setTimeout(\n      () =>\n        controller.abort(),\n      timeoutMs\n    );\n\n  try {\n    return await fetch(\n      url,\n      {\n        ...options,\n        signal:\n          controller.signal\n      }\n    );\n  } finally {\n    clearTimeout(timer);\n  }\n}\n\nasync function reachable(baseUrl) {\n  try {\n    const response =\n      await fetchWithTimeout(\n        baseUrl,\n        {\n          method:\n            \"GET\",\n          cache:\n            \"no-store\"\n        },\n        8000\n      );\n\n    return response.status >=\n      100;\n  } catch {\n    return false;\n  }\n}\n\nasync function detectBaseUrl() {\n  const configured =\n    trimBaseUrl(\n      env.AI_STOCK_LAB_BASE_URL\n    );\n\n  const candidates = [];\n\n  if (configured) {\n    candidates.push(\n      configured\n    );\n  }\n\n  for (\n    const port of\n      [3000,3001,3002,3003,3004,3005,3006,3007,3008,3009,3010]\n  ) {\n    const url =\n      \"http://localhost:\" +\n      String(port);\n\n    if (\n      !candidates.includes(\n        url\n      )\n    ) {\n      candidates.push(\n        url\n      );\n    }\n  }\n\n  for (\n    let attempt = 1;\n    attempt <= 3;\n    attempt += 1\n  ) {\n    for (\n      const candidate of\n        candidates\n    ) {\n      if (\n        await reachable(\n          candidate\n        )\n      ) {\n        return candidate;\n      }\n    }\n\n    if (attempt < 3) {\n      await new Promise(\n        (resolve) =>\n          setTimeout(\n            resolve,\n            750\n          )\n      );\n    }\n  }\n\n  return null;\n}\n\nasync function parseResponse(\n  response\n) {\n  const text =\n    await response.text();\n\n  try {\n    return text\n      ? JSON.parse(text)\n      : null;\n  } catch {\n    return {\n      raw:\n        text\n    };\n  }\n}\n\nfunction getSupabaseConfig() {\n  const url =\n    trimBaseUrl(\n      env.NEXT_PUBLIC_SUPABASE_URL ||\n      env.SUPABASE_URL\n    );\n\n  const serviceRoleKey =\n    String(\n      env.SUPABASE_SERVICE_ROLE_KEY ||\n      env.SUPABASE_SERVICE_KEY ||\n      \"\"\n    ).trim();\n\n  return {\n    url,\n    serviceRoleKey\n  };\n}\n\nasync function supabaseCount(\n  supabase,\n  table,\n  query = \"select=id\"\n) {\n  if (\n    !supabase.url ||\n    !supabase.serviceRoleKey\n  ) {\n    return {\n      ok: false,\n      count: null,\n      status: null,\n      error:\n        \"SUPABASE_SERVICE_ROLE_CONFIG_MISSING\"\n    };\n  }\n\n  const url =\n    supabase.url +\n    \"/rest/v1/\" +\n    table +\n    \"?\" +\n    query;\n\n  try {\n    const response =\n      await fetchWithTimeout(\n        url,\n        {\n          method:\n            \"GET\",\n\n          headers: {\n            apikey:\n              supabase.serviceRoleKey,\n\n            authorization:\n              \"Bearer \" +\n              supabase.serviceRoleKey,\n\n            prefer:\n              \"count=exact\",\n\n            range:\n              \"0-0\"\n          },\n\n          cache:\n            \"no-store\"\n        },\n        10000\n      );\n\n    const contentRange =\n      response.headers.get(\n        \"content-range\"\n      );\n\n    let count =\n      null;\n\n    if (contentRange) {\n      const match =\n        contentRange.match(\n          /\\/(\\d+|\\*)$/\n        );\n\n      if (\n        match &&\n        match[1] !== \"*\"\n      ) {\n        count =\n          Number(\n            match[1]\n          );\n      }\n    }\n\n    const payload =\n      await parseResponse(\n        response\n      );\n\n    return {\n      ok:\n        response.ok,\n      count,\n      status:\n        response.status,\n      contentRange,\n      error:\n        response.ok\n          ? null\n          : payload\n    };\n  } catch (error) {\n    return {\n      ok: false,\n      count: null,\n      status: null,\n      error:\n        error instanceof Error\n          ? error.message\n          : String(error)\n    };\n  }\n}\n\nasync function snapshot(\n  supabase\n) {\n  const [\n    riskApprovedOrders,\n    activeReservations,\n    paperPositions,\n    automationRuns\n  ] =\n    await Promise.all([\n      supabaseCount(\n        supabase,\n        \"paper_order_requests\",\n        [\n          \"select=id\",\n          \"status=eq.RISK_APPROVED\"\n        ].join(\"&\")\n      ),\n\n      supabaseCount(\n        supabase,\n        \"paper_order_requests\",\n        [\n          \"select=id\",\n          \"reserved_risk_amount=gt.0\",\n          \"reserved_risk_released_at=is.null\"\n        ].join(\"&\")\n      ),\n\n      supabaseCount(\n        supabase,\n        \"paper_positions\",\n        \"select=id\"\n      ),\n\n      supabaseCount(\n        supabase,\n        \"trading_automation_runs\",\n        \"select=id\"\n      )\n    ]);\n\n  return {\n    riskApprovedOrders,\n    activeReservations,\n    paperPositions,\n    automationRuns\n  };\n}\n\nfunction countIsZero(result) {\n  return (\n    result.ok === true &&\n    result.count === 0\n  );\n}\n\nfunction countIsKnown(result) {\n  return (\n    result.ok === true &&\n    Number.isInteger(\n      result.count\n    )\n  );\n}\n\nasync function main() {\n  const baseUrl =\n    await detectBaseUrl();\n\n  if (!baseUrl) {\n    throw new Error(\n      \"NEXT_SERVER_NOT_REACHABLE_3000_TO_3010\"\n    );\n  }\n\n  const secretConfigured =\n    Boolean(\n      String(\n        env.TRADING_AUTOMATION_SECRET ??\n        \"\"\n      ).trim()\n    );\n\n  if (!secretConfigured) {\n    throw new Error(\n      \"TRADING_AUTOMATION_SECRET_NOT_CONFIGURED\"\n    );\n  }\n\n  const supabase =\n    getSupabaseConfig();\n\n  const before =\n    await snapshot(\n      supabase\n    );\n\n  const blockers = [];\n\n  if (\n    !countIsZero(\n      before.riskApprovedOrders\n    )\n  ) {\n    blockers.push(\n      \"RISK_APPROVED_ORDER_COUNT_NOT_ZERO\"\n    );\n  }\n\n  if (\n    !countIsZero(\n      before.activeReservations\n    )\n  ) {\n    blockers.push(\n      \"ACTIVE_RESERVED_RISK_COUNT_NOT_ZERO\"\n    );\n  }\n\n  /*\n   * First operational smoke is intentionally stricter than normal operation.\n   * Existing paper positions could allow trailing-stop / stop-loss steps\n   * to mutate position state even with autoOrder=false.\n   */\n  if (\n    !countIsZero(\n      before.paperPositions\n    )\n  ) {\n    blockers.push(\n      \"PAPER_POSITION_COUNT_NOT_ZERO\"\n    );\n  }\n\n  if (\n    !countIsKnown(\n      before.automationRuns\n    )\n  ) {\n    blockers.push(\n      \"AUTOMATION_RUN_COUNT_NOT_VERIFIED\"\n    );\n  }\n\n  if (\n    blockers.length > 0\n  ) {\n    const blockedReport = {\n      status:\n        \"ALPHA_V3_CONTROLLED_NO_ORDER_ONE_SHOT_BLOCKED\",\n\n      baseUrl,\n      before,\n      blockers,\n\n      safety: {\n        operationalCycleRequests:\n          0,\n\n        databaseWritesFromCycle:\n          0,\n\n        ordersCreated:\n          0,\n\n        ordersChanged:\n          0,\n\n        positionsChanged:\n          0\n      },\n\n      nextGate:\n        \"RESOLVE_ONE_SHOT_BLOCKERS\"\n    };\n\n    console.log(\n      JSON.stringify(\n        blockedReport,\n        null,\n        2\n      )\n    );\n\n    process.exitCode =\n      2;\n\n    return;\n  }\n\n  const requestBody = {\n    triggerType:\n      \"MANUAL\",\n\n    includeMarketSync:\n      false,\n\n    autoOrder:\n      false,\n\n    maxOrders:\n      1\n  };\n\n  const startedAt =\n    new Date()\n      .toISOString();\n\n  let operationalResponse;\n\n  try {\n    const response =\n      await fetchWithTimeout(\n        baseUrl +\n        \"/api/trading/automation/manual\",\n        {\n          method:\n            \"POST\",\n\n          headers: {\n            \"content-type\":\n              \"application/json; charset=utf-8\",\n\n            origin:\n              baseUrl\n          },\n\n          body:\n            JSON.stringify(\n              requestBody\n            ),\n\n          cache:\n            \"no-store\"\n        },\n        180000\n      );\n\n    operationalResponse = {\n      status:\n        response.status,\n\n      ok:\n        response.ok,\n\n      payload:\n        await parseResponse(\n          response\n        )\n    };\n  } catch (error) {\n    operationalResponse = {\n      status:\n        null,\n\n      ok:\n        false,\n\n      payload:\n        null,\n\n      error:\n        error instanceof Error\n          ? error.message\n          : String(error)\n    };\n  }\n\n  const finishedAt =\n    new Date()\n      .toISOString();\n\n  const after =\n    await snapshot(\n      supabase\n    );\n\n  const responseStatus =\n    operationalResponse\n      ?.payload\n      ?.automationRun\n      ?.payload\n      ?.status ??\n    operationalResponse\n      ?.payload\n      ?.status ??\n    null;\n\n  const runCountDelta =\n    (\n      countIsKnown(\n        before.automationRuns\n      ) &&\n      countIsKnown(\n        after.automationRuns\n      )\n    )\n      ? after.automationRuns.count -\n        before.automationRuns.count\n      : null;\n\n  const checks = {\n    responseHttpSuccess:\n      operationalResponse.ok ===\n        true,\n\n    automationSemanticSuccess:\n      responseStatus ===\n        \"SUCCESS\",\n\n    riskApprovedOrdersRemainZero:\n      countIsZero(\n        after.riskApprovedOrders\n      ),\n\n    activeReservationsRemainZero:\n      countIsZero(\n        after.activeReservations\n      ),\n\n    paperPositionsRemainZero:\n      countIsZero(\n        after.paperPositions\n      ),\n\n    automationRunRecorded:\n      runCountDelta ===\n        1\n  };\n\n  const failed =\n    Object.entries(\n      checks\n    )\n      .filter(\n        ([, value]) =>\n          !value\n      )\n      .map(\n        ([key]) =>\n          key\n      );\n\n  const passed =\n    failed.length ===\n      0;\n\n  const report = {\n    status:\n      passed\n        ? \"ALPHA_V3_CONTROLLED_NO_ORDER_OPERATIONAL_ONE_SHOT_VERIFIED\"\n        : \"ALPHA_V3_CONTROLLED_NO_ORDER_OPERATIONAL_ONE_SHOT_REVIEW\",\n\n    baseUrl,\n    startedAt,\n    finishedAt,\n\n    requestBody,\n\n    before,\n    operationalResponse,\n    after,\n\n    checks,\n    failed,\n\n    deltas: {\n      automationRunCount:\n        runCountDelta,\n\n      riskApprovedOrders:\n        (\n          countIsKnown(\n            before.riskApprovedOrders\n          ) &&\n          countIsKnown(\n            after.riskApprovedOrders\n          )\n        )\n          ? after.riskApprovedOrders.count -\n            before.riskApprovedOrders.count\n          : null,\n\n      activeReservations:\n        (\n          countIsKnown(\n            before.activeReservations\n          ) &&\n          countIsKnown(\n            after.activeReservations\n          )\n        )\n          ? after.activeReservations.count -\n            before.activeReservations.count\n          : null,\n\n      paperPositions:\n        (\n          countIsKnown(\n            before.paperPositions\n          ) &&\n          countIsKnown(\n            after.paperPositions\n          )\n        )\n          ? after.paperPositions.count -\n            before.paperPositions.count\n          : null\n    },\n\n    safety: {\n      operationalCycleRequests:\n        1,\n\n      requestedAutoOrder:\n        false,\n\n      requestedMarketSync:\n        false,\n\n      expectedOrderCreation:\n        false,\n\n      expectedApprovedExecution:\n        false,\n\n      expectedPositionMutation:\n        false,\n\n      databaseWritesExpected:\n        \"AUTOMATION_RUN_LOGS_AND_NON_ORDER_PIPELINE_DATA_ONLY\"\n    },\n\n    nextGate:\n      passed\n        ? \"COMMITTED_RISK_OPERATIONAL_LAYER_COMPLETE_PREPARE_ORDER_STATE_MACHINE\"\n        : \"REVIEW_FIRST_OPERATIONAL_ONE_SHOT\"\n  };\n\n  const outputFile =\n    path.resolve(\n      root,\n      \"logs/alpha-v3-controlled-no-order-operational-one-shot.json\"\n    );\n\n  fs.mkdirSync(\n    path.dirname(\n      outputFile\n    ),\n    {\n      recursive: true\n    }\n  );\n\n  fs.writeFileSync(\n    outputFile,\n    JSON.stringify(\n      report,\n      null,\n      2\n    ) + \"\\n\",\n    \"utf8\"\n  );\n\n  console.log(\n    JSON.stringify(\n      report,\n      null,\n      2\n    )\n  );\n\n  if (!passed) {\n    process.exitCode =\n      2;\n  }\n}\n\nmain().catch(\n  (error) => {\n    console.error(\n      JSON.stringify(\n        {\n          status:\n            \"ALPHA_V3_CONTROLLED_NO_ORDER_OPERATIONAL_ONE_SHOT_FATAL\",\n\n          error:\n            error instanceof Error\n              ? error.message\n              : String(error),\n\n          caution:\n            \"REQUEST_MAY_OR_MAY_NOT_HAVE_REACHED_SERVER_IF_FAILURE_OCCURRED_DURING_OPERATIONAL_CALL\",\n\n          nextGate:\n            \"REVIEW_FIRST_OPERATIONAL_ONE_SHOT_FATAL\"\n        },\n        null,\n        2\n      )\n    );\n\n    process.exitCode =\n      2;\n  }\n);\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_CONTROLLED_NO_ORDER_ONE_SHOT_V1_INSTALLED",

      generatedFile:
        "scripts/alpha-v3-controlled-no-order-operational-one-shot.cjs",

      hardGuards: [
        "RISK_APPROVED_ORDERS_MUST_BE_ZERO",
        "ACTIVE_RESERVED_RISK_MUST_BE_ZERO",
        "PAPER_POSITIONS_MUST_BE_ZERO",
        "AUTOMATION_RUN_COUNT_MUST_BE_READABLE"
      ],

      operationalRequest: {
        path:
          "/api/trading/automation/manual",

        triggerType:
          "MANUAL",

        includeMarketSync:
          false,

        autoOrder:
          false,

        maxOrders:
          1
      },

      important:
        "THIS_IS_THE_FIRST_REAL_OPERATIONAL_CYCLE. IT MAY WRITE AUTOMATION RUN LOGS, SIGNALS, SHADOW/GOVERNANCE DATA, AND OTHER NON-ORDER PIPELINE DATA.",

      expectedTradingSideEffects: {
        ordersCreated:
          0,

        approvedOrdersExecuted:
          0,

        positionsChanged:
          0
      },

      nextAction:
        "RUN_CONTROLLED_NO_ORDER_OPERATIONAL_ONE_SHOT"
    },
    null,
    2
  )
);
