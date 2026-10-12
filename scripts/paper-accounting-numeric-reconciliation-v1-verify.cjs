const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const MIG_DIR =
  path.join(ROOT, "supabase", "migrations");

const files =
  fs.existsSync(MIG_DIR)
    ? fs.readdirSync(MIG_DIR)
        .filter((name) =>
          name.endsWith(
            "_paper_accounting_numeric_reconciliation_v1.sql"
          )
        )
        .sort()
    : [];

const target =
  files.length
    ? files[files.length - 1]
    : null;

const source =
  target
    ? fs.readFileSync(
        path.join(MIG_DIR, target),
        "utf8",
      )
    : "";

const checks = {
  migrationFound:
    Boolean(target),

  testRpcPresent:
    /create or replace function\s+public\.run_paper_accounting_numeric_reconciliation_v1\s*\(\s*\)/i
      .test(source),

  callsBuyV2:
    /execute_paper_buy_order_with_execution_price_v2/i
      .test(source),

  callsSellV2:
    /execute_paper_protective_sell_v2/i
      .test(source),

  expectedBuyFee414:
    /v_buy_fee numeric\(18,\s*2\)\s*:=\s*4\.14/i
      .test(source),

  expectedSellSideCost15:
    /v_sell_fee numeric\(18,\s*2\)\s*:=\s*5\.00/i
      .test(source) &&
    /v_sell_tax numeric\(18,\s*2\)\s*:=\s*10\.00/i
      .test(source),

  roundTripDifferenceAsserted:
    /ASSERT_15_VS_19_14_DELTA_INVALID/i
      .test(source),

  tradeHistoryChecked:
    /paper_trade_history/i
      .test(source),

  protectiveFillChecked:
    /paper_protective_execution_fills_v2/i
      .test(source),

  positionFeeBasisChecked:
    /entry_broker_fee_basis_total/i
      .test(source) &&
    /entry_broker_fee_basis_remaining/i
      .test(source),

  accountCashChecked:
    /cash_balance/i
      .test(source),

  accountRealizedChecked:
    /daily_realized_pnl/i
      .test(source) &&
    /realized_pnl/i
      .test(source),

  transactionRollbackSentinel:
    /ACCOUNTING_NUMERIC_RECON_V1_ROLLBACK_SENTINEL/i
      .test(source) &&
    /rollbackSentinelCaught/i
      .test(source),

  persistentRowsVerifiedZero:
    /persistentAccountRows/i.test(source) &&
    /persistentRiskRows/i.test(source) &&
    /persistentOrderRows/i.test(source) &&
    /persistentPositionRows/i.test(source) &&
    /persistentTradeRows/i.test(source) &&
    /persistentFillRows/i.test(source),

  serviceRoleGranted:
    /grant execute on function[\s\S]*?to service_role;/i
      .test(source),

  publicRevoked:
    /revoke all on function[\s\S]*?from public, anon, authenticated;/i
      .test(source),

  productionFunctionsNotReplaced:
    !/create or replace function\s+public\.execute_paper_buy_order_with_execution_price_v2/i
      .test(source) &&
    !/create or replace function\s+public\.execute_paper_protective_sell_v2/i
      .test(source),

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
    .map(([name]) => name);

console.log(JSON.stringify({
  status:
    failed.length === 0
      ? "AI_STOCK_LAB_PAPER_ACCOUNTING_NUMERIC_RECON_V1_HARNESS_VERIFIED"
      : "AI_STOCK_LAB_PAPER_ACCOUNTING_NUMERIC_RECON_V1_HARNESS_VERIFY_FAILED",

  migration:
    target
      ? "supabase/migrations/" + target
      : null,

  checks,
  failed,

  expectedEconomics: {
    initialCash: 2000000,
    quantity: 10,
    entryPrice: 10000,
    exitPrice: 10100,
    entryNotional: 100000,
    buyFee: 4.14,
    cashAfterBuy: 1899995.86,
    exitNotional: 101000,
    sellFee: 5,
    sellTax: 10,
    protectiveFillCost: 15,
    grossPnl: 1000,
    accountRealizedPnl: 985,
    tradeHistoryRoundTripCost: 19.14,
    tradeHistoryNetPnl: 980.86,
    cashAfterSell: 2000980.86,
    tradeMinusFillCost: 4.14,
  },

  safety: {
    sourceOnly: true,
    databaseReads: 0,
    databaseWrites: 0,
    migrationApplied: false,
    runtimeFixtureUsesRollback: true,
    productionTradingFunctionsModified: false,
    shadowFilesModified: false,
    realBrokerApiInvoked: false,
    realTradingEnabled: false,
  },

  nextGate:
    failed.length === 0
      ? "SUPABASE_DB_PUSH_DRY_RUN_FOR_NUMERIC_RECON"
      : "REPAIR_HARNESS_BEFORE_DB_APPLY",
}, null, 2));

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
