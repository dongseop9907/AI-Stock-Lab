import fs from "node:fs";
import path from "node:path";

import {
  createSupabaseServerClient,
} from "../lib/supabase";

type RawRankRow = {
  date: string;
  decisionAt: string;
  stockCode: string;
  score: number;
  dimensions?: Array<{
    dimension?: string;
    rawScore?: number | null;
  }>;
};

function kstParts(
  iso: string,
) {
  const ms =
    new Date(
      iso,
    ).getTime();

  const kst =
    new Date(
      ms + 9 * 60 * 60 * 1000,
    );

  return {
    date:
      kst
        .toISOString()
        .slice(
          0,
          10,
        ),
    hour:
      kst.getUTCHours(),
    minute:
      kst.getUTCMinutes(),
  };
}

function pearson(
  pairs: Array<[number, number]>,
): number | null {
  if (pairs.length < 3) {
    return null;
  }

  const mx =
    pairs.reduce(
      (sum, [x]) =>
        sum + x,
      0,
    ) / pairs.length;

  const my =
    pairs.reduce(
      (sum, [, y]) =>
        sum + y,
      0,
    ) / pairs.length;

  let num = 0;
  let dx = 0;
  let dy = 0;

  for (
    const [x, y]
    of pairs
  ) {
    const ax =
      x - mx;

    const ay =
      y - my;

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

function avg(
  values: number[],
): number | null {
  return values.length
    ? values.reduce(
        (a, b) =>
          a + b,
        0,
      ) /
      values.length
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

  const rows:
    RawRankRow[] =
    (replay.replay ?? [])
      .flatMap(
        (day: any) =>
          (day.rawRanking ?? [])
            .map(
              (row: any) => ({
                date:
                  day.date,
                decisionAt:
                  day.decisionAt,
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

  const stockCodes =
    [
      ...new Set(
        rows.map(
          (row) =>
            row.stockCode,
        ),
      ),
    ];

  const {
    data,
    error,
  } =
    await createSupabaseServerClient()
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
        "2026-07-30",
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

  if (error) {
    throw error;
  }

  const byStock =
    new Map<
      string,
      Array<{
        date: string;
        open: number;
        close: number;
      }>
    >();

  for (const bar of data ?? []) {
    const open =
      Number(
        bar.open_price,
      );

    const close =
      Number(
        bar.close_price,
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
        bar.stock_code,
      );

    const arr =
      byStock.get(
        code,
      ) ?? [];

    arr.push({
      date:
        String(
          bar.trading_date,
        ),
      open,
      close,
    });

    byStock.set(
      code,
      arr,
    );
  }

  const labeled =
    rows
      .map(
        (row) => {
          const time =
            kstParts(
              row.decisionAt,
            );

          const preOpen =
            time.hour < 9;

          const bars =
            (
              byStock.get(
                row.stockCode,
              ) ?? []
            )
              .filter(
                (bar) =>
                  preOpen
                    ? bar.date >=
                      time.date
                    : bar.date >
                      time.date,
              );

          const entryBar =
            bars[0];

          if (!entryBar) {
            return null;
          }

          const r1 =
            entryBar.close /
              entryBar.open -
            1;

          const third =
            bars[2];

          const fifth =
            bars[4];

          const r3 =
            third
              ? third.close /
                  entryBar.open -
                1
              : null;

          const r5 =
            fifth
              ? fifth.close /
                  entryBar.open -
                1
              : null;

          const dimensionScores =
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
            decisionDateKst:
              time.date,
            decisionTimeKst:
              `${String(
                time.hour,
              ).padStart(
                2,
                "0",
              )}:${String(
                time.minute,
              ).padStart(
                2,
                "0",
              )}`,
            entryDate:
              entryBar.date,
            entryOpen:
              entryBar.open,
            r1,
            r3,
            r5,
            dimensionScores,
          };
        },
      )
      .filter(
        Boolean,
      ) as any[];

  const horizons =
    [
      "r1",
      "r3",
      "r5",
    ];

  const scoreCorrelation =
    Object.fromEntries(
      horizons.map(
        (key) => [
          key,
          pearson(
            labeled
              .filter(
                (row) =>
                  Number.isFinite(
                    row[key],
                  ),
              )
              .map(
                (row) => [
                  row.score,
                  row[key],
                ],
              ),
          ),
        ],
      ),
    );

  const sorted =
    [...labeled]
      .sort(
        (a, b) =>
          b.score -
          a.score,
      );

  const bucketSize =
    Math.max(
      1,
      Math.floor(
        sorted.length /
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
        const bucket =
          sorted.slice(
            index *
              bucketSize,
            index === 4
              ? undefined
              : (
                  index +
                  1
                ) *
                  bucketSize,
          );

        return {
          bucket:
            index + 1,
          count:
            bucket.length,
          scoreAvg:
            avg(
              bucket.map(
                (row) =>
                  row.score,
              ),
            ),
          r1Avg:
            avg(
              bucket
                .map(
                  (row) =>
                    row.r1,
                )
                .filter(
                  Number.isFinite,
                ),
            ),
          r3Avg:
            avg(
              bucket
                .map(
                  (row) =>
                    row.r3,
                )
                .filter(
                  Number.isFinite,
                ),
            ),
          r5Avg:
            avg(
              bucket
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
        (dimension) => [
          dimension,
          Object.fromEntries(
            horizons.map(
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
                          row[key],
                        ),
                    )
                    .map(
                      (row) => [
                        row
                          .dimensionScores[
                          dimension
                        ],
                        row[key],
                      ],
                    ),
                ),
              ],
            ),
          ),
        ],
      ),
    );

  const sampleCounts =
    Object.fromEntries(
      horizons.map(
        (key) => [
          key,
          labeled.filter(
            (row) =>
              Number.isFinite(
                row[key],
              ),
          ).length,
        ],
      ),
    );

  const result = {
    status:
      "ALPHA_V1_FORWARD_RETURN_VALIDATION_V2_COMPLETE",

    labelingPolicy: {
      timezone:
        "Asia/Seoul",
      preOpenRule:
        "decision before 09:00 KST -> same trading day open",
      postOpenRule:
        "decision at/after 09:00 KST -> next trading day open",
      horizon:
        "return from first tradable open to close of 1st/3rd/5th trading bar",
      noPreSignalPriceUsed:
        true,
    },

    labeledRows:
      labeled.length,

    sampleCounts,

    scoreCorrelation,

    quintiles,

    dimensionCorrelation,

    top10:
      sorted
        .slice(
          0,
          10,
        )
        .map(
          (row) => ({
            decisionAt:
              row.decisionAt,
            decisionTimeKst:
              row.decisionTimeKst,
            stockCode:
              row.stockCode,
            score:
              row.score,
            entryDate:
              row.entryDate,
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
      positionsChanged:
        0,
    },

    nextGate:
      "REVIEW_ALPHA_PREDICTIVE_POWER_V2",
  };

  fs.writeFileSync(
    path.join(
      root,
      "logs",
      "alpha-v1-forward-return-validation-v2.json",
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
        labeledRows:
          result.labeledRows,
        sampleCounts:
          result.sampleCounts,
        scoreCorrelation:
          result.scoreCorrelation,
        quintiles:
          result.quintiles,
        dimensionCorrelation:
          result.dimensionCorrelation,
        nextGate:
          result.nextGate,
        outputFile:
          "logs/alpha-v1-forward-return-validation-v2.json",
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
            "ALPHA_V1_FORWARD_RETURN_VALIDATION_V2_FAILED",
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
