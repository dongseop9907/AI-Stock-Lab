const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const SCRIPTS = path.join(ROOT, "scripts");
const PACKAGE = path.join(ROOT, "package.json");
const TARGET = path.join(
  SCRIPTS,
  "true-forward-oos-one-shot-route-safety-audit-v1.cjs"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_ONE_SHOT_ROUTE_SAFETY_AUDIT_V1_INSTALL_FAILED",
    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

if (!fs.existsSync(PACKAGE)) {
  fail("PACKAGE_JSON_NOT_FOUND");
} else {
  fs.writeFileSync(
    TARGET,
    "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst ROOT = process.cwd();\n\nconst candidates = [\n  \"app/api/trading/automation/cycle/route.ts\",\n  \"app/api/trading/automation/run/route.ts\",\n  \"scripts/alpha-v3-automation-cycle-scheduler.ts\",\n];\n\nfunction exists(rel) {\n  return fs.existsSync(path.join(ROOT, rel));\n}\n\nfunction read(rel) {\n  try {\n    return fs.readFileSync(path.join(ROOT, rel), \"utf8\");\n  } catch {\n    return \"\";\n  }\n}\n\nfunction scan(text) {\n  const lines = text.split(/\\r?\\n/);\n\n  const matched = [];\n\n  const patterns = [\n    /dry.?run/i,\n    /preview/i,\n    /read.?only/i,\n    /no.?write/i,\n    /write/i,\n    /insert/i,\n    /update/i,\n    /upsert/i,\n    /delete/i,\n    /order/i,\n    /position/i,\n    /real.?trading/i,\n    /live.?trading/i,\n    /authorization/i,\n    /secret/i,\n    /POST/i,\n    /GET/i,\n    /automation/i,\n  ];\n\n  for (let i = 0; i < lines.length; i++) {\n    if (patterns.some((re) => re.test(lines[i]))) {\n      matched.push({\n        line: i + 1,\n        text: lines[i].trim(),\n      });\n    }\n  }\n\n  return matched.slice(0, 80);\n}\n\nconst files = candidates\n  .filter(exists)\n  .map((rel) => ({\n    file: rel,\n    text: read(rel),\n  }));\n\nconst routeFiles = files.filter(\n  (item) => item.file.includes(\"/route.ts\")\n);\n\nconst scheduler =\n  files.find(\n    (item) =>\n      item.file.endsWith(\n        \"alpha-v3-automation-cycle-scheduler.ts\"\n      )\n  );\n\nconst routeSummary = routeFiles.map((item) => ({\n  file: item.file,\n\n  hasPost:\n    /export\\s+async\\s+function\\s+POST|export\\s+function\\s+POST/.test(\n      item.text\n    ),\n\n  hasGet:\n    /export\\s+async\\s+function\\s+GET|export\\s+function\\s+GET/.test(\n      item.text\n    ),\n\n  dryRunSurface:\n    /(dry.?run|preview|read.?only|no.?write)/i.test(\n      item.text\n    ),\n\n  databaseWriteSurface:\n    /\\.(insert|update|upsert|delete)\\s*\\(/i.test(\n      item.text\n    ) ||\n    /\\b(insert|update|upsert|delete)\\b/i.test(\n      item.text\n    ),\n\n  orderSurface:\n    /(create.*order|place.*order|submit.*order|paper.*order|order.*service)/i.test(\n      item.text\n    ),\n\n  realTradingGuard:\n    /(REAL_TRADING_ENABLED|ENABLE_REAL_TRADING|ENABLE_LIVE_TRADING|realTrading)/i.test(\n      item.text\n    ),\n\n  authOrSecretGuard:\n    /(TRADING_AUTOMATION_SECRET|authorization|bearer|secret)/i.test(\n      item.text\n    ),\n\n  matched:\n    scan(item.text),\n}));\n\nconst schedulerSummary = scheduler\n  ? {\n      file: scheduler.file,\n\n      cycleRouteMentioned:\n        /\\/api\\/trading\\/automation\\/cycle/.test(\n          scheduler.text\n        ),\n\n      forwardOosFeatureFlagMentioned:\n        /FORWARD_OOS_AUTOMATION_ENABLED/.test(\n          scheduler.text\n        ),\n\n      matched:\n        scan(scheduler.text).slice(0, 40),\n    }\n  : null;\n\nconst dryRunRoute =\n  routeSummary.find(\n    (item) =>\n      item.dryRunSurface === true\n  );\n\nconst anyWriteSurface =\n  routeSummary.some(\n    (item) =>\n      item.databaseWriteSurface === true ||\n      item.orderSurface === true\n  );\n\nconst readiness =\n  dryRunRoute\n    ? \"DRY_RUN_SURFACE_FOUND\"\n    : anyWriteSurface\n    ? \"NO_SAFE_DRY_RUN_FOUND_ROUTE_HAS_WRITE_OR_ORDER_SURFACE\"\n    : \"NO_DRY_RUN_FOUND_BUT_NO_OBVIOUS_WRITE_SURFACE\";\n\nconst report = {\n  status:\n    \"AI_STOCK_LAB_TRUE_FORWARD_OOS_ONE_SHOT_ROUTE_SAFETY_AUDIT_V1_COMPLETE\",\n\n  readiness,\n\n  routes:\n    routeSummary,\n\n  scheduler:\n    schedulerSummary,\n\n  safety: {\n    readOnlySourceAudit:\n      true,\n\n    routeCalled:\n      false,\n\n    serverRequired:\n      false,\n\n    networkCalls:\n      0,\n\n    databaseReads:\n      0,\n\n    databaseWrites:\n      0,\n\n    ordersCreated:\n      0,\n\n    positionsChanged:\n      0,\n\n    realTradingEnabled:\n      false,\n  },\n\n  nextGate:\n    readiness === \"DRY_RUN_SURFACE_FOUND\"\n      ? \"BUILD_ONE_SHOT_ROUTE_DRY_RUN_SMOKE_V1\"\n      : readiness ===\n        \"NO_SAFE_DRY_RUN_FOUND_ROUTE_HAS_WRITE_OR_ORDER_SURFACE\"\n      ? \"DESIGN_EXPLICIT_NO_WRITE_ONE_SHOT_SMOKE_SURFACE_BEFORE_ROUTE_CALL\"\n      : \"VERIFY_ROUTE_RUNTIME_DEPENDENCIES_BEFORE_ONE_SHOT_CALL\",\n};\n\nfs.mkdirSync(\n  path.join(ROOT, \"logs\"),\n  { recursive: true }\n);\n\nfs.writeFileSync(\n  path.join(\n    ROOT,\n    \"logs\",\n    \"true-forward-oos-one-shot-route-safety-audit-v1.json\"\n  ),\n  JSON.stringify(report, null, 2),\n  \"utf8\"\n);\n\nconsole.log(JSON.stringify({\n  status:\n    report.status,\n\n  readiness:\n    report.readiness,\n\n  routes:\n    routeSummary.map((item) => ({\n      file: item.file,\n      hasPost: item.hasPost,\n      hasGet: item.hasGet,\n      dryRunSurface: item.dryRunSurface,\n      databaseWriteSurface: item.databaseWriteSurface,\n      orderSurface: item.orderSurface,\n      realTradingGuard: item.realTradingGuard,\n      authOrSecretGuard: item.authOrSecretGuard,\n    })),\n\n  scheduler:\n    schedulerSummary\n      ? {\n          file:\n            schedulerSummary.file,\n          cycleRouteMentioned:\n            schedulerSummary.cycleRouteMentioned,\n          forwardOosFeatureFlagMentioned:\n            schedulerSummary.forwardOosFeatureFlagMentioned,\n        }\n      : null,\n\n  nextGate:\n    report.nextGate,\n}, null, 2));\n\nprocess.exitCode = 0;\n",
    "utf8"
  );

  let pkg;

  try {
    pkg = JSON.parse(
      fs.readFileSync(
        PACKAGE,
        "utf8"
      )
    );
  } catch (error) {
    fail(
      "PACKAGE_JSON_PARSE_FAILED",
      {
        error:
          String(
            error instanceof Error
              ? error.message
              : error
          ),
      }
    );
  }

  if (pkg) {
    pkg.scripts ||= {};

    pkg.scripts[
      "test:true-forward-oos-one-shot-route-safety"
    ] =
      "node ./scripts/true-forward-oos-one-shot-route-safety-audit-v1.cjs";

    fs.writeFileSync(
      PACKAGE,
      JSON.stringify(
        pkg,
        null,
        2
      ) + "\n",
      "utf8"
    );

    console.log(JSON.stringify({
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_ONE_SHOT_ROUTE_SAFETY_AUDIT_V1_INSTALLED",

      generatedFile:
        "scripts/true-forward-oos-one-shot-route-safety-audit-v1.cjs",

      packageScript:
        "npm run test:true-forward-oos-one-shot-route-safety",

      mode:
        "READ_ONLY_ROUTE_SAFETY_AUDIT",

      safety: {
        routeCalled:
          false,
        networkCalls:
          0,
        databaseWrites:
          0,
        ordersCreated:
          0,
        positionsChanged:
          0,
        realTradingEnabled:
          false,
      },

      nextAction:
        "RUN_COMPACT_ONE_SHOT_ROUTE_SAFETY_AUDIT",
    }, null, 2));
  }
}
