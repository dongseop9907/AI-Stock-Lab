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

interface ExchangeCalendarOverrideRow {
  calendar_date: string;
  is_open: boolean;
  reason: string;
  source: string;
}

interface KoreanClock {
  date: string;
  hour: number;
  minute: number;
}

interface TradingDayOverride {
  isOpen: boolean;
  reason: string;
  source: string;
}

const MARKET_DATA_READY_MINUTE_KST =
  16 * 60 + 30;

const CALENDAR_LOOKBACK_DAYS =
  45;

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
    weekday(
      sqlDate,
    );

  return (
    day >= 1 &&
    day <= 5
  );
}

function isTradingDay(
  sqlDate: string,
  overrides:
    Map<
      string,
      TradingDayOverride
    >,
) {
  const override =
    overrides.get(
      sqlDate,
    );

  if (
    override
  ) {
    return override
      .isOpen;
  }

  return isWeekday(
    sqlDate,
  );
}

function previousTradingDay(
  sqlDate: string,
  overrides:
    Map<
      string,
      TradingDayOverride
    >,
): string {
  let value =
    addCalendarDays(
      sqlDate,
      -1,
    );

  let safety =
    0;

  while (
    !isTradingDay(
      value,
      overrides,
    ) &&
    safety <
      370
  ) {
    value =
      addCalendarDays(
        value,
        -1,
      );

    safety +=
      1;
  }

  if (
    safety >=
    370
  ) {
    throw new Error(
      "TRADING_CALENDAR_LOOKBACK_EXCEEDED",
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

function resolveExpectedMarketDate(
  clock: KoreanClock,
  overrides:
    Map<
      string,
      TradingDayOverride
    >,
): string {
  const today =
    clock.date;

  if (
    !isTradingDay(
      today,
      overrides,
    )
  ) {
    return previousTradingDay(
      today,
      overrides,
    );
  }

  const minuteOfDay =
    clock.hour *
      60 +
    clock.minute;

  if (
    minuteOfDay <
    MARKET_DATA_READY_MINUTE_KST
  ) {
    return previousTradingDay(
      today,
      overrides,
    );
  }

  return today;
}

function countTradingDaysAfter(
  fromDate: string,
  throughDate: string,
  overrides:
    Map<
      string,
      TradingDayOverride
    >,
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
      isTradingDay(
        cursor,
        overrides,
      )
    ) {
      count +=
        1;
    }

    safety +=
      1;
  }

  if (
    safety >=
      370 &&
    cursor <
      throughDate
  ) {
    throw new Error(
      "TRADING_CALENDAR_LAG_SCAN_EXCEEDED",
    );
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
          Boolean(
            value,
          ),
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
          Boolean(
            value,
          ),
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

  const calendarStartDate =
    addCalendarDays(
      clock.date,
      -CALENDAR_LOOKBACK_DAYS,
    );

  const {
    data: overrideData,
    error: overrideError,
  } =
    await supabase
      .from(
        "market_exchange_calendar_overrides",
      )
      .select(`
        calendar_date,
        is_open,
        reason,
        source
      `)
      .eq(
        "exchange_code",
        "KRX",
      )
      .eq(
        "verified",
        true,
      )
      .gte(
        "calendar_date",
        calendarStartDate,
      )
      .lte(
        "calendar_date",
        clock.date,
      )
      .order(
        "calendar_date",
        {
          ascending:
            true,
        },
      );

  if (
    overrideError
  ) {
    throw new Error(
      `KRX calendar override load failed: ${overrideError.message}`,
    );
  }

  const overrideRows =
    (
      overrideData ??
      []
    ) as ExchangeCalendarOverrideRow[];

  const tradingDayOverrides =
    new Map<
      string,
      TradingDayOverride
    >();

  for (
    const row
    of overrideRows
  ) {
    tradingDayOverrides.set(
      String(
        row.calendar_date,
      ),
      {
        isOpen:
          Boolean(
            row.is_open,
          ),
        reason:
          String(
            row.reason,
          ),
        source:
          String(
            row.source,
          ),
      },
    );
  }

  const expectedMarketDate =
    resolveExpectedMarketDate(
      clock,
      tradingDayOverrides,
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
      .filter(
        Boolean,
      );

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
      .limit(
        100,
      );

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

  const tradingDayLag =
    latestCommonDate ===
      null
      ? null
      : countTradingDaysAfter(
          latestCommonDate,
          expectedMarketDate,
          tradingDayOverrides,
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
    tradingDayLag !==
      0
  ) {
    status =
      "STALE";

    reasons.push(
      `Latest aligned market data is ${tradingDayLag ?? "unknown"} trading day(s) behind the expected date.`,
    );
  } else {
    status =
      "FRESH";

    reasons.push(
      "Required daily-bar sources are complete, aligned, and current under the v7.7.1 weekday-plus-verified-KRX-override calendar.",
    );
  }

  const usableForShadowComparison =
    status ===
    "FRESH";

  const appliedOverrides =
    overrideRows.map(
      (row) => ({
        date:
          String(
            row.calendar_date,
          ),
        isOpen:
          Boolean(
            row.is_open,
          ),
        reason:
          String(
            row.reason,
          ),
        source:
          String(
            row.source,
          ),
      }),
    );

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
      businessWeekdayLag:
        tradingDayLag,
      tradingDayLag,
      indexDateAligned,
      allSourceDatesAligned,
      stockCoverageComplete,
      missingActiveStocks,
      calendarMode:
        "WEEKDAY_PLUS_VERIFIED_KRX_OVERRIDES",
      appliedOverrides,
    });

  return {
    version:
      "MARKET_DATA_FRESHNESS_V7_7_1",
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
      businessWeekdayLag:
        tradingDayLag,
      tradingDayLag,
    },

    reasons,
    evidenceFingerprint,

    calendar: {
      exchangeCode:
        "KRX",
      mode:
        "WEEKDAY_PLUS_VERIFIED_KRX_OVERRIDES",
      calendarLookbackDays:
        CALENDAR_LOOKBACK_DAYS,
      verifiedOverrideCount:
        appliedOverrides.length,
      appliedOverrides,
    },

    heuristic: {
      timeZone:
        "Asia/Seoul",
      marketDataReadyAfter:
        "16:30",
      weekendsHandled:
        true,
      exchangeHolidayCalendarIntegrated:
        true,
      calendarCoverage:
        "WEEKDAY_PLUS_VERIFIED_OVERRIDES",
      holidayPolicy:
        "VERIFIED_OVERRIDE_OR_FAIL_CLOSED_AS_STALE",
      unknownSpecialClosurePolicy:
        "FAIL_CLOSED_AS_STALE",
    },

    safety: {
      changesProductionOrders:
        false,
      changesRiskValidation:
        false,
      canInvalidateShadowComparison:
        true,
      unverifiedCalendarRowsIgnored:
        true,
      unknownClosuresCanStillFailClosed:
        true,
    },
  };
}
