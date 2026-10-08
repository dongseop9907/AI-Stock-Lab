import fs from "node:fs";
import path from "node:path";

import {
  DEFAULT_RISK_POLICY,
} from "../lib/trading/policy";

const VERSION =
  "ALPHA_V3_AGGREGATE_OPEN_RISK_BUDGET_DESIGN_V1";

const OUTPUT_FILE =
  path.resolve(
    process.cwd(),
    "logs/alpha-v3-aggregate-open-risk-budget-design.json",
  );

const CANDIDATE_BUDGETS = [
  0.015,
  0.02,
  0.025,
] as const;

const STOP_SCENARIOS = [
  {
    id: "ENTRY_BASELINE_STOP_2P5",
    stopDistanceRate: 0.025,
  },
  {
    id: "FIXED_STOP_4PCT",
    stopDistanceRate: 0.04,
  },
  {
    id: "TREND_FOLLOW_STOP_5PCT",
    stopDistanceRate: 0.05,
  },
] as const;

const EPSILON = 1e-12;

function round(
  value: number,
  digits = 8,
) {
  const factor =
    10 ** digits;

  return (
    Math.round(
      (value + Number.EPSILON) *
        factor,
    ) / factor
  );
}

function safeFloorRatio(
  numerator: number,
  denominator: number,
) {
  if (
    denominator <= 0
  ) {
    return 0;
  }

  return Math.floor(
    numerator /
      denominator +
      EPSILON,
  );
}

