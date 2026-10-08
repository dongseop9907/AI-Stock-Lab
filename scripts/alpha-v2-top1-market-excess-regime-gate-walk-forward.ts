import fs from "node:fs";
import path from "node:path";
import { createSupabaseServerClient } from "../lib/supabase";

function avg(values: number[]): number | null {
  return values.length
    ? values.reduce((a, b) => a + b, 0) / values.length
    : null;
}

function quantile(values: number[], q: number): number | null {
  const xs = [...values]
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (!xs.length) return null;

  const pos =
    (xs.length - 1) * q;

  const lo =
    Math.floor(pos);

  const hi =
    Math.ceil(pos);

  if (lo === hi) {
    return xs[lo];
  }

  const w =
    pos - lo;

  return (
    xs[lo] * (1 - w) +
    xs[hi] * w
  );
}

function kstDateHour(iso: string) {
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

function getDimension(
  row: any,
  name: string,
) {
  return (row.dimensions ?? []).find(
    (item: any) =>
      item.dimension === name,
  );
}

function priceVolumeScore(
  row: any,
): number | null {
  const dim =
    getDimension(
      row,
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
    (effective - 0.5) *
      quality
  );
}

function regimeScore(
  row: any,
): number | null {
  const dim =
    getDimension(
      row,
      "marketRegime",
    );

  const effective =
    Number(
      dim?.effectiveScore,
    );

  return Number.isFinite(effective)
    ? effective
    : null;
}

function evaluateGate(
  dateRows: any[],
  gate:
    | "ALL"
    | "LOW_33"
    | "LOW_50"
    | "HIGH_50"
    | "HIGH_67",
  thresholds: {
    q33: number;
    q50: number;
    q67: number;
  },
) {
  const selectedDates =
    dateRows.filter(
      (day) => {
        if (gate === "ALL") return true;
        if (!Number.isFinite(day.regime)) return false;

        if (gate === "LOW_33") {
          return day.regime <= thresholds.q33;
        }

        if (gate === "LOW_50") {
          return day.regime <= thresholds.q50;
        }

        if (gate === "HIGH_50") {
          return day.regime >= thresholds.q50;
        }

        return day.regime >= thresholds.q67;
      },
    );

  const summarize = (
    key:
      | "r1"
      | "r3"
      | "r5",
  ) => {
    const abs =
      selectedDates
        .map(
          (day) =>
            day.top1[key],
        )
        .filter(
          Number.isFinite,
        ) as number[];

    const market =
      selectedDates
        .map(
          (day) =>
            day.market[key],
        )
        .filter(
          Number.isFinite,
        ) as number[];

    const excess =
      selectedDates
        .map(
          (day) => {
            const a =
              day.top1[key];

            const m =
              day.market[key];

            return (
              Number.isFinite(a) &&
              Number.isFinite(m)
            )
              ? a - m
              : null;
          },
        )
        .filter(
          Number.isFinite,
        ) as number[];

    return {
      absolute:
        avg(abs),
      market:
        avg(market),
      excess:
        avg(excess),
      positiveAbsoluteRate:
        abs.length
          ? abs.filter(
              (x) =>
                x > 0,
            ).length /
            abs.length
          : null,
      positiveExcessRate:
        excess.length
          ? excess.filter(
              (x) =>
                x > 0,
            ).length /
            excess.length
          : null,
    };
  };

  return {
    gate,
    selectedDateCount:
      selectedDates.length,
    r1:
      summarize("r1"),
    r3:
      summarize("r3"),
    r5:
      summarize("r5"),
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

  const baseRows =
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
                  row.dimensions ?? [],
              }),
            ),
      );

  const stockCodes =
    [
      ...new Set(
        baseRows.map(
          (row: any) =>
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

  const barsByStock =
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
      barsByStock.get(code) ?? [];

    arr.push({
      date:
        String(
          bar.trading_date,
        ),
      open,
      close,
    });

    barsByStock.set(
      code,
      arr,
    );
  }

  const labeled =
    baseRows
      .map(
        (row: any) => {
          const pv =
            priceVolumeScore(
              row,
            );

          const regime =
            regimeScore(
              row,
            );

          if (
            pv === null ||
            regime === null
          ) {
            return null;
          }

          const kst =
            kstDateHour(
              row.decisionAt,
            );

          const future =
            (
              barsByStock.get(
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
            pvScore:
              pv,
            regime,
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
      .filter(
        Boolean,
      ) as any[];

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

  const dateRows =
    [...byDate.entries()]
      .map(
        ([date, rows]) => {
          const ranked =
            [...rows]
              .sort(
                (a, b) =>
                  b.pvScore -
                  a.pvScore,
              );

          const top1 =
            ranked[0];

          const market = {
            r1:
              avg(
                rows
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
                rows
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
                rows
                  .map(
                    (r) =>
                      r.r5,
                  )
                  .filter(
                    Number.isFinite,
                  ),
              ),
          };

          return {
            date,
            regime:
              avg(
                rows
                  .map(
                    (r) =>
                      r.regime,
                  )
                  .filter(
                    Number.isFinite,
                  ),
              ),
            top1: {
              stockCode:
                top1.stockCode,
              score:
                top1.pvScore,
              r1:
                top1.r1,
              r3:
                top1.r3,
              r5:
                top1.r5,
            },
            market,
          };
        },
      )
      .sort(
        (a, b) =>
          a.date.localeCompare(
            b.date,
          ),
      );

  const dates =
    dateRows.map(
      (row) =>
        row.date,
    );

  const gates =
    [
      "ALL",
      "LOW_33",
      "LOW_50",
      "HIGH_50",
      "HIGH_67",
    ] as const;

  const minimumTrainDates =
    10;

  const testBlockSize =
    4;

  const folds: any[] =
    [];

  for (
    let testStart =
      minimumTrainDates;
    testStart <
    dates.length;
    testStart +=
      testBlockSize
  ) {
    const trainDates =
      dates.slice(
        0,
        testStart,
      );

    const testDates =
      dates.slice(
        testStart,
        Math.min(
          dates.length,
          testStart +
            testBlockSize,
        ),
      );

    if (
      !testDates.length
    ) {
      continue;
    }

    const trainRows =
      dateRows.filter(
        (row) =>
          trainDates.includes(
            row.date,
          ),
      );

    const testRows =
      dateRows.filter(
        (row) =>
          testDates.includes(
            row.date,
          ),
      );

    const regimeValues =
      trainRows
        .map(
          (row) =>
            row.regime,
        )
        .filter(
          Number.isFinite,
        ) as number[];

    const q33 =
      quantile(
        regimeValues,
        0.33,
      );

    const q50 =
      quantile(
        regimeValues,
        0.50,
      );

    const q67 =
      quantile(
        regimeValues,
        0.67,
      );

    if (
      q33 === null ||
      q50 === null ||
      q67 === null
    ) {
      continue;
    }

    const thresholds = {
      q33,
      q50,
      q67,
    };

    const testResults =
      Object.fromEntries(
        gates.map(
          (gate) => [
            gate,
            evaluateGate(
              testRows,
              gate,
              thresholds,
            ),
          ],
        ),
      );

    folds.push({
      fold:
        folds.length + 1,
      trainDateCount:
        trainDates.length,
      testStart:
        testDates[0],
      testEnd:
        testDates.at(-1),
      regimeThresholds:
        thresholds,
      testResults,
    });
  }

  const aggregate =
    Object.fromEntries(
      gates.map(
        (gate) => {
          const foldResults =
            folds
              .map(
                (fold) =>
                  fold.testResults[
                    gate
                  ],
              );

          const summary = (
            horizon:
              | "r1"
              | "r3"
              | "r5",
            field:
              | "absolute"
              | "market"
              | "excess",
          ) =>
            avg(
              foldResults
                .map(
                  (result) =>
                    result[
                      horizon
                    ][field],
                )
                .filter(
                  Number.isFinite,
                ),
            );

          return [
            gate,
            {
              meanSelectedDates:
                avg(
                  foldResults.map(
                    (result) =>
                      result
                        .selectedDateCount,
                  ),
                ),
              r1: {
                absolute:
                  summary(
                    "r1",
                    "absolute",
                  ),
                market:
                  summary(
                    "r1",
                    "market",
                  ),
                excess:
                  summary(
                    "r1",
                    "excess",
                  ),
              },
              r3: {
                absolute:
                  summary(
                    "r3",
                    "absolute",
                  ),
                market:
                  summary(
                    "r3",
                    "market",
                  ),
                excess:
                  summary(
                    "r3",
                    "excess",
                  ),
              },
              r5: {
                absolute:
                  summary(
                    "r5",
                    "absolute",
                  ),
                market:
                  summary(
                    "r5",
                    "market",
                  ),
                excess:
                  summary(
                    "r5",
                    "excess",
                  ),
              },
            },
          ];
        },
      ),
    );

  const result = {
    status:
      "ALPHA_V2_TOP1_MARKET_EXCESS_REGIME_GATE_WALK_FORWARD_COMPLETE",
    dateCount:
      dateRows.length,
    foldCount:
      folds.length,
    gates,
    aggregate,
    folds,
    methodology: {
      stockSelection:
        "daily priceVolume Top1",
      marketBenchmark:
        "same-day equal-weight average return of all replay stocks",
      regimeThresholds:
        "computed from training dates only",
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
      "DECIDE_ALPHA_V2_MARKET_GATE_POLICY",
  };

  fs.writeFileSync(
    path.join(
      root,
      "logs",
      "alpha-v2-top1-market-excess-regime-gate-walk-forward.json",
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
        dateCount:
          result.dateCount,
        foldCount:
          result.foldCount,
        aggregate:
          result.aggregate,
        folds:
          result.folds.map(
            (fold: any) => ({
              fold:
                fold.fold,
              testStart:
                fold.testStart,
              testEnd:
                fold.testEnd,
              regimeThresholds:
                fold.regimeThresholds,
              testResults:
                fold.testResults,
            }),
          ),
        nextGate:
          result.nextGate,
        outputFile:
          "logs/alpha-v2-top1-market-excess-regime-gate-walk-forward.json",
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
            "ALPHA_V2_TOP1_MARKET_EXCESS_REGIME_GATE_WALK_FORWARD_FAILED",
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
