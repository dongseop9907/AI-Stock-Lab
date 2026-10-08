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

function avg(values: number[]): number | null {
  return values.length
    ? values.reduce((a, b) => a + b, 0) / values.length
    : null;
}

function clamp(value: number) {
  return Math.min(1, Math.max(0, value));
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
  return Number.isFinite(n) ? n : null;
}

function normalizeThreshold(value: unknown): number {
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
    const row = value as Record<string, unknown>;

    for (const key of [
      "threshold",
      "scoreThreshold",
      "entryScoreThreshold",
      "value",
    ]) {
      const n = Number(row[key]);

      if (Number.isFinite(n)) {
        return n;
      }
    }
  }

  throw new Error(
    `UNSUPPORTED_ENTRY_THRESHOLD_SHAPE:${JSON.stringify(value)}`,
  );
}

function makePrediction(
  row: any,
): PredictionCandidate {
  return {
    predictionId:
      `ALPHA_V2_EXPANDED_${row.alphaDate}_${row.stockCode}`,

    stockCode:
      row.stockCode,

    predictionDate:
      row.alphaDate,

    generatedAt:
      row.decisionAt,

    modelName:
      "ALPHA_V2_PRICE_VOLUME_TOP1",

    modelVersion:
      "EXPANDED_ENTRY_COMPARISON_V1",

    score:
      row.v2Score,

    confidence:
      1,

    disclosureScore:
      null,

    priceMomentum:
      null,

    intradayReturn:
      null,

    volumeRatio:
      null,

    reasons: [
      "Alpha V2 priceVolume Top1 expanded target-session replay.",
    ],
  };
}

/*
 * Corrected Entry candidate:
 *  - minimum 2 snapshots
 *  - momentum uses previous snapshot close only
 *  - cumulative volume converted to interval deltas
 */
function calculateCorrectedEntrySignal(
  snapshots: SnapshotRecord[],
  entryScoreThreshold: number,
) {
  const sorted = [...snapshots].sort(
    (a, b) =>
      new Date(a.observed_at).getTime() -
      new Date(b.observed_at).getTime(),
  );

  if (sorted.length < 2) {
    return null;
  }

  const latest = sorted.at(-1)!;
  const previous = sorted.at(-2)!;

  const latestClose =
    toNumber(latest.close_price);

  const previousClose =
    toNumber(previous.close_price);

  if (
    latestClose === null ||
    previousClose === null ||
    latestClose <= 0 ||
    previousClose <= 0
  ) {
    return null;
  }

  const latestOpen =
    toNumber(latest.open_price);

  const latestHigh =
    toNumber(latest.high_price);

  const latestLow =
    toNumber(latest.low_price);

  const momentumRate =
    latestClose / previousClose - 1;

  const intradayRate =
    latestOpen !== null &&
    latestOpen > 0
      ? latestClose / latestOpen - 1
      : 0;

  const rangePosition =
    latestHigh !== null &&
    latestLow !== null &&
    latestHigh > latestLow
      ? clamp(
          (latestClose - latestLow) /
            (latestHigh - latestLow),
        )
      : 0.5;

  const cumulativeVolumes =
    sorted.map(
      (row) =>
        toNumber(row.volume),
    );

  const intervalDeltas: number[] = [];

  for (
    let index = 1;
    index < cumulativeVolumes.length;
    index += 1
  ) {
    const current =
      cumulativeVolumes[index];

    const previousVolume =
      cumulativeVolumes[index - 1];

    if (
      current !== null &&
      previousVolume !== null &&
      current >= previousVolume
    ) {
      intervalDeltas.push(
        current - previousVolume,
      );
    }
  }

  const latestDelta =
    intervalDeltas.length
      ? intervalDeltas.at(-1)!
      : null;

  const previousDeltas =
    intervalDeltas.slice(
      Math.max(
        0,
        intervalDeltas.length - 6,
      ),
      -1,
    );

  const previousDeltaAverage =
    avg(previousDeltas);

  const volumeRatio =
    latestDelta !== null &&
    previousDeltaAverage !== null &&
    previousDeltaAverage > 0
      ? latestDelta / previousDeltaAverage
      : 1;

  const momentumScore =
    clamp(
      (momentumRate + 0.01) / 0.03,
    );

  const intradayScore =
    clamp(
      (intradayRate + 0.01) / 0.025,
    );

  const rangeScore =
    clamp(
      rangePosition,
    );

  const volumeScore =
    clamp(
      (volumeRatio - 0.8) / 1.2,
    );

  const score =
    momentumScore * 0.4 +
    intradayScore * 0.25 +
    rangeScore * 0.2 +
    volumeScore * 0.15;

  const qualifies =
    score >= entryScoreThreshold &&
    momentumRate > 0 &&
    intradayRate > -0.005;

  return {
    observedAt:
      latest.observed_at,

    score:
      Math.round(
        score * 1_000_000,
      ) / 1_000_000,

    qualifies,

    entryPrice:
      latestClose,

    features: {
      snapshotCount:
        sorted.length,

      momentumRate,

      intradayRate,

      rangePosition,

      latestVolumeDelta:
        latestDelta,

      previousVolumeDeltaAverage:
        previousDeltaAverage,

      volumeRatio,

      momentumScore,

      intradayScore,

      rangeScore,

      volumeScore,
    },
  };
}

