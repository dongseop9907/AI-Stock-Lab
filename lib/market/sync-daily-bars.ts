import {
  getDomesticDailyStockPrices,
  getKisAccessToken,
  type KisDomesticDailyPriceOutput,
} from "@/lib/kis/client";

import { createSupabaseServerClient } from "@/lib/supabase";

interface ActiveStock {
  stock_code: string;
  stock_name: string;
}

interface SyncDailyBarsInput {
  stockCodes?: string[];

  startDate: string;
  endDate: string;

  adjustedPrice?: boolean;

  /*
   * 한 KIS 요청에 너무 긴 기간을 넣지 않기 위해
   * 날짜 범위를 잘라서 조회한다.
   */
  chunkDays?: number;
}

interface SyncFailure {
  stockCode: string;
  stockName: string;

  startDate: string;
  endDate: string;

  message: string;
}

function sleep(
  milliseconds: number,
) {
  return new Promise((resolve) => {
    setTimeout(
      resolve,
      milliseconds,
    );
  });
}

function toNumber(
  value:
    | string
    | number
    | null
    | undefined,
): number | null {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const parsed =
    Number(
      String(value)
        .replaceAll(",", ""),
    );

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function parseYyyyMmDd(
  value: string,
): Date {
  if (
    !/^\d{8}$/.test(value)
  ) {
    throw new Error(
      `날짜는 YYYYMMDD 형식이어야 합니다: ${value}`,
    );
  }

  const year =
    Number(
      value.slice(0, 4),
    );

  const month =
    Number(
      value.slice(4, 6),
    );

  const day =
    Number(
      value.slice(6, 8),
    );

  const result =
    new Date(
      Date.UTC(
        year,
        month - 1,
        day,
      ),
    );

  if (
    Number.isNaN(
      result.getTime(),
    )
  ) {
    throw new Error(
      `잘못된 날짜입니다: ${value}`,
    );
  }

  return result;
}

function formatYyyyMmDd(
  value: Date,
): string {
  const year =
    value.getUTCFullYear();

  const month =
    String(
      value.getUTCMonth() + 1,
    ).padStart(
      2,
      "0",
    );

  const day =
    String(
      value.getUTCDate(),
    ).padStart(
      2,
      "0",
    );

  return (
    `${year}${month}${day}`
  );
}

function formatSqlDate(
  value: string,
): string {
  return (
    `${value.slice(0, 4)}-` +
    `${value.slice(4, 6)}-` +
    `${value.slice(6, 8)}`
  );
}

function normalizeStockCodes(
  values:
    | string[]
    | undefined,
): string[] {
  if (!values) {
    return [];
  }

  return [
    ...new Set(
      values
        .map((value) =>
          value.trim(),
        )
        .filter(Boolean),
    ),
  ];
}

function createDateChunks(
  startDate: string,
  endDate: string,
  chunkDays: number,
) {
  const start =
    parseYyyyMmDd(
      startDate,
    );

  const end =
    parseYyyyMmDd(
      endDate,
    );

  if (
    start.getTime() >
    end.getTime()
  ) {
    throw new Error(
      "startDate가 endDate보다 늦습니다.",
    );
  }

  const chunks: Array<{
    startDate: string;
    endDate: string;
  }> = [];

  let currentStart =
    new Date(
      start.getTime(),
    );

  while (
    currentStart.getTime() <=
    end.getTime()
  ) {
    const currentEnd =
      new Date(
        currentStart.getTime(),
      );

    currentEnd.setUTCDate(
      currentEnd.getUTCDate() +
        chunkDays -
        1,
    );

    if (
      currentEnd.getTime() >
      end.getTime()
    ) {
      currentEnd.setTime(
        end.getTime(),
      );
    }

    chunks.push({
      startDate:
        formatYyyyMmDd(
          currentStart,
        ),

      endDate:
        formatYyyyMmDd(
          currentEnd,
        ),
    });

    currentStart =
      new Date(
        currentEnd.getTime(),
      );

    currentStart.setUTCDate(
      currentStart.getUTCDate() +
        1,
    );
  }

  return chunks;
}

function convertDailyBar(
  stockCode: string,
  row:
    KisDomesticDailyPriceOutput,
  adjustedPrice: boolean,
) {
  const open =
    toNumber(
      row.stck_oprc,
    );

  const high =
    toNumber(
      row.stck_hgpr,
    );

  const low =
    toNumber(
      row.stck_lwpr,
    );

  const close =
    toNumber(
      row.stck_clpr,
    );

  const volume =
    toNumber(
      row.acml_vol,
    ) ?? 0;

  const tradingValue =
    toNumber(
      row.acml_tr_pbmn,
    );

  if (
    !row.stck_bsop_date ||
    !/^\d{8}$/.test(
      row.stck_bsop_date,
    )
  ) {
    return null;
  }

  if (
    open === null ||
    high === null ||
    low === null ||
    close === null
  ) {
    return null;
  }

  if (
    open <= 0 ||
    high <= 0 ||
    low <= 0 ||
    close <= 0
  ) {
    return null;
  }

  /*
   * 깨진 OHLC 데이터는 저장하지 않는다.
   */
  if (
    high < low ||
    open > high ||
    open < low ||
    close > high ||
    close < low
  ) {
    return null;
  }

  return {
    stock_code:
      stockCode,

    trading_date:
      formatSqlDate(
        row.stck_bsop_date,
      ),

    open_price:
      open,

    high_price:
      high,

    low_price:
      low,

    close_price:
      close,

    volume,

    trading_value:
      tradingValue,

    source:
      "KIS_DAILY",

    adjusted_price:
      adjustedPrice,

    raw_payload:
      row,

    collected_at:
      new Date()
        .toISOString(),

    updated_at:
      new Date()
        .toISOString(),
  };
}

export async function syncDailyBars(
  input: SyncDailyBarsInput,
) {
  const supabase =
    createSupabaseServerClient();

  const adjustedPrice =
    input.adjustedPrice !==
    false;

  const chunkDays =
    Math.min(
      90,
      Math.max(
        7,
        Math.floor(
          input.chunkDays ??
            80,
        ),
      ),
    );

  const requestedCodes =
    normalizeStockCodes(
      input.stockCodes,
    );

  let stockQuery =
    supabase
      .from("stocks")
      .select(`
        stock_code,
        stock_name
      `)
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
    requestedCodes.length > 0
  ) {
    stockQuery =
      stockQuery.in(
        "stock_code",
        requestedCodes,
      );
  }

  const {
    data: stockData,
    error: stockError,
  } =
    await stockQuery;

  if (stockError) {
    throw new Error(
      `종목 조회 실패: ${stockError.message}`,
    );
  }

  const stocks =
    (stockData ??
      []) as ActiveStock[];

  if (
    stocks.length === 0
  ) {
    return {
      requestedStocks: 0,
      requestedRanges: 0,
      receivedRows: 0,
      savedRows: 0,
      failures: [],
    };
  }

  const chunks =
    createDateChunks(
      input.startDate,
      input.endDate,
      chunkDays,
    );

  const accessToken =
    await getKisAccessToken();

  const failures:
    SyncFailure[] = [];

  let receivedRows = 0;
  let savedRows = 0;
  let requestedRanges = 0;

  for (
    const stock
    of stocks
  ) {
    for (
      const chunk
      of chunks
    ) {
      requestedRanges += 1;

      try {
        const response =
          await getDomesticDailyStockPrices(
            {
              stockCode:
                stock.stock_code,

              startDate:
                chunk.startDate,

              endDate:
                chunk.endDate,

              period:
                "D",

              adjustedPrice,
            },
            accessToken,
          );

        const rows =
          response.output2 ??
          [];

        receivedRows +=
          rows.length;

        const converted =
          rows
            .map((row) =>
              convertDailyBar(
                stock.stock_code,
                row,
                adjustedPrice,
              ),
            )
            .filter(
              (
                row,
              ): row is NonNullable<
                ReturnType<
                  typeof convertDailyBar
                >
              > =>
                row !== null,
            );

        /*
         * 혹시 KIS가 요청 범위 밖 데이터를
         * 돌려주는 경우도 DB에 넣지 않는다.
         */
        const filtered =
          converted.filter(
            (row) => {
              const compact =
                row.trading_date
                  .replaceAll(
                    "-",
                    "",
                  );

              return (
                compact >=
                  chunk.startDate &&
                compact <=
                  chunk.endDate
              );
            },
          );

        if (
          filtered.length > 0
        ) {
          const {
            error: saveError,
          } =
            await supabase
              .from(
                "market_daily_bars",
              )
              .upsert(
                filtered,
                {
                  onConflict:
                    "stock_code,trading_date",
                },
              );

          if (saveError) {
            throw new Error(
              saveError.message,
            );
          }

          savedRows +=
            filtered.length;
        }
      } catch (error) {
        failures.push({
          stockCode:
            stock.stock_code,

          stockName:
            stock.stock_name,

          startDate:
            chunk.startDate,

          endDate:
            chunk.endDate,

          message:
            error instanceof Error
              ? error.message
              : "과거 시세 수집 오류",
        });
      }

      /*
       * KIS 호출 제한 방지.
       */
      await sleep(
        1500,
      );
    }
  }

  return {
    startDate:
      input.startDate,

    endDate:
      input.endDate,

    adjustedPrice,
    chunkDays,

    requestedStocks:
      stocks.length,

    requestedRanges,

    receivedRows,
    savedRows,

    failureCount:
      failures.length,

    failures,
  };
}