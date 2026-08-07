import {
  createSupabaseServerClient,
} from "@/lib/supabase";

export type MarketDataFreshnessStatusV77 =
  | "FRESH"
  | "STALE"
  | "MISALIGNED"
  | "INCOMPLETE"
  | "FUTURE_DATED";

interface ActiveStockRow {
  stock_code: string;
}

interface StockDateRow {
  stock_code: string;
  trading_date: string;
}

interface IndexDateRow {
  market_code:
    | "KOSPI"
    | "KOSDAQ";

  trading_date: string;
}

interface KoreanClock {
  date: string;
  hour: number;
  minute: number;
}

const MARKET_DATA_READY_MINUTE_KST =
  16 * 60 + 30;

function addCalendarDays(
  sqlDate: string,
  days: number,
): string {
  const date =
    new Date(
      `${sqlDate}T00:00:00.000Z`,
    );

  date.setUTCDate(
    date.getUTCDate() +
      days,
  );

  return date
    .toISOString()
    .slice(0, 10);
}

function weekday(
  sqlDate: string,
): number {
  return new Date(
    `${sqlDate}T00:00:00.000Z`,
  ).getUTCDay();
}

function isWeekday(
  sqlDate: string,
) {
  const day =
    weekday(sqlDate);

  return (
    day >= 1 &&
    day <= 5
  );
}

function previousWeekday(
  sqlDate: string,
): string {
  let value =
    addCalendarDays(
      sqlDate,
      -1,
    );

  while (
    !isWeekday(value)
  ) {
    value =
      addCalendarDays(
        value,
        -1,
      );
  }

  return value;
}

function getKoreanClock(
  now: Date,
): KoreanClock {
  const parts =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone:
          "Asia/Seoul",

        year:
          "numeric",

        month:
          "2-digit",

        day:
          "2-digit",

        hour:
          "2-digit",

        minute:
          "2-digit",

        hourCycle:
          "h23",
      },
    ).formatToParts(
      now,
    );

  const map =
    Object.fromEntries(
      parts.map(
        (part) => [
          part.type,
          part.value,
        ],
      ),
    );

  return {
    date:
      `${map.year}-${map.month}-${map.day}`,

    hour:
      Number(
        map.hour,
      ),

    minute:
      Number(
        map.minute,
      ),
  };
}

/*
 * Conservative expected-date heuristic:
 *
 * - Weekend => previous weekday.
 * - Weekday before 16:30 KST => previous weekday.
 * - Weekday at/after 16:30 KST => today.
 *
 * Exchange-holiday calendar is intentionally NOT guessed.
 * On an exchange holiday, this guard can temporarily report STALE.
 * That false-negative is safer than accepting stale data as fresh.
 */
function resolveExpectedMarketDate(
  clock: KoreanClock,
): string {
  const today =
    clock.date;

  if (
    !isWeekday(
      today,
    )
  ) {
    let candidate =
      today;

    do {
      candidate =
        addCalendarDays(
          candidate,
          -1,
        );
    } while (
      !isWeekday(
        candidate,
      )
    );

    return candidate;
  }

  const minuteOfDay =
    clock.hour *
      60 +
    clock.minute;

  if (
    minuteOfDay <
    MARKET_DATA_READY_MINUTE_KST
  ) {
    return previousWeekday(
      today,
    );
  }

  return today;
}

function countWeekdaysAfter(
  fromDate: string,
  throughDate: string,
): number {
  if (
    fromDate >=
    throughDate
  ) {
    return 0;
  }

  let cursor =
    fromDate;

  let count =
    0;

  let safety =
    0;

  while (
    cursor <
      throughDate &&
    safety <
      370
  ) {
    cursor =
      addCalendarDays(
        cursor,
        1,
      );

    if (
      isWeekday(
        cursor,
      )
    ) {
      count +=
        1;
    }

    safety +=
      1;
  }

  return count;
}

function maxDate(
  values:
    Array<
      string | null
    >,
): string | null {
  const dates =
    values
      .filter(
        (
          value,
        ): value is string =>
          Boolean(value),
      )
      .sort();

  return dates.length >
    0
    ? dates[
        dates.length -
        1
      ]
    : null;
}

