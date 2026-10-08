import fs from "node:fs";
import path from "node:path";

import {
  createSupabaseServerClient,
} from "../lib/supabase";

function avg(values: number[]): number | null {
  return values.length
    ? values.reduce((a, b) => a + b, 0) / values.length
    : null;
}

function kstDate(iso: string): string {
  const d =
    new Date(
      new Date(iso).getTime() +
      9 * 60 * 60 * 1000,
    );

  return d.toISOString().slice(0, 10);
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
          "alpha-v2-target-session-entry-replay.json",
        ),
        "utf8",
      ),
    );

  const sessions =
    (replay.results ?? [])
      .map(
        (row: any) => ({
          stockCode:
            String(
              row.stockCode,
            ),
          targetSessionDate:
            String(
              row.targetSessionDate,
            ),
          entryQualified:
            Boolean(
              row.entryQualified,
            ),
          firstQualifiedObservedAt:
            row.firstQualified
              ?.observedAt ??
              null,
        }),
      );

  if (!sessions.length) {
    throw new Error(
      "NO_TARGET_SESSION_REPLAY_RESULTS",
    );
  }

  const stockCodes =
    [
      ...new Set(
        sessions.map(
          (row: any) =>
            row.stockCode,
        ),
      ),
    ];

  const sessionDates =
    sessions
      .map(
        (row: any) =>
          row.targetSessionDate,
      )
      .sort();

  const firstDate =
    sessionDates[0];

  const lastDate =
    sessionDates.at(-1)!;

  const {
    data,
    error,
  } =
    await createSupabaseServerClient()
      .from(
        "market_snapshots",
      )
      .select(
        "stock_code,observed_at,open_price,close_price,volume",
      )
      .in(
        "stock_code",
        stockCodes,
      )
      .gte(
        "observed_at",
        `${firstDate}T00:00:00+09:00`,
      )
      .lte(
        "observed_at",
        `${lastDate}T23:59:59+09:00`,
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

  if (error) {
    throw error;
  }

  const bySession =
    new Map<
      string,
      any[]
    >();

  for (const row of data ?? []) {
    const key =
      `${String(row.stock_code)}|${kstDate(String(row.observed_at))}`;

    const arr =
      bySession.get(key) ??
      [];

    arr.push({
      observedAt:
        String(
          row.observed_at,
        ),
      openPrice:
        Number(
          row.open_price,
        ),
      closePrice:
        Number(
          row.close_price,
        ),
      volume:
        Number(
          row.volume,
        ),
    });

    bySession.set(
      key,
      arr,
    );
  }

  const details =
    sessions.map(
      (session: any) => {
        const key =
          `${session.stockCode}|${session.targetSessionDate}`;

        const snapshots =
          (
            bySession.get(key) ??
            []
          )
            .filter(
              (row: any) =>
                Number.isFinite(
                  row.volume,
                ),
            )
            .sort(
              (a: any, b: any) =>
                new Date(
                  a.observedAt,
                ).getTime() -
                new Date(
                  b.observedAt,
                ).getTime(),
            );

        let nonDecreasingPairs =
          0;

        let decreasingPairs =
          0;

        const deltas: number[] =
          [];

        for (
          let i = 1;
          i <
          snapshots.length;
          i += 1
        ) {
          const delta =
            snapshots[i].volume -
            snapshots[
              i - 1
            ].volume;

          deltas.push(
            delta,
          );

          if (
            delta >= 0
          ) {
            nonDecreasingPairs +=
              1;
          } else {
            decreasingPairs +=
              1;
          }
        }

        const first =
          snapshots[0] ??
          null;

        const last =
          snapshots.at(-1) ??
          null;

        const qualifiedIndex =
          session.firstQualifiedObservedAt
            ? snapshots.findIndex(
                (row: any) =>
                  row.observedAt ===
                  session.firstQualifiedObservedAt,
              )
            : -1;

        const firstQualified =
          qualifiedIndex >=
          0
            ? snapshots[
                qualifiedIndex
              ]
            : null;

        let naiveVolumeRatioAtQualification:
          number |
          null =
            null;

        if (
          qualifiedIndex >=
          0
        ) {
          const previous =
            snapshots
              .slice(
                Math.max(
                  0,
                  qualifiedIndex -
                    5,
                ),
                qualifiedIndex,
              )
              .map(
                (row: any) =>
                  row.volume,
              )
              .filter(
                (value: number) =>
                  Number.isFinite(
                    value,
                  ) &&
                  value >
                    0,
              );

          const previousAvg =
            avg(
              previous,
            );

          if (
            previousAvg &&
            previousAvg >
            0
          ) {
            naiveVolumeRatioAtQualification =
              firstQualified.volume /
              previousAvg;
          }
        }

        return {
          stockCode:
            session.stockCode,

          targetSessionDate:
            session.targetSessionDate,

          snapshotCount:
            snapshots.length,

          entryQualified:
            session.entryQualified,

          firstQualifiedObservedAt:
            session.firstQualifiedObservedAt,

          firstVolume:
            first?.volume ??
            null,

          lastVolume:
            last?.volume ??
            null,

          volumeChange:
            first &&
            last
              ? last.volume -
                first.volume
              : null,

          volumeMultiple:
            first &&
            last &&
            first.volume >
              0
              ? last.volume /
                first.volume
              : null,

          pairCount:
            Math.max(
              snapshots.length -
                1,
              0,
            ),

          nonDecreasingPairs,

          decreasingPairs,

          monotonicNonDecreasingRate:
            snapshots.length >
            1
              ? nonDecreasingPairs /
                (
                  snapshots.length -
                  1
                )
              : null,

          positiveDeltaRate:
            deltas.length
              ? deltas.filter(
                  (x) =>
                    x >
                    0,
                ).length /
                deltas.length
              : null,

          averageVolumeDelta:
            avg(
              deltas,
            ),

          firstQualifiedVolume:
            firstQualified
              ?.volume ??
              null,

          naiveVolumeRatioAtQualification,

          note:
            snapshots.length <=
            1
              ? "INSUFFICIENT_FOR_VOLUME_SEMANTICS"
              : decreasingPairs ===
                  0
                ? "VOLUME_LOOKS_CUMULATIVE"
                : "VOLUME_NOT_STRICTLY_CUMULATIVE_OR_HAS_RESETS",
        };
      },
    );

  const informative =
    details.filter(
      (row: any) =>
        row.snapshotCount >
        1,
    );

  const cumulativeLike =
    informative.filter(
      (row: any) =>
        row.decreasingPairs ===
        0,
    );

  const result = {
    status:
      "ALPHA_V2_ENTRY_VOLUME_SEMANTICS_DIAG_COMPLETE",

    counts: {
      targetSessions:
        details.length,

      informativeSessions:
        informative.length,

      cumulativeLikeSessions:
        cumulativeLike.length,

      sessionsWithDecrease:
        informative.length -
        cumulativeLike.length,
    },

    cumulativeLikeRate:
      informative.length
        ? cumulativeLike.length /
          informative.length
        : null,

    details,

    interpretation: {
      ifCumulativeLike:
        "Current Entry volumeRatio compares cumulative intraday volume levels across snapshots. That ratio naturally rises with time and is not a clean volume-acceleration feature.",

      momentumSingleSnapshot:
        "Separately, calculateEntrySignal() falls back to open_price when no previous snapshot exists, so one-snapshot momentum duplicates intraday movement.",

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
      informative.length >
        0 &&
      cumulativeLike.length ===
        informative.length
        ? "REDESIGN_ENTRY_VOLUME_AND_SINGLE_SNAPSHOT_MOMENTUM"
        : "REVIEW_ENTRY_VOLUME_SOURCE_SEMANTICS",
  };

  fs.writeFileSync(
    path.join(
      root,
      "logs",
      "alpha-v2-entry-volume-semantics-diag.json",
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

        counts:
          result.counts,

        cumulativeLikeRate:
          result.cumulativeLikeRate,

        details:
          result.details,

        nextGate:
          result.nextGate,

        outputFile:
          "logs/alpha-v2-entry-volume-semantics-diag.json",
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
            "ALPHA_V2_ENTRY_VOLUME_SEMANTICS_DIAG_FAILED",

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