function main() {
  const policy =
    DEFAULT_RISK_POLICY;

  const scenarios =
    CANDIDATE_BUDGETS.map(
      (budget) => {
        const byStop =
          STOP_SCENARIOS.map(
            (stop) => {
              const rawRiskBasedPositionRate =
                policy.maxRiskPerTradeRate /
                stop.stopDistanceRate;

              const effectivePositionRate =
                Math.min(
                  policy.maxPositionRate,
                  rawRiskBasedPositionRate,
                );

              const riskPerPosition =
                effectivePositionRate *
                stop.stopDistanceRate;

              const byPortfolioExposure =
                safeFloorRatio(
                  policy.maxPortfolioExposureRate,
                  effectivePositionRate,
                );

              const byAggregateRisk =
                safeFloorRatio(
                  budget,
                  riskPerPosition,
                );

              const effectiveMaxPositions =
                Math.min(
                  policy.maxOpenPositions,
                  byPortfolioExposure,
                  byAggregateRisk,
                );

              const aggregateRisk =
                effectiveMaxPositions *
                riskPerPosition;

              return {
                id:
                  stop.id,

                stopDistanceRate:
                  stop.stopDistanceRate,

                effectivePositionRate:
                  round(
                    effectivePositionRate,
                  ),

                riskPerPosition:
                  round(
                    riskPerPosition,
                  ),

                maxPositionsByPortfolioExposure:
                  byPortfolioExposure,

                maxPositionsByAggregateOpenRisk:
                  byAggregateRisk,

                effectiveMaxPositions,

                aggregateOpenRiskAtCapacity:
                  round(
                    aggregateRisk,
                  ),

                remainingRiskBudget:
                  round(
                    budget -
                      aggregateRisk,
                  ),

                portfolioExposureAtCapacity:
                  round(
                    effectiveMaxPositions *
                      effectivePositionRate,
                  ),

                oneAdditionalFullRiskTradeAllowed:
                  aggregateRisk +
                    riskPerPosition <=
                  budget +
                    EPSILON,
              };
            },
          );

        const trend =
          byStop.find(
            (row) =>
              row.id ===
              "TREND_FOLLOW_STOP_5PCT",
          );

        return {
          budgetRate:
            budget,

          asPercent:
            round(
              budget *
                100,
              3,
            ),

          byStop,

          trendFollowCapacity:
            trend
              ?.effectiveMaxPositions ??
            null,

          trendFollowExposureAtCapacity:
            trend
              ?.portfolioExposureAtCapacity ??
            null,

          trendFollowAggregateRiskAtCapacity:
            trend
              ?.aggregateOpenRiskAtCapacity ??
            null,

          gapStress: {
            at1_5xStopLoss:
              trend
                ? round(
                    (
                      trend
                        .aggregateOpenRiskAtCapacity ??
                      0
                    ) *
                      1.5,
                  )
                : null,

            at2xStopLoss:
              trend
                ? round(
                    (
                      trend
                        .aggregateOpenRiskAtCapacity ??
                      0
                    ) *
                      2,
                  )
                : null,
          },
        };
      },
    );

  /*
   * 정책 선정 원칙:
   * - 1.5%는 현재 2.5% 손절 6종목의 정상 aggregate risk와 동일
   * - 2.0%는 일일 손실 한도와 동일
   * - 2.5%는 완화안이지만 일일 손실 한도보다 큼
   *
   * 보수적으로 production 후보는 2.0% 이하만 허용한다.
   */
  const eligible =
    scenarios.filter(
      (row) =>
        row.budgetRate <=
        policy.maxDailyLossRate +
          EPSILON,
    );

  /*
   * 5% stop에서 최소 4개 포지션을 허용하면서
   * 일일손실 한도를 넘지 않는 가장 큰 예산을 선택.
   */
  const candidates =
    eligible.filter(
      (row) =>
        (
          row.trendFollowCapacity ??
          0
        ) >=
        4,
    );

  const selected =
    [...candidates].sort(
      (a, b) =>
        b.budgetRate -
        a.budgetRate,
    )[0] ??
    null;

  const result = {
    status:
      "ALPHA_V3_AGGREGATE_OPEN_RISK_BUDGET_DESIGN_COMPLETE",

    version:
      VERSION,

    currentRiskPolicy: {
      maxRiskPerTradeRate:
        policy.maxRiskPerTradeRate,

      maxPositionRate:
        policy.maxPositionRate,

      maxPortfolioExposureRate:
        policy.maxPortfolioExposureRate,

      maxSectorExposureRate:
        policy.maxSectorExposureRate,

      maxOpenPositions:
        policy.maxOpenPositions,

      maxDailyLossRate:
        policy.maxDailyLossRate,
    },

    candidateBudgets:
      scenarios,

    decision: {
      selectedMaxAggregateOpenRiskRate:
        selected
          ?.budgetRate ??
        null,

      selectedPercent:
        selected
          ? round(
              selected
                .budgetRate *
                100,
              3,
            )
          : null,

      selectionRule:
        "Choose the largest candidate not above maxDailyLossRate that still permits at least four simultaneous 5%-stop positions.",

      rationale:
        selected
          ? "2.0% preserves four full-risk Trend Follow positions while preventing six simultaneous 0.5%-risk positions from creating 3.0% normal stop risk."
          : "No candidate satisfied the predeclared capacity and daily-loss constraints.",

      productionChanged:
        false,

      exactPolicyApplied:
        false,
    },

    proposedContract:
      selected
        ? {
            field:
              "maxAggregateOpenRiskRate",

            value:
              selected
                .budgetRate,

            approvalRule:
              "currentAggregateOpenRiskAmount + proposedTradeRiskAmount <= accountEquity * maxAggregateOpenRiskRate",

            currentOpenRiskPerPosition:
              "max(0, averagePrice - stopPrice) * quantity",

            proposedTradeRisk:
              "max(0, entryPrice - proposedStopPrice) * requestedQuantity",

            stopUpdates:
              "Raising a stop reduces aggregate open risk; lowering a stop remains prohibited.",

            missingStopHandling:
              "Reject new risk approval if an open long position has no valid stop price.",

            dailyLossRelationship:
              "Aggregate open-risk budget is independent of realized daily-loss gating.",
          }
        : null,

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
      selected
        ? "PROBE_ALPHA_V3_AGGREGATE_OPEN_RISK_IMPLEMENTATION_SURFACE"
        : "REVIEW_ALPHA_V3_AGGREGATE_OPEN_RISK_BUDGET",

    outputFile:
      "logs/alpha-v3-aggregate-open-risk-budget-design.json",
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
    ) + "\n",
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
} catch (error) {
  console.error(
    JSON.stringify(
      {
        status:
          "ALPHA_V3_AGGREGATE_OPEN_RISK_BUDGET_DESIGN_FAILED",

        version:
          VERSION,

        message:
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

  process.exit(
    1,
  );
}
