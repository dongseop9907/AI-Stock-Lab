import {
  createSupabaseServerClient,
} from "@/lib/supabase";

import {
  getMarketDataFreshnessV77,
} from "@/lib/market/get-market-data-freshness-v7-7";

export type IntegritySeverityV79 =
  | "ERROR"
  | "WARNING";

export interface MarketDataIntegrityIssueV79 {
  severity:
    IntegritySeverityV79;

  issueType:
    | "NO_CANONICAL_TRADING_DAYS"
    | "INDEX_DATE_MISMATCH"
    | "INVALID_INDEX_OHLC"
    | "EXTREME_INDEX_RETURN"
    | "MISSING_STOCK_BAR"
    | "STOCK_DATE_OUTSIDE_CANONICAL"
    | "INVALID_STOCK_OHLC"
    | "NEGATIVE_STOCK_VOLUME"
    | "EXTREME_STOCK_RETURN";

  marketCode?:
    string | null;

  stockCode?:
    string | null;

  tradingDate?:
    string | null;

  repairable:
    boolean;

  details:
    Record<
      string,
      unknown
    >;
}

interface ActiveStockRow {
  stock_code:
    string;
}

interface IndexBarRow {
  market_code:
    string;

  trading_date:
    string;

  open_value:
    number | string | null;

  high_value:
    number | string | null;

  low_value:
    number | string | null;

  close_value:
    number | string;
}

interface StockBarRow {
  stock_code:
    string;

  trading_date:
    string;

  open_price:
    number | string;

  high_price:
    number | string;

  low_price:
    number | string;

  close_price:
    number | string;

  volume:
    number | string | null;
}

function addCalendarDays(
  sqlDate: string,
  days: number,
) {
  const date =
    new Date(
      `${sqlDate}T00:00:00.000Z`,
    );

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    throw new Error(
      `INVALID_SQL_DATE: ${sqlDate}`,
    );
  }

  date.setUTCDate(
    date.getUTCDate() +
      days,
  );

  return date
    .toISOString()
    .slice(0, 10);
}

function clampWindowDays(
  value:
    number | undefined,
) {
  const parsed =
    Number(
      value ??
      45,
    );

  if (
    !Number.isFinite(
      parsed,
    )
  ) {
    return 45;
  }

  return Math.min(
    120,
    Math.max(
      14,
      Math.floor(
        parsed,
      ),
    ),
  );
}

function numeric(
  value: unknown,
): number | null {
  const parsed =
    Number(value);

  return Number.isFinite(
    parsed,
  )
    ? parsed
    : null;
}

function validateOhlc(
  input: {
    open:
      unknown;

    high:
      unknown;

    low:
      unknown;

    close:
      unknown;
  },
) {
  const open =
    numeric(
      input.open,
    );

  const high =
    numeric(
      input.high,
    );

  const low =
    numeric(
      input.low,
    );

  const close =
    numeric(
      input.close,
    );

  if (
    open === null ||
    high === null ||
    low === null ||
    close === null
  ) {
    return {
      valid:
        false,

      reason:
        "NON_NUMERIC_OHLC",
    };
  }

  if (
    open <= 0 ||
    high <= 0 ||
    low <= 0 ||
    close <= 0
  ) {
    return {
      valid:
        false,

      reason:
        "NON_POSITIVE_OHLC",
    };
  }

  const maxBody =
    Math.max(
      open,
      close,
      low,
    );

  const minBody =
    Math.min(
      open,
      close,
      high,
    );

  if (
    high <
      maxBody ||
    low >
      minBody ||
    high <
      low
  ) {
    return {
      valid:
        false,

      reason:
        "OHLC_RELATION_BROKEN",
    };
  }

  return {
    valid:
      true,

    reason:
      null,
  };
}

function sortedUnique(
  values:
    string[],
) {
  return [
    ...new Set(
      values,
    ),
  ].sort();
}

function intersection(
  left:
    string[],

  right:
    string[],
) {
  const rightSet =
    new Set(
      right,
    );

  return left.filter(
    (value) =>
      rightSet.has(
        value,
      ),
  );
}

