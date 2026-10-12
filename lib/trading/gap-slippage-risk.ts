export const GAP_SLIPPAGE_RISK_VERSION =
  "ALPHA_V3_GAP_SLIPPAGE_RISK_V1" as const;

export interface GapSlippageRiskPolicy {
  maxRiskPerTradeRate: number;
  minStopDistanceRate: number;
  maxStopDistanceRate: number;
  maxAdverseEntryDriftRate: number;
  moneyEpsilon: number;
}

export const DEFAULT_GAP_SLIPPAGE_RISK_POLICY:
  Readonly<GapSlippageRiskPolicy> =
  Object.freeze({
    /*
     * Keep this aligned with the existing DEFAULT_RISK_POLICY
     * until a later explicit policy-version migration changes it.
     */
    maxRiskPerTradeRate:
      0.005,

    minStopDistanceRate:
      0.01,

    maxStopDistanceRate:
      0.05,

    /*
     * Execution price may not be more than 1% worse than the price
     * used for approval. This is intentionally conservative and
     * matches the currently frozen 1% forward-entry premium cap.
     *
     * Production binding is NOT enabled by this foundation installer.
     */
    maxAdverseEntryDriftRate:
      0.01,

    moneyEpsilon:
      0.01,
  });

export type GapSlippageBuyBlocker =
  | "INVALID_INPUT"
  | "EXECUTION_PRICE_NOT_ABOVE_STOP"
  | "ADVERSE_ENTRY_DRIFT_EXCEEDED"
  | "STOP_DISTANCE_TOO_CLOSE_AT_EXECUTION"
  | "STOP_DISTANCE_TOO_FAR_AT_EXECUTION"
  | "ACTUAL_TRADE_RISK_EXCEEDS_RESERVED_RISK"
  | "ACTUAL_TRADE_RISK_EXCEEDS_PER_TRADE_LIMIT";

export interface EvaluateBuyExecutionRiskInput {
  stockCode: string;

  plannedEntryPrice: number;
  executionPrice: number;
  stopPrice: number;
  quantity: number;

  accountEquity: number;

  /*
   * Atomic committed-risk reservation currently attached to this
   * order. V1 never silently enlarges this reservation at execution.
   */
  reservedRiskAmount: number;
}

export interface BuyExecutionRiskEvaluation {
  version:
    typeof GAP_SLIPPAGE_RISK_VERSION;

  allowed: boolean;

  blockers:
    GapSlippageBuyBlocker[];

  prices: {
    plannedEntryPrice: number;
    executionPrice: number;
    stopPrice: number;
  };

  quantity: number;

  drift: {
    signedRate: number;
    adverseRate: number;
    favorableRate: number;
    amountPerShare: number;
  };

  risk: {
    plannedRiskPerShare: number;
    actualRiskPerShare: number;

    plannedTradeRisk: number;
    actualTradeRisk: number;

    riskInflationAmount: number;
    riskInflationRate: number | null;

    reservedRiskAmount: number;
    reservedRiskHeadroom: number;

    maxTradeRiskAmount: number;
  };

  stop: {
    plannedDistanceRate: number;
    actualDistanceRate: number;
  };

  policy: GapSlippageRiskPolicy;

  semantics: {
    reservationMayIncreaseAtExecution: false;
    autoResizeQuantity: false;
    failClosedOnUnsafeBuyExecution: true;
  };
}

function validPositive(
  value:
    number,
) {
  return (
    Number.isFinite(
      value,
    ) &&
    value >
      0
  );
}

function validNonNegative(
  value:
    number,
) {
  return (
    Number.isFinite(
      value,
    ) &&
    value >=
      0
  );
}

