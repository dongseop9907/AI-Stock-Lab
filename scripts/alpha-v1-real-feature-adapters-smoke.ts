import assert from "node:assert/strict";

import {
  rankAlphaCandidates,
} from "../lib/alpha/candidate-scoring";

import {
  buildAlphaCandidateInputFromRealSources,
  type DisclosurePredictionGate,
  type MarketRegimeShadow,
  type MarketSnapshotLike,
} from "../lib/alpha/feature-adapters";

const decisionAt =
  "2026-08-02T14:01:08.000Z";

const predictionGate:
  DisclosurePredictionGate = {
    available: true,
    fresh: true,
    predictionDate:
      "2026-08-02",
    generatedAt:
      "2026-08-02T14:01:07.590Z",
    modelName:
      "DISCLOSURE_PRICE_RULE",
    modelVersion:
      "v1",
    ageMinutes:
      0,
    maximumAgeMinutes:
      180,
    candidateCount:
      1,
    stockCodes: [
      "000660",
    ],
    candidates: [
      {
        stock_code:
          "000660",
        stock_name:
          "SK하이닉스",
        score:
          0.78,
        direction:
          "UP",
        confidence:
          0.84,
        is_candidate:
          true,
      },
    ],
    reason:
      "CANDIDATE_AVAILABLE",
  };

const marketRegime:
  MarketRegimeShadow = {
    mode:
      "SHADOW",
    appliedToOrders:
      false,
    regime:
      "BEAR",
    wouldBlockByRegime:
      true,
    breadth20:
      0.4,
    avgReturn20:
      -0.078025,
    sampleSize:
      5,
    returnSampleSize:
      5,
    stockCodes: [
      "000660",
      "005380",
      "005930",
      "035420",
      "035720",
    ],
    latestMarketDate:
      "2026-07-31",
    latestSnapshotObservedAt:
      "2026-07-31T06:30:00+00:00",
    observedAt:
      "2026-08-02T14:01:07.776Z",
    source:
      "ACTIVE_STOCK_PROXY_V1",
  };

const snapshots:
  MarketSnapshotLike[] = [
    {
      stock_code:
        "000660",
      observed_at:
        "2026-08-02T14:00:00.000Z",
      close_price:
        200000,
      open_price:
        196000,
      high_price:
        202000,
      low_price:
        194000,
      volume:
        1500000,
    },
    {
      stock_code:
        "000660",
      observed_at:
        "2026-08-02T13:50:00.000Z",
      close_price:
        197000,
      open_price:
        195000,
      high_price:
        198000,
      low_price:
        194000,
      volume:
        900000,
    },
    {
      stock_code:
        "000660",
      observed_at:
        "2026-08-02T13:40:00.000Z",
      close_price:
        196500,
      open_price:
        194500,
      high_price:
        197000,
      low_price:
        194000,
      volume:
        850000,
    },
    {
      stock_code:
        "000660",
      observed_at:
        "2026-08-02T13:30:00.000Z",
      close_price:
        196000,
      open_price:
        194000,
      high_price:
        196500,
      low_price:
        193500,
      volume:
        800000,
    },
    {
      stock_code:
        "000660",
      observed_at:
        "2026-08-02T13:20:00.000Z",
      close_price:
        195500,
      open_price:
        194000,
      high_price:
        196000,
      low_price:
        193000,
      volume:
        780000,
    },
    {
      stock_code:
        "000660",
      observed_at:
        "2026-08-02T13:10:00.000Z",
      close_price:
        195000,
      open_price:
        193500,
      high_price:
        195500,
      low_price:
        193000,
      volume:
        760000,
    },
  ];

const adapted =
  buildAlphaCandidateInputFromRealSources({
    stockCode:
      "000660",

    decisionAt,

    disclosurePredictionGate:
      predictionGate,

    marketRegimeShadow:
      marketRegime,

    marketSnapshots:
      snapshots,

    modelVersion:
      "alpha-v1-real-adapters",
  });

assert(
  adapted.features.catalyst,
  "catalyst adapter missing",
);

assert(
  adapted.features.marketRegime,
  "market regime adapter missing",
);

assert(
  adapted.features.priceVolume,
  "price-volume adapter missing",
);

assert(
  adapted.features.liquidity,
  "liquidity adapter missing",
);

assert.equal(
  adapted.features.flow,
  undefined,
);

assert.equal(
  adapted.features.eventPersistence,
  undefined,
);

const stable =
  rankAlphaCandidates(
    [adapted],
    "STABLE",
  )[0];

const aggressive =
  rankAlphaCandidates(
    [adapted],
    "AGGRESSIVE",
  )[0];

assert(stable);
assert(aggressive);

assert.equal(
  stable.metadata.lookaheadDimensions.length,
  0,
);

assert.equal(
  stable.metadata.missingDimensions.includes(
    "flow",
  ),
  true,
);

assert.equal(
  stable.metadata.missingDimensions.includes(
    "eventPersistence",
  ),
  true,
);

assert.equal(
  stable.eligibleForEntryTiming,
  false,
  "partial real adapters must not silently pass STABLE before flow/eventPersistence are wired",
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V1_REAL_FEATURE_ADAPTERS_SMOKE_PASS",

      sourceContract: {
        catalyst:
          "DISCLOSURE_PRICE_RULE predictionGate",

        marketRegime:
          "marketRegimeShadow / ACTIVE_STOCK_PROXY_V1",

        priceVolume:
          "market_snapshots",

        liquidity:
          "market_snapshots turnover proxy",

        flow:
          "NOT_WIRED_NO_GUESS",

        eventPersistence:
          "NOT_WIRED_NO_GUESS",

        riskPenalty:
          "NOT_WIRED_NO_GUESS",
      },

      adaptedFeaturePresence:
        adapted.metadata,

      stable: {
        score:
          stable.score,

        coverage:
          stable.coverage,

        quality:
          stable.quality,

        eligibleForEntryTiming:
          stable.eligibleForEntryTiming,

        blockingIssues:
          stable.blockingIssues,

        warnings:
          stable.warnings,
      },

      aggressive: {
        score:
          aggressive.score,

        coverage:
          aggressive.coverage,

        quality:
          aggressive.quality,

        eligibleForEntryTiming:
          aggressive.eligibleForEntryTiming,

        blockingIssues:
          aggressive.blockingIssues,
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
        "ALPHA_V1_SOURCE_LOCATOR_FLOW_EVENT_RISK",
    },
    null,
    2,
  ),
);
