const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const TARGET =
  path.join(
    ROOT,
    "lib",
    "trading",
    "execute-paper-order.ts"
  );

const source =
  fs.readFileSync(
    TARGET,
    "utf8"
  );

const checks = {
  v4CallerExactlyOnce:
    (
      source.split(
        '"execute_paper_buy_order_with_execution_price_v4"'
      ).length - 1
    ) === 1,

  v3CallerRemoved:
    !source.includes(
      '"execute_paper_buy_order_with_execution_price_v3"'
    ),

  executionPriceArg:
    source.includes(
      "p_execution_price:"
    ) &&
    source.includes(
      "realismDecision.executionPrice"
    ),

  observedAtArg:
    source.includes(
      "p_execution_observed_at:"
    ) &&
    source.includes(
      "safeExecution.executionPriceObservedAt"
    ),

  executionPriceSourceArg:
    source.includes(
      "p_execution_price_source:"
    ) &&
    source.includes(
      "realismDecision.priceSource"
    ),

  provenanceArg:
    source.includes(
      "p_execution_provenance:"
    ),

  provenanceVersionPreserved:
    source.includes(
      "PAPER_ORDERBOOK_EXECUTION_PROVENANCE_V1"
    ),

  fillQuantityArg:
    source.includes(
      "p_fill_quantity:"
    ) &&
    source.includes(
      "realismDecision.filledQuantity"
    ),

  brokerFeeArg:
    source.includes(
      "p_broker_fee:"
    ) &&
    source.includes(
      "realismDecision.brokerFee"
    ),

  bestAskPathPreserved:
    source.includes(
      "BEST_ASK"
    ) ||
    source.includes(
      "realismDecision.priceSource"
    ),

  orderbookMetadataPreserved:
    source.includes(
      "orderbookQuote"
    ),

  freshnessMetadataPreserved:
    source.includes(
      "freshnessBlocker"
    ),

  marketImpactPreserved:
    source.includes(
      "marketImpactBps"
    ),

  topOfBookPreserved:
    source.includes(
      "topOfBookQuantityCap"
    ),

  noRealTradingEnable:
    !/REAL_TRADING_ENABLED\s*=\s*true|ENABLE_REAL_TRADING\s*=\s*true|ENABLE_LIVE_TRADING\s*=\s*true/.test(
      source
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
          ? "AI_STOCK_LAB_PAPER_BUY_FILLED_PRICE_SEMANTIC_V1_V4_CALLER_STATIC_PASS"
          : "AI_STOCK_LAB_PAPER_BUY_FILLED_PRICE_SEMANTIC_V1_V4_CALLER_STATIC_FAIL",

      target:
        "lib/trading/execute-paper-order.ts",

      checks,
      failed,

      safety: {
        sourceOnly:
          true,
        databaseReads:
          0,
        databaseWrites:
          0,
        externalApiCalls:
          0,
        ordersCreated:
          0,
        ordersExecuted:
          0,
        positionsChanged:
          0,
        realTradingEnabled:
          false,
      },

      nextGate:
        failed.length === 0
          ? "RUN_APP_TSC_AND_FINALIZE_BUY_FILLED_PRICE_SEMANTIC_V1"
          : "REPAIR_BUY_V4_CALLER_BINDING",
    },
    null,
    2
  )
);

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