export function evaluateBuyExecutionGapSlippageRisk(
  input:
    EvaluateBuyExecutionRiskInput,
  policy:
    GapSlippageRiskPolicy =
      DEFAULT_GAP_SLIPPAGE_RISK_POLICY,
): BuyExecutionRiskEvaluation {
  const blockers:
    GapSlippageBuyBlocker[] =
    [];

  const inputValid =
    input.stockCode.trim()
      .length >
      0 &&
    validPositive(
      input.plannedEntryPrice,
    ) &&
    validPositive(
      input.executionPrice,
    ) &&
    validPositive(
      input.stopPrice,
    ) &&
    Number.isInteger(
      input.quantity,
    ) &&
    input.quantity >
      0 &&
    validPositive(
      input.accountEquity,
    ) &&
    validNonNegative(
      input.reservedRiskAmount,
    );

  if (
    !inputValid
  ) {
    blockers.push(
      "INVALID_INPUT",
    );
  }

  const plannedRiskPerShare =
    Math.max(
      0,
      input.plannedEntryPrice -
        input.stopPrice,
    );

  const actualRiskPerShare =
    Math.max(
      0,
      input.executionPrice -
        input.stopPrice,
    );

  const plannedTradeRisk =
    plannedRiskPerShare *
    input.quantity;

  const actualTradeRisk =
    actualRiskPerShare *
    input.quantity;

  const signedDriftRate =
    input.plannedEntryPrice >
    0
      ? (
          input.executionPrice -
          input.plannedEntryPrice
        ) /
        input.plannedEntryPrice
      : 0;

  const adverseRate =
    Math.max(
      0,
      signedDriftRate,
    );

  const favorableRate =
    Math.max(
      0,
      -signedDriftRate,
    );

  const plannedDistanceRate =
    input.plannedEntryPrice >
    0
      ? (
          input.plannedEntryPrice -
          input.stopPrice
        ) /
        input.plannedEntryPrice
      : 0;

  const actualDistanceRate =
    input.executionPrice >
    0
      ? (
          input.executionPrice -
          input.stopPrice
        ) /
        input.executionPrice
      : 0;

  const maxTradeRiskAmount =
    input.accountEquity *
    policy.maxRiskPerTradeRate;

  const riskInflationAmount =
    actualTradeRisk -
    plannedTradeRisk;

  const riskInflationRate =
    plannedTradeRisk >
    0
      ? riskInflationAmount /
        plannedTradeRisk
      : null;

  const reservedRiskHeadroom =
    input.reservedRiskAmount -
    actualTradeRisk;

  if (
    inputValid
  ) {
    if (
      input.executionPrice <=
      input.stopPrice
    ) {
      blockers.push(
        "EXECUTION_PRICE_NOT_ABOVE_STOP",
      );
    }

    if (
      adverseRate >
      policy.maxAdverseEntryDriftRate
    ) {
      blockers.push(
        "ADVERSE_ENTRY_DRIFT_EXCEEDED",
      );
    }

    if (
      actualDistanceRate <
      policy.minStopDistanceRate
    ) {
      blockers.push(
        "STOP_DISTANCE_TOO_CLOSE_AT_EXECUTION",
      );
    }

    if (
      actualDistanceRate >
      policy.maxStopDistanceRate
    ) {
      blockers.push(
        "STOP_DISTANCE_TOO_FAR_AT_EXECUTION",
      );
    }

    if (
      actualTradeRisk >
      input.reservedRiskAmount +
        policy.moneyEpsilon
    ) {
      blockers.push(
        "ACTUAL_TRADE_RISK_EXCEEDS_RESERVED_RISK",
      );
    }

    if (
      actualTradeRisk >
      maxTradeRiskAmount +
        policy.moneyEpsilon
    ) {
      blockers.push(
        "ACTUAL_TRADE_RISK_EXCEEDS_PER_TRADE_LIMIT",
      );
    }
  }

  return {
    version:
      GAP_SLIPPAGE_RISK_VERSION,

    allowed:
      blockers.length ===
      0,

    blockers,

    prices: {
      plannedEntryPrice:
        input.plannedEntryPrice,

      executionPrice:
        input.executionPrice,

      stopPrice:
        input.stopPrice,
    },

    quantity:
      input.quantity,

    drift: {
      signedRate:
        signedDriftRate,

      adverseRate,

      favorableRate,

      amountPerShare:
        input.executionPrice -
        input.plannedEntryPrice,
    },

    risk: {
      plannedRiskPerShare,

      actualRiskPerShare,

      plannedTradeRisk,

      actualTradeRisk,

      riskInflationAmount,

      riskInflationRate,

      reservedRiskAmount:
        input.reservedRiskAmount,

      reservedRiskHeadroom,

      maxTradeRiskAmount,
    },

    stop: {
      plannedDistanceRate,

      actualDistanceRate,
    },

    policy: {
      ...policy,
    },

    semantics: {
      reservationMayIncreaseAtExecution:
        false,

      autoResizeQuantity:
        false,

      failClosedOnUnsafeBuyExecution:
        true,
    },
  };
}

export interface ProtectiveExitGapInput {
  stockCode: string;
  stopPrice: number;
  executableExitPrice: number;
  quantity: number;
}

export interface ProtectiveExitGapEvaluation {
  version:
    typeof GAP_SLIPPAGE_RISK_VERSION;

  allowed: true;

  /*
   * Protective exits are never rejected because price gapped through
   * the stop. A worse price is recorded as realized stop-gap loss.
   */
  blocker: null;

  stopPrice: number;
  executableExitPrice: number;
  quantity: number;

  gapBeyondStopPerShare: number;
  gapBeyondStopRate: number;
  additionalLossAmount: number;

  semantics: {
    riskReducingExitMustNotBeBlocked: true;
    gapIsDiagnosticOnly: true;
  };
}

export function evaluateProtectiveExitGap(
  input:
    ProtectiveExitGapInput,
): ProtectiveExitGapEvaluation {
  const gapBeyondStopPerShare =
    Math.max(
      0,
      input.stopPrice -
        input.executableExitPrice,
    );

  const gapBeyondStopRate =
    input.stopPrice >
    0
      ? gapBeyondStopPerShare /
        input.stopPrice
      : 0;

  return {
    version:
      GAP_SLIPPAGE_RISK_VERSION,

    allowed:
      true,

    blocker:
      null,

    stopPrice:
      input.stopPrice,

    executableExitPrice:
      input.executableExitPrice,

    quantity:
      input.quantity,

    gapBeyondStopPerShare,

    gapBeyondStopRate,

    additionalLossAmount:
      gapBeyondStopPerShare *
      Math.max(
        0,
        input.quantity,
      ),

    semantics: {
      riskReducingExitMustNotBeBlocked:
        true,

      gapIsDiagnosticOnly:
        true,
    },
  };
}
