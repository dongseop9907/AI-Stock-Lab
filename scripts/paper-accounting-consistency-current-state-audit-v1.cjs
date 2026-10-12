const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const MIG_DIR = path.join(ROOT, "supabase", "migrations");

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function allSqlFiles() {
  return fs.readdirSync(MIG_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({
      name,
      file: path.join(MIG_DIR, name),
      source: read(path.join(MIG_DIR, name)),
    }));
}

function firstExisting(names) {
  for (const name of names) {
    const f = path.join(MIG_DIR, name);
    if (fs.existsSync(f)) {
      return { name, file: f, source: read(f) };
    }
  }
  return null;
}

function latestDefinition(files, functionName) {
  const needle = new RegExp(
    "create\\s+or\\s+replace\\s+function\\s+public\\." +
      functionName +
      "\\s*\\(",
    "i"
  );

  const matches = files.filter((x) => needle.test(x.source));
  return matches.length ? matches[matches.length - 1] : null;
}

function has(src, re) {
  return Boolean(src && re.test(src));
}

function compactEvidence(src, patterns, max = 7) {
  if (!src) return [];
  const lines = src.split(/\r?\n/);
  const out = [];

  for (let i = 0; i < lines.length; i++) {
    if (patterns.some((re) => re.test(lines[i]))) {
      out.push({
        line: i + 1,
        text: lines[i].trim().slice(0, 200),
      });
      if (out.length >= max) break;
    }
  }
  return out;
}

const files = allSqlFiles();

const canonicalBuy = firstExisting([
  "20261009000100_paper_execution_realism_v2_buy_partial_fill.sql",
]);

const canonicalSell = firstExisting([
  "20261009000200_paper_execution_realism_v2_protective_sell.sql",
]);

const costAttributionV1 = firstExisting([
  "20261010000100_paper_execution_cost_attribution_v1.sql",
]);

const positionFeeBasis = firstExisting([
  "20261011000200_paper_partial_exit_position_entry_fee_basis_v1.sql",
]);

const cashNetFix = firstExisting([
  "20261011001800_paper_sell_v2_remaining_cash_net_fix_v1.sql",
]);

const latestBuyV2 = latestDefinition(
  files,
  "execute_paper_buy_order_with_execution_price_v2"
);

const latestSellV2 = latestDefinition(
  files,
  "execute_paper_protective_sell_v2"
);

const latestCostAttribution =
  latestDefinition(files, "apply_paper_trade_cost_attribution_v2") ||
  latestDefinition(files, "apply_paper_trade_cost_attribution_v1");

const positionFeeSrc = positionFeeBasis ? positionFeeBasis.source : "";
const buySrc = latestBuyV2 ? latestBuyV2.source : (canonicalBuy ? canonicalBuy.source : "");
const sellSrc = latestSellV2 ? latestSellV2.source : (canonicalSell ? canonicalSell.source : "");
const costSrc = latestCostAttribution
  ? latestCostAttribution.source
  : (costAttributionV1 ? costAttributionV1.source : "");
const cashFixSrc = cashNetFix ? cashNetFix.source : "";

const schemaChecks = {
  positionEntryFeeBasisTotal:
    has(positionFeeSrc, /entry_broker_fee_basis_total/i),

  positionEntryFeeBasisRemaining:
    has(positionFeeSrc, /entry_broker_fee_basis_remaining/i),

  feeBasisInvariant:
    has(
      positionFeeSrc,
      /entry_broker_fee_basis_remaining[\s\S]{0,160}<=\s*entry_broker_fee_basis_total/i
    ),

  sourcePositionMultiplicityRepair:
    has(positionFeeSrc, /remove one-trade-per-position unique constraint/i) ||
    (
      has(positionFeeSrc, /drop\s+constraint/i) &&
      has(positionFeeSrc, /source_position/i)
    ),

  buyFeeAccumulator:
    has(positionFeeSrc, /accumulate_paper_position_entry_fee_basis/i),

  partialExitAllocator:
    has(positionFeeSrc, /entry_broker_fee_basis_remaining/i),

  finalRemainderHandling:
    has(positionFeeSrc, /remainder/i) ||
    has(positionFeeSrc, /remaining_position_quantity/i),
};

