const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const MIGRATION =
  path.join(
    ROOT,
    "supabase",
    "migrations",
    "20261010000100_paper_execution_cost_attribution_v1.sql"
  );

const HELPER =
  path.join(
    ROOT,
    "lib",
    "trading",
    "paper-execution-cost-attribution.ts"
  );

const CONTRACT =
  path.join(
    ROOT,
    "scripts",
    "paper-execution-cost-attribution-v1-contract-test.ts"
  );

function read(file) {
  return fs.existsSync(file)
    ? fs.readFileSync(
        file,
        "utf8"
      )
    : "";
}

const sql = read(MIGRATION);
const helper = read(HELPER);
const contract = read(CONTRACT);

const checks = {
  migrationExists:
    Boolean(sql),

  helperExists:
    Boolean(helper),

  contractExists:
    Boolean(contract),

  explicitCostColumns:
    [
      "gross_pnl",
      "entry_broker_fee",
      "exit_broker_fee",
      "sell_tax",
      "total_transaction_cost",
      "net_pnl",
      "gross_return",
      "net_return",
      "entry_slippage_amount",
      "entry_slippage_rate",
      "cost_attribution_complete",
      "cost_model_version",
      "cost_attribution_snapshot",
    ].every(
      name =>
        sql.includes(name)
    ),

  preservesLegacyRealizedPnl:
    !/new\.realized_pnl\s*:=/i.test(
      sql
    ) &&
    !/realized_pnl\s*=\s*v_net_pnl/i.test(
      sql
    ),

  reusesBuyExecutionFee:
    sql.includes(
      "v_buy_order.execution_broker_fee"
    ),

  derivesExitFeeRate:
    sql.includes(
      "DERIVED_FROM_BUY_EXECUTION"
    ) &&
    sql.includes(
      "v_entry_broker_fee"
    ) &&
    sql.includes(
      "v_entry_execution_value"
    ),

  fallbackBrokerFee:
    sql.includes(
      "0.00015"
    ),

  sellTax2026:
    sql.includes(
      "0.002"
    ),

  noSlippageDoubleCount:
    sql.includes(
      "EXECUTION_PRICE_EMBEDDED_NOT_DOUBLE_COUNTED_AS_TRANSACTION_COST"
    ) &&
    !/v_total_transaction_cost\s*:=\s*[\s\S]{0,250}v_entry_slippage_amount/i.test(
      sql
    ),

  triggerBeforeWrite:
    /create trigger\s+trg_paper_trade_cost_attribution_v1[\s\S]*?before insert or update/i.test(
      sql
    ),

  helperMatchesPolicy:
    helper.includes(
      "sellTaxRate:"
    ) &&
    helper.includes(
      "0.002"
    ) &&
    helper.includes(
      "fallbackBrokerFeeRate:"
    ) &&
    helper.includes(
      "0.00015"
    ),

  helperExplicitGrossNet:
    helper.includes(
      "grossPnl"
    ) &&
    helper.includes(
      "netPnl"
    ) &&
    helper.includes(
      "totalTransactionCost"
    ),

  sourceOnlyNoApply:
    !contract.includes(
      "createSupabaseServerClient"
    ) &&
    !contract.includes(
      ".rpc("
    ),

  noRealTradingEnable:
    !sql.includes(
      "real_order_enabled = true"
    ) &&
    !helper.includes(
      "REAL_TRADING_ENABLED=true"
    ),
};

const failed =
  Object.entries(
    checks
  )
    .filter(
      ([, ok]) =>
        ok !== true
    )
    .map(
      ([name]) =>
        name
    );

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "AI_STOCK_LAB_PAPER_EXECUTION_COST_ATTRIBUTION_V1_FOUNDATION_STATIC_VERIFIED"
          : "AI_STOCK_LAB_PAPER_EXECUTION_COST_ATTRIBUTION_V1_FOUNDATION_STATIC_FAILED",

      checks,

      contract: {
        legacyRealizedPnl:
          "PRESERVED",

        canonicalGrossNet:
          "gross_pnl + explicit costs + net_pnl",

        entryFee:
          "REUSE paper_order_requests.execution_broker_fee",

        exitFee:
          "DERIVE buy effective fee rate; fallback 0.00015",

        sellTax:
          "0.002",

        slippage:
          "DIAGNOSTIC ONLY; execution-price effect is not deducted twice",

        dbApply:
          "NOT_PERFORMED_IN_FOUNDATION_STAGE"
      },

      safety: {
        sourceOnly:
          true,
        databaseReads:
          0,
        databaseWrites:
          0,
        migrationApplied:
          false,
        ordersCreated:
          0,
        ordersExecuted:
          0,
        positionsChanged:
          0,
        promotionExecuted:
          false,
        realTradingEnabled:
          false
      },

      failed,

      nextGate:
        failed.length === 0
          ? "REVIEW_AND_APPLY_COST_ATTRIBUTION_DB_MIGRATION_V1"
          : "REPAIR_COST_ATTRIBUTION_FOUNDATION_V1"
    },
    null,
    2
  )
);

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
