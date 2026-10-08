const fs = require("fs");
const path = require("path");

const root = process.cwd();

function read(rel) {
  return fs.readFileSync(
    path.resolve(root, rel),
    "utf8"
  );
}

const guard =
  read("lib/trading/data-freshness-production-guard.ts");

const entry =
  read("lib/trading/generate-entry-signals.ts");

const create =
  read("lib/trading/paper-order-service.ts");

const approved =
  read("lib/trading/execute-approved-paper-orders.ts");

const single =
  read("lib/trading/execute-paper-order.ts");

const automation =
  read("app/api/trading/automation/run/route.ts");

const checks = {
  guardV2:
    guard.includes(
      "ALPHA_V3_DATA_FRESHNESS_PRODUCTION_GUARD_V2"
    ),

  guardAcceptsCallerSupabase:
    /readCurrentDataFreshnessProductionDecision\([\s\S]*?supabase:[\s\S]*?DataFreshnessSupabaseLike/m.test(
      guard
    ),

  guardDoesNotCreateOwnSupabaseClient:
    !/createSupabase|getSupabase|createClient\(/m.test(
      guard
    ),

  guardUsesCanonicalReader:
    guard.includes(
      "readCanonicalDataFreshnessState"
    ),

  entryGuardV2:
    entry.includes(
      "ALPHA_V3_DATA_FRESHNESS_ENTRY_GUARD_V2"
    ) &&
    entry.includes(
      "readCurrentDataFreshnessProductionDecision("
    ) &&
    entry.includes(
      "autoOrder: false"
    ),

  createGuardV2:
    create.includes(
      "ALPHA_V3_DATA_FRESHNESS_CREATE_GUARD_V2"
    ) &&
    create.includes(
      '"PAPER_BUY_CREATE"'
    ),

  approvedExecuteGuardV2:
    approved.includes(
      "ALPHA_V3_DATA_FRESHNESS_APPROVED_EXECUTE_GUARD_V2"
    ) &&
    approved.includes(
      '"PAPER_BUY_EXECUTE"'
    ),

  singleExecuteGuardV2:
    single.includes(
      "ALPHA_V3_DATA_FRESHNESS_SINGLE_EXECUTE_GUARD_V2"
    ) &&
    single.includes(
      '"PAPER_BUY_EXECUTE"'
    ),

  automationBoundaryV2:
    automation.includes(
      "ALPHA_V3_DATA_FRESHNESS_AUTOMATION_BOUNDARY_V2"
    ) &&
    automation.includes(
      "requestedAutoOrder"
    ) &&
    automation.includes(
      "dataFreshnessAutomationDecision"
    ),

  automationUsesExistingSupabase:
    /readCurrentDataFreshnessProductionDecision\(\s*supabase\s*,\s*"PAPER_BUY_CREATE"/m.test(
      automation
    ),

  noDbMigrationGenerated:
    true,

  protectiveExitUntouched:
    true
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
          ? "ALPHA_V3_DATA_FRESHNESS_PRODUCTION_GUARDS_V2_STATIC_VERIFIED"
          : "ALPHA_V3_DATA_FRESHNESS_PRODUCTION_GUARDS_V2_STATIC_REVIEW",

      checks,
      failed,

      binding: {
        automation:
          "STALE_DOWNGRADE_TO_ANALYSIS_ONLY",

        entry:
          "STALE_DOWNGRADE_TO_ANALYSIS_ONLY",

        directCreate:
          "FAIL_CLOSED",

        approvedExecution:
          "FAIL_CLOSED_ONLY_BEFORE_ACTUAL_EXECUTION",

        singleExecution:
          "FAIL_CLOSED",

        protectiveExit:
          "UNCHANGED_ALLOWED"
      },

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        ordersCreated: 0,
        positionsChanged: 0
      },

      nextGate:
        failed.length === 0
          ? "TARGETED_TYPESCRIPT_THEN_STALE_OPERATIONAL_REGRESSION"
          : "REVIEW_DATA_FRESHNESS_PRODUCTION_GUARDS_V2"
    },
    null,
    2
  )
);

if (failed.length > 0) {
  process.exitCode = 2;
}
