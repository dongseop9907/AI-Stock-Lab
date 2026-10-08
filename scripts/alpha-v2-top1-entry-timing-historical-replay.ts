import fs from "node:fs";
import path from "node:path";

import {
  createSupabaseServerClient,
} from "../lib/supabase";

import {
  calculateEntrySignal,
  type SnapshotRecord,
} from "../lib/trading/generate-entry-signals";

import {
  getActiveEntryThreshold,
} from "../lib/trading/get-active-entry-threshold";

import type {
  PredictionCandidate,
} from "../lib/trading/get-latest-prediction-candidates";

function avg(
  values: number[],
): number | null {
  return values.length
    ? values.reduce(
        (a, b) => a + b,
        0,
      ) / values.length
    : null;
}

function kstDate(
  iso: string,
): string {
  const d =
    new Date(
      new Date(iso).getTime() +
      9 * 60 * 60 * 1000,
    );

  return d
    .toISOString()
    .slice(
      0,
      10,
    );
}

function normalizeThreshold(
  value: unknown,
): number {
  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return value;
  }

  if (
    value &&
    typeof value === "object"
  ) {
    const row =
      value as Record<
        string,
        unknown
      >;

    for (
      const key
      of [
        "threshold",
        "scoreThreshold",
        "entryScoreThreshold",
        "value",
      ]
    ) {
      const candidate =
        Number(
          row[key],
        );

      if (
        Number.isFinite(candidate)
      ) {
        return candidate;
      }
    }
  }

  throw new Error(
    `UNSUPPORTED_ENTRY_THRESHOLD_SHAPE:${JSON.stringify(value)}`,
  );
}

function priceVolumeScore(
  row: any,
): number | null {
  const dim =
    (
      row.dimensions ??
      []
    ).find(
      (item: any) =>
        item.dimension ===
        "priceVolume",
    );

  const effective =
    Number(
      dim?.effectiveScore,
    );

  const quality =
    Number(
      row.quality,
    );

  if (
    !Number.isFinite(effective) ||
    !Number.isFinite(quality)
  ) {
    return null;
  }

  return (
    0.5 +
    (
      effective -
      0.5
    ) *
      quality
  );
}

function makePrediction(
  row: {
    date: string;
    decisionAt: string;
    stockCode: string;
    v2Score: number;
    quality: number;
  },
): PredictionCandidate {
  return {
    predictionId:
      `ALPHA_V2_REPLAY_${row.date}_${row.stockCode}`,

    stockCode:
      row.stockCode,

    predictionDate:
      row.date,

    generatedAt:
      row.decisionAt,

    modelName:
      "ALPHA_V2_PRICE_VOLUME_TOP1",

    modelVersion:
      "READ_ONLY_DIAGNOSTIC_V1",

    score:
      row.v2Score,

    confidence:
      row.quality,

    disclosureScore:
      null,

    priceMomentum:
      null,

    intradayReturn:
      null,

    volumeRatio:
      null,

    reasons: [
      "Alpha V2 priceVolume daily Top1 selected in historical replay.",
    ],
  };
}

