#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VERSION =
  'ALPHA_V1_DAILY_MARKET_SOURCE_PROBE_INSTALLER';

const probe =
  'import fs from "node:fs";\nimport path from "node:path";\n\nimport {\n  createClient,\n  type SupabaseClient,\n} from "@supabase/supabase-js";\n\nconst VERSION =\n  "ALPHA_V1_DAILY_MARKET_SOURCE_PROBE";\n\ntype JsonRecord =\n  Record<string, unknown>;\n\nconst MAX_ROWS =\n  5000;\n\nconst SOURCE_EXTENSIONS =\n  new Set([\n    ".ts",\n    ".tsx",\n    ".js",\n    ".jsx",\n    ".cjs",\n    ".mjs",\n  ]);\n\nconst SKIP_DIRS =\n  new Set([\n    "node_modules",\n    ".next",\n    ".git",\n    "dist",\n    "build",\n    "coverage",\n    "logs",\n  ]);\n\nfunction asString(\n  value: unknown,\n): string | null {\n  if (\n    value === null ||\n    value === undefined\n  ) {\n    return null;\n  }\n\n  const text =\n    String(value).trim();\n\n  return text\n    ? text\n    : null;\n}\n\nfunction asNumber(\n  value: unknown,\n): number | null {\n  if (\n    value === null ||\n    value === undefined\n  ) {\n    return null;\n  }\n\n  const parsed =\n    Number(value);\n\n  return Number.isFinite(parsed)\n    ? parsed\n    : null;\n}\n\nfunction normalizeStockCode(\n  value: unknown,\n): string | null {\n  const text =\n    asString(value);\n\n  if (!text) {\n    return null;\n  }\n\n  const digits =\n    text.replace(\n      /\\D/g,\n      "",\n    );\n\n  if (!digits) {\n    return null;\n  }\n\n  return digits\n    .padStart(6, "0")\n    .slice(-6);\n}\n\nfunction pickFirstKey(\n  row: JsonRecord | undefined,\n  candidates: string[],\n): string | null {\n  if (!row) {\n    return null;\n  }\n\n  for (\n    const key\n    of candidates\n  ) {\n    if (\n      Object.prototype\n        .hasOwnProperty\n        .call(\n          row,\n          key,\n        )\n    ) {\n      return key;\n    }\n  }\n\n  return null;\n}\n\nfunction resolveSupabaseConfig() {\n  const url =\n    process.env\n      .NEXT_PUBLIC_SUPABASE_URL ??\n    process.env\n      .SUPABASE_URL;\n\n  const serviceKey =\n    process.env\n      .SUPABASE_SERVICE_ROLE_KEY ??\n    process.env\n      .SUPABASE_SERVICE_KEY;\n\n  const anonKey =\n    process.env\n      .NEXT_PUBLIC_SUPABASE_ANON_KEY ??\n    process.env\n      .SUPABASE_ANON_KEY;\n\n  const key =\n    serviceKey ??\n    anonKey;\n\n  if (!url) {\n    throw new Error(\n      "SUPABASE_URL_ENV_MISSING",\n    );\n  }\n\n  if (!key) {\n    throw new Error(\n      "SUPABASE_KEY_ENV_MISSING",\n    );\n  }\n\n  return {\n    url,\n    key,\n    authMode:\n      serviceKey\n        ? "SERVICE_ROLE"\n        : "ANON",\n  };\n}\n\nasync function readActiveStocks(\n  supabase: SupabaseClient,\n) {\n  const result =\n    await supabase\n      .from("stocks")\n      .select(\n        "stock_code,stock_name,market,sector,is_active",\n      )\n      .eq(\n        "is_active",\n        true,\n      )\n      .order(\n        "stock_code",\n        {\n          ascending:\n            true,\n        },\n      )\n      .limit(1000);\n\n  if (result.error) {\n    throw new Error(\n      `STOCKS_READ_FAILED:${result.error.message}`,\n    );\n  }\n\n  return (\n    result.data ??\n    []\n  )\n    .map(\n      (\n        row:\n        Record<string, unknown>,\n      ) => ({\n        stockCode:\n          normalizeStockCode(\n            row.stock_code,\n          ),\n\n        stockName:\n          asString(\n            row.stock_name,\n          ),\n\n        market:\n          asString(\n            row.market,\n          ),\n\n        sector:\n          asString(\n            row.sector,\n          ),\n      }),\n    )\n    .filter(\n      (\n        row,\n      ): row is {\n        stockCode: string;\n        stockName: string | null;\n        market: string | null;\n        sector: string | null;\n      } =>\n        Boolean(\n          row.stockCode,\n        ),\n    );\n}\n\nasync function readTable(\n  supabase: SupabaseClient,\n  table: string,\n  stockCodes?: string[],\n) {\n  let query =\n    supabase\n      .from(table)\n      .select("*")\n      .limit(MAX_ROWS);\n\n  if (\n    stockCodes &&\n    stockCodes.length > 0\n  ) {\n    query =\n      query.in(\n        "stock_code",\n        stockCodes,\n      );\n  }\n\n  const result =\n    await query;\n\n  if (result.error) {\n    throw new Error(\n      `${table.toUpperCase()}_READ_FAILED:${result.error.message}`,\n    );\n  }\n\n  return (\n    result.data ??\n    []\n  ) as JsonRecord[];\n}\n\nfunction inferDailyMapping(\n  rows: JsonRecord[],\n) {\n  const sample =\n    rows[0];\n\n  return {\n    stockCodeKey:\n      pickFirstKey(\n        sample,\n        [\n          "stock_code",\n          "stockCode",\n          "symbol",\n        ],\n      ),\n\n    dateKey:\n      pickFirstKey(\n        sample,\n        [\n          "trading_date",\n          "trade_date",\n          "market_date",\n          "date",\n          "stck_bsop_date",\n        ],\n      ),\n\n    openKey:\n      pickFirstKey(\n        sample,\n        [\n          "open_price",\n          "open",\n          "stck_oprc",\n        ],\n      ),\n\n    highKey:\n      pickFirstKey(\n        sample,\n        [\n          "high_price",\n          "high",\n          "stck_hgpr",\n        ],\n      ),\n\n    lowKey:\n      pickFirstKey(\n        sample,\n        [\n          "low_price",\n          "low",\n          "stck_lwpr",\n        ],\n      ),\n\n    closeKey:\n      pickFirstKey(\n        sample,\n        [\n          "close_price",\n          "close",\n          "stck_clpr",\n        ],\n      ),\n\n    volumeKey:\n      pickFirstKey(\n        sample,\n        [\n          "volume",\n          "acml_vol",\n        ],\n      ),\n\n    turnoverKey:\n      pickFirstKey(\n        sample,\n        [\n          "trading_value",\n          "turnover",\n          "acml_tr_pbmn",\n        ],\n      ),\n\n    adjustedKey:\n      pickFirstKey(\n        sample,\n        [\n          "adjusted_price",\n          "is_adjusted",\n          "adjusted",\n        ],\n      ),\n\n    observedAtKey:\n      pickFirstKey(\n        sample,\n        [\n          "observed_at",\n          "updated_at",\n          "created_at",\n        ],\n      ),\n  };\n}\n\nfunction inferIndexMapping(\n  rows: JsonRecord[],\n) {\n  const sample =\n    rows[0];\n\n  return {\n    indexCodeKey:\n      pickFirstKey(\n        sample,\n        [\n          "index_code",\n          "market_code",\n          "symbol",\n          "stock_code",\n        ],\n      ),\n\n    dateKey:\n      pickFirstKey(\n        sample,\n        [\n          "trading_date",\n          "trade_date",\n          "market_date",\n          "date",\n          "stck_bsop_date",\n        ],\n      ),\n\n    closeKey:\n      pickFirstKey(\n        sample,\n        [\n          "close_price",\n          "close",\n          "bstp_nmix_prpr",\n        ],\n      ),\n\n    openKey:\n      pickFirstKey(\n        sample,\n        [\n          "open_price",\n          "open",\n          "bstp_nmix_oprc",\n        ],\n      ),\n\n    highKey:\n      pickFirstKey(\n        sample,\n        [\n          "high_price",\n          "high",\n          "bstp_nmix_hgpr",\n        ],\n      ),\n\n    lowKey:\n      pickFirstKey(\n        sample,\n        [\n          "low_price",\n          "low",\n          "bstp_nmix_lwpr",\n        ],\n      ),\n\n    volumeKey:\n      pickFirstKey(\n        sample,\n        [\n          "volume",\n          "acml_vol",\n        ],\n      ),\n  };\n}\n\nfunction describeDailyCoverage(\n  rows: JsonRecord[],\n  mapping:\n    ReturnType<\n      typeof inferDailyMapping\n    >,\n  stockCodes: string[],\n) {\n  const stockKey =\n    mapping.stockCodeKey;\n\n  const dateKey =\n    mapping.dateKey;\n\n  const closeKey =\n    mapping.closeKey;\n\n  const volumeKey =\n    mapping.volumeKey;\n\n  return stockCodes.map(\n    (stockCode) => {\n      const stockRows =\n        rows\n          .filter(\n            (row) =>\n              stockKey\n                ? normalizeStockCode(\n                    row[\n                      stockKey\n                    ],\n                  ) ===\n                  stockCode\n                : false,\n          )\n          .sort(\n            (a, b) =>\n              String(\n                dateKey\n                  ? b[\n                      dateKey\n                    ] ?? ""\n                  : "",\n              ).localeCompare(\n                String(\n                  dateKey\n                    ? a[\n                        dateKey\n                      ] ?? ""\n                    : "",\n                ),\n              ),\n          );\n\n      return {\n        stockCode,\n\n        rowCount:\n          stockRows.length,\n\n        latestDate:\n          stockRows[0] &&\n          dateKey\n            ? asString(\n                stockRows[0][\n                  dateKey\n                ],\n              )\n            : null,\n\n        oldestDate:\n          stockRows.at(-1) &&\n          dateKey\n            ? asString(\n                stockRows.at(-1)?.[\n                  dateKey\n                ],\n              )\n            : null,\n\n        latestClose:\n          stockRows[0] &&\n          closeKey\n            ? asNumber(\n                stockRows[0][\n                  closeKey\n                ],\n              )\n            : null,\n\n        latestVolume:\n          stockRows[0] &&\n          volumeKey\n            ? asNumber(\n                stockRows[0][\n                  volumeKey\n                ],\n              )\n            : null,\n\n        enoughFor20Day:\n          stockRows.length >=\n          20,\n\n        enoughFor60Day:\n          stockRows.length >=\n          60,\n      };\n    },\n  );\n}\n\nfunction walkSourceFiles(\n  root: string,\n  dir: string,\n  out: string[],\n) {\n  const entries =\n    fs.readdirSync(\n      dir,\n      {\n        withFileTypes:\n          true,\n      },\n    );\n\n  for (\n    const entry\n    of entries\n  ) {\n    if (\n      entry.isDirectory() &&\n      SKIP_DIRS.has(\n        entry.name,\n      )\n    ) {\n      continue;\n    }\n\n    const full =\n      path.join(\n        dir,\n        entry.name,\n      );\n\n    if (\n      entry.isDirectory()\n    ) {\n      walkSourceFiles(\n        root,\n        full,\n        out,\n      );\n\n      continue;\n    }\n\n    if (\n      !entry.isFile()\n    ) {\n      continue;\n    }\n\n    const ext =\n      path\n        .extname(\n          entry.name,\n        )\n        .toLowerCase();\n\n    if (\n      !SOURCE_EXTENSIONS.has(\n        ext,\n      )\n    ) {\n      continue;\n    }\n\n    out.push(\n      path\n        .relative(\n          root,\n          full,\n        )\n        .replaceAll(\n          "\\\\",\n          "/",\n        ),\n    );\n  }\n}\n\nfunction locateV7Sources(\n  root: string,\n) {\n  const files:\n    string[] = [];\n\n  walkSourceFiles(\n    root,\n    root,\n    files,\n  );\n\n  const hits:\n    Array<{\n      file: string;\n      score: number;\n      matched: string[];\n    }> = [];\n\n  const signals = [\n    "BLOCK_BREADTH_OR_HIGH_VOL",\n    "averageVolatility20",\n    "market_index_daily_bars",\n    "market_daily_bars",\n    "breadth20",\n    "kospiReturn20",\n    "kosdaqReturn20",\n  ];\n\n  for (\n    const file\n    of files\n  ) {\n    const full =\n      path.join(\n        root,\n        file,\n      );\n\n    let text:\n      string;\n\n    try {\n      text =\n        fs.readFileSync(\n          full,\n          "utf8",\n        );\n    } catch {\n      continue;\n    }\n\n    const matched =\n      signals.filter(\n        (signal) =>\n          text.includes(\n            signal,\n          ),\n      );\n\n    if (\n      matched.length === 0\n    ) {\n      continue;\n    }\n\n    hits.push({\n      file,\n\n      score:\n        matched.length,\n\n      matched,\n    });\n  }\n\n  return hits\n    .sort(\n      (a, b) =>\n        b.score -\n        a.score ||\n        a.file.localeCompare(\n          b.file,\n        ),\n    )\n    .slice(\n      0,\n      20,\n    );\n}\n\nasync function main() {\n  const root =\n    process.cwd();\n\n  const config =\n    resolveSupabaseConfig();\n\n  const supabase =\n    createClient(\n      config.url,\n      config.key,\n      {\n        auth: {\n          persistSession:\n            false,\n\n          autoRefreshToken:\n            false,\n        },\n      },\n    );\n\n  const stocks =\n    await readActiveStocks(\n      supabase,\n    );\n\n  const stockCodes =\n    stocks.map(\n      (row) =>\n        row.stockCode,\n    );\n\n  const dailyBars =\n    await readTable(\n      supabase,\n      "market_daily_bars",\n      stockCodes,\n    );\n\n  const indexBars =\n    await readTable(\n      supabase,\n      "market_index_daily_bars",\n    );\n\n  const dailyMapping =\n    inferDailyMapping(\n      dailyBars,\n    );\n\n  const indexMapping =\n    inferIndexMapping(\n      indexBars,\n    );\n\n  const dailyFields =\n    [\n      ...new Set(\n        dailyBars\n          .slice(0, 20)\n          .flatMap(\n            (row) =>\n              Object.keys(\n                row,\n              ),\n          ),\n      ),\n    ].sort();\n\n  const indexFields =\n    [\n      ...new Set(\n        indexBars\n          .slice(0, 20)\n          .flatMap(\n            (row) =>\n              Object.keys(\n                row,\n              ),\n          ),\n      ),\n    ].sort();\n\n  const dailyCoverage =\n    describeDailyCoverage(\n      dailyBars,\n      dailyMapping,\n      stockCodes,\n    );\n\n  const v7Sources =\n    locateV7Sources(\n      root,\n    );\n\n  const report = {\n    status:\n      "ALPHA_V1_DAILY_MARKET_SOURCE_PROBE_COMPLETE",\n\n    version:\n      VERSION,\n\n    authMode:\n      config.authMode,\n\n    activeStocks:\n      stocks,\n\n    marketDailyBars: {\n      rowCount:\n        dailyBars.length,\n\n      fieldNames:\n        dailyFields,\n\n      inferredMapping:\n        dailyMapping,\n\n      coverage:\n        dailyCoverage,\n\n      allStocksEnoughFor20Day:\n        dailyCoverage.every(\n          (row) =>\n            row\n              .enoughFor20Day,\n        ),\n\n      allStocksEnoughFor60Day:\n        dailyCoverage.every(\n          (row) =>\n            row\n              .enoughFor60Day,\n        ),\n    },\n\n    marketIndexDailyBars: {\n      rowCount:\n        indexBars.length,\n\n      fieldNames:\n        indexFields,\n\n      inferredMapping:\n        indexMapping,\n\n      sample:\n        indexBars.slice(\n          0,\n          10,\n        ),\n    },\n\n    v7SourceCandidates:\n      v7Sources,\n\n    architecturalDecision: {\n      alphaPriceVolume:\n        "MUST_USE_MARKET_DAILY_BARS_MULTI_DAY_FEATURES",\n\n      entryTiming:\n        "KEEP_MARKET_SNAPSHOTS_INTRADAY_FEATURES",\n\n      alphaMarketRegime:\n        "REUSE_OR_MIRROR_EXISTING_V7_DAILY_BAR_REGIME_NOT_INTRADAY_PROXY",\n\n      thresholdsChanged:\n        false,\n\n      weightsChanged:\n        false,\n    },\n\n    safety: {\n      databaseReads:\n        3,\n\n      databaseWrites:\n        0,\n\n      networkRequests:\n        3,\n\n      ordersCreated:\n        0,\n\n      positionsChanged:\n        0,\n\n      productionDecisionApplied:\n        false,\n    },\n\n    nextGate:\n      "ALPHA_V1_REPLACE_INTRADAY_ALPHA_MARKET_FEATURES_WITH_DAILY_BAR_FEATURES",\n  };\n\n  const outputFile =\n    path.join(\n      root,\n      "logs",\n      "alpha-v1-daily-market-source-probe.json",\n    );\n\n  fs.mkdirSync(\n    path.dirname(\n      outputFile,\n    ),\n    {\n      recursive:\n        true,\n    },\n  );\n\n  fs.writeFileSync(\n    outputFile,\n    JSON.stringify(\n      report,\n      null,\n      2,\n    ) + "\\n",\n    "utf8",\n  );\n\n  console.log(\n    JSON.stringify(\n      report,\n      null,\n      2,\n    ),\n  );\n}\n\nmain().catch(\n  (error) => {\n    console.error(\n      JSON.stringify(\n        {\n          status:\n            "ALPHA_V1_DAILY_MARKET_SOURCE_PROBE_FAILED",\n\n          version:\n            VERSION,\n\n          error:\n            String(\n              error instanceof Error\n                ? error.message\n                : error,\n            ),\n\n          safety: {\n            databaseWrites:\n              0,\n\n            ordersCreated:\n              0,\n\n            productionDecisionApplied:\n              false,\n          },\n        },\n        null,\n        2,\n      ),\n    );\n\n    process.exitCode =\n      2;\n  },\n);\n';

