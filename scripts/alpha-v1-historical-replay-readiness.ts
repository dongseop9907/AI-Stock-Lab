import fs from "node:fs";
import path from "node:path";

import {
  createSupabaseServerClient,
} from "../lib/supabase";

const VERSION =
  "ALPHA_V1_HISTORICAL_REPLAY_READINESS_V1";

const OUTPUT_FILE =
  path.resolve(
    process.cwd(),
    "logs",
    "alpha-v1-historical-replay-readiness.json",
  );

type RangeResult = {
  table: string;
  field: string;
  earliest: string | null;
  latest: string | null;
  available: boolean;
  error: string | null;
};

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
    String(value);

  return text.length >
    0
    ? text
    : null;
}

async function readRange(
  table: string,
  field: string,
): Promise<RangeResult> {
  const supabase =
    createSupabaseServerClient();

  const earliestResult =
    await supabase
      .from(table)
      .select(field)
      .not(
        field,
        "is",
        null,
      )
      .order(
        field,
        {
          ascending:
            true,
        },
      )
      .limit(1)
      .maybeSingle();

  if (
    earliestResult.error
  ) {
    return {
      table,
      field,
      earliest:
        null,
      latest:
        null,
      available:
        false,
      error:
        earliestResult
          .error
          .message,
    };
  }

  const latestResult =
    await supabase
      .from(table)
      .select(field)
      .not(
        field,
        "is",
        null,
      )
      .order(
        field,
        {
          ascending:
            false,
        },
      )
      .limit(1)
      .maybeSingle();

  if (
    latestResult.error
  ) {
    return {
      table,
      field,
      earliest:
        asString(
          earliestResult
            .data?.[field],
        ),
      latest:
        null,
      available:
        false,
      error:
        latestResult
          .error
          .message,
    };
  }

  return {
    table,
    field,

    earliest:
      asString(
        earliestResult
          .data?.[field],
      ),

    latest:
      asString(
        latestResult
          .data?.[field],
      ),

    available:
      Boolean(
        earliestResult
          .data &&
        latestResult
          .data,
      ),

    error:
      null,
  };
}

async function readActiveStockCodes() {
  const supabase =
    createSupabaseServerClient();

  const result =
    await supabase
      .from(
        "stocks",
      )
      .select(
        "stock_code, stock_name, market",
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
      );

  if (
    result.error
  ) {
    throw new Error(
      `ACTIVE_STOCK_READ_FAILED:${result.error.message}`,
    );
  }

  return (
    result.data ??
    []
  ).map(
    (
      row,
    ) => ({
      stockCode:
        String(
          row.stock_code,
        ),

      stockName:
        row.stock_name == null
          ? null
          : String(
              row.stock_name,
            ),

      market:
        row.market == null
          ? null
          : String(
              row.market,
            ),
    }),
  );
}

async function readNthTradingDateForStock(
  stockCode: string,
  nth: number,
) {
  const supabase =
    createSupabaseServerClient();

  const result =
    await supabase
      .from(
        "market_daily_bars",
      )
      .select(
        "trading_date, adjusted_price",
      )
      .eq(
        "stock_code",
        stockCode,
      )
      .eq(
        "adjusted_price",
        true,
      )
      .order(
        "trading_date",
        {
          ascending:
            true,
        },
      )
      .limit(
        nth,
      );

  if (
    result.error
  ) {
    return {
      stockCode,
      rowCount:
        0,
      nthTradingDate:
        null,
      error:
        result.error.message,
    };
  }

  const rows =
    result.data ??
    [];

  return {
    stockCode,
    rowCount:
      rows.length,

    nthTradingDate:
      rows.length >=
        nth
        ? asString(
            rows[nth - 1]
              ?.trading_date,
          )
        : null,

    error:
      null,
  };
}