async function main() {
  const root =
    process.cwd();

  const replay =
    JSON.parse(
      fs.readFileSync(
        path.join(
          root,
          "logs",
          "alpha-v1-alpha-only-historical-replay-read-only.json",
        ),
        "utf8",
      ),
    );

  const dailyTop1 =
    (replay.replay ?? [])
      .map(
        (day: any) => {
          const ranked =
            (
              day.rawRanking ??
              []
            )
              .map(
                (row: any) => ({
                  date:
                    day.date,
                  decisionAt:
                    day.decisionAt,
                  stockCode:
                    row.stockCode,
                  quality:
                    Number(
                      row.quality,
                    ),
                  v2Score:
                    priceVolumeScore(
                      row,
                    ),
                }),
              )
              .filter(
                (row: any) =>
                  Number.isFinite(
                    row.v2Score,
                  ),
              )
              .sort(
                (
                  a: any,
                  b: any,
                ) =>
                  b.v2Score -
                  a.v2Score,
              );

          return (
            ranked[0] ??
            null
          );
        },
      )
      .filter(
        Boolean,
      ) as Array<{
        date: string;
        decisionAt: string;
        stockCode: string;
        quality: number;
        v2Score: number;
      }>;

  if (
    !dailyTop1.length
  ) {
    throw new Error(
      "NO_ALPHA_V2_TOP1_ROWS",
    );
  }

  const thresholdRaw:
    any =
    await getActiveEntryThreshold();

  const entryScoreThreshold =
    normalizeThreshold(
      thresholdRaw,
    );

  const stockCodes =
    [
      ...new Set(
        dailyTop1.map(
          (row) =>
            row.stockCode,
        ),
      ),
    ];

  const firstDecisionAt =
    dailyTop1
      .map(
        (row) =>
          new Date(
            row.decisionAt,
          ).getTime(),
      )
      .reduce(
        (
          a,
          b,
        ) =>
          Math.min(
            a,
            b,
          ),
      );

  const lastDecisionAt =
    dailyTop1
      .map(
        (row) =>
          new Date(
            row.decisionAt,
          ).getTime(),
      )
      .reduce(
        (
          a,
          b,
        ) =>
          Math.max(
            a,
            b,
          ),
      );

  const snapshotStart =
    new Date(
      firstDecisionAt,
    ).toISOString();

  const snapshotEnd =
    new Date(
      lastDecisionAt +
        24 *
          60 *
          60 *
          1000,
    ).toISOString();

  const supabase =
    createSupabaseServerClient();

  const {
    data:
      snapshotData,
    error:
      snapshotError,
  } =
    await supabase
      .from(
        "market_snapshots",
      )
      .select(
        "stock_code,observed_at,open_price,high_price,low_price,close_price,volume",
      )
      .in(
        "stock_code",
        stockCodes,
      )
      .gte(
        "observed_at",
        snapshotStart,
      )
      .lte(
        "observed_at",
        snapshotEnd,
      )
      .order(
        "observed_at",
        {
          ascending: true,
        },
      )
      .limit(
        50000,
      );

  if (
    snapshotError
  ) {
    throw snapshotError;
  }

  const snapshotsByStockDate =
    new Map<
      string,
      SnapshotRecord[]
    >();

  for (
    const row
    of snapshotData ??
      []
  ) {
    const key =
      `${String(row.stock_code)}|${kstDate(String(row.observed_at))}`;

    const arr =
      snapshotsByStockDate.get(
        key,
      ) ?? [];

    arr.push(
      row as SnapshotRecord,
    );

    snapshotsByStockDate.set(
      key,
      arr,
    );
  }

  const minDate =
    dailyTop1
      .map(
        (row) =>
          row.date,
      )
      .sort()[0];

  const maxDate =
    dailyTop1
      .map(
        (row) =>
          row.date,
      )
      .sort()
      .at(-1)!;

  const {
    data:
      dailyBarData,
    error:
      dailyBarError,
  } =
    await supabase
      .from(
        "market_daily_bars",
      )
      .select(
        "stock_code,trading_date,open_price,close_price,adjusted_price",
      )
      .in(
        "stock_code",
        stockCodes,
      )
      .eq(
        "adjusted_price",
        true,
      )
      .gte(
        "trading_date",
        minDate,
      )
      .lte(
        "trading_date",
        "2026-10-31",
      )
      .order(
        "stock_code",
      )
      .order(
        "trading_date",
      )
      .limit(
        10000,
      );

  if (
    dailyBarError
  ) {
    throw dailyBarError;
  }

  const barsByStock =
    new Map<
      string,
      Array<{
        date: string;
        open: number;
        close: number;
      }>
    >();

  for (
    const row
    of dailyBarData ??
      []
  ) {
    const open =
      Number(
        row.open_price,
      );

    const close =
      Number(
        row.close_price,
      );

    if (
      !Number.isFinite(
        open,
      ) ||
      !Number.isFinite(
        close,
      ) ||
      open <= 0 ||
      close <= 0
    ) {
      continue;
    }

    const code =
      String(
        row.stock_code,
      );

    const arr =
      barsByStock.get(
        code,
      ) ?? [];

    arr.push({
      date:
        String(
          row.trading_date,
        ),
      open,
      close,
    });

    barsByStock.set(
      code,
      arr,
    );
  }

  const rows =
    dailyTop1.map(
      (alpha) => {
        const key =
          `${alpha.stockCode}|${alpha.date}`;

        const decisionAtMs =
          new Date(
            alpha.decisionAt,
          ).getTime();

        const sameDaySnapshots =
          (
            snapshotsByStockDate.get(
              key,
            ) ?? []
          )
            .filter(
              (snapshot) =>
                new Date(
                  snapshot.observed_at,
                ).getTime() >=
                decisionAtMs,
            )
            .sort(
              (
                a,
                b,
              ) =>
                new Date(
                  a.observed_at,
                ).getTime() -
                new Date(
                  b.observed_at,
                ).getTime(),
            );

        const prediction =
          makePrediction(
            alpha,
          );

        let firstQualified:
          ReturnType<
            typeof calculateEntrySignal
          > =
            null;

        let lastSignal:
          ReturnType<
            typeof calculateEntrySignal
          > =
            null;

        for (
          let i = 0;
          i <
          sameDaySnapshots.length;
          i += 1
        ) {
          const prefix =
            sameDaySnapshots.slice(
              0,
              i + 1,
            );

          const signal =
            calculateEntrySignal(
              prefix,
              prediction,
              entryScoreThreshold,
            );

          if (
            signal
          ) {
            lastSignal =
              signal;
          }

          if (
            signal?.qualifies
          ) {
            firstQualified =
              signal;
            break;
          }
        }

        const bars =
          barsByStock.get(
            alpha.stockCode,
          ) ?? [];

        const entryDate =
          firstQualified
            ? kstDate(
                firstQualified.observedAt,
              )
            : alpha.date;

        const forwardBars =
          bars.filter(
            (bar) =>
              bar.date >=
              entryDate,
          );

        const b1 =
          forwardBars[0];

        const b3 =
          forwardBars[2];

        const b5 =
          forwardBars[4];

        const actualEntryPrice =
          firstQualified?.entryPrice ??
          null;

        const actualReturns =
          actualEntryPrice &&
          actualEntryPrice >
            0
            ? {
                r1:
                  b1
                    ? b1.close /
                        actualEntryPrice -
                      1
                    : null,

                r3:
                  b3
                    ? b3.close /
                        actualEntryPrice -
                      1
                    : null,

                r5:
                  b5
                    ? b5.close /
                        actualEntryPrice -
                      1
                    : null,
              }
            : {
                r1:
                  null,
                r3:
                  null,
                r5:
                  null,
              };

        const baselineOpen =
          b1?.open ??
          null;

        const baselineReturns =
          baselineOpen &&
          baselineOpen >
            0
            ? {
                r1:
                  b1
                    ? b1.close /
                        baselineOpen -
                      1
                    : null,

                r3:
                  b3
                    ? b3.close /
                        baselineOpen -
                      1
                    : null,

                r5:
                  b5
                    ? b5.close /
                        baselineOpen -
                      1
                    : null,
              }
            : {
                r1:
                  null,
                r3:
                  null,
                r5:
                  null,
              };

        return {
          date:
            alpha.date,

          stockCode:
            alpha.stockCode,

          alphaV2Score:
            alpha.v2Score,

          decisionAt:
            alpha.decisionAt,

          snapshotCount:
            sameDaySnapshots.length,

          entryQualified:
            Boolean(
              firstQualified,
            ),

          firstQualified:
            firstQualified
              ? {
                  observedAt:
                    firstQualified.observedAt,

                  entryScore:
                    firstQualified.score,

                  entryPrice:
                    firstQualified.entryPrice,

                  stopPrice:
                    firstQualified.stopPrice,

                  features:
                    firstQualified.features,
                }
              : null,

          lastObservedSignal:
            lastSignal
              ? {
                  observedAt:
                    lastSignal.observedAt,

                  score:
                    lastSignal.score,

                  qualifies:
                    lastSignal.qualifies,
                }
              : null,

          actualReturns,

          baselineOpenReturns:
            baselineReturns,
        };
      },
    );

  const snapshotAvailableRows =
    rows.filter(
      (row) =>
        row.snapshotCount >
        0,
    );

  const qualifiedRows =
    rows.filter(
      (row) =>
        row.entryQualified,
    );

  const summarizeReturn =
    (
      source:
        "actualReturns"
        | "baselineOpenReturns",
      horizon:
        "r1"
        | "r3"
        | "r5",
      inputRows:
        typeof rows,
    ) =>
      avg(
        inputRows
          .map(
            (row) =>
              row[source][
                horizon
              ],
          )
          .filter(
            Number.isFinite,
          ) as number[],
      );

  const report = {
    status:
      "ALPHA_V2_TOP1_ENTRY_TIMING_HISTORICAL_REPLAY_COMPLETE",

    entryScoreThreshold,

    counts: {
      alphaTop1Dates:
        rows.length,

      snapshotAvailableDates:
        snapshotAvailableRows.length,

      noSnapshotDates:
        rows.length -
        snapshotAvailableRows.length,

      entryQualifiedDates:
        qualifiedRows.length,

      entryRejectedDates:
        snapshotAvailableRows.length -
        qualifiedRows.length,
    },

    qualificationRateOnSnapshotDates:
      snapshotAvailableRows.length
        ? qualifiedRows.length /
          snapshotAvailableRows.length
        : null,

    qualifiedActualEntryReturn: {
      r1:
        summarizeReturn(
          "actualReturns",
          "r1",
          qualifiedRows,
        ),

      r3:
        summarizeReturn(
          "actualReturns",
          "r3",
          qualifiedRows,
        ),

      r5:
        summarizeReturn(
          "actualReturns",
          "r5",
          qualifiedRows,
        ),
    },

    sameQualifiedDatesOpenBaseline: {
      r1:
        summarizeReturn(
          "baselineOpenReturns",
          "r1",
          qualifiedRows,
        ),

      r3:
        summarizeReturn(
          "baselineOpenReturns",
          "r3",
          qualifiedRows,
        ),

      r5:
        summarizeReturn(
          "baselineOpenReturns",
          "r5",
          qualifiedRows,
        ),
    },

    snapshotAvailableAllTop1OpenBaseline: {
      r1:
        summarizeReturn(
          "baselineOpenReturns",
          "r1",
          snapshotAvailableRows,
        ),

      r3:
        summarizeReturn(
          "baselineOpenReturns",
          "r3",
          snapshotAvailableRows,
        ),

      r5:
        summarizeReturn(
          "baselineOpenReturns",
          "r5",
          snapshotAvailableRows,
        ),
    },

    rows,

    methodology: {
      alphaSelection:
        "Alpha V2 priceVolume daily Top1",

      entrySimulation:
        "same-day real market_snapshots replayed chronologically; first calculateEntrySignal() qualifies=true is the simulated entry",

      threshold:
        "current active Entry Timing threshold, read only",

      returnBasis:
        "actual qualified snapshot close price to 1st/3rd/5th trading-day close",

      productionChanged:
        false,
    },

    safety: {
      databaseReadsOnly:
        true,

      databaseWrites:
        0,

      ordersCreated:
        0,

      positionsChanged:
        0,
    },

    nextGate:
      qualifiedRows.length >
        0
        ? "REVIEW_ENTRY_TIMING_ABSOLUTE_RETURN_IMPROVEMENT"
        : "ENTRY_TIMING_HISTORICAL_SNAPSHOT_COVERAGE_OR_THRESHOLD_BLOCKER",
  };

  const outputFile =
    path.join(
      root,
      "logs",
      "alpha-v2-top1-entry-timing-historical-replay.json",
    );

  fs.writeFileSync(
    outputFile,
    JSON.stringify(
      report,
      null,
      2,
    ) + "\n",
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        status:
          report.status,

        entryScoreThreshold:
          report.entryScoreThreshold,

        counts:
          report.counts,

        qualificationRateOnSnapshotDates:
          report.qualificationRateOnSnapshotDates,

        qualifiedActualEntryReturn:
          report.qualifiedActualEntryReturn,

        sameQualifiedDatesOpenBaseline:
          report.sameQualifiedDatesOpenBaseline,

        snapshotAvailableAllTop1OpenBaseline:
          report.snapshotAvailableAllTop1OpenBaseline,

        qualifiedRows:
          report.rows
            .filter(
              (row) =>
                row.entryQualified,
            )
            .map(
              (row) => ({
                date:
                  row.date,

                stockCode:
                  row.stockCode,

                alphaV2Score:
                  row.alphaV2Score,

                firstQualified:
                  row.firstQualified,

                actualReturns:
                  row.actualReturns,

                baselineOpenReturns:
                  row.baselineOpenReturns,
              }),
            ),

        nextGate:
          report.nextGate,

        outputFile:
          "logs/alpha-v2-top1-entry-timing-historical-replay.json",
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
            "ALPHA_V2_TOP1_ENTRY_TIMING_HISTORICAL_REPLAY_FAILED",

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
