import fs from "node:fs";
import path from "node:path";

import {
  createClient,
} from "@supabase/supabase-js";

import {
  syncIndexDailyBars,
} from "../lib/market/sync-index-daily-bars";

const TARGET_INDEX_DATES = [
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
] as const;

const VERIFIED_CLOSED_DATES = [
  {
    calendar_date:
      "2026-09-24",

    reason:
      "2026 Chuseok public-holiday closure; KRX holiday period begins 2026-09-24.",
  },
  {
    calendar_date:
      "2026-09-25",

    reason:
      "2026 Chuseok public-holiday closure.",
  },
  {
    calendar_date:
      "2026-10-05",

    reason:
      "2026-10-05 substitute public holiday closure associated with National Foundation Day.",
  },
] as const;

function env(
  ...names:
    string[]
): string {
  for (const name of names) {
    const value =
      process.env[name]?.trim();

    if (value) {
      return value;
    }
  }

  throw new Error(
    `MISSING_ENV:${names.join("|")}`,
  );
}

function key(
  market:
    string,
  date:
    string,
) {
  return `${market}:${date}`;
}

async function main() {
  const supabase =
    createClient(
      env(
        "NEXT_PUBLIC_SUPABASE_URL",
        "SUPABASE_URL",
      ),
      env(
        "SUPABASE_SERVICE_ROLE_KEY",
        "SUPABASE_SERVICE_KEY",
      ),
      {
        auth: {
          persistSession:
            false,
          autoRefreshToken:
            false,
        },
      },
    );

  const holidayDates =
    VERIFIED_CLOSED_DATES.map(
      (row) =>
        row.calendar_date,
    );

  const {
    data:
      beforeOverrides,
    error:
      beforeOverridesError,
  } =
    await supabase
      .from(
        "market_exchange_calendar_overrides",
      )
      .select(
        "exchange_code,calendar_date,is_open,verified,reason,source",
      )
      .eq(
        "exchange_code",
        "KRX",
      )
      .in(
        "calendar_date",
        holidayDates,
      )
      .order(
        "calendar_date",
        {
          ascending:
            true,
        },
      );

  if (beforeOverridesError) {
    throw new Error(
      `OVERRIDE_PRECHECK_FAILED:${beforeOverridesError.message}`,
    );
  }

  const conflictingOpen =
    (
      beforeOverrides ??
      []
    ).filter(
      (row:
        any) =>
        row.verified ===
          true &&
        row.is_open ===
          true,
    );

  if (
    conflictingOpen.length >
    0
  ) {
    throw new Error(
      "VERIFIED_OPEN_OVERRIDE_CONFLICT:" +
      JSON.stringify(
        conflictingOpen,
      ),
    );
  }

  const {
    data:
      beforeIndex,
    error:
      beforeIndexError,
  } =
    await supabase
      .from(
        "market_index_daily_bars",
      )
      .select(
        "market_code,trading_date",
      )
      .in(
        "market_code",
        [
          "KOSPI",
          "KOSDAQ",
        ],
      )
      .in(
        "trading_date",
        [
          ...TARGET_INDEX_DATES,
        ],
      );

  if (beforeIndexError) {
    throw new Error(
      `INDEX_PRECHECK_FAILED:${beforeIndexError.message}`,
    );
  }

  const beforeSet =
    new Set(
      (
        beforeIndex ??
        []
      ).map(
        (row:
          any) =>
          key(
            String(
              row.market_code,
            ),
            String(
              row.trading_date,
            ),
          ),
      ),
    );

  const missingBefore =
    TARGET_INDEX_DATES
      .flatMap(
        (date) =>
          [
            "KOSPI",
            "KOSDAQ",
          ].map(
            (market) => ({
              market,
              date,
              present:
                beforeSet.has(
                  key(
                    market,
                    date,
                  ),
                ),
            }),
          ),
      )
      .filter(
        (item) =>
          !item.present,
      );

  const syncResult =
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
    });

  const overrideRows =
    VERIFIED_CLOSED_DATES.map(
      (row) => ({
        exchange_code:
          "KRX",

        calendar_date:
          row.calendar_date,

        is_open:
          false,

        verified:
          true,

        reason:
          row.reason,

        source:
          "MANUAL_VERIFIED_KRX_CALENDAR",
      }),
    );

  const {
    error:
      overrideWriteError,
  } =
    await supabase
      .from(
        "market_exchange_calendar_overrides",
      )
      .upsert(
        overrideRows,
        {
          onConflict:
            "exchange_code,calendar_date",
        },
      );

  if (overrideWriteError) {
    throw new Error(
      `OVERRIDE_UPSERT_FAILED:${overrideWriteError.message}`,
    );
  }

  const [
    afterIndexResult,
    afterOverrideResult,
  ] =
    await Promise.all([
      supabase
        .from(
          "market_index_daily_bars",
        )
        .select(
          "market_code,trading_date",
        )
        .in(
          "market_code",
          [
            "KOSPI",
            "KOSDAQ",
          ],
        )
        .in(
          "trading_date",
          [
            ...TARGET_INDEX_DATES,
          ],
        )
        .order(
          "trading_date",
          {
            ascending:
              true,
          },
        ),

      supabase
        .from(
          "market_exchange_calendar_overrides",
        )
        .select(
          "exchange_code,calendar_date,is_open,verified,reason,source",
        )
        .eq(
          "exchange_code",
          "KRX",
        )
        .in(
          "calendar_date",
          holidayDates,
        )
        .order(
          "calendar_date",
          {
            ascending:
              true,
          },
        ),
    ]);

  if (
    afterIndexResult.error
  ) {
    throw new Error(
      `INDEX_POSTCHECK_FAILED:${afterIndexResult.error.message}`,
    );
  }

  if (
    afterOverrideResult.error
  ) {
    throw new Error(
      `OVERRIDE_POSTCHECK_FAILED:${afterOverrideResult.error.message}`,
    );
  }

  const afterSet =
    new Set(
      (
        afterIndexResult.data ??
        []
      ).map(
        (row:
          any) =>
          key(
            String(
              row.market_code,
            ),
            String(
              row.trading_date,
            ),
          ),
      ),
    );

  const missingAfter =
    TARGET_INDEX_DATES
      .flatMap(
        (date) =>
          [
            "KOSPI",
            "KOSDAQ",
          ].map(
            (market) => ({
              market,
              date,
              present:
                afterSet.has(
                  key(
                    market,
                    date,
                  ),
                ),
            }),
          ),
      )
      .filter(
        (item) =>
          !item.present,
      );

  const overridesAfter =
    (
      afterOverrideResult.data ??
      []
    ) as any[];

  const allOverridesVerifiedClosed =
    VERIFIED_CLOSED_DATES.every(
      (target) =>
        overridesAfter.some(
          (row) =>
            row.calendar_date ===
              target.calendar_date &&
            row.exchange_code ===
              "KRX" &&
            row.is_open ===
              false &&
            row.verified ===
              true,
        ),
    );

  const checks = {
    noVerifiedOpenConflict:
      conflictingOpen.length ===
      0,

    targetIndexRowsComplete:
      missingAfter.length ===
      0,

    expectedTargetIndexRowCount:
      afterSet.size ===
      TARGET_INDEX_DATES.length *
        2,

    verifiedClosedOverridesComplete:
      allOverridesVerifiedClosed,

    sourceConventionPreserved:
      overridesAfter
        .filter(
          (row) =>
            holidayDates.includes(
              row.calendar_date,
            ),
        )
        .every(
          (row) =>
            row.source ===
              "MANUAL_VERIFIED_KRX_CALENDAR",
        ),
  };

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

  const report = {
    status:
      failed.length === 0
        ? "ALPHA_V3_INDEX_GAP_CALENDAR_REPAIR_V1_VERIFIED"
        : "ALPHA_V3_INDEX_GAP_CALENDAR_REPAIR_V1_REVIEW",

    repair: {
      indexBackfill: {
        markets: [
          "KOSPI",
          "KOSDAQ",
        ],

        startDate:
          "2026-09-04",

        endDate:
          "2026-09-18",

        targetTradingDates: [
          ...TARGET_INDEX_DATES,
        ],

        missingPairsBefore:
          missingBefore,

        missingPairsAfter:
          missingAfter,

        syncResult,
      },

      verifiedCalendarClosures: {
        before:
          beforeOverrides ??
          [],

        after:
          overridesAfter,
      },
    },

    checks,
    failed,

    safety: {
      productionOrderEndpointCalled:
        false,

      autoOrder:
        false,

      orderTablesTouched:
        false,

      positionsTouched:
        false,

      databaseWrites: {
        marketIndexDailyBars:
          true,

        marketExchangeCalendarOverrides:
          true,

        tradingTables:
          false,
      },
    },

    logFile:
      "logs/alpha-v3-index-gap-calendar-repair-v1.json",

    nextGate:
      failed.length === 0
        ? "RERUN_ROOT_CAUSE_PROBE_AND_MARKET_DATA_MAINTENANCE_V2"
        : "REVIEW_INDEX_PROVIDER_BACKFILL_OR_OVERRIDE_CONSTRAINTS",
  };

  const logPath =
    path.resolve(
      process.cwd(),
      report.logFile,
    );

  fs.mkdirSync(
    path.dirname(
      logPath,
    ),
    {
      recursive:
        true,
    },
  );

  fs.writeFileSync(
    logPath,
    JSON.stringify(
      report,
      null,
      2,
    ) + "\n",
    "utf8",
  );

  console.log(
    JSON.stringify(
      report,
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

main().catch(
  (error) => {
    console.error(
      JSON.stringify(
        {
          status:
            "ALPHA_V3_INDEX_GAP_CALENDAR_REPAIR_V1_FATAL",

          error:
            error instanceof Error
              ? error.message
              : String(error),

          safety: {
            productionOrderEndpointCalled:
              false,

            orderTablesTouched:
              false,

            positionsTouched:
              false,
          },
        },
        null,
        2,
      ),
    );

    process.exitCode =
      2;
  },
);
