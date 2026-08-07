import {
  getDomesticDailyIndexPrices,
  getKisAccessToken,
  type KisDomesticDailyIndexPriceOutput,
} from "@/lib/kis/client";

import {
  createSupabaseServerClient,
} from "@/lib/supabase";

export type MarketIndexCode =
  | "KOSPI"
  | "KOSDAQ";

interface SyncIndexDailyBarsInput {
  markets?: MarketIndexCode[];
  startDate: string;
  endDate: string;
  chunkDays?: number;
}

interface IndexDefinition {
  marketCode: MarketIndexCode;
  indexCode: string;
  indexName: string;
}

interface SyncFailure {
  marketCode: MarketIndexCode;
  indexCode: string;
  startDate: string;
  endDate: string;
  message: string;
}

const INDEX_DEFINITIONS:
  IndexDefinition[] = [
    {
      marketCode: "KOSPI",
      indexCode: "0001",
      indexName: "KOSPI",
    },
    {
      marketCode: "KOSDAQ",
      indexCode: "1001",
      indexName: "KOSDAQ",
    },
  ];

function sleep(
  milliseconds: number,
) {
  return new Promise(
    (resolve) => {
      setTimeout(
        resolve,
        milliseconds,
      );
    },
  );
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
  if (!/^\d{8}$/.test(value)) {
    throw new Error(
      `Date must use YYYYMMDD: ${value}`,
    );
  }

  const result =
    new Date(
      Date.UTC(
        Number(value.slice(0, 4)),
        Number(value.slice(4, 6)) - 1,
        Number(value.slice(6, 8)),
      ),
    );

  if (
    Number.isNaN(
      result.getTime(),
    )
  ) {
    throw new Error(
      `Invalid date: ${value}`,
    );
  }

  return result;
}

function formatYyyyMmDd(
  value: Date,
): string {
  return (
    String(
      value.getUTCFullYear(),
    ) +
    String(
      value.getUTCMonth() + 1,
    ).padStart(2, "0") +
    String(
      value.getUTCDate(),
    ).padStart(2, "0")
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

function normalizeMarkets(
  values:
    | MarketIndexCode[]
    | undefined,
): MarketIndexCode[] {
  if (
    !values ||
    values.length === 0
  ) {
    return [
      "KOSPI",
      "KOSDAQ",
    ];
  }

  return [
    ...new Set(
      values.filter(
        (
          value,
        ): value is MarketIndexCode =>
          value === "KOSPI" ||
          value === "KOSDAQ",
      ),
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
      "startDate cannot be after endDate.",
    );
  }

  const chunks:
    Array<{
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

function convertIndexBar(
  definition:
    IndexDefinition,
  row:
    KisDomesticDailyIndexPriceOutput,
) {
  const close =
    toNumber(
      row.bstp_nmix_prpr,
    );

  const open =
    toNumber(
      row.bstp_nmix_oprc,
    );

  const high =
    toNumber(
      row.bstp_nmix_hgpr,
    );

  const low =
    toNumber(
      row.bstp_nmix_lwpr,
    );

  const volume =
    toNumber(
      row.acml_vol,
    );

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
    close === null ||
    close <= 0
  ) {
    return null;
  }

  if (
    open !== null &&
    open <= 0
  ) {
    return null;
  }

  if (
    high !== null &&
    high <= 0
  ) {
    return null;
  }

  if (
    low !== null &&
    low <= 0
  ) {
    return null;
  }

  if (
    high !== null &&
    low !== null &&
    high < low
  ) {
    return null;
  }

  if (
    open !== null &&
    high !== null &&
    open > high
  ) {
    return null;
  }

  if (
    open !== null &&
    low !== null &&
    open < low
  ) {
    return null;
  }

  if (
    high !== null &&
    close > high
  ) {
    return null;
  }

  if (
    low !== null &&
    close < low
  ) {
    return null;
  }

  const now =
    new Date()
      .toISOString();

  return {
    market_code:
      definition.marketCode,

    index_code:
      definition.indexCode,

    index_name:
      definition.indexName,

    trading_date:
      formatSqlDate(
        row.stck_bsop_date,
      ),

    open_value: open,
    high_value: high,
    low_value: low,
    close_value: close,

    /*
     * v7 derives returns chronologically later.
     * Do not manufacture a previous-close delta here.
     */
    change_value: null,
    change_rate: null,

    volume,
    trading_value:
      tradingValue,

    market_cap: null,

    source:
      "KIS_INDEX_DAILY",

    raw_payload: row,

    collected_at: now,
    updated_at: now,
  };
}

export async function syncIndexDailyBars(
  input:
    SyncIndexDailyBarsInput,
) {
  const supabase =
    createSupabaseServerClient();

  const markets =
    normalizeMarkets(
      input.markets,
    );

  const definitions =
    INDEX_DEFINITIONS.filter(
      (definition) =>
        markets.includes(
          definition.marketCode,
        ),
    );

  const chunkDays =
    Math.min(
      45,
      Math.max(
        7,
        Math.floor(
          input.chunkDays ??
          45,
        ),
      ),
    );

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

  let requestedRanges = 0;
  let receivedRows = 0;
  let savedRows = 0;

  for (
    const definition
    of definitions
  ) {
    for (
      const chunk
      of chunks
    ) {
      requestedRanges += 1;

      try {
        const response =
          await getDomesticDailyIndexPrices(
            {
              indexCode:
                definition.indexCode,

              startDate:
                chunk.startDate,

              endDate:
                chunk.endDate,

              period: "D",
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
            .map(
              (row) =>
                convertIndexBar(
                  definition,
                  row,
                ),
            )
            .filter(
              (
                row,
              ): row is NonNullable<
                ReturnType<
                  typeof convertIndexBar
                >
              > =>
                row !== null,
            );

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
                "market_index_daily_bars",
              )
              .upsert(
                filtered,
                {
                  onConflict:
                    "market_code,index_code,trading_date",
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
          marketCode:
            definition.marketCode,

          indexCode:
            definition.indexCode,

          startDate:
            chunk.startDate,

          endDate:
            chunk.endDate,

          message:
            error instanceof Error
              ? error.message
              : "Index daily sync failed.",
        });
      }

      /*
       * Same conservative pacing as the existing
       * stock daily-bar collector.
       */
      await sleep(1500);
    }
  }

  return {
    startDate:
      input.startDate,
    endDate:
      input.endDate,
    chunkDays,

    requestedMarkets:
      definitions.length,

    marketDefinitions:
      definitions,

    requestedRanges,
    receivedRows,
    savedRows,

    failureCount:
      failures.length,

    failures,
  };
}