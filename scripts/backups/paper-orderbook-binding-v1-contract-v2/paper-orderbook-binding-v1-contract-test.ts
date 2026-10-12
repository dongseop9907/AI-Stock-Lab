import {
  buildPaperQuoteSnapshotFromKisOrderbook,
} from "../lib/trading/resolve-paper-execution-realism-v2-orderbook-quote";

import {
  evaluatePaperExecutionRealismV2,
} from "../lib/trading/paper-execution-realism-v2";

const observedAt =
  "2026-10-10T05:00:00.000Z";

const quote =
  buildPaperQuoteSnapshotFromKisOrderbook(
    {
      askp1:
        "100100",
      bidp1:
        "100000",
      askp_rsqn1:
        "20",
      bidp_rsqn1:
        "30",
    },
    observedAt,
  );

const buy =
  evaluatePaperExecutionRealismV2({
    side:
      "BUY",
    requestedQuantity:
      10,
    referencePrice:
      100050,
    now:
      observedAt,
    quote,
    intervalVolume:
      1000,
  });

const sell =
  evaluatePaperExecutionRealismV2({
    side:
      "SELL",
    requestedQuantity:
      10,
    referencePrice:
      100050,
    now:
      observedAt,
    quote,
    intervalVolume:
      1000,
  });

const empty =
  buildPaperQuoteSnapshotFromKisOrderbook(
    {},
    observedAt,
  );

const checks = {
  quoteBuilt:
    quote !== null,

  bestAskParsed:
    quote?.bestAskPrice ===
    100100,

  bestBidParsed:
    quote?.bestBidPrice ===
    100000,

  askQuantityParsed:
    quote?.bestAskQuantity ===
    20,

  bidQuantityParsed:
    quote?.bestBidQuantity ===
    30,

  buyUsesBestAsk:
    buy.approved ===
      true &&
    buy.executionPrice ===
      100100 &&
    buy.priceSource ===
      "BEST_ASK",

  sellUsesBestBid:
    sell.approved ===
      true &&
    sell.executionPrice ===
      100000 &&
    sell.priceSource ===
      "BEST_BID",

  emptyOrderbookReturnsNull:
    empty ===
    null,

  noSyntheticSpreadWhenQuoteUsed:
    buy.syntheticSpreadBps ===
      0 &&
    sell.syntheticSpreadBps ===
      0,
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
        failed.length ===
          0
          ? "AI_STOCK_LAB_PAPER_ORDERBOOK_BINDING_V1_CONTRACT_PASS"
          : "AI_STOCK_LAB_PAPER_ORDERBOOK_BINDING_V1_CONTRACT_FAIL",

      checks,

      samples: {
        quote,
        buy: {
          executionPrice:
            buy.executionPrice,
          priceSource:
            buy.priceSource,
          filledQuantity:
            buy.filledQuantity,
          topOfBookQuantityCap:
            buy.topOfBookQuantityCap,
          syntheticSpreadBps:
            buy.syntheticSpreadBps,
        },
        sell: {
          executionPrice:
            sell.executionPrice,
          priceSource:
            sell.priceSource,
          filledQuantity:
            sell.filledQuantity,
          topOfBookQuantityCap:
            sell.topOfBookQuantityCap,
          syntheticSpreadBps:
            sell.syntheticSpreadBps,
        },
      },

      safety: {
        externalApiCalls:
          0,
        databaseReads:
          0,
        databaseWrites:
          0,
        ordersCreated:
          0,
        positionsChanged:
          0,
        realTradingEnabled:
          false,
      },

      failed,
    },
    null,
    2,
  ),
);

process.exitCode =
  failed.length ===
    0
    ? 0
    : 1;
