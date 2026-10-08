import fs from "node:fs";
import path from "node:path";

import {
  createSupabaseServerClient,
} from "../lib/supabase";

import {
  getDomesticInvestorTradeDaily,
  getKisAccessToken,
} from "../lib/kis/client";

const VERSION =
  "ALPHA_V1_KIS_HISTORICAL_FLOW_COVERAGE_READ_ONLY";

const RANGE_START =
  "20260730";

const RANGE_END =
  "20261002";

const ANCHORS = [
  "20260730",
  "20260831",
  "20261002",
] as const;

const REQUEST_DELAY_MS =
  800;

const OUTPUT_FILE =
  path.resolve(
    process.cwd(),
    "logs",
    "alpha-v1-kis-historical-flow-coverage-read-only.json",
  );

type JsonRecord =
  Record<string, unknown>;

function sleep(
  milliseconds: number,
) {
  return new Promise(
    (
      resolve,
    ) => {
      setTimeout(
        resolve,
        milliseconds,
      );
    },
  );
}

function compactDate(
  value: string,
) {
  return value
    .replace(
      /-/g,
      "",
    )
    .trim();
}

function isoDate(
  value: string,
) {
  const normalized =
    compactDate(
      value,
    );

  if (
    !/^\d{8}$/.test(
      normalized,
    )
  ) {
    return value;
  }

  return `${normalized.slice(0, 4)}-${normalized.slice(4, 6)}-${normalized.slice(6, 8)}`;
}

function asString(
  value: unknown,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  return String(
    value,
  );
}

function asNumber(
  value: unknown,
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const parsed =
    Number(value);

  return Number.isFinite(
    parsed,
  )
    ? parsed
    : null;
}

function normalizeFlowRow(
  stockCode: string,
  row: JsonRecord,
) {
  return {
    stockCode,

    tradingDate:
      asString(
        row.stck_bsop_date,
      ),

    closePrice:
      asNumber(
        row.stck_clpr,
      ),

    accumulatedVolume:
      asNumber(
        row.acml_vol,
      ),

    accumulatedTradingValue:
      asNumber(
        row.acml_tr_pbmn,
      ),

    individualNetBuyQuantity:
      asNumber(
        row.prsn_ntby_qty,
      ),

    foreignNetBuyQuantity:
      asNumber(
        row.frgn_ntby_qty,
      ),

    institutionNetBuyQuantity:
      asNumber(
        row.orgn_ntby_qty,
      ),

    individualNetBuyAmount:
      asNumber(
        row.prsn_ntby_tr_pbmn,
      ),

    foreignNetBuyAmount:
      asNumber(
        row.frgn_ntby_tr_pbmn,
      ),

    institutionNetBuyAmount:
      asNumber(
        row.orgn_ntby_tr_pbmn,
      ),

    source:
      "KIS_INVESTOR_TRADE_BY_STOCK_DAILY",

    sourceVersion:
      "FHPTJ04160001",
  };
}

async function readActiveStocks() {
  const supabase =
    createSupabaseServerClient();

  const result =
    await supabase
      .from(
        "stocks",
      )
      .select(
        "stock_code, stock_name, market",
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
    result.error
  ) {
    throw new Error(
      `ACTIVE_STOCK_READ_FAILED:${result.error.message}`,
    );
  }

  return (
    result.data ??
    []
  ).map(
    (
      row,
    ) => ({
      stockCode:
        String(
          row.stock_code,
        ),

      stockName:
        row.stock_name == null
          ? null
          : String(
              row.stock_name,
            ),

      market:
        row.market == null
          ? null
          : String(
              row.market,
            ),
    }),
  );
}

async function readExpectedTradingDates() {
  const supabase =
    createSupabaseServerClient();

  const result =
    await supabase
      .from(
        "market_index_daily_bars",
      )
      .select(
        "trading_date",
      )
      .eq(
        "market_code",
        "KOSPI",
      )
      .gte(
        "trading_date",
        isoDate(
          RANGE_START,
        ),
      )
      .lte(
        "trading_date",
        isoDate(
          RANGE_END,
        ),
      )
      .order(
        "trading_date",
        {
          ascending:
            true,
        },
      );

  if (
    result.error
  ) {
    throw new Error(
      `EXPECTED_TRADING_DATE_READ_FAILED:${result.error.message}`,
    );
  }

  return [
    ...new Set(
      (
        result.data ??
        []
      )
        .map(
          (
            row,
          ) =>
            compactDate(
              String(
                row.trading_date,
              ),
            ),
        )
        .filter(
          (
            value,
          ) =>
            /^\d{8}$/.test(
              value,
            ),
        ),
    ),
  ].sort();
}

