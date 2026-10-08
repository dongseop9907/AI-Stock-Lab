import fs from "node:fs";
import path from "node:path";

import {
  createSupabaseServerClient,
} from "../lib/supabase";

type RawRankRow = {
  date: string;
  stockCode: string;
  score: number;
  dimensions?: Array<{
    dimension?: string;
    rawScore?: number | null;
    effectiveScore?: number | null;
    contribution?: number | null;
  }>;
};

function pearson(
  pairs: Array<[number, number]>,
): number | null {
  if (pairs.length < 3) {
    return null;
  }

  const xs =
    pairs.map(
      ([x]) => x,
    );

  const ys =
    pairs.map(
      ([, y]) => y,
    );

  const mx =
    xs.reduce(
      (a, b) => a + b,
      0,
    ) / xs.length;

  const my =
    ys.reduce(
      (a, b) => a + b,
      0,
    ) / ys.length;

  let num = 0;
  let dx = 0;
  let dy = 0;

  for (
    let i = 0;
    i < pairs.length;
    i += 1
  ) {
    const ax =
      xs[i] - mx;

    const ay =
      ys[i] - my;

    num +=
      ax * ay;

    dx +=
      ax * ax;

    dy +=
      ay * ay;
  }

  const den =
    Math.sqrt(
      dx * dy,
    );

  return den > 0
    ? num / den
    : null;
}

