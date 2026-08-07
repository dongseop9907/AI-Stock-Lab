import {
  calculateMarketRegimeFeatureVectorV7,
  type MarketRegimeIndexBar,
  type MarketRegimeStockBar,
} from "@/lib/market/market-regime-feature-engine";

import {
  createSupabaseServerClient,
} from "@/lib/supabase";

interface AnalyzeInput {
  runIds: string[];
  stockCodes?: string[];
}

interface TradeRow {
  run_id: string;
  stock_code: string;
  signal_at: string;

  exit_reason: string;

  net_pnl:
    | number
    | string;

  net_return:
    | number
    | string;
}

interface IndexRow {
  market_code:
    | "KOSPI"
    | "KOSDAQ";

  trading_date: string;

  close_value:
    | number
    | string;
}

interface StockBarRow {
  stock_code: string;
  trading_date: string;

  close_price:
    | number
    | string;
}

interface FeaturePoint {
  tradingDate: string;

  kospiReturn20:
    number | null;

  kospiReturn60:
    number | null;

  kosdaqReturn20:
    number | null;

  kosdaqReturn60:
    number | null;

  averageVolatility20:
    number | null;

  averageDrawdown60:
    number | null;

  breadth20:
    number | null;

  breadth60:
    number | null;

  bothBelowSma20:
    boolean | null;

  bothBelowSma60:
    boolean | null;
}

interface EnrichedTrade
  extends FeaturePoint {
  runId: string;
  stockCode: string;
  signalDate: string;
  exitReason: string;

  netPnl: number;
  netReturn: number;
}

const DEFAULT_STOCK_CODES = [
  "000660",
  "005380",
  "005930",
  "035420",
  "035720",
];

function toNumber(
  value:
    | number
    | string,
): number {
  const parsed =
    Number(value);

  if (
    !Number.isFinite(
      parsed,
    )
  ) {
    return 0;
  }

  return parsed;
}

function toNullableAverage(
  values:
    Array<
      number | null
    >,
): number | null {
  const usable =
    values.filter(
      (
        value,
      ): value is number =>
        value !== null &&
        Number.isFinite(
          value,
        ),
    );

  if (
    usable.length === 0
  ) {
    return null;
  }

  return (
    usable.reduce(
      (
        sum,
        value,
      ) => sum + value,
      0,
    ) /
    usable.length
  );
}

function normalizeCodes(
  values:
    | string[]
    | undefined,
): string[] {
  const source =
    values &&
    values.length > 0
      ? values
      : DEFAULT_STOCK_CODES;

  return [
    ...new Set(
      source
        .map(
          (value) =>
            value.trim(),
        )
        .filter(Boolean),
    ),
  ];
}

function normalizeRunIds(
  values: string[],
): string[] {
  return [
    ...new Set(
      values
        .map(
          (value) =>
            value.trim(),
        )
        .filter(Boolean),
    ),
  ];
}

function subtractCalendarDays(
  sqlDate: string,
  days: number,
): string {
  const date =
    new Date(
      `${sqlDate}T00:00:00.000Z`,
    );

  date.setUTCDate(
    date.getUTCDate() -
      days,
  );

  return date
    .toISOString()
    .slice(
      0,
      10,
    );
}

function getSignalDate(
  value: string,
): string {
  return value.slice(
    0,
    10,
  );
}

function quantile(
  values: number[],
  probability: number,
): number | null {
  if (
    values.length === 0
  ) {
    return null;
  }

  const sorted =
    [...values].sort(
      (
        left,
        right,
      ) => left - right,
    );

  if (
    sorted.length === 1
  ) {
    return sorted[0];
  }

  const position =
    (
      sorted.length -
      1
    ) *
    probability;

  const lower =
    Math.floor(
      position,
    );

  const upper =
    Math.ceil(
      position,
    );

  if (
    lower === upper
  ) {
    return sorted[
      lower
    ];
  }

  const weight =
    position -
    lower;

  return (
    sorted[lower] *
      (
        1 -
        weight
      ) +
    sorted[upper] *
      weight
  );
}

