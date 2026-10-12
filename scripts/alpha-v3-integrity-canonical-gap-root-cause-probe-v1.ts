import fs from "node:fs";
import path from "node:path";

import {
  createClient,
} from "@supabase/supabase-js";

type AnyRecord =
  Record<string, any>;

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

function uniqueSorted(
  values:
    Array<string | null | undefined>,
): string[] {
  return [
    ...new Set(
      values.filter(
        (value):
          value is string =>
            Boolean(value),
      ),
    ),
  ].sort();
}

function dateRange(
  startDate:
    string,
  endDate:
    string,
): string[] {
  const out:
    string[] = [];

  const start =
    new Date(
      `${startDate}T00:00:00.000Z`,
    );

  const end =
    new Date(
      `${endDate}T00:00:00.000Z`,
    );

  for (
    let cursor =
      new Date(start);
    cursor <= end;
    cursor.setUTCDate(
      cursor.getUTCDate() + 1,
    )
  ) {
    const weekday =
      cursor.getUTCDay();

    if (
      weekday !== 0 &&
      weekday !== 6
    ) {
      out.push(
        cursor
          .toISOString()
          .slice(0, 10),
      );
    }
  }

  return out;
}

async function main() {
  const supabaseUrl =
    env(
      "NEXT_PUBLIC_SUPABASE_URL",
      "SUPABASE_URL",
    );

  const serviceKey =
    env(
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_SERVICE_KEY",
    );

  const supabase =
    createClient(
      supabaseUrl,
      serviceKey,
      {
        auth: {
          persistSession:
            false,
          autoRefreshToken:
            false,
        },
      },
    );

  const {
    data:
      scan,
    error:
      scanError,
  } =
    await supabase
      .from(
        "market_data_integrity_scans",
      )
      .select(
        [
          "id",
          "started_at",
          "finished_at",
          "status",
          "window_start_date",
          "window_end_date",
          "error_count",
          "warning_count",
          "before_summary",
          "after_summary",
        ].join(","),
      )
      .order(
        "started_at",
        {
          ascending:
            false,
        },
      )
      .limit(1)
      .maybeSingle();

  if (scanError) {
    throw new Error(
      `INTEGRITY_SCAN_READ_FAILED:${scanError.message}`,
    );
  }

  if (!scan) {
    throw new Error(
      "INTEGRITY_SCAN_MISSING",
    );
  }

  const startDate =
    scan.window_start_date as string;

  const endDate =
    scan.window_end_date as string;

  const [
    indexResult,
    stockResult,
    overrideResult,
    activeStocksResult,
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
        .gte(
          "trading_date",
          startDate,
        )
        .lte(
          "trading_date",
          endDate,
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
          "market_daily_bars",
        )
        .select(
          "stock_code,trading_date",
        )
        .gte(
          "trading_date",
          startDate,
        )
        .lte(
          "trading_date",
          endDate,
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
        .gte(
          "calendar_date",
          startDate,
        )
        .lte(
          "calendar_date",
          endDate,
        )
        .order(
          "calendar_date",
          {
            ascending:
              true,
          },
        ),

      supabase
        .from(
          "stocks",
        )
        .select(
          "stock_code,stock_name,is_active",
        )
        .eq(
          "is_active",
          true,
        )
        .order(
          "stock_code",
          {
            ascending:
              true,
          },
        ),
    ]);

  for (
    const [
      name,
      result,
    ] of [
      [
        "INDEX",
        indexResult,
      ],
      [
        "STOCK",
        stockResult,
      ],
      [
        "OVERRIDE",
        overrideResult,
      ],
      [
        "ACTIVE_STOCKS",
        activeStocksResult,
      ],
    ] as const
  ) {
    if (result.error) {
      throw new Error(
        `${name}_READ_FAILED:${result.error.message}`,
      );
    }
  }

  const activeCodes =
    new Set(
      (
        activeStocksResult.data ??
        []
      ).map(
        (row:
          AnyRecord) =>
          String(
            row.stock_code,
          ),
      ),
    );

  const indexRows =
    (
      indexResult.data ??
      []
    ) as AnyRecord[];

  const stockRows =
    (
      stockResult.data ??
      []
    )
      .filter(
        (row:
          AnyRecord) =>
          activeCodes.has(
            String(
              row.stock_code,
            ),
          ),
      ) as AnyRecord[];

  const overrides =
    (
      overrideResult.data ??
      []
    ) as AnyRecord[];

  const kospiDates =
    new Set(
      indexRows
        .filter(
          (row) =>
            row.market_code ===
              "KOSPI",
        )
        .map(
          (row) =>
            String(
              row.trading_date,
            ),
        ),
    );

  const kosdaqDates =
    new Set(
      indexRows
        .filter(
          (row) =>
            row.market_code ===
              "KOSDAQ",
        )
        .map(
          (row) =>
            String(
              row.trading_date,
            ),
        ),
    );

  const verifiedOverrideByDate =
    new Map(
      overrides
        .filter(
          (row) =>
            row.verified ===
              true,
        )
        .map(
          (row) => [
            String(
              row.calendar_date,
            ),
            row,
          ],
        ),
    );

  const weekdays =
    dateRange(
      startDate,
      endDate,
    );

  const expectedOpenWeekdays =
    weekdays.filter(
      (date) => {
        const override =
          verifiedOverrideByDate.get(
            date,
          );

        if (
          override &&
          override.is_open ===
            false
        ) {
          return false;
        }

        return true;
      },
    );

  const indexCommonDates =
    expectedOpenWeekdays.filter(
      (date) =>
        kospiDates.has(
          date,
        ) &&
        kosdaqDates.has(
          date,
        ),
    );

  const missingIndexByDate =
    expectedOpenWeekdays
      .filter(
        (date) =>
          !kospiDates.has(
            date,
          ) ||
          !kosdaqDates.has(
            date,
          ),
      )
      .map(
        (date) => ({
          date,
          kospi:
            kospiDates.has(
              date,
            ),
          kosdaq:
            kosdaqDates.has(
              date,
            ),
          override:
            verifiedOverrideByDate.get(
              date,
            ) ??
            null,
        }),
      );

  const stockDatesByCode =
    new Map<
      string,
      Set<string>
    >();

  for (
    const code of
      activeCodes
  ) {
    stockDatesByCode.set(
      code,
      new Set(),
    );
  }

  for (
    const row of stockRows
  ) {
    const code =
      String(
        row.stock_code,
      );

    const date =
      String(
        row.trading_date,
      );

    if (
      !stockDatesByCode.has(
        code,
      )
    ) {
      stockDatesByCode.set(
        code,
        new Set(),
      );
    }

    stockDatesByCode
      .get(
        code,
      )
      ?.add(
        date,
      );
  }

  const stockOutsideIndexCommon =
    [];

  for (
    const [
      code,
      dates,
    ] of
      stockDatesByCode
  ) {
    const outside =
      uniqueSorted(
        [
          ...dates,
        ].filter(
          (date) =>
            !indexCommonDates.includes(
              date,
            ),
        ),
      );

    if (
      outside.length >
      0
    ) {
      stockOutsideIndexCommon.push({
        stockCode:
          code,
        dates:
          outside,
      });
    }
  }

  const latestSummary =
    (
      scan.after_summary ??
      scan.before_summary ??
      {}
    ) as AnyRecord;

  const scanCanonicalDates =
    Array.isArray(
      latestSummary
        .canonicalTradingDates,
    )
      ? latestSummary
          .canonicalTradingDates
          .map(
            (value:
              unknown) =>
              String(value),
          )
      : [];

  const scanWarnings =
    Array.isArray(
      latestSummary.issues,
    )
      ? latestSummary
          .issues
          .filter(
            (issue:
              AnyRecord) =>
              issue.severity ===
              "WARNING",
          )
      : [];

  const warningDates =
    uniqueSorted(
      scanWarnings.map(
        (issue:
          AnyRecord) =>
          issue.tradingDate,
      ),
    );

  const warningStocks =
    uniqueSorted(
      scanWarnings.map(
        (issue:
          AnyRecord) =>
          issue.stockCode,
      ),
    );

  const warningDatesMissingFromIndex =
    warningDates.filter(
      (date) =>
        !kospiDates.has(
          date,
        ) ||
        !kosdaqDates.has(
          date,
        ),
    );

  const warningDatesClosedByOverride =
    warningDates
      .filter(
        (date) =>
          verifiedOverrideByDate
            .get(
              date,
            )
            ?.is_open ===
          false,
      );

  const likelyRootCause =
    warningDates.length >
      0 &&
    warningDatesMissingFromIndex
      .length ===
      warningDates.length &&
    warningDatesClosedByOverride
      .length ===
      0
      ? "INDEX_DAILY_BAR_GAPS_DRIVE_CANONICAL_TRADING_DATE_GAPS"
      : warningDatesClosedByOverride
          .length >
          0
        ? "VERIFIED_CALENDAR_OVERRIDES_EXPLAIN_SOME_WARNING_DATES"
        : "MIXED_OR_DIFFERENT_ROOT_CAUSE_REQUIRES_REVIEW";

  const report = {
    status:
      "ALPHA_V3_INTEGRITY_CANONICAL_GAP_ROOT_CAUSE_PROBE_V1_COMPLETE",

    scan: {
      id:
        scan.id,
      status:
        scan.status,
      startedAt:
        scan.started_at,
      finishedAt:
        scan.finished_at,
      windowStartDate:
        startDate,
      windowEndDate:
        endDate,
      errors:
        scan.error_count,
      warnings:
        scan.warning_count,
      canonicalTradingDates:
        scanCanonicalDates,
      warningDates,
      warningStocks,
    },

    counts: {
      activeStocks:
        activeCodes.size,
      expectedOpenWeekdays:
        expectedOpenWeekdays.length,
      kospiRows:
        kospiDates.size,
      kosdaqRows:
        kosdaqDates.size,
      indexCommonDates:
        indexCommonDates.length,
      warningDates:
        warningDates.length,
      missingIndexDates:
        missingIndexByDate.length,
      verifiedOverrides:
        [
          ...verifiedOverrideByDate.values(),
        ].length,
    },

    comparison: {
      missingIndexByDate,
      warningDatesMissingFromIndex,
      warningDatesClosedByOverride,
      stockOutsideIndexCommon,
      verifiedOverrides:
        overrides.filter(
          (row) =>
            row.verified ===
            true,
        ),
    },

    diagnosis: {
      likelyRootCause,
      warningDatesExactlyIndexGapDates:
        warningDates.length >
          0 &&
        warningDates.every(
          (date) =>
            warningDatesMissingFromIndex.includes(
              date,
            ),
        ),
      verifiedClosedOverrideExplainsWarnings:
        warningDatesClosedByOverride.length >
        0,
      canonicalDatesMatchIndexIntersection:
        JSON.stringify(
          scanCanonicalDates,
        ) ===
        JSON.stringify(
          indexCommonDates,
        ),
    },

    safety: {
      databaseReads:
        5,
      databaseWrites:
        0,
      networkProvidersCalled:
        0,
      ordersCreated:
        0,
      positionsChanged:
        0,
    },

    nextGate:
      "REPAIR_INDEX_GAPS_OR_CALENDAR_CANONICALIZATION_BEFORE_PRODUCTION_USABILITY",

    logFile:
      "logs/alpha-v3-integrity-canonical-gap-root-cause-probe-v1.json",
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
      {
        status:
          report.status,
        scan:
          report.scan,
        counts:
          report.counts,
        diagnosis:
          report.diagnosis,
        missingIndexByDate:
          report.comparison
            .missingIndexByDate,
        warningDates:
          report.scan
            .warningDates,
        warningStocks:
          report.scan
            .warningStocks,
        verifiedOverrides:
          report.comparison
            .verifiedOverrides,
        safety:
          report.safety,
        logFile:
          report.logFile,
        nextGate:
          report.nextGate,
      },
      null,
      2,
    ),
  );
}

main().catch(
  (error) => {
    console.error(
      JSON.stringify(
        {
          status:
            "ALPHA_V3_INTEGRITY_CANONICAL_GAP_ROOT_CAUSE_PROBE_V1_FATAL",
          error:
            error instanceof Error
              ? error.message
              : String(error),
          safety: {
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

    process.exitCode =
      2;
  },
);
