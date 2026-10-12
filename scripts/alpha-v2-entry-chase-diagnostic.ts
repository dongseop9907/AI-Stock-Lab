import fs from "node:fs";
import path from "node:path";

import {
  createSupabaseServerClient,
} from "../lib/supabase";

function avg(values: number[]): number | null {
  return values.length
    ? values.reduce((a, b) => a + b, 0) / values.length
    : null;
}

function summarize(rows: any[]) {
  const horizons = ["r1", "r3", "r5"] as const;

  const meanReturn: Record<string, number | null> = {};
  const positiveRate: Record<string, number | null> = {};

  for (const horizon of horizons) {
    const values = rows
      .map((row) => row.correctedEntry?.returns?.[horizon])
      .filter(Number.isFinite) as number[];

    meanReturn[horizon] = avg(values);

    positiveRate[horizon] = values.length
      ? values.filter((value) => value > 0).length / values.length
      : null;
  }

  return {
    selectedSessions: rows.length,
    meanReturn,
    positiveRate,
    averageDelayMinutes:
      avg(
        rows
          .map((row) => row.delayMinutes)
          .filter(Number.isFinite),
      ),
    averageEntryPremiumOverOpen:
      avg(
        rows
          .map((row) => row.entryPremiumOverOpen)
          .filter(Number.isFinite),
      ),
  };
}