function mapByDate<
  T extends {
    trading_date:
      string;
  },
>(
  rows: T[],
) {
  const map =
    new Map<
      string,
      T
    >();

  for (
    const row
    of rows
  ) {
    map.set(
      row.trading_date,
      row,
    );
  }

  return map;
}

/*
 * v7.9 Integrity Scanner
 *
 * Canonical trading calendar:
 * dates present in BOTH KOSPI and KOSDAQ index bars.
 *
 * This avoids guessing weekends/holidays and gives us a market-native
 * reference calendar for stock-bar gap detection.
 *
 * Suspicious extreme returns are WARNING only and are never repaired
 * automatically, because genuine limit moves/corporate actions can
 * produce large changes.
 */
export async function getMarketDataIntegrityV79(
  input: {
    windowCalendarDays?:
      number;

    now?:
      string;
  } = {},
) {
  const supabase =
    createSupabaseServerClient();

  const freshness =
    await getMarketDataFreshnessV77({
      now:
        input.now,
    });

  const windowCalendarDays =
    clampWindowDays(
      input
        .windowCalendarDays,
    );

  const windowEndDate =
    freshness
      .expectedMarketDate;

  const windowStartDate =
    addCalendarDays(
      windowEndDate,
      -(
        windowCalendarDays -
        1
      ),
    );

  const [
    activeResponse,
    indexResponse,
  ] =
    await Promise.all([
      supabase
        .from(
          "stocks",
        )
        .select(
          "stock_code",
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

      supabase
        .from(
          "market_index_daily_bars",
        )
        .select(`
          market_code,
          trading_date,
          open_value,
          high_value,
          low_value,
          close_value
        `)
        .in(
          "market_code",
          [
            "KOSPI",
            "KOSDAQ",
          ],
        )
        .gte(
          "trading_date",
          windowStartDate,
        )
        .lte(
          "trading_date",
          windowEndDate,
        )
        .order(
          "trading_date",
          {
            ascending:
              true,
          },
        ),
    ]);

  if (
    activeResponse.error
  ) {
    throw new Error(
      `Integrity active-stock load failed: ${activeResponse.error.message}`,
    );
  }

  if (
    indexResponse.error
  ) {
    throw new Error(
      `Integrity index-bar load failed: ${indexResponse.error.message}`,
    );
  }

  const activeStockCodes =
    (
      (
        activeResponse.data ??
        []
      ) as ActiveStockRow[]
    )
      .map(
        (row) =>
          String(
            row.stock_code,
          ).trim(),
      )
      .filter(Boolean);

  const indexRows =
    (
      indexResponse.data ??
      []
    ) as IndexBarRow[];

  let stockRows:
    StockBarRow[] = [];

  if (
    activeStockCodes.length >
    0
  ) {
    const {
      data,
      error,
    } =
      await supabase
        .from(
          "market_daily_bars",
        )
        .select(`
          stock_code,
          trading_date,
          open_price,
          high_price,
          low_price,
          close_price,
          volume
        `)
        .in(
          "stock_code",
          activeStockCodes,
        )
        .gte(
          "trading_date",
          windowStartDate,
        )
        .lte(
          "trading_date",
          windowEndDate,
        )
        .order(
          "trading_date",
          {
            ascending:
              true,
          },
        )
        .limit(20000);

    if (
      error
    ) {
      throw new Error(
        `Integrity stock-bar load failed: ${error.message}`,
      );
    }

    stockRows =
      (
        data ??
        []
      ) as StockBarRow[];
  }

  const issues:
    MarketDataIntegrityIssueV79[] = [];

  const kospiRows =
    indexRows.filter(
      (row) =>
        row.market_code ===
        "KOSPI",
    );

  const kosdaqRows =
    indexRows.filter(
      (row) =>
        row.market_code ===
        "KOSDAQ",
    );

  const kospiDates =
    sortedUnique(
      kospiRows.map(
        (row) =>
          row.trading_date,
      ),
    );

  const kosdaqDates =
    sortedUnique(
      kosdaqRows.map(
        (row) =>
          row.trading_date,
      ),
    );

  const canonicalDates =
    intersection(
      kospiDates,
      kosdaqDates,
    );

  const canonicalSet =
    new Set(
      canonicalDates,
    );

  if (
    canonicalDates.length ===
    0
  ) {
    issues.push({
      severity:
        "ERROR",

      issueType:
        "NO_CANONICAL_TRADING_DAYS",

      repairable:
        true,

      details: {
        windowStartDate,
        windowEndDate,
      },
    });
  }

  const kospiSet =
    new Set(
      kospiDates,
    );

  const kosdaqSet =
    new Set(
      kosdaqDates,
    );

  const allIndexDates =
    sortedUnique([
      ...kospiDates,
      ...kosdaqDates,
    ]);

  for (
    const date
    of allIndexDates
  ) {
    const hasKospi =
      kospiSet.has(
        date,
      );

    const hasKosdaq =
      kosdaqSet.has(
        date,
      );

    if (
      hasKospi !==
      hasKosdaq
    ) {
      issues.push({
        severity:
          "ERROR",

        issueType:
          "INDEX_DATE_MISMATCH",

        marketCode:
          hasKospi
            ? "KOSDAQ"
            : "KOSPI",

        tradingDate:
          date,

        repairable:
          true,

        details: {
          hasKospi,
          hasKosdaq,
        },
      });
    }
  }

  for (
    const row
    of indexRows
  ) {
    const validation =
      validateOhlc({
        open:
          row.open_value,

        high:
          row.high_value,

        low:
          row.low_value,

        close:
          row.close_value,
      });

    if (
      !validation.valid
    ) {
      issues.push({
        severity:
          "ERROR",

        issueType:
          "INVALID_INDEX_OHLC",

        marketCode:
          row.market_code,

        tradingDate:
          row.trading_date,

        repairable:
          true,

        details: {
          reason:
            validation.reason,

          open:
            row.open_value,

          high:
            row.high_value,

          low:
            row.low_value,

          close:
            row.close_value,
        },
      });
    }
  }

  for (
    const marketCode
    of [
      "KOSPI",
      "KOSDAQ",
    ]
  ) {
    const rows =
      indexRows
        .filter(
          (row) =>
            row.market_code ===
            marketCode,
        )
        .sort(
          (
            a,
            b,
          ) =>
            a.trading_date.localeCompare(
              b.trading_date,
            ),
        );

    for (
      let i = 1;
      i <
      rows.length;
      i += 1
    ) {
      const previousClose =
        numeric(
          rows[
            i - 1
          ].close_value,
        );

      const currentClose =
        numeric(
          rows[i]
            .close_value,
        );

      if (
        previousClose ===
          null ||
        currentClose ===
          null ||
        previousClose <=
          0
      ) {
        continue;
      }

      const dailyReturn =
        currentClose /
          previousClose -
        1;

      if (
        Math.abs(
          dailyReturn,
        ) >
        0.15
      ) {
        issues.push({
          severity:
            "WARNING",

          issueType:
            "EXTREME_INDEX_RETURN",

          marketCode,

          tradingDate:
            rows[i]
              .trading_date,

          repairable:
            false,

          details: {
            previousDate:
              rows[
                i - 1
              ].trading_date,

            previousClose,

            currentClose,

            dailyReturn,
          },
        });
      }
    }
  }

  const rowsByStock =
    new Map<
      string,
      StockBarRow[]
    >();

  for (
    const stockCode
    of activeStockCodes
  ) {
    rowsByStock.set(
      stockCode,
      [],
    );
  }

  for (
    const row
    of stockRows
  ) {
    const list =
      rowsByStock.get(
        row.stock_code,
      );

    if (
      list
    ) {
      list.push(
        row,
      );
    }
  }

  for (
    const stockCode
    of activeStockCodes
  ) {
    const rows =
      (
        rowsByStock.get(
          stockCode,
        ) ??
        []
      ).sort(
        (
          a,
          b,
        ) =>
          a.trading_date.localeCompare(
            b.trading_date,
          ),
      );

    const byDate =
      mapByDate(
        rows,
      );

    for (
      const date
      of canonicalDates
    ) {
      if (
        !byDate.has(
          date,
        )
      ) {
        issues.push({
          severity:
            "ERROR",

          issueType:
            "MISSING_STOCK_BAR",

          stockCode,

          tradingDate:
            date,

          repairable:
            true,

          details: {},
        });
      }
    }

    for (
      const row
      of rows
    ) {
      if (
        !canonicalSet.has(
          row.trading_date,
        )
      ) {
        issues.push({
          severity:
            "WARNING",

          issueType:
            "STOCK_DATE_OUTSIDE_CANONICAL",

          stockCode,

          tradingDate:
            row.trading_date,

          repairable:
            false,

          details: {},
        });
      }

      const validation =
        validateOhlc({
          open:
            row.open_price,

          high:
            row.high_price,

          low:
            row.low_price,

          close:
            row.close_price,
        });

      if (
        !validation.valid
      ) {
        issues.push({
          severity:
            "ERROR",

          issueType:
            "INVALID_STOCK_OHLC",

          stockCode,

          tradingDate:
            row.trading_date,

          repairable:
            true,

          details: {
            reason:
              validation.reason,

            open:
              row.open_price,

            high:
              row.high_price,

            low:
              row.low_price,

            close:
              row.close_price,
          },
        });
      }

      const volume =
        numeric(
          row.volume,
        );

      if (
        volume !==
          null &&
        volume <
          0
      ) {
        issues.push({
          severity:
            "ERROR",

          issueType:
            "NEGATIVE_STOCK_VOLUME",

          stockCode,

          tradingDate:
            row.trading_date,

          repairable:
            true,

          details: {
            volume,
          },
        });
      }
    }

    for (
      let i = 1;
      i <
      rows.length;
      i += 1
    ) {
      const previousClose =
        numeric(
          rows[
            i - 1
          ].close_price,
        );

      const currentClose =
        numeric(
          rows[i]
            .close_price,
        );

      if (
        previousClose ===
          null ||
        currentClose ===
          null ||
        previousClose <=
          0
      ) {
        continue;
      }

      const dailyReturn =
        currentClose /
          previousClose -
        1;

      /*
       * WARNING only.
       * Do not auto-repair large real market moves.
       */
      if (
        Math.abs(
          dailyReturn,
        ) >
        0.45
      ) {
        issues.push({
          severity:
            "WARNING",

          issueType:
            "EXTREME_STOCK_RETURN",

          stockCode,

          tradingDate:
            rows[i]
              .trading_date,

          repairable:
            false,

          details: {
            previousDate:
              rows[
                i - 1
              ].trading_date,

            previousClose,

            currentClose,

            dailyReturn,
          },
        });
      }
    }
  }

  const errorCount =
    issues.filter(
      (issue) =>
        issue.severity ===
        "ERROR",
    ).length;

  const warningCount =
    issues.filter(
      (issue) =>
        issue.severity ===
        "WARNING",
    ).length;

  const repairableCount =
    issues.filter(
      (issue) =>
        issue.repairable,
    ).length;

  const status =
    errorCount >
      0
      ? "ERROR"
      : warningCount >
          0
        ? "WARNING"
        : "CLEAN";

  return {
    version:
      "MARKET_DATA_INTEGRITY_V7_9_1",

    mode:
      "DATA_QUALITY_GUARD",

    productionApplied:
      false,

    status,

    window: {
      startDate:
        windowStartDate,

      endDate:
        windowEndDate,

      calendarDays:
        windowCalendarDays,

      canonicalTradingDays:
        canonicalDates.length,
    },

    universe: {
      activeStockCount:
        activeStockCodes.length,

      stockCodes:
        activeStockCodes,
    },

    checked: {
      indexRows:
        indexRows.length,

      stockRows:
        stockRows.length,
    },

    counts: {
      issues:
        issues.length,

      errors:
        errorCount,

      warnings:
        warningCount,

      repairable:
        repairableCount,
    },

    freshness,

    canonicalTradingDates:
      canonicalDates,

    issues,

    safety: {
      extremeReturnsAutoRepaired:
        false,

      orderLogicChanged:
        false,

      productionDecisionApplied:
        false,
    },
  };
}