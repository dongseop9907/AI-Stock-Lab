export const PAPER_EXECUTION_COST_ATTRIBUTION_VERSION =
  "PAPER_EXECUTION_COST_ATTRIBUTION_V1" as const;

export const PAPER_EXECUTION_COST_ATTRIBUTION_POLICY =
  Object.freeze({
    sellTaxRate:
      0.002,
    fallbackBrokerFeeRate:
      0.00015,
    maximumAcceptedDerivedBrokerFeeRate:
      0.01,
    slippageAccounting:
      "EXECUTION_PRICE_EMBEDDED_NOT_DOUBLE_COUNTED_AS_TRANSACTION_COST",
  } as const);

export interface PaperExecutionCostAttributionInput {
  quantity: number;

  entryPrice: number;
  exitPrice: number;

  entryAmount?: number | null;
  exitAmount?: number | null;

  entryBrokerFee?: number | null;

  buyExecutionPrice?: number | null;
  buyOrderEntryPrice?: number | null;

  buyFilledQuantity?: number | null;
}

export interface PaperExecutionCostAttributionResult {
  version:
    typeof PAPER_EXECUTION_COST_ATTRIBUTION_VERSION;

  grossPnl: number;

  entryBrokerFee: number;
  exitBrokerFee: number;
  sellTax: number;

  totalTransactionCost: number;

  netPnl: number;

  grossReturn: number | null;
  netReturn: number | null;

  entrySlippageAmount: number | null;
  entrySlippageRate: number | null;

  effectiveBrokerFeeRate: number;
  exitFeeRateSource:
    | "DERIVED_FROM_BUY_EXECUTION"
    | "FALLBACK_BASE_REALISTIC";

  slippageAccounting:
    typeof PAPER_EXECUTION_COST_ATTRIBUTION_POLICY.slippageAccounting;
}

function roundMoney(
  value: number,
) {
  return (
    Math.round(
      (
        value +
        Number.EPSILON
      ) *
      100,
    ) /
    100
  );
}

function finiteNonnegative(
  value: number | null | undefined,
) {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0
  );
}

export function calculatePaperExecutionCostAttributionV1(
  input: PaperExecutionCostAttributionInput,
): PaperExecutionCostAttributionResult {
  if (
    !Number.isInteger(
      input.quantity,
    ) ||
    input.quantity <=
      0
  ) {
    throw new Error(
      "PAPER_COST_ATTRIBUTION_QUANTITY_INVALID",
    );
  }

  if (
    !Number.isFinite(
      input.entryPrice,
    ) ||
    input.entryPrice <=
      0 ||
    !Number.isFinite(
      input.exitPrice,
    ) ||
    input.exitPrice <=
      0
  ) {
    throw new Error(
      "PAPER_COST_ATTRIBUTION_PRICE_INVALID",
    );
  }

  const entryAmount =
    finiteNonnegative(
      input.entryAmount,
    )
      ? Number(
          input.entryAmount,
        )
      : input.entryPrice *
        input.quantity;

  const exitAmount =
    finiteNonnegative(
      input.exitAmount,
    )
      ? Number(
          input.exitAmount,
        )
      : input.exitPrice *
        input.quantity;

  const entryBrokerFee =
    finiteNonnegative(
      input.entryBrokerFee,
    )
      ? Number(
          input.entryBrokerFee,
        )
      : 0;

  const buyExecutionValue =
    finiteNonnegative(
      input.buyExecutionPrice,
    ) &&
    Number(
      input.buyExecutionPrice,
    ) >
      0 &&
    finiteNonnegative(
      input.buyFilledQuantity,
    ) &&
    Number(
      input.buyFilledQuantity,
    ) >
      0
      ? Number(
          input.buyExecutionPrice,
        ) *
        Number(
          input.buyFilledQuantity,
        )
      : 0;

  const derivedFeeRate =
    buyExecutionValue >
      0 &&
    entryBrokerFee >=
      0
      ? entryBrokerFee /
        buyExecutionValue
      : null;

  const derivedFeeRateValid =
    derivedFeeRate !==
      null &&
    Number.isFinite(
      derivedFeeRate,
    ) &&
    derivedFeeRate >=
      0 &&
    derivedFeeRate <=
      PAPER_EXECUTION_COST_ATTRIBUTION_POLICY
        .maximumAcceptedDerivedBrokerFeeRate;

  const effectiveBrokerFeeRate =
    derivedFeeRateValid
      ? derivedFeeRate
      : PAPER_EXECUTION_COST_ATTRIBUTION_POLICY
          .fallbackBrokerFeeRate;

  const exitFeeRateSource =
    derivedFeeRateValid
      ? "DERIVED_FROM_BUY_EXECUTION"
      : "FALLBACK_BASE_REALISTIC";

  const exitBrokerFee =
    roundMoney(
      exitAmount *
        effectiveBrokerFeeRate,
    );

  const sellTax =
    roundMoney(
      exitAmount *
        PAPER_EXECUTION_COST_ATTRIBUTION_POLICY
          .sellTaxRate,
    );

  const grossPnl =
    roundMoney(
      exitAmount -
        entryAmount,
    );

  const totalTransactionCost =
    roundMoney(
      entryBrokerFee +
        exitBrokerFee +
        sellTax,
    );

  const netPnl =
    roundMoney(
      grossPnl -
        totalTransactionCost,
    );

  const buyOrderEntryPrice =
    finiteNonnegative(
      input.buyOrderEntryPrice,
    ) &&
    Number(
      input.buyOrderEntryPrice,
    ) >
      0
      ? Number(
          input.buyOrderEntryPrice,
        )
      : null;

  const buyExecutionPrice =
    finiteNonnegative(
      input.buyExecutionPrice,
    ) &&
    Number(
      input.buyExecutionPrice,
    ) >
      0
      ? Number(
          input.buyExecutionPrice,
        )
      : null;

  const entrySlippageAmount =
    (
      buyExecutionPrice !==
        null &&
      buyOrderEntryPrice !==
        null
    )
      ? roundMoney(
          (
            buyExecutionPrice -
            buyOrderEntryPrice
          ) *
          input.quantity,
        )
      : null;

  const entrySlippageRate =
    (
      buyExecutionPrice !==
        null &&
      buyOrderEntryPrice !==
        null
    )
      ? (
          buyExecutionPrice -
          buyOrderEntryPrice
        ) /
        buyOrderEntryPrice
      : null;

  return {
    version:
      PAPER_EXECUTION_COST_ATTRIBUTION_VERSION,

    grossPnl,

    entryBrokerFee,
    exitBrokerFee,
    sellTax,

    totalTransactionCost,

    netPnl,

    grossReturn:
      entryAmount >
        0
        ? grossPnl /
          entryAmount
        : null,

    netReturn:
      entryAmount >
        0
        ? netPnl /
          entryAmount
        : null,

    entrySlippageAmount,
    entrySlippageRate,

    effectiveBrokerFeeRate,

    exitFeeRateSource,

    slippageAccounting:
      PAPER_EXECUTION_COST_ATTRIBUTION_POLICY
        .slippageAccounting,
  };
}
