import {
  calculatePaperExecutionCostAttributionV1,
  PAPER_EXECUTION_COST_ATTRIBUTION_POLICY,
} from "../lib/trading/paper-execution-cost-attribution";

function closeEnough(
  left: number,
  right: number,
  tolerance = 1e-9,
) {
  return (
    Math.abs(
      left -
      right,
    ) <=
    tolerance
  );
}

const base =
  calculatePaperExecutionCostAttributionV1({
    quantity:
      10,

    entryPrice:
      100_000,

    exitPrice:
      110_000,

    entryBrokerFee:
      150,

    buyExecutionPrice:
      100_000,

    buyOrderEntryPrice:
      99_500,

    buyFilledQuantity:
      10,
  });

const fallback =
  calculatePaperExecutionCostAttributionV1({
    quantity:
      10,

    entryPrice:
      100_000,

    exitPrice:
      110_000,

    entryBrokerFee:
      null,

    buyExecutionPrice:
      null,

    buyOrderEntryPrice:
      null,

    buyFilledQuantity:
      null,
  });

const expectedGross =
  100_000;

const expectedExitBrokerFee =
  165;

const expectedSellTax =
  2_200;

const expectedTotalCost =
  2_515;

const expectedNet =
  97_485;

const checks = {
  grossPnl:
    base.grossPnl ===
    expectedGross,

  derivedBrokerFeeRate:
    closeEnough(
      base.effectiveBrokerFeeRate,
      0.00015,
    ),

  exitBrokerFee:
    base.exitBrokerFee ===
    expectedExitBrokerFee,

  sellTax:
    base.sellTax ===
    expectedSellTax,

  totalTransactionCost:
    base.totalTransactionCost ===
    expectedTotalCost,

  netPnl:
    base.netPnl ===
    expectedNet,

  grossNetIdentity:
    base.netPnl ===
    base.grossPnl -
      base.totalTransactionCost,

  entrySlippageDiagnostic:
    base.entrySlippageAmount ===
      5_000 &&
    closeEnough(
      base.entrySlippageRate ??
        Number.NaN,
      (
        100_000 -
        99_500
      ) /
        99_500,
    ),

  slippageNotDoubleCounted:
    base.totalTransactionCost ===
      (
        base.entryBrokerFee +
        base.exitBrokerFee +
        base.sellTax
      ),

  fallbackBrokerFeeRate:
    closeEnough(
      fallback.effectiveBrokerFeeRate,
      PAPER_EXECUTION_COST_ATTRIBUTION_POLICY
        .fallbackBrokerFeeRate,
    ),

  fallbackSource:
    fallback.exitFeeRateSource ===
    "FALLBACK_BASE_REALISTIC",

  sellTaxPolicy:
    PAPER_EXECUTION_COST_ATTRIBUTION_POLICY
      .sellTaxRate ===
    0.002,
};

const failed =
  Object.entries(
    checks,
  )
    .filter(
      ([, ok]) =>
        ok !== true,
    )
    .map(
      ([name]) =>
        name,
    );

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "AI_STOCK_LAB_PAPER_EXECUTION_COST_ATTRIBUTION_V1_CONTRACT_VERIFIED"
          : "AI_STOCK_LAB_PAPER_EXECUTION_COST_ATTRIBUTION_V1_CONTRACT_FAILED",

      checks,

      sample: {
        base,
        fallback,
      },

      policy: {
        sellTaxRate:
          PAPER_EXECUTION_COST_ATTRIBUTION_POLICY
            .sellTaxRate,

        fallbackBrokerFeeRate:
          PAPER_EXECUTION_COST_ATTRIBUTION_POLICY
            .fallbackBrokerFeeRate,

        slippageAccounting:
          PAPER_EXECUTION_COST_ATTRIBUTION_POLICY
            .slippageAccounting,
      },

      safety: {
        databaseReads:
          0,
        databaseWrites:
          0,
        ordersCreated:
          0,
        ordersExecuted:
          0,
        positionsChanged:
          0,
        realTradingEnabled:
          false,
      },

      failed,

      nextGate:
        failed.length === 0
          ? "STATIC_VERIFY_THEN_REVIEW_DB_APPLY"
          : "REPAIR_COST_ATTRIBUTION_MATH",
    },
    null,
    2,
  ),
);

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
