import fs from "node:fs";
import path from "node:path";

import {
  createClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

const VERSION =
  "ALPHA_V1_DAILY_MARKET_SOURCE_PROBE";

type JsonRecord =
  Record<string, unknown>;

const MAX_ROWS =
  5000;

const SOURCE_EXTENSIONS =
  new Set([
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".cjs",
    ".mjs",
  ]);

const SKIP_DIRS =
  new Set([
    "node_modules",
    ".next",
    ".git",
    "dist",
    "build",
    "coverage",
    "logs",
  ]);

function asString(
  value: unknown,
): string | null {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const text =
    String(value).trim();

  return text
    ? text
    : null;
}

function asNumber(
  value: unknown,
): number | null {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const parsed =
    Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function normalizeStockCode(
  value: unknown,
): string | null {
  const text =
    asString(value);

  if (!text) {
    return null;
  }

  const digits =
    text.replace(
      /\D/g,
      "",
    );

  if (!digits) {
    return null;
  }

  return digits
    .padStart(6, "0")
    .slice(-6);
}

function pickFirstKey(
  row: JsonRecord | undefined,
  candidates: string[],
): string | null {
  if (!row) {
    return null;
  }

  for (
    const key
    of candidates
  ) {
    if (
      Object.prototype
        .hasOwnProperty
        .call(
          row,
          key,
        )
    ) {
      return key;
    }
  }

  return null;
}

function resolveSupabaseConfig() {
  const url =
    process.env
      .NEXT_PUBLIC_SUPABASE_URL ??
    process.env
      .SUPABASE_URL;

  const serviceKey =
    process.env
      .SUPABASE_SERVICE_ROLE_KEY ??
    process.env
      .SUPABASE_SERVICE_KEY;

  const anonKey =
    process.env
      .NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env
      .SUPABASE_ANON_KEY;

  const key =
    serviceKey ??
    anonKey;

  if (!url) {
    throw new Error(
      "SUPABASE_URL_ENV_MISSING",
    );
  }

  if (!key) {
    throw new Error(
      "SUPABASE_KEY_ENV_MISSING",
    );
  }

  return {
    url,
    key,
    authMode:
      serviceKey
        ? "SERVICE_ROLE"
        : "ANON",
  };
}

async function readActiveStocks(
  supabase: SupabaseClient,
) {
  const result =
    await supabase
      .from("stocks")
      .select(
        "stock_code,stock_name,market,sector,is_active",
      )
      .eq(
        "is_active",
        true,
      )
      .order(
        "stock_code",
        {
          ascending:
            true,
        },
      )
      .limit(1000);

  if (result.error) {
    throw new Error(
      `STOCKS_READ_FAILED:${result.error.message}`,
    );
  }

  return (
    result.data ??
    []
  )
    .map(
      (
        row:
        Record<string, unknown>,
      ) => ({
        stockCode:
          normalizeStockCode(
            row.stock_code,
          ),

        stockName:
          asString(
            row.stock_name,
          ),

        market:
          asString(
            row.market,
          ),

        sector:
          asString(
            row.sector,
          ),
      }),
    )
    .filter(
      (
        row,
      ): row is {
        stockCode: string;
        stockName: string | null;
        market: string | null;
        sector: string | null;
      } =>
        Boolean(
          row.stockCode,
        ),
    );
}

async function readTable(
  supabase: SupabaseClient,
  table: string,
  stockCodes?: string[],
) {
  let query =
    supabase
      .from(table)
      .select("*")
      .limit(MAX_ROWS);

  if (
    stockCodes &&
    stockCodes.length > 0
  ) {
    query =
      query.in(
        "stock_code",
        stockCodes,
      );
  }

  const result =
    await query;

  if (result.error) {
    throw new Error(
      `${table.toUpperCase()}_READ_FAILED:${result.error.message}`,
    );
  }

  return (
    result.data ??
    []
  ) as JsonRecord[];
}

function inferDailyMapping(
  rows: JsonRecord[],
) {
  const sample =
    rows[0];

  return {
    stockCodeKey:
      pickFirstKey(
        sample,
        [
          "stock_code",
          "stockCode",
          "symbol",
        ],
      ),

    dateKey:
      pickFirstKey(
        sample,
        [
          "trading_date",
          "trade_date",
          "market_date",
          "date",
          "stck_bsop_date",
        ],
      ),

    openKey:
      pickFirstKey(
        sample,
        [
          "open_price",
          "open",
          "stck_oprc",
        ],
      ),

    highKey:
      pickFirstKey(
        sample,
        [
          "high_price",
          "high",
          "stck_hgpr",
        ],
      ),

    lowKey:
      pickFirstKey(
        sample,
        [
          "low_price",
          "low",
          "stck_lwpr",
        ],
      ),

    closeKey:
      pickFirstKey(
        sample,
        [
          "close_price",
          "close",
          "stck_clpr",
        ],
      ),

    volumeKey:
      pickFirstKey(
        sample,
        [
          "volume",
          "acml_vol",
        ],
      ),

    turnoverKey:
      pickFirstKey(
        sample,
        [
          "trading_value",
          "turnover",
          "acml_tr_pbmn",
        ],
      ),

    adjustedKey:
      pickFirstKey(
        sample,
        [
          "adjusted_price",
          "is_adjusted",
          "adjusted",
        ],
      ),

    observedAtKey:
      pickFirstKey(
        sample,
        [
          "observed_at",
          "updated_at",
          "created_at",
        ],
      ),
  };
}

function inferIndexMapping(
  rows: JsonRecord[],
) {
  const sample =
    rows[0];

  return {
    indexCodeKey:
      pickFirstKey(
        sample,
        [
          "index_code",
          "market_code",
          "symbol",
          "stock_code",
        ],
      ),

    dateKey:
      pickFirstKey(
        sample,
        [
          "trading_date",
          "trade_date",
          "market_date",
          "date",
          "stck_bsop_date",
        ],
      ),

    closeKey:
      pickFirstKey(
        sample,
        [
          "close_price",
          "close",
          "bstp_nmix_prpr",
        ],
      ),

    openKey:
      pickFirstKey(
        sample,
        [
          "open_price",
          "open",
          "bstp_nmix_oprc",
        ],
      ),

    highKey:
      pickFirstKey(
        sample,
        [
          "high_price",
          "high",
          "bstp_nmix_hgpr",
        ],
      ),

    lowKey:
      pickFirstKey(
        sample,
        [
          "low_price",
          "low",
          "bstp_nmix_lwpr",
        ],
      ),

    volumeKey:
      pickFirstKey(
        sample,
        [
          "volume",
          "acml_vol",
        ],
      ),
  };
}

function describeDailyCoverage(
  rows: JsonRecord[],
  mapping:
    ReturnType<
      typeof inferDailyMapping
    >,
  stockCodes: string[],
) {
  const stockKey =
    mapping.stockCodeKey;

  const dateKey =
    mapping.dateKey;

  const closeKey =
    mapping.closeKey;

  const volumeKey =
    mapping.volumeKey;

  return stockCodes.map(
    (stockCode) => {
      const stockRows =
        rows
          .filter(
            (row) =>
              stockKey
                ? normalizeStockCode(
                    row[
                      stockKey
                    ],
                  ) ===
                  stockCode
                : false,
          )
          .sort(
            (a, b) =>
              String(
                dateKey
                  ? b[
                      dateKey
                    ] ?? ""
                  : "",
              ).localeCompare(
                String(
                  dateKey
                    ? a[
                        dateKey
                      ] ?? ""
                    : "",
                ),
              ),
          );

      return {
        stockCode,

        rowCount:
          stockRows.length,

        latestDate:
          stockRows[0] &&
          dateKey
            ? asString(
                stockRows[0][
                  dateKey
                ],
              )
            : null,

        oldestDate:
          stockRows.at(-1) &&
          dateKey
            ? asString(
                stockRows.at(-1)?.[
                  dateKey
                ],
              )
            : null,

        latestClose:
          stockRows[0] &&
          closeKey
            ? asNumber(
                stockRows[0][
                  closeKey
                ],
              )
            : null,

        latestVolume:
          stockRows[0] &&
          volumeKey
            ? asNumber(
                stockRows[0][
                  volumeKey
                ],
              )
            : null,

        enoughFor20Day:
          stockRows.length >=
          20,

        enoughFor60Day:
          stockRows.length >=
          60,
      };
    },
  );
}

function walkSourceFiles(
  root: string,
  dir: string,
  out: string[],
) {
  const entries =
    fs.readdirSync(
      dir,
      {
        withFileTypes:
          true,
      },
    );

  for (
    const entry
    of entries
  ) {
    if (
      entry.isDirectory() &&
      SKIP_DIRS.has(
        entry.name,
      )
    ) {
      continue;
    }

    const full =
      path.join(
        dir,
        entry.name,
      );

    if (
      entry.isDirectory()
    ) {
      walkSourceFiles(
        root,
        full,
        out,
      );

      continue;
    }

    if (
      !entry.isFile()
    ) {
      continue;
    }

    const ext =
      path
        .extname(
          entry.name,
        )
        .toLowerCase();

    if (
      !SOURCE_EXTENSIONS.has(
        ext,
      )
    ) {
      continue;
    }

    out.push(
      path
        .relative(
          root,
          full,
        )
        .replaceAll(
          "\\",
          "/",
        ),
    );
  }
}

function locateV7Sources(
  root: string,
) {
  const files:
    string[] = [];

  walkSourceFiles(
    root,
    root,
    files,
  );

  const hits:
    Array<{
      file: string;
      score: number;
      matched: string[];
    }> = [];

  const signals = [
    "BLOCK_BREADTH_OR_HIGH_VOL",
    "averageVolatility20",
    "market_index_daily_bars",
    "market_daily_bars",
    "breadth20",
    "kospiReturn20",
    "kosdaqReturn20",
  ];

  for (
    const file
    of files
  ) {
    const full =
      path.join(
        root,
        file,
      );

    let text:
      string;

    try {
      text =
        fs.readFileSync(
          full,
          "utf8",
        );
    } catch {
      continue;
    }

    const matched =
      signals.filter(
        (signal) =>
          text.includes(
            signal,
          ),
      );

    if (
      matched.length === 0
    ) {
      continue;
    }

    hits.push({
      file,

      score:
        matched.length,

      matched,
    });
  }

  return hits
    .sort(
      (a, b) =>
        b.score -
        a.score ||
        a.file.localeCompare(
          b.file,
        ),
    )
    .slice(
      0,
      20,
    );
}

async function main() {
  const root =
    process.cwd();

  const config =
    resolveSupabaseConfig();

  const supabase =
    createClient(
      config.url,
      config.key,
      {
        auth: {
          persistSession:
            false,

          autoRefreshToken:
            false,
        },
      },
    );

  const stocks =
    await readActiveStocks(
      supabase,
    );

  const stockCodes =
    stocks.map(
      (row) =>
        row.stockCode,
    );

  const dailyBars =
    await readTable(
      supabase,
      "market_daily_bars",
      stockCodes,
    );

  const indexBars =
    await readTable(
      supabase,
      "market_index_daily_bars",
    );

  const dailyMapping =
    inferDailyMapping(
      dailyBars,
    );

  const indexMapping =
    inferIndexMapping(
      indexBars,
    );

  const dailyFields =
    [
      ...new Set(
        dailyBars
          .slice(0, 20)
          .flatMap(
            (row) =>
              Object.keys(
                row,
              ),
          ),
      ),
    ].sort();

  const indexFields =
    [
      ...new Set(
        indexBars
          .slice(0, 20)
          .flatMap(
            (row) =>
              Object.keys(
                row,
              ),
          ),
      ),
    ].sort();

  const dailyCoverage =
    describeDailyCoverage(
      dailyBars,
      dailyMapping,
      stockCodes,
    );

  const v7Sources =
    locateV7Sources(
      root,
    );

  const report = {
    status:
      "ALPHA_V1_DAILY_MARKET_SOURCE_PROBE_COMPLETE",

    version:
      VERSION,

    authMode:
      config.authMode,

    activeStocks:
      stocks,

    marketDailyBars: {
      rowCount:
        dailyBars.length,

      fieldNames:
        dailyFields,

      inferredMapping:
        dailyMapping,

      coverage:
        dailyCoverage,

      allStocksEnoughFor20Day:
        dailyCoverage.every(
          (row) =>
            row
              .enoughFor20Day,
        ),

      allStocksEnoughFor60Day:
        dailyCoverage.every(
          (row) =>
            row
              .enoughFor60Day,
        ),
    },

    marketIndexDailyBars: {
      rowCount:
        indexBars.length,

      fieldNames:
        indexFields,

      inferredMapping:
        indexMapping,

      sample:
        indexBars.slice(
          0,
          10,
        ),
    },

    v7SourceCandidates:
      v7Sources,

    architecturalDecision: {
      alphaPriceVolume:
        "MUST_USE_MARKET_DAILY_BARS_MULTI_DAY_FEATURES",

      entryTiming:
        "KEEP_MARKET_SNAPSHOTS_INTRADAY_FEATURES",

      alphaMarketRegime:
        "REUSE_OR_MIRROR_EXISTING_V7_DAILY_BAR_REGIME_NOT_INTRADAY_PROXY",

      thresholdsChanged:
        false,

      weightsChanged:
        false,
    },

    safety: {
      databaseReads:
        3,

      databaseWrites:
        0,

      networkRequests:
        3,

      ordersCreated:
        0,

      positionsChanged:
        0,

      productionDecisionApplied:
        false,
    },

    nextGate:
      "ALPHA_V1_REPLACE_INTRADAY_ALPHA_MARKET_FEATURES_WITH_DAILY_BAR_FEATURES",
  };

  const outputFile =
    path.join(
      root,
      "logs",
      "alpha-v1-daily-market-source-probe.json",
    );

  fs.mkdirSync(
    path.dirname(
      outputFile,
    ),
    {
      recursive:
        true,
    },
  );

  fs.writeFileSync(
    outputFile,
    JSON.stringify(
      report,
      null,
      2,
    ) + "\n",
    "utf8",
  );

  console.log(
    JSON.stringify(
      report,
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
            "ALPHA_V1_DAILY_MARKET_SOURCE_PROBE_FAILED",

          version:
            VERSION,

          error:
            String(
              error instanceof Error
                ? error.message
                : error,
            ),

          safety: {
            databaseWrites:
              0,

            ordersCreated:
              0,

            productionDecisionApplied:
              false,
          },
        },
        null,
        2,
      ),
    );

    process.exitCode =
      2;
  },
);
