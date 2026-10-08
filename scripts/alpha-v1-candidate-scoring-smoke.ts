import assert from "node:assert/strict";

import {
  ALPHA_CANDIDATE_SCORER_VERSION,
  rankAlphaCandidates,
  type AlphaCandidateInput,
} from "../lib/alpha/candidate-scoring";

const decisionAt =
  "2026-10-06T06:00:00.000Z";

function evidence(
  score: number,
  confidence: number,
  availableAt: string,
  source: string,
  maxAgeMinutes = 1_440,
) {
  return {
    score,
    confidence,
    availableAt,
    source,
    sourceVersion: "smoke-v1",
    maxAgeMinutes,
  };
}

const inputs: AlphaCandidateInput[] = [
  {
    stockCode: "000660",
    decisionAt,
    modelVersion:
      "alpha-rule-v1",

    features: {
      catalyst:
        evidence(
          0.84,
          0.90,
          "2026-10-06T05:20:00.000Z",
          "DISCLOSURE_NEWS",
          720,
        ),

      flow:
        evidence(
          0.78,
          0.88,
          "2026-10-06T05:55:00.000Z",
          "SUPPLY_DEMAND",
          60,
        ),

      marketRegime:
        evidence(
          0.60,
          0.95,
          "2026-10-06T05:50:00.000Z",
          "MARKET_REGIME",
          60,
        ),

      priceVolume:
        evidence(
          0.80,
          0.90,
          "2026-10-06T05:55:00.000Z",
          "DAILY_PRICE_VOLUME",
          120,
        ),

      liquidity:
        evidence(
          0.92,
          0.98,
          "2026-10-06T05:55:00.000Z",
          "LIQUIDITY",
          120,
        ),

      eventPersistence:
        evidence(
          0.72,
          0.85,
          "2026-10-06T05:20:00.000Z",
          "EVENT_PERSISTENCE",
          720,
        ),

      riskPenalty:
        evidence(
          0.28,
          0.90,
          "2026-10-06T05:55:00.000Z",
          "RISK_FEATURES",
          120,
        ),
    },
  },

  {
    stockCode: "005930",
    decisionAt,
    modelVersion:
      "alpha-rule-v1",

    features: {
      catalyst:
        evidence(
          0.58,
          0.85,
          "2026-10-06T05:15:00.000Z",
          "DISCLOSURE_NEWS",
        ),

      flow:
        evidence(
          0.56,
          0.82,
          "2026-10-06T05:50:00.000Z",
          "SUPPLY_DEMAND",
        ),

      marketRegime:
        evidence(
          0.60,
          0.95,
          "2026-10-06T05:50:00.000Z",
          "MARKET_REGIME",
        ),

      priceVolume:
        evidence(
          0.59,
          0.88,
          "2026-10-06T05:55:00.000Z",
          "DAILY_PRICE_VOLUME",
        ),

      liquidity:
        evidence(
          0.98,
          0.99,
          "2026-10-06T05:55:00.000Z",
          "LIQUIDITY",
        ),

      eventPersistence:
        evidence(
          0.52,
          0.75,
          "2026-10-06T05:15:00.000Z",
          "EVENT_PERSISTENCE",
        ),

      riskPenalty:
        evidence(
          0.35,
          0.90,
          "2026-10-06T05:55:00.000Z",
          "RISK_FEATURES",
        ),
    },
  },

  {
    stockCode: "035420",
    decisionAt,
    modelVersion:
      "alpha-rule-v1",

    features: {
      /**
       * Deliberate future feature:
       * must trigger LOOKAHEAD_FEATURES.
       */
      catalyst:
        evidence(
          0.95,
          0.99,
          "2026-10-06T06:05:00.000Z",
          "FUTURE_DISCLOSURE",
        ),

      flow:
        evidence(
          0.85,
          0.90,
          "2026-10-06T05:55:00.000Z",
          "SUPPLY_DEMAND",
        ),

      marketRegime:
        evidence(
          0.60,
          0.95,
          "2026-10-06T05:50:00.000Z",
          "MARKET_REGIME",
        ),

      priceVolume:
        evidence(
          0.85,
          0.92,
          "2026-10-06T05:55:00.000Z",
          "DAILY_PRICE_VOLUME",
        ),

      liquidity:
        evidence(
          0.90,
          0.95,
          "2026-10-06T05:55:00.000Z",
          "LIQUIDITY",
        ),

      eventPersistence:
        evidence(
          0.80,
          0.90,
          "2026-10-06T05:30:00.000Z",
          "EVENT_PERSISTENCE",
        ),

      riskPenalty:
        evidence(
          0.25,
          0.90,
          "2026-10-06T05:55:00.000Z",
          "RISK_FEATURES",
        ),
    },
  },
];

const stable =
  rankAlphaCandidates(
    inputs,
    "STABLE",
  );

const aggressive =
  rankAlphaCandidates(
    inputs,
    "AGGRESSIVE",
  );

const stable660 =
  stable.find(
    (row) =>
      row.stockCode === "000660",
  );

const stable930 =
  stable.find(
    (row) =>
      row.stockCode === "005930",
  );

const lookahead =
  stable.find(
    (row) =>
      row.stockCode === "035420",
  );

assert(stable660);
assert(stable930);
assert(lookahead);

assert.equal(
  stable660.scorerVersion,
  ALPHA_CANDIDATE_SCORER_VERSION,
);

assert.equal(
  stable660.eligibleForEntryTiming,
  true,
  "000660 should qualify for STABLE in the smoke contract",
);

assert.equal(
  stable930.eligibleForEntryTiming,
  false,
  "005930 should remain below the STABLE threshold",
);

assert.equal(
  lookahead.eligibleForEntryTiming,
  false,
  "look-ahead candidate must never be eligible",
);

assert(
  lookahead.blockingIssues.some(
    (issue) =>
      issue.startsWith(
        "LOOKAHEAD_FEATURES:",
      ),
  ),
  "look-ahead violation was not detected",
);

assert.equal(
  stable[0]?.stockCode,
  "000660",
  "expected 000660 to rank first in STABLE smoke data",
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V1_CANDIDATE_SCORING_SMOKE_PASS",

      scorerVersion:
        ALPHA_CANDIDATE_SCORER_VERSION,

      stable:
        stable.map((row) => ({
          rank: row.rank,
          stockCode:
            row.stockCode,
          score:
            row.score,
          coverage:
            row.coverage,
          quality:
            row.quality,
          riskPenalty:
            row.riskPenalty,
          eligibleForEntryTiming:
            row.eligibleForEntryTiming,
          blockingIssues:
            row.blockingIssues,
        })),

      aggressive:
        aggressive.map((row) => ({
          rank: row.rank,
          stockCode:
            row.stockCode,
          score:
            row.score,
          eligibleForEntryTiming:
            row.eligibleForEntryTiming,
        })),

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        networkRequests: 0,
        ordersCreated: 0,
      },

      nextGate:
        "ALPHA_V1_REAL_FEATURE_ADAPTERS",
    },
    null,
    2,
  ),
);
