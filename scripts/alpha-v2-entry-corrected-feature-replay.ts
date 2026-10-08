import fs from "node:fs";
import path from "node:path";
import { createSupabaseServerClient } from "../lib/supabase";
import { getActiveEntryThreshold } from "../lib/trading/get-active-entry-threshold";

function clamp(v: number) {
  return Math.min(1, Math.max(0, v));
}

function toNumber(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function avg(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function normalizeThreshold(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;

    for (const key of [
      "threshold",
      "scoreThreshold",
      "entryScoreThreshold",
      "value",
    ]) {
      const n = Number(row[key]);
      if (Number.isFinite(n)) return n;
    }
  }

  throw new Error(`UNSUPPORTED_ENTRY_THRESHOLD_SHAPE:${JSON.stringify(value)}`);
}

function kstDate(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function correctedSignal(
  snapshots: any[],
  threshold: number,
) {
  const sorted = [...snapshots].sort(
    (a, b) =>
      new Date(a.observed_at).getTime() -
      new Date(b.observed_at).getTime(),
  );

  if (sorted.length < 2) {
    return null;
  }

  const latest = sorted.at(-1);
  const previous = sorted.at(-2);

  const latestClose = toNumber(latest.close_price);
  const previousClose = toNumber(previous.close_price);

  if (
    latestClose === null ||
    previousClose === null ||
    latestClose <= 0 ||
    previousClose <= 0
  ) {
    return null;
  }

  const latestOpen = toNumber(latest.open_price);
  const latestHigh = toNumber(latest.high_price);
  const latestLow = toNumber(latest.low_price);

  const momentumRate =
    latestClose / previousClose - 1;

  const intradayRate =
    latestOpen !== null && latestOpen > 0
      ? latestClose / latestOpen - 1
      : 0;

  const rangePosition =
    latestHigh !== null &&
    latestLow !== null &&
    latestHigh > latestLow
      ? clamp(
          (latestClose - latestLow) /
            (latestHigh - latestLow),
        )
      : 0.5;

  const cumulativeVolumes = sorted
    .map((row) => toNumber(row.volume));

  const intervalDeltas: number[] = [];

  for (let i = 1; i < cumulativeVolumes.length; i += 1) {
    const cur = cumulativeVolumes[i];
    const prev = cumulativeVolumes[i - 1];

    if (
      cur !== null &&
      prev !== null &&
      cur >= prev
    ) {
      intervalDeltas.push(cur - prev);
    }
  }

  const latestDelta =
    intervalDeltas.length
      ? intervalDeltas.at(-1)!
      : null;

  const previousDeltas =
    intervalDeltas.slice(
      Math.max(0, intervalDeltas.length - 6),
      -1,
    );

  const previousDeltaAvg =
    avg(previousDeltas);

  const volumeRatio =
    latestDelta !== null &&
    previousDeltaAvg !== null &&
    previousDeltaAvg > 0
      ? latestDelta / previousDeltaAvg
      : 1;

  const momentumScore = clamp(
    (momentumRate + 0.01) / 0.03,
  );

  const intradayScore = clamp(
    (intradayRate + 0.01) / 0.025,
  );

  const rangeScore = clamp(
    rangePosition,
  );

  const volumeScore = clamp(
    (volumeRatio - 0.8) / 1.2,
  );

  const score =
    momentumScore * 0.4 +
    intradayScore * 0.25 +
    rangeScore * 0.2 +
    volumeScore * 0.15;

  const qualifies =
    score >= threshold &&
    momentumRate > 0 &&
    intradayRate > -0.005;

  return {
    observedAt: latest.observed_at,
    entryPrice: latestClose,
    score,
    qualifies,
    features: {
      snapshotCount: sorted.length,
      momentumRate,
      intradayRate,
      rangePosition,
      latestVolumeDelta: latestDelta,
      previousVolumeDeltaAverage: previousDeltaAvg,
      volumeRatio,
      momentumScore,
      intradayScore,
      rangeScore,
      volumeScore,
    },
  };
}

async function main() {
  const root = process.cwd();

  const priorReplay = JSON.parse(
    fs.readFileSync(
      path.join(
        root,
        "logs",
        "alpha-v2-target-session-entry-replay.json",
      ),
      "utf8",
    ),
  );

  const threshold = normalizeThreshold(
    await getActiveEntryThreshold(),
  );

  const sessions = (priorReplay.results ?? []).map(
    (row: any) => ({
      alphaDate: String(row.alphaDate),
      stockCode: String(row.stockCode),
      targetSessionDate: String(row.targetSessionDate),
      alphaV2Score: Number(row.alphaV2Score),
      oldEntryQualified: Boolean(row.entryQualified),
      oldActualEntryReturn: row.actualEntryReturn,
      oldSessionOpenBaseline: row.sessionOpenBaseline,
    }),
  );

  const stockCodes = [
    ...new Set(sessions.map((s: any) => s.stockCode)),
  ];

  const dates = sessions
    .map((s: any) => s.targetSessionDate)
    .sort();

  const firstDate = dates[0];
  const lastDate = dates.at(-1)!;

  const supabase = createSupabaseServerClient();

  const {
    data: snapshots,
    error: snapshotError,
  } = await supabase
    .from("market_snapshots")
    .select(
      "stock_code,observed_at,open_price,high_price,low_price,close_price,volume",
    )
    .in("stock_code", stockCodes)
    .gte("observed_at", `${firstDate}T00:00:00+09:00`)
    .lte("observed_at", `${lastDate}T23:59:59+09:00`)
    .order("observed_at", { ascending: true })
    .limit(100000);

  if (snapshotError) throw snapshotError;

  const bySession = new Map<string, any[]>();

  for (const row of snapshots ?? []) {
    const key =
      `${String(row.stock_code)}|${kstDate(String(row.observed_at))}`;

    const arr = bySession.get(key) ?? [];
    arr.push(row);
    bySession.set(key, arr);
  }

  const {
    data: bars,
    error: barError,
  } = await supabase
    .from("market_daily_bars")
    .select(
      "stock_code,trading_date,open_price,close_price,adjusted_price",
    )
    .in("stock_code", stockCodes)
    .eq("adjusted_price", true)
    .gte("trading_date", firstDate)
    .lte("trading_date", "2026-10-31")
    .order("stock_code")
    .order("trading_date")
    .limit(10000);

  if (barError) throw barError;

  const barsByStock = new Map<string, any[]>();

  for (const row of bars ?? []) {
    const open = Number(row.open_price);
    const close = Number(row.close_price);

    if (
      !Number.isFinite(open) ||
      !Number.isFinite(close) ||
      open <= 0 ||
      close <= 0
    ) {
      continue;
    }

    const code = String(row.stock_code);
    const arr = barsByStock.get(code) ?? [];

    arr.push({
      date: String(row.trading_date),
      open,
      close,
    });

    barsByStock.set(code, arr);
  }

  const results = sessions.map((session: any) => {
    const key =
      `${session.stockCode}|${session.targetSessionDate}`;

    const rows = [...(bySession.get(key) ?? [])].sort(
      (a, b) =>
        new Date(a.observed_at).getTime() -
        new Date(b.observed_at).getTime(),
    );

    let firstQualified: any = null;
    let lastSignal: any = null;

    for (let i = 0; i < rows.length; i += 1) {
      const signal = correctedSignal(
        rows.slice(0, i + 1),
        threshold,
      );

      if (signal) {
        lastSignal = signal;
      }

      if (signal?.qualifies) {
        firstQualified = signal;
        break;
      }
    }

    const forward = (barsByStock.get(session.stockCode) ?? [])
      .filter(
        (bar: any) =>
          bar.date >= session.targetSessionDate,
      );

    const b1 = forward[0];
    const b3 = forward[2];
    const b5 = forward[4];

    const entryPrice =
      firstQualified?.entryPrice ?? null;

    const ret = (bar: any) =>
      entryPrice && entryPrice > 0 && bar
        ? bar.close / entryPrice - 1
        : null;

    return {
      ...session,
      snapshotCount: rows.length,
      correctedEntryQualified: Boolean(firstQualified),
      correctedFirstQualified: firstQualified,
      correctedLastSignal: lastSignal,
      correctedActualEntryReturn: {
        r1: ret(b1),
        r3: ret(b3),
        r5: ret(b5),
      },
    };
  });

  const correctedQualified = results.filter(
    (r: any) => r.correctedEntryQualified,
  );

  const meanReturn = (source: string, horizon: string) =>
    avg(
      correctedQualified
        .map((r: any) => r[source]?.[horizon])
        .filter(Number.isFinite),
    );

  const report = {
    status:
      "ALPHA_V2_ENTRY_CORRECTED_FEATURE_REPLAY_COMPLETE",

    entryScoreThreshold: threshold,

    changesUnderTest: {
      minimumSnapshots: 2,
      momentum:
        "latest close vs previous snapshot close only; no open-price fallback",
      volume:
        "cumulative volume converted to interval delta; latest delta compared with prior interval-delta average",
      productionChanged: false,
    },

    counts: {
      targetSessions: results.length,
      oldQualifiedSessions:
        results.filter(
          (r: any) => r.oldEntryQualified,
        ).length,
      correctedQualifiedSessions:
        correctedQualified.length,
    },

    correctedQualificationRate:
      results.length
        ? correctedQualified.length / results.length
        : null,

    correctedActualEntryReturn: {
      r1: meanReturn("correctedActualEntryReturn", "r1"),
      r3: meanReturn("correctedActualEntryReturn", "r3"),
      r5: meanReturn("correctedActualEntryReturn", "r5"),
    },

    sameCorrectedSessionsOpenBaseline: {
      r1: avg(
        correctedQualified
          .map((r: any) => r.oldSessionOpenBaseline?.r1)
          .filter(Number.isFinite),
      ),
      r3: avg(
        correctedQualified
          .map((r: any) => r.oldSessionOpenBaseline?.r3)
          .filter(Number.isFinite),
      ),
      r5: avg(
        correctedQualified
          .map((r: any) => r.oldSessionOpenBaseline?.r5)
          .filter(Number.isFinite),
      ),
    },

    results,

    safety: {
      databaseReadsOnly: true,
      databaseWrites: 0,
      ordersCreated: 0,
      positionsChanged: 0,
    },

    nextGate:
      correctedQualified.length >= 2
        ? "COMPARE_CORRECTED_ENTRY_VS_BASELINE"
        : "ENTRY_V2_THRESHOLD_OR_FEATURE_CALIBRATION_REQUIRED",
  };

  fs.writeFileSync(
    path.join(
      root,
      "logs",
      "alpha-v2-entry-corrected-feature-replay.json",
    ),
    JSON.stringify(report, null, 2) + "\n",
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        status: report.status,
        entryScoreThreshold: report.entryScoreThreshold,
        changesUnderTest: report.changesUnderTest,
        counts: report.counts,
        correctedQualificationRate:
          report.correctedQualificationRate,
        correctedActualEntryReturn:
          report.correctedActualEntryReturn,
        sameCorrectedSessionsOpenBaseline:
          report.sameCorrectedSessionsOpenBaseline,
        results: report.results,
        nextGate: report.nextGate,
        outputFile:
          "logs/alpha-v2-entry-corrected-feature-replay.json",
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status:
          "ALPHA_V2_ENTRY_CORRECTED_FEATURE_REPLAY_FAILED",
        error: String(
          error instanceof Error
            ? error.message
            : error,
        ),
        databaseWrites: 0,
        ordersCreated: 0,
      },
      null,
      2,
    ),
  );

  process.exitCode = 2;
});
