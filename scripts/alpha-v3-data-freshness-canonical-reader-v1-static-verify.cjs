const fs = require("fs");
const path = require("path");

const root = process.cwd();

const rel =
  "lib/trading/data-freshness-canonical-reader.ts";

const text =
  fs.readFileSync(
    path.resolve(
      root,
      rel,
    ),
    "utf8",
  );

const checks = {
  canonicalVersion:
    text.includes(
      "ALPHA_V3_DATA_FRESHNESS_CANONICAL_READER_V1",
    ),

  freshnessTable:
    text.includes(
      '"market_data_freshness_observations"',
    ),

  qualityGateTable:
    text.includes(
      '"market_data_quality_gate_observations"',
    ),

  observedAtDescending:
    (
      text.match(
        /"observed_at"/g,
      ) || []
    ).length >= 2 &&
    text.includes(
      "ascending: false",
    ),

  createdAtTieBreaker:
    (
      text.match(
        /"created_at"/g,
      ) || []
    ).length >= 2,

  failClosedOnMissingFreshness:
    text.includes(
      "FRESHNESS_OBSERVATION_MISSING",
    ),

  failClosedOnMissingQuality:
    text.includes(
      "QUALITY_GATE_OBSERVATION_MISSING",
    ),

  requiresZeroBusinessDayLag:
    text.includes(
      "business_weekday_lag",
    ) &&
    text.includes(
      "=== 0",
    ),

  requiresAlignment:
    text.includes(
      "all_source_dates_aligned",
    ) &&
    text.includes(
      "index_date_aligned",
    ),

  productionAppliedMetadataOnly:
    text.includes(
      "production_applied is retained as provenance metadata only",
    ),
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
          ? "ALPHA_V3_DATA_FRESHNESS_CANONICAL_READER_V1_STATIC_VERIFIED"
          : "ALPHA_V3_DATA_FRESHNESS_CANONICAL_READER_V1_STATIC_REVIEW",

      checks,
      failed,

      safety: {
        databaseReads:
          0,

        databaseWrites:
          0,

        productionBindingChanged:
          false,
      },

      nextGate:
        failed.length === 0
          ? "RUN_READER_CONTRACT_AND_LIVE_VERIFY"
          : "REVIEW_CANONICAL_READER_STATIC",
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
