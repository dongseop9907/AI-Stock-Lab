import {
  strict as assert,
} from "node:assert";

import {
  DEFAULT_GAP_SLIPPAGE_RISK_POLICY,
  evaluateBuyExecutionGapSlippageRisk,
  evaluateProtectiveExitGap,
} from "../lib/trading/gap-slippage-risk";

function base(
  overrides:
    Record<
      string,
      unknown
    > = {},
) {
  return {
    stockCode:
      "005930",

    plannedEntryPrice:
      100_000,

    executionPrice:
      100_000,

    stopPrice:
      97_000,

    quantity:
      1,

    accountEquity:
      10_000_000,

    reservedRiskAmount:
      3_000,

    ...overrides,
  } as any;
}

function main() {
  const checks:
    Record<
      string,
      boolean
    > = {};

  const exact =
    evaluateBuyExecutionGapSlippageRisk(
      base(),
    );

  checks.exactApprovedExecutionAllowed =
    exact.allowed ===
      true &&
    exact.blockers.length ===
      0 &&
    exact.risk.actualTradeRisk ===
      3_000;

  const favorable =
    evaluateBuyExecutionGapSlippageRisk(
      base({
        executionPrice:
          99_500,

        /*
         * Favorable execution reduces risk versus the planned entry.
         */
        reservedRiskAmount:
          3_000,
      }),
    );

  checks.favorableExecutionAllowed =
    favorable.allowed ===
      true &&
    favorable.drift.favorableRate >
      0 &&
    favorable.risk.actualTradeRisk <
      favorable.risk.plannedTradeRisk;

  const driftExceeded =
    evaluateBuyExecutionGapSlippageRisk(
      base({
        executionPrice:
          101_500,

        reservedRiskAmount:
          10_000,
      }),
    );

  checks.adverseDriftOverOnePercentBlocked =
    driftExceeded.allowed ===
      false &&
    driftExceeded.blockers.includes(
      "ADVERSE_ENTRY_DRIFT_EXCEEDED",
    );

  const reservationExceeded =
    evaluateBuyExecutionGapSlippageRisk(
      base({
        executionPrice:
          100_500,

        reservedRiskAmount:
          3_000,
      }),
    );

  checks.reservedRiskCannotSilentlyGrow =
    reservationExceeded.allowed ===
      false &&
    reservationExceeded.blockers.includes(
      "ACTUAL_TRADE_RISK_EXCEEDS_RESERVED_RISK",
    );

  const perTradeExceeded =
    evaluateBuyExecutionGapSlippageRisk(
      base({
        /*
         * Isolate the account per-trade risk limit:
         * - equity 1,000,000 -> max risk 5,000
         * - execution risk/share = 1,500
         * - qty 4 -> actual risk 6,000
         * - adverse drift = 0.5% (below 1% drift guard)
         * - stop distance ~= 1.49% (inside 1%~5%)
         * - reserved risk is intentionally ample
         */
        plannedEntryPrice:
          100_000,

        executionPrice:
          100_500,

        stopPrice:
          99_000,

        quantity:
          4,

        accountEquity:
          1_000_000,

        reservedRiskAmount:
          100_000,
      }),
    );

  checks.perTradeRiskStillEnforcedAtExecution =
    perTradeExceeded.allowed ===
      false &&
    perTradeExceeded.blockers.includes(
      "ACTUAL_TRADE_RISK_EXCEEDS_PER_TRADE_LIMIT",
    );

  const stopTooClose =
    evaluateBuyExecutionGapSlippageRisk(
      base({
        plannedEntryPrice:
          100_000,

        executionPrice:
          100_000,

        stopPrice:
          99_500,

        reservedRiskAmount:
          500,
      }),
    );

  checks.executionStopDistanceRevalidated =
    stopTooClose.allowed ===
      false &&
    stopTooClose.blockers.includes(
      "STOP_DISTANCE_TOO_CLOSE_AT_EXECUTION",
    );

  const protectiveGap =
    evaluateProtectiveExitGap({
      stockCode:
        "005930",

      stopPrice:
        96_000,

      executableExitPrice:
        91_000,

      quantity:
        10,
    });

  checks.gapDownProtectiveExitNeverBlocked =
    protectiveGap.allowed ===
      true &&
    protectiveGap.blocker ===
      null &&
    protectiveGap.additionalLossAmount ===
      50_000;

  checks.policyAlignedWithExistingRiskV1 =
    DEFAULT_GAP_SLIPPAGE_RISK_POLICY
      .maxRiskPerTradeRate ===
      0.005 &&
    DEFAULT_GAP_SLIPPAGE_RISK_POLICY
      .minStopDistanceRate ===
      0.01 &&
    DEFAULT_GAP_SLIPPAGE_RISK_POLICY
      .maxStopDistanceRate ===
      0.05;

  assert.equal(
    exact.semantics
      .reservationMayIncreaseAtExecution,
    false,
  );

  assert.equal(
    protectiveGap.semantics
      .riskReducingExitMustNotBeBlocked,
    true,
  );

  const failed =
    Object.entries(
      checks,
    )
      .filter(
        ([, value]) =>
          !value,
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
            ? "ALPHA_V3_GAP_SLIPPAGE_RISK_V1_CONTRACT_VERIFIED"
            : "ALPHA_V3_GAP_SLIPPAGE_RISK_V1_CONTRACT_REVIEW",

        checks,

        failed,

        policy:
          DEFAULT_GAP_SLIPPAGE_RISK_POLICY,

        invariants: [
          "BUY_EXECUTION_REVALIDATES_RISK_USING_EXECUTION_PRICE",
          "ACTUAL_BUY_RISK_CANNOT_EXCEED_RESERVED_RISK",
          "ACTUAL_BUY_RISK_CANNOT_EXCEED_ACCOUNT_PER_TRADE_LIMIT",
          "ADVERSE_ENTRY_DRIFT_OVER_POLICY_LIMIT_BLOCKS_NEW_RISK",
          "UNSAFE_BUY_IS_FAIL_CLOSED",
          "NO_AUTOMATIC_RESERVATION_INCREASE_AT_EXECUTION",
          "NO_AUTOMATIC_QUANTITY_RESIZE_IN_V1",
          "PROTECTIVE_EXIT_IS_NEVER_BLOCKED_BY_STOP_GAP",
        ],

        enforcementMode:
          "CONTRACT_ONLY_NOT_YET_BOUND_TO_PRODUCTION_EXECUTOR",

        safety: {
          databaseReads:
            0,
          databaseWrites:
            0,
          ordersCreated:
            0,
          ordersChanged:
            0,
          positionsChanged:
            0,
        },

        nextGate:
          failed.length ===
          0
            ? "PROBE_EXECUTION_PRICE_AND_FILL_RPC_BINDING_SURFACES"
            : "REVIEW_GAP_SLIPPAGE_V1_CONTRACT",
      },
      null,
      2,
    ),
  );

  if (
    failed.length >
    0
  ) {
    process.exitCode =
      2;
  }
}

main();
