import assert from "node:assert/strict";

import {
  buildMaturitySchedule,
} from "./true-forward-oos-post-capture-maturity-audit-v1";

function main() {
  const hangeulBoundaryBefore =
    buildMaturitySchedule(
      {
        sourceTradingDate:
          "2026-10-07",

        targetSessionDate:
          "2026-10-08",

        capturedAt:
          "2026-10-08T08:50:00+09:00",

        candidateCount:
          1,
      },
      new Date(
        "2026-10-09T12:00:00+09:00",
      ),
    );

  const hangeulBoundaryMature =
    buildMaturitySchedule(
      {
        sourceTradingDate:
          "2026-10-07",

        targetSessionDate:
          "2026-10-08",

        capturedAt:
          "2026-10-08T08:50:00+09:00",

        candidateCount:
          1,
      },
      new Date(
        "2026-10-12T12:00:00+09:00",
      ),
    );

  const friday =
    buildMaturitySchedule(
      {
        sourceTradingDate:
          "2026-10-15",

        targetSessionDate:
          "2026-10-16",

        capturedAt:
          "2026-10-16T08:50:00+09:00",

        candidateCount:
          1,
      },
      new Date(
        "2026-10-23T16:00:00+09:00",
      ),
    );

  const checks = {
    hangeulDaySkippedFor1D:
      hangeulBoundaryBefore
        .maturityDates["1D"] ===
        "2026-10-12",

    hangeulDayBoundaryNotReadyOnHoliday:
      hangeulBoundaryBefore
        .ready["1D"] ===
        false,

    hangeulDayBoundaryReadyOnNextOpen:
      hangeulBoundaryMature
        .ready["1D"] ===
        true,

    hangeulBoundary3D:
      hangeulBoundaryBefore
        .maturityDates["3D"] ===
        "2026-10-14",

    hangeulBoundary5D:
      hangeulBoundaryBefore
        .maturityDates["5D"] ===
        "2026-10-16",

    fridayWeekendSkipped1D:
      friday
        .maturityDates["1D"] ===
        "2026-10-19",

    fridayWeekendSkipped3D:
      friday
        .maturityDates["3D"] ===
        "2026-10-21",

    fridayWeekendSkipped5D:
      friday
        .maturityDates["5D"] ===
        "2026-10-23",

    fridayAllReadyBy5DDate:
      friday.ready["1D"] ===
        true &&
      friday.ready["3D"] ===
        true &&
      friday.ready["5D"] ===
        true,
  };

  for (
    const [
      key,
      value,
    ] of Object.entries(
      checks
    )
  ) {
    assert.equal(
      value,
      true,
      key
    );
  }

  console.log(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_KRX_TRADING_SESSION_MATURITY_V1_CONTRACT_VERIFIED",

        checks,

        observations: {
          hangeulBoundaryBefore,
          hangeulBoundaryMature,
          friday,
        },

        safety: {
          databaseReads:
            0,

          databaseWrites:
            0,

          ordersCreated:
            0,

          positionsChanged:
            0,

          promotionExecuted:
            false,

          realTradingEnabled:
            false,
        },

        failed:
          [],

        nextGate:
          "STATIC_VERIFY_AND_RUN_CURRENT_MATURITY_AUDIT",
      },
      null,
      2,
    ),
  );
}

main();
