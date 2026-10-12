import {
  DEFAULT_RISK_POLICY,
} from "../lib/trading/policy";

import {
  validateBuyRisk,
} from "../lib/trading/risk-manager";

import type {
  BuyRiskInput,
} from "../lib/trading/types";

const VERSION =
  "ALPHA_V3_AGGREGATE_OPEN_RISK_VERIFY_V4";

function makeInput(
  overrides: Partial<BuyRiskInput> = {},
): BuyRiskInput {
  return {
    stockCode: "005930",
    entryPrice: 100000,
    proposedStopPrice: 95000,
    requestedQuantity: 10,

    accountEquity: 10000000,
    availableCash: 10000000,

    currentInvestedAmount: 0,
    currentStockExposureAmount: 0,
    currentSectorExposureAmount: 0,

    currentAggregateOpenRiskAmount: 0,
    openPositionsMissingValidStopCount: 0,

    dailyRealizedPnl: 0,
    openPositionCount: 0,
    isNewPosition: true,

    tradingMode: "PAPER",
    modelStatus: "CANDIDATE",

    ...overrides,
  };
}

const exactlyAtLimit =
  validateBuyRisk(
    makeInput({
      currentAggregateOpenRiskAmount:
        150000,
      requestedQuantity:
        10,
    }),
  );

const aboveLimit =
  validateBuyRisk(
    makeInput({
      currentAggregateOpenRiskAmount:
        175000,
      requestedQuantity:
        10,
    }),
  );

const missingStop =
  validateBuyRisk(
    makeInput({
      requestedQuantity:
        1,
      openPositionsMissingValidStopCount:
        1,
    }),
  );

const quantityLimited =
  validateBuyRisk(
    makeInput({
      currentAggregateOpenRiskAmount:
        190000,
      requestedQuantity:
        10,
    }),
  );

function hasIssue(
  result:
    ReturnType<typeof validateBuyRisk>,
  code:
    string,
) {
  return result.issues.some(
    (issue) =>
      issue.code === code,
  );
}

const report = {
  status:
    "ALPHA_V3_AGGREGATE_OPEN_RISK_VERIFY_COMPLETE",

  version:
    VERSION,

  policy: {
    maxAggregateOpenRiskRate:
      DEFAULT_RISK_POLICY
        .maxAggregateOpenRiskRate,

    expected:
      0.02,
  },

  cases: {
    exactlyAtLimit: {
      approved:
        exactlyAtLimit.approved,

      maxAllowedQuantity:
        exactlyAtLimit
          .maxAllowedQuantity,

      issues:
        exactlyAtLimit.issues,
    },

    aboveLimit: {
      approved:
        aboveLimit.approved,

      maxAllowedQuantity:
        aboveLimit
          .maxAllowedQuantity,

      aggregateIssue:
        hasIssue(
          aboveLimit,
          "AGGREGATE_OPEN_RISK_LIMIT_EXCEEDED",
        ),

      issues:
        aboveLimit.issues,
    },

    missingStop: {
      approved:
        missingStop.approved,

      maxAllowedQuantity:
        missingStop
          .maxAllowedQuantity,

      missingStopIssue:
        hasIssue(
          missingStop,
          "OPEN_POSITION_STOP_MISSING",
        ),

      issues:
        missingStop.issues,
    },

    quantityLimited: {
      approved:
        quantityLimited.approved,

      maxAllowedQuantity:
        quantityLimited
          .maxAllowedQuantity,

      expectedMaxAllowedQuantity:
        2,
    },
  },

  checks: {
    policyIsTwoPercent:
      DEFAULT_RISK_POLICY
        .maxAggregateOpenRiskRate ===
      0.02,

    exactlyAtLimitAllowed:
      exactlyAtLimit.approved ===
      true,

    aboveLimitRejected:
      aboveLimit.approved ===
        false &&
      hasIssue(
        aboveLimit,
        "AGGREGATE_OPEN_RISK_LIMIT_EXCEEDED",
      ),

    missingStopRejected:
      missingStop.approved ===
        false &&
      hasIssue(
        missingStop,
        "OPEN_POSITION_STOP_MISSING",
      ),

    quantityLimitApplied:
      quantityLimited
        .maxAllowedQuantity ===
      2,
  },

  safety: {
    databaseReads:
      0,

    databaseWrites:
      0,

    kisRequests:
      0,

    ordersCreated:
      0,

    positionsChanged:
      0,
  },

  nextGate:
    "RUN_TYPESCRIPT_CHECK_AND_AGGREGATE_OPEN_RISK_INTEGRATION_TEST",
};

console.log(
  JSON.stringify(
    report,
    null,
    2,
  ),
);
