const fs = require("fs");
const path = require("path");

const root = process.cwd();

const rel =
  "scripts/alpha-v3-data-freshness-live-guard-regression-v1.ts";

const text =
  fs.readFileSync(
    path.resolve(root, rel),
    "utf8"
  );

const checks = {
  realCanonicalReader:
    text.includes(
      "readCanonicalDataFreshnessState"
    ),

  realProductionGuard:
    text.includes(
      "assertDataFreshnessAllows"
    ),

  createGuardTested:
    text.includes(
      '"PAPER_BUY_CREATE"'
    ),

  executeGuardTested:
    text.includes(
      '"PAPER_BUY_EXECUTE"'
    ),

  protectiveExitTested:
    text.includes(
      '"PROTECTIVE_EXIT"'
    ),

  riskMaintenanceTested:
    text.includes(
      '"RISK_MAINTENANCE"'
    ),

  noProductionCreateCall:
    !text.includes(
      "createPaperBuyOrder("
    ),

  noProductionExecuteCall:
    !text.includes(
      "executePaperOrder("
    ),

  noAutomationPost:
    !text.includes(
      "/api/trading/automation/run"
    ),

  noDatabaseMutation:
    !/\.(insert|upsert|update|delete|rpc)\s*\(/m.test(
      text
    ),
};

const failed =
  Object.entries(checks)
    .filter(([, value]) => !value)
    .map(([key]) => key);

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "ALPHA_V3_DATA_FRESHNESS_LIVE_GUARD_REGRESSION_V1_STATIC_VERIFIED"
          : "ALPHA_V3_DATA_FRESHNESS_LIVE_GUARD_REGRESSION_V1_STATIC_REVIEW",

      checks,
      failed,

      safety: {
        productionOrderPathInvoked:
          false,

        databaseWrites:
          0,
      },

      nextGate:
        failed.length === 0
          ? "RUN_LIVE_STALE_GUARD_REGRESSION"
          : "REVIEW_LIVE_GUARD_TEST_HARNESS",
    },
    null,
    2
  )
);

if (failed.length > 0) {
  process.exitCode = 2;
}