async function loadPaged<T>(
  buildQuery: (
    offset: number,
    pageSize: number,
  ) => Promise<{
    data:
      | T[]
      | null;

    error:
      | {
          message: string;
        }
      | null;
  }>,
  label: string,
): Promise<T[]> {
  const pageSize =
    1000;

  let offset =
    0;

  const rows:
    T[] = [];

  while (true) {
    const {
      data,
      error,
    } =
      await buildQuery(
        offset,
        pageSize,
      );

    if (error) {
      throw new Error(
        `${label}: ${error.message}`,
      );
    }

    const page =
      data ?? [];

    rows.push(
      ...page,
    );

    if (
      page.length <
      pageSize
    ) {
      break;
    }

    offset +=
      pageSize;
  }

  return rows;
}

function summarizeTrades(
  trades:
    EnrichedTrade[],
) {
  const wins =
    trades.filter(
      (trade) =>
        trade.netPnl > 0,
    ).length;

  const totalPnl =
    trades.reduce(
      (
        sum,
        trade,
      ) =>
        sum +
        trade.netPnl,
      0,
    );

  const averageReturn =
    trades.length > 0
      ? trades.reduce(
          (
            sum,
            trade,
          ) =>
            sum +
            trade.netReturn,
          0,
        ) /
        trades.length
      : null;

  const stopLossCount =
    trades.filter(
      (trade) =>
        trade.exitReason
          .toUpperCase()
          .includes(
            "STOP",
          ),
    ).length;

  return {
    tradeCount:
      trades.length,

    winRate:
      trades.length > 0
        ? wins /
          trades.length
        : null,

    totalPnl,

    averageReturn,

    stopLossCount,

    stopLossRate:
      trades.length > 0
        ? stopLossCount /
          trades.length
        : null,
  };
}

function summarizeBooleanCondition(
  trades:
    EnrichedTrade[],
  selector: (
    trade:
      EnrichedTrade,
  ) => boolean | null,
) {
  const trueTrades =
    trades.filter(
      (trade) =>
        selector(
          trade,
        ) === true,
    );

  const falseTrades =
    trades.filter(
      (trade) =>
        selector(
          trade,
        ) === false,
    );

  return {
    true:
      summarizeTrades(
        trueTrades,
      ),

    false:
      summarizeTrades(
        falseTrades,
      ),
  };
}

function buildQuartileSummary(
  dailyFeaturePoints:
    FeaturePoint[],

  trades:
    EnrichedTrade[],

  selector: (
    value:
      FeaturePoint,
  ) => number | null,

  tradeSelector: (
    trade:
      EnrichedTrade,
  ) => number | null,
) {
  const dailyValues =
    dailyFeaturePoints
      .map(
        selector,
      )
      .filter(
        (
          value,
        ): value is number =>
          value !== null &&
          Number.isFinite(
            value,
          ),
      );

  const q1 =
    quantile(
      dailyValues,
      0.25,
    );

  const q2 =
    quantile(
      dailyValues,
      0.50,
    );

  const q3 =
    quantile(
      dailyValues,
      0.75,
    );

  if (
    q1 === null ||
    q2 === null ||
    q3 === null
  ) {
    return {
      thresholds: {
        q1,
        q2,
        q3,
      },

      buckets: [],
    };
  }

  const buckets = [
    {
      name: "Q1_LOWEST",
      min: null,
      max: q1,
    },
    {
      name: "Q2",
      min: q1,
      max: q2,
    },
    {
      name: "Q3",
      min: q2,
      max: q3,
    },
    {
      name: "Q4_HIGHEST",
      min: q3,
      max: null,
    },
  ];

  return {
    thresholds: {
      q1,
      q2,
      q3,
    },

    buckets:
      buckets.map(
        (bucket) => {
          const selected =
            trades.filter(
              (trade) => {
                const value =
                  tradeSelector(
                    trade,
                  );

                if (
                  value === null
                ) {
                  return false;
                }

                if (
                  bucket.min !==
                    null &&
                  value <
                    bucket.min
                ) {
                  return false;
                }

                if (
                  bucket.max !==
                    null &&
                  value >
                    bucket.max
                ) {
                  return false;
                }

                if (
                  bucket.name !==
                    "Q1_LOWEST" &&
                  bucket.min !==
                    null &&
                  value ===
                    bucket.min
                ) {
                  return false;
                }

                return true;
              },
            );

          return {
            name:
              bucket.name,

            min:
              bucket.min,

            max:
              bucket.max,

            metrics:
              summarizeTrades(
                selected,
              ),
          };
        },
      ),
  };
}

