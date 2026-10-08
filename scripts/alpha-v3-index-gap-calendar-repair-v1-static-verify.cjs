const fs = require("fs");
const path = require("path");

const file =
  path.resolve(
    process.cwd(),
    "scripts/alpha-v3-index-gap-calendar-repair-v1.ts"
  );

const text =
  fs.readFileSync(
    file,
    "utf8"
  );

const requiredDates = [
  "2026-09-04",
  "2026-09-07",
  "2026-09-08",
  "2026-09-09",
  "2026-09-10",
  "2026-09-11",
  "2026-09-14",
  "2026-09-15",
  "2026-09-16",
  "2026-09-17",
  "2026-09-18",
  "2026-09-24",
  "2026-09-25",
  "2026-10-05"
];

const checks = {
  usesExistingIndexSync:
    text.includes(
      "syncIndexDailyBars"
    ),

  indexOnlyMarkets:
    text.includes(
      '"KOSPI"'
    ) &&
    text.includes(
      '"KOSDAQ"'
    ),

  exactGapRange:
    text.includes(
      '"2026-09-04"'
    ) &&
    text.includes(
      '"2026-09-18"'
    ),

  allTargetDatesPresent:
    requiredDates.every(
      (date) =>
        text.includes(
          `"${date}"`
        )
    ),

  verifiedClosedOverrides:
    text.includes(
      "verified:" +
        "\n          true"
    ) &&
    text.includes(
      "is_open:" +
        "\n          false"
    ),

  existingProjectSourceConvention:
    text.includes(
      '"MANUAL_VERIFIED_KRX_CALENDAR"'
    ),

  noOrderEndpoints:
    !text.includes(
      "/api/orders/"
    ) &&
    !text.includes(
      "/api/trading/automation/"
    ) &&
    !text.includes(
      "/api/signals/entry/"
    ),

  noTradingTableNames:
    !/paper_order|paper_position|trading_order|trade_execution/i.test(
      text
    ),

  conflictFailsClosed:
    text.includes(
      "VERIFIED_OPEN_OVERRIDE_CONFLICT"
    ),

  postVerification:
    text.includes(
      "missingAfter"
    ) &&
    text.includes(
      "allOverridesVerifiedClosed"
    ),
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
          ? "ALPHA_V3_INDEX_GAP_CALENDAR_REPAIR_V1_STATIC_VERIFIED"
          : "ALPHA_V3_INDEX_GAP_CALENDAR_REPAIR_V1_STATIC_REVIEW",

      checks,
      failed,

      repairScope: {
        indexBackfill:
          "KOSPI_KOSDAQ_2026-09-04_TO_2026-09-18",

        verifiedClosures: [
          "2026-09-24",
          "2026-09-25",
          "2026-10-05"
        ]
      },

      safety: {
        networkCalls:
          0,

        databaseWrites:
          0,

        productionOrderEndpointCalled:
          false
      },

      nextGate:
        failed.length === 0
          ? "EXECUTE_ONE_TIME_INDEX_AND_CALENDAR_REPAIR"
          : "REVIEW_REPAIR_SCRIPT"
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
