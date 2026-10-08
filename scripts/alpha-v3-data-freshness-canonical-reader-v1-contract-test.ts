import {
  buildCanonicalDataFreshnessState,
  type FreshnessObservationRow,
  type QualityGateObservationRow,
} from "../lib/trading/data-freshness-canonical-reader";

import {
  evaluateDataFreshnessProductionAction,
} from "../lib/trading/data-freshness-production-contract";

const freshnessBase:
  FreshnessObservationRow = {
    observed_at:
      "2026-10-08T07:00:00Z",

    status:
      "FRESH",

    usable_for_shadow_comparison:
      true,

    expected_market_date:
      "2026-10-08",

    kospi_latest_date:
      "2026-10-08",

    kosdaq_latest_date:
      "2026-10-08",

    stock_latest_date:
      "2026-10-08",

    oldest_active_stock_latest_date:
      "2026-10-08",

    business_weekday_lag:
      0,

    index_date_aligned:
      true,

    all_source_dates_aligned:
      true,

    production_applied:
      false,

    created_at:
      "2026-10-08T07:00:01Z",
  };

const qualityBase:
  QualityGateObservationRow = {
    observed_at:
      "2026-10-08T07:00:02Z",

    status:
      "PASS",

    usable_for_forward_shadow:
      true,

    expected_market_date:
      "2026-10-08",

    freshness_status:
      "FRESH",

    integrity_scan_id:
      null,

    integrity_status:
      "PASS",

    integrity_window_end_date:
      "2026-10-08",

    integrity_finished_at:
      "2026-10-08T07:00:01Z",

    production_applied:
      false,

    created_at:
      "2026-10-08T07:00:03Z",
  };

const fresh =
  buildCanonicalDataFreshnessState(
    freshnessBase,
    qualityBase,
  );

const stale =
  buildCanonicalDataFreshnessState(
    {
      ...freshnessBase,
      status:
        "STALE",
      stock_latest_date:
        "2026-10-07",
      business_weekday_lag:
        1,
      usable_for_shadow_comparison:
        false,
    },
    {
      ...qualityBase,
      status:
        "FAIL_FRESHNESS",
      usable_for_forward_shadow:
        false,
      freshness_status:
        "STALE",
    },
  );

const misaligned =
  buildCanonicalDataFreshnessState(
    {
      ...freshnessBase,
      all_source_dates_aligned:
        false,
    },
    qualityBase,
  );

const freshDecision =
  evaluateDataFreshnessProductionAction(
    fresh,
    "PAPER_BUY_CREATE",
  );

const staleDecision =
  evaluateDataFreshnessProductionAction(
    stale,
    "PAPER_BUY_CREATE",
  );

const misalignedDecision =
  evaluateDataFreshnessProductionAction(
    misaligned,
    "PAPER_BUY_EXECUTE",
  );

const checks = {
  freshCanonicalUsable:
    fresh.freshnessStatus ===
      "FRESH" &&
    fresh.usableForProduction ===
      true,

  productionAppliedNotRequiredForDataUsability:
    fresh.freshnessProductionApplied ===
      false &&
    fresh.qualityProductionApplied ===
      false &&
    fresh.usableForProduction ===
      true,

  freshAllowsNewRisk:
    freshDecision.allowed ===
      true,

  staleCanonicalBlocked:
    stale.freshnessStatus ===
      "STALE" &&
    stale.usableForProduction ===
      false,

  staleBlocksNewRisk:
    staleDecision.allowed ===
      false &&
    staleDecision.reason ===
      "STALE_MARKET_DATA",

  alignmentFailureBecomesDateMismatch:
    misaligned.freshnessStatus ===
      "DATE_MISMATCH" &&
    misaligned.usableForProduction ===
      false,

  alignmentFailureBlocksExecution:
    misalignedDecision.allowed ===
      false &&
    misalignedDecision.reason ===
      "MARKET_DATE_MISMATCH",
};

const failed =
  Object.entries(checks)
    .filter(
      ([, value]) => !value,
    )
    .map(
      ([key]) => key,
    );

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "ALPHA_V3_DATA_FRESHNESS_CANONICAL_READER_V1_CONTRACT_VERIFIED"
          : "ALPHA_V3_DATA_FRESHNESS_CANONICAL_READER_V1_CONTRACT_REVIEW",

      checks,
      failed,

      samples: {
        fresh: {
          freshnessStatus:
            fresh.freshnessStatus,

          qualityStatus:
            fresh.qualityStatus,

          usableForProduction:
            fresh.usableForProduction,

          decision:
            freshDecision.reason,
        },

        stale: {
          freshnessStatus:
            stale.freshnessStatus,

          qualityStatus:
            stale.qualityStatus,

          usableForProduction:
            stale.usableForProduction,

          decision:
            staleDecision.reason,
        },

        misaligned: {
          freshnessStatus:
            misaligned.freshnessStatus,

          usableForProduction:
            misaligned.usableForProduction,

          decision:
            misalignedDecision.reason,
        },
      },

      nextGate:
        failed.length === 0
          ? "RUN_LIVE_CANONICAL_READER_VERIFY"
          : "REVIEW_CANONICAL_READER_CONTRACT",
    },
    null,
    2,
  ),
);

if (
  failed.length > 0
) {
  process.exitCode = 2;
}
