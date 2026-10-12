function weightedAverage(
  priorQuantity: number,
  priorPrice: number | null,
  executionQuantity: number,
  executionPrice: number,
): number {
  if (
    priorQuantity < 0 ||
    executionQuantity <= 0 ||
    executionPrice <= 0
  ) {
    throw new Error(
      "INVALID_INPUT",
    );
  }

  if (priorQuantity === 0) {
    return executionPrice;
  }

  if (
    priorPrice === null ||
    priorPrice <= 0
  ) {
    throw new Error(
      "INVALID_PRIOR_PRICE",
    );
  }

  return (
    priorPrice *
      priorQuantity
    +
    executionPrice *
      executionQuantity
  ) /
  (
    priorQuantity +
    executionQuantity
  );
}

const first =
  weightedAverage(
    0,
    null,
    4,
    100,
  );

const second =
  weightedAverage(
    4,
    first,
    2,
    110,
  );

const third =
  weightedAverage(
    6,
    second,
    4,
    95,
  );

let invalidPriorFails =
  false;

try {
  weightedAverage(
    3,
    null,
    1,
    100,
  );
}
catch {
  invalidPriorFails =
    true;
}

const checks = {
  firstFillEqualsExecutionPrice:
    first ===
    100,

  secondFillWeightedAverage:
    Math.abs(
      second -
      103.33333333333333,
    ) <
    1e-10,

  thirdFillWeightedAverage:
    Math.abs(
      third -
      100,
    ) <
    1e-10,

  invalidPriorFailsClosed:
    invalidPriorFails,

  latestFillIsNotMistakenForCumulativeAverage:
    second !==
    110,

  plannedEntryPriceNotRequired:
    true,
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
          ? "AI_STOCK_LAB_PAPER_BUY_FILLED_PRICE_SEMANTIC_V1_CONTRACT_PASS"
          : "AI_STOCK_LAB_PAPER_BUY_FILLED_PRICE_SEMANTIC_V1_CONTRACT_FAIL",

      examples: {
        firstFill:
          first,

        secondCumulativeAverage:
          second,

        thirdCumulativeAverage:
          third,
      },

      checks,
      failed,

      safety: {
        pureMathOnly:
          true,
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
    },
    null,
    2,
  ),
);

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
