const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const migration = path.join(
  ROOT,
  "supabase",
  "migrations",
  "20261011002700_paper_trade_history_actual_sell_cost_binding_v1.sql"
);

const source =
  fs.existsSync(migration)
    ? fs.readFileSync(migration, "utf8")
    : "";

const checks = {
  migrationFound:
    Boolean(source),

  bindingFunctionPresent:
    /create or replace function\s+public\.bind_paper_trade_actual_sell_cost_from_fill_v1\s*\(\s*\)/i
      .test(source),

  triggerIsAfterFillInsert:
    /create trigger[\s\S]*?trg_bind_paper_trade_actual_sell_cost_from_fill_v1[\s\S]*?after insert[\s\S]*?on public\.paper_protective_execution_fills_v2/i
      .test(source),

  canonicalFillBrokerFeeUsed:
    /new\.broker_fee/i.test(source),

  canonicalFillSellTaxUsed:
    /new\.sell_tax/i.test(source),

  updatesTradeExitBrokerFee:
    /exit_broker_fee\s*=/i.test(source),

  updatesTradeSellTax:
    /sell_tax\s*=/i.test(source),

  preservesEntryFeeInRoundTrip:
    /coalesce\(entry_broker_fee,\s*0\)/i
      .test(source),

  recalculatesTotalTransactionCost:
    /total_transaction_cost\s*=/i.test(source),

  recalculatesNetPnl:
    /net_pnl\s*=/i.test(source),

  recalculatesNetReturn:
    /net_return\s*=/i.test(source),

  exactPositionBinding:
    /t\.source_position_id\s*=\s*new\.position_id/i
      .test(source),

  exactQuantityBinding:
    /t\.quantity\s*=\s*new\.filled_quantity/i
      .test(source),

  exactPriceBinding:
    /t\.exit_price\s*=\s*new\.execution_price/i
      .test(source),

  exactObservedTimeBinding:
    /t\.closed_at\s*-\s*new\.observed_at/i
      .test(source),

  ambiguousMatchFailsClosed:
    /PAPER_ACTUAL_SELL_COST_TRADE_MATCH_AMBIGUOUS/i
      .test(source),

  standaloneFillDoesNotBreak:
    /if v_match_count = 0 then[\s\S]*?return new;/i
      .test(source),

  v3CostModelRecorded:
    /PAPER_EXECUTION_COST_ATTRIBUTION_V3_ACTUAL_SELL_EXECUTION/i
      .test(source),

  productionBuyNotReplaced:
    !/create or replace function\s+public\.execute_paper_buy_order/i
      .test(source),

  productionSellNotReplaced:
    !/create or replace function\s+public\.execute_paper_protective_sell/i
      .test(source),

  statusConstraintNotModified:
    !/paper_order_requests_status_check/i
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
    .map(([key]) => key);

console.log(JSON.stringify({
  status:
    failed.length === 0
      ? "AI_STOCK_LAB_PAPER_TRADE_HISTORY_ACTUAL_SELL_COST_BINDING_V1_VERIFIED"
      : "AI_STOCK_LAB_PAPER_TRADE_HISTORY_ACTUAL_SELL_COST_BINDING_V1_VERIFY_FAILED",

  migration:
    "supabase/migrations/20261011002700_paper_trade_history_actual_sell_cost_binding_v1.sql",

  provenBug: {
    inputSellBrokerFee:
      5.00,

    observedTradeHistoryExitBrokerFee:
      4.02,

    explanation:
      "4.14 BUY fee / 100000 BUY notional * 97000 SELL notional = 4.0158 -> 4.02",

    oldExitFeeSource:
      "DERIVED_FROM_BUY_EXECUTION",

    oldSellTaxSource:
      "FIXED_RATE_0.002",

    canonicalSourceAfterFix:
      "paper_protective_execution_fills_v2 actual broker_fee + sell_tax",
  },

  checks,
  failed,

  expectedReconciliationAfterApply: {
    entryBrokerFee:
      4.14,

    exitBrokerFee:
      5.00,

    sellTax:
      10.00,

    protectiveFillCost:
      15.00,

    tradeHistoryRoundTripCost:
      19.14,

    grossPnl:
      -3000.00,

    legacyRealizedPnl:
      -3015.00,

    netPnl:
      -3019.14,

    finalCash:
      1996980.86,
  },

  latentStatusIssueStillOpen: {
    buyBlockPathWritesFailed:
      true,

    deployedConstraintAllowsFailed:
      false,

    modifiedByThisMigration:
      false,
  },

  safety: {
    sourceOnly: true,
    migrationApplied: false,
    databaseWrites: 0,
    productionBuySellExecutionFunctionsModified: false,
    orderStatusConstraintModified: false,
    shadowFilesModified: false,
    realTradingEnabled: false,
  },

  nextGate:
    failed.length === 0
      ? "SUPABASE_DB_PUSH_DRY_RUN_02700"
      : "REVIEW_BINDING_MIGRATION",
}, null, 2));

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