const buyChecks = {
  canonicalBuyFound: Boolean(latestBuyV2 || canonicalBuy),

  executionPriceBasis:
    has(buySrc, /v_new_average_price/i) &&
    has(buySrc, /p_execution_price/i),

  buyFeePersisted:
    has(buySrc, /execution_broker_fee/i),

  buyTransactionCostPersisted:
    has(buySrc, /execution_transaction_cost/i),

  cashDebitSurface:
    has(buySrc, /cash_balance/i) &&
    has(buySrc, /broker_fee/i),
};

const sellChecks = {
  canonicalSellFound: Boolean(latestSellV2 || canonicalSell),

  feeInputPresent:
    has(sellSrc, /p_broker_fee/i),

  taxInputPresent:
    has(sellSrc, /p_sell_tax/i),

  exitOnlyCostSurface:
    has(sellSrc, /p_broker_fee/i) &&
    has(sellSrc, /p_sell_tax/i) &&
    has(sellSrc, /execution_transaction_cost|v_total_transaction_cost/i),

  pricePnlUsesPositionBasis:
    has(sellSrc, /average_price/i) &&
    has(sellSrc, /p_exit_price/i) &&
    has(sellSrc, /realized_pnl/i),

  accountRealizedPnlUpdated:
    has(sellSrc, /paper_accounts/i) &&
    has(sellSrc, /realized_pnl/i),

  tradeHistoryWritten:
    has(sellSrc, /paper_trade_history/i),

  protectiveFillLedgerWritten:
    has(sellSrc, /paper_protective_execution_fills_v2/i),
};

const costChecks = {
  costAttributionFound:
    Boolean(latestCostAttribution || costAttributionV1),

  entryFeeIncluded:
    has(costSrc, /entry_broker_fee/i),

  exitFeeIncluded:
    has(costSrc, /exit_broker_fee/i),

  sellTaxIncluded:
    has(costSrc, /sell_tax/i),

  roundTripTotalCost:
    has(costSrc, /entry_broker_fee/i) &&
    has(costSrc, /exit_broker_fee/i) &&
    has(costSrc, /sell_tax/i) &&
    has(costSrc, /total_transaction_cost/i),

  grossPnlPresent:
    has(costSrc, /gross_pnl/i),

  netPnlPresent:
    has(costSrc, /net_pnl/i),

  positionFeeBasisModel:
    has(costSrc, /POSITION_FEE_BASIS/i) ||
    has(costSrc, /entry_broker_fee_basis/i) ||
    has(
      positionFeeSrc,
      /PAPER_EXECUTION_COST_ATTRIBUTION_V2_POSITION_FEE_BASIS/i
    ) ||
    (
      has(positionFeeSrc, /entry_broker_fee_basis_total/i) &&
      has(positionFeeSrc, /entry_broker_fee_basis_remaining/i) &&
      has(positionFeeSrc, /cost_model_version/i)
    ),
};

const cashChecks = {
  cashNetFixMigrationFound:
    Boolean(cashNetFix),

  sellCashUsesFee:
    has(cashFixSrc, /cash_balance/i) &&
    has(cashFixSrc, /broker_fee/i),

  sellCashUsesTax:
    has(cashFixSrc, /cash_balance/i) &&
    has(cashFixSrc, /sell_tax/i),

  remainingCashSemanticsPresent:
    has(
      cashFixSrc,
      /remaining_cash|cash_net|net_cash|cash_balance/i
    ),
};

const regressionFiles = files
  .filter((x) =>
    /paper_partial_exit_multi_buy_fee_basis_runtime_regression_v1/i.test(x.name) ||
    /paper_fee_basis_runtime_exit_reason/i.test(x.name) ||
    /paper_protective_sell_v4_runtime_replay_regression/i.test(x.name)
  )
  .map((x) => "supabase/migrations/" + x.name);

const critical = {
  ...schemaChecks,
  ...buyChecks,
  ...sellChecks,
  ...costChecks,
  ...cashChecks,
};

const failed = Object.entries(critical)
  .filter(([, ok]) => ok !== true)
  .map(([name]) => name);

const classification =
  failed.length === 0
    ? "SOURCE_ACCOUNTING_CHAIN_STRUCTURALLY_CONSISTENT_RUNTIME_NUMERIC_RECONCILIATION_REQUIRED"
    : "ACCOUNTING_SOURCE_GAP_OR_REPAIR_REVIEW_REQUIRED";

