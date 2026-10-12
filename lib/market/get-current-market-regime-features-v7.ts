import {
  calculateMarketRegimeFeatureVectorV7,
  type MarketRegimeFeatureMarket,
  type MarketRegimeIndexBar,
  type MarketRegimeStockBar,
} from "@/lib/market/market-regime-feature-engine";

import {
  createSupabaseServerClient,
} from "@/lib/supabase";

interface IndexRow {
  market_code: string;
  trading_date: string;
  close_value:
    | number
    | string;
}

interface ActiveStockRow {
  stock_code: string;
}

interface StockBarRow {
  stock_code: string;
  trading_date: string;
  close_price:
    | number
    | string;
}

function toNumber(
  value:
    | number
    | string,
): number | null {
  const parsed =
    Number(value);

  return Number.isFinite(
    parsed,
  )
    ? parsed
    : null;
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

export async function getCurrentMarketRegimeFeaturesV7() {
  const supabase =
    createSupabaseServerClient();

  const {
    data: indexData,
    error: indexError,
  } =
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
      .order(
        "trading_date",
        {
          ascending: false,
        },
      )
      .limit(220);

  if (indexError) {
    throw new Error(
      `Market index feature load failed: ${indexError.message}`,
    );
  }

  const indexRows =
    (indexData ??
      []) as IndexRow[];

  if (
    indexRows.length === 0
  ) {
    throw new Error(
      "NO_MARKET_INDEX_DAILY_BARS",
    );
  }

  const indexBars:
    MarketRegimeIndexBar[] =
      indexRows
        .map(
          (row) => {
            const close =
              toNumber(
                row.close_value,
              );

            if (
              close === null ||
              (
                row.market_code !==
                  "KOSPI" &&
                row.market_code !==
                  "KOSDAQ"
              )
            ) {
              return null;
            }

            return {
              marketCode:
                row.market_code as
                  MarketRegimeFeatureMarket,

              tradingDate:
                row.trading_date,

              close,
            };
          },
        )
        .filter(
          (
            row,
          ): row is MarketRegimeIndexBar =>
            row !== null,
        );

  const latestMarketDate =
    indexBars
      .map(
        (row) =>
          row.tradingDate,
      )
      .sort()
      .at(-1);

  if (
    !latestMarketDate
  ) {
    throw new Error(
      "NO_VALID_MARKET_INDEX_BARS",
    );
  }

  const historyStartDate =
    subtractCalendarDays(
      latestMarketDate,
      130,
    );

  const {
    data: activeStockData,
    error: activeStockError,
  } =
    await supabase
      .from("stocks")
      .select("stock_code")
      .eq(
        "is_active",
        true,
      )
      .order(
        "stock_code",
        {
          ascending: true,
        },
      );

  if (
    activeStockError
  ) {
    throw new Error(
      `Active stock load failed: ${activeStockError.message}`,
    );
  }

  const activeStocks =
    (activeStockData ??
      []) as ActiveStockRow[];

  const stockCodes =
    activeStocks
      .map(
        (row) =>
          row.stock_code,
      )
      .filter(Boolean);

  let stockBars:
    MarketRegimeStockBar[] =
      [];

  if (
    stockCodes.length >
    0
  ) {
    const {
      data: stockBarData,
      error: stockBarError,
    } =
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
          historyStartDate,
        )
        .lte(
          "trading_date",
          latestMarketDate,
        )
        .order(
          "trading_date",
          {
            ascending: true,
          },
        )
        .limit(5000);

    if (
      stockBarError
    ) {
      throw new Error(
        `Stock breadth feature load failed: ${stockBarError.message}`,
      );
    }

    stockBars =
      (
        (
          stockBarData ??
          []
        ) as StockBarRow[]
      )
        .map(
          (row) => {
            const close =
              toNumber(
                row.close_price,
              );

            if (
              close === null
            ) {
              return null;
            }

            return {
              stockCode:
                row.stock_code,

              tradingDate:
                row.trading_date,

              close,
            };
          },
        )
        .filter(
          (
            row,
          ): row is MarketRegimeStockBar =>
            row !== null,
        );
  }

  const result =
    calculateMarketRegimeFeatureVectorV7({
      indexBars,
      stockBars,
    });

  return {
    ...result,

    dataSource: {
      index:
        "market_index_daily_bars",

      breadth:
        "market_daily_bars",

      activeStockCount:
        stockCodes.length,

      historyStartDate,
    },
  };
}