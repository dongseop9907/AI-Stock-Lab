const fs = require("fs");
const path = require("path");

const root = process.cwd();

const rel =
  "scripts/alpha-v3-index-gap-calendar-repair-v1.ts";

const file =
  path.resolve(
    root,
    rel
  );

if (!fs.existsSync(file)) {
  throw new Error(
    "REPAIR_SCRIPT_NOT_FOUND"
  );
}

const before =
  fs.readFileSync(
    file,
    "utf8"
  );

const oldBlock = `  const syncResult =
    await syncIndexDailyBars({
      markets: [
        "KOSPI",
        "KOSDAQ",
      ],
      startDate:
        "2026-09-04",
      endDate:
        "2026-09-18",
    });`;

const newBlock = `  const syncResult =
    await syncIndexDailyBars({
      markets: [
        "KOSPI",
        "KOSDAQ",
      ],

      /*
       * syncIndexDailyBars uses the KIS compact-date contract.
       * DB verification below continues to use SQL YYYY-MM-DD dates.
       */
      startDate:
        "20260904",

      endDate:
        "20260918",
    });`;

let after =
  before;

if (
  before.includes(
    oldBlock
  )
) {
  after =
    before.replace(
      oldBlock,
      newBlock
    );
} else if (
  before.includes(
    '"20260904"'
  ) &&
  before.includes(
    '"20260918"'
  )
) {
  /*
   * Idempotent re-run.
   */
} else {
  throw new Error(
    "EXPECTED_SYNC_INDEX_DATE_BLOCK_NOT_FOUND"
  );
}

fs.writeFileSync(
  file,
  after,
  "utf8"
);

const persisted =
  fs.readFileSync(
    file,
    "utf8"
  );

const checks = {
  compactStartDate:
    persisted.includes(
      'startDate:\n        "20260904"'
    ),

  compactEndDate:
    persisted.includes(
      'endDate:\n        "20260918"'
    ),

  sqlTargetDatesPreserved:
    persisted.includes(
      '"2026-09-04"'
    ) &&
    persisted.includes(
      '"2026-09-18"'
    ),

  kospiPreserved:
    persisted.includes(
      '"KOSPI"'
    ),

  kosdaqPreserved:
    persisted.includes(
      '"KOSDAQ"'
    ),

  calendarOverridesPreserved:
    persisted.includes(
      '"2026-09-24"'
    ) &&
    persisted.includes(
      '"2026-09-25"'
    ) &&
    persisted.includes(
      '"2026-10-05"'
    ),

  noOrderEndpoints:
    !persisted.includes(
      "/api/orders/"
    ) &&
    !persisted.includes(
      "/api/trading/automation/"
    ) &&
    !persisted.includes(
      "/api/signals/entry/"
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
          ? "ALPHA_V3_INDEX_GAP_CALENDAR_REPAIR_DATE_FORMAT_FIX_V1_VERIFIED"
          : "ALPHA_V3_INDEX_GAP_CALENDAR_REPAIR_DATE_FORMAT_FIX_V1_REVIEW",

      patchedFile:
        rel,

      diagnosis: {
        rootCause:
          "SYNC_INDEX_DAILY_BARS_REQUIRES_YYYYMMDD",

        previousValues: {
          startDate:
            "2026-09-04",
          endDate:
            "2026-09-18"
        },

        correctedValues: {
          startDate:
            "20260904",
          endDate:
            "20260918"
        }
      },

      checks,
      failed,

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
          0
      },

      nextAction:
        failed.length === 0
          ? "RERUN_STATIC_VERIFY_AND_ONE_TIME_REPAIR"
          : "REVIEW_REPAIR_SCRIPT_DATE_BINDING"
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
