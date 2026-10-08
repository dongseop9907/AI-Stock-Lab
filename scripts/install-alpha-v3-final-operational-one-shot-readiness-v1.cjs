const fs = require("fs");
const path = require("path");

const root =
  process.cwd();

const target =
  path.resolve(
    root,
    "scripts/alpha-v3-final-operational-one-shot-readiness.cjs"
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
  "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root =\n  process.cwd();\n\nfunction parseEnvFile(file) {\n  const env = {};\n\n  if (!fs.existsSync(file)) {\n    return env;\n  }\n\n  const text =\n    fs.readFileSync(\n      file,\n      \"utf8\"\n    );\n\n  for (\n    const rawLine of\n      text.split(/\\r?\\n/)\n  ) {\n    const line =\n      rawLine.trim();\n\n    if (\n      !line ||\n      line.startsWith(\"#\")\n    ) {\n      continue;\n    }\n\n    const index =\n      line.indexOf(\"=\");\n\n    if (index <= 0) {\n      continue;\n    }\n\n    const key =\n      line\n        .slice(0, index)\n        .trim();\n\n    let value =\n      line\n        .slice(index + 1)\n        .trim();\n\n    if (\n      (\n        value.startsWith('\"') &&\n        value.endsWith('\"')\n      ) ||\n      (\n        value.startsWith(\"'\") &&\n        value.endsWith(\"'\")\n      )\n    ) {\n      value =\n        value.slice(\n          1,\n          -1\n        );\n    }\n\n    env[key] =\n      value;\n  }\n\n  return env;\n}\n\nconst fileEnv =\n  parseEnvFile(\n    path.resolve(\n      root,\n      \".env.local\"\n    )\n  );\n\nconst env = {\n  ...fileEnv,\n  ...process.env\n};\n\nfunction trimBaseUrl(value) {\n  return String(\n    value ?? \"\"\n  )\n    .trim()\n    .replace(/\\/+$/, \"\");\n}\n\nasync function fetchWithTimeout(\n  url,\n  options = {},\n  timeoutMs = 8000\n) {\n  const controller =\n    new AbortController();\n\n  const timer =\n    setTimeout(\n      () =>\n        controller.abort(),\n      timeoutMs\n    );\n\n  try {\n    return await fetch(\n      url,\n      {\n        ...options,\n        signal:\n          controller.signal\n      }\n    );\n  } finally {\n    clearTimeout(timer);\n  }\n}\n\nasync function reachable(baseUrl) {\n  try {\n    const response =\n      await fetchWithTimeout(\n        baseUrl,\n        {\n          method:\n            \"GET\",\n          cache:\n            \"no-store\"\n        },\n        8000\n      );\n\n    return response.status >=\n      100;\n  } catch {\n    return false;\n  }\n}\n\nasync function detectBaseUrl() {\n  const configured =\n    trimBaseUrl(\n      env.AI_STOCK_LAB_BASE_URL\n    );\n\n  const candidates = [];\n\n  if (configured) {\n    candidates.push(\n      configured\n    );\n  }\n\n  for (\n    const port of\n      [3000,3001,3002,3003,3004,3005,3006,3007,3008,3009,3010]\n  ) {\n    const url =\n      \"http://localhost:\" +\n      String(port);\n\n    if (\n      !candidates.includes(\n        url\n      )\n    ) {\n      candidates.push(\n        url\n      );\n    }\n  }\n\n  for (\n    let attempt = 1;\n    attempt <= 3;\n    attempt += 1\n  ) {\n    for (\n      const candidate of\n        candidates\n    ) {\n      if (\n        await reachable(\n          candidate\n        )\n      ) {\n        return candidate;\n      }\n    }\n\n    if (attempt < 3) {\n      await new Promise(\n        (resolve) =>\n          setTimeout(\n            resolve,\n            750\n          )\n      );\n    }\n  }\n\n  return null;\n}\n\nasync function parseResponse(\n  response\n) {\n  const text =\n    await response.text();\n\n  try {\n    return text\n      ? JSON.parse(text)\n      : null;\n  } catch {\n    return {\n      raw:\n        text\n    };\n  }\n}\n\nfunction getSupabaseConfig() {\n  const url =\n    trimBaseUrl(\n      env.NEXT_PUBLIC_SUPABASE_URL ||\n      env.SUPABASE_URL\n    );\n\n  const serviceRoleKey =\n    String(\n      env.SUPABASE_SERVICE_ROLE_KEY ||\n      env.SUPABASE_SERVICE_KEY ||\n      \"\"\n    ).trim();\n\n  return {\n    url,\n    serviceRoleKey\n  };\n}\n\nasync function supabaseCount(\n  supabase,\n  table,\n  query\n) {\n  if (\n    !supabase.url ||\n    !supabase.serviceRoleKey\n  ) {\n    return {\n      ok: false,\n      skipped: true,\n      reason:\n        \"SUPABASE_SERVICE_ROLE_CONFIG_MISSING\",\n      count: null,\n      status: null,\n      error: null\n    };\n  }\n\n  const url =\n    supabase.url +\n    \"/rest/v1/\" +\n    table +\n    \"?\" +\n    query;\n\n  try {\n    const response =\n      await fetchWithTimeout(\n        url,\n        {\n          method:\n            \"GET\",\n\n          headers: {\n            apikey:\n              supabase.serviceRoleKey,\n\n            authorization:\n              \"Bearer \" +\n              supabase.serviceRoleKey,\n\n            prefer:\n              \"count=exact\",\n\n            range:\n              \"0-0\"\n          },\n\n          cache:\n            \"no-store\"\n        },\n        8000\n      );\n\n    const contentRange =\n      response.headers.get(\n        \"content-range\"\n      );\n\n    let count =\n      null;\n\n    if (contentRange) {\n      const match =\n        contentRange.match(\n          /\\/(\\d+|\\*)$/\n        );\n\n      if (\n        match &&\n        match[1] !== \"*\"\n      ) {\n        count =\n          Number(\n            match[1]\n          );\n      }\n    }\n\n    const payload =\n      await parseResponse(\n        response\n      );\n\n    return {\n      ok:\n        response.ok,\n      skipped:\n        false,\n      status:\n        response.status,\n      count,\n      contentRange,\n      error:\n        response.ok\n          ? null\n          : payload\n    };\n  } catch (error) {\n    return {\n      ok: false,\n      skipped: false,\n      status: null,\n      count: null,\n      error:\n        error instanceof Error\n          ? error.message\n          : String(error)\n    };\n  }\n}\n\nasync function main() {\n  const baseUrl =\n    await detectBaseUrl();\n\n  const secretConfigured =\n    Boolean(\n      String(\n        env.TRADING_AUTOMATION_SECRET ??\n        \"\"\n      ).trim()\n    );\n\n  let control = {\n    ok: false,\n    status: null,\n    payload: null,\n    error: null\n  };\n\n  if (baseUrl) {\n    try {\n      const response =\n        await fetchWithTimeout(\n          baseUrl +\n          \"/api/trading/system/control\",\n          {\n            method:\n              \"GET\",\n            cache:\n              \"no-store\"\n          },\n          8000\n        );\n\n      const payload =\n        await parseResponse(\n          response\n        );\n\n      control = {\n        ok:\n          response.ok,\n        status:\n          response.status,\n        payload,\n        error:\n          response.ok\n            ? null\n            : payload\n      };\n    } catch (error) {\n      control = {\n        ok: false,\n        status: null,\n        payload: null,\n        error:\n          error instanceof Error\n            ? error.message\n            : String(error)\n      };\n    }\n  }\n\n  const supabase =\n    getSupabaseConfig();\n\n  /*\n   * Read-only count checks.\n   * select=id limits transferred fields.\n   */\n  const approvedBuyOrders =\n    await supabaseCount(\n      supabase,\n      \"paper_order_requests\",\n      [\n        \"select=id\",\n        \"side=eq.BUY\",\n        \"status=eq.RISK_APPROVED\"\n      ].join(\"&\")\n    );\n\n  const activeBuyReservations =\n    await supabaseCount(\n      supabase,\n      \"paper_order_requests\",\n      [\n        \"select=id\",\n        \"side=eq.BUY\",\n        \"reserved_risk_amount=gt.0\",\n        \"reserved_risk_released_at=is.null\"\n      ].join(\"&\")\n    );\n\n  const controlPayload =\n    control.payload &&\n    typeof control.payload ===\n      \"object\"\n      ? control.payload\n      : {};\n\n  const controlSource =\n    controlPayload.control &&\n    typeof controlPayload.control ===\n      \"object\"\n      ? controlPayload.control\n      : controlPayload;\n\n  const extractedControl = {\n    automationEnabled:\n      controlSource.automationEnabled ??\n      controlSource.automation_enabled ??\n      null,\n\n    paperOrderEnabled:\n      controlSource.paperOrderEnabled ??\n      controlSource.paper_order_enabled ??\n      null,\n\n    realOrderEnabled:\n      controlSource.realOrderEnabled ??\n      controlSource.real_order_enabled ??\n      null,\n\n    emergencyStop:\n      controlSource.emergencyStop ??\n      controlSource.emergency_stop ??\n      null,\n\n    maxOrdersPerCycle:\n      controlSource.maxOrdersPerCycle ??\n      controlSource.max_orders_per_cycle ??\n      null\n  };\n\n  const blockers = [];\n  const warnings = [];\n\n  if (!baseUrl) {\n    blockers.push(\n      \"NEXT_SERVER_NOT_REACHABLE\"\n    );\n  }\n\n  if (!secretConfigured) {\n    blockers.push(\n      \"TRADING_AUTOMATION_SECRET_NOT_CONFIGURED\"\n    );\n  }\n\n  if (!control.ok) {\n    blockers.push(\n      \"SYSTEM_CONTROL_NOT_READABLE\"\n    );\n  }\n\n  if (\n    approvedBuyOrders.ok &&\n    approvedBuyOrders.count !== 0\n  ) {\n    blockers.push(\n      \"EXISTING_RISK_APPROVED_BUY_ORDERS\"\n    );\n  }\n\n  if (\n    activeBuyReservations.ok &&\n    activeBuyReservations.count !== 0\n  ) {\n    blockers.push(\n      \"EXISTING_ACTIVE_BUY_RESERVATIONS\"\n    );\n  }\n\n  if (\n    !approvedBuyOrders.ok\n  ) {\n    blockers.push(\n      \"RISK_APPROVED_BUY_COUNT_NOT_VERIFIED\"\n    );\n  }\n\n  if (\n    !activeBuyReservations.ok\n  ) {\n    blockers.push(\n      \"ACTIVE_BUY_RESERVATION_COUNT_NOT_VERIFIED\"\n    );\n  }\n\n  if (\n    extractedControl.realOrderEnabled ===\n      true\n  ) {\n    blockers.push(\n      \"REAL_ORDER_ENABLED\"\n    );\n  }\n\n  if (\n    extractedControl.emergencyStop ===\n      true\n  ) {\n    warnings.push(\n      \"EMERGENCY_STOP_ENABLED\"\n    );\n  }\n\n  if (\n    extractedControl.automationEnabled ===\n      false\n  ) {\n    warnings.push(\n      \"AUTOMATION_DISABLED_BY_CONTROL\"\n    );\n  }\n\n  if (\n    extractedControl.paperOrderEnabled ===\n      false\n  ) {\n    warnings.push(\n      \"PAPER_ORDER_DISABLED_BY_CONTROL\"\n    );\n  }\n\n  const safeForNoOrderOneShot =\n    blockers.length ===\n      0;\n\n  const safeForAutoOrderOneShot =\n    blockers.length ===\n      0 &&\n    extractedControl.paperOrderEnabled ===\n      true &&\n    extractedControl.emergencyStop !==\n      true &&\n    extractedControl.realOrderEnabled !==\n      true;\n\n  const report = {\n    status:\n      safeForNoOrderOneShot\n        ? \"ALPHA_V3_FINAL_OPERATIONAL_ONE_SHOT_READINESS_VERIFIED\"\n        : \"ALPHA_V3_FINAL_OPERATIONAL_ONE_SHOT_READINESS_BLOCKED\",\n\n    baseUrl,\n\n    checks: {\n      nextServerReachable:\n        Boolean(baseUrl),\n\n      tradingAutomationSecretConfigured:\n        secretConfigured,\n\n      systemControlReadable:\n        control.ok,\n\n      riskApprovedBuyCountVerified:\n        approvedBuyOrders.ok,\n\n      riskApprovedBuyCount:\n        approvedBuyOrders.count,\n\n      activeBuyReservationCountVerified:\n        activeBuyReservations.ok,\n\n      activeBuyReservationCount:\n        activeBuyReservations.count,\n\n      realOrderDisabled:\n        extractedControl.realOrderEnabled !==\n          true\n    },\n\n    systemControl:\n      extractedControl,\n\n    rawControlStatus:\n      control.status,\n\n    supabaseReads: {\n      approvedBuyOrders,\n      activeBuyReservations\n    },\n\n    blockers,\n    warnings,\n\n    decision: {\n      safeForNoOrderOneShot,\n      safeForAutoOrderOneShot,\n\n      recommendedFirstOperationalMode:\n        safeForNoOrderOneShot\n          ? {\n              triggerType:\n                \"MANUAL\",\n\n              includeMarketSync:\n                false,\n\n              autoOrder:\n                false,\n\n              maxOrders:\n                1\n            }\n          : null\n    },\n\n    safety: {\n      databaseReads:\n        2,\n\n      databaseWrites:\n        0,\n\n      operationalCycleRequests:\n        0,\n\n      ordersCreated:\n        0,\n\n      ordersChanged:\n        0,\n\n      positionsChanged:\n        0\n    },\n\n    nextGate:\n      safeForNoOrderOneShot\n        ? \"RUN_CONTROLLED_NO_ORDER_OPERATIONAL_ONE_SHOT\"\n        : \"RESOLVE_READINESS_BLOCKERS\"\n  };\n\n  const outputFile =\n    path.resolve(\n      root,\n      \"logs/alpha-v3-final-operational-one-shot-readiness.json\"\n    );\n\n  fs.mkdirSync(\n    path.dirname(\n      outputFile\n    ),\n    {\n      recursive: true\n    }\n  );\n\n  fs.writeFileSync(\n    outputFile,\n    JSON.stringify(\n      report,\n      null,\n      2\n    ) + \"\\n\",\n    \"utf8\"\n  );\n\n  console.log(\n    JSON.stringify(\n      report,\n      null,\n      2\n    )\n  );\n\n  if (!safeForNoOrderOneShot) {\n    process.exitCode =\n      2;\n  }\n}\n\nmain().catch(\n  (error) => {\n    console.error(\n      JSON.stringify(\n        {\n          status:\n            \"ALPHA_V3_FINAL_OPERATIONAL_ONE_SHOT_READINESS_FATAL\",\n\n          error:\n            error instanceof Error\n              ? error.message\n              : String(error),\n\n          safety: {\n            databaseWrites:\n              0,\n            operationalCycleRequests:\n              0,\n            ordersCreated:\n              0,\n            positionsChanged:\n              0\n          },\n\n          nextGate:\n            \"REVIEW_READINESS_FATAL\"\n        },\n        null,\n        2\n      )\n    );\n\n    process.exitCode =\n      2;\n  }\n);\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_FINAL_OPERATIONAL_ONE_SHOT_READINESS_V1_INSTALLED",

      generatedFile:
        "scripts/alpha-v3-final-operational-one-shot-readiness.cjs",

      checks: [
        "NEXT_SERVER",
        "TRADING_AUTOMATION_SECRET",
        "SYSTEM_CONTROL",
        "RISK_APPROVED_BUY_COUNT",
        "ACTIVE_BUY_RESERVATIONS",
        "REAL_ORDER_DISABLED"
      ],

      firstOperationalModeIfReady: {
        triggerType:
          "MANUAL",

        includeMarketSync:
          false,

        autoOrder:
          false,

        maxOrders:
          1
      },

      safety: {
        databaseReadsOnly:
          true,

        databaseWrites:
          0,

        operationalCycleRequests:
          0,

        ordersCreated:
          0,

        positionsChanged:
          0
      },

      nextAction:
        "RUN_FINAL_OPERATIONAL_ONE_SHOT_READINESS"
    },
    null,
    2
  )
);