function atomicWrite(
  file,
  content,
) {
  fs.mkdirSync(
    path.dirname(file),
    {
      recursive:
        true,
    },
  );

  const tmp =
    `${file}.tmp-${process.pid}-${Date.now()}`;

  fs.writeFileSync(
    tmp,
    content,
    'utf8',
  );

  fs.renameSync(
    tmp,
    file,
  );
}

try {
  const root =
    path.resolve(
      __dirname,
      '..',
    );

  atomicWrite(
    path.join(
      root,
      'scripts',
      'alpha-v1-daily-market-source-probe.ts',
    ),
    probe,
  );

  console.log(
    JSON.stringify(
      {
        status:
          'ALPHA_V1_DAILY_MARKET_SOURCE_PROBE_INSTALLED',

        version:
          VERSION,

        file:
          'scripts/alpha-v1-daily-market-source-probe.ts',

        reads: [
          'stocks',
          'market_daily_bars',
          'market_index_daily_bars',
          'local_source_files_read_only',
        ],

        safety: {
          databaseWrites:
            0,

          ordersCreated:
            0,

          positionsChanged:
            0,

          productionDecisionApplied:
            false,
        },

        nextAction:
          'RUN_ALPHA_V1_DAILY_MARKET_SOURCE_PROBE',
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    JSON.stringify(
      {
        status:
          'ALPHA_V1_DAILY_MARKET_SOURCE_PROBE_INSTALL_FAILED',

        version:
          VERSION,

        error:
          String(
            error?.message ??
            error,
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
}
