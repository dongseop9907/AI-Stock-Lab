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

function makePrediction(
  row: any,
): PredictionCandidate {
  return {
    predictionId:
      `ALPHA_V2_TARGET_${row.alphaDate}_${row.stockCode}`,

    stockCode:
      row.stockCode,

    predictionDate:
      row.alphaDate,

    generatedAt:
      row.decisionAt,

    modelName:
      "ALPHA_V2_PRICE_VOLUME_TOP1",

    modelVersion:
      "TARGET_SESSION_REPLAY_V1",

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
      "Alpha V2 priceVolume Top1 target-session replay.",
    ],
  };
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

  const replayableRows =
    (coverage.replayableRows ?? [])
      .filter(
        (row: any) =>
          row.replayable &&
          row.targetSessionDate &&
          row.stockCode,
      );

  if (
    !replayableRows.length
  ) {
    throw new Error(
      "NO_REPLAYABLE_TARGET_SESSIONS",
    );
  }

  /*
   * Multiple Alpha decisions can map to the same future session.
   * Keep only the latest decision available before that session.
   */
  const dedupMap =
    new Map<
      string,
      any
    >();

  for (
    const row
    of replayableRows
  ) {
    const key =
      `${row.targetSessionDate}|${row.stockCode}`;

    const current =
      dedupMap.get(
        key,
      );

    if (
      !current ||
      new Date(
        row.decisionAt,
      ).getTime() >
        new Date(
          current.decisionAt,
        ).getTime()
    ) {
      dedupMap.set(
        key,
        row,
      );
    }
  }

  const sessions =
    [...dedupMap.values()]
      .sort(
        (a, b) =>
          String(
            a.targetSessionDate,
          ).localeCompare(
            String(
              b.targetSessionDate,
            ),
          ),
      );

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
        sessions.map(
          (row: any) =>
            row.stockCode,
        ),
      ),
    ];

  const firstSessionDate =
    sessions[0]
      .targetSessionDate;

  const lastSessionDate =
    sessions
      .at(-1)
      .targetSessionDate;

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
        `${firstSessionDate}T00:00:00+09:00`,
      )
      .lte(
        "observed_at",
        `${lastSessionDate}T23:59:59+09:00`,
      )
      .order(
        "observed_at",
        {
          ascending: true,
        },
      )
      .limit(
        100000,
      );

  if (
    snapshotError
  ) {
    throw snapshotError;
  }

  const snapshotsBySession =
    new Map<
      string,
      SnapshotRecord[]
    >();

  for (
    const row
    of snapshotData ??
      []
  ) {
    const sessionDate =
      kstDate(
        String(
          row.observed_at,
        ),
      );

    const key =
      `${sessionDate}|${String(row.stock_code)}`;

    const arr =
      snapshotsBySession.get(
        key,
      ) ?? [];

    arr.push(
      row as SnapshotRecord,
    );

    snapshotsBySession.set(
      key,
      arr,
    );
  }

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

  const results =
    sessions.map(
      (session: any) => {
        const key =
          `${session.targetSessionDate}|${session.stockCode}`;

        const snapshots =
          (
            snapshotsBySession.get(
              key,
            ) ?? []
          )
            .sort(
              (a, b) =>
                new Date(
                  a.observed_at,
                ).getTime() -
                new Date(
                  b.observed_at,
                ).getTime(),
            );

        const prediction =
          makePrediction(
            session,
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
          let index = 0;
          index <
          snapshots.length;
          index += 1
        ) {
          const prefix =
            snapshots.slice(
              0,
              index + 1,
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
          (
            barsByStock.get(
              session.stockCode,
            ) ?? []
          )
            .filter(
              (bar) =>
                bar.date >=
                session.targetSessionDate,
            );

        const b1 =
          bars[0];

        const b3 =
          bars[2];

        const b5 =
          bars[4];

        const entryPrice =
          firstQualified
            ?.entryPrice ??
          null;

        const openPrice =
          b1?.open ??
          null;

        const actualReturn = (
          bar:
            | typeof b1
            | typeof b3
            | typeof b5,
        ) =>
          entryPrice &&
          entryPrice > 0 &&
          bar
            ? bar.close /
                entryPrice -
              1
            : null;

        const openReturn = (
          bar:
            | typeof b1
            | typeof b3
            | typeof b5,
        ) =>
          openPrice &&
          openPrice > 0 &&
          bar
            ? bar.close /
                openPrice -
              1
            : null;

        return {
          alphaDate:
            session.alphaDate,

          stockCode:
            session.stockCode,

          targetSessionDate:
            session.targetSessionDate,

          alphaV2Score:
            session.v2Score,

          decisionAt:
            session.decisionAt,

          snapshotCount:
            snapshots.length,

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

          lastSignal:
            lastSignal
              ? {
                  observedAt:
                    lastSignal.observedAt,

                  entryScore:
                    lastSignal.score,

                  qualifies:
                    lastSignal.qualifies,

                  features:
                    lastSignal.features,
                }
              : null,

          actualEntryReturn: {
            r1:
              actualReturn(
                b1,
              ),
            r3:
              actualReturn(
                b3,
              ),
            r5:
              actualReturn(
                b5,
              ),
          },

          sessionOpenBaseline: {
            r1:
              openReturn(
                b1,
              ),
            r3:
              openReturn(
                b3,
              ),
            r5:
              openReturn(
                b5,
              ),
          },
        };
      },
    );

  const qualified =
    results.filter(
      (row) =>
        row.entryQualified,
    );

  const rejected =
    results.filter(
      (row) =>
        !row.entryQualified,
    );

  const summarize = (
    input:
      typeof results,
    source:
      | "actualEntryReturn"
      | "sessionOpenBaseline",
    horizon:
      | "r1"
      | "r3"
      | "r5",
  ) =>
    avg(
      input
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

  const result = {
    status:
      "ALPHA_V2_TARGET_SESSION_ENTRY_REPLAY_COMPLETE",

    entryScoreThreshold,

    counts: {
      rawReplayableSignals:
        replayableRows.length,

      uniqueTargetSessions:
        sessions.length,

      entryQualifiedSessions:
        qualified.length,

      entryRejectedSessions:
        rejected.length,
    },

    qualificationRate:
      sessions.length
        ? qualified.length /
          sessions.length
        : null,

    qualifiedActualEntryReturn: {
      r1:
        summarize(
          qualified,
          "actualEntryReturn",
          "r1",
        ),

      r3:
        summarize(
          qualified,
          "actualEntryReturn",
          "r3",
        ),

      r5:
        summarize(
          qualified,
          "actualEntryReturn",
          "r5",
        ),
    },

    sameQualifiedSessionsOpenBaseline: {
      r1:
        summarize(
          qualified,
          "sessionOpenBaseline",
          "r1",
        ),

      r3:
        summarize(
          qualified,
          "sessionOpenBaseline",
          "r3",
        ),

      r5:
        summarize(
          qualified,
          "sessionOpenBaseline",
          "r5",
        ),
    },

    allTargetSessionsOpenBaseline: {
      r1:
        summarize(
          results,
          "sessionOpenBaseline",
          "r1",
        ),

      r3:
        summarize(
          results,
          "sessionOpenBaseline",
          "r3",
        ),

      r5:
        summarize(
          results,
          "sessionOpenBaseline",
          "r5",
        ),
    },

    results,

    methodology: {
      deduplication:
        "same target session + stock keeps latest Alpha decision",

      entry:
        "replay real snapshots chronologically and enter on first calculateEntrySignal() qualifies=true",

      arbitraryFutureSnapshotJump:
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
      qualified.length >=
        2
        ? "REVIEW_ALPHA_V2_ENTRY_TIMING_EFFECT"
        : "ENTRY_TIMING_THRESHOLD_OR_INTRADAY_FEATURE_BLOCKER",
  };

  fs.writeFileSync(
    path.join(
      root,
      "logs",
      "alpha-v2-target-session-entry-replay.json",
    ),
    JSON.stringify(
      result,
      null,
      2,
    ) + "\n",
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        status:
          result.status,

        entryScoreThreshold:
          result.entryScoreThreshold,

        counts:
          result.counts,

        qualificationRate:
          result.qualificationRate,

        qualifiedActualEntryReturn:
          result.qualifiedActualEntryReturn,

        sameQualifiedSessionsOpenBaseline:
          result.sameQualifiedSessionsOpenBaseline,

        allTargetSessionsOpenBaseline:
          result.allTargetSessionsOpenBaseline,

        results:
          result.results,

        nextGate:
          result.nextGate,

        outputFile:
          "logs/alpha-v2-target-session-entry-replay.json",
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
            "ALPHA_V2_TARGET_SESSION_ENTRY_REPLAY_FAILED",

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
