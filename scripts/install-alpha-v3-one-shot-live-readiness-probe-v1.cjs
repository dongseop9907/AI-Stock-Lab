const fs = require("fs");
const path = require("path");

const target =
  path.resolve(
    process.cwd(),
    "scripts/alpha-v3-one-shot-live-readiness-probe.cjs"
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
  "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nconst outputFile = path.resolve(\n  root,\n  \"logs/alpha-v3-one-shot-live-readiness-probe.json\"\n);\n\nfunction parseEnvFile(file) {\n  const env = {};\n\n  if (!fs.existsSync(file)) {\n    return env;\n  }\n\n  const text = fs.readFileSync(\n    file,\n    \"utf8\"\n  );\n\n  for (const rawLine of text.split(/\\r?\\n/)) {\n    const line = rawLine.trim();\n\n    if (\n      !line ||\n      line.startsWith(\"#\")\n    ) {\n      continue;\n    }\n\n    const idx =\n      line.indexOf(\"=\");\n\n    if (idx <= 0) {\n      continue;\n    }\n\n    const key =\n      line\n        .slice(0, idx)\n        .trim();\n\n    let value =\n      line\n        .slice(idx + 1)\n        .trim();\n\n    if (\n      (value.startsWith('\"') && value.endsWith('\"')) ||\n      (value.startsWith(\"'\") && value.endsWith(\"'\"))\n    ) {\n      value =\n        value.slice(1, -1);\n    }\n\n    env[key] =\n      value;\n  }\n\n  return env;\n}\n\nconst envFile =\n  path.resolve(\n    root,\n    \".env.local\"\n  );\n\nconst fileEnv =\n  parseEnvFile(\n    envFile\n  );\n\nconst env = {\n  ...fileEnv,\n  ...process.env,\n};\n\nfunction nonEmpty(name) {\n  return Boolean(\n    String(\n      env[name] ?? \"\"\n    ).trim()\n  );\n}\n\nasync function probeUrl(url) {\n  const controller =\n    new AbortController();\n\n  const timeout =\n    setTimeout(\n      () =>\n        controller.abort(),\n      1500\n    );\n\n  try {\n    const response =\n      await fetch(\n        url,\n        {\n          method: \"GET\",\n          signal:\n            controller.signal,\n          redirect:\n            \"manual\",\n        }\n      );\n\n    return {\n      reachable: true,\n      status:\n        response.status,\n    };\n  } catch (error) {\n    return {\n      reachable: false,\n      status: null,\n      error:\n        error instanceof Error\n          ? error.message\n          : String(error),\n    };\n  } finally {\n    clearTimeout(\n      timeout\n    );\n  }\n}\n\nasync function detectBaseUrl() {\n  const configured =\n    String(\n      env.AI_STOCK_LAB_BASE_URL ??\n      \"\"\n    )\n      .trim()\n      .replace(/\\/+$/, \"\");\n\n  const candidates = [];\n\n  if (configured) {\n    candidates.push(\n      configured\n    );\n  }\n\n  for (\n    const port of\n      [3000,3001,3002,3003,3004,3005,3006,3007,3008,3009,3010]\n  ) {\n    const url =\n      `http://localhost:${port}`;\n\n    if (\n      !candidates.includes(\n        url\n      )\n    ) {\n      candidates.push(\n        url\n      );\n    }\n  }\n\n  const attempts = [];\n\n  for (const candidate of candidates) {\n    const result =\n      await probeUrl(\n        candidate\n      );\n\n    attempts.push({\n      url:\n        candidate,\n      ...result,\n    });\n\n    if (\n      result.reachable\n    ) {\n      return {\n        baseUrl:\n          candidate,\n        attempts,\n      };\n    }\n  }\n\n  return {\n    baseUrl:\n      null,\n    attempts,\n  };\n}\n\nasync function readApprovedOrders() {\n  const supabaseUrl =\n    String(\n      env.NEXT_PUBLIC_SUPABASE_URL ??\n      env.SUPABASE_URL ??\n      \"\"\n    )\n      .trim()\n      .replace(/\\/+$/, \"\");\n\n  const serviceRoleKey =\n    String(\n      env.SUPABASE_SERVICE_ROLE_KEY ??\n      \"\"\n    ).trim();\n\n  if (\n    !supabaseUrl ||\n    !serviceRoleKey\n  ) {\n    return {\n      available:\n        false,\n\n      reason:\n        \"SUPABASE_URL_OR_SERVICE_ROLE_KEY_MISSING\",\n\n      count:\n        null,\n\n      sample:\n        [],\n    };\n  }\n\n  const params =\n    new URLSearchParams({\n      select:\n        \"id,status,side,account_id,stock_code,requested_quantity,entry_price,stop_price,reserved_risk_amount,reserved_risk_at,created_at\",\n\n      status:\n        \"eq.RISK_APPROVED\",\n\n      side:\n        \"eq.BUY\",\n\n      order:\n        \"created_at.asc\",\n\n      limit:\n        \"20\",\n    });\n\n  const response =\n    await fetch(\n      `${supabaseUrl}/rest/v1/paper_order_requests?${params.toString()}`,\n      {\n        method:\n          \"GET\",\n\n        headers: {\n          apikey:\n            serviceRoleKey,\n\n          Authorization:\n            `Bearer ${serviceRoleKey}`,\n        },\n\n        cache:\n          \"no-store\",\n      }\n    );\n\n  const text =\n    await response.text();\n\n  let payload;\n\n  try {\n    payload =\n      text\n        ? JSON.parse(text)\n        : [];\n  } catch {\n    payload =\n      text;\n  }\n\n  if (!response.ok) {\n    return {\n      available:\n        false,\n\n      reason:\n        `SUPABASE_READ_FAILED:${response.status}`,\n\n      count:\n        null,\n\n      sample:\n        [],\n\n      detail:\n        typeof payload === \"string\"\n          ? payload.slice(0, 500)\n          : payload,\n    };\n  }\n\n  const rows =\n    Array.isArray(payload)\n      ? payload\n      : [];\n\n  return {\n    available:\n      true,\n\n    reason:\n      null,\n\n    count:\n      rows.length,\n\n    sample:\n      rows.map(\n        (row) => ({\n          id:\n            row.id,\n\n          stockCode:\n            row.stock_code,\n\n          requestedQuantity:\n            row.requested_quantity,\n\n          entryPrice:\n            row.entry_price,\n\n          stopPrice:\n            row.stop_price,\n\n          reservedRiskAmount:\n            row.reserved_risk_amount,\n\n          reservedRiskAt:\n            row.reserved_risk_at,\n\n          createdAt:\n            row.created_at,\n        })\n      ),\n  };\n}\n\nasync function main() {\n  const server =\n    await detectBaseUrl();\n\n  const approvedOrders =\n    await readApprovedOrders();\n\n  const routeFile =\n    path.resolve(\n      root,\n      \"app/api/trading/automation/cycle/route.ts\"\n    );\n\n  const schedulerFile =\n    path.resolve(\n      root,\n      \"scripts/alpha-v3-automation-cycle-scheduler.ts\"\n    );\n\n  const secretConfigured =\n    nonEmpty(\n      \"TRADING_AUTOMATION_SECRET\"\n    );\n\n  const cycleRouteExists =\n    fs.existsSync(\n      routeFile\n    );\n\n  const schedulerExists =\n    fs.existsSync(\n      schedulerFile\n    );\n\n  const safeForOneShot =\n    Boolean(\n      server.baseUrl &&\n      secretConfigured &&\n      cycleRouteExists &&\n      schedulerExists &&\n      approvedOrders.available &&\n      approvedOrders.count === 0\n    );\n\n  const requiresExplicitOrderExecutionAwareness =\n    Boolean(\n      approvedOrders.available &&\n      Number(\n        approvedOrders.count\n      ) > 0\n    );\n\n  const report = {\n    status:\n      \"ALPHA_V3_ONE_SHOT_LIVE_READINESS_PROBE_COMPLETE\",\n\n    server,\n\n    configuration: {\n      envLocalExists:\n        fs.existsSync(\n          envFile\n        ),\n\n      tradingAutomationSecretConfigured:\n        secretConfigured,\n\n      aiStockLabBaseUrlConfigured:\n        nonEmpty(\n          \"AI_STOCK_LAB_BASE_URL\"\n        ),\n\n      detectedBaseUrl:\n        server.baseUrl,\n\n      cycleRouteExists,\n\n      schedulerExists,\n    },\n\n    approvedPaperBuyOrders:\n      approvedOrders,\n\n    decision: {\n      safeForOneShotWithoutExistingApprovedOrderExecution:\n        safeForOneShot,\n\n      requiresExplicitOrderExecutionAwareness,\n\n      nextGate:\n        !server.baseUrl\n          ? \"START_NEXT_SERVER_THEN_RERUN_READINESS_PROBE\"\n          : !secretConfigured\n            ? \"CONFIGURE_TRADING_AUTOMATION_SECRET\"\n            : !approvedOrders.available\n              ? \"REVIEW_READ_ONLY_SUPABASE_ACCESS\"\n              : approvedOrders.count > 0\n                ? \"REVIEW_PENDING_APPROVED_PAPER_ORDERS_BEFORE_ONE_SHOT\"\n                : \"RUN_ONE_SHOT_LIVE_ROUTE_SMOKE_TEST\",\n    },\n\n    safety: {\n      databaseReads:\n        approvedOrders.available\n          ? 1\n          : 0,\n\n      databaseWrites:\n        0,\n\n      cyclePostRequests:\n        0,\n\n      productionOrdersCreated:\n        0,\n\n      productionOrdersChanged:\n        0,\n\n      productionPositionsChanged:\n        0,\n    },\n\n    outputFile:\n      \"logs/alpha-v3-one-shot-live-readiness-probe.json\",\n  };\n\n  fs.mkdirSync(\n    path.dirname(\n      outputFile\n    ),\n    {\n      recursive: true,\n    }\n  );\n\n  fs.writeFileSync(\n    outputFile,\n    JSON.stringify(\n      report,\n      null,\n      2\n    ) + \"\\n\",\n    \"utf8\"\n  );\n\n  console.log(\n    JSON.stringify(\n      report,\n      null,\n      2\n    )\n  );\n}\n\nmain().catch(\n  (error) => {\n    console.error(\n      JSON.stringify(\n        {\n          status:\n            \"ALPHA_V3_ONE_SHOT_LIVE_READINESS_PROBE_FATAL\",\n\n          error:\n            error instanceof Error\n              ? error.message\n              : String(error),\n\n          safety: {\n            databaseWrites:\n              0,\n\n            cyclePostRequests:\n              0,\n\n            productionOrdersCreated:\n              0,\n\n            productionPositionsChanged:\n              0,\n          },\n\n          nextGate:\n            \"REVIEW_ONE_SHOT_LIVE_READINESS_PROBE_FATAL\",\n        },\n        null,\n        2\n      )\n    );\n\n    process.exitCode =\n      2;\n  }\n);\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_ONE_SHOT_LIVE_READINESS_PROBE_V1_INSTALLED",

      generatedFile:
        "scripts/alpha-v3-one-shot-live-readiness-probe.cjs",

      checks: [
        "DETECT_RUNNING_NEXT_SERVER_3000_TO_3010",
        "CHECK_TRADING_AUTOMATION_SECRET_WITHOUT_PRINTING_VALUE",
        "CHECK_CYCLE_ROUTE_AND_SCHEDULER_FILES",
        "READ_ONLY_COUNT_RISK_APPROVED_BUY_ORDERS"
      ],

      databaseWrites:
        0,

      cyclePostRequests:
        0,

      productionOrdersCreated:
        0,

      productionOrdersChanged:
        0,

      productionPositionsChanged:
        0,

      nextAction:
        "RUN_ONE_SHOT_LIVE_READINESS_PROBE"
    },
    null,
    2
  )
);
