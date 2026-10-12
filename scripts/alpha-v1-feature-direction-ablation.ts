import fs from "node:fs";
import path from "node:path";

import {
  createSupabaseServerClient,
} from "../lib/supabase";

const WEIGHTS: Record<string, number> = {
  catalyst: 0.25,
  flow: 0.20,
  marketRegime: 0.10,
  priceVolume: 0.20,
  liquidity: 0.10,
  eventPersistence: 0.15,
};

type DimensionRow = {
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
  dimensions: DimensionRow[];
};

function pearson(
  pairs: Array<[number, number]>,
): number | null {
  if (pairs.length < 3) return null;

  const meanX =
    pairs.reduce((sum, [x]) => sum + x, 0) /
    pairs.length;

  const meanY =
    pairs.reduce((sum, [, y]) => sum + y, 0) /
    pairs.length;

  let numerator = 0;
  let sumX = 0;
  let sumY = 0;

  for (const [x, y] of pairs) {
    const dx = x - meanX;
    const dy = y - meanY;

    numerator += dx * dy;
    sumX += dx * dx;
    sumY += dy * dy;
  }

  const denominator =
    Math.sqrt(sumX * sumY);

  return denominator > 0
    ? numerator / denominator
    : null;
}

function average(
  values: number[],
): number | null {
  return values.length
    ? values.reduce((a, b) => a + b, 0) /
        values.length
    : null;
}

function kstDateAndHour(
  iso: string,
) {
  const utcMs =
    new Date(iso).getTime();

  const kst =
    new Date(
      utcMs + 9 * 60 * 60 * 1000,
    );

  return {
    date:
      kst.toISOString().slice(0, 10),
    hour:
      kst.getUTCHours(),
  };
}

