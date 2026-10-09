import fs from "node:fs";
import path from "node:path";

import {
  createSupabaseServerClient,
} from "../lib/supabase";

type IndexRow = {
  market_code: string;
  trading_date: string;
  close_value: number | string | null;
};

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function annualizedVol20(closes: number[]): number | null {
  if (closes.length < 21) return null;

  const returns: number[] = [];

  for (let i = 1; i < closes.length; i += 1) {
    const prev = closes[i - 1];
    const curr = closes[i];

    if (prev <= 0 || curr <= 0) continue;

    returns.push(curr / prev - 1);
  }

  if (returns.length < 20) return null;

  const sample = returns.slice(-20);

  const mean =
    sample.reduce((sum, value) => sum + value, 0) /
    sample.length;

  const variance =
    sample.reduce(
      (sum, value) =>
        sum + Math.pow(value - mean, 2),
      0,
    ) / sample.length;

  return Math.sqrt(variance) * Math.sqrt(252);
}

function summarize(code: string, rows: IndexRow[]) {
  const normalized =
    rows
      .map((row) => ({
        date: String(row.trading_date),
        close: num(row.close_value),
      }))
      .filter(
        (row): row is { date: string; close: number } =>
          row.close !== null,
      )
      .sort((a, b) => a.date.localeCompare(b.date));

  const closes = normalized.map((row) => row.close);
  const returns: number[] = [];

  for (let i = 1; i < closes.length; i += 1) {
    if (closes[i - 1] > 0 && closes[i] > 0) {
      returns.push(closes[i] / closes[i - 1] - 1);
    }
  }

  const maxAbsDailyReturn =
    returns.length
      ? Math.max(...returns.map((value) => Math.abs(value)))
      : null;

  return {
    code,
    rows: normalized.length,
    firstDate: normalized[0]?.date ?? null,
    lastDate: normalized.at(-1)?.date ?? null,
    firstClose: normalized[0]?.close ?? null,
    lastClose: normalized.at(-1)?.close ?? null,
    minClose: closes.length ? Math.min(...closes) : null,
    maxClose: closes.length ? Math.max(...closes) : null,
    minDailyReturn:
      returns.length ? Math.min(...returns) : null,
    maxDailyReturn:
      returns.length ? Math.max(...returns) : null,
    maxAbsDailyReturn,
    annualizedVol20: annualizedVol20(closes),

    suspicious:
      normalized.length < 21 ||
      closes.some((value) => value <= 0) ||
      (
        maxAbsDailyReturn !== null &&
        maxAbsDailyReturn > 0.30
      ),
  };
}

async function main() {
  const supabase =
    createSupabaseServerClient();

  const tableName =
    "market_index_daily_bars";

  const summaries = [];

  for (const code of ["KOSPI", "KOSDAQ"]) {
    const {
      data,
      error,
    } =
      await supabase
        .from(tableName)
        .select(`
          market_code,
          trading_date,
          close_value
        `)
        .eq("market_code", code)
        .order(
          "trading_date",
          {
            ascending: false,
          },
        )
        .limit(80);

    if (error) {
      throw new Error(
        `${code}_READ_FAILED:${error.message}`,
      );
    }

    summaries.push(
      summarize(
        code,
        (data ?? []) as IndexRow[],
      ),
    );
  }

  const sourceLooksSane =
    summaries.every((summary) =>
      summary.rows >= 21 &&
      !summary.suspicious &&
      summary.firstClose !== null &&
      summary.lastClose !== null,
    );

  const output = {
    status:
      "MARKET_REGIME_V7_INDEX_SERIES_SANITY_AUDIT_V3_COMPLETE",

    tableName,

    summaries,

    classification:
      sourceLooksSane
        ? "INDEX_SOURCE_AND_UNITS_LOOK_SANE_DESIGN_CALIBRATION_ISSUE"
        : "INDEX_SOURCE_OR_DATA_REQUIRES_INVESTIGATION",

    safety: {
      databaseReads: true,
      databaseWrites: 0,
      sourceFilesModified: 0,
      regimePolicyChanged: false,
      forwardEvidenceChanged: false,
      ordersCreated: 0,
      positionsChanged: 0,
      realTradingChanged: false,
    },

    fullDetails:
      "logs/market-regime-v7-index-series-sanity-audit-v3.json",

    nextGate:
      sourceLooksSane
        ? "CLOSE_SEMANTIC_BUG_AUDIT_AND_FREEZE_CURRENT_V7"
        : "INVESTIGATE_INDEX_SOURCE_DATA",
  };

  fs.mkdirSync(
    path.resolve(process.cwd(), "logs"),
    { recursive: true },
  );

  fs.writeFileSync(
    path.resolve(
      process.cwd(),
      output.fullDetails,
    ),
    JSON.stringify(output, null, 2) + "\n",
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        status: output.status,
        table: output.tableName,
        series: output.summaries,
        classification: output.classification,
        nextGate: output.nextGate,
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
          "MARKET_REGIME_V7_INDEX_SERIES_SANITY_AUDIT_V3_ERROR",
        error:
          error instanceof Error
            ? error.message
            : String(error),
        safety: {
          databaseWrites: 0,
          sourceFilesModified: 0,
          ordersCreated: 0,
          positionsChanged: 0,
        },
      },
      null,
      2,
    ),
  );

  process.exitCode = 1;
});