function minDate(
  values:
    Array<
      string | null
    >,
): string | null {
  const dates =
    values
      .filter(
        (
          value,
        ): value is string =>
          Boolean(value),
      )
      .sort();

  return dates.length >
    0
    ? dates[0]
    : null;
}

export async function getMarketDataFreshnessV77(
  input: {
    now?: string;
  } = {},
) {
  const supabase =
    createSupabaseServerClient();

  const now =
    input.now
      ? new Date(
          input.now,
        )
      : new Date();

  if (
    Number.isNaN(
      now.getTime(),
    )
  ) {
    throw new Error(
      "INVALID_FRESHNESS_NOW",
    );
  }

  const clock =
    getKoreanClock(
      now,
    );

  const expectedMarketDate =
    resolveExpectedMarketDate(
      clock,
    );

  const {
    data: activeStockData,
    error: activeStockError,
  } =
    await supabase
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
      );

  if (
    activeStockError
  ) {
    throw new Error(
      `Active stock freshness universe load failed: ${activeStockError.message}`,
    );
  }

  const activeStockCodes =
    (
      (
        activeStockData ??
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

  const indexPromise =
    supabase
      .from(
        "market_index_daily_bars",
      )
      .select(`
        market_code,
        trading_date
      `)
      .in(
        "market_code",
        [
          "KOSPI",
          "KOSDAQ",
        ],
      )
      .order(
        "trading_date",
        {
          ascending:
            false,
        },
      )
      .limit(100);


  /*
   * Build the stock query separately because an empty IN()
   * should not be sent to Supabase.
   */
  const loadStockDates =
    async () => {
      if (
        activeStockCodes.length ===
        0
      ) {
        return {
          data:
            [] as StockDateRow[],

          error:
            null,
        };
      }

      return await supabase
        .from(
          "market_daily_bars",
        )
        .select(`
          stock_code,
          trading_date
        `)
        .in(
          "stock_code",
          activeStockCodes,
        )
        .order(
          "trading_date",
          {
            ascending:
              false,
          },
        )
        .limit(
          Math.min(
            10000,
            Math.max(
              1000,
              activeStockCodes.length *
                30,
            ),
          ),
        );
    };

  const [
    indexResponse,
    stockResponse,
  ] =
    await Promise.all([
      indexPromise,
      loadStockDates(),
    ]);

  if (
    indexResponse.error
  ) {
    throw new Error(
      `Index freshness load failed: ${indexResponse.error.message}`,
    );
  }

  if (
    stockResponse.error
  ) {
    throw new Error(
      `Stock freshness load failed: ${stockResponse.error.message}`,
    );
  }

  const indexRows =
    (
      indexResponse.data ??
      []
    ) as IndexDateRow[];

  const stockRows =
    (
      stockResponse.data ??
      []
    ) as StockDateRow[];

  const latestIndexByMarket =
    new Map<
      string,
      string
    >();

  for (
    const row
    of indexRows
  ) {
    if (
      !latestIndexByMarket.has(
        row.market_code,
      )
    ) {
      latestIndexByMarket.set(
        row.market_code,
        row.trading_date,
      );
    }
  }

  const kospiLatestDate =
    latestIndexByMarket.get(
      "KOSPI",
    ) ??
    null;

  const kosdaqLatestDate =
    latestIndexByMarket.get(
      "KOSDAQ",
    ) ??
    null;

  const latestStockDateByCode =
    new Map<
      string,
      string
    >();

  for (
    const row
    of stockRows
  ) {
    if (
      !latestStockDateByCode.has(
        row.stock_code,
      )
    ) {
      latestStockDateByCode.set(
        row.stock_code,
        row.trading_date,
      );
    }
  }

  const activeStockLatestDates =
    activeStockCodes.map(
      (stockCode) =>
        latestStockDateByCode.get(
          stockCode,
        ) ??
        null,
    );

  const stockLatestDate =
    maxDate(
      activeStockLatestDates,
    );

  const oldestActiveStockLatestDate =
    minDate(
      activeStockLatestDates,
    );

  const activeStockCurrentCount =
    stockLatestDate ===
      null
      ? 0
      : activeStockCodes.filter(
          (stockCode) =>
            latestStockDateByCode.get(
              stockCode,
            ) ===
            stockLatestDate,
        ).length;

  const stockCoverageComplete =
    activeStockCodes.length >
      0 &&
    activeStockCurrentCount ===
      activeStockCodes.length;

  const indexDateAligned =
    kospiLatestDate !==
      null &&
    kosdaqLatestDate !==
      null &&
    kospiLatestDate ===
      kosdaqLatestDate;

  const allSourceDatesAligned =
    indexDateAligned &&
    stockCoverageComplete &&
    stockLatestDate !==
      null &&
    kospiLatestDate ===
      stockLatestDate;

  const latestCommonDate =
    allSourceDatesAligned
      ? stockLatestDate
      : null;

  const businessWeekdayLag =
    latestCommonDate ===
      null
      ? null
      : countWeekdaysAfter(
          latestCommonDate,
          expectedMarketDate,
        );

  const observedDates =
    [
      kospiLatestDate,
      kosdaqLatestDate,
      ...activeStockLatestDates,
    ].filter(
      (
        value,
      ): value is string =>
        value !==
        null,
    );

  const futureDated =
    observedDates.some(
      (date) =>
        date >
        expectedMarketDate,
    );

  const missingActiveStocks =
    activeStockCodes.filter(
      (stockCode) =>
        !latestStockDateByCode.has(
          stockCode,
        ),
    );

  const reasons:
    string[] = [];

  let status:
    MarketDataFreshnessStatusV77;

  if (
    activeStockCodes.length ===
      0 ||
    kospiLatestDate ===
      null ||
    kosdaqLatestDate ===
      null ||
    stockLatestDate ===
      null ||
    missingActiveStocks.length >
      0
  ) {
    status =
      "INCOMPLETE";

    reasons.push(
      "One or more required market-data sources are missing.",
    );
  } else if (
    futureDated
  ) {
    status =
      "FUTURE_DATED";

    reasons.push(
      "At least one market-data source is dated after the conservative expected market date.",
    );
  } else if (
    !allSourceDatesAligned
  ) {
    status =
      "MISALIGNED";

    reasons.push(
      "KOSPI, KOSDAQ, and active-stock daily bars do not share one complete latest market date.",
    );
  } else if (
    businessWeekdayLag !==
      0
  ) {
    status =
      "STALE";

    reasons.push(
      `Latest aligned market data is ${businessWeekdayLag ?? "unknown"} weekday(s) behind the expected date.`,
    );
  } else {
    status =
      "FRESH";

    reasons.push(
      "Required daily-bar sources are complete, aligned, and current under the v7.7 conservative freshness heuristic.",
    );
  }

  const usableForShadowComparison =
    status ===
    "FRESH";

  const evidenceFingerprint =
    JSON.stringify({
      status,

      usableForShadowComparison,

      expectedMarketDate,

      kospiLatestDate,
      kosdaqLatestDate,

      stockLatestDate,
      oldestActiveStockLatestDate,

      activeStockCount:
        activeStockCodes.length,

      activeStockCurrentCount,

      businessWeekdayLag,

      indexDateAligned,
      allSourceDatesAligned,
      stockCoverageComplete,

      missingActiveStocks,
    });

  return {
    version:
      "MARKET_DATA_FRESHNESS_V7_7",

    mode:
      "SHADOW_DATA_GUARD",

    productionApplied:
      false,

    observedAt:
      now.toISOString(),

    koreanClock:
      clock,

    expectedMarketDate,

    status,

    usableForShadowComparison,

    dates: {
      kospiLatestDate,
      kosdaqLatestDate,

      stockLatestDate,
      oldestActiveStockLatestDate,

      latestCommonDate,
    },

    coverage: {
      activeStockCount:
        activeStockCodes.length,

      activeStockCurrentCount,

      stockCoverageComplete,

      missingActiveStocks,
    },

    alignment: {
      indexDateAligned,
      allSourceDatesAligned,
    },

    lag: {
      businessWeekdayLag,
    },

    reasons,

    evidenceFingerprint,

    heuristic: {
      timeZone:
        "Asia/Seoul",

      marketDataReadyAfter:
        "16:30",

      weekendsHandled:
        true,

      exchangeHolidayCalendarIntegrated:
        false,

      holidayPolicy:
        "FAIL_CLOSED_AS_STALE_UNTIL_FRESH_DATA_ARRIVES",
    },

    safety: {
      changesProductionOrders:
        false,

      changesRiskValidation:
        false,

      canInvalidateShadowComparison:
        true,
    },
  };
}