async function main() {
  const root = process.cwd();

  const inputPath = path.join(
    root,
    "logs",
    "alpha-v2-expanded-entry-comparison.json",
  );

  if (!fs.existsSync(inputPath)) {
    throw new Error(
      "EXPANDED_ENTRY_COMPARISON_LOG_NOT_FOUND",
    );
  }

  const expanded = JSON.parse(
    fs.readFileSync(inputPath, "utf8"),
  );

  const full381 = (expanded.results ?? [])
    .filter(
      (row: any) =>
        row.snapshotCount === 381,
    );

  if (!full381.length) {
    throw new Error(
      "NO_FULL_381_SESSIONS",
    );
  }

  const stockCodes = [
    ...new Set(
      full381.map(
        (row: any) =>
          String(row.stockCode),
      ),
    ),
  ];

  const sessionDates = full381
    .map(
      (row: any) =>
        String(row.targetSessionDate),
    )
    .sort();

  const supabase =
    createSupabaseServerClient();

  const {
    data,
    error,
  } = await supabase
    .from("market_daily_bars")
    .select(
      "stock_code,trading_date,open_price,adjusted_price",
    )
    .in("stock_code", stockCodes)
    .eq("adjusted_price", true)
    .gte("trading_date", sessionDates[0])
    .lte(
      "trading_date",
      sessionDates.at(-1)!,
    )
    .order("stock_code")
    .order("trading_date")
    .limit(10000);

  if (error) {
    throw error;
  }

  const openByKey =
    new Map<string, number>();

  for (const row of data ?? []) {
    const open = Number(row.open_price);

    if (
      Number.isFinite(open) &&
      open > 0
    ) {
      openByKey.set(
        `${String(row.stock_code)}|${String(row.trading_date)}`,
        open,
      );
    }
  }

  const rows = full381.map(
    (row: any) => {
      const open =
        openByKey.get(
          `${row.stockCode}|${row.targetSessionDate}`,
        ) ?? null;

      const entry =
        row.correctedEntry;

      const observedAt =
        entry?.observedAt ?? null;

      const entryPrice =
        Number(
          entry?.entryPrice,
        );

      const delayMinutes =
        observedAt
          ? (
              new Date(observedAt).getTime() -
              new Date(
                `${row.targetSessionDate}T09:00:00+09:00`,
              ).getTime()
            ) / 60000
          : null;

      const entryPremiumOverOpen =
        open !== null &&
        Number.isFinite(entryPrice) &&
        entryPrice > 0
          ? entryPrice / open - 1
          : null;

      return {
        alphaDate:
          row.alphaDate,

        stockCode:
          row.stockCode,

        targetSessionDate:
          row.targetSessionDate,

        sessionOpen:
          open,

        correctedQualified:
          entry?.qualified === true,

        correctedEntry:
          entry,

        delayMinutes,

        entryPremiumOverOpen,
      };
    },
  );

  const qualified = rows.filter(
    (row: any) =>
      row.correctedQualified &&
      Number.isFinite(row.delayMinutes) &&
      Number.isFinite(row.entryPremiumOverOpen),
  );

  const premiumCaps = [
    0.0025,
    0.005,
    0.0075,
    0.01,
    0.015,
  ];

  const delayCaps = [
    10,
    20,
    30,
    45,
    60,
  ];

  const premiumCapResults =
    premiumCaps.map(
      (cap) => ({
        maxPremium:
          cap,

        ...summarize(
          qualified.filter(
            (row: any) =>
              row.entryPremiumOverOpen <= cap,
          ),
        ),
      }),
    );

  const delayCapResults =
    delayCaps.map(
      (cap) => ({
        maxDelayMinutes:
          cap,

        ...summarize(
          qualified.filter(
            (row: any) =>
              row.delayMinutes <= cap,
          ),
        ),
      }),
    );

  const combinedPolicies = [
    {
      maxDelayMinutes: 20,
      maxPremium: 0.005,
    },
    {
      maxDelayMinutes: 30,
      maxPremium: 0.005,
    },
    {
      maxDelayMinutes: 30,
      maxPremium: 0.0075,
    },
    {
      maxDelayMinutes: 45,
      maxPremium: 0.0075,
    },
    {
      maxDelayMinutes: 60,
      maxPremium: 0.01,
    },
  ].map((policy) => ({
    ...policy,

    ...summarize(
      qualified.filter(
        (row: any) =>
          row.delayMinutes <= policy.maxDelayMinutes &&
          row.entryPremiumOverOpen <= policy.maxPremium,
      ),
    ),
  }));

  const result = {
    status:
      "ALPHA_V2_ENTRY_CHASE_DIAGNOSTIC_COMPLETE",

    counts: {
      full381Sessions:
        rows.length,

      correctedQualifiedSessions:
        qualified.length,

      rejectedSessions:
        rows.length -
        qualified.length,
    },

    baselineCorrectedQualified:
      summarize(
        qualified,
      ),

    premiumCapResults,

    delayCapResults,

    combinedPolicies,

    perSession:
      qualified.map(
        (row: any) => ({
          alphaDate:
            row.alphaDate,

          stockCode:
            row.stockCode,

          targetSessionDate:
            row.targetSessionDate,

          delayMinutes:
            row.delayMinutes,

          entryPremiumOverOpen:
            row.entryPremiumOverOpen,

          entryScore:
            row.correctedEntry?.score ?? null,

          returns:
            row.correctedEntry?.returns ?? null,
        }),
      ),

    interpretationRule: {
      purpose:
        "Diagnose whether Entry underperformance is primarily caused by late/chasing execution.",

      productionThresholdSelectionAllowed:
        false,

      reason:
        "Only 12 full one-minute sessions exist; use this as directional evidence, not final parameter fitting.",
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

      productionChanged:
        false,
    },

    nextGate:
      "DECIDE_IF_ENTRY_V3_SHOULD_ADD_NO_CHASE_AND_MAX_DELAY_POLICY",
  };

  fs.writeFileSync(
    path.join(
      root,
      "logs",
      "alpha-v2-entry-chase-diagnostic.json",
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

        counts:
          result.counts,

        baselineCorrectedQualified:
          result.baselineCorrectedQualified,

        premiumCapResults:
          result.premiumCapResults,

        delayCapResults:
          result.delayCapResults,

        combinedPolicies:
          result.combinedPolicies,

        nextGate:
          result.nextGate,

        outputFile:
          "logs/alpha-v2-entry-chase-diagnostic.json",
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
          "ALPHA_V2_ENTRY_CHASE_DIAGNOSTIC_FAILED",

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
});
