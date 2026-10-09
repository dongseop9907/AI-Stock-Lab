export const PAPER_EXECUTION_REALISM_VERSION =
  "PAPER_EXECUTION_REALISM_V2" as const;

export type PaperExecutionSide =
  | "BUY"
  | "SELL";

export interface PaperExecutionRealismPolicy {
  maxQuoteAgeMs: number;
  maxParticipationRate: number;
  syntheticHalfSpreadBps: number;
  marketImpactAtMaxParticipationBps: number;
  maxMarketImpactBps: number;
  brokerFeeEachSideRate: number;
  sellTaxRate: number;
  allowReferencePriceFallback: boolean;
}

export const DEFAULT_PAPER_EXECUTION_REALISM_POLICY:
  Readonly<PaperExecutionRealismPolicy> = {
    maxQuoteAgeMs: 5_000,
    maxParticipationRate: 0.05,
    syntheticHalfSpreadBps: 2,
    marketImpactAtMaxParticipationBps: 15,
    maxMarketImpactBps: 30,
    brokerFeeEachSideRate: 0.00015,
    sellTaxRate: 0.002,
    allowReferencePriceFallback: true,
  };

export interface PaperQuoteSnapshot {
  observedAt: string | Date;
  bestBidPrice?: number | null;
  bestAskPrice?: number | null;
  bestBidQuantity?: number | null;
  bestAskQuantity?: number | null;
}

export interface PaperExecutionRealismInput {
  side: PaperExecutionSide;
  requestedQuantity: number;
  referencePrice: number;
  now?: string | Date;
  quote?: PaperQuoteSnapshot | null;

  /**
   * Tradeable volume observed in the same execution interval.
   * When supplied, requested quantity is capped by
   * floor(intervalVolume * maxParticipationRate).
   */
  intervalVolume?: number | null;
}

export type PaperExecutionRealismBlocker =
  | "INVALID_REQUESTED_QUANTITY"
  | "INVALID_REFERENCE_PRICE"
  | "INVALID_POLICY"
  | "STALE_QUOTE"
  | "INVALID_QUOTE"
  | "NO_EXECUTABLE_PRICE"
  | "NO_EXECUTABLE_LIQUIDITY";

export interface PaperExecutionRealismDecision {
  version:
    typeof PAPER_EXECUTION_REALISM_VERSION;

  approved: boolean;
  blocker:
    PaperExecutionRealismBlocker | null;

  side: PaperExecutionSide;
  requestedQuantity: number;
  filledQuantity: number;
  unfilledQuantity: number;
  fillRate: number;

  referencePrice: number;
  executionPrice: number | null;
  priceSource:
    | "BEST_ASK"
    | "BEST_BID"
    | "REFERENCE_PLUS_SYNTHETIC_SPREAD"
    | "REFERENCE_MINUS_SYNTHETIC_SPREAD"
    | null;

  quoteAgeMs: number | null;

  participationRate: number | null;
  liquidityQuantityCap: number | null;
  topOfBookQuantityCap: number | null;

  syntheticSpreadBps: number;
  marketImpactBps: number;
  totalAdversePriceBps: number | null;

  grossNotional: number;
  brokerFee: number;
  sellTax: number;
  totalTransactionCost: number;
  netCashFlow: number;

  assumptions: string[];
}

function finitePositive(
  value: number,
): boolean {
  return (
    Number.isFinite(value) &&
    value > 0
  );
}

function toTimestamp(
  value: string | Date,
): number {
  if (value instanceof Date) {
    return value.getTime();
  }

  return new Date(value).getTime();
}

function policyIsValid(
  policy: PaperExecutionRealismPolicy,
): boolean {
  return (
    Number.isFinite(
      policy.maxQuoteAgeMs,
    ) &&
    policy.maxQuoteAgeMs >= 0 &&
    Number.isFinite(
      policy.maxParticipationRate,
    ) &&
    policy.maxParticipationRate > 0 &&
    policy.maxParticipationRate <= 1 &&
    Number.isFinite(
      policy.syntheticHalfSpreadBps,
    ) &&
    policy.syntheticHalfSpreadBps >= 0 &&
    Number.isFinite(
      policy.marketImpactAtMaxParticipationBps,
    ) &&
    policy.marketImpactAtMaxParticipationBps >= 0 &&
    Number.isFinite(
      policy.maxMarketImpactBps,
    ) &&
    policy.maxMarketImpactBps >= 0 &&
    Number.isFinite(
      policy.brokerFeeEachSideRate,
    ) &&
    policy.brokerFeeEachSideRate >= 0 &&
    Number.isFinite(
      policy.sellTaxRate,
    ) &&
    policy.sellTaxRate >= 0
  );
}