async function readNthTradingDateForIndex(
  marketCode: string,
  nth: number,
) {
  const supabase =
    createSupabaseServerClient();

  const result =
    await supabase
      .from(
        "market_index_daily_bars",
      )
      .select(
        "trading_date",
      )
      .eq(
        "market_code",
        marketCode,
      )
      .order(
        "trading_date",
        {
          ascending:
            true,
        },
      )
      .limit(
        nth,
      );

  if (
    result.error
  ) {
    return {
      marketCode,
      rowCount:
        0,
      nthTradingDate:
        null,
      error:
        result.error.message,
    };
  }

  const rows =
    result.data ??
    [];

  return {
    marketCode,
    rowCount:
      rows.length,

    nthTradingDate:
      rows.length >=
        nth
        ? asString(
            rows[nth - 1]
              ?.trading_date,
          )
        : null,

    error:
      null,
  };
}

function maxDateLike(
  values:
    Array<
      string |
      null |
      undefined
    >,
) {
  const usable =
    values
      .filter(
        (
          value,
        ): value is string =>
          typeof value ===
            "string" &&
          value.length >
            0,
      )
      .sort();

  return usable.at(-1) ??
    null;
}

function minDateLike(
  values:
    Array<
      string |
      null |
      undefined
    >,
) {
  const usable =
    values
      .filter(
        (
          value,
        ): value is string =>
          typeof value ===
            "string" &&
          value.length >
            0,
      )
      .sort();

  return usable[0] ??
    null;
}

function datePart(
  value:
    string |
    null,
) {
  if (!value) {
    return null;
  }

  return value.slice(
    0,
    10,
  );
}