export async function analyzeRegimeV7Trades(
  input:
    AnalyzeInput,
) {
  const supabase =
    createSupabaseServerClient();

  const runIds =
    normalizeRunIds(
      input.runIds,
    );

  if (
    runIds.length === 0
  ) {
    throw new Error(
      "runIds is required.",
    );
  }

  const stockCodes =
    normalizeCodes(
      input.stockCodes,
    );

  const trades =
    await loadPaged<TradeRow>(
      async (
        offset,
        pageSize,
      ) => {
        const result =
          await supabase
            .from(
              "backtest_trades",
            )
            .select(`
              run_id,
              stock_code,
              signal_at,
              exit_reason,
              net_pnl,
              net_return
            `)
            .in(
              "run_id",
              runIds,
            )
            .order(
              "signal_at",
              {
                ascending:
                  true,
              },
            )
            .range(
              offset,
              offset +
                pageSize -
                1,
            );

        return result as unknown as {
          data:
            | TradeRow[]
            | null;

          error:
            | {
                message:
                  string;
              }
            | null;
        };
      },
      "Backtest trade load failed",
    );

  if (
    trades.length === 0
  ) {
    throw new Error(
      "NO_BACKTEST_TRADES_FOR_RUN_IDS",
    );
  }

  const signalDates =
    trades
      .map(
        (trade) =>
          getSignalDate(
            trade.signal_at,
          ),
      )
      .sort();

  const earliestSignalDate =
    signalDates[0];

  const latestSignalDate =
    signalDates[
      signalDates.length -
      1
    ];

  const warmupStartDate =
    subtractCalendarDays(
      earliestSignalDate,
      150,
    );

  const indexRows =
    await loadPaged<IndexRow>(
      async (
        offset,
        pageSize,
      ) => {
        const result =
          await supabase
            .from(
              "market_index_daily_bars",
            )
            .select(`
              market_code,
              trading_date,
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
              warmupStartDate,
            )
            .lte(
              "trading_date",
              latestSignalDate,
            )
            .order(
              "trading_date",
              {
                ascending:
                  true,
              },
            )
            .order(
              "market_code",
              {
                ascending:
                  true,
              },
            )
            .range(
              offset,
              offset +
                pageSize -
                1,
            );

        return result as unknown as {
          data:
            | IndexRow[]
            | null;

          error:
            | {
                message:
                  string;
              }
            | null;
        };
      },
      "Market index history load failed",
    );

  const stockRows =
    await loadPaged<StockBarRow>(
      async (
        offset,
        pageSize,
      ) => {
        const result =
          await supabase
            .from(
              "market_daily_bars",
            )
            .select(`
              stock_code,
              trading_date,
              close_price
            `)
            .in(
              "stock_code",
              stockCodes,
            )
            .gte(
              "trading_date",
              warmupStartDate,
            )
            .lte(
              "trading_date",
              latestSignalDate,
            )
            .order(
              "trading_date",
              {
                ascending:
                  true,
              },
            )
            .order(
              "stock_code",
              {
                ascending:
                  true,
              },
            )
            .range(
              offset,
              offset +
                pageSize -
                1,
            );

        return result as unknown as {
          data:
            | StockBarRow[]
            | null;

          error:
            | {
                message:
                  string;
              }
            | null;
        };
      },
      "Stock breadth history load failed",
    );

  const indexBars:
    MarketRegimeIndexBar[] =
      indexRows.map(
        (row) => ({
          marketCode:
            row.market_code,

          tradingDate:
            row.trading_date,

          close:
            toNumber(
              row.close_value,
            ),
        }),
      );

  const stockBars:
    MarketRegimeStockBar[] =
      stockRows.map(
        (row) => ({
          stockCode:
            row.stock_code,

          tradingDate:
            row.trading_date,

          close:
            toNumber(
              row.close_price,
            ),
        }),
      );

  const allAnalysisDates =
    [
      ...new Set(
        indexRows
          .map(
            (row) =>
              row.trading_date,
          )
          .filter(
            (date) =>
              date >=
                earliestSignalDate &&
              date <=
                latestSignalDate,
          ),
      ),
    ].sort();

  const featureByDate =
    new Map<
      string,
      FeaturePoint
    >();

  for (
    const tradingDate
    of allAnalysisDates
  ) {
    const feature =
      calculateMarketRegimeFeatureVectorV7({
        indexBars:
          indexBars.filter(
            (bar) =>
              bar.tradingDate <=
              tradingDate,
          ),

        stockBars:
          stockBars.filter(
            (bar) =>
              bar.tradingDate <=
              tradingDate,
          ),
      });

    const kospi =
      feature.kospi;

    const kosdaq =
      feature.kosdaq;

    const point:
      FeaturePoint = {
      tradingDate,

      kospiReturn20:
        kospi?.return20 ??
        null,

      kospiReturn60:
        kospi?.return60 ??
        null,

      kosdaqReturn20:
        kosdaq?.return20 ??
        null,

      kosdaqReturn60:
        kosdaq?.return60 ??
        null,

      averageVolatility20:
        toNullableAverage([
          kospi
            ?.realizedVolatility20 ??
            null,

          kosdaq
            ?.realizedVolatility20 ??
            null,
        ]),

      averageDrawdown60:
        toNullableAverage([
          kospi?.drawdown60 ??
            null,

          kosdaq?.drawdown60 ??
            null,
        ]),

      breadth20:
        feature.breadth
          .breadth20,

      breadth60:
        feature.breadth
          .breadth60,

      bothBelowSma20:
        kospi?.aboveSma20 ===
          null ||
        kospi?.aboveSma20 ===
          undefined ||
        kosdaq?.aboveSma20 ===
          null ||
        kosdaq?.aboveSma20 ===
          undefined
          ? null
          : (
              !kospi.aboveSma20 &&
              !kosdaq.aboveSma20
            ),

      bothBelowSma60:
        kospi?.aboveSma60 ===
          null ||
        kospi?.aboveSma60 ===
          undefined ||
        kosdaq?.aboveSma60 ===
          null ||
        kosdaq?.aboveSma60 ===
          undefined
          ? null
          : (
              !kospi.aboveSma60 &&
              !kosdaq.aboveSma60
            ),
    };

    featureByDate.set(
      tradingDate,
      point,
    );
  }

  const enrichedTrades:
    EnrichedTrade[] =
      trades
        .map(
          (trade) => {
            const signalDate =
              getSignalDate(
                trade.signal_at,
              );

            const feature =
              featureByDate.get(
                signalDate,
              );

            if (!feature) {
              return null;
            }

            return {
              ...feature,

              runId:
                trade.run_id,

              stockCode:
                trade.stock_code,

              signalDate,

              exitReason:
                trade.exit_reason,

              netPnl:
                toNumber(
                  trade.net_pnl,
                ),

              netReturn:
                toNumber(
                  trade.net_return,
                ),
            };
          },
        )
        .filter(
          (
            trade,
          ): trade is EnrichedTrade =>
            trade !== null,
        );

  const dailyFeaturePoints =
    [
      ...featureByDate
        .values(),
    ];

  const byYear =
    new Map<
      string,
      EnrichedTrade[]
    >();

  for (
    const trade
    of enrichedTrades
  ) {
    const year =
      trade.signalDate.slice(
        0,
        4,
      );

    const current =
      byYear.get(
        year,
      ) ??
      [];

    current.push(
      trade,
    );

    byYear.set(
      year,
      current,
    );
  }

  return {
    mode:
      "HYPOTHESIS_DISCOVERY_ONLY",

    productionApplied:
      false,

    warning:
      "This analysis is for discovering candidate Regime rules. Any rule found here must be re-selected on training/validation data and tested on later OOS/forward data.",

    runIds,
    stockCodes,

    range: {
      earliestSignalDate,
      latestSignalDate,
      warmupStartDate,
    },

    counts: {
      loadedTrades:
        trades.length,

      enrichedTrades:
        enrichedTrades.length,

      dailyFeaturePoints:
        dailyFeaturePoints.length,

      indexBars:
        indexBars.length,

      stockBars:
        stockBars.length,
    },

    overall:
      summarizeTrades(
        enrichedTrades,
      ),

    byYear:
      Object.fromEntries(
        [
          ...byYear.entries(),
        ].map(
          (
            [
              year,
              yearTrades,
            ],
          ) => [
            year,
            summarizeTrades(
              yearTrades,
            ),
          ],
        ),
      ),

    structuralConditions: {
      bothBelowSma20:
        summarizeBooleanCondition(
          enrichedTrades,
          (trade) =>
            trade.bothBelowSma20,
        ),

      bothBelowSma60:
        summarizeBooleanCondition(
          enrichedTrades,
          (trade) =>
            trade.bothBelowSma60,
        ),

      bothReturn20Negative:
        summarizeBooleanCondition(
          enrichedTrades,
          (trade) => {
            if (
              trade.kospiReturn20 ===
                null ||
              trade.kosdaqReturn20 ===
                null
            ) {
              return null;
            }

            return (
              trade.kospiReturn20 <
                0 &&
              trade.kosdaqReturn20 <
                0
            );
          },
        ),

      bothReturn60Negative:
        summarizeBooleanCondition(
          enrichedTrades,
          (trade) => {
            if (
              trade.kospiReturn60 ===
                null ||
              trade.kosdaqReturn60 ===
                null
            ) {
              return null;
            }

            return (
              trade.kospiReturn60 <
                0 &&
              trade.kosdaqReturn60 <
                0
            );
          },
        ),
    },

    quartiles: {
      kospiReturn20:
        buildQuartileSummary(
          dailyFeaturePoints,
          enrichedTrades,
          (value) =>
            value.kospiReturn20,
          (trade) =>
            trade.kospiReturn20,
        ),

      kosdaqReturn20:
        buildQuartileSummary(
          dailyFeaturePoints,
          enrichedTrades,
          (value) =>
            value.kosdaqReturn20,
          (trade) =>
            trade.kosdaqReturn20,
        ),

      averageVolatility20:
        buildQuartileSummary(
          dailyFeaturePoints,
          enrichedTrades,
          (value) =>
            value.averageVolatility20,
          (trade) =>
            trade.averageVolatility20,
        ),

      averageDrawdown60:
        buildQuartileSummary(
          dailyFeaturePoints,
          enrichedTrades,
          (value) =>
            value.averageDrawdown60,
          (trade) =>
            trade.averageDrawdown60,
        ),

      breadth20:
        buildQuartileSummary(
          dailyFeaturePoints,
          enrichedTrades,
          (value) =>
            value.breadth20,
          (trade) =>
            trade.breadth20,
        ),

      breadth60:
        buildQuartileSummary(
          dailyFeaturePoints,
          enrichedTrades,
          (value) =>
            value.breadth60,
          (trade) =>
            trade.breadth60,
        ),
    },

    /*
     * Keep response manageable.
     * Full source trades remain in backtest_trades.
     */
    sample:
      enrichedTrades.slice(
        -20,
      ),
  };
}