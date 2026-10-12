import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const migrationPath =
  path.join(
    ROOT,
    "supabase",
    "migrations",
    "20261011000500_paper_buy_v5_idempotent_replay_runtime_regression_v1.sql",
  );

const text =
  fs.existsSync(migrationPath)
    ? fs.readFileSync(
        migrationPath,
        "utf8",
      )
    : "";

const checks = {
  migrationExists:
    text.length > 0,

  regressionFunctionDefined:
    /run_paper_buy_v5_idempotent_replay_runtime_regression_v1/i.test(
      text,
    ),

  serviceRoleOnly:
    /revoke\s+all[\s\S]{0,900}?from\s+public/i.test(
      text,
    ) &&
    /revoke\s+all[\s\S]{0,1400}?from\s+anon/i.test(
      text,
    ) &&
    /revoke\s+all[\s\S]{0,1800}?from\s+authenticated/i.test(
      text,
    ) &&
    /grant\s+execute[\s\S]{0,500}?to\s+service_role/i.test(
      text,
    ),

  preSeedsLedger:
    /insert\s+into\s+public\.paper_buy_execution_events_v1/i.test(
      text,
    ),

  callsV5:
    /execute_paper_buy_order_with_execution_price_v5/i.test(
      text,
    ),

  doesNotCallV4Directly:
    !/execute_paper_buy_order_with_execution_price_v4\s*\(/i.test(
      text,
    ),

  doesNotCallV3Directly:
    !/execute_paper_buy_order_with_execution_price_v3\s*\(/i.test(
      text,
    ),

  doesNotCallV2Directly:
    !/execute_paper_buy_order_with_execution_price_v2\s*\(/i.test(
      text,
    ),

  exactReplayAsserted:
    /idempotentReplay/i.test(
      text,
    ) &&
    /ASSERT_SECOND_CALL_NOT_IDEMPOTENT_REPLAY/i.test(
      text,
    ),

  cashInvariantAsserted:
    /ASSERT_CASH_CHANGED_ON_REPLAY/i.test(
      text,
    ),

  positionInvariantAsserted:
    /ASSERT_POSITION_CHANGED_ON_REPLAY/i.test(
      text,
    ),

  orderAccumulatorInvariantAsserted:
    /ASSERT_ORDER_EXECUTION_ACCUMULATORS_CHANGED_ON_REPLAY/i.test(
      text,
    ),

  ledgerInvariantAsserted:
    /ASSERT_LEDGER_COUNT_CHANGED/i.test(
      text,
    ),

  nestedExceptionRollbackUsed:
    /ROLLBACK_SENTINEL/i.test(
      text,
    ) &&
    /exception\s+when\s+raise_exception/i.test(
      text,
    ),

  postRollbackFixtureAbsenceAsserted:
    /ASSERT_FIXTURE_ROWS_PERSISTED_AFTER_ROLLBACK/i.test(
      text,
    ),

  accountRestorationAsserted:
    /ASSERT_ACCOUNT_CASH_CHANGED_AFTER_ROLLBACK/i.test(
      text,
    ),

  noTradingControlMutation:
    !/(insert\s+into|update|delete\s+from)\s+public\.trading_system_controls/i.test(
      text,
    ),

  noRealTradingEnablement:
    !/REAL_TRADING_ENABLED\s*=\s*true/i.test(
      text,
    ) &&
    !/ENABLE_REAL_TRADING\s*=\s*true/i.test(
      text,
    ) &&
    !/ENABLE_LIVE_TRADING\s*=\s*true/i.test(
      text,
    ),
};

const failed =
  Object.entries(checks)
    .filter(([, ok]) => ok !== true)
    .map(([name]) => name);

console.log(JSON.stringify({
  status:
    failed.length === 0
      ? "AI_STOCK_LAB_BUY_V5_IDEMPOTENT_REPLAY_RUNTIME_REGRESSION_V1_STRUCTURAL_PROOF_PASS"
      : "AI_STOCK_LAB_BUY_V5_IDEMPOTENT_REPLAY_RUNTIME_REGRESSION_V1_STRUCTURAL_PROOF_FAIL",

  classification:
    failed.length === 0
      ? "BUY_V5_ROLLBACK_RUNTIME_REPLAY_REGRESSION_STRUCTURALLY_READY"
      : "BUY_V5_ROLLBACK_RUNTIME_REPLAY_REGRESSION_REVIEW_REQUIRED",

  checks,
  failed,

  safety: {
    sourceOnly:
      true,

    databaseReads:
      0,

    databaseWrites:
      0,

    rpcInvoked:
      false,

    realTradingEnabled:
      false,
  },

  nextGate:
    failed.length === 0
      ? "APPLY_TEST_RPC_MIGRATION_AND_RUN_RUNTIME_REPLAY_REGRESSION"
      : "REVIEW_FAILED_STRUCTURAL_CHECKS",
}, null, 2));

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
