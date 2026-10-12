import {
  strict as assert,
} from "node:assert";

import {
  evaluateBuyExecutionGapSlippageRisk,
  evaluateProtectiveExitGap,
} from "../lib/trading/gap-slippage-risk";

import {
  evaluatePaperExecutionPriceSnapshot,
} from "../lib/trading/paper-execution-price-model";

function main() {
  const checks:
    Record<
      string,
      boolean
    > = {};

  const now =
    new Date(
      "2026-10-08T06:00:00.000Z",
    );

  const price =
    evaluatePaperExecutionPriceSnapshot({
      stockCode:
        "005930",

      snapshot: {
        stock_code:
          "005930",

        close_price:
          100_500,

        observed_at:
          "2026-10-08T05:59:00.000Z",
      },

      now,
    });

  assert.equal(
    price.usable,
    true,
  );

  const safe =
    evaluateBuyExecutionGapSlippageRisk({
      stockCode:
        "005930",

      plannedEntryPrice:
        100_000,

      executionPrice:
        price.executionPrice!,

      stopPrice:
        97_000,

      quantity:
        1,

      accountEquity:
        10_000_000,

      reservedRiskAmount:
        4_000,
    });

  checks.safeFreshExecutionAllowed =
    safe.allowed ===
      true &&
    safe.drift.adverseRate ===
      0.005;

  const reservedExceeded =
    evaluateBuyExecutionGapSlippageRisk({
      stockCode:
        "005930",

      plannedEntryPrice:
        100_000,

      executionPrice:
        100_500,

      stopPrice:
        97_000,

      quantity:
        1,

      accountEquity:
        10_000_000,

      reservedRiskAmount:
        3_000,
    });

  checks.reservedRiskExceededBlocked =
    reservedExceeded.allowed ===
      false &&
    reservedExceeded.blockers.includes(
      "ACTUAL_TRADE_RISK_EXCEEDS_RESERVED_RISK",
    );

  const driftExceeded =
    evaluateBuyExecutionGapSlippageRisk({
      stockCode:
        "005930",

      plannedEntryPrice:
        100_000,

      executionPrice:
        101_500,

      stopPrice:
        97_000,

      quantity:
        1,

      accountEquity:
        10_000_000,

      reservedRiskAmount:
        10_000,
    });

  checks.adverseDriftBlocked =
    driftExceeded.allowed ===
      false &&
    driftExceeded.blockers.includes(
      "ADVERSE_ENTRY_DRIFT_EXCEEDED",
    );

  const exit =
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

  checks.protectiveExitStillAllowed =
    exit.allowed ===
      true &&
    exit.additionalLossAmount ===
      50_000;

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
            ? "ALPHA_V3_GAP_SLIPPAGE_EXECUTION_BINDING_V1_CONTRACT_VERIFIED"
            : "ALPHA_V3_GAP_SLIPPAGE_EXECUTION_BINDING_V1_CONTRACT_REVIEW",

        checks,

        failed,

        invariants: {
          actualExecutionPrice:
            "LATEST_FRESH_MARKET_SNAPSHOT_CLOSE",

          unsafeBuy:
            "FAILED_TERMINAL_NO_FILL",

          terminalReservationRelease:
            "EXISTING_DB_TRIGGER",

          dbDefense:
            "EXECUTION_PRICE_DRIFT_STOP_DISTANCE_RESERVED_RISK_REVALIDATED",

          protectiveExit:
            "UNCHANGED_NEVER_BLOCKED_BY_GAP",
        },

        safety: {
          realDatabaseCalls:
            0,

          databaseWrites:
            0,

          ordersCreated:
            0,

          positionsChanged:
            0,
        },
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