function scanInvestorPersistenceSources() {
  const roots = [
    path.resolve(
      process.cwd(),
      "lib",
    ),
    path.resolve(
      process.cwd(),
      "app",
    ),
    path.resolve(
      process.cwd(),
      "scripts",
    ),
  ];

  const tablePattern =
    /\.from\(\s*["'`]([^"'`]+)["'`]\s*\)/g;

  const investorPattern =
    /(investor|flow|foreign|institution|수급)/i;

  const hits:
    Array<{
      file: string;
      tables: string[];
    }> =
    [];

  function walk(
    directory: string,
  ) {
    if (
      !fs.existsSync(
        directory,
      )
    ) {
      return;
    }

    for (
      const entry
      of fs.readdirSync(
        directory,
        {
          withFileTypes:
            true,
        },
      )
    ) {
      const full =
        path.join(
          directory,
          entry.name,
        );

      if (
        entry.isDirectory()
      ) {
        if (
          entry.name ===
            "node_modules" ||
          entry.name ===
            ".next"
        ) {
          continue;
        }

        walk(
          full,
        );

        continue;
      }

      if (
        !/\.(ts|tsx|js|cjs|mjs)$/
          .test(
            entry.name,
          )
      ) {
        continue;
      }

      const text =
        fs.readFileSync(
          full,
          "utf8",
        );

      if (
        !investorPattern
          .test(
            text,
          )
      ) {
        continue;
      }

      const tables =
        new Set<string>();

      for (
        const match
        of text.matchAll(
          tablePattern,
        )
      ) {
        const table =
          match[1];

        if (
          investorPattern
            .test(
              table,
            )
        ) {
          tables.add(
            table,
          );
        }
      }

      if (
        tables.size >
        0
      ) {
        hits.push({
          file:
            path.relative(
              process.cwd(),
              full,
            ),

          tables:
            [...tables],
        });
      }
    }
  }

  roots.forEach(
    walk,
  );

  const tables =
    [
      ...new Set(
        hits.flatMap(
          (
            hit,
          ) =>
            hit.tables,
        ),
      ),
    ];

  return {
    tables,
    hits,
  };
}

async function probeCandidateFlowTables(
  tableNames: string[],
) {
  const results:
    Array<{
      table: string;
      exists: boolean;
      error: string | null;
      sampleKeys: string[];
    }> =
    [];

  for (
    const table
    of tableNames
  ) {
    const supabase =
      createSupabaseServerClient();

    const result =
      await supabase
        .from(
          table,
        )
        .select(
          "*",
        )
        .limit(1);

    results.push({
      table,

      exists:
        !result.error,

      error:
        result.error
          ?.message ??
        null,

      sampleKeys:
        result.data?.[0]
          ? Object.keys(
              result.data[0],
            )
          : [],
    });
  }

  return results;
}

async function main() {
  const startedAt =
    new Date()
      .toISOString();

  const [
    predictionGeneratedRange,
    predictionDateRange,
    snapshotRange,
    dailyBarRange,
    indexBarRange,
  ] =
    await Promise.all([
      readRange(
        "ai_stock_predictions",
        "generated_at",
      ),

      readRange(
        "ai_stock_predictions",
        "prediction_date",
      ),

      readRange(
        "market_snapshots",
        "observed_at",
      ),

      readRange(
        "market_daily_bars",
        "trading_date",
      ),

      readRange(
        "market_index_daily_bars",
        "trading_date",
      ),
    ]);

  const activeStocks =
    await readActiveStockCodes();

  const stockWarmups =
    [];

  for (
    const stock
    of activeStocks
  ) {
    stockWarmups.push(
      await readNthTradingDateForStock(
        stock.stockCode,
        61,
      ),
    );
  }

  const indexWarmups =
    [];

  for (
    const marketCode
    of [
      "KOSPI",
      "KOSDAQ",
    ]
  ) {
    indexWarmups.push(
      await readNthTradingDateForIndex(
        marketCode,
        61,
      ),
    );
  }

  const sourceScan =
    scanInvestorPersistenceSources();

  const flowTableProbes =
    await probeCandidateFlowTables(
      sourceScan.tables,
    );

  const confirmedFlowTables =
    flowTableProbes
      .filter(
        (
          row,
        ) =>
          row.exists,
      )
      .map(
        (
          row,
        ) =>
          row.table,
      );

  const stockWarmupCompleteDate =
    maxDateLike(
      stockWarmups.map(
        (
          row,
        ) =>
          row.nthTradingDate,
      ),
    );

  const indexWarmupCompleteDate =
    maxDateLike(
      indexWarmups.map(
        (
          row,
        ) =>
          row.nthTradingDate,
      ),
    );

  const replayStartDate =
    maxDateLike([
      datePart(
        predictionGeneratedRange
          .earliest,
      ),

      predictionDateRange
        .earliest,

      datePart(
        snapshotRange
          .earliest,
      ),

      stockWarmupCompleteDate,

      indexWarmupCompleteDate,
    ]);

  const replayEndDate =
    minDateLike([
      datePart(
        predictionGeneratedRange
          .latest,
      ),

      predictionDateRange
        .latest,

      datePart(
        snapshotRange
          .latest,
      ),

      dailyBarRange
        .latest,

      indexBarRange
        .latest,
    ]);

  const blockers:
    string[] =
    [];

  if (
    !predictionGeneratedRange
      .available ||
    !predictionDateRange
      .available
  ) {
    blockers.push(
      "PREDICTION_HISTORY_UNAVAILABLE",
    );
  }

  if (
    !snapshotRange
      .available
  ) {
    blockers.push(
      "MARKET_SNAPSHOT_HISTORY_UNAVAILABLE",
    );
  }

  if (
    stockWarmups.some(
      (
        row,
      ) =>
        !row
          .nthTradingDate,
    )
  ) {
    blockers.push(
      "INSUFFICIENT_61_BAR_STOCK_WARMUP",
    );
  }

  if (
    indexWarmups.some(
      (
        row,
      ) =>
        !row
          .nthTradingDate,
    )
  ) {
    blockers.push(
      "INSUFFICIENT_61_BAR_INDEX_WARMUP",
    );
  }

  if (
    confirmedFlowTables.length ===
    0
  ) {
    blockers.push(
      "HISTORICAL_FLOW_PERSISTENCE_NOT_CONFIRMED",
    );
  }

  if (
    !replayStartDate ||
    !replayEndDate ||
    replayStartDate >
      replayEndDate
  ) {
    blockers.push(
      "NO_COMMON_REPLAY_WINDOW",
    );
  }

  const fullReplayReady =
    blockers.length ===
    0;

  const partialReplayReady =
    Boolean(
      replayStartDate &&
      replayEndDate &&
      predictionGeneratedRange
        .available &&
      snapshotRange
        .available &&
      !stockWarmups.some(
        (
          row,
        ) =>
          !row
            .nthTradingDate,
      ) &&
      !indexWarmups.some(
        (
          row,
        ) =>
          !row
            .nthTradingDate,
      ),
    );

  const report = {
    status:
      "ALPHA_V1_HISTORICAL_REPLAY_READINESS_COMPLETE",

    version:
      VERSION,

    startedAt,

    finishedAt:
      new Date()
        .toISOString(),

    sourceRanges: {
      predictionGeneratedAt:
        predictionGeneratedRange,

      predictionDate:
        predictionDateRange,

      marketSnapshots:
        snapshotRange,

      marketDailyBars:
        dailyBarRange,

      marketIndexDailyBars:
        indexBarRange,
    },

    warmup: {
      requiredTradingBars:
        61,

      stocks:
        stockWarmups,

      indices:
        indexWarmups,

      stockWarmupCompleteDate,
      indexWarmupCompleteDate,
    },

    flowPersistence: {
      sourceScanTables:
        sourceScan.tables,

      sourceScanHits:
        sourceScan.hits,

      tableProbes:
        flowTableProbes,

      confirmedHistoricalFlowTables:
        confirmedFlowTables,

      ready:
        confirmedFlowTables.length >
        0,

      rule:
        "CURRENT_KIS_INVESTOR_ENDPOINT_MUST_NOT_BE_USED_FOR_PAST_DECISION_DATES",
    },

    replayWindow: {
      startDate:
        replayStartDate,

      endDate:
        replayEndDate,

      partialReplayReady,
      fullReplayReady,
    },

    blockers,

    interpretation: {
      partialReplay:
        "ALPHA_ENTRY_RISK_CAN_BE_REPLAYED_ONLY_WITH_SOURCES_AVAILABLE_AS_OF_EACH_DECISION_TIME",

      fullReplay:
        "REQUIRES_HISTORICAL_FLOW_SOURCE_WITH_AS_OF_SAFE_ACCESS",

      noLookahead:
        true,

      currentKisFlowFallbackAllowed:
        false,
    },

    safety: {
      databaseReadsOnly:
        true,

      databaseWrites:
        0,

      aiEntrySignalWrites:
        0,

      riskDecisionWrites:
        0,

      paperOrderWrites:
        0,

      ordersCreated:
        0,

      positionsChanged:
        0,

      productionDecisionApplied:
        false,
    },

    nextGate:
      fullReplayReady
        ? "ALPHA_V1_BUILD_FULL_HISTORICAL_READ_ONLY_REPLAY"
        : partialReplayReady
        ? "ALPHA_V1_BUILD_PARTIAL_HISTORICAL_REPLAY_AND_RESOLVE_FLOW_HISTORY"
        : "ALPHA_V1_RESOLVE_HISTORICAL_SOURCE_GAPS_BEFORE_REPLAY",

    outputFile:
      "logs/alpha-v1-historical-replay-readiness.json",
  };

  fs.mkdirSync(
    path.dirname(
      OUTPUT_FILE,
    ),
    {
      recursive: true,
    },
  );

  fs.writeFileSync(
    OUTPUT_FILE,
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
  (
    error,
  ) => {
    console.error(
      JSON.stringify(
        {
          status:
            "ALPHA_V1_HISTORICAL_REPLAY_READINESS_FAILED",

          version:
            VERSION,

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
