import fs from "node:fs";
import path from "node:path";
import { createSupabaseServerClient } from "../lib/supabase";

function avg(values: number[]): number | null {
  return values.length
    ? values.reduce((a, b) => a + b, 0) / values.length
    : null;
}

function kstDateHour(iso: string) {
  const d = new Date(
    new Date(iso).getTime() +
    9 * 60 * 60 * 1000,
  );

  return {
    date: d.toISOString().slice(0, 10),
    hour: d.getUTCHours(),
  };
}

function priceVolumeScore(row: any): number | null {
  const dim = (row.dimensions ?? []).find(
    (item: any) =>
      item.dimension === "priceVolume",
  );

  const effective =
    Number(dim?.effectiveScore);

  const quality =
    Number(row.quality);

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

function evaluateTopK(
  rows: any[],
  topK: number,
) {
  const byDate =
    new Map<string, any[]>();

  for (const row of rows) {
    const arr =
      byDate.get(row.date) ?? [];

    arr.push(row);

    byDate.set(
      row.date,
      arr,
    );
  }

  const selected: any[] = [];

  for (
    const dayRows
    of byDate.values()
  ) {
    const ranked =
      [...dayRows]
        .filter(
          (row) =>
            Number.isFinite(
              row.v2Score,
            ),
        )
        .sort(
          (a, b) =>
            b.v2Score -
            a.v2Score,
        );

    selected.push(
      ...ranked.slice(
        0,
        Math.min(
          topK,
          ranked.length,
        ),
      ),
    );
  }

  const values = (
    key: string,
  ) =>
    selected
      .map(
        (row) =>
          row[key],
      )
      .filter(
        Number.isFinite,
      ) as number[];

  const r1 =
    avg(
      values("r1"),
    );

  const r3 =
    avg(
      values("r3"),
    );

  const r5 =
    avg(
      values("r5"),
    );

  const objective =
    (r1 ?? 0) *
      0.30 +
    (r3 ?? 0) *
      0.40 +
    (r5 ?? 0) *
      0.30;

  return {
    topK,
    dateCount:
      byDate.size,
    selectedCount:
      selected.length,
    meanReturn: {
      r1,
      r3,
      r5,
    },
    positiveReturnRate: {
      r1:
        values("r1").length
          ? values("r1").filter(
              (x) =>
                x > 0,
            ).length /
            values("r1").length
          : null,
      r3:
        values("r3").length
          ? values("r3").filter(
              (x) =>
                x > 0,
            ).length /
            values("r3").length
          : null,
      r5:
        values("r5").length
          ? values("r5").filter(
              (x) =>
                x > 0,
            ).length /
            values("r5").length
          : null,
    },
    objective,
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
      barsByStock.get(
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

    barsByStock.set(
      code,
      arr,
    );
  }

  const labeled =
    baseRows
      .map(
        (row: any) => {
          const score =
            priceVolumeScore(
              row,
            );

          if (
            score === null
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
            v2Score:
              score,
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

  const dates =
    [
      ...new Set(
        labeled.map(
          (row) =>
            row.date,
        ),
      ),
    ].sort() as string[];

  const candidateTopK =
    [
      1,
      2,
      3,
    ];

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
      labeled.filter(
        (row) =>
          trainDates.includes(
            row.date,
          ),
      );

    const testRows =
      labeled.filter(
        (row) =>
          testDates.includes(
            row.date,
          ),
      );

    const trainCandidates =
      candidateTopK
        .map(
          (topK) =>
            evaluateTopK(
              trainRows,
              topK,
            ),
        )
        .sort(
          (a, b) =>
            b.objective -
            a.objective,
        );

    const chosen =
      trainCandidates[0];

    folds.push({
      fold:
        folds.length + 1,
      trainDateCount:
        trainDates.length,
      testStart:
        testDates[0],
      testEnd:
        testDates.at(-1),
      testDateCount:
        testDates.length,
      chosenTopK:
        chosen.topK,
      trainObjective:
        chosen.objective,
      test:
        evaluateTopK(
          testRows,
          chosen.topK,
        ),
      fixedTop1:
        evaluateTopK(
          testRows,
          1,
        ),
      fixedTop2:
        evaluateTopK(
          testRows,
          2,
        ),
    });
  }

  const chosenCounts:
    Record<
      string,
      number
    > = {};

  for (
    const fold
    of folds
  ) {
    const key =
      `TOP_${fold.chosenTopK}`;

    chosenCounts[key] =
      (
        chosenCounts[key] ??
        0
      ) + 1;
  }

  const aggregate = (
    key:
      | "test"
      | "fixedTop1"
      | "fixedTop2",
  ) => ({
    meanReturn: {
      r1:
        avg(
          folds
            .map(
              (fold) =>
                fold[key]
                  .meanReturn
                  .r1,
            )
            .filter(
              Number.isFinite,
            ),
        ),
      r3:
        avg(
          folds
            .map(
              (fold) =>
                fold[key]
                  .meanReturn
                  .r3,
            )
            .filter(
              Number.isFinite,
            ),
        ),
      r5:
        avg(
          folds
            .map(
              (fold) =>
                fold[key]
                  .meanReturn
                  .r5,
            )
            .filter(
              Number.isFinite,
            ),
        ),
    },
    meanObjective:
      avg(
        folds
          .map(
            (fold) =>
              fold[key]
                .objective,
          )
          .filter(
            Number.isFinite,
          ),
      ),
  });

  const result = {
    status:
      "ALPHA_V2_PRICE_VOLUME_RANK_WALK_FORWARD_COMPLETE",
    dateCount:
      dates.length,
    labeledRows:
      labeled.length,
    candidateTopK,
    foldCount:
      folds.length,
    chosenCounts,
    aggregateAdaptiveTopK:
      aggregate(
        "test",
      ),
    aggregateFixedTop1:
      aggregate(
        "fixedTop1",
      ),
    aggregateFixedTop2:
      aggregate(
        "fixedTop2",
      ),
    folds,
    methodology: {
      absoluteThreshold:
        false,
      dailyCrossSectionalRanking:
        true,
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
      "DECIDE_ALPHA_V2_DAILY_RANK_POLICY",
  };

  fs.writeFileSync(
    path.join(
      root,
      "logs",
      "alpha-v2-pricevolume-rank-walk-forward.json",
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
        labeledRows:
          result.labeledRows,
        foldCount:
          result.foldCount,
        chosenCounts:
          result.chosenCounts,
        aggregateAdaptiveTopK:
          result.aggregateAdaptiveTopK,
        aggregateFixedTop1:
          result.aggregateFixedTop1,
        aggregateFixedTop2:
          result.aggregateFixedTop2,
        folds:
          result.folds.map(
            (fold: any) => ({
              fold:
                fold.fold,
              testStart:
                fold.testStart,
              testEnd:
                fold.testEnd,
              chosenTopK:
                fold.chosenTopK,
              testMeanReturn:
                fold.test
                  .meanReturn,
              fixedTop1MeanReturn:
                fold.fixedTop1
                  .meanReturn,
              fixedTop2MeanReturn:
                fold.fixedTop2
                  .meanReturn,
            }),
          ),
        nextGate:
          result.nextGate,
        outputFile:
          "logs/alpha-v2-pricevolume-rank-walk-forward.json",
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
            "ALPHA_V2_PRICE_VOLUME_RANK_WALK_FORWARD_FAILED",
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
