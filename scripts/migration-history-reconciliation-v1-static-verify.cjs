const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, "supabase", "migrations");

const expected = [
  "20261006_alpha_v1_kis_investor_flow_daily.sql",
  "20261008000100_committed_risk_reservation_v3.sql",
  "20261008000200_committed_risk_concurrency_test_harness.sql",
  "20261010000100_paper_execution_cost_attribution_v1.sql",
];

const forbidden = [
  "063_alpha_v1_kis_investor_flow_daily.sql",
  "064_committed_risk_reservation_v3.sql",
  "065_committed_risk_concurrency_test_harness.sql",
];

const checks = {
  expectedRestoredFilesPresent:
    expected.every(name =>
      fs.existsSync(
        path.join(MIGRATIONS, name)
      )
    ),

  legacyAliasesAbsent:
    forbidden.every(name =>
      !fs.existsSync(
        path.join(MIGRATIONS, name)
      )
    ),

  costMigrationPresent:
    fs.existsSync(
      path.join(
        MIGRATIONS,
        "20261010000100_paper_execution_cost_attribution_v1.sql"
      )
    ),
};

const failed =
  Object.entries(checks)
    .filter(([, ok]) => ok !== true)
    .map(([name]) => name);

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "AI_STOCK_LAB_MIGRATION_HISTORY_RECONCILIATION_V1_STATIC_VERIFIED"
          : "AI_STOCK_LAB_MIGRATION_HISTORY_RECONCILIATION_V1_STATIC_FAILED",

      checks,

      expectedRemoteAlignment: {
        restoredAppliedVersions: [
          "20261006",
          "20261008000100",
          "20261008000200",
        ],

        expectedOnlyLocalPendingAfterRepair:
          "20261010000100",
      },

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        migrationsApplied: 0,
        ordersCreated: 0,
        positionsChanged: 0,
        realTradingEnabled: false,
      },

      failed,

      nextGate:
        failed.length === 0
          ? "MIGRATION_LIST_ALIGNMENT_CHECK"
          : "STOP_BEFORE_ANY_DB_PUSH",
    },
    null,
    2
  )
);

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
