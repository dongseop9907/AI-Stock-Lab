import assert from "node:assert/strict";

import {
  buildEventPersistenceEvidence,
  buildRiskPenaltyEvidence,
} from "../lib/alpha/confirmed-source-adapters";

const decisionAt =
  "2026-10-06T06:00:00.000Z";

const event =
  buildEventPersistenceEvidence({
    stockCode:
      "000660",

    decisionAt,

    lookbackHours:
      72,

    predictions: [
      {
        stock_code:
          "000660",

        score:
          0.78,

        direction:
          "UP",

        confidence:
          0.84,

        is_candidate:
          true,

        generated_at:
          "2026-10-06T05:40:00.000Z",

        model_name:
          "DISCLOSURE_PRICE_RULE",

        model_version:
          "v1",
      },
      {
        stock_code:
          "000660",

        score:
          0.74,

        direction:
          "UP",

        confidence:
          0.80,

        generated_at:
          "2026-10-05T06:00:00.000Z",

        model_name:
          "DISCLOSURE_PRICE_RULE",

        model_version:
          "v1",
      },
      {
        stock_code:
          "000660",

        score:
          0.68,

        direction:
          "NEUTRAL",

        confidence:
          0.72,

        generated_at:
          "2026-10-04T06:00:00.000Z",

        model_name:
          "DISCLOSURE_PRICE_RULE",

        model_version:
          "v1",
      },

      /**
       * Deliberate future row:
       * must be filtered out before aggregation.
       */
      {
        stock_code:
          "000660",

        score:
          0.99,

        direction:
          "UP",

        confidence:
          0.99,

        generated_at:
          "2026-10-06T06:10:00.000Z",
      },
    ],
  });

assert(
  event,
  "event persistence evidence missing",
);

assert.equal(
  event.source,
  "AI_STOCK_PREDICTIONS_HISTORY",
);

assert(
  Number(
    event.metadata
      ?.usablePredictions,
  ) === 3,
  "future prediction leaked into event persistence",
);

assert(
  event.score > 0.5,
  "persistent positive predictions should score above neutral",
);

const approvedRisk =
  buildRiskPenaltyEvidence({
    decisionAt,

    result: {
      approved:
        true,

      issues:
        [],

      stopDistanceRate:
        0.03,

      requestedQuantity:
        1,

      maxAllowedQuantity:
        4,

      requestedPositionAmount:
        200000,

      maxPositionAmount:
        1000000,

      maxRiskAmount:
        50000,

      maxPortfolioAmount:
        6000000,

      maxSectorAmount:
        2500000,
    },
  });

const blockedRisk =
  buildRiskPenaltyEvidence({
    decisionAt,

    result: {
      approved:
        false,

      issues: [
        "STOP_NOT_BELOW_ENTRY",
        "POSITION_LIMIT_EXCEEDED",
      ],

      stopDistanceRate:
        -0.03,

      requestedQuantity:
        1,

      maxAllowedQuantity:
        0,

      requestedPositionAmount:
        1200000,

      maxPositionAmount:
        1000000,
    },
  });

assert(
  approvedRisk.score <
  0.5,
  "approved low-risk case should have low penalty",
);

assert(
  blockedRisk.score >=
  0.9,
  "blocked risk case should have very high penalty",
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V1_CONFIRMED_SOURCE_ADAPTERS_SMOKE_PASS",

      eventPersistence: {
        score:
          event.score,

        confidence:
          event.confidence,

        source:
          event.source,

        metadata:
          event.metadata,
      },

      approvedRisk: {
        penalty:
          approvedRisk.score,

        confidence:
          approvedRisk.confidence,

        metadata:
          approvedRisk.metadata,
      },

      blockedRisk: {
        penalty:
          blockedRisk.score,

        confidence:
          blockedRisk.confidence,

        metadata:
          blockedRisk.metadata,
      },

      flow: {
        status:
          "UNAVAILABLE",

        reason:
          "NO_CONFIRMED_FOREIGN_INSTITUTIONAL_FLOW_SOURCE_IN_REPO",
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
        "ALPHA_V1_REAL_RUNNER_DB_READ_ONLY",
    },
    null,
    2,
  ),
);
