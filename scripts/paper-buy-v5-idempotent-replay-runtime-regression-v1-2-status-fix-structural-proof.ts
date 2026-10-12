import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const migrationPath = path.join(
  ROOT,
  "supabase",
  "migrations",
  "20261011000700_paper_buy_v5_idempotent_replay_runtime_regression_v1_2_status_fix.sql",
);

const text =
  fs.existsSync(migrationPath)
    ? fs.readFileSync(migrationPath, "utf8")
    : "";

const checks = {
  migrationExists:
    text.length > 0,

  testRpcOnlyReplaced:
    /create\s+or\s+replace\s+function[\s\S]*run_paper_buy_v5_idempotent_replay_runtime_regression_v1/i.test(
      text,
    ),

  readsDeployedStatusConstraint:
    /pg_get_constraintdef/i.test(text) &&
    /paper_order_requests_status_check/i.test(text),

  failsClosedIfRiskApprovedNotAllowed:
    /RISK_APPROVED_NOT_ALLOWED_BY_DEPLOYED_STATUS_CHECK/i.test(
      text,
    ),

  fixtureUsesRiskApproved:
    /'RISK_APPROVED'/i.test(text),

  noFailedFixtureStatus:
    !/,\s*'FAILED'\s*,/i.test(text),

  riskDecisionFixtureRetained:
    /insert\s+into\s+public\.risk_decisions/i.test(text) &&
    /risk_decision_id/i.test(text),

  v5ReplayCallRetained:
    /execute_paper_buy_order_with_execution_price_v5/i.test(
      text,
    ),

  doesNotReplaceProductionV5:
    !/create\s+or\s+replace\s+function\s+public\.execute_paper_buy_order_with_execution_price_v5/i.test(
      text,
    ),

  rollbackAssertionsRetained:
    /ASSERT_SECOND_CALL_NOT_IDEMPOTENT_REPLAY/i.test(text) &&
    /ASSERT_CASH_CHANGED_ON_REPLAY/i.test(text) &&
    /ASSERT_POSITION_CHANGED_ON_REPLAY/i.test(text) &&
    /ASSERT_ORDER_EXECUTION_ACCUMULATORS_CHANGED_ON_REPLAY/i.test(text) &&
    /ASSERT_FIXTURE_ROWS_PERSISTED_AFTER_ROLLBACK/i.test(text),

  serviceRoleOnly:
    /revoke\s+all[\s\S]{0,900}?from\s+public/i.test(text) &&
    /revoke\s+all[\s\S]{0,1400}?from\s+anon/i.test(text) &&
    /revoke\s+all[\s\S]{0,1800}?from\s+authenticated/i.test(text) &&
    /grant\s+execute[\s\S]{0,500}?to\s+service_role/i.test(text),

  noTradingControlMutation:
    !/(insert\s+into|update|delete\s+from)\s+public\.trading_system_controls/i.test(
      text,
    ),

  noRealTradingEnablement:
    !/REAL_TRADING_ENABLED\s*=\s*true/i.test(text) &&
    !/ENABLE_REAL_TRADING\s*=\s*true/i.test(text) &&
    !/ENABLE_LIVE_TRADING\s*=\s*true/i.test(text),
};

const failed =
  Object.entries(checks)
    .filter(([, ok]) => ok !== true)
    .map(([name]) => name);

console.log(JSON.stringify({
  status:
    failed.length === 0
      ? "AI_STOCK_LAB_BUY_V5_IDEMPOTENT_REPLAY_RUNTIME_REGRESSION_V1_2_FIX_STRUCTURAL_PROOF_PASS"
      : "AI_STOCK_LAB_BUY_V5_IDEMPOTENT_REPLAY_RUNTIME_REGRESSION_V1_2_FIX_STRUCTURAL_PROOF_FAIL",

  classification:
    failed.length === 0
      ? "DEPLOYED_STATUS_CONSTRAINT_AWARE_FIXTURE_REPAIR_STRUCTURALLY_READY"
      : "STATUS_CONSTRAINT_AWARE_FIXTURE_REPAIR_REVIEW_REQUIRED",

  checks,
  failed,

  interpretation:
    "The previous V1.1 failure was a rollback-fixture status value rejected by the deployed paper_order_requests_status_check. V1.2 introspects that constraint and only uses RISK_APPROVED when it is actually allowed.",

  productionTradingLogicModified:
    false,

  safety: {
    sourceOnly: true,
    databaseReads: 0,
    databaseWrites: 0,
    rpcInvoked: false,
    realTradingEnabled: false,
  },

  nextGate:
    failed.length === 0
      ? "DB_PUSH_V1_2_STATUS_FIX_AND_RERUN_RUNTIME_REGRESSION"
      : "REVIEW_FAILED_FIXTURE_CHECKS",
}, null, 2));

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
