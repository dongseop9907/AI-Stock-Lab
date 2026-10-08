import fs from "node:fs";
import path from "node:path";

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
  "ALPHA_V3_RISK_V3_POST_IMPLEMENTATION_STRESS_TEST_V2_PORTFOLIO_AWARE";

const OUTPUT_FILE =
  path.resolve(
    process.cwd(),
    "logs/alpha-v3-risk-v3-post-implementation-stress-test.json",
  );

const EQUITY =
  10_000_000;

const ENTRY_PRICE =
  100_000;

const SCENARIOS = [
  {
    id:
      "STOP_2P5",
    stopDistanceRate:
      0.025,
  },
  {
    id:
      "STOP_4P0",
    stopDistanceRate:
      0.04,
  },
  {
    id:
      "STOP_5P0",
    stopDistanceRate:
      0.05,
  },
] as const;

function round(
  value: number,
  digits = 8,
): number {
  const factor =
    10 ** digits;

  return (
    Math.round(
      (
        value +
        Number.EPSILON
      ) *
        factor,
    ) /
    factor
  );
}

function makeInput(
  overrides:
    Partial<BuyRiskInput> =
    {},
): BuyRiskInput {
  return {
    stockCode:
      "STRESS_TEST",

    entryPrice:
      ENTRY_PRICE,

    proposedStopPrice:
      ENTRY_PRICE *
      0.95,

    requestedQuantity:
      10,

    accountEquity:
      EQUITY,

    availableCash:
      EQUITY,

    currentInvestedAmount:
      0,

    currentStockExposureAmount:
      0,

    currentSectorExposureAmount:
      0,

    currentAggregateOpenRiskAmount:
      0,

    openPositionsMissingValidStopCount:
      0,

    dailyRealizedPnl:
      0,

    openPositionCount:
      0,

    isNewPosition:
      true,

    tradingMode:
      "PAPER",

    modelStatus:
      "CANDIDATE",

    ...overrides,
  };
}

function hasIssue(
  result:
    ReturnType<typeof validateBuyRisk>,
  code:
    string,
): boolean {
  return result.issues.some(
    (issue) =>
      issue.code === code,
  );
}

