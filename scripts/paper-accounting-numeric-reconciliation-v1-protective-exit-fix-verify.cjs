const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const target = path.join(
  ROOT,
  "supabase",
  "migrations",
  "20261011002600_paper_accounting_numeric_reconciliation_v1_protective_exit_fixture_fix.sql"
);

const source =
  fs.existsSync(target)
    ? fs.readFileSync(target, "utf8")
    : "";

const checks = {
  migrationFound:
    Boolean(source),

  accountingTestRpcReplaced:
    /create or replace function\s+public\.run_paper_accounting_numeric_reconciliation_v1\s*\(\s*\)/i
      .test(source),

  entryPrice10000:
    /v_entry_price numeric\(18,\s*2\)\s*:=\s*10000\.00;/i
      .test(source),

  stopPrice9700:
    /v_stop_price numeric\(18,\s*2\)\s*:=\s*9700\.00;/i
      .test(source),

  exitPrice9700:
    /v_exit_price numeric\(18,\s*2\)\s*:=\s*9700\.00;/i
      .test(source),

  reservedRisk3000:
    /reserved_risk_amount\s*\)\s*values\s*\([\s\S]*?'RISK_APPROVED',\s*v_risk_id,\s*3000\.00\s*\);/i
      .test(source),

  callsCanonicalBuyV2:
    /execute_paper_buy_order_with_execution_price_v2/i
      .test(source),

  callsCanonicalSellV2:
    /execute_paper_protective_sell_v2/i
      .test(source),

  protectiveStopPath:
    /p_exit_reason\s*=>\s*'STOP_LOSS'/i
      .test(source),

  expectedNegativeEconomicsDocumented:
    /gross PnL = -3000/i.test(source) &&
    /account realized PnL = -3015/i.test(source) &&
    /trade net PnL = -3019\.14/i.test(source) &&
    /final cash = 1996980\.86/i.test(source),

  roundTripDifferenceStill414:
    /trade cost - protective fill cost = 4\.14/i
      .test(source),

  productionBuyV2NotReplaced:
    !/create or replace function\s+public\.execute_paper_buy_order_with_execution_price_v2/i
      .test(source),

  productionBuyV5NotReplaced:
    !/create or replace function\s+public\.execute_paper_buy_order_with_execution_price_v5/i
      .test(source),

  productionSellV2NotReplaced:
    !/create or replace function\s+public\.execute_paper_protective_sell_v2/i
      .test(source),

  statusConstraintNotModified:
    !/alter table\s+public\.paper_order_requests[\s\S]{0,300}paper_order_requests_status_check/i
      .test(source),

  rollbackHarnessStillPresent:
    /ACCOUNTING_NUMERIC_RECON_V1_ROLLBACK_SENTINEL/i
      .test(source),

  cleanupAssertionsStillPresent:
    /persistentAccountRows/i.test(source) &&
    /persistentOrderRows/i.test(source) &&
    /persistentTradeRows/i.test(source) &&
    /persistentFillRows/i.test(source),

  noShadowMutation:
    !/true_forward|forward_oos|shadow_session/i
      .test(source),

  noRealTradingEnable:
    !/REAL_TRADING_ENABLED\s*=\s*true/i
      .test(source),
};

const failed =
  Object.entries(checks)
    .filter(([, ok]) => ok !== true)
    .map(([key]) => key);

console.log(JSON.stringify({
  status:
    failed.length === 0
      ? "AI_STOCK_LAB_PAPER_ACCOUNTING_NUMERIC_RECON_PROTECTIVE_EXIT_FIX_V1_VERIFIED"
      : "AI_STOCK_LAB_PAPER_ACCOUNTING_NUMERIC_RECON_PROTECTIVE_EXIT_FIX_V1_VERIFY_FAILED",

  migration:
    "supabase/migrations/20261011002600_paper_accounting_numeric_reconciliation_v1_protective_exit_fixture_fix.sql",

  correction: {
    entryPrice: 10000,
    stopPrice: 9700,
    previousExitPrice: 10100,
    correctedExitPrice: 9700,
    reason:
      "Protective SELL only executes when exit price is at or below current stop.",
  },

  expectedEconomics: {
    initialCash: 2000000,
    entryNotional: 100000,
    buyFee: 4.14,
    cashAfterBuy: 1899995.86,
    exitNotional: 97000,
    sellFee: 5,
    sellTax: 10,
    protectiveFillCost: 15,
    grossPnl: -3000,
    accountRealizedPnl: -3015,
    tradeHistoryRoundTripCost: 19.14,
    tradeHistoryNetPnl: -3019.14,
    finalCash: 1996980.86,
    tradeMinusFillCost: 4.14,
  },

  checks,
  failed,

  latentStatusIssueStillOpen: {
    buyBlockPathWritesFailed: true,
    deployedConstraintAllowsFailed: false,
    modifiedByThisFix: false,
  },

  safety: {
    sourceOnly: true,
    databaseWrites: 0,
    migrationApplied: false,
    syntheticFixtureOnly: true,
    runtimeFixtureRollbackPreserved: true,
    productionTradingFunctionsModified: false,
    shadowFilesModified: false,
    realTradingEnabled: false,
  },

  nextGate:
    failed.length === 0
      ? "DB_PUSH_02600_AND_RERUN_NUMERIC_RECON"
      : "REVIEW_PROTECTIVE_EXIT_FIX",
}, null, 2));

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
