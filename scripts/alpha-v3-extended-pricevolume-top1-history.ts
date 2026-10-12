import fs from "node:fs";
import path from "node:path";

import {
  createSupabaseServerClient,
} from "../lib/supabase";

import {
  buildDailyPriceVolumeEvidence,
  type DailyAlphaBarLike,
} from "../lib/alpha/daily-market-adapters";

import {
  calculateMarketRegimeFeatureVectorV7,
  type MarketRegimeFeatureMarket,
  type MarketRegimeIndexBar,
  type MarketRegimeStockBar,
} from "../lib/market/market-regime-feature-engine";

interface ActiveStock {
  stock_code: string;
  stock_name: string | null;
  market: string | null;
}

interface DailyBarRow extends DailyAlphaBarLike {
  trading_date: string;
}

interface IndexBarRow {
  market_code: string;
  trading_date: string;
  close_value: number | string | null;
}

function toNumber(value: unknown): number | null {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}

function nextCalendarDayDecisionAt(
  tradingDate: string,
) {
  /*
   * Daily adapter marks a completed bar available at
   * tradingDate 15:00 UTC = next calendar day 00:00 KST.
   * Evaluate five minutes later to keep the boundary explicit.
   */
  const d =
    new Date(
      `${tradingDate}T15:05:00.000Z`,
    );

  return d.toISOString();
}

async function fetchAllRows<T>(
  buildQuery: (
    from: number,
    to: number,
  ) => PromiseLike<{
    data: T[] | null;
    error: {
      message?: string;
    } | null;
  }>,
  label: string,
): Promise<T[]> {
  const pageSize = 1000;
  const out: T[] = [];

  for (
    let from = 0;
    ;
    from += pageSize
  ) {
    const to =
      from +
      pageSize -
      1;

    const result =
      await buildQuery(
        from,
        to,
      );

    if (result.error) {
      throw new Error(
        `${label}_READ_FAILED:${result.error.message ?? "UNKNOWN"}`,
      );
    }

    const rows =
      result.data ??
      [];

    out.push(
      ...rows,
    );

    if (
      rows.length <
      pageSize
    ) {
      break;
    }
  }

  return out;
}

function average(
  values: number[],
): number | null {
  return values.length
    ? values.reduce(
        (sum, value) =>
          sum + value,
        0,
      ) /
        values.length
    : null;
}