function blocked(
  input: PaperExecutionRealismInput,
  blocker: PaperExecutionRealismBlocker,
): PaperExecutionRealismDecision {
  return {
    version:
      PAPER_EXECUTION_REALISM_VERSION,
    approved: false,
    blocker,
    side: input.side,
    requestedQuantity:
      input.requestedQuantity,
    filledQuantity: 0,
    unfilledQuantity:
      Math.max(
        0,
        Number.isFinite(
          input.requestedQuantity,
        )
          ? input.requestedQuantity
          : 0,
      ),
    fillRate: 0,
    referencePrice:
      input.referencePrice,
    executionPrice: null,
    priceSource: null,
    quoteAgeMs: null,
    participationRate: null,
    liquidityQuantityCap: null,
    topOfBookQuantityCap: null,
    syntheticSpreadBps: 0,
    marketImpactBps: 0,
    totalAdversePriceBps: null,
    grossNotional: 0,
    brokerFee: 0,
    sellTax: 0,
    totalTransactionCost: 0,
    netCashFlow: 0,
    assumptions: [],
  };
}

function quotePrice(
  side: PaperExecutionSide,
  quote: PaperQuoteSnapshot,
): number | null {
  const candidate =
    side === "BUY"
      ? quote.bestAskPrice
      : quote.bestBidPrice;

  return (
    typeof candidate === "number" &&
    finitePositive(candidate)
  )
    ? candidate
    : null;
}

function quoteQuantity(
  side: PaperExecutionSide,
  quote: PaperQuoteSnapshot,
): number | null {
  const candidate =
    side === "BUY"
      ? quote.bestAskQuantity
      : quote.bestBidQuantity;

  return (
    typeof candidate === "number" &&
    Number.isFinite(candidate) &&
    candidate >= 0
  )
    ? Math.floor(candidate)
    : null;
}

