import fs from "node:fs";
import path from "node:path";

import {
  createSupabaseServerClient,
} from "../lib/supabase";

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function annualizedVolatility(closes: number[]): number | null {
  if (closes.length < 21) return null;

  const returns: number[] = [];

  for (let i = 1; i < closes.length; i += 1) {
    const previous = closes[i - 1];
    const current = closes[i];

    if (previous <= 0 || current <= 0) continue;

    returns.push(current / previous - 1);
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

function summarize(
  code: string,
  rows: any[],
) {
  const normalized =
    rows
      .map((row) => ({
        date: String(row.trading_date),
        close: toNumber(row.close_value),
      }))
      .filter(
        (row): row is { date: string; close: number } =>
          row.close !== null,
      )
      .sort((a, b) =>
        a.date.localeCompare(b.date),
      );

  const closes =
    normalized.map((row) => row.close);

  const returns: number[] = [];

  for (let i = 1; i < closes.length; i += 1) {
    if (closes[i - 1] > 0 && closes[i] > 0) {
      returns.push(
        closes[i] / closes[i - 1] - 1,
      );
    }
  }

  const minReturn =
    returns.length
      ? Math.min(...returns)
      : null;

  const maxReturn =
    returns.length
      ? Math.max(...returns)
      : null;

  return {
    code,
    rows: normalized.length,
    firstDate:
      normalized[0]?.date ?? null,
    lastDate:
      normalized.at(-1)?.date ?? null,
    firstClose:
      normalized[0]?.close ?? null,
    lastClose:
      normalized.at(-1)?.close ?? null,
    minClose:
      closes.length
        ? Math.min(...closes)
        : null,
    maxClose:
      closes.length
        ? Math.max(...closes)
        : null,
    minDailyReturn:
      minReturn,
    maxDailyReturn:
      maxReturn,
    annualizedVol20:
      annualizedVolatility(closes),
    suspicious:
      closes.some((value) => value <= 0) ||
      returns.some((value) => Math.abs(value) > 0.30),
  };
}

async function main() {
  const root = process.cwd();

  const sourcePath =
    path.resolve(
      root,
      "lib/market/get-current-market-regime-features-v7.ts",
    );

  const source =
    fs.readFileSync(
      sourcePath,
      "utf8",
    );

  const querySurface =
    source.slice(
      source.indexOf("const {"),
      source.indexOf(
        "const indexRows",
      ),
    );

  const tableMatch =
    querySurface.match(
      /\.from\(\s*["']([^"']+)["']\s*\)/s,
    );

  if (!tableMatch) {
    throw new Error(
      "INDEX_TABLE_NAME_NOT_FOUND",
    );
  }

  const tableName =
    tableMatch[1];

  const supabase =
    createSupabaseServerClient();

  const summaries = [];

  for (const code of [
    "KOSPI",
    "KOSDAQ",
  ]) {
    const {
      data,
      error,
    } =
      await (supabase as any)
        .from(tableName)
        .select(
          "market_code,trading_date,close_value",
        )
        .eq(
          "market_code",
          code,
        )
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
        data ?? [],
      ),
    );
  }

  const sourceLooksSane =
    summaries.every(
      (summary) =>
        summary.rows >= 21 &&
        !summary.suspicious &&
        summary.firstClose !== null &&
        summary.lastClose !== null,
    );

  const output = {
    status:
      "MARKET_REGIME_V7_INDEX_SERIES_SANITY_AUDIT_V1_COMPLETE",

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
    },

    fullDetails:
      "logs/market-regime-v7-index-series-sanity-audit-v1.json",

    nextGate:
      sourceLooksSane
        ? "FREEZE_CURRENT_V7_AND_DESIGN_V7_X_REWORK_WITH_PREDECLARED_CALIBRATION"
        : "INVESTIGATE_INDEX_SOURCE_DATA",
  };

  fs.mkdirSync(
    path.resolve(
      root,
      "logs",
    ),
    {
      recursive: true,
    },
  );

  fs.writeFileSync(
    path.resolve(
      root,
      output.fullDetails,
    ),
    JSON.stringify(
      output,
      null,
      2,
    ) + "\n",
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        status:
          output.status,
        table:
          output.tableName,
        series:
          output.summaries,
        classification:
          output.classification,
        nextGate:
          output.nextGate,
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
            "MARKET_REGIME_V7_INDEX_SERIES_SANITY_AUDIT_V1_ERROR",
          error:
            error instanceof Error
              ? error.message
              : String(error),
        },
        null,
        2,
      ),
    );

    process.exitCode = 1;
  },
);
