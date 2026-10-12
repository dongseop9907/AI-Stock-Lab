const fs = require("fs");
const path = require("path");

const target = path.resolve(
  process.cwd(),
  "scripts/market-regime-v7-index-series-sanity-audit-v1.ts"
);

fs.mkdirSync(
  path.dirname(target),
  { recursive: true }
);

fs.writeFileSync(
  target,
  "import fs from \"node:fs\";\nimport path from \"node:path\";\n\nimport {\n  createSupabaseServerClient,\n} from \"../lib/supabase\";\n\nfunction toNumber(value: unknown): number | null {\n  if (value === null || value === undefined || value === \"\") {\n    return null;\n  }\n\n  const n = Number(value);\n  return Number.isFinite(n) ? n : null;\n}\n\nfunction annualizedVolatility(closes: number[]): number | null {\n  if (closes.length < 21) return null;\n\n  const returns: number[] = [];\n\n  for (let i = 1; i < closes.length; i += 1) {\n    const previous = closes[i - 1];\n    const current = closes[i];\n\n    if (previous <= 0 || current <= 0) continue;\n\n    returns.push(current / previous - 1);\n  }\n\n  if (returns.length < 20) return null;\n\n  const sample = returns.slice(-20);\n  const mean =\n    sample.reduce((sum, value) => sum + value, 0) /\n    sample.length;\n\n  const variance =\n    sample.reduce(\n      (sum, value) =>\n        sum + Math.pow(value - mean, 2),\n      0,\n    ) / sample.length;\n\n  return Math.sqrt(variance) * Math.sqrt(252);\n}\n\nfunction summarize(\n  code: string,\n  rows: any[],\n) {\n  const normalized =\n    rows\n      .map((row) => ({\n        date: String(row.trading_date),\n        close: toNumber(row.close_value),\n      }))\n      .filter(\n        (row): row is { date: string; close: number } =>\n          row.close !== null,\n      )\n      .sort((a, b) =>\n        a.date.localeCompare(b.date),\n      );\n\n  const closes =\n    normalized.map((row) => row.close);\n\n  const returns: number[] = [];\n\n  for (let i = 1; i < closes.length; i += 1) {\n    if (closes[i - 1] > 0 && closes[i] > 0) {\n      returns.push(\n        closes[i] / closes[i - 1] - 1,\n      );\n    }\n  }\n\n  const minReturn =\n    returns.length\n      ? Math.min(...returns)\n      : null;\n\n  const maxReturn =\n    returns.length\n      ? Math.max(...returns)\n      : null;\n\n  return {\n    code,\n    rows: normalized.length,\n    firstDate:\n      normalized[0]?.date ?? null,\n    lastDate:\n      normalized.at(-1)?.date ?? null,\n    firstClose:\n      normalized[0]?.close ?? null,\n    lastClose:\n      normalized.at(-1)?.close ?? null,\n    minClose:\n      closes.length\n        ? Math.min(...closes)\n        : null,\n    maxClose:\n      closes.length\n        ? Math.max(...closes)\n        : null,\n    minDailyReturn:\n      minReturn,\n    maxDailyReturn:\n      maxReturn,\n    annualizedVol20:\n      annualizedVolatility(closes),\n    suspicious:\n      closes.some((value) => value <= 0) ||\n      returns.some((value) => Math.abs(value) > 0.30),\n  };\n}\n\nasync function main() {\n  const root = process.cwd();\n\n  const sourcePath =\n    path.resolve(\n      root,\n      \"lib/market/get-current-market-regime-features-v7.ts\",\n    );\n\n  const source =\n    fs.readFileSync(\n      sourcePath,\n      \"utf8\",\n    );\n\n  const querySurface =\n    source.slice(\n      source.indexOf(\"const {\"),\n      source.indexOf(\n        \"const indexRows\",\n      ),\n    );\n\n  const tableMatch =\n    querySurface.match(\n      /\\.from\\(\\s*[\"']([^\"']+)[\"']\\s*\\)/s,\n    );\n\n  if (!tableMatch) {\n    throw new Error(\n      \"INDEX_TABLE_NAME_NOT_FOUND\",\n    );\n  }\n\n  const tableName =\n    tableMatch[1];\n\n  const supabase =\n    createSupabaseServerClient();\n\n  const summaries = [];\n\n  for (const code of [\n    \"KOSPI\",\n    \"KOSDAQ\",\n  ]) {\n    const {\n      data,\n      error,\n    } =\n      await (supabase as any)\n        .from(tableName)\n        .select(\n          \"market_code,trading_date,close_value\",\n        )\n        .eq(\n          \"market_code\",\n          code,\n        )\n        .order(\n          \"trading_date\",\n          {\n            ascending: false,\n          },\n        )\n        .limit(80);\n\n    if (error) {\n      throw new Error(\n        `${code}_READ_FAILED:${error.message}`,\n      );\n    }\n\n    summaries.push(\n      summarize(\n        code,\n        data ?? [],\n      ),\n    );\n  }\n\n  const sourceLooksSane =\n    summaries.every(\n      (summary) =>\n        summary.rows >= 21 &&\n        !summary.suspicious &&\n        summary.firstClose !== null &&\n        summary.lastClose !== null,\n    );\n\n  const output = {\n    status:\n      \"MARKET_REGIME_V7_INDEX_SERIES_SANITY_AUDIT_V1_COMPLETE\",\n\n    tableName,\n\n    summaries,\n\n    classification:\n      sourceLooksSane\n        ? \"INDEX_SOURCE_AND_UNITS_LOOK_SANE_DESIGN_CALIBRATION_ISSUE\"\n        : \"INDEX_SOURCE_OR_DATA_REQUIRES_INVESTIGATION\",\n\n    safety: {\n      databaseReads: true,\n      databaseWrites: 0,\n      sourceFilesModified: 0,\n      regimePolicyChanged: false,\n      forwardEvidenceChanged: false,\n      ordersCreated: 0,\n      positionsChanged: 0,\n    },\n\n    fullDetails:\n      \"logs/market-regime-v7-index-series-sanity-audit-v1.json\",\n\n    nextGate:\n      sourceLooksSane\n        ? \"FREEZE_CURRENT_V7_AND_DESIGN_V7_X_REWORK_WITH_PREDECLARED_CALIBRATION\"\n        : \"INVESTIGATE_INDEX_SOURCE_DATA\",\n  };\n\n  fs.mkdirSync(\n    path.resolve(\n      root,\n      \"logs\",\n    ),\n    {\n      recursive: true,\n    },\n  );\n\n  fs.writeFileSync(\n    path.resolve(\n      root,\n      output.fullDetails,\n    ),\n    JSON.stringify(\n      output,\n      null,\n      2,\n    ) + \"\\n\",\n    \"utf8\",\n  );\n\n  console.log(\n    JSON.stringify(\n      {\n        status:\n          output.status,\n        table:\n          output.tableName,\n        series:\n          output.summaries,\n        classification:\n          output.classification,\n        nextGate:\n          output.nextGate,\n      },\n      null,\n      2,\n    ),\n  );\n}\n\nmain().catch(\n  (error) => {\n    console.error(\n      JSON.stringify(\n        {\n          status:\n            \"MARKET_REGIME_V7_INDEX_SERIES_SANITY_AUDIT_V1_ERROR\",\n          error:\n            error instanceof Error\n              ? error.message\n              : String(error),\n        },\n        null,\n        2,\n      ),\n    );\n\n    process.exitCode = 1;\n  },\n);\n",
  "utf8"
);

console.log(JSON.stringify({
  status:
    "MARKET_REGIME_V7_INDEX_SERIES_SANITY_AUDIT_V1_INSTALLED",
  generatedFile:
    "scripts/market-regime-v7-index-series-sanity-audit-v1.ts",
  consoleOutputPolicy:
    "VERY_COMPACT",
  safety: {
    databaseReads: true,
    databaseWrites: 0,
    sourceFilesModified: 0,
    regimePolicyChanged: false
  },
  nextAction:
    "RUN_INDEX_SERIES_SANITY_AUDIT"
}, null, 2));
