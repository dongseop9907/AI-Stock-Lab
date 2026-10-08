import fs from "node:fs";
import path from "node:path";

import {
  createSupabaseServerClient,
} from "../lib/supabase";

const ORIGINAL_WEIGHTS: Record<string, number> = {
  catalyst: 0.25,
  flow: 0.20,
  marketRegime: 0.10,
  priceVolume: 0.20,
  liquidity: 0.10,
  eventPersistence: 0.15,
};

const FEATURES = [
  "catalyst",
  "priceVolume",
  "liquidity",
  "eventPersistence",
] as const;

type FeatureName =
  typeof FEATURES[number];

type Dimension = {
  dimension: string;
  contribution: number;
};

type ReplayRow = {
  date: string;
  decisionAt: string;
  stockCode: string;
  quality: number;
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

function allFeatureSets(): FeatureName[][] {
  const sets: FeatureName[][] = [];

  for (
    let mask = 1;
    mask <
    1 << FEATURES.length;
    mask += 1
  ) {
    const set =
      FEATURES.filter(
        (
          _,
          index,
        ) =>
          Boolean(
            mask &
            (
              1 << index
            ),
          ),
      );

    sets.push(
      [...set],
    );
  }

  return sets;
}

function subsetScore(
  row: ReplayRow,
  selected: FeatureName[],
): number {
  const dims =
    new Map(
      row.dimensions.map(
        (dim) => [
          dim.dimension,
          dim,
        ],
      ),
    );

  const totalWeight =
    selected.reduce(
      (
        sum,
        name,
      ) =>
        sum +
        ORIGINAL_WEIGHTS[
          name
        ],
      0,
    );

  if (
    totalWeight <= 0
  ) {
    return 0.5;
  }

  let normalizedBase =
    0;

  for (
    const name
    of selected
  ) {
    const dim =
      dims.get(name);

    if (!dim) {
      normalizedBase +=
        (
          ORIGINAL_WEIGHTS[
            name
          ] /
          totalWeight
        ) *
        0.5;

      continue;
    }

    const effectiveScore =
      dim.contribution /
      ORIGINAL_WEIGHTS[
        name
      ];

    normalizedBase +=
      (
        ORIGINAL_WEIGHTS[
          name
        ] /
        totalWeight
      ) *
      effectiveScore;
  }

  return (
    0.5 +
    (
      normalizedBase -
      0.5
    ) *
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
                quality:
                  Number(
                    row.quality,
                  ),
                dimensions:
                  (
                    row.dimensions ??
                    []
                  ).map(
                    (dim: any) => ({
                      dimension:
                        String(
                          dim.dimension,
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
          (r) =>
            r.stockCode,
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

  if (error) {
    throw error;
  }

  const byStock =
    new Map<string, any[]>();

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
      !Number.isFinite(open) ||
      !Number.isFinite(close) ||
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
      byStock.get(code) ?? [];

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

          if (!entry) {
            return null;
          }

          const b3 =
            future[2];

          const b5 =
            future[4];

          return {
            ...row,
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
      byDate.get(
        row.date,
      ) ?? [];

    arr.push(row);

    byDate.set(
      row.date,
      arr,
    );
  }

  const featureSets =
    allFeatureSets();

  const results =
    featureSets.map(
      (selected) => {
        const dailyIC: Record<
          string,
          number[]
        > = {
          r1: [],
          r3: [],
          r5: [],
        };

        const spreads: Record<
          string,
          number[]
        > = {
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
                  subsetScore:
                    subsetScore(
                      row,
                      selected,
                    ),
                }),
              )
              .sort(
                (a, b) =>
                  b.subsetScore -
                  a.subsetScore,
              );

          for (
            const horizon
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
                    row[horizon],
                  ),
              );

            if (
              usable.length >= 3
            ) {
              const ic =
                pearson(
                  usable.map(
                    (row) => [
                      row.subsetScore,
                      row[
                        horizon
                      ],
                    ]),
                );

              if (
                ic !== null
              ) {
                dailyIC[
                  horizon
                ].push(ic);
              }
            }

            if (
              usable.length >= 2
            ) {
              spreads[
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
                (x) =>
                  x > 0,
              ).length /
              values.length
            : null;

        const meanIC = {
          r1:
            avg(dailyIC.r1),
          r3:
            avg(dailyIC.r3),
          r5:
            avg(dailyIC.r5),
        };

        const robustnessScore =
          (
            meanIC.r1 ??
            0
          ) *
            0.30 +
          (
            meanIC.r3 ??
            0
          ) *
            0.40 +
          (
            meanIC.r5 ??
            0
          ) *
            0.30;

        return {
          features:
            selected,
          meanDailyIC:
            meanIC,
          positiveICRate: {
            r1:
              positiveRate(
                dailyIC.r1,
              ),
            r3:
              positiveRate(
                dailyIC.r3,
              ),
            r5:
              positiveRate(
                dailyIC.r5,
              ),
          },
          meanTopMinusBottomReturn: {
            r1:
              avg(
                spreads.r1,
              ),
            r3:
              avg(
                spreads.r3,
              ),
            r5:
              avg(
                spreads.r5,
              ),
          },
          robustnessScore,
        };
      },
    );

  const ranked =
    [...results]
      .sort(
        (a, b) =>
          b.robustnessScore -
          a.robustnessScore,
      );

  const result = {
    status:
      "ALPHA_V1_STOCK_FEATURE_SUBSET_ABLATION_COMPLETE",
    labeledRows:
      labeled.length,
    dateCount:
      byDate.size,
    featureSetCount:
      featureSets.length,
    rankingRule: {
      robustnessScore:
        "0.30*r1_IC + 0.40*r3_IC + 0.30*r5_IC",
      productionChanged:
        false,
      regimeExcluded:
        true,
      flowExcluded:
        true,
      weights:
        "original relative weights renormalized inside each subset",
      qualityShrinkPreserved:
        true,
    },
    ranked,
    top5:
      ranked.slice(
        0,
        5,
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
      "SELECT_ALPHA_V2_STOCK_RANKING_FEATURE_SET",
  };

  fs.writeFileSync(
    path.join(
      root,
      "logs",
      "alpha-v1-stock-feature-subset-ablation.json",
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
        featureSetCount:
          result.featureSetCount,
        top5:
          result.top5,
        nextGate:
          result.nextGate,
        outputFile:
          "logs/alpha-v1-stock-feature-subset-ablation.json",
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
            "ALPHA_V1_STOCK_FEATURE_SUBSET_ABLATION_FAILED",
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
