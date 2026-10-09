const fs = require("fs");
const path = require("path");

const root = process.cwd();

const model =
  path.resolve(
    root,
    "lib/trading/paper-execution-realism-v2.ts"
  );

const contract =
  path.resolve(
    root,
    "scripts/paper-execution-realism-v2-contract-test.ts"
  );

const modelSource =
  fs.readFileSync(model, "utf8");

const contractSource =
  fs.readFileSync(contract, "utf8");

const checks = {
  versionPresent:
    modelSource.includes("PAPER_EXECUTION_REALISM_V2"),

  bidAskPresent:
    modelSource.includes("BEST_ASK") &&
    modelSource.includes("BEST_BID"),

  partialFillPresent:
    modelSource.includes("filledQuantity") &&
    modelSource.includes("unfilledQuantity") &&
    modelSource.includes("maxParticipationRate"),

  marketImpactPresent:
    modelSource.includes("marketImpactBps") &&
    modelSource.includes("Math.sqrt"),

  transactionCostPresent:
    modelSource.includes("brokerFeeEachSideRate") &&
    modelSource.includes("sellTaxRate"),

  quoteFreshnessPresent:
    modelSource.includes("maxQuoteAgeMs") &&
    modelSource.includes("STALE_QUOTE"),

  noDatabaseImports:
    !/supabase|postgres|prisma|drizzle/i.test(
      modelSource
    ),

  noNetworkCalls:
    !/\bfetch\s*\(|axios|https?:\/\//i.test(
      modelSource
    ),

  noOrderWrites:
    !/paper_order_requests|paper_positions|trade_orders/i.test(
      modelSource
    ),

  contractPresent:
    contractSource.includes(
      "PAPER_EXECUTION_REALISM_V2_CONTRACT_VERIFIED"
    ),
};

const ok =
  Object.values(checks).every(Boolean);

console.log(
  JSON.stringify(
    {
      status: ok
        ? "PAPER_EXECUTION_REALISM_V2_STATIC_VERIFIED"
        : "PAPER_EXECUTION_REALISM_V2_STATIC_FAILED",
      checks,
    },
    null,
    2,
  ),
);

if (!ok) {
  process.exitCode = 1;
}
