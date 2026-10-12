import fs from "node:fs";
import path from "node:path";

const ROOT =
  process.cwd();

const source =
  fs.readFileSync(
    path.join(
      ROOT,
      "lib",
      "trading",
      "execute-paper-order.ts",
    ),
    "utf8",
  );

const checks = {
  v3Only:
    source.includes(
      '"execute_paper_buy_order_with_execution_price_v3"',
    ) &&
    !source.includes(
      '"execute_paper_buy_order_with_execution_price_v2"',
    ),

  actualDecisionSource:
    source.includes(
      "p_execution_price_source:",
    ) &&
    source.includes(
      "realismDecision.priceSource",
    ),

  payloadObject:
    source.includes(
      "p_execution_provenance:",
    ),

  includesOrderbook:
    [
      "orderbookQuote.source",
      "orderbookQuote.quote",
      "orderbookQuote.session",
      "orderbookQuote.serverAcceptedHour",
      "orderbookQuote.serverQuoteAgeMs",
    ].every(
      token =>
        source.includes(
          token,
        ),
    ),

  includesRealism:
    [
      "realismDecision.executionPrice",
      "realismDecision.filledQuantity",
      "realismDecision.brokerFee",
      "realismDecision.syntheticSpreadBps",
      "realismDecision.marketImpactBps",
      "realismDecision.totalAdversePriceBps",
      "realismDecision.topOfBookQuantityCap",
    ].every(
      token =>
        source.includes(
          token,
        ),
    ),

  includesLiquidityContext:
    source.includes(
      "realismMarketInput.intervalVolume",
    ),

  noNewTradeDecision:
    source.includes(
      "evaluatePaperExecutionRealismV2({",
    ),

  noRealTradingEnable:
    !/REAL_TRADING_ENABLED\s*=\s*true|ENABLE_REAL_TRADING\s*=\s*true|ENABLE_LIVE_TRADING\s*=\s*true/.test(
      source,
    ),
};

const failed =
  Object.entries(
    checks,
  )
    .filter(
      ([, ok]) =>
        ok !== true,
    )
    .map(
      ([name]) =>
        name,
    );

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "AI_STOCK_LAB_PAPER_ORDERBOOK_EXECUTION_PROVENANCE_V1_CALLER_BINDING_CONTRACT_PASS"
          : "AI_STOCK_LAB_PAPER_ORDERBOOK_EXECUTION_PROVENANCE_V1_CALLER_BINDING_CONTRACT_FAIL",

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
    },
    null,
    2,
  ),
);

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