async function main() {
  const startedAt =
    new Date()
      .toISOString();

  const [
    stocks,
    expectedTradingDates,
  ] =
    await Promise.all([
      readActiveStocks(),
      readExpectedTradingDates(),
    ]);

  const accessToken =
    await getKisAccessToken();

  const requestResults:
    Array<
      Record<string, unknown>
    > =
    [];

  const rowsByStock =
    new Map<
      string,
      Map<
        string,
        ReturnType<
          typeof normalizeFlowRow
        >
      >
    >();

  for (
    const stock
    of stocks
  ) {
    rowsByStock.set(
      stock.stockCode,
      new Map(),
    );

    for (
      const anchor
      of ANCHORS
    ) {
      try {
        const result =
          await getDomesticInvestorTradeDaily(
            stock.stockCode,
            anchor,
            accessToken,
          );

        const output2 =
          Array.isArray(
            result.body.output2,
          )
            ? result.body.output2
            : result.body.output2
            ? [
                result.body.output2,
              ]
            : [];

        const normalizedRows =
          (
            output2 as
              JsonRecord[]
          )
            .map(
              (
                row,
              ) =>
                normalizeFlowRow(
                  stock.stockCode,
                  row,
                ),
            )
            .filter(
              (
                row,
              ) =>
                Boolean(
                  row.tradingDate,
                ),
            );

        const stockMap =
          rowsByStock.get(
            stock.stockCode,
          )!;

        for (
          const row
          of normalizedRows
        ) {
          if (
            row.tradingDate
          ) {
            stockMap.set(
              row.tradingDate,
              row,
            );
          }
        }

        const dates =
          normalizedRows
            .map(
              (
                row,
              ) =>
                row.tradingDate,
            )
            .filter(
              (
                value,
              ): value is string =>
                Boolean(
                  value,
                ),
            )
            .sort();

        requestResults.push({
          stockCode:
            stock.stockCode,

          stockName:
            stock.stockName,

          anchor,

          status:
            "OK",

          rtCd:
            result.body.rt_cd ??
            null,

          msgCd:
            result.body.msg_cd ??
            null,

          rowCount:
            normalizedRows.length,

          earliestReturnedDate:
            dates[0] ??
            null,

          latestReturnedDate:
            dates.at(-1) ??
            null,

          anchorDatePresent:
            dates.includes(
              anchor,
            ),

          trCont:
            result.trCont,
        });
      } catch (
        error
      ) {
        requestResults.push({
          stockCode:
            stock.stockCode,

          stockName:
            stock.stockName,

          anchor,

          status:
            "FAILED",

          error:
            String(
              error instanceof Error
                ? error.message
                : error,
            ),
        });
      }

      await sleep(
        REQUEST_DELAY_MS,
      );
    }
  }

  const coverageByStock =
    stocks.map(
      (
        stock,
      ) => {
        const stockRows =
          [
            ...(
              rowsByStock
                .get(
                  stock.stockCode,
                )
                ?.values() ??
              []
            ),
          ];

        const collectedDates =
          stockRows
            .map(
              (
                row,
              ) =>
                row.tradingDate,
            )
            .filter(
              (
                value,
              ): value is string =>
                Boolean(
                  value,
                ),
            )
            .sort();

        const rangeDates =
          collectedDates
            .filter(
              (
                date,
              ) =>
                date >=
                  RANGE_START &&
                date <=
                  RANGE_END,
            );

        const rangeSet =
          new Set(
            rangeDates,
          );

        const missingTradingDates =
          expectedTradingDates
            .filter(
              (
                date,
              ) =>
                !rangeSet.has(
                  date,
                ),
            );

        const duplicatesRemoved =
          requestResults
            .filter(
              (
                request,
              ) =>
                request.stockCode ===
                stock.stockCode &&
                request.status ===
                  "OK",
            )
            .reduce(
              (
                total,
                request,
              ) =>
                total +
                Number(
                  request.rowCount ??
                  0,
                ),
              0,
            ) -
          collectedDates.length;

        return {
          stockCode:
            stock.stockCode,

          stockName:
            stock.stockName,

          market:
            stock.market,

          uniqueCollectedRows:
            collectedDates.length,

          rowsInsideReplayWindow:
            rangeDates.length,

          earliestCollectedDate:
            collectedDates[0] ??
            null,

          latestCollectedDate:
            collectedDates.at(-1) ??
            null,

          expectedTradingDates:
            expectedTradingDates.length,

          missingTradingDateCount:
            missingTradingDates.length,

          missingTradingDates,

          duplicatesRemoved,

          gapFree:
            missingTradingDates.length ===
            0,
        };
      },
    );

  const failedRequests =
    requestResults
      .filter(
        (
          row,
        ) =>
          row.status ===
          "FAILED",
      );

  const allStocksGapFree =
    coverageByStock.every(
      (
        row,
      ) =>
        row.gapFree,
    );

  const rawRows =
    stocks.flatMap(
      (
        stock,
      ) =>
        [
          ...(
            rowsByStock
              .get(
                stock.stockCode,
              )
              ?.values() ??
            []
          ),
        ],
    );

  const report = {
    status:
      "ALPHA_V1_KIS_HISTORICAL_FLOW_COVERAGE_READ_ONLY_COMPLETE",

    version:
      VERSION,

    startedAt,

    finishedAt:
      new Date()
        .toISOString(),

    target: {
      replayStartDate:
        RANGE_START,

      replayEndDate:
        RANGE_END,

      anchors:
        ANCHORS,

      activeStockCount:
        stocks.length,

      expectedTradingDateCount:
        expectedTradingDates.length,
    },

    source: {
      endpoint:
        "/uapi/domestic-stock/v1/quotations/investor-trade-by-stock-daily",

      trId:
        "FHPTJ04160001",

      dateParameter:
        "FID_INPUT_DATE_1",

      rowsPerRequestObserved:
        30,

      continuationRequired:
        false,

      collectionStrategy:
        "OVERLAPPING_ANCHOR_DATES_THEN_DEDUPLICATE_BY_STOCK_CODE_AND_TRADING_DATE",
    },

    requests: {
      attempted:
        requestResults.length,

      successful:
        requestResults.length -
        failedRequests.length,

      failed:
        failedRequests.length,

      results:
        requestResults,
    },

    coverage: {
      expectedTradingDates,

      byStock:
        coverageByStock,

      allStocksGapFree,

      totalUniqueRows:
        rawRows.length,
    },

    backfillDecision: {
      historicalFlowCoverageProven:
        allStocksGapFree &&
        failedRequests.length ===
          0,

      databaseWritePerformed:
        false,

      recommendedKey:
        [
          "stock_code",
          "trading_date",
        ],

      recommendedNextGate:
        allStocksGapFree &&
        failedRequests.length ===
          0
          ? "ALPHA_V1_DEFINE_HISTORICAL_FLOW_STORAGE_AND_CONTROLLED_BACKFILL"
          : "ALPHA_V1_ADJUST_ANCHORS_OR_RETRY_MISSING_HISTORICAL_FLOW",
    },

    normalizedRows:
      rawRows
        .sort(
          (
            left,
            right,
          ) => {
            const stockCompare =
              left.stockCode
                .localeCompare(
                  right.stockCode,
                );

            if (
              stockCompare !==
              0
            ) {
              return stockCompare;
            }

            return String(
              left.tradingDate,
            ).localeCompare(
              String(
                right.tradingDate,
              ),
            );
          },
        ),

    safety: {
      databaseReads:
        2,

      databaseWrites:
        0,

      kisTokenRequests:
        1,

      kisHistoricalFlowRequests:
        requestResults.length,

      ordersCreated:
        0,

      positionsChanged:
        0,

      productionDecisionApplied:
        false,
    },

    outputFile:
      "logs/alpha-v1-kis-historical-flow-coverage-read-only.json",
  };

  fs.mkdirSync(
    path.dirname(
      OUTPUT_FILE,
    ),
    {
      recursive:
        true,
    },
  );

  fs.writeFileSync(
    OUTPUT_FILE,
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
}

main().catch(
  (
    error,
  ) => {
    console.error(
      JSON.stringify(
        {
          status:
            "ALPHA_V1_KIS_HISTORICAL_FLOW_COVERAGE_READ_ONLY_FAILED",

          version:
            VERSION,

          error:
            String(
              error instanceof Error
                ? error.message
                : error,
            ),

          databaseWrites:
            0,

          ordersCreated:
            0,
        },
        null,
        2,
      ),
    );

    process.exitCode =
      2;
  },
);
