const fs = require("fs");
const path = require("path");

const ROOT =
  process.cwd();

const TARGET =
  path.join(
    ROOT,
    "lib",
    "trading",
    "execute-paper-order.ts"
  );

const text =
  fs.readFileSync(
    TARGET,
    "utf8"
  );

const v3Index =
  text.indexOf(
    '"execute_paper_buy_order_with_execution_price_v3"'
  );

const provenanceIndex =
  text.indexOf(
    "p_execution_provenance:"
  );

const priceSourceIndex =
  text.indexOf(
    "p_execution_price_source:"
  );

const rpcResultIndex =
  text.indexOf(
    "if (\n    error"
  );

const checks = {
  v3RpcBound:
    v3Index >= 0,

  v2RpcNoLongerCalled:
    !text.includes(
      '"execute_paper_buy_order_with_execution_price_v2"'
    ),

  priceSourcePassed:
    priceSourceIndex >= 0 &&
    text.includes(
      "realismDecision.priceSource"
    ),

  provenancePassedBeforeRpcCompletion:
    provenanceIndex >= 0 &&
    rpcResultIndex >= 0 &&
    provenanceIndex <
      rpcResultIndex,

  provenanceVersion:
    text.includes(
      "PAPER_ORDERBOOK_EXECUTION_PROVENANCE_V1"
    ),

  bestQuoteEvidenceIncluded:
    text.includes(
      "orderbookQuote.quote"
    ),

  orderbookSourceIncluded:
    text.includes(
      "orderbookQuote.source"
    ),

  serverAgeIncluded:
    text.includes(
      "orderbookQuote.serverQuoteAgeMs"
    ),

  sessionIncluded:
    text.includes(
      "orderbookQuote.session"
    ),

  marketImpactIncluded:
    text.includes(
      "realismDecision.marketImpactBps"
    ),

  syntheticSpreadIncluded:
    text.includes(
      "realismDecision.syntheticSpreadBps"
    ),

  topOfBookCapIncluded:
    text.includes(
      "realismDecision.topOfBookQuantityCap"
    ),

  intervalVolumeIncluded:
    text.includes(
      "realismMarketInput.intervalVolume"
    ),

  noRealTradingEnable:
    !/REAL_TRADING_ENABLED\s*=\s*true|ENABLE_REAL_TRADING\s*=\s*true|ENABLE_LIVE_TRADING\s*=\s*true/.test(
      text
    ),
};

const failed =
  Object.entries(checks)
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
          ? "AI_STOCK_LAB_PAPER_ORDERBOOK_EXECUTION_PROVENANCE_V1_CALLER_BINDING_STATIC_PASS"
          : "AI_STOCK_LAB_PAPER_ORDERBOOK_EXECUTION_PROVENANCE_V1_CALLER_BINDING_STATIC_FAIL",

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
          ? "APP_TSC_THEN_READ_ONLY_RPC_EXISTENCE_PROBE"
          : "REPAIR_CALLER_BINDING",
    },
    null,
    2
  )
);

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
