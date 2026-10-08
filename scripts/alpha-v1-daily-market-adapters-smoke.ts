import assert from "node:assert/strict";

import {
  buildDailyPriceVolumeEvidence,
  buildV7MarketRegimeEvidence,
  type DailyAlphaBarLike,
} from "../lib/alpha/daily-market-adapters";

const decisionAt =
  "2026-10-06T06:30:00.000Z";

const bars:
  DailyAlphaBarLike[] =
  [];

const start =
  new Date(
    "2026-06-01T00:00:00.000Z",
  );

let generated = 0;
let cursor =
  new Date(start);

while (
  generated <
  85
) {
  const day =
    cursor.getUTCDay();

  if (
    day !== 0 &&
    day !== 6
  ) {
    const base =
      100000 +
      generated *
        700;

    bars.push({
      stock_code:
        "005930",

      trading_date:
        cursor
          .toISOString()
          .slice(
            0,
            10,
          ),

      open_price:
        base - 300,

      high_price:
        base + 700,

      low_price:
        base - 800,

      close_price:
        base,

      volume:
        1000000 +
        Math.max(
          0,
          generated - 60,
        ) *
          35000,

      trading_value:
        base *
        1000000,

      adjusted_price:
        true,

      source:
        "KIS_DAILY_V8_3",
    });

    generated += 1;
  }

  cursor.setUTCDate(
    cursor.getUTCDate() +
    1,
  );
}

const v7Features = {
  latestMarketDate:
    bars.at(-1)!
      .trading_date,

  breadth: {
    breadth20:
      0.68,

    breadth60:
      0.62,
  },

  kospi: {
    return20:
      0.045,

    return60:
      0.09,

    realizedVolatility20:
      0.16,

    drawdown60:
      -0.06,
  },

  kosdaq: {
    return20:
      0.02,

    return60:
      0.04,

    realizedVolatility20:
      0.20,

    drawdown60:
      -0.09,
  },

  dataSource: {
    index:
      "market_index_daily_bars",

    breadth:
      "market_daily_bars",

    activeStockCount:
      5,

    historyStartDate:
      "2026-05-01",
  },
};

const policy = {
  version:
    "MARKET_REGIME_POLICY_V7_1",

  policy:
    "BLOCK_BREADTH_OR_HIGH_VOL",

  blocked:
    false,

  inputsComplete:
    true,

  reasons:
    [],
};

const regime =
  buildV7MarketRegimeEvidence({
    decisionAt,
    features:
      v7Features,
    policy,
  });

assert(
  regime,
  "V7 regime evidence missing",
);

assert.equal(
  regime.source,
  "MARKET_REGIME_V7_DAILY_BARS",
);

assert(
  regime.score >
    0.5,
  "bullish V7 fixture should score above neutral",
);

const priceVolume =
  buildDailyPriceVolumeEvidence({
    stockCode:
      "005930",

    market:
      "KOSPI",

    decisionAt,

    rows:
      bars,

    v7Features,
  });

assert(
  priceVolume,
  "daily price-volume evidence missing",
);

assert.equal(
  priceVolume.source,
  "MARKET_DAILY_BARS_ALPHA_PRICE_VOLUME",
);

assert(
  Number(
    priceVolume.metadata
      ?.usableBars,
  ) >=
    61,
);

assert(
  Number(
    priceVolume.metadata
      ?.relativeStrength20,
  ) >
    0,
  "rising stock should outperform benchmark in fixture",
);

assert(
  priceVolume.score >
    0.55,
  "positive multi-day fixture should score above neutral",
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V1_DAILY_MARKET_ADAPTERS_SMOKE_PASS",

      marketRegime: {
        score:
          regime.score,

        confidence:
          regime.confidence,

        source:
          regime.source,

        metadata:
          regime.metadata,
      },

      priceVolume: {
        score:
          priceVolume.score,

        confidence:
          priceVolume.confidence,

        source:
          priceVolume.source,

        metadata:
          priceVolume.metadata,
      },

      separation: {
        alpha:
          "MARKET_DAILY_BARS_MULTI_DAY",

        marketRegime:
          "EXISTING_V7_DAILY_BAR_ENGINE",

        entryTiming:
          "MARKET_SNAPSHOTS_INTRADAY_UNCHANGED",
      },

      safety: {
        databaseReads:
          0,

        databaseWrites:
          0,

        networkRequests:
          0,

        ordersCreated:
          0,
      },

      nextGate:
        "ALPHA_V1_REAL_DAILY_ALPHA_RUNNER",
    },
    null,
    2,
  ),
);
