import {
  strict as assert,
} from "node:assert";

import {
  DEFAULT_PAPER_EXECUTION_PRICE_POLICY,
  evaluatePaperExecutionPriceSnapshot,
} from "../lib/trading/paper-execution-price-model";

function main() {
  const now =
    new Date(
      "2026-10-08T06:00:00.000Z",
    );

  const checks:
    Record<
      string,
      boolean
    > = {};

  const fresh =
    evaluatePaperExecutionPriceSnapshot({
      stockCode:
        "005930",

      snapshot: {
        stock_code:
          "005930",

        close_price:
          101_000,

        observed_at:
          "2026-10-08T05:55:00.000Z",
      },

      now,
    });

  checks.freshSnapshotUsedAsExecutionPrice =
    fresh.usable ===
      true &&
    fresh.executionPrice ===
      101_000 &&
    fresh.source ===
      "MARKET_SNAPSHOT_CLOSE";

  const stale =
    evaluatePaperExecutionPriceSnapshot({
      stockCode:
        "005930",

      snapshot: {
        stock_code:
          "005930",

        close_price:
          101_000,

        observed_at:
          "2026-10-08T05:40:00.000Z",
      },

      now,
    });

  checks.staleSnapshotFailsClosed =
    stale.usable ===
      false &&
    stale.blocker ===
      "SNAPSHOT_STALE";

  const missing =
    evaluatePaperExecutionPriceSnapshot({
      stockCode:
        "005930",

      snapshot:
        null,

      now,
    });

  checks.missingSnapshotFailsClosed =
    missing.usable ===
      false &&
    missing.blocker ===
      "SNAPSHOT_NOT_FOUND";

  const invalidPrice =
    evaluatePaperExecutionPriceSnapshot({
      stockCode:
        "005930",

      snapshot: {
        stock_code:
          "005930",

        close_price:
          0,

        observed_at:
          "2026-10-08T05:59:00.000Z",
      },

      now,
    });

  checks.invalidPriceFailsClosed =
    invalidPrice.usable ===
      false &&
    invalidPrice.blocker ===
      "SNAPSHOT_PRICE_INVALID";

  const future =
    evaluatePaperExecutionPriceSnapshot({
      stockCode:
        "005930",

      snapshot: {
        stock_code:
          "005930",

        close_price:
          101_000,

        observed_at:
          "2026-10-08T06:01:00.000Z",
      },

      now,
    });

  checks.futureSnapshotBeyondClockSkewBlocked =
    future.usable ===
      false &&
    future.blocker ===
      "SNAPSHOT_FROM_FUTURE";

  checks.noSyntheticRandomSlippage =
    fresh.semantics
      .syntheticRandomSlippage ===
      false;

  checks.noEntryFallback =
    fresh.semantics
      .plannedEntryPriceUsedAsFillFallback ===
      false;

  checks.defaultFreshnessTenMinutes =
    DEFAULT_PAPER_EXECUTION_PRICE_POLICY
      .maxSnapshotAgeMs ===
      10 * 60_000;

  assert.equal(
    fresh.usable,
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
            ? "ALPHA_V3_PAPER_EXECUTION_PRICE_MODEL_V1_CONTRACT_VERIFIED"
            : "ALPHA_V3_PAPER_EXECUTION_PRICE_MODEL_V1_CONTRACT_REVIEW",

        checks,

        failed,

        policy: {
          source:
            "LATEST_MARKET_SNAPSHOT_CLOSE",

          maxSnapshotAgeMinutes:
            10,

          syntheticRandomSlippage:
            false,

          plannedEntryFallback:
            false,

          staleOrMissing:
            "FAIL_CLOSED",
        },

        productionBinding:
          false,

        safety: {
          databaseReads:
            0,

          databaseWrites:
            0,

          networkCalls:
            0,

          ordersCreated:
            0,

          positionsChanged:
            0,
        },

        nextGate:
          failed.length ===
          0
            ? "BIND_SAFE_EXECUTION_RESOLVER_TO_PAPER_BUY_EXECUTOR"
            : "REVIEW_EXECUTION_PRICE_MODEL",
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
