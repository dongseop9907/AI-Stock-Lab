const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const candidates = [
  "app/api/trading/automation/cycle/route.ts",
  "app/api/trading/automation/run/route.ts",
  "scripts/alpha-v3-automation-cycle-scheduler.ts",
];

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function read(rel) {
  try {
    return fs.readFileSync(path.join(ROOT, rel), "utf8");
  } catch {
    return "";
  }
}

function scan(text) {
  const lines = text.split(/\r?\n/);

  const matched = [];

  const patterns = [
    /dry.?run/i,
    /preview/i,
    /read.?only/i,
    /no.?write/i,
    /write/i,
    /insert/i,
    /update/i,
    /upsert/i,
    /delete/i,
    /order/i,
    /position/i,
    /real.?trading/i,
    /live.?trading/i,
    /authorization/i,
    /secret/i,
    /POST/i,
    /GET/i,
    /automation/i,
  ];

  for (let i = 0; i < lines.length; i++) {
    if (patterns.some((re) => re.test(lines[i]))) {
      matched.push({
        line: i + 1,
        text: lines[i].trim(),
      });
    }
  }

  return matched.slice(0, 80);
}

const files = candidates
  .filter(exists)
  .map((rel) => ({
    file: rel,
    text: read(rel),
  }));

const routeFiles = files.filter(
  (item) => item.file.includes("/route.ts")
);

const scheduler =
  files.find(
    (item) =>
      item.file.endsWith(
        "alpha-v3-automation-cycle-scheduler.ts"
      )
  );

const routeSummary = routeFiles.map((item) => ({
  file: item.file,

  hasPost:
    /export\s+async\s+function\s+POST|export\s+function\s+POST/.test(
      item.text
    ),

  hasGet:
    /export\s+async\s+function\s+GET|export\s+function\s+GET/.test(
      item.text
    ),

  dryRunSurface:
    /(dry.?run|preview|read.?only|no.?write)/i.test(
      item.text
    ),

  databaseWriteSurface:
    /\.(insert|update|upsert|delete)\s*\(/i.test(
      item.text
    ) ||
    /\b(insert|update|upsert|delete)\b/i.test(
      item.text
    ),

  orderSurface:
    /(create.*order|place.*order|submit.*order|paper.*order|order.*service)/i.test(
      item.text
    ),

  realTradingGuard:
    /(REAL_TRADING_ENABLED|ENABLE_REAL_TRADING|ENABLE_LIVE_TRADING|realTrading)/i.test(
      item.text
    ),

  authOrSecretGuard:
    /(TRADING_AUTOMATION_SECRET|authorization|bearer|secret)/i.test(
      item.text
    ),

  matched:
    scan(item.text),
}));

const schedulerSummary = scheduler
  ? {
      file: scheduler.file,

      cycleRouteMentioned:
        /\/api\/trading\/automation\/cycle/.test(
          scheduler.text
        ),

      forwardOosFeatureFlagMentioned:
        /FORWARD_OOS_AUTOMATION_ENABLED/.test(
          scheduler.text
        ),

      matched:
        scan(scheduler.text).slice(0, 40),
    }
  : null;

const dryRunRoute =
  routeSummary.find(
    (item) =>
      item.dryRunSurface === true
  );

const anyWriteSurface =
  routeSummary.some(
    (item) =>
      item.databaseWriteSurface === true ||
      item.orderSurface === true
  );

const readiness =
  dryRunRoute
    ? "DRY_RUN_SURFACE_FOUND"
    : anyWriteSurface
    ? "NO_SAFE_DRY_RUN_FOUND_ROUTE_HAS_WRITE_OR_ORDER_SURFACE"
    : "NO_DRY_RUN_FOUND_BUT_NO_OBVIOUS_WRITE_SURFACE";

const report = {
  status:
    "AI_STOCK_LAB_TRUE_FORWARD_OOS_ONE_SHOT_ROUTE_SAFETY_AUDIT_V1_COMPLETE",

  readiness,

  routes:
    routeSummary,

  scheduler:
    schedulerSummary,

  safety: {
    readOnlySourceAudit:
      true,

    routeCalled:
      false,

    serverRequired:
      false,

    networkCalls:
      0,

    databaseReads:
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

  nextGate:
    readiness === "DRY_RUN_SURFACE_FOUND"
      ? "BUILD_ONE_SHOT_ROUTE_DRY_RUN_SMOKE_V1"
      : readiness ===
        "NO_SAFE_DRY_RUN_FOUND_ROUTE_HAS_WRITE_OR_ORDER_SURFACE"
      ? "DESIGN_EXPLICIT_NO_WRITE_ONE_SHOT_SMOKE_SURFACE_BEFORE_ROUTE_CALL"
      : "VERIFY_ROUTE_RUNTIME_DEPENDENCIES_BEFORE_ONE_SHOT_CALL",
};

fs.mkdirSync(
  path.join(ROOT, "logs"),
  { recursive: true }
);

fs.writeFileSync(
  path.join(
    ROOT,
    "logs",
    "true-forward-oos-one-shot-route-safety-audit-v1.json"
  ),
  JSON.stringify(report, null, 2),
  "utf8"
);

console.log(JSON.stringify({
  status:
    report.status,

  readiness:
    report.readiness,

  routes:
    routeSummary.map((item) => ({
      file: item.file,
      hasPost: item.hasPost,
      hasGet: item.hasGet,
      dryRunSurface: item.dryRunSurface,
      databaseWriteSurface: item.databaseWriteSurface,
      orderSurface: item.orderSurface,
      realTradingGuard: item.realTradingGuard,
      authOrSecretGuard: item.authOrSecretGuard,
    })),

  scheduler:
    schedulerSummary
      ? {
          file:
            schedulerSummary.file,
          cycleRouteMentioned:
            schedulerSummary.cycleRouteMentioned,
          forwardOosFeatureFlagMentioned:
            schedulerSummary.forwardOosFeatureFlagMentioned,
        }
      : null,

  nextGate:
    report.nextGate,
}, null, 2));

process.exitCode = 0;