function firstQualifiedCurrent(
  snapshots: SnapshotRecord[],
  prediction: PredictionCandidate,
  threshold: number,
) {
  for (
    let index = 0;
    index < snapshots.length;
    index += 1
  ) {
    const signal =
      calculateEntrySignal(
        snapshots.slice(
          0,
          index + 1,
        ),
        prediction,
        threshold,
      );

    if (signal?.qualifies) {
      return signal;
    }
  }

  return null;
}

function firstQualifiedCorrected(
  snapshots: SnapshotRecord[],
  threshold: number,
) {
  for (
    let index = 0;
    index < snapshots.length;
    index += 1
  ) {
    const signal =
      calculateCorrectedEntrySignal(
        snapshots.slice(
          0,
          index + 1,
        ),
        threshold,
      );

    if (signal?.qualifies) {
      return signal;
    }
  }

  return null;
}

async function main() {
  const root =
    process.cwd();

  const coverage =
    JSON.parse(
      fs.readFileSync(
        path.join(
          root,
          "logs",
          "alpha-v2-entry-target-session-coverage.json",
        ),
        "utf8",
      ),
    );

  if (
    coverage.version !==
    "V2_EXACT_COUNT_PER_TARGET_SESSION"
  ) {
    throw new Error(
      "RUN_ROW_CAP_FIXED_COVERAGE_FIRST",
    );
  }

  const replayableRows =
    (
      coverage.replayableRows ??
      []
    ).filter(
      (row: any) =>
        row.replayable &&
        row.targetSessionDate &&
        row.stockCode,
    );

  /*
   * Multiple Alpha decisions can map to the same target session + stock.
   * Keep the latest decision known before that session.
   */
  const dedup =
    new Map<string, any>();

  for (const row of replayableRows) {
    const key =
      `${row.targetSessionDate}|${row.stockCode}`;

    const current =
      dedup.get(key);

    if (
      !current ||
      new Date(row.decisionAt).getTime() >
        new Date(current.decisionAt).getTime()
    ) {
      dedup.set(
        key,
        row,
      );
    }
  }

  const sessions =
    [...dedup.values()]
      .sort(
        (a, b) =>
          `${a.targetSessionDate}|${a.stockCode}`
            .localeCompare(
              `${b.targetSessionDate}|${b.stockCode}`,
            ),
      );

  const threshold =
    normalizeThreshold(
      await getActiveEntryThreshold(),
    );

  const stockCodes =
    [
      ...new Set(
        sessions.map(
          (row: any) =>
            row.stockCode,
        ),
      ),
    ];

  const firstSessionDate =
    sessions[0]
      .targetSessionDate;

  const supabase =
    createSupabaseServerClient();

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
        firstSessionDate,
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
    new Map<string, any[]>();

  for (const row of dailyBarData ?? []) {
    const open =
      Number(
        row.open_price,
      );

    const close =
      Number(
        row.close_price,
      );

    if (
      !Number.isFinite(open) ||
      !Number.isFinite(close) ||
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
      barsByStock.get(code) ??
      [];

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

  const results = [];

  /*
   * IMPORTANT:
   * Query each target session separately.
   * Each full backfilled session is 381 rows, so this avoids
   * any Supabase/PostgREST global row cap.
   */
  for (const session of sessions) {
    const start =
      `${session.targetSessionDate}T00:00:00+09:00`;

    const end =
      `${session.targetSessionDate}T23:59:59+09:00`;

    const snapshotResult =
      await supabase
        .from(
          "market_snapshots",
        )
        .select(
          "stock_code,observed_at,open_price,high_price,low_price,close_price,volume,raw_payload",
        )
        .eq(
          "stock_code",
          session.stockCode,
        )
        .gte(
          "observed_at",
          start,
        )
        .lte(
          "observed_at",
          end,
        )
        .order(
          "observed_at",
          {
            ascending:
              true,
          },
        )
        .limit(
          1000,
        );

    if (
      snapshotResult.error
    ) {
      throw snapshotResult.error;
    }

    const snapshots =
      (
        snapshotResult.data ??
        []
      ) as SnapshotRecord[];

    const prediction =
      makePrediction(
        session,
      );

    const currentEntry =
      firstQualifiedCurrent(
        snapshots,
        prediction,
        threshold,
      );

    const correctedEntry =
      firstQualifiedCorrected(
        snapshots,
        threshold,
      );

    const forwardBars =
      (
        barsByStock.get(
          session.stockCode,
        ) ??
        []
      ).filter(
        (bar) =>
          bar.date >=
          session.targetSessionDate,
      );

    const b1 =
      forwardBars[0];

    const b3 =
      forwardBars[2];

    const b5 =
      forwardBars[4];

    const baselineOpen =
      b1?.open ??
      null;

    const returnFromPrice = (
      price: number | null,
      bar: any,
    ) =>
      price !== null &&
      price > 0 &&
      bar
        ? bar.close / price - 1
        : null;

    results.push({
      alphaDate:
        session.alphaDate,

      stockCode:
        session.stockCode,

      targetSessionDate:
        session.targetSessionDate,

      alphaV2Score:
        session.v2Score,

      snapshotCount:
        snapshots.length,

      sourceBreakdown: {
        reconstructedRows:
          (
            snapshotResult.data ??
            []
          ).filter(
            (row: any) =>
              row.raw_payload
                ?.source ===
              "KIS_HISTORICAL_INTRADAY_RECONSTRUCTED",
          ).length,

        liveRows:
          (
            snapshotResult.data ??
            []
          ).filter(
            (row: any) =>
              row.raw_payload
                ?.source !==
              "KIS_HISTORICAL_INTRADAY_RECONSTRUCTED",
          ).length,
      },

      currentEntry: currentEntry
        ? {
            qualified:
              true,

            observedAt:
              currentEntry.observedAt,

            score:
              currentEntry.score,

            entryPrice:
              currentEntry.entryPrice,

            returns: {
              r1:
                returnFromPrice(
                  currentEntry.entryPrice,
                  b1,
                ),

              r3:
                returnFromPrice(
                  currentEntry.entryPrice,
                  b3,
                ),

              r5:
                returnFromPrice(
                  currentEntry.entryPrice,
                  b5,
                ),
            },
          }
        : {
            qualified:
              false,

            observedAt:
              null,

            score:
              null,

            entryPrice:
              null,

            returns: {
              r1:
                null,
              r3:
                null,
              r5:
                null,
            },
          },

      correctedEntry:
        correctedEntry
          ? {
              qualified:
                true,

              observedAt:
                correctedEntry.observedAt,

              score:
                correctedEntry.score,

              entryPrice:
                correctedEntry.entryPrice,

              features:
                correctedEntry.features,

              returns: {
                r1:
                  returnFromPrice(
                    correctedEntry.entryPrice,
                    b1,
                  ),

                r3:
                  returnFromPrice(
                    correctedEntry.entryPrice,
                    b3,
                  ),

                r5:
                  returnFromPrice(
                    correctedEntry.entryPrice,
                    b5,
                  ),
              },
            }
          : {
              qualified:
                false,

              observedAt:
                null,

              score:
                null,

              entryPrice:
                null,

              features:
                null,

              returns: {
                r1:
                  null,
                r3:
                  null,
                r5:
                  null,
              },
            },

      sessionOpenBaseline: {
        r1:
          returnFromPrice(
            baselineOpen,
            b1,
          ),

        r3:
          returnFromPrice(
            baselineOpen,
            b3,
          ),

        r5:
          returnFromPrice(
            baselineOpen,
            b5,
          ),
      },
    });
  }

  const currentQualified =
    results.filter(
      (row: any) =>
        row.currentEntry
          .qualified,
    );

  const correctedQualified =
    results.filter(
      (row: any) =>
        row.correctedEntry
          .qualified,
    );

  function summarize(
    selected: any[],
    entryKey:
      | "currentEntry"
      | "correctedEntry",
  ) {
    const ret = (
      horizon:
        | "r1"
        | "r3"
        | "r5",
    ) =>
      avg(
        selected
          .map(
            (row) =>
              row[entryKey]
                .returns[
                horizon
              ],
          )
          .filter(
            Number.isFinite,
          ),
      );

    const baseline = (
      horizon:
        | "r1"
        | "r3"
        | "r5",
    ) =>
      avg(
        selected
          .map(
            (row) =>
              row
                .sessionOpenBaseline[
                horizon
              ],
          )
          .filter(
            Number.isFinite,
          ),
      );

    return {
      qualifiedSessions:
        selected.length,

      qualificationRate:
        results.length
          ? selected.length /
            results.length
          : null,

      actualEntryReturn: {
        r1:
          ret("r1"),
        r3:
          ret("r3"),
        r5:
          ret("r5"),
      },

      sameSessionsOpenBaseline: {
        r1:
          baseline("r1"),
        r3:
          baseline("r3"),
        r5:
          baseline("r5"),
      },

      entryMinusOpenBaseline: {
        r1:
          (
            ret("r1") !== null &&
            baseline("r1") !== null
          )
            ? ret("r1")! -
              baseline("r1")!
            : null,

        r3:
          (
            ret("r3") !== null &&
            baseline("r3") !== null
          )
            ? ret("r3")! -
              baseline("r3")!
            : null,

        r5:
          (
            ret("r5") !== null &&
            baseline("r5") !== null
          )
            ? ret("r5")! -
              baseline("r5")!
            : null,
      },
    };
  }

  const report = {
    status:
      "ALPHA_V2_EXPANDED_ENTRY_COMPARISON_COMPLETE",

    entryScoreThreshold:
      threshold,

    counts: {
      alphaTop1Rows:
        replayableRows.length,

      uniqueTargetSessions:
        sessions.length,

      full381SnapshotSessions:
        results.filter(
          (row: any) =>
            row.snapshotCount ===
            381,
        ).length,

      sparseSnapshotSessions:
        results.filter(
          (row: any) =>
            row.snapshotCount <
            381,
        ).length,

      currentQualifiedSessions:
        currentQualified.length,

      correctedQualifiedSessions:
        correctedQualified.length,
    },

    currentEntry:
      summarize(
        currentQualified,
        "currentEntry",
      ),

    correctedEntry:
      summarize(
        correctedQualified,
        "correctedEntry",
      ),

    allSessionsOpenBaseline: {
      r1:
        avg(
          results
            .map(
              (row: any) =>
                row
                  .sessionOpenBaseline
                  .r1,
            )
            .filter(
              Number.isFinite,
            ),
        ),

      r3:
        avg(
          results
            .map(
              (row: any) =>
                row
                  .sessionOpenBaseline
                  .r3,
            )
            .filter(
              Number.isFinite,
            ),
        ),

      r5:
        avg(
          results
            .map(
              (row: any) =>
                row
                  .sessionOpenBaseline
                  .r5,
            )
            .filter(
              Number.isFinite,
            ),
        ),
    },

    results,

    methodology: {
      deduplication:
        "same target session + stock keeps latest Alpha decision",

      snapshotFetch:
        "one DB query per target session to avoid global row cap",

      currentEntry:
        "existing production calculateEntrySignal()",

      correctedEntry:
        "minimum 2 snapshots + previous-snapshot momentum + cumulative-volume delta",

      thresholdChanged:
        false,

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
      "DECIDE_ENTRY_V2_DIRECTION_FROM_18_SESSION_COMPARISON",
  };

  fs.writeFileSync(
    path.join(
      root,
      "logs",
      "alpha-v2-expanded-entry-comparison.json",
    ),
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

        currentEntry:
          report.currentEntry,

        correctedEntry:
          report.correctedEntry,

        allSessionsOpenBaseline:
          report.allSessionsOpenBaseline,

        nextGate:
          report.nextGate,

        outputFile:
          "logs/alpha-v2-expanded-entry-comparison.json",
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
            "ALPHA_V2_EXPANDED_ENTRY_COMPARISON_FAILED",

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
