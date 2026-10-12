import {
  buildPaperQuoteSnapshotFromKisOrderbook,
} from "../lib/trading/resolve-paper-execution-realism-v2-orderbook-quote";

import {
  evaluatePaperExecutionRealismV2,
} from "../lib/trading/paper-execution-realism-v2";

const observedAt =
  "2026-10-10T05:00:00.000Z";

const bestAsk =
  100100;

const bestBid =
  100000;

const quote =
  buildPaperQuoteSnapshotFromKisOrderbook(
    {
      askp1:
        String(bestAsk),

      bidp1:
        String(bestBid),

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

const buyPrice =
  buy.executionPrice;

const sellPrice =
  sell.executionPrice;

const checks = {
  quoteBuilt:
    quote !== null,

  bestAskParsed:
    quote?.bestAskPrice ===
    bestAsk,

  bestBidParsed:
    quote?.bestBidPrice ===
    bestBid,

  askQuantityParsed:
    quote?.bestAskQuantity ===
    20,

  bidQuantityParsed:
    quote?.bestBidQuantity ===
    30,

  buyUsesBestAskSource:
    buy.approved ===
      true &&
    buy.priceSource ===
      "BEST_ASK",

  sellUsesBestBidSource:
    sell.approved ===
      true &&
    sell.priceSource ===
      "BEST_BID",

  buyExecutionAtOrAboveBestAsk:
    typeof buyPrice ===
      "number" &&
    Number.isFinite(
      buyPrice,
    ) &&
    buyPrice >=
      bestAsk,

  sellExecutionAtOrBelowBestBid:
    typeof sellPrice ===
      "number" &&
    Number.isFinite(
      sellPrice,
    ) &&
    sellPrice <=
      bestBid,

  buyMarketImpactDirectionCorrect:
    buy.marketImpactBps >
      0
      ? (
          typeof buyPrice ===
            "number" &&
          buyPrice >
            bestAsk
        )
      : (
          buyPrice ===
          bestAsk
        ),

  sellMarketImpactDirectionCorrect:
    sell.marketImpactBps >
      0
      ? (
          typeof sellPrice ===
            "number" &&
          sellPrice <
            bestBid
        )
      : (
          sellPrice ===
          bestBid
        ),

  buyTopOfBookQuantityCap:
    buy.topOfBookQuantityCap ===
    20,

  sellTopOfBookQuantityCap:
    sell.topOfBookQuantityCap ===
    30,

  emptyOrderbookReturnsNull:
    empty ===
    null,

  noSyntheticSpreadWhenQuoteUsed:
    buy.syntheticSpreadBps ===
      0 &&
    sell.syntheticSpreadBps ===
      0,

  buyRealismStillAppliesImpact:
    buy.totalAdversePriceBps !==
      null &&
    buy.totalAdversePriceBps >=
      buy.marketImpactBps,

  sellRealismStillAppliesImpact:
    sell.totalAdversePriceBps !==
      null &&
    sell.totalAdversePriceBps >=
      sell.marketImpactBps,
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

      interpretation: {
        quotePriceRole:
          "BEST_ASK/BEST_BID is the executable top-of-book starting price.",

        marketImpactRole:
          "Execution realism may move BUY above best ask and SELL below best bid according to participation/impact.",

        exactQuoteEqualityRequired:
          false,

        syntheticSpreadUsedWithRealQuote:
          false,
      },

      samples: {
        quote,

        buy: {
          bestAsk,
          executionPrice:
            buy.executionPrice,
          priceSource:
            buy.priceSource,
          marketImpactBps:
            buy.marketImpactBps,
          totalAdversePriceBps:
            buy.totalAdversePriceBps,
          filledQuantity:
            buy.filledQuantity,
          topOfBookQuantityCap:
            buy.topOfBookQuantityCap,
          syntheticSpreadBps:
            buy.syntheticSpreadBps,
        },

        sell: {
          bestBid,
          executionPrice:
            sell.executionPrice,
          priceSource:
            sell.priceSource,
          marketImpactBps:
            sell.marketImpactBps,
          totalAdversePriceBps:
            sell.totalAdversePriceBps,
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