function main() {
  const aggregateRate =
    DEFAULT_RISK_POLICY
      .maxAggregateOpenRiskRate ??
    0.02;

  const maxAggregateAmount =
    EQUITY *
    aggregateRate;

  const rows =
    SCENARIOS.map(
      (
        scenario,
      ) => {
        const proposedStopPrice =
          ENTRY_PRICE *
          (
            1 -
            scenario.stopDistanceRate
          );

        const riskPerShare =
          ENTRY_PRICE -
          proposedStopPrice;

        const fullPositionAmount =
          EQUITY *
          DEFAULT_RISK_POLICY
            .maxPositionRate;

        const fullPositionQuantity =
          Math.floor(
            fullPositionAmount /
            ENTRY_PRICE,
          );

        const actualPositionAmount =
          fullPositionQuantity *
          ENTRY_PRICE;

        const riskPerFullPosition =
          riskPerShare *
          fullPositionQuantity;

        const riskRatePerFullPosition =
          riskPerFullPosition /
          EQUITY;

        const maxPositionsByAggregate =
          Math.floor(
            (
              maxAggregateAmount /
              riskPerFullPosition
            ) +
              1e-12,
          );

        const maxPositionsByPortfolio =
          Math.floor(
            (
              (
                EQUITY *
                DEFAULT_RISK_POLICY
                  .maxPortfolioExposureRate
              ) /
              actualPositionAmount
            ) +
              1e-12,
          );

        const maxPositionsByCount =
          DEFAULT_RISK_POLICY
            .maxOpenPositions;

        const expectedCapacity =
          Math.min(
            maxPositionsByAggregate,
            maxPositionsByPortfolio,
            maxPositionsByCount,
          );

        const sequential = [];

        let currentAggregate =
          0;

        let currentInvested =
          0;

        let availableCash =
          EQUITY;

        let openPositionCount =
          0;

        for (
          let i = 1;
          i <=
          Math.min(
            10,
            expectedCapacity +
              2,
          );
          i += 1
        ) {
          const result =
            validateBuyRisk(
              makeInput({
                stockCode:
                  "STRESS_" +
                  String(i),

                proposedStopPrice,

                requestedQuantity:
                  fullPositionQuantity,

                currentAggregateOpenRiskAmount:
                  currentAggregate,

                currentInvestedAmount:
                  currentInvested,

                availableCash,

                openPositionCount,

                /*
                 * 각 시도는 서로 다른 종목/업종이라고 가정.
                 * 따라서 개별 종목/업종 한도는 이 테스트에서
                 * aggregate/portfolio capacity를 방해하지 않는다.
                 */
                currentStockExposureAmount:
                  0,

                currentSectorExposureAmount:
                  0,

                isNewPosition:
                  true,
              }),
            );

          const row = {
            attempt:
              i,

            currentInvestedAmount:
              round(
                currentInvested,
              ),

            availableCash:
              round(
                availableCash,
              ),

            currentAggregateOpenRiskAmount:
              round(
                currentAggregate,
              ),

            requestedPositionAmount:
              round(
                actualPositionAmount,
              ),

            requestedRiskAmount:
              round(
                riskPerFullPosition,
              ),

            approved:
              result.approved,

            maxAllowedQuantity:
              result.maxAllowedQuantity,

            aggregateLimitIssue:
              hasIssue(
                result,
                "AGGREGATE_OPEN_RISK_LIMIT_EXCEEDED",
              ),

            portfolioLimitIssue:
              hasIssue(
                result,
                "PORTFOLIO_LIMIT_EXCEEDED",
              ),

            maxPositionsIssue:
              hasIssue(
                result,
                "MAX_POSITIONS_REACHED",
              ),

            issues:
              result.issues.map(
                (issue) =>
                  issue.code,
              ),
          };

          sequential.push(
            row,
          );

          if (
            result.approved
          ) {
            currentAggregate +=
              riskPerFullPosition;

            currentInvested +=
              actualPositionAmount;

            availableCash =
              Math.max(
                0,
                EQUITY -
                currentInvested,
              );

            openPositionCount +=
              1;
          }
        }

        const approvedCount =
          sequential.filter(
            (row) =>
              row.approved,
          ).length;

        const firstRejected =
          sequential.find(
            (row) =>
              !row.approved,
          ) ??
          null;

        return {
          id:
            scenario.id,

          stopDistanceRate:
            scenario.stopDistanceRate,

          fullPositionQuantity,

          fullPositionAmount:
            round(
              actualPositionAmount,
            ),

          riskPerFullPosition:
            round(
              riskPerFullPosition,
            ),

          riskRatePerFullPosition:
            round(
              riskRatePerFullPosition,
            ),

          maxPositionsByAggregate,

          maxPositionsByPortfolio,

          maxPositionsByCount,

          expectedCapacity,

          observedApprovedCapacity:
            approvedCount,

          capacityMatchesExpected:
            approvedCount ===
            expectedCapacity,

          firstRejected,

          sequential,
        };
      },
    );

  const baseline =
    rows.find(
      (row) =>
        row.id ===
        "STOP_2P5",
    );

  const fixed =
    rows.find(
      (row) =>
        row.id ===
        "STOP_4P0",
    );

  const trend =
    rows.find(
      (row) =>
        row.id ===
        "STOP_5P0",
    );

  const exactLimitCase =
    validateBuyRisk(
      makeInput({
        currentAggregateOpenRiskAmount:
          150_000,

        requestedQuantity:
          10,
      }),
    );

  const overLimitCase =
    validateBuyRisk(
      makeInput({
        currentAggregateOpenRiskAmount:
          175_000,

        requestedQuantity:
          10,
      }),
    );

  const missingStopCase =
    validateBuyRisk(
      makeInput({
        requestedQuantity:
          1,

        openPositionsMissingValidStopCount:
          1,
      }),
    );

  const checks = {
    aggregatePolicyIsTwoPercent:
      Math.abs(
        aggregateRate -
          0.02,
      ) <
      1e-12,

    baselineStopAllowsSixFullPositions:
      baseline
        ?.observedApprovedCapacity ===
      6,

    baselineSeventhRejectedByPortfolio:
      Boolean(
        baseline
          ?.firstRejected
          ?.portfolioLimitIssue,
      ),

    fixedStopAllowsFiveFullPositions:
      fixed
        ?.observedApprovedCapacity ===
      5,

    fixedSixthRejectedByAggregateRisk:
      Boolean(
        fixed
          ?.firstRejected
          ?.aggregateLimitIssue,
      ),

    trendFollowAllowsFourFullPositions:
      trend
        ?.observedApprovedCapacity ===
      4,

    trendFollowFifthRejectedByAggregateRisk:
      Boolean(
        trend
          ?.firstRejected
          ?.aggregateLimitIssue,
      ),

    allScenarioCapacityMatchesExpected:
      rows.every(
        (row) =>
          row
            .capacityMatchesExpected,
      ),

    exactAggregateLimitAllowed:
      exactLimitCase.approved ===
      true,

    overAggregateLimitRejected:
      overLimitCase.approved ===
        false &&
      hasIssue(
        overLimitCase,
        "AGGREGATE_OPEN_RISK_LIMIT_EXCEEDED",
      ),

    missingStopFailsClosed:
      missingStopCase.approved ===
        false &&
      hasIssue(
        missingStopCase,
        "OPEN_POSITION_STOP_MISSING",
      ),
  };

  const allPassed =
    Object.values(
      checks,
    ).every(Boolean);

  const result = {
    status:
      "ALPHA_V3_RISK_V3_POST_IMPLEMENTATION_STRESS_TEST_COMPLETE",

    version:
      VERSION,

    policy: {
      maxRiskPerTradeRate:
        DEFAULT_RISK_POLICY
          .maxRiskPerTradeRate,

      maxPositionRate:
        DEFAULT_RISK_POLICY
          .maxPositionRate,

      maxPortfolioExposureRate:
        DEFAULT_RISK_POLICY
          .maxPortfolioExposureRate,

      maxSectorExposureRate:
        DEFAULT_RISK_POLICY
          .maxSectorExposureRate,

      maxOpenPositions:
        DEFAULT_RISK_POLICY
          .maxOpenPositions,

      maxDailyLossRate:
        DEFAULT_RISK_POLICY
          .maxDailyLossRate,

      maxAggregateOpenRiskRate:
        aggregateRate,
    },

    scenarioResults:
      rows,

    boundaryCases: {
      exactLimit: {
        approved:
          exactLimitCase.approved,

        maxAllowedQuantity:
          exactLimitCase
            .maxAllowedQuantity,

        issues:
          exactLimitCase.issues,
      },

      overLimit: {
        approved:
          overLimitCase.approved,

        maxAllowedQuantity:
          overLimitCase
            .maxAllowedQuantity,

        issues:
          overLimitCase.issues,
      },

      missingStop: {
        approved:
          missingStopCase.approved,

        maxAllowedQuantity:
          missingStopCase
            .maxAllowedQuantity,

        issues:
          missingStopCase.issues,
      },
    },

    checks,

    decision: {
      allPassed,

      riskV3AggregateOpenRiskImplemented:
        allPassed,

      productionRiskPolicyReadyForShadow:
        allPassed,

      productionChangedByTest:
        false,

      nextUse:
        allPassed
          ? "BUILD_ALPHA_V3_RISK_V3_SHADOW_OBSERVABILITY"
          : "REVIEW_ALPHA_V3_RISK_V3_AGGREGATE_OPEN_RISK_FAILURE",
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

      productionChanged:
        false,
    },

    nextGate:
      allPassed
        ? "BUILD_ALPHA_V3_RISK_V3_SHADOW_OBSERVABILITY"
        : "REVIEW_ALPHA_V3_RISK_V3_AGGREGATE_OPEN_RISK_FAILURE",

    outputFile:
      "logs/alpha-v3-risk-v3-post-implementation-stress-test.json",
  };

  fs.mkdirSync(
    path.dirname(
      OUTPUT_FILE,
    ),
    {
      recursive:
        true,
    },
  );

  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify(
      result,
      null,
      2,
    ) +
      "\n",
    "utf8",
  );

  console.log(
    JSON.stringify(
      result,
      null,
      2,
    ),
  );
}

try {
  main();
} catch (
  error
) {
  console.error(
    JSON.stringify(
      {
        status:
          "ALPHA_V3_RISK_V3_POST_IMPLEMENTATION_STRESS_TEST_FAILED",

        version:
          VERSION,

        error:
          error instanceof Error
            ? error.message
            : String(
                error,
              ),

        safety: {
          databaseWrites:
            0,

          ordersCreated:
            0,

          productionChanged:
            false,
        },
      },
      null,
      2,
    ),
  );

  process.exitCode =
    1;
}
