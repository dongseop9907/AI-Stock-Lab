import fs from "node:fs";
import path from "node:path";
import { createSupabaseServerClient } from "../lib/supabase";

function avg(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function kstDateHour(iso: string) {
  const d = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  return { date: d.toISOString().slice(0, 10), hour: d.getUTCHours() };
}

function pvScore(row: any): number | null {
  const dim = (row.dimensions ?? []).find((x: any) => x.dimension === "priceVolume");
  const effective = Number(dim?.effectiveScore);
  const quality = Number(row.quality);
  if (!Number.isFinite(effective) || !Number.isFinite(quality)) return null;
  return 0.5 + (effective - 0.5) * quality;
}

function evaluate(rows: any[], threshold: number) {
  const selected = rows.filter((r) => Number.isFinite(r.v2Score) && r.v2Score >= threshold);
  const vals = (key: string) => selected.map((r) => r[key]).filter(Number.isFinite);
  const r1 = avg(vals("r1"));
  const r3 = avg(vals("r3"));
  const r5 = avg(vals("r5"));
  return {
    threshold,
    selectedCount: selected.length,
    selectedRate: rows.length ? selected.length / rows.length : 0,
    meanReturn: { r1, r3, r5 },
    objective: (r1 ?? 0) * 0.30 + (r3 ?? 0) * 0.40 + (r5 ?? 0) * 0.30,
  };
}

async function main() {
  const root = process.cwd();
  const replay = JSON.parse(
    fs.readFileSync(
      path.join(root, "logs", "alpha-v1-alpha-only-historical-replay-read-only.json"),
      "utf8",
    ),
  );

  const baseRows = (replay.replay ?? []).flatMap((day: any) =>
    (day.rawRanking ?? []).map((row: any) => ({
      date: day.date,
      decisionAt: day.decisionAt,
      stockCode: row.stockCode,
      quality: Number(row.quality),
      dimensions: row.dimensions ?? [],
    })),
  );

  const stockCodes = [...new Set(baseRows.map((r: any) => r.stockCode))];

  const { data, error } = await createSupabaseServerClient()
    .from("market_daily_bars")
    .select("stock_code,trading_date,open_price,close_price,adjusted_price")
    .in("stock_code", stockCodes)
    .eq("adjusted_price", true)
    .gte("trading_date", "2026-07-30")
    .lte("trading_date", "2026-10-31")
    .order("stock_code")
    .order("trading_date")
    .limit(10000);

  if (error) throw error;

  const barsByStock = new Map<string, any[]>();
  for (const bar of data ?? []) {
    const open = Number(bar.open_price);
    const close = Number(bar.close_price);
    if (!Number.isFinite(open) || !Number.isFinite(close) || open <= 0 || close <= 0) continue;
    const code = String(bar.stock_code);
    const arr = barsByStock.get(code) ?? [];
    arr.push({ date: String(bar.trading_date), open, close });
    barsByStock.set(code, arr);
  }

  const labeled = baseRows.map((row: any) => {
    const score = pvScore(row);
    if (score === null) return null;

    const kst = kstDateHour(row.decisionAt);
    const future = (barsByStock.get(row.stockCode) ?? []).filter((bar) =>
      kst.hour < 9 ? bar.date >= kst.date : bar.date > kst.date,
    );

    const entry = future[0];
    if (!entry) return null;

    const b3 = future[2];
    const b5 = future[4];

    return {
      ...row,
      v2Score: score,
      r1: entry.close / entry.open - 1,
      r3: b3 ? b3.close / entry.open - 1 : null,
      r5: b5 ? b5.close / entry.open - 1 : null,
    };
  }).filter(Boolean) as any[];

  const dates = [...new Set(labeled.map((r: any) => r.date))].sort() as string[];
  const thresholds = Array.from({ length: 13 }, (_, i) => Number((0.40 + i * 0.025).toFixed(3)));

  const folds: any[] = [];
  const minimumTrainDates = 10;
  const testBlockSize = 4;

  for (let testStart = minimumTrainDates; testStart < dates.length; testStart += testBlockSize) {
    const trainDates = dates.slice(0, testStart);
    const testDates = dates.slice(testStart, Math.min(dates.length, testStart + testBlockSize));
    if (!testDates.length) continue;

    const trainRows = labeled.filter((r: any) => trainDates.includes(r.date));
    const testRows = labeled.filter((r: any) => testDates.includes(r.date));
    const minimumSelected = Math.max(5, Math.ceil(trainRows.length * 0.15));

    const candidates = thresholds
      .map((t) => evaluate(trainRows, t))
      .filter((x) =>
        x.selectedCount >= minimumSelected &&
        x.meanReturn.r1 !== null &&
        x.meanReturn.r3 !== null &&
        x.meanReturn.r5 !== null
      )
      .sort((a, b) => b.objective - a.objective);

    const chosen = candidates[0] ?? evaluate(trainRows, 0.5);
    folds.push({
      fold: folds.length + 1,
      trainDateCount: trainDates.length,
      testStart: testDates[0],
      testEnd: testDates.at(-1),
      chosenTrain: chosen,
      test: evaluate(testRows, chosen.threshold),
      fixed068Test: evaluate(testRows, 0.68),
    });
  }

  const chosenThresholds = folds.map((f) => f.chosenTrain.threshold);
  const scoreValues = labeled.map((r: any) => r.v2Score);

  const result = {
    status: "ALPHA_V2_PRICE_VOLUME_THRESHOLD_WALK_FORWARD_COMPLETE",
    scoreDefinition: "0.5 + (priceVolumeEffectiveScore - 0.5) * quality",
    dateCount: dates.length,
    labeledRows: labeled.length,
    scoreDistribution: {
      min: Math.min(...scoreValues),
      avg: avg(scoreValues),
      max: Math.max(...scoreValues),
    },
    thresholdGrid: thresholds,
    foldCount: folds.length,
    chosenThresholds,
    averageChosenThreshold: avg(chosenThresholds),
    aggregateTest: {
      selectedCount: folds.reduce((sum, f) => sum + f.test.selectedCount, 0),
      meanReturn: {
        r1: avg(folds.map((f) => f.test.meanReturn.r1).filter(Number.isFinite)),
        r3: avg(folds.map((f) => f.test.meanReturn.r3).filter(Number.isFinite)),
        r5: avg(folds.map((f) => f.test.meanReturn.r5).filter(Number.isFinite)),
      },
    },
    folds,
    productionChanged: false,
    safety: {
      databaseReadsOnly: true,
      databaseWrites: 0,
      ordersCreated: 0,
      positionsChanged: 0,
    },
    nextGate: "DECIDE_ALPHA_V2_PRICE_VOLUME_THRESHOLD",
  };

  fs.writeFileSync(
    path.join(root, "logs", "alpha-v2-pricevolume-threshold-walk-forward.json"),
    JSON.stringify(result, null, 2) + "\n",
    "utf8",
  );

  console.log(JSON.stringify({
    status: result.status,
    dateCount: result.dateCount,
    labeledRows: result.labeledRows,
    scoreDistribution: result.scoreDistribution,
    foldCount: result.foldCount,
    chosenThresholds: result.chosenThresholds,
    averageChosenThreshold: result.averageChosenThreshold,
    aggregateTest: result.aggregateTest,
    folds: result.folds.map((fold: any) => ({
      fold: fold.fold,
      trainDateCount: fold.trainDateCount,
      testStart: fold.testStart,
      testEnd: fold.testEnd,
      chosenThreshold: fold.chosenTrain.threshold,
      trainSelectedCount: fold.chosenTrain.selectedCount,
      trainObjective: fold.chosenTrain.objective,
      testSelectedCount: fold.test.selectedCount,
      testMeanReturn: fold.test.meanReturn,
      fixed068SelectedCount: fold.fixed068Test.selectedCount,
    })),
    nextGate: result.nextGate,
    outputFile: "logs/alpha-v2-pricevolume-threshold-walk-forward.json",
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    status: "ALPHA_V2_PRICE_VOLUME_THRESHOLD_WALK_FORWARD_FAILED",
    error: String(error instanceof Error ? error.message : error),
    databaseWrites: 0,
    ordersCreated: 0,
  }, null, 2));
  process.exitCode = 2;
});