const sources = {
  canonicalBuy:
    canonicalBuy ? "supabase/migrations/" + canonicalBuy.name : null,

  latestBuyV2Definition:
    latestBuyV2 ? "supabase/migrations/" + latestBuyV2.name : null,

  canonicalSell:
    canonicalSell ? "supabase/migrations/" + canonicalSell.name : null,

  latestSellV2Definition:
    latestSellV2 ? "supabase/migrations/" + latestSellV2.name : null,

  costAttribution:
    latestCostAttribution
      ? "supabase/migrations/" + latestCostAttribution.name
      : (
          costAttributionV1
            ? "supabase/migrations/" + costAttributionV1.name
            : null
        ),

  positionFeeBasis:
    positionFeeBasis
      ? "supabase/migrations/" + positionFeeBasis.name
      : null,

  sellCashNetFix:
    cashNetFix
      ? "supabase/migrations/" + cashNetFix.name
      : null,

  regressionFiles,
};

const evidence = {
  positionFeeBasis:
    compactEvidence(positionFeeSrc, [
      /entry_broker_fee_basis_total/i,
      /entry_broker_fee_basis_remaining/i,
      /one-trade-per-position/i,
      /remainder/i,
    ]),

  latestBuy:
    compactEvidence(buySrc, [
      /v_new_average_price/i,
      /execution_broker_fee/i,
      /execution_transaction_cost/i,
      /cash_balance/i,
    ]),

  latestSell:
    compactEvidence(sellSrc, [
      /p_broker_fee/i,
      /p_sell_tax/i,
      /realized_pnl/i,
      /paper_trade_history/i,
      /paper_protective_execution_fills_v2/i,
    ]),

  costAttribution:
    compactEvidence(costSrc, [
      /entry_broker_fee/i,
      /exit_broker_fee/i,
      /sell_tax/i,
      /total_transaction_cost/i,
      /net_pnl/i,
    ]),

  cashNetFix:
    compactEvidence(cashFixSrc, [
      /cash_balance/i,
      /broker_fee/i,
      /sell_tax/i,
      /remaining_cash|net_cash/i,
    ]),
};

console.log(JSON.stringify({
  status:
    failed.length === 0
      ? "AI_STOCK_LAB_PAPER_ACCOUNTING_CONSISTENCY_CURRENT_STATE_AUDIT_V1_PASS"
      : "AI_STOCK_LAB_PAPER_ACCOUNTING_CONSISTENCY_CURRENT_STATE_AUDIT_V1_REVIEW",

  classification,

  sources,

  checks: {
    schema: schemaChecks,
    buy: buyChecks,
    sell: sellChecks,
    costAttribution: costChecks,
    cash: cashChecks,
  },

  failed,

  semanticModel: {
    buyCash:
      "execution notional + BUY broker fee is debited at entry",

    positionBasis:
      "execution-price weighted average; BUY fee tracked separately in position entry-fee basis",

    sellExecutionCost:
      "SELL broker fee + sell tax",

    legacyAccountRealizedPnl:
      "price PnL minus SELL-side costs; BUY entry fee already affected cash at entry",

    tradeHistoryGrossPnl:
      "exit amount - entry amount",

    tradeHistoryTotalTransactionCost:
      "allocated BUY entry fee + SELL broker fee + sell tax",

    tradeHistoryNetPnl:
      "gross PnL - full round-trip transaction cost",
  },

  knownCostDifference: {
    protectiveFillCost:
      "EXIT_ONLY",

    tradeHistoryTotalTransactionCost:
      "FULL_ROUND_TRIP",

    example:
      "If protective fill cost is 15 and trade history total_transaction_cost is 19.14, the 4.14 delta is expected only when it equals allocated BUY entry fee.",

    runtimeRequirement:
      "Cash, account realized PnL, allocated position fee basis, trade gross/net PnL and fill ledger must still reconcile numerically.",
  },

  evidence,

  safety: {
    sourceOnly: true,
    databaseReads: 0,
    databaseWrites: 0,
    networkCalls: 0,
    ordersCreated: 0,
    ordersExecuted: 0,
    positionsChanged: 0,
    shadowFilesModified: false,
    promotionExecuted: false,
    realTradingEnabled: false,
  },

  nextGate:
    failed.length === 0
      ? "REAL_DB_NUMERIC_RECONCILIATION_BUY_POSITION_SELL_CASH_HISTORY"
      : "REPAIR_OR_NARROW_FAILED_ACCOUNTING_SOURCE_CHECKS",
}, null, 2));

process.exitCode = failed.length === 0 ? 0 : 1;
