const fs = require("fs");
const path = require("path");

const root =
  process.cwd();

const model =
  fs.readFileSync(
    path.resolve(
      root,
      "lib/trading/paper-execution-price-model.ts"
    ),
    "utf8"
  );

const resolver =
  fs.readFileSync(
    path.resolve(
      root,
      "lib/trading/paper-execution-price-resolver.ts"
    ),
    "utf8"
  );

const safe =
  fs.readFileSync(
    path.resolve(
      root,
      "lib/trading/resolve-safe-paper-buy-execution.ts"
    ),
    "utf8"
  );

const checks = {
  latestSnapshotClose:
    resolver.includes(
      '"market_snapshots"'
    ) &&
    resolver.includes(
      '"stock_code,close_price,observed_at"'
    ) &&
    resolver.includes(
      '"observed_at"'
    ),

  freshTenMinutePolicy:
    model.includes(
      "10 * 60_000"
    ),

  noRandomSlippage:
    model.includes(
      "syntheticRandomSlippage:\n        false"
    ),

  noEntryFallback:
    model.includes(
      "plannedEntryPriceUsedAsFillFallback:\n        false"
    ),

  staleFailsClosed:
    model.includes(
      '"SNAPSHOT_STALE"'
    ) &&
    model.includes(
      "missingOrStaleMarketPriceFailsClosed:\n        true"
    ),

  compositeUsesGapSlippageGuard:
    safe.includes(
      "evaluateBuyExecutionGapSlippageRisk"
    ),

  compositeUsesPriceResolver:
    safe.includes(
      "resolvePaperExecutionPrice"
    ),

  unsafeBuyFailsClosed:
    safe.includes(
      "unsafeBuyFailsClosed:\n          true"
    ),

  productionExecutorNotYetPatched:
    !fs
      .readFileSync(
        path.resolve(
          root,
          "lib/trading/execute-paper-order.ts"
        ),
        "utf8"
      )
      .includes(
        "resolveSafePaperBuyExecution"
      )
};

const failed =
  Object.entries(
    checks
  )
    .filter(
      ([, value]) =>
        !value
    )
    .map(
      ([name]) =>
        name
    );

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "ALPHA_V3_PAPER_EXECUTION_PRICE_MODEL_V1_STATIC_VERIFIED"
          : "ALPHA_V3_PAPER_EXECUTION_PRICE_MODEL_V1_STATIC_REVIEW",

      checks,

      failed,

      productionBinding:
        false,

      safety: {
        databaseWrites:
          0,

        ordersCreated:
          0,

        positionsChanged:
          0
      },

      nextGate:
        failed.length === 0
          ? "CONTRACT_TYPESCRIPT_THEN_EXECUTOR_BINDING"
          : "REVIEW_EXECUTION_PRICE_MODEL_V1"
    },
    null,
    2
  )
);

if (
  failed.length >
  0
) {
  process.exitCode =
    2;
}