export function evaluatePaperExecutionRealismV2(
  input: PaperExecutionRealismInput,
  policy:
    Readonly<PaperExecutionRealismPolicy> =
      DEFAULT_PAPER_EXECUTION_REALISM_POLICY,
): PaperExecutionRealismDecision {
  if (
    !Number.isInteger(
      input.requestedQuantity,
    ) ||
    input.requestedQuantity <= 0
  ) {
    return blocked(
      input,
      "INVALID_REQUESTED_QUANTITY",
    );
  }

  if (
    !finitePositive(
      input.referencePrice,
    )
  ) {
    return blocked(
      input,
      "INVALID_REFERENCE_PRICE",
    );
  }

  if (!policyIsValid(policy)) {
    return blocked(
      input,
      "INVALID_POLICY",
    );
  }

  const nowMs =
    toTimestamp(
      input.now ??
        new Date(),
    );

  let executablePrice:
    number | null = null;

  let priceSource:
    PaperExecutionRealismDecision["priceSource"] =
      null;

  let quoteAgeMs:
    number | null = null;

  let topOfBookQuantityCap:
    number | null = null;

  let syntheticSpreadBps = 0;

  const assumptions: string[] = [];

  if (input.quote) {
    const observedAtMs =
      toTimestamp(
        input.quote.observedAt,
      );

    if (
      !Number.isFinite(
        observedAtMs,
      ) ||
      !Number.isFinite(nowMs)
    ) {
      return blocked(
        input,
        "INVALID_QUOTE",
      );
    }

    quoteAgeMs =
      Math.max(
        0,
        nowMs - observedAtMs,
      );

    if (
      quoteAgeMs >
      policy.maxQuoteAgeMs
    ) {
      return blocked(
        input,
        "STALE_QUOTE",
      );
    }

    executablePrice =
      quotePrice(
        input.side,
        input.quote,
      );

    if (executablePrice !== null) {
      priceSource =
        input.side === "BUY"
          ? "BEST_ASK"
          : "BEST_BID";

      topOfBookQuantityCap =
        quoteQuantity(
          input.side,
          input.quote,
        );

      assumptions.push(
        "TOP_OF_BOOK_PRICE_USED",
      );
    } else if (
      !policy.allowReferencePriceFallback
    ) {
      return blocked(
        input,
        "NO_EXECUTABLE_PRICE",
      );
    }
  }

  if (executablePrice === null) {
    if (
      !policy.allowReferencePriceFallback
    ) {
      return blocked(
        input,
        "NO_EXECUTABLE_PRICE",
      );
    }

    syntheticSpreadBps =
      policy.syntheticHalfSpreadBps;

    const spreadRate =
      syntheticSpreadBps /
      10_000;

    executablePrice =
      input.side === "BUY"
        ? input.referencePrice *
          (1 + spreadRate)
        : input.referencePrice *
          (1 - spreadRate);

    priceSource =
      input.side === "BUY"
        ? "REFERENCE_PLUS_SYNTHETIC_SPREAD"
        : "REFERENCE_MINUS_SYNTHETIC_SPREAD";

    assumptions.push(
      "NO_TOP_OF_BOOK_REFERENCE_FALLBACK_USED",
    );
  }

  let liquidityQuantityCap:
    number | null = null;

  let participationRate:
    number | null = null;

  if (
    typeof input.intervalVolume ===
      "number" &&
    Number.isFinite(
      input.intervalVolume,
    ) &&
    input.intervalVolume >= 0
  ) {
    liquidityQuantityCap =
      Math.floor(
        input.intervalVolume *
        policy.maxParticipationRate,
      );

    if (
      input.intervalVolume > 0
    ) {
      participationRate =
        Math.min(
          1,
          input.requestedQuantity /
            input.intervalVolume,
        );
    }

    assumptions.push(
      "INTERVAL_VOLUME_PARTICIPATION_CAP_APPLIED",
    );
  }

  const caps =
    [
      input.requestedQuantity,
      topOfBookQuantityCap,
      liquidityQuantityCap,
    ]
      .filter(
        (
          value,
        ): value is number =>
          typeof value ===
            "number",
      );

  const filledQuantity =
    Math.min(
      ...caps,
    );

  if (filledQuantity <= 0) {
    return {
      ...blocked(
        input,
        "NO_EXECUTABLE_LIQUIDITY",
      ),
      quoteAgeMs,
      priceSource,
      topOfBookQuantityCap,
      liquidityQuantityCap,
      participationRate,
      syntheticSpreadBps,
      assumptions,
    };
  }

  const effectiveParticipation =
    participationRate === null
      ? 0
      : Math.min(
          policy.maxParticipationRate,
          Math.max(
            0,
            filledQuantity /
              Math.max(
                1,
                input.intervalVolume ??
                  1,
              ),
          ),
        );

  const normalizedParticipation =
    policy.maxParticipationRate > 0
      ? effectiveParticipation /
        policy.maxParticipationRate
      : 0;

  const marketImpactBps =
    Math.min(
      policy.maxMarketImpactBps,
      policy.marketImpactAtMaxParticipationBps *
        Math.sqrt(
          Math.max(
            0,
            normalizedParticipation,
          ),
        ),
    );

  const impactRate =
    marketImpactBps /
    10_000;

  const executionPrice =
    input.side === "BUY"
      ? executablePrice *
        (1 + impactRate)
      : executablePrice *
        (1 - impactRate);

  const grossNotional =
    executionPrice *
    filledQuantity;

  const brokerFee =
    grossNotional *
    policy.brokerFeeEachSideRate;

  const sellTax =
    input.side === "SELL"
      ? grossNotional *
        policy.sellTaxRate
      : 0;

  const totalTransactionCost =
    brokerFee + sellTax;

  const netCashFlow =
    input.side === "BUY"
      ? -(
          grossNotional +
          totalTransactionCost
        )
      : grossNotional -
        totalTransactionCost;

  const unfilledQuantity =
    input.requestedQuantity -
    filledQuantity;

  const fillRate =
    filledQuantity /
    input.requestedQuantity;

  const adverseRate =
    input.side === "BUY"
      ? executionPrice /
          input.referencePrice -
        1
      : 1 -
        executionPrice /
          input.referencePrice;

  if (
    topOfBookQuantityCap !== null &&
    filledQuantity <
      input.requestedQuantity
  ) {
    assumptions.push(
      "TOP_OF_BOOK_PARTIAL_FILL_CAP_APPLIED",
    );
  }

  if (
    liquidityQuantityCap !== null &&
    filledQuantity <
      input.requestedQuantity
  ) {
    assumptions.push(
      "LIQUIDITY_PARTIAL_FILL_CAP_APPLIED",
    );
  }

  if (marketImpactBps > 0) {
    assumptions.push(
      "SIZE_DEPENDENT_MARKET_IMPACT_APPLIED",
    );
  }

  assumptions.push(
    "PROJECT_BASELINE_TRANSACTION_COST_ASSUMPTIONS_APPLIED",
  );

  return {
    version:
      PAPER_EXECUTION_REALISM_VERSION,

    approved: true,
    blocker: null,

    side: input.side,
    requestedQuantity:
      input.requestedQuantity,
    filledQuantity,
    unfilledQuantity,
    fillRate,

    referencePrice:
      input.referencePrice,
    executionPrice,
    priceSource,

    quoteAgeMs,

    participationRate,
    liquidityQuantityCap,
    topOfBookQuantityCap,

    syntheticSpreadBps,
    marketImpactBps,
    totalAdversePriceBps:
      adverseRate *
      10_000,

    grossNotional,
    brokerFee,
    sellTax,
    totalTransactionCost,
    netCashFlow,

    assumptions,
  };
}
