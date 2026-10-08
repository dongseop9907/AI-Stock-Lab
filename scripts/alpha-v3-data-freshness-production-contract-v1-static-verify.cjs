const fs = require("fs");
const path = require("path");

const root = process.cwd();

const rel =
  "lib/trading/data-freshness-production-contract.ts";

const text =
  fs.readFileSync(
    path.resolve(
      root,
      rel,
    ),
    "utf8",
  );

const checks = {
  versionPresent:
    text.includes(
      "ALPHA_V3_DATA_FRESHNESS_PRODUCTION_V1",
    ),

  staleBlocksNewRisk:
    text.includes(
      "STALE_MARKET_DATA",
    ) &&
    text.includes(
      "blocksNewRisk: true",
    ),

  missingFailsClosed:
    text.includes(
      "FRESHNESS_STATE_MISSING",
    ),

  unknownFailsClosed:
    text.includes(
      "UNKNOWN_FRESHNESS_STATE_FAIL_CLOSED",
    ),

  dateMismatchBlocked:
    text.includes(
      "MARKET_DATE_MISMATCH",
    ),

  qualityGateBlocked:
    text.includes(
      "QUALITY_GATE_FAILED",
    ),

  protectiveExitAllowed:
    text.includes(
      "PROTECTIVE_EXIT_ALLOWED",
    ),

  riskMaintenanceAllowed:
    text.includes(
      "RISK_MAINTENANCE_ALLOWED",
    ),

  observeAllowed:
    text.includes(
      "OBSERVATION_ALLOWED",
    ),

  analyzeAllowed:
    text.includes(
      "ANALYSIS_ALLOWED",
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
          ? "ALPHA_V3_DATA_FRESHNESS_PRODUCTION_CONTRACT_V1_STATIC_VERIFIED"
          : "ALPHA_V3_DATA_FRESHNESS_PRODUCTION_CONTRACT_V1_STATIC_REVIEW",

      checks,
      failed,

      nextGate:
        failed.length === 0
          ? "RUN_CONTRACT_TEST"
          : "REVIEW_CONTRACT_STATIC",
    },
    null,
    2,
  ),
);

if (failed.length > 0) {
  process.exitCode = 2;
}
