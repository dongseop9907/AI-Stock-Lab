import fs from "node:fs";
import path from "node:path";

import {
  createSupabaseServerClient,
} from "../lib/supabase";

type Dimension = {
  dimension: string;
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

function noRegimeScore(
  row: ReplayRow,
): number {
  const regime =
    row.dimensions.find(
      (d) =>
        d.dimension ===
        "marketRegime",
    );

  if (!regime) {
    return row.score;
  }

  // Remaining positive weights sum to 0.90 after removing regime's 0.10.
  const renormalizedBase =
    (
      row.baseScore -
      regime.contribution
    ) / 0.90;

  return (
    0.5 +
    (
      renormalizedBase -
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
            )
              .filter(
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

          return {
            ...row,
            currentScore:
              row.score,
            noRegimeScore:
              noRegimeScore(row),
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

  const evaluate = (
    scoreKey:
      | "currentScore"
      | "noRegimeScore",
  ) => {
    const horizons =
      [
        "r1",
        "r3",
        "r5",
      ];

    const correlation =
      Object.fromEntries(
        horizons.map(
          (h) => [
            h,
            pearson(
              labeled
                .filter(
                  (row) =>
                    Number.isFinite(
                      row[h],
                    ),
                )
                .map(
                  (row) => [
                    row[
                      scoreKey
                    ],
                    row[h],
                  ]),
            ),
          ],
        ),
      );

    const sorted =
      [...labeled]
        .sort(
          (a, b) =>
            b[
              scoreKey
            ] -
            a[
              scoreKey
            ],
        );

    const q =
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
          i,
        ) => {
          const bucket =
            sorted.slice(
              i * q,
              i === 4
                ? undefined
                : (
                    i + 1
                  ) * q,
            );

          return {
            bucket:
              i + 1,
            count:
              bucket.length,
            scoreAvg:
              avg(
                bucket.map(
                  (r) =>
                    r[
                      scoreKey
                    ],
                ),
              ),
            r1Avg:
              avg(
                bucket
                  .map(
                    (r) =>
                      r.r1,
                  )
                  .filter(
                    Number.isFinite,
                  ),
              ),
            r3Avg:
              avg(
                bucket
                  .map(
                    (r) =>
                      r.r3,
                  )
                  .filter(
                    Number.isFinite,
                  ),
              ),
            r5Avg:
              avg(
                bucket
                  .map(
                    (r) =>
                      r.r5,
                  )
                  .filter(
                    Number.isFinite,
                  ),
              ),
          };
        },
      );

    return {
      correlation,
      quintiles,
    };
  };

  const result = {
    status:
      "ALPHA_V1_REGIME_ROLE_ABLATION_COMPLETE",
    labeledRows:
      labeled.length,
    current:
      evaluate(
        "currentScore",
      ),
    noRegimeRanking:
      evaluate(
        "noRegimeScore",
      ),
    methodology: {
      productionChanged:
        false,
      regimeWeightRemoved:
        0.10,
      remainingWeightsRenormalized:
        true,
      qualityShrinkPreserved:
        true,
      intendedArchitecture:
        "MARKET_REGIME_AS_SEPARATE_GATE_OR_EXPOSURE_CONTROL",
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
      "DECIDE_REGIME_REMOVAL_FROM_STOCK_RANKING",
  };

  fs.writeFileSync(
    path.join(
      root,
      "logs",
      "alpha-v1-regime-role-ablation.json",
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
        current:
          result.current,
        noRegimeRanking:
          result.noRegimeRanking,
        nextGate:
          result.nextGate,
        outputFile:
          "logs/alpha-v1-regime-role-ablation.json",
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
            "ALPHA_V1_REGIME_ROLE_ABLATION_FAILED",
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
