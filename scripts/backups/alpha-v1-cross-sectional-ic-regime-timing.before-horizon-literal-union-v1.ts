import fs from "node:fs";
import path from "node:path";

import {
  createSupabaseServerClient,
} from "../lib/supabase";

type Dimension = {
  dimension: string;
  effectiveScore: number;
  contribution: number;
};

type ReplayRow = {
  date: string;
  decisionAt: string;
  stockCode: string;
  score: number;
  baseScore: number;
  quality: number;
  dimensions: Dimension[];
};

const WEIGHTS: Record<string, number> = {
  catalyst: 0.25,
  flow: 0.20,
  marketRegime: 0.10,
  priceVolume: 0.20,
  liquidity: 0.10,
  eventPersistence: 0.15,
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
  const ms =
    new Date(iso).getTime() +
    9 * 60 * 60 * 1000;

  const d =
    new Date(ms);

  return {
    date:
      d.toISOString().slice(0, 10),
    hour:
      d.getUTCHours(),
  };
}

function altScore(
  row: ReplayRow,
  mode:
    | "CURRENT"
    | "INVERT_FLOW"
    | "INVERT_FLOW_AND_REGIME",
): number {
  if (mode === "CURRENT") {
    return row.score;
  }

  let base =
    row.baseScore;

  const map =
    new Map(
      row.dimensions.map(
        (dim) => [
          dim.dimension,
          dim,
        ],
      ),
    );

  const invert = (
    name: string,
  ) => {
    const dim =
      map.get(name);

    const weight =
      WEIGHTS[name];

    if (
      !dim ||
      !Number.isFinite(weight)
    ) {
      return;
    }

    base =
      base -
      dim.contribution +
      weight *
        (1 - dim.effectiveScore);
  };

  invert("flow");

  if (
    mode ===
    "INVERT_FLOW_AND_REGIME"
  ) {
    invert("marketRegime");
  }

  return (
    0.5 +
    (base - 0.5) *
      row.quality
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
                score:
                  Number(row.score),
                baseScore:
                  Number(row.baseScore),
                quality:
                  Number(row.quality),
                dimensions:
                  (row.dimensions ?? [])
                    .map(
                      (dim: any) => ({
                        dimension:
                          String(dim.dimension),
                        effectiveScore:
                          Number(
                            dim.effectiveScore,
                          ),
                        contribution:
                          Number(
                            dim.contribution,
                          ),
                      }),
                    ),
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

  const barsByStock =
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
      barsByStock.get(code) ?? [];

    arr.push({
      date:
        String(bar.trading_date),
      open,
      close,
    });

    barsByStock.set(
      code,
      arr,
    );
  }

  const labeled =
    rows
      .map(
        (row) => {
          const kst =
            kstDateHour(
              row.decisionAt,
            );

          const preOpen =
            kst.hour < 9;

          const future =
            (
              barsByStock.get(
                row.stockCode,
              ) ?? []
            )
              .filter(
                (bar) =>
                  preOpen
                    ? bar.date >=
                      kst.date
                    : bar.date >
                      kst.date,
              );

          const entry =
            future[0];

          if (!entry) return null;

          const bar3 =
            future[2];

          const bar5 =
            future[4];

          const regime =
            row.dimensions
              .find(
                (d) =>
                  d.dimension ===
                  "marketRegime",
              );

          return {
            ...row,
            regimeEffective:
              regime?.effectiveScore ??
              null,
            r1:
              entry.close /
                entry.open -
              1,
            r3:
              bar3
                ? bar3.close /
                    entry.open -
                  1
                : null,
            r5:
              bar5
                ? bar5.close /
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

  const modes = [
    "CURRENT",
    "INVERT_FLOW",
    "INVERT_FLOW_AND_REGIME",
  ] as const;

  const modeResults =
    Object.fromEntries(
      modes.map(
        (mode) => {
          const dailyICs: Record<
            string,
            number[]
          > = {
            r1: [],
            r3: [],
            r5: [],
          };

          const topMinusBottom:
            Record<string, number[]> = {
            r1: [],
            r3: [],
            r5: [],
          };

          for (
            const dayRows
            of byDate.values()
          ) {
            const scored =
              dayRows
                .map(
                  (row) => ({
                    ...row,
                    altScore:
                      altScore(
                        row,
                        mode,
                      ),
                  }),
                )
                .sort(
                  (a, b) =>
                    b.altScore -
                    a.altScore,
                );

            for (
              const h
              of [
                "r1",
                "r3",
                "r5",
              ]
            ) {
              const usable =
                scored.filter(
                  (row) =>
                    Number.isFinite(
                      row[h],
                    ),
                );

              if (
                usable.length >=
                3
              ) {
                const ic =
                  pearson(
                    usable.map(
                      (row) => [
                        row.altScore,
                        row[h],
                      ],
                    ),
                  );

                if (
                  ic !== null
                ) {
                  dailyICs[h].push(
                    ic,
                  );
                }
              }

              if (
                usable.length >=
                2
              ) {
                topMinusBottom[h].push(
                  usable[0][h] -
                  usable[
                    usable.length - 1
                  ][h],
                );
              }
            }
          }

          const positiveRate = (
            xs: number[],
          ) =>
            xs.length
              ? xs.filter(
                  (x) =>
                    x > 0,
                ).length /
                xs.length
              : null;

          return [
            mode,
            {
              meanDailyIC: {
                r1:
                  avg(dailyICs.r1),
                r3:
                  avg(dailyICs.r3),
                r5:
                  avg(dailyICs.r5),
              },
              positiveICRate: {
                r1:
                  positiveRate(
                    dailyICs.r1,
                  ),
                r3:
                  positiveRate(
                    dailyICs.r3,
                  ),
                r5:
                  positiveRate(
                    dailyICs.r5,
                  ),
              },
              meanTopMinusBottomReturn: {
                r1:
                  avg(
                    topMinusBottom.r1,
                  ),
                r3:
                  avg(
                    topMinusBottom.r3,
                  ),
                r5:
                  avg(
                    topMinusBottom.r5,
                  ),
              },
              dailySampleCounts: {
                r1:
                  dailyICs.r1.length,
                r3:
                  dailyICs.r3.length,
                r5:
                  dailyICs.r5.length,
              },
            },
          ];
        },
      ),
    );

  const dateRows =
    [...byDate.entries()]
      .map(
        ([date, dayRows]) => ({
          date,
          regime:
            avg(
              dayRows
                .map(
                  (r) =>
                    r.regimeEffective,
                )
                .filter(
                  Number.isFinite,
                ),
            ),
          r1:
            avg(
              dayRows
                .map(
                  (r) =>
                    r.r1,
                )
                .filter(
                  Number.isFinite,
                ),
            ),
          r3:
            avg(
              dayRows
                .map(
                  (r) =>
                    r.r3,
                )
                .filter(
                  Number.isFinite,
                ),
            ),
          r5:
            avg(
              dayRows
                .map(
                  (r) =>
                    r.r5,
                )
                .filter(
                  Number.isFinite,
                ),
            ),
        }),
      );

  const regimeTimingCorrelation =
    Object.fromEntries(
      [
        "r1",
        "r3",
        "r5",
      ].map(
        (h) => [
          h,
          pearson(
            dateRows
              .filter(
                (row) =>
                  Number.isFinite(
                    row.regime,
                  ) &&
                  Number.isFinite(
                    row[h],
                  ),
              )
              .map(
                (row) => [
                  row.regime as number,
                  row[h] as number,
                ]),
          ),
        ],
      ),
    );

  const result = {
    status:
      "ALPHA_V1_CROSS_SECTIONAL_IC_REGIME_TIMING_COMPLETE",
    labeledRows:
      labeled.length,
    dateCount:
      byDate.size,
    modeResults,
    regimeTimingCorrelation,
    interpretationContract: {
      crossSectionalIC:
        "stock-ranking skill within each decision date",
      regimeTimingCorrelation:
        "market-regime score versus average future return across dates",
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
      "DECIDE_FLOW_DIRECTION_AND_REGIME_ROLE",
  };

  fs.writeFileSync(
    path.join(
      root,
      "logs",
      "alpha-v1-cross-sectional-ic-regime-timing.json",
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
        modeResults:
          result.modeResults,
        regimeTimingCorrelation:
          result.regimeTimingCorrelation,
        nextGate:
          result.nextGate,
        outputFile:
          "logs/alpha-v1-cross-sectional-ic-regime-timing.json",
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
            "ALPHA_V1_CROSS_SECTIONAL_IC_REGIME_TIMING_FAILED",
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