async function main() {
  const root =
    process.cwd();

  const supabase =
    createSupabaseServerClient();

  const stockResult =
    await supabase
      .from("stocks")
      .select(
        "stock_code,stock_name,market",
      )
      .eq(
        "is_active",
        true,
      )
      .order(
        "stock_code",
      );

  if (stockResult.error) {
    throw new Error(
      `ACTIVE_STOCK_READ_FAILED:${stockResult.error.message}`,
    );
  }

  const stocks =
    (stockResult.data ??
      []) as ActiveStock[];

  if (!stocks.length) {
    throw new Error(
      "NO_ACTIVE_STOCKS",
    );
  }

  const stockCodes =
    stocks.map(
      (row) =>
        row.stock_code,
    );

  const dailyBars =
    await fetchAllRows<DailyBarRow>(
      (from, to) =>
        supabase
          .from(
            "market_daily_bars",
          )
          .select(
            "stock_code,trading_date,open_price,high_price,low_price,close_price,volume,trading_value,adjusted_price,source,updated_at",
          )
          .in(
            "stock_code",
            stockCodes,
          )
          .eq(
            "adjusted_price",
            true,
          )
          .order(
            "trading_date",
            {
              ascending: true,
            },
          )
          .order(
            "stock_code",
            {
              ascending: true,
            },
          )
          .range(
            from,
            to,
          ),
      "DAILY_BARS",
    );

  const indexBarsRaw =
    await fetchAllRows<IndexBarRow>(
      (from, to) =>
        supabase
          .from(
            "market_index_daily_bars",
          )
          .select(
            "market_code,trading_date,close_value",
          )
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
              ascending: true,
            },
          )
          .order(
            "market_code",
            {
              ascending: true,
            },
          )
          .range(
            from,
            to,
          ),
      "INDEX_BARS",
    );

  const tradingDates =
    [
      ...new Set(
        dailyBars.map(
          (row) =>
            String(
              row.trading_date,
            ),
        ),
      ),
    ].sort();

  if (
    tradingDates.length <
    62
  ) {
    throw new Error(
      `INSUFFICIENT_DAILY_HISTORY:${tradingDates.length}`,
    );
  }

  const barsByStock =
    new Map<
      string,
      DailyBarRow[]
    >();

  for (const stock of stocks) {
    barsByStock.set(
      stock.stock_code,
      [],
    );
  }

  for (const row of dailyBars) {
    const code =
      String(
        row.stock_code,
      );

    const arr =
      barsByStock.get(
        code,
      );

    if (arr) {
      arr.push(
        row,
      );
    }
  }

  const indexBarsAll:
    MarketRegimeIndexBar[] =
    indexBarsRaw
      .map(
        (row) => {
          const close =
            toNumber(
              row.close_value,
            );

          const marketCode =
            String(
              row.market_code,
            );

          if (
            close === null ||
            (
              marketCode !==
                "KOSPI" &&
              marketCode !==
                "KOSDAQ"
            )
          ) {
            return null;
          }

          return {
            marketCode:
              marketCode as
                MarketRegimeFeatureMarket,

            tradingDate:
              String(
                row.trading_date,
              ),

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

  const top1Rows:
    any[] =
    [];

  const skippedDates:
    any[] =
    [];

  /*
   * sourceTradingDate is the latest completed bar.
   * Decision happens just after 00:00 KST on the next calendar day.
   * The actual target session is the next trading date after sourceTradingDate.
   */
  for (
    let dateIndex = 0;
    dateIndex <
    tradingDates.length -
      1;
    dateIndex += 1
  ) {
    const sourceTradingDate =
      tradingDates[
        dateIndex
      ];

    const targetSessionDate =
      tradingDates[
        dateIndex + 1
      ];

    const decisionAt =
      nextCalendarDayDecisionAt(
        sourceTradingDate,
      );

    const asOfDailyBars =
      dailyBars.filter(
        (row) =>
          String(
            row.trading_date,
          ) <=
          sourceTradingDate,
      );

    const indexBars =
      indexBarsAll.filter(
        (row) =>
          row.tradingDate <=
          sourceTradingDate,
      );

    const stockBars:
      MarketRegimeStockBar[] =
      asOfDailyBars
        .map(
          (row) => {
            const close =
              toNumber(
                row.close_price,
              );

            if (
              close ===
              null
            ) {
              return null;
            }

            return {
              stockCode:
                String(
                  row.stock_code,
                ),

              tradingDate:
                String(
                  row.trading_date,
                ),

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

    let v7Features;

    try {
      v7Features =
        calculateMarketRegimeFeatureVectorV7({
          indexBars,
          stockBars,
        });
    } catch (error) {
      skippedDates.push({
        sourceTradingDate,
        targetSessionDate,
        reason:
          "V7_FEATURE_BUILD_FAILED",
        error:
          String(
            error instanceof Error
              ? error.message
              : error,
          ),
      });

      continue;
    }

    const ranking:
      any[] =
      [];

    for (const stock of stocks) {
      const stockRows =
        barsByStock.get(
          stock.stock_code,
        ) ??
        [];

      const evidence =
        buildDailyPriceVolumeEvidence({
          stockCode:
            stock.stock_code,

          market:
            stock.market,

          decisionAt,

          rows:
            stockRows,

          v7Features,
        });

      if (!evidence) {
        continue;
      }

      /*
       * PriceVolume-only ranking score.
       * Confidence shrink toward neutral 0.5 preserves the evidence
       * contract while avoiding any dependence on removed V1 dimensions.
       *
       * For stocks with equal history depth this transform is monotonic
       * with raw priceVolume score.
       */
      const effectiveScore =
        0.5 +
        (
          evidence.score -
          0.5
        ) *
          evidence.confidence;

      ranking.push({
        stockCode:
          stock.stock_code,

        stockName:
          stock.stock_name,

        market:
          stock.market,

        rawPriceVolumeScore:
          evidence.score,

        confidence:
          evidence.confidence,

        effectiveScore,

        availableAt:
          evidence.availableAt,

        latestTradingDate:
          (
            evidence.metadata as
              Record<
                string,
                unknown
              >
          )
            ?.latestTradingDate ??
          null,

        metadata:
          evidence.metadata,
      });
    }

    ranking.sort(
      (a, b) =>
        b.effectiveScore -
          a.effectiveScore ||
        b.rawPriceVolumeScore -
          a.rawPriceVolumeScore ||
        a.stockCode.localeCompare(
          b.stockCode,
        ),
    );

    const top1 =
      ranking[0];

    if (!top1) {
      skippedDates.push({
        sourceTradingDate,
        targetSessionDate,
        reason:
          "NO_PRICEVOLUME_CANDIDATE",
      });

      continue;
    }

    const stockForwardBars =
      (
        barsByStock.get(
          top1.stockCode,
        ) ??
        []
      )
        .filter(
          (row) =>
            String(
              row.trading_date,
            ) >=
            targetSessionDate,
        )
        .sort(
          (a, b) =>
            String(
              a.trading_date,
            ).localeCompare(
              String(
                b.trading_date,
              ),
            ),
        );

    const b1 =
      stockForwardBars[0];

    const b3 =
      stockForwardBars[2];

    const b5 =
      stockForwardBars[4];

    const targetOpen =
      toNumber(
        b1?.open_price,
      );

    const returnFromOpen = (
      bar:
        DailyBarRow |
        undefined,
    ) => {
      const close =
        toNumber(
          bar?.close_price,
        );

      return (
        targetOpen !== null &&
        targetOpen >
          0 &&
        close !== null
      )
        ? close /
            targetOpen -
          1
        : null;
    };

    top1Rows.push({
      sourceTradingDate,
      decisionAt,
      targetSessionDate,

      candidateCount:
        ranking.length,

      top1,

      forwardOpenReturn: {
        r1:
          returnFromOpen(
            b1,
          ),

        r3:
          returnFromOpen(
            b3,
          ),

        r5:
          returnFromOpen(
            b5,
          ),
      },

      top5:
        ranking.slice(
          0,
          5,
        ),
    });
  }

  const labeled = (
    horizon:
      | "r1"
      | "r3"
      | "r5",
  ) =>
    top1Rows
      .map(
        (row) =>
          row.forwardOpenReturn[
            horizon
          ],
      )
      .filter(
        Number.isFinite,
      ) as number[];

  const rangeByStock =
    stocks.map(
      (stock) => {
        const rows =
          barsByStock.get(
            stock.stock_code,
          ) ??
          [];

        const dates =
          rows
            .map(
              (row) =>
                String(
                  row.trading_date,
                ),
            )
            .sort();

        return {
          stockCode:
            stock.stock_code,

          stockName:
            stock.stock_name,

          market:
            stock.market,

          rowCount:
            rows.length,

          firstDate:
            dates[0] ??
            null,

          lastDate:
            dates.at(-1) ??
            null,
        };
      },
    );

  const eligibleCount =
    top1Rows.length;

  const report = {
    status:
      "ALPHA_V3_EXTENDED_PRICEVOLUME_TOP1_HISTORY_COMPLETE",

    counts: {
      activeStocks:
        stocks.length,

      adjustedDailyRows:
        dailyBars.length,

      indexRows:
        indexBarsAll.length,

      uniqueTradingDates:
        tradingDates.length,

      reconstructedTop1Dates:
        top1Rows.length,

      skippedDates:
        skippedDates.length,

      r1LabeledDates:
        labeled(
          "r1",
        ).length,

      r3LabeledDates:
        labeled(
          "r3",
        ).length,

      r5LabeledDates:
        labeled(
          "r5",
        ).length,
    },

    dailyBarRange: {
      firstTradingDate:
        tradingDates[0],

      lastTradingDate:
        tradingDates.at(-1),

      byStock:
        rangeByStock,
    },

    aggregateTop1OpenReturn: {
      r1:
        average(
          labeled(
            "r1",
          ),
        ),

      r3:
        average(
          labeled(
            "r3",
          ),
        ),

      r5:
        average(
          labeled(
            "r5",
          ),
        ),
    },

    methodology: {
      warmup:
        "buildDailyPriceVolumeEvidence requires >=61 completed adjusted daily bars",

      decisionAt:
        "00:05 KST on calendar day after sourceTradingDate",

      targetSession:
        "next actual trading date after sourceTradingDate",

      ranking:
        "priceVolume evidence only; confidence-shrunk effectiveScore",

      regimeUse:
        "V7 feature vector supplies KOSPI/KOSDAQ benchmark returns used inside priceVolume evidence",

      lookahead:
        "daily evidence internally enforces availableAt <= decisionAt",

      databaseWrites:
        0,
    },

    top1Rows,

    skippedDates,

    safety: {
      databaseReadsOnly:
        true,

      databaseWrites:
        0,

      ordersCreated:
        0,

      positionsChanged:
        0,

      productionChanged:
        false,
    },

    nextGate:
      eligibleCount >=
        60
        ? "BUILD_EXTENDED_ENTRY_V3_KIS_MINUTE_REPLAY_PLAN"
        : "EXTEND_DAILY_BAR_HISTORY_BEFORE_ENTRY_V3_VALIDATION",
  };

  fs.writeFileSync(
    path.join(
      root,
      "logs",
      "alpha-v3-extended-pricevolume-top1-history.json",
    ),
    JSON.stringify(
      report,
      null,
      2,
    ) +
      "\n",
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        status:
          report.status,

        counts:
          report.counts,

        dailyBarRange:
          report.dailyBarRange,

        aggregateTop1OpenReturn:
          report.aggregateTop1OpenReturn,

        sampleTop1Rows:
          report.top1Rows.slice(
            0,
            5,
          ),

        lastTop1Rows:
          report.top1Rows.slice(
            -5,
          ),

        nextGate:
          report.nextGate,

        outputFile:
          "logs/alpha-v3-extended-pricevolume-top1-history.json",
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
            "ALPHA_V3_EXTENDED_PRICEVOLUME_TOP1_HISTORY_FAILED",

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
