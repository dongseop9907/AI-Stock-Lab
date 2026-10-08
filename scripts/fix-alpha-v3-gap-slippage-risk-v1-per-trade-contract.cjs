const fs = require("fs");
const path = require("path");

const root = process.cwd();

const testPath = path.resolve(
  root,
  "scripts/alpha-v3-gap-slippage-risk-v1-contract-test.ts",
);

if (!fs.existsSync(testPath)) {
  throw new Error(
    "GAP_SLIPPAGE_CONTRACT_TEST_NOT_FOUND",
  );
}

const before = fs.readFileSync(
  testPath,
  "utf8",
);

const oldBlock = `  const perTradeExceeded =
    evaluateBuyExecutionGapSlippageRisk(
      base({
        plannedEntryPrice:
          100_000,

        executionPrice:
          104_000,

        stopPrice:
          99_000,

        quantity:
          2,

        reservedRiskAmount:
          100_000,
      }),
    );`;

const newBlock = `  const perTradeExceeded =
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
    );`;

let after = before;

if (before.includes(oldBlock)) {
  after = before.replace(
    oldBlock,
    newBlock,
  );
} else if (
  before.includes("accountEquity:\n          1_000_000") &&
  before.includes("quantity:\n          4") &&
  before.includes("executionPrice:\n          100_500")
) {
  // Idempotent rerun.
} else {
  throw new Error(
    "EXPECTED_PER_TRADE_TEST_BLOCK_NOT_FOUND",
  );
}

fs.writeFileSync(
  testPath,
  after,
  "utf8",
);

const finalText = fs.readFileSync(
  testPath,
  "utf8",
);

const checks = {
  accountEquityOneMillion:
    finalText.includes(
      "accountEquity:\n          1_000_000",
    ),

  executionPrice100500:
    finalText.includes(
      "executionPrice:\n          100_500",
    ),

  stopPrice99000:
    finalText.includes(
      "stopPrice:\n          99_000",
    ),

  quantityFour:
    finalText.includes(
      "quantity:\n          4",
    ),

  reservedRiskAmple:
    finalText.includes(
      "reservedRiskAmount:\n          100_000",
    ),

  expectedBlockerStillAsserted:
    finalText.includes(
      '"ACTUAL_TRADE_RISK_EXCEEDS_PER_TRADE_LIMIT"',
    ),
};

const failed = Object.entries(checks)
  .filter(([, value]) => !value)
  .map(([name]) => name);

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "ALPHA_V3_GAP_SLIPPAGE_RISK_V1_PER_TRADE_CONTRACT_FIXED"
          : "ALPHA_V3_GAP_SLIPPAGE_RISK_V1_PER_TRADE_CONTRACT_REVIEW",

      diagnosis: {
        productionLogicBug: false,
        testFixtureBug: true,
        previousMath: {
          accountEquity: 10000000,
          maxRiskRate: 0.005,
          maxTradeRiskAmount: 50000,
          executionPrice: 104000,
          stopPrice: 99000,
          quantity: 2,
          actualTradeRisk: 10000,
          shouldExceedPerTradeLimit: false,
        },
        correctedMath: {
          accountEquity: 1000000,
          maxRiskRate: 0.005,
          maxTradeRiskAmount: 5000,
          executionPrice: 100500,
          stopPrice: 99000,
          quantity: 4,
          actualTradeRisk: 6000,
          adverseDriftRate: 0.005,
          approximateStopDistanceRate: 0.014925,
          shouldExceedPerTradeLimit: true,
        },
      },

      patchedFile:
        "scripts/alpha-v3-gap-slippage-risk-v1-contract-test.ts",

      productionModulePatched:
        false,

      checks,
      failed,

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        networkCalls: 0,
        ordersCreated: 0,
        ordersChanged: 0,
        positionsChanged: 0,
      },

      nextGate:
        failed.length === 0
          ? "RERUN_CONTRACT_TYPESCRIPT_AND_EXECUTION_SURFACE_PROBE"
          : "REVIEW_TEST_FIXTURE",
    },
    null,
    2,
  ),
);

if (failed.length > 0) {
  process.exitCode = 2;
}