function average(
  values: number[],
): number | null {
  return values.length
    ? values.reduce(
        (a, b) => a + b,
        0,
      ) / values.length
    : null;
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

  const rankingRows:
    RawRankRow[] =
    (replay.replay ?? [])
      .flatMap(
        (day: any) =>
          (day.rawRanking ?? [])
            .map(
              (row: any) => ({
                date:
                  day.date,
                stockCode:
                  row.stockCode,
                score:
                  Number(
                    row.score,
                  ),
                dimensions:
                  row.dimensions ?? [],
              }),
            ),
      );

  const dates =
    rankingRows
      .map(
        (row) =>
          row.date,
      )
      .sort();

  const stockCodes =
    [
      ...new Set(
        rankingRows.map(
          (row) =>
            row.stockCode,
        ),
      ),
    ];

  const start =
    dates[0];

  const end =
    "2026-10-30";

  const supabase =
    createSupabaseServerClient();

  const {
    data,
    error,
  } =
    await supabase
      .from(
        "market_daily_bars",
      )
      .select(
        "stock_code,trading_date,close_price,adjusted_price",
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
        start,
      )
      .lte(
        "trading_date",
        end,
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

  if (error) {
    throw error;
  }

  const byStock =
    new Map<
      string,
      Array<{
        date: string;
        close: number;
      }>
    >();

  for (const row of data ?? []) {
    const close =
      Number(
        row.close_price,
      );

    if (
      !Number.isFinite(
        close,
      ) ||
      close <= 0
    ) {
      continue;
    }

    const code =
      String(
        row.stock_code,
      );

    const arr =
      byStock.get(
        code,
      ) ?? [];

    arr.push({
      date:
        String(
          row.trading_date,
        ),
      close,
    });

    byStock.set(
      code,
      arr,
    );
  }

  const labeled =
    rankingRows
      .map(
        (row) => {
          const bars =
            byStock.get(
              row.stockCode,
            ) ?? [];

          const prior =
            bars.filter(
              (bar) =>
                bar.date <
                row.date,
            );

          const future =
            bars.filter(
              (bar) =>
                bar.date >
                row.date,
            );

          const entry =
            prior.at(
              -1,
            );

          if (!entry) {
            return null;
          }

          const returns: Record<
            string,
            number | null
          > = {};

          for (
            const horizon
            of [
              1,
              3,
              5,
            ]
          ) {
            const target =
              future[
                horizon - 1
              ];

            returns[
              `r${horizon}`
            ] =
              target
                ? target.close /
                    entry.close -
                  1
                : null;
          }

          const dimMap =
            Object.fromEntries(
              (row.dimensions ?? [])
                .map(
                  (dim) => [
                    String(
                      dim.dimension,
                    ),
                    Number(
                      dim.rawScore,
                    ),
                  ],
                ),
            );

          return {
            ...row,
            entryDate:
              entry.date,
            entryClose:
              entry.close,
            ...returns,
            dimensionScores:
              dimMap,
          };
        },
      )
      .filter(
        Boolean,
      ) as any[];

  const scorePairs: Record<
    string,
    Array<[number, number]>
  > = {
    r1: [],
    r3: [],
    r5: [],
  };

  for (const row of labeled) {
    for (
      const key
      of [
        "r1",
        "r3",
        "r5",
      ]
    ) {
      if (
        Number.isFinite(
          row[key],
        )
      ) {
        scorePairs[key].push([
          row.score,
          row[key],
        ]);
      }
    }
  }

  const topSorted =
    [...labeled]
      .sort(
        (a, b) =>
          b.score -
          a.score,
      );

  const quintileSize =
    Math.max(
      1,
      Math.floor(
        topSorted.length /
          5,
      ),
    );

  const quintiles =
    Array.from(
      {
        length: 5,
      },
      (
        _,
        index,
      ) => {
        const rows =
          topSorted.slice(
            index *
              quintileSize,
            index === 4
              ? undefined
              : (
                  index +
                  1
                ) *
                  quintileSize,
          );

        return {
          bucket:
            index + 1,
          count:
            rows.length,
          scoreAvg:
            average(
              rows.map(
                (row) =>
                  row.score,
              ),
            ),
          r1Avg:
            average(
              rows
                .map(
                  (row) =>
                    row.r1,
                )
                .filter(
                  Number.isFinite,
                ),
            ),
          r3Avg:
            average(
              rows
                .map(
                  (row) =>
                    row.r3,
                )
                .filter(
                  Number.isFinite,
                ),
            ),
          r5Avg:
            average(
              rows
                .map(
                  (row) =>
                    row.r5,
                )
                .filter(
                  Number.isFinite,
                ),
            ),
        };
      },
    );

  const dimensions =
    [
      "catalyst",
      "flow",
      "marketRegime",
      "priceVolume",
      "liquidity",
      "eventPersistence",
    ];

  const dimensionCorrelation =
    Object.fromEntries(
      dimensions.map(
        (dimension) => {
          const byHorizon =
            Object.fromEntries(
              [
                "r1",
                "r3",
                "r5",
              ].map(
                (key) => [
                  key,
                  pearson(
                    labeled
                      .filter(
                        (row) =>
                          Number.isFinite(
                            row
                              .dimensionScores[
                              dimension
                            ],
                          ) &&
                          Number.isFinite(
                            row[
                              key
                            ],
                          ),
                      )
                      .map(
                        (row) => [
                          row
                            .dimensionScores[
                            dimension
                          ],
                          row[
                            key
                          ],
                        ],
                      ),
                  ),
                ],
              ),
            );

          return [
            dimension,
            byHorizon,
          ];
        },
      ),
    );

  const result = {
    status:
      "ALPHA_V1_FORWARD_RETURN_VALIDATION_COMPLETE",

    labeledRows:
      labeled.length,

    scoreCorrelation: {
      r1:
        pearson(
          scorePairs.r1,
        ),
      r3:
        pearson(
          scorePairs.r3,
        ),
      r5:
        pearson(
          scorePairs.r5,
        ),
    },

    quintiles,

    dimensionCorrelation,

    top10:
      topSorted
        .slice(
          0,
          10,
        )
        .map(
          (row) => ({
            date:
              row.date,
            stockCode:
              row.stockCode,
            score:
              row.score,
            r1:
              row.r1,
            r3:
              row.r3,
            r5:
              row.r5,
          }),
        ),

    safety: {
      databaseReadsOnly:
        true,
      databaseWrites:
        0,
      ordersCreated:
        0,
    },

    nextGate:
      "REVIEW_ALPHA_PREDICTIVE_POWER_BEFORE_THRESHOLD_CALIBRATION",
  };

  const outputFile =
    path.join(
      root,
      "logs",
      "alpha-v1-forward-return-validation.json",
    );

  fs.writeFileSync(
    outputFile,
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
        labeledRows:
          result.labeledRows,
        scoreCorrelation:
          result.scoreCorrelation,
        quintiles:
          result.quintiles,
        dimensionCorrelation:
          result.dimensionCorrelation,
        nextGate:
          result.nextGate,
        outputFile:
          "logs/alpha-v1-forward-return-validation.json",
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
            "ALPHA_V1_FORWARD_RETURN_VALIDATION_FAILED",
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
