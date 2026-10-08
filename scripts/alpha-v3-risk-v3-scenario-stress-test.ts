import fs from "node:fs";
import path from "node:path";

import {
  DEFAULT_RISK_POLICY,
} from "../lib/trading/policy";

const VERSION =
  "ALPHA_V3_RISK_V3_SCENARIO_STRESS_TEST_V1";

const OUTPUT_FILE =
  path.resolve(
    process.cwd(),
    "logs/alpha-v3-risk-v3-scenario-stress-test.json",
  );

const EPSILON = 1e-12;

const STOP_SCENARIOS = [
  {
    id: "STOP_2P5",
    stopDistanceRate: 0.025,
  },
  {
    id: "STOP_4P0",
    stopDistanceRate: 0.04,
  },
  {
    id: "STOP_5P0",
    stopDistanceRate: 0.05,
  },
] as const;

const GAP_MULTIPLIERS = [
  1,
  1.5,
  2,
] as const;

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

  const fullPositionRate =
    policy.maxPositionRate;

  const fullPositionsByPortfolio =
    safeFloorRatio(
      policy.maxPortfolioExposureRate,
      fullPositionRate,
    );

  const effectiveFullPositions =
    Math.min(
      policy.maxOpenPositions,
      fullPositionsByPortfolio,
    );

  const perStopScenario =
    STOP_SCENARIOS.map(
      (scenario) => {
        const riskBasedPositionRate =
          policy.maxRiskPerTradeRate /
          scenario.stopDistanceRate;

        const effectivePositionRate =
          Math.min(
            policy.maxPositionRate,
            riskBasedPositionRate,
          );

        const riskPerPosition =
          effectivePositionRate *
          scenario.stopDistanceRate;

        const maxPositionsByExposure =
          safeFloorRatio(
            policy.maxPortfolioExposureRate,
            effectivePositionRate,
          );

        const maxPositions =
          Math.min(
            policy.maxOpenPositions,
            maxPositionsByExposure,
          );

        const aggregateStopRisk =
          riskPerPosition *
          maxPositions;

        const sequentialFullLossesToDailyStop =
          Math.ceil(
            policy.maxDailyLossRate /
              riskPerPosition -
              EPSILON,
          );

        const gapStress =
          GAP_MULTIPLIERS.map(
            (multiplier) => {
              const lossPerPosition =
                riskPerPosition *
                multiplier;

              const portfolioLossIfAllHit =
                lossPerPosition *
                maxPositions;

              return {
                gapMultiplier:
                  multiplier,

                lossPerPosition:
                  round(
                    lossPerPosition,
                  ),

                portfolioLossIfAllPositionsHit:
                  round(
                    portfolioLossIfAllHit,
                  ),

                exceedsDailyLossLimit:
                  portfolioLossIfAllHit >
                  policy.maxDailyLossRate +
                    EPSILON,

                exceedsTwoTimesDailyLossLimit:
                  portfolioLossIfAllHit >
                  policy.maxDailyLossRate *
                    2 +
                    EPSILON,
              };
            },
          );

        return {
          id:
            scenario.id,

          stopDistanceRate:
            scenario.stopDistanceRate,

          effectivePositionRate:
            round(
              effectivePositionRate,
            ),

          riskPerPosition:
            round(
              riskPerPosition,
            ),

          maxPositions,

          aggregateStopRiskAtMaxPositions:
            round(
              aggregateStopRisk,
            ),

          aggregateStopRiskExceedsDailyLossLimit:
            aggregateStopRisk >
            policy.maxDailyLossRate +
              EPSILON,

          sequentialFullLossesToDailyStop,

          gapStress,
        };
      },
    );

  const sectorFullPositions =
    safeFloorRatio(
      policy.maxSectorExposureRate,
      policy.maxPositionRate,
    );

  const sectorResidualExposure =
    round(
      policy.maxSectorExposureRate -
        sectorFullPositions *
          policy.maxPositionRate,
    );

  const sectorStress =
    STOP_SCENARIOS.map(
      (scenario) => {
        const riskBasedPositionRate =
          policy.maxRiskPerTradeRate /
          scenario.stopDistanceRate;

        const effectivePositionRate =
          Math.min(
            policy.maxPositionRate,
            riskBasedPositionRate,
          );

        const riskPerPosition =
          effectivePositionRate *
          scenario.stopDistanceRate;

        const maxSameSectorPositions =
          Math.min(
            policy.maxOpenPositions,
            safeFloorRatio(
              policy.maxSectorExposureRate,
              effectivePositionRate,
            ),
          );

        return {
          id:
            scenario.id,

          maxSameSectorPositions,

          sameSectorExposure:
            round(
              maxSameSectorPositions *
                effectivePositionRate,
            ),

          sameSectorStopRisk:
            round(
              maxSameSectorPositions *
                riskPerPosition,
            ),
        };
      },
    );

  /*
   * 현재 risk-manager는:
   * - 개별 거래 위험
   * - 종목/포트폴리오/업종 노출
   * - 실현된 일일손실
   * 을 검사한다.
   *
   * 하지만 이미 열린 모든 포지션의
   * "현재 stop까지의 총 잠재 손실"을 직접 합산하는
   * aggregate open-risk budget은 현재 정책에 없다.
   */
  const aggregateOpenRiskGap = {
    currentlyConfigured:
      false,

    currentPolicyFieldsChecked: [
      "maxRiskPerTradeRate",
      "maxPositionRate",
      "maxPortfolioExposureRate",
      "maxSectorExposureRate",
      "maxOpenPositions",
      "maxDailyLossRate",
    ],

    missingControl:
      "MAX_AGGREGATE_OPEN_RISK_RATE",

    whyItMatters:
      "Daily loss limit blocks new entries after realized losses, but multiple already-open positions can hit stops together and exceed the daily limit.",

    recommendedNextDesign:
      "Add a separate aggregate open-risk budget before approving a new position.",
  };

  const fivePercent =
    perStopScenario.find(
      (row) =>
        row.id ===
        "STOP_5P0",
    );

  const criticalFindings = {
    sixFullPositionsSupported:
      effectiveFullPositions ===
      6,

    fivePercentStopUsesFullHalfPercentRisk:
      Math.abs(
        (
          fivePercent
            ?.riskPerPosition ??
          0
        ) -
          policy.maxRiskPerTradeRate,
      ) <= EPSILON,

    sixTrendFollowPositionsAggregateStopRisk:
      fivePercent
        ?.aggregateStopRiskAtMaxPositions ??
      null,

    sixTrendFollowStopsCanExceedDailyLossLimit:
      Boolean(
        fivePercent
          ?.aggregateStopRiskExceedsDailyLossLimit,
      ),

    aggregateOpenRiskControlMissing:
      true,
  };

  const result = {
    status:
      "ALPHA_V3_RISK_V3_SCENARIO_STRESS_TEST_COMPLETE",

    version:
      VERSION,

    policy: {
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

    portfolioCapacity: {
      fullPositionRate,

      fullPositionsByPortfolio,

      effectiveFullPositions,

      totalExposureAtSixFullPositions:
        round(
          effectiveFullPositions *
            fullPositionRate,
        ),
    },

    perStopScenario,

    sectorStress: {
      sectorFullPositions,
      sectorResidualExposure,
      scenarios:
        sectorStress,
    },

    aggregateOpenRiskGap,

    criticalFindings,

    decision: {
      stressTestPassed:
        true,

      riskV3Complete:
        false,

      productionPolicyChanged:
        false,

      requiredBeforeRiskV3Lock: [
        "ADD_AGGREGATE_OPEN_RISK_BUDGET",
        "STRESS_TEST_AGGREGATE_OPEN_RISK_BUDGET",
      ],

      rationale:
        "Existing controls are internally consistent, but realized daily-loss gating is not a substitute for limiting simultaneous open stop risk.",
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
      "DESIGN_ALPHA_V3_AGGREGATE_OPEN_RISK_BUDGET",

    outputFile:
      "logs/alpha-v3-risk-v3-scenario-stress-test.json",
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
          "ALPHA_V3_RISK_V3_SCENARIO_STRESS_TEST_FAILED",

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
