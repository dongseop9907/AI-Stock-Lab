import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const migrationPath = path.join(
  ROOT,
  "supabase",
  "migrations",
  "20261011001300_paper_protective_sell_v4_runtime_replay_regression_v1.sql",
);

const text =
  fs.existsSync(migrationPath)
    ? fs.readFileSync(migrationPath, "utf8")
    : "";

const checks = {
  migrationExists:
    text.length > 0,

  testRpcDefined:
    text.includes(
      "create or replace function public.run_paper_sell_v4_replay_rt_v1()"
    ),

  callsProductionV4:
    text.includes(
      "public.execute_paper_protective_sell_v4("
    ),

  exactV4SignatureGuard:
    text.includes(
      "public.execute_paper_protective_sell_v4(uuid,numeric,timestamptz,text,jsonb,integer,numeric,numeric,text)"
    ),

  twoClosedTrades:
    text.includes("v_trade_old") &&
    text.includes("v_trade_new"),

  deterministicLatestExpected:
    text.includes(
      "ASSERT_LATEST_TRADE_NOT_RETURNED"
    ) &&
    text.includes(
      "v_trade_new"
    ),

  replayInputsIntentionallyDifferent:
    text.includes("77777") &&
    text.includes("999") &&
    text.includes("'MANUAL'"),

  historicalResultAssertions:
    text.includes(
      "ASSERT_HISTORICAL_EXIT_REASON_NOT_PRESERVED"
    ) &&
    text.includes(
      "ASSERT_HISTORICAL_EXIT_PRICE_NOT_PRESERVED"
    ) &&
    text.includes(
      "ASSERT_HISTORICAL_QUANTITY_NOT_PRESERVED"
    ),

  noDuplicateTradeAssertion:
    text.includes(
      "ASSERT_REPLAY_CREATED_OR_REMOVED_TRADE"
    ),

  noDuplicateOrderAssertion:
    text.includes(
      "ASSERT_REPLAY_CREATED_ORDER"
    ),

  noProtectiveFillAssertion:
    text.includes(
      "ASSERT_REPLAY_CREATED_PROTECTIVE_FILL"
    ),

  historicalRowsImmutable:
    text.includes(
      "ASSERT_OLD_TRADE_REWRITTEN"
    ) &&
    text.includes(
      "ASSERT_LATEST_TRADE_REWRITTEN"
    ),

  accountCashInvariant:
    text.includes(
      "ASSERT_ACCOUNT_CASH_CHANGED"
    ) &&
    text.includes(
      "ASSERT_ACCOUNT_CASH_NOT_RESTORED"
    ),

  rollbackSentinel:
    text.includes(
      "PROTECTIVE_SELL_V4_REPLAY_ROLLBACK_SENTINEL"
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
      ? "AI_STOCK_LAB_PROTECTIVE_SELL_V4_RUNTIME_REPLAY_REGRESSION_V1_STRUCTURAL_PROOF_PASS"
      : "AI_STOCK_LAB_PROTECTIVE_SELL_V4_RUNTIME_REPLAY_REGRESSION_V1_STRUCTURAL_PROOF_FAIL",

  classification:
    failed.length === 0
      ? "SELL_V4_CLOSED_REPLAY_ROLLBACK_RUNTIME_REGRESSION_STRUCTURALLY_READY"
      : "SELL_V4_REPLAY_RUNTIME_REGRESSION_REVIEW_REQUIRED",

  checks,
  failed,

  safety: {
    sourceOnly: true,
    databaseReads: 0,
    databaseWrites: 0,
    rpcInvoked: false,
    productionTradingLogicModified: false,
    realTradingEnabled: false,
  },

  nextGate:
    failed.length === 0
      ? "DB_PUSH_013_THEN_RUN_SELL_V4_CONTROLLED_RUNTIME_REPLAY_REGRESSION"
      : "STOP_AND_REVIEW",
}, null, 2));

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