function adjustedScore(
  row: ReplayRow,
  mode:
    | "CURRENT"
    | "NEUTRALIZE_REGIME"
    | "NEUTRALIZE_FLOW"
    | "NEUTRALIZE_FLOW_AND_REGIME"
    | "INVERT_REGIME"
    | "INVERT_FLOW"
    | "INVERT_FLOW_AND_REGIME",
): number {
  if (mode === "CURRENT") {
    return row.score;
  }

  let base =
    row.baseScore;

  const dimMap =
    new Map(
      row.dimensions.map(
        (dim) => [
          dim.dimension,
          dim,
        ],
      ),
    );

  const replaceDimension = (
    name: string,
    transform:
      | "NEUTRAL"
      | "INVERT",
  ) => {
    const dim =
      dimMap.get(name);

    const weight =
      WEIGHTS[name];

    if (
      !dim ||
      !Number.isFinite(weight)
    ) {
      return;
    }

    const replacementEffective =
      transform === "NEUTRAL"
        ? 0.5
        : 1 - dim.effectiveScore;

    const replacementContribution =
      weight * replacementEffective;

    base =
      base -
      dim.contribution +
      replacementContribution;
  };

  if (
    mode === "NEUTRALIZE_REGIME"
  ) {
    replaceDimension(
      "marketRegime",
      "NEUTRAL",
    );
  }

  if (
    mode === "NEUTRALIZE_FLOW"
  ) {
    replaceDimension(
      "flow",
      "NEUTRAL",
    );
  }

  if (
    mode ===
    "NEUTRALIZE_FLOW_AND_REGIME"
  ) {
    replaceDimension(
      "flow",
      "NEUTRAL",
    );

    replaceDimension(
      "marketRegime",
      "NEUTRAL",
    );
  }

  if (
    mode === "INVERT_REGIME"
  ) {
    replaceDimension(
      "marketRegime",
      "INVERT",
    );
  }

  if (
    mode === "INVERT_FLOW"
  ) {
    replaceDimension(
      "flow",
      "INVERT",
    );
  }

  if (
    mode ===
    "INVERT_FLOW_AND_REGIME"
  ) {
    replaceDimension(
      "flow",
      "INVERT",
    );

    replaceDimension(
      "marketRegime",
      "INVERT",
    );
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
                  Number(
                    row.baseScore,
                  ),
                quality:
                  Number(row.quality),
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

  const supabase =
    createSupabaseServerClient();

  const {
    data,
    error,
  } =
    await supabase
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

  const barsByStock =
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

    const stockCode =
      String(bar.stock_code);

    const bucket =
      barsByStock.get(
        stockCode,
      ) ?? [];

    bucket.push({
      date:
        String(
          bar.trading_date,
        ),
      open,
      close,
    });

    barsByStock.set(
      stockCode,
      bucket,
    );
  }

  const labeled =
    rows
      .map(
        (row) => {
          const kst =
            kstDateAndHour(
              row.decisionAt,
            );

          const preOpen =
            kst.hour < 9;

          const futureBars =
            (
              barsByStock.get(
                row.stockCode,
              ) ?? []
            ).filter(
              (bar) =>
                preOpen
                  ? bar.date >=
                    kst.date
                  : bar.date >
                    kst.date,
            );

          const entry =
            futureBars[0];

          if (!entry) {
            return null;
          }

          const bar3 =
            futureBars[2];

          const bar5 =
            futureBars[4];

          return {
            ...row,
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
      .filter(Boolean) as Array<
        ReplayRow & {
          r1: number | null;
          r3: number | null;
          r5: number | null;
        }
      >;

  const modes = [
    "CURRENT",
    "NEUTRALIZE_REGIME",
    "NEUTRALIZE_FLOW",
    "NEUTRALIZE_FLOW_AND_REGIME",
    "INVERT_REGIME",
    "INVERT_FLOW",
    "INVERT_FLOW_AND_REGIME",
  ] as const;

  const results =
    Object.fromEntries(
      modes.map(
        (mode) => {
          const scored =
            labeled.map(
              (row) => ({
                ...row,
                altScore:
                  adjustedScore(
                    row,
                    mode,
                  ),
              }),
            );

          const correlation =
            Object.fromEntries(
              (
                [
                  "r1",
                  "r3",
                  "r5",
                ] as const
              ).map(
                (horizon) => [
                  horizon,
                  pearson(
                    scored
                      .filter(
                        (row) =>
                          Number.isFinite(
                            row[
                              horizon
                            ],
                          ),
                      )
                      .map(
                        (row) => [
                          row.altScore,
                          row[
                            horizon
                          ] as number,
                        ],
                      ),
                  ),
                ],
              ),
            );

          const sorted =
            [...scored]
              .sort(
                (a, b) =>
                  b.altScore -
                  a.altScore,
              );

          const topCount =
            Math.max(
              1,
              Math.floor(
                sorted.length /
                  5,
              ),
            );

          const top =
            sorted.slice(
              0,
              topCount,
            );

          return [
            mode,
            {
              correlation,
              top20pct: {
                count:
                  top.length,
                scoreAvg:
                  average(
                    top.map(
                      (row) =>
                        row.altScore,
                    ),
                  ),
                r1Avg:
                  average(
                    top
                      .map(
                        (row) =>
                          row.r1,
                      )
                      .filter(
                        Number.isFinite,
                      ) as number[],
                  ),
                r3Avg:
                  average(
                    top
                      .map(
                        (row) =>
                          row.r3,
                      )
                      .filter(
                        Number.isFinite,
                      ) as number[],
                  ),
                r5Avg:
                  average(
                    top
                      .map(
                        (row) =>
                          row.r5,
                      )
                      .filter(
                        Number.isFinite,
                      ) as number[],
                  ),
              },
            },
          ];
        },
      ),
    );

  const rankedByR5 =
    Object.entries(results)
      .map(
        ([mode, value]: any) => ({
          mode,
          r1:
            value.correlation.r1,
          r3:
            value.correlation.r3,
          r5:
            value.correlation.r5,
          topR5:
            value.top20pct.r5Avg,
        }),
      )
      .sort(
        (a, b) =>
          (b.r5 ?? -999) -
          (a.r5 ?? -999),
      );

  const report = {
    status:
      "ALPHA_V1_FEATURE_DIRECTION_ABLATION_COMPLETE",

    labeledRows:
      labeled.length,

    methodology: {
      productionWeightsChanged:
        false,
      productionThresholdsChanged:
        false,
      alternatives:
        "OFFLINE_DIAGNOSTIC_ONLY",
      neutralize:
        "replace effective feature score with 0.5",
      invert:
        "replace effective feature score x with 1-x",
      qualityShrinkPreserved:
        true,
    },

    results,

    rankedByR5,

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
      "DECIDE_ALPHA_FEATURE_DIRECTION_FROM_ABLATION",
  };

  fs.writeFileSync(
    path.join(
      root,
      "logs",
      "alpha-v1-feature-direction-ablation.json",
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
        labeledRows:
          report.labeledRows,
        results:
          report.results,
        rankedByR5:
          report.rankedByR5,
        nextGate:
          report.nextGate,
        outputFile:
          "logs/alpha-v1-feature-direction-ablation.json",
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
            "ALPHA_V1_FEATURE_DIRECTION_ABLATION_FAILED",
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
