import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const migrationPath = path.join(
  ROOT,
  "supabase",
  "migrations",
  "20261011001400_paper_protective_sell_v4_runtime_replay_regression_v1_1.sql",
);

const runnerPath = path.join(
  ROOT,
  "scripts",
  "paper-protective-sell-v4-runtime-replay-regression-v1.ts",
);

const text =
  fs.existsSync(migrationPath)
    ? fs.readFileSync(migrationPath, "utf8")
    : "";

const runner =
  fs.existsSync(runnerPath)
    ? fs.readFileSync(runnerPath, "utf8")
    : "";

const checks = {
  migrationExists:
    text.length > 0,

  testRpcReplaced:
    text.includes(
      "create or replace function public.run_paper_sell_v4_replay_rt_v1()"
    ),

  productionV4DefinitionAbsent:
    !text.includes(
      "create or replace function public.execute_paper_protective_sell_v4("
    ),

  stillCallsProductionV4:
    text.includes(
      "select public.execute_paper_protective_sell_v4("
    ),

  falseResponseExitReasonAssertionRemoved:
    !text.includes(
      "coalesce(v_result ->> 'exitReason', '') <> 'TRAILING_STOP'"
    ),

  rowExitReasonAssertionPresent:
    text.includes(
      "coalesce(v_new_row_after ->> 'exit_reason', '') <> 'TRAILING_STOP'"
    ) &&
    text.includes(
      "ASSERT_HISTORICAL_EXIT_REASON_ROW_NOT_PRESERVED"
    ),

  rowExitReasonResultCheckPresent:
    text.includes(
      "coalesce(v_new_row_after ->> 'exit_reason', '') = 'TRAILING_STOP'"
    ),

  immutableWholeRowAssertionsRetained:
    text.includes(
      "ASSERT_OLD_TRADE_REWRITTEN"
    ) &&
    text.includes(
      "ASSERT_LATEST_TRADE_REWRITTEN"
    ),

  latestTradeAssertionRetained:
    text.includes(
      "ASSERT_LATEST_TRADE_NOT_RETURNED"
    ),

  exitPriceAssertionRetained:
    text.includes(
      "ASSERT_HISTORICAL_EXIT_PRICE_NOT_PRESERVED"
    ),

  quantityAssertionRetained:
    text.includes(
      "ASSERT_HISTORICAL_QUANTITY_NOT_PRESERVED"
    ),

  zeroDuplicateMutationAssertionsRetained:
    text.includes(
      "ASSERT_REPLAY_CREATED_OR_REMOVED_TRADE"
    ) &&
    text.includes(
      "ASSERT_REPLAY_CREATED_ORDER"
    ) &&
    text.includes(
      "ASSERT_REPLAY_CREATED_PROTECTIVE_FILL"
    ),

  accountCashAssertionsRetained:
    text.includes(
      "ASSERT_ACCOUNT_CASH_CHANGED"
    ) &&
    text.includes(
      "ASSERT_ACCOUNT_CASH_NOT_RESTORED"
    ),

  rollbackSentinelRetained:
    text.includes(
      "PROTECTIVE_SELL_V4_REPLAY_ROLLBACK_SENTINEL"
    ),

  runnerStillTargetsSameTestRpc:
    runner.includes(
      "/rpc/run_paper_sell_v4_replay_rt_v1"
    ),

  serviceRoleOnly:
    text.includes("from public;") &&
    text.includes("from anon;") &&
    text.includes("from authenticated;") &&
    text.includes("to service_role;"),

  noRealTradingEnablement:
    !text.includes("REAL_TRADING_ENABLED=true") &&
    !text.includes("ENABLE_REAL_TRADING=true") &&
    !text.includes("ENABLE_LIVE_TRADING=true"),
};

const failed =
  Object.entries(checks)
    .filter(([, ok]) => ok !== true)
    .map(([name]) => name);

console.log(JSON.stringify({
  status:
    failed.length === 0
      ? "AI_STOCK_LAB_PROTECTIVE_SELL_V4_RUNTIME_REPLAY_REGRESSION_V1_1_STRUCTURAL_PROOF_PASS"
      : "AI_STOCK_LAB_PROTECTIVE_SELL_V4_RUNTIME_REPLAY_REGRESSION_V1_1_STRUCTURAL_PROOF_FAIL",

  classification:
    failed.length === 0
      ? "SELL_V4_REPLAY_ASSERTION_ALIGNED_TO_ACTUAL_RESPONSE_CONTRACT_AND_ROW_IMMUTABILITY"
      : "SELL_V4_REPLAY_ASSERTION_FIX_REVIEW_REQUIRED",

  checks,
  failed,

  diagnosis: {
    priorRuntimeFailure:
      "AUDITOR_FALSE_NEGATIVE",

    priorObservedReplayResult: {
      alreadyClosed:
        true,
      exitPrice:
        11000,
      quantity:
        1,
      replayVersion:
        "PAPER_PROTECTIVE_SELL_CLOSED_REPLAY_V1",
      replayResolution:
        "FINAL_TRADE_BY_CLOSED_AT_DESC_ID_DESC",
      exitReasonField:
        "NOT_PART_OF_REPLAY_RESPONSE_CONTRACT",
    },

    correctedVerification:
      "Verify historical exit_reason from immutable paper_trade_history row before/after replay.",

    productionTradingLogicModified:
      false,
  },

  safety: {
    sourceOnly: true,
    databaseReads: 0,
    databaseWrites: 0,
    rpcInvoked: false,
    realTradingEnabled: false,
  },

  nextGate:
    failed.length === 0
      ? "DB_PUSH_014_THEN_RERUN_EXISTING_SELL_V4_RUNTIME_REPLAY"
      : "STOP_AND_REVIEW",
}, null, 2));

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
