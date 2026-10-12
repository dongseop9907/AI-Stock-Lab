import { createSupabaseServerClient } from "@/lib/supabase";

export type MarketRegime =
  | "BULL"
  | "NEUTRAL"
  | "BEAR"
  | "UNKNOWN";

export interface MarketRegimeShadow {
  mode: "SHADOW";
  appliedToOrders: false;
  regime: MarketRegime;
  wouldBlockByRegime: boolean;
  breadth20: number | null;
  avgReturn20: number | null;
  sampleSize: number;
  returnSampleSize: number;
  stockCodes: string[];
  latestMarketDate: string | null;
  latestSnapshotObservedAt: string | null;
  observedAt: string;
  source: "ACTIVE_STOCK_PROXY_V1" | "UNKNOWN";
  reason: string;
}

interface DailyBarRecord {
  stock_code: string;
  trading_date: string;
  close_price: number | string | null;
}

interface SnapshotRecord {
  stock_code: string;
  observed_at: string;
  close_price: number | string | null;
}

function round(value: number, digits = 6): number {
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}

function toNumber(
  value: number | string | null | undefined,
): number | null {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function normalizeStockCodes(
  values: string[] | undefined,
): string[] {
  if (!values) {
    return [];
  }

  return [
    ...new Set(
      values
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}

function getKoreanDate(value: string): string {
  const parts =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      },
    ).formatToParts(
      new Date(value),
    );

  const map =
    Object.fromEntries(
      parts.map((part) => [
        part.type,
        part.value,
      ]),
    );

  return `${map.year}-${map.month}-${map.day}`;
}

function unknownResult(
  reason: string,
  stockCodes: string[] = [],
): MarketRegimeShadow {
  return {
    mode: "SHADOW",
    appliedToOrders: false,

    regime: "UNKNOWN",
    wouldBlockByRegime: false,

    breadth20: null,
    avgReturn20: null,

    sampleSize: 0,
    returnSampleSize: 0,

    stockCodes,

    latestMarketDate: null,
    latestSnapshotObservedAt: null,

    observedAt: new Date().toISOString(),

    source: "UNKNOWN",
    reason,
  };
}

async function resolveRegimeUniverse(
  requestedStockCodes: string[] | undefined,
): Promise<string[]> {
  const normalized =
    normalizeStockCodes(
      requestedStockCodes,
    );

  if (normalized.length > 0) {
    return normalized;
  }

  const supabase =
    createSupabaseServerClient();

  const {
    data,
    error,
  } =
    await supabase
      .from("stocks")
      .select("stock_code")
      .eq("is_active", true)
      .order("stock_code", {
        ascending: true,
      });

  if (error) {
    throw new Error(
      `시장 Regime 종목군 조회 실패: ${error.message}`,
    );
  }

  return [
    ...new Set(
      (data ?? [])
        .map((row) =>
          String(row.stock_code).trim(),
        )
        .filter(Boolean),
    ),
  ];
}

/*
 * Regime Shadow v6
 *
 * BULL:
 *   breadth20 >= 0.60
 *   && avgReturn20 > 0
 *
 * BEAR:
 *   breadth20 <= 0.40
 *   && avgReturn20 < 0
 *
 * 나머지:
 *   NEUTRAL
 *
 * SHADOW이므로 실제 주문 차단에는 절대 사용하지 않는다.
 */
export async function getCurrentMarketRegimeShadow(
  input: {
    stockCodes?: string[];
  } = {},
): Promise<MarketRegimeShadow> {
  const supabase =
    createSupabaseServerClient();

  const stockCodes =
    await resolveRegimeUniverse(
      input.stockCodes,
    );

  if (stockCodes.length === 0) {
    return unknownResult(
      "활성 종목군이 없어 시장 Regime을 계산하지 못했습니다.",
    );
  }

  const dailyLimit =
    Math.min(
      10000,
      Math.max(
        1000,
        stockCodes.length * 40,
      ),
    );

  const {
    data: dailyData,
    error: dailyError,
  } =
    await supabase
      .from("market_daily_bars")
      .select(`
        stock_code,
        trading_date,
        close_price
      `)
      .in("stock_code", stockCodes)
      .order("trading_date", {
        ascending: false,
      })
      .limit(dailyLimit);

  if (dailyError) {
    throw new Error(
      `시장 Regime 일봉 조회 실패: ${dailyError.message}`,
    );
  }

  const now =
    new Date().toISOString();

  const {
    data: snapshotData,
    error: snapshotError,
  } =
    await supabase
      .from("market_snapshots")
      .select(`
        stock_code,
        observed_at,
        close_price
      `)
      .in("stock_code", stockCodes)
      .lte("observed_at", now)
      .order("observed_at", {
        ascending: false,
      })
      .limit(
        Math.min(
          5000,
          Math.max(
            1000,
            stockCodes.length * 50,
          ),
        ),
      );

  if (snapshotError) {
    throw new Error(
      `시장 Regime 실시간 시세 조회 실패: ${snapshotError.message}`,
    );
  }

  const dailyBars =
    (dailyData ?? []) as DailyBarRecord[];

  const snapshots =
    (snapshotData ?? []) as SnapshotRecord[];

  const dailyByStock =
    new Map<string, DailyBarRecord[]>();

  for (const bar of dailyBars) {
    const list =
      dailyByStock.get(
        bar.stock_code,
      ) ?? [];

    list.push(bar);

    dailyByStock.set(
      bar.stock_code,
      list,
    );
  }

  for (const list of dailyByStock.values()) {
    list.sort(
      (left, right) =>
        left.trading_date.localeCompare(
          right.trading_date,
        ),
    );
  }

  const latestSnapshotByStock =
    new Map<string, SnapshotRecord>();

  for (const snapshot of snapshots) {
    if (
      !latestSnapshotByStock.has(
        snapshot.stock_code,
      )
    ) {
      latestSnapshotByStock.set(
        snapshot.stock_code,
        snapshot,
      );
    }
  }

  const breadthValues: number[] = [];
  const returnValues: number[] = [];

  let latestMarketDate:
    string | null = null;

  let latestSnapshotObservedAt:
    string | null = null;

  for (const stockCode of stockCodes) {
    const bars =
      dailyByStock.get(stockCode) ?? [];

    const closes =
      bars
        .map((bar) => ({
          tradingDate:
            bar.trading_date,
          close:
            toNumber(
              bar.close_price,
            ),
        }))
        .filter(
          (
            value,
          ): value is {
            tradingDate: string;
            close: number;
          } =>
            value.close !== null &&
            value.close > 0,
        );

    const latestDaily =
      closes[
        closes.length - 1
      ];

    if (
      latestDaily &&
      (
        latestMarketDate === null ||
        latestDaily.tradingDate >
          latestMarketDate
      )
    ) {
      latestMarketDate =
        latestDaily.tradingDate;
    }

    const snapshot =
      latestSnapshotByStock.get(
        stockCode,
      );

    if (
      snapshot &&
      (
        latestSnapshotObservedAt ===
          null ||
        snapshot.observed_at >
          latestSnapshotObservedAt
      )
    ) {
      latestSnapshotObservedAt =
        snapshot.observed_at;
    }

    const series =
      closes.map(
        (value) => value.close,
      );

    /*
     * 일봉보다 더 최근 거래일의 snapshot만 추가한다.
     * 같은 거래일 데이터는 중복하지 않는다.
     */
    if (snapshot) {
      const snapshotClose =
        toNumber(
          snapshot.close_price,
        );

      const snapshotDate =
        getKoreanDate(
          snapshot.observed_at,
        );

      if (
        snapshotClose !== null &&
        snapshotClose > 0 &&
        (
          !latestDaily ||
          snapshotDate >
            latestDaily.tradingDate
        )
      ) {
        series.push(snapshotClose);

        if (
          latestMarketDate === null ||
          snapshotDate >
            latestMarketDate
        ) {
          latestMarketDate =
            snapshotDate;
        }
      }
    }

    if (series.length >= 20) {
      const last20 =
        series.slice(-20);

      const latest =
        last20[
          last20.length - 1
        ];

      const sma20 =
        last20.reduce(
          (sum, value) =>
            sum + value,
          0,
        ) /
        last20.length;

      breadthValues.push(
        latest > sma20
          ? 1
          : 0,
      );
    }

    if (series.length >= 21) {
      const latest =
        series[
          series.length - 1
        ];

      const twentyPeriodsAgo =
        series[
          series.length - 21
        ];

      if (twentyPeriodsAgo > 0) {
        returnValues.push(
          (
            latest -
            twentyPeriodsAgo
          ) /
          twentyPeriodsAgo,
        );
      }
    }
  }

  if (
    breadthValues.length < 3 ||
    returnValues.length < 3
  ) {
    return {
      ...unknownResult(
        "20거래일 계산에 필요한 종목 데이터가 부족합니다.",
        stockCodes,
      ),

      sampleSize:
        breadthValues.length,

      returnSampleSize:
        returnValues.length,

      latestMarketDate,
      latestSnapshotObservedAt,

      source:
        "ACTIVE_STOCK_PROXY_V1",
    };
  }

  const breadth20 =
    breadthValues.reduce(
      (sum, value) =>
        sum + value,
      0,
    ) /
    breadthValues.length;

  const avgReturn20 =
    returnValues.reduce(
      (sum, value) =>
        sum + value,
      0,
    ) /
    returnValues.length;

  let regime: MarketRegime =
    "NEUTRAL";

  if (
    breadth20 >= 0.60 &&
    avgReturn20 > 0
  ) {
    regime = "BULL";
  } else if (
    breadth20 <= 0.40 &&
    avgReturn20 < 0
  ) {
    regime = "BEAR";
  }

  const wouldBlockByRegime =
    regime === "BEAR";

  return {
    mode: "SHADOW",
    appliedToOrders: false,

    regime,
    wouldBlockByRegime,

    breadth20:
      round(breadth20),

    avgReturn20:
      round(avgReturn20),

    sampleSize:
      breadthValues.length,

    returnSampleSize:
      returnValues.length,

    stockCodes,

    latestMarketDate,
    latestSnapshotObservedAt,

    observedAt: now,

    source:
      "ACTIVE_STOCK_PROXY_V1",

    reason:
      wouldBlockByRegime
        ? "SHADOW 기준에서는 BEAR이므로 신규매수를 차단했을 신호입니다. 실제 주문에는 영향하지 않습니다."
        : `SHADOW 기준 시장 상태는 ${regime}입니다. 실제 주문에는 영향하지 않습니다.`,
  };
}

export async function getCurrentMarketRegimeShadowSafe(
  input: {
    stockCodes?: string[];
  } = {},
): Promise<MarketRegimeShadow> {
  try {
    return await getCurrentMarketRegimeShadow(
      input,
    );
  } catch (error) {
    return unknownResult(
      error instanceof Error
        ? error.message
        : "시장 Regime SHADOW 계산 실패",
      normalizeStockCodes(
        input.stockCodes,
      ),
    );
  }
}