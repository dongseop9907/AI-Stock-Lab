import fs from "node:fs";
import path from "node:path";

import {
  createSupabaseServerClient,
} from "../lib/supabase";

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

  const dateRows =
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
                  stockCode:
                    String(
                      row.stockCode,
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

          return {
            date:
              String(
                day.date,
              ),
            decisionAt:
              String(
                day.decisionAt,
              ),
            ranking:
              ranked,
          };
        },
      );

  const dates =
    dateRows.map(
      (row: any) =>
        row.date,
    );

  const stockCodes =
    [
      ...new Set(
        dateRows.flatMap(
          (row: any) =>
            row.ranking.map(
              (item: any) =>
                item.stockCode,
            ),
        ),
      ),
    ];

  const startMs =
    Math.min(
      ...dateRows.map(
        (row: any) =>
          new Date(
            row.decisionAt,
          ).getTime(),
      ),
    );

  const endMs =
    Math.max(
      ...dateRows.map(
        (row: any) =>
          new Date(
            row.decisionAt,
          ).getTime(),
      ),
    ) +
    24 *
      60 *
      60 *
      1000;

  const {
    data,
    error,
  } =
    await createSupabaseServerClient()
      .from(
        "market_snapshots",
      )
      .select(
        "stock_code,observed_at",
      )
      .in(
        "stock_code",
        stockCodes,
      )
      .gte(
        "observed_at",
        new Date(
          startMs,
        ).toISOString(),
      )
      .lte(
        "observed_at",
        new Date(
          endMs,
        ).toISOString(),
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

  const counts =
    new Map<
      string,
      number
    >();

  for (
    const row
    of data ??
      []
  ) {
    const key =
      `${kstDate(
        String(
          row.observed_at,
        ),
      )}|${String(
        row.stock_code,
      )}`;

    counts.set(
      key,
      (
        counts.get(
          key,
        ) ??
        0
      ) + 1,
    );
  }

  const detail =
    dateRows.map(
      (day: any) => {
        const ranking =
          day.ranking.map(
            (
              item: any,
              index: number,
            ) => ({
              rank:
                index + 1,
              stockCode:
                item.stockCode,
              v2Score:
                item.v2Score,
              snapshotCount:
                counts.get(
                  `${day.date}|${item.stockCode}`,
                ) ??
                0,
            }),
          );

        const stocksWithSnapshots =
          ranking.filter(
            (item: any) =>
              item.snapshotCount >
              0,
          );

        return {
          date:
            day.date,
          top1:
            ranking[0] ??
            null,
          top3:
            ranking.slice(
              0,
              3,
            ),
          anySnapshot:
            stocksWithSnapshots.length >
            0,
          stocksWithSnapshots,
          snapshotStockCount:
            stocksWithSnapshots.length,
          totalSnapshots:
            stocksWithSnapshots.reduce(
              (
                sum: number,
                item: any,
              ) =>
                sum +
                item.snapshotCount,
              0,
            ),
        };
      },
    );

  const top1Covered =
    detail.filter(
      (row: any) =>
        row.top1
          ?.snapshotCount >
        0,
    );

  const top3Covered =
    detail.filter(
      (row: any) =>
        row.top3.some(
          (item: any) =>
            item.snapshotCount >
            0,
        ),
    );

  const anyCovered =
    detail.filter(
      (row: any) =>
        row.anySnapshot,
    );

  const byStock =
    Object.fromEntries(
      stockCodes.map(
        (stockCode) => {
          const perDate =
            dates.map(
              (date) =>
                counts.get(
                  `${date}|${stockCode}`,
                ) ??
                0,
            );

          return [
            stockCode,
            {
              coveredDates:
                perDate.filter(
                  (count) =>
                    count >
                    0,
                ).length,
              totalSnapshots:
                perDate.reduce(
                  (
                    sum,
                    count,
                  ) =>
                    sum +
                    count,
                  0,
                ),
            },
          ];
        },
      ),
    );

  const result = {
    status:
      "ALPHA_V2_HISTORICAL_SNAPSHOT_COVERAGE_DIAG_COMPLETE",

    predictionDateCount:
      dateRows.length,

    stockCount:
      stockCodes.length,

    coverage: {
      top1CoveredDates:
        top1Covered.length,

      top3AnyCoveredDates:
        top3Covered.length,

      anyRankedStockCoveredDates:
        anyCovered.length,

      noSnapshotDates:
        detail.length -
        anyCovered.length,
    },

    byStock,

    coveredDates:
      anyCovered,

    noSnapshotDates:
      detail
        .filter(
          (row: any) =>
            !row.anySnapshot,
        )
        .map(
          (row: any) =>
            row.date,
        ),

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
      anyCovered.length <
        10
        ? "HISTORICAL_INTRADAY_DATA_BACKFILL_REQUIRED"
        : "ENTRY_REPLAY_CAN_PROCEED_ON_EXISTING_COVERAGE",
  };

  fs.writeFileSync(
    path.join(
      root,
      "logs",
      "alpha-v2-historical-snapshot-coverage-diag.json",
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

        predictionDateCount:
          result.predictionDateCount,

        stockCount:
          result.stockCount,

        coverage:
          result.coverage,

        byStock:
          result.byStock,

        coveredDates:
          result.coveredDates.map(
            (row: any) => ({
              date:
                row.date,
              top1:
                row.top1,
              stocksWithSnapshots:
                row.stocksWithSnapshots,
              totalSnapshots:
                row.totalSnapshots,
            }),
          ),

        nextGate:
          result.nextGate,

        outputFile:
          "logs/alpha-v2-historical-snapshot-coverage-diag.json",
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
            "ALPHA_V2_HISTORICAL_SNAPSHOT_COVERAGE_DIAG_FAILED",

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
