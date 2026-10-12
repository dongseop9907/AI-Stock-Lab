import fs from "node:fs";
import path from "node:path";

import {
  DEFAULT_RISK_POLICY,
} from "../lib/trading/policy";

const VERSION =
  "ALPHA_V3_RISK_V3_BASELINE_V2_FLOAT_SAFE";

const OUTPUT_FILE =
  path.resolve(
    process.cwd(),
    "logs/alpha-v3-risk-v3-baseline.json",
  );

const EXIT_POLICIES = [
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
  digits = 10,
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

  const policyChecks = {
    riskPerTradePositive:
      policy.maxRiskPerTradeRate >
      0,

    positionRatePositive:
      policy.maxPositionRate >
      0,

    portfolioRateValid:
      policy.maxPortfolioExposureRate >
        0 &&
      policy.maxPortfolioExposureRate <=
        1,

    sectorRateValid:
      policy.maxSectorExposureRate >
        0 &&
      policy.maxSectorExposureRate <=
        policy.maxPortfolioExposureRate,

    openPositionCountValid:
      Number.isInteger(
        policy.maxOpenPositions,
      ) &&
      policy.maxOpenPositions >
        0,

    stopRangeValid:
      policy.minStopDistanceRate >
        0 &&
      policy.maxStopDistanceRate >=
        policy.minStopDistanceRate,

    dailyLossValid:
      policy.maxDailyLossRate >
        0,

    dailyLossAboveSingleTradeRisk:
      policy.maxDailyLossRate >=
      policy.maxRiskPerTradeRate,
  };

  const exitCompatibility =
    EXIT_POLICIES.map(
      (exitPolicy) => {
        const stopDistance =
          exitPolicy.stopDistanceRate;

        const rawRiskBasedPositionRate =
          policy.maxRiskPerTradeRate /
          stopDistance;

        const effectivePositionRate =
          Math.min(
            rawRiskBasedPositionRate,
            policy.maxPositionRate,
          );

        const riskAtEffectivePosition =
          effectivePositionRate *
          stopDistance;

        const bindingConstraint =
          Math.abs(
            rawRiskBasedPositionRate -
              policy.maxPositionRate,
          ) <= EPSILON
            ? "BOTH_EQUAL"
            : rawRiskBasedPositionRate <
                policy.maxPositionRate
              ? "RISK_PER_TRADE"
              : "MAX_POSITION";

        return {
          id:
            exitPolicy.id,

          stopDistanceRate:
            stopDistance,

          stopAllowedByRiskPolicy:
            stopDistance >=
              policy.minStopDistanceRate &&
            stopDistance <=
              policy.maxStopDistanceRate,

          rawRiskBasedPositionRate:
            round(
              rawRiskBasedPositionRate,
            ),

          maxPositionRate:
            policy.maxPositionRate,

          effectivePositionRate:
            round(
              effectivePositionRate,
            ),

          riskAtEffectivePosition:
            round(
              riskAtEffectivePosition,
            ),

          maxRiskPerTradeRate:
            policy.maxRiskPerTradeRate,

          bindingConstraint,
        };
      },
    );

  const fullSizePositionRate =
    policy.maxPositionRate;

  const fullSizePositionsByPortfolio =
    safeFloorRatio(
      policy.maxPortfolioExposureRate,
      fullSizePositionRate,
    );

  const remainingPortfolioRateAfterFullSize =
    round(
      policy.maxPortfolioExposureRate -
        fullSizePositionsByPortfolio *
          fullSizePositionRate,
    );

  const fullSizePositionsBySector =
    safeFloorRatio(
      policy.maxSectorExposureRate,
      fullSizePositionRate,
    );

  const remainingSectorRateAfterFullSize =
    round(
      policy.maxSectorExposureRate -
        fullSizePositionsBySector *
          fullSizePositionRate,
    );

  const maxRiskLossesBeforeDailyStop =
    safeFloorRatio(
      policy.maxDailyLossRate,
      policy.maxRiskPerTradeRate,
    );

  const diversification = {
    configuredMaxOpenPositions:
      policy.maxOpenPositions,

    theoreticalFullSizePositionsByPortfolio:
      fullSizePositionsByPortfolio,

    remainingPortfolioRateAfterFullSize,

    effectiveFullSizePositionLimit:
      Math.min(
        policy.maxOpenPositions,
        fullSizePositionsByPortfolio,
      ),

    fullSizePositionsBySector:
      fullSizePositionsBySector,

    remainingSectorRateAfterFullSize,

    observation:
      fullSizePositionsByPortfolio <
      policy.maxOpenPositions
        ? "PORTFOLIO_EXPOSURE_BINDS_BEFORE_MAX_OPEN_POSITIONS_AT_FULL_SIZE"
        : fullSizePositionsByPortfolio >
            policy.maxOpenPositions
          ? "MAX_OPEN_POSITIONS_BINDS_FIRST"
          : "PORTFOLIO_EXPOSURE_AND_MAX_OPEN_POSITIONS_BIND_TOGETHER",
  };

  const dailyLoss = {
    maxDailyLossRate:
      policy.maxDailyLossRate,

    maxRiskPerTradeRate:
      policy.maxRiskPerTradeRate,

    maxFullRiskLossesBeforeDailyStop:
      maxRiskLossesBeforeDailyStop,

    exactMultiple:
      round(
        policy.maxDailyLossRate /
          policy.maxRiskPerTradeRate,
      ),
  };

  const allPolicyChecksPassed =
    Object.values(
      policyChecks,
    ).every(Boolean);

  const allExitPoliciesCompatible =
    exitCompatibility.every(
      (row) =>
        row.stopAllowedByRiskPolicy &&
        row.riskAtEffectivePosition <=
          policy.maxRiskPerTradeRate +
            EPSILON,
    );

  const result = {
    status:
      "ALPHA_V3_RISK_V3_BASELINE_COMPLETE",

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

      minStopDistanceRate:
        policy.minStopDistanceRate,

      maxStopDistanceRate:
        policy.maxStopDistanceRate,

      maxDailyLossRate:
        policy.maxDailyLossRate,
    },

    policyChecks,

    exitCompatibility,

    diversification,

    dailyLoss,

    conclusions: {
      allPolicyChecksPassed,

      allExitPoliciesCompatible,

      trendFollowFivePercentStopFitsPolicy:
        exitCompatibility.find(
          (row) =>
            row.id ===
            "TREND_FOLLOW_STOP_5PCT",
        )
          ?.stopAllowedByRiskPolicy ??
        false,

      tenPercentPositionAtFivePercentStopUsesFullRiskBudget:
        Math.abs(
          (
            exitCompatibility.find(
              (row) =>
                row.id ===
                "TREND_FOLLOW_STOP_5PCT",
            )
              ?.riskAtEffectivePosition ??
            0
          ) -
            policy.maxRiskPerTradeRate,
        ) <= EPSILON,

      portfolioSupportsSixFullTenPercentPositions:
        fullSizePositionsByPortfolio ===
        6,

      effectiveFullSizePositionLimit:
        Math.min(
          policy.maxOpenPositions,
          fullSizePositionsByPortfolio,
        ),

      baselineReady:
        allPolicyChecksPassed &&
        allExitPoliciesCompatible &&
        fullSizePositionsByPortfolio ===
          6,
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
      allPolicyChecksPassed &&
      allExitPoliciesCompatible &&
      fullSizePositionsByPortfolio ===
        6
        ? "BUILD_ALPHA_V3_RISK_V3_SCENARIO_STRESS_TEST"
        : "REVIEW_ALPHA_V3_RISK_V3_POLICY_CONFLICTS",

    outputFile:
      "logs/alpha-v3-risk-v3-baseline.json",
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
          "ALPHA_V3_RISK_V3_BASELINE_FAILED",

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
