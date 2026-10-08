import fs from "node:fs";
import path from "node:path";

import {
  createSupabaseServerClient,
} from "../lib/supabase";

type Dimension = {
  dimension: string;
  rawScore: number | null;
  effectiveScore: number | null;
};

type ReplayRow = {
  date: string;
  decisionAt: string;
  stockCode: string;
  dimensions: Dimension[];
};

function pearson(
  pairs: Array<[number, number]>,
): number | null {
  if (pairs.length < 3) return null;

  const mx =
    pairs.reduce((s, [x]) => s + x, 0) /
    pairs.length;

  const my =
    pairs.reduce((s, [, y]) => s + y, 0) /
    pairs.length;

  let num = 0;
  let dx = 0;
  let dy = 0;

  for (const [x, y] of pairs) {
    const ax = x - mx;
    const ay = y - my;

    num += ax * ay;
    dx += ax * ax;
    dy += ay * ay;
  }

  const den =
    Math.sqrt(dx * dy);

  return den > 0
    ? num / den
    : null;
}

function avg(
  xs: number[],
): number | null {
  return xs.length
    ? xs.reduce((a, b) => a + b, 0) /
        xs.length
    : null;
}

function kstDateHour(
  iso: string,
) {
  const d =
    new Date(
      new Date(iso).getTime() +
      9 * 60 * 60 * 1000,
    );

  return {
    date:
      d.toISOString().slice(0, 10),
    hour:
      d.getUTCHours(),
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

  const rows: ReplayRow[] =
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
                dimensions:
                  (row.dimensions ?? [])
                    .map(
                      (dim: any) => ({
                        dimension:
                          String(
                            dim.dimension,
                          ),
                        rawScore:
                          Number.isFinite(
                            Number(
                              dim.rawScore,
                            ),
                          )
                            ? Number(
                                dim.rawScore,
                              )
                            : null,
                        effectiveScore:
                          Number.isFinite(
                            Number(
                              dim.effectiveScore,
                            ),
                          )
                            ? Number(
                                dim.effectiveScore,
                              )
                            : null,
                      }),
                    ),
              }),
            ),
      );

  const stockCodes =
    [
      ...new Set(
        rows.map(
          (r) => r.stockCode,
        ),
      ),
    ];

  const {
    data,
    error,
  } =
    await createSupabaseServerClient()
      .from("market_daily_bars")
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
      .order("stock_code")
      .order("trading_date")
      .limit(10000);

  if (error) throw error;

  const byStock =
    new Map<string, any[]>();

  for (const bar of data ?? []) {
    const open =
      Number(bar.open_price);

    const close =
      Number(bar.close_price);

    if (
      !Number.isFinite(open) ||
      !Number.isFinite(close) ||
      open <= 0 ||
      close <= 0
    ) {
      continue;
    }

    const code =
      String(bar.stock_code);

    const arr =
      byStock.get(code) ?? [];

    arr.push({
      date:
        String(bar.trading_date),
      open,
      close,
    });

    byStock.set(code, arr);
  }

  const labeled =
    rows
      .map(
        (row) => {
          const kst =
            kstDateHour(
              row.decisionAt,
            );

          const future =
            (
              byStock.get(
                row.stockCode,
              ) ?? []
            ).filter(
              (bar) =>
                kst.hour < 9
                  ? bar.date >=
                    kst.date
                  : bar.date >
                    kst.date,
            );

          const entry =
            future[0];

          if (!entry) return null;

          const b3 =
            future[2];

          const b5 =
            future[4];

          const dimensionMap =
            Object.fromEntries(
              row.dimensions.map(
                (dim) => [
                  dim.dimension,
                  {
                    raw:
                      dim.rawScore,
                    effective:
                      dim.effectiveScore,
                  },
                ],
              ),
            );

          return {
            ...row,
            dimensionMap,
            r1:
              entry.close /
                entry.open -
              1,
            r3:
              b3
                ? b3.close /
                    entry.open -
                  1
                : null,
            r5:
              b5
                ? b5.close /
                    entry.open -
                  1
                : null,
          };
        },
      )
      .filter(Boolean) as any[];

  const byDate =
    new Map<string, any[]>();

  for (const row of labeled) {
    const arr =
      byDate.get(row.date) ?? [];

    arr.push(row);

    byDate.set(
      row.date,
      arr,
    );
  }

  const dimensions = [
    "catalyst",
    "flow",
    "priceVolume",
    "liquidity",
    "eventPersistence",
  ];

  const results =
    Object.fromEntries(
      dimensions.map(
        (dimension) => {
          const horizons =
            ["r1", "r3", "r5"];

          const icByHorizon:
            Record<string, number[]> = {
            r1: [],
            r3: [],
            r5: [],
          };

          const spreadByHorizon:
            Record<string, number[]> = {
            r1: [],
            r3: [],
            r5: [],
          };

          for (
            const dayRows
            of byDate.values()
          ) {
            for (
              const horizon
              of horizons
            ) {
              const usable =
                dayRows
                  .filter(
                    (row) =>
                      Number.isFinite(
                        row
                          .dimensionMap[
                          dimension
                        ]?.effective,
                      ) &&
                      Number.isFinite(
                        row[horizon],
                      ),
                  )
                  .sort(
                    (a, b) =>
                      b
                        .dimensionMap[
                        dimension
                      ]
                        .effective -
                      a
                        .dimensionMap[
                        dimension
                      ]
                        .effective,
                  );

              if (
                usable.length >= 3
              ) {
                const ic =
                  pearson(
                    usable.map(
                      (row) => [
                        row
                          .dimensionMap[
                          dimension
                        ]
                          .effective,
                        row[
                          horizon
                        ],
                      ],
                    ),
                  );

                if (ic !== null) {
                  icByHorizon[
                    horizon
                  ].push(
                    ic,
                  );
                }
              }

              if (
                usable.length >= 2
              ) {
                spreadByHorizon[
                  horizon
                ].push(
                  usable[0][
                    horizon
                  ] -
                  usable[
                    usable.length - 1
                  ][horizon],
                );
              }
            }
          }

          const positiveRate = (
            values: number[],
          ) =>
            values.length
              ? values.filter(
                  (x) => x > 0,
                ).length /
                values.length
              : null;

          return [
            dimension,
            {
              meanDailyIC: {
                r1:
                  avg(
                    icByHorizon.r1,
                  ),
                r3:
                  avg(
                    icByHorizon.r3,
                  ),
                r5:
                  avg(
                    icByHorizon.r5,
                  ),
              },
              positiveICRate: {
                r1:
                  positiveRate(
                    icByHorizon.r1,
                  ),
                r3:
                  positiveRate(
                    icByHorizon.r3,
                  ),
                r5:
                  positiveRate(
                    icByHorizon.r5,
                  ),
              },
              meanTopMinusBottomReturn: {
                r1:
                  avg(
                    spreadByHorizon.r1,
                  ),
                r3:
                  avg(
                    spreadByHorizon.r3,
                  ),
                r5:
                  avg(
                    spreadByHorizon.r5,
                  ),
              },
              dailySampleCounts: {
                r1:
                  icByHorizon.r1.length,
                r3:
                  icByHorizon.r3.length,
                r5:
                  icByHorizon.r5.length,
              },
            },
          ];
        },
      ),
    );

  const rankedByR5IC =
    Object.entries(results)
      .map(
        ([dimension, value]: any) => ({
          dimension,
          r1:
            value.meanDailyIC.r1,
          r3:
            value.meanDailyIC.r3,
          r5:
            value.meanDailyIC.r5,
          positiveR5Rate:
            value
              .positiveICRate
              .r5,
          topMinusBottomR5:
            value
              .meanTopMinusBottomReturn
              .r5,
        }),
      )
      .sort(
        (a, b) =>
          (b.r5 ?? -999) -
          (a.r5 ?? -999),
      );

  const result = {
    status:
      "ALPHA_V1_FEATURE_CROSS_SECTIONAL_IC_COMPLETE",
    labeledRows:
      labeled.length,
    dateCount:
      byDate.size,
    results,
    rankedByR5IC,
    interpretationContract: {
      regimeExcluded:
        true,
      purpose:
        "measure stock-selection power of each stock-specific Alpha feature within the same decision date",
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
      "DECIDE_STOCK_RANKING_FEATURE_SET",
  };

  fs.writeFileSync(
    path.join(
      root,
      "logs",
      "alpha-v1-feature-cross-sectional-ic.json",
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
        dateCount:
          result.dateCount,
        results:
          result.results,
        rankedByR5IC:
          result.rankedByR5IC,
        nextGate:
          result.nextGate,
        outputFile:
          "logs/alpha-v1-feature-cross-sectional-ic.json",
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
            "ALPHA_V1_FEATURE_CROSS_SECTIONAL_IC_FAILED",
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
