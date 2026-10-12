#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VERSION =
  'ALPHA_V1_HISTORICAL_REPLAY_READINESS_INSTALLER';

const source =
  "import fs from \"node:fs\";\nimport path from \"node:path\";\n\nimport {\n  createSupabaseServerClient,\n} from \"../lib/supabase\";\n\nconst VERSION =\n  \"ALPHA_V1_HISTORICAL_REPLAY_READINESS_V1\";\n\nconst OUTPUT_FILE =\n  path.resolve(\n    process.cwd(),\n    \"logs\",\n    \"alpha-v1-historical-replay-readiness.json\",\n  );\n\ntype RangeResult = {\n  table: string;\n  field: string;\n  earliest: string | null;\n  latest: string | null;\n  available: boolean;\n  error: string | null;\n};\n\nfunction asString(\n  value: unknown,\n): string | null {\n  if (\n    value === null ||\n    value === undefined\n  ) {\n    return null;\n  }\n\n  const text =\n    String(value);\n\n  return text.length >\n    0\n    ? text\n    : null;\n}\n\nasync function readRange(\n  table: string,\n  field: string,\n): Promise<RangeResult> {\n  const supabase =\n    createSupabaseServerClient();\n\n  const earliestResult =\n    await supabase\n      .from(table)\n      .select(field)\n      .not(\n        field,\n        \"is\",\n        null,\n      )\n      .order(\n        field,\n        {\n          ascending:\n            true,\n        },\n      )\n      .limit(1)\n      .maybeSingle();\n\n  if (\n    earliestResult.error\n  ) {\n    return {\n      table,\n      field,\n      earliest:\n        null,\n      latest:\n        null,\n      available:\n        false,\n      error:\n        earliestResult\n          .error\n          .message,\n    };\n  }\n\n  const latestResult =\n    await supabase\n      .from(table)\n      .select(field)\n      .not(\n        field,\n        \"is\",\n        null,\n      )\n      .order(\n        field,\n        {\n          ascending:\n            false,\n        },\n      )\n      .limit(1)\n      .maybeSingle();\n\n  if (\n    latestResult.error\n  ) {\n    return {\n      table,\n      field,\n      earliest:\n        asString(\n          earliestResult\n            .data?.[field],\n        ),\n      latest:\n        null,\n      available:\n        false,\n      error:\n        latestResult\n          .error\n          .message,\n    };\n  }\n\n  return {\n    table,\n    field,\n\n    earliest:\n      asString(\n        earliestResult\n          .data?.[field],\n      ),\n\n    latest:\n      asString(\n        latestResult\n          .data?.[field],\n      ),\n\n    available:\n      Boolean(\n        earliestResult\n          .data &&\n        latestResult\n          .data,\n      ),\n\n    error:\n      null,\n  };\n}\n\nasync function readActiveStockCodes() {\n  const supabase =\n    createSupabaseServerClient();\n\n  const result =\n    await supabase\n      .from(\n        \"stocks\",\n      )\n      .select(\n        \"stock_code, stock_name, market\",\n      )\n      .eq(\n        \"is_active\",\n        true,\n      )\n      .order(\n        \"stock_code\",\n        {\n          ascending:\n            true,\n        },\n      );\n\n  if (\n    result.error\n  ) {\n    throw new Error(\n      `ACTIVE_STOCK_READ_FAILED:${result.error.message}`,\n    );\n  }\n\n  return (\n    result.data ??\n    []\n  ).map(\n    (\n      row,\n    ) => ({\n      stockCode:\n        String(\n          row.stock_code,\n        ),\n\n      stockName:\n        row.stock_name == null\n          ? null\n          : String(\n              row.stock_name,\n            ),\n\n      market:\n        row.market == null\n          ? null\n          : String(\n              row.market,\n            ),\n    }),\n  );\n}\n\nasync function readNthTradingDateForStock(\n  stockCode: string,\n  nth: number,\n) {\n  const supabase =\n    createSupabaseServerClient();\n\n  const result =\n    await supabase\n      .from(\n        \"market_daily_bars\",\n      )\n      .select(\n        \"trading_date, adjusted_price\",\n      )\n      .eq(\n        \"stock_code\",\n        stockCode,\n      )\n      .eq(\n        \"adjusted_price\",\n        true,\n      )\n      .order(\n        \"trading_date\",\n        {\n          ascending:\n            true,\n        },\n      )\n      .limit(\n        nth,\n      );\n\n  if (\n    result.error\n  ) {\n    return {\n      stockCode,\n      rowCount:\n        0,\n      nthTradingDate:\n        null,\n      error:\n        result.error.message,\n    };\n  }\n\n  const rows =\n    result.data ??\n    [];\n\n  return {\n    stockCode,\n    rowCount:\n      rows.length,\n\n    nthTradingDate:\n      rows.length >=\n        nth\n        ? asString(\n            rows[nth - 1]\n              ?.trading_date,\n          )\n        : null,\n\n    error:\n      null,\n  };\n}\n\nasync function readNthTradingDateForIndex(\n  marketCode: string,\n  nth: number,\n) {\n  const supabase =\n    createSupabaseServerClient();\n\n  const result =\n    await supabase\n      .from(\n        \"market_index_daily_bars\",\n      )\n      .select(\n        \"trading_date\",\n      )\n      .eq(\n        \"market_code\",\n        marketCode,\n      )\n      .order(\n        \"trading_date\",\n        {\n          ascending:\n            true,\n        },\n      )\n      .limit(\n        nth,\n      );\n\n  if (\n    result.error\n  ) {\n    return {\n      marketCode,\n      rowCount:\n        0,\n      nthTradingDate:\n        null,\n      error:\n        result.error.message,\n    };\n  }\n\n  const rows =\n    result.data ??\n    [];\n\n  return {\n    marketCode,\n    rowCount:\n      rows.length,\n\n    nthTradingDate:\n      rows.length >=\n        nth\n        ? asString(\n            rows[nth - 1]\n              ?.trading_date,\n          )\n        : null,\n\n    error:\n      null,\n  };\n}\n\nfunction maxDateLike(\n  values:\n    Array<\n      string |\n      null |\n      undefined\n    >,\n) {\n  const usable =\n    values\n      .filter(\n        (\n          value,\n        ): value is string =>\n          typeof value ===\n            \"string\" &&\n          value.length >\n            0,\n      )\n      .sort();\n\n  return usable.at(-1) ??\n    null;\n}\n\nfunction minDateLike(\n  values:\n    Array<\n      string |\n      null |\n      undefined\n    >,\n) {\n  const usable =\n    values\n      .filter(\n        (\n          value,\n        ): value is string =>\n          typeof value ===\n            \"string\" &&\n          value.length >\n            0,\n      )\n      .sort();\n\n  return usable[0] ??\n    null;\n}\n\nfunction datePart(\n  value:\n    string |\n    null,\n) {\n  if (!value) {\n    return null;\n  }\n\n  return value.slice(\n    0,\n    10,\n  );\n}\n\nfunction scanInvestorPersistenceSources() {\n  const roots = [\n    path.resolve(\n      process.cwd(),\n      \"lib\",\n    ),\n    path.resolve(\n      process.cwd(),\n      \"app\",\n    ),\n    path.resolve(\n      process.cwd(),\n      \"scripts\",\n    ),\n  ];\n\n  const tablePattern =\n    /\\.from\\(\\s*[\"'`]([^\"'`]+)[\"'`]\\s*\\)/g;\n\n  const investorPattern =\n    /(investor|flow|foreign|institution|\uc218\uae09)/i;\n\n  const hits:\n    Array<{\n      file: string;\n      tables: string[];\n    }> =\n    [];\n\n  function walk(\n    directory: string,\n  ) {\n    if (\n      !fs.existsSync(\n        directory,\n      )\n    ) {\n      return;\n    }\n\n    for (\n      const entry\n      of fs.readdirSync(\n        directory,\n        {\n          withFileTypes:\n            true,\n        },\n      )\n    ) {\n      const full =\n        path.join(\n          directory,\n          entry.name,\n        );\n\n      if (\n        entry.isDirectory()\n      ) {\n        if (\n          entry.name ===\n            \"node_modules\" ||\n          entry.name ===\n            \".next\"\n        ) {\n          continue;\n        }\n\n        walk(\n          full,\n        );\n\n        continue;\n      }\n\n      if (\n        !/\\.(ts|tsx|js|cjs|mjs)$/\n          .test(\n            entry.name,\n          )\n      ) {\n        continue;\n      }\n\n      const text =\n        fs.readFileSync(\n          full,\n          \"utf8\",\n        );\n\n      if (\n        !investorPattern\n          .test(\n            text,\n          )\n      ) {\n        continue;\n      }\n\n      const tables =\n        new Set<string>();\n\n      for (\n        const match\n        of text.matchAll(\n          tablePattern,\n        )\n      ) {\n        const table =\n          match[1];\n\n        if (\n          investorPattern\n            .test(\n              table,\n            )\n        ) {\n          tables.add(\n            table,\n          );\n        }\n      }\n\n      if (\n        tables.size >\n        0\n      ) {\n        hits.push({\n          file:\n            path.relative(\n              process.cwd(),\n              full,\n            ),\n\n          tables:\n            [...tables],\n        });\n      }\n    }\n  }\n\n  roots.forEach(\n    walk,\n  );\n\n  const tables =\n    [\n      ...new Set(\n        hits.flatMap(\n          (\n            hit,\n          ) =>\n            hit.tables,\n        ),\n      ),\n    ];\n\n  return {\n    tables,\n    hits,\n  };\n}\n\nasync function probeCandidateFlowTables(\n  tableNames: string[],\n) {\n  const results:\n    Array<{\n      table: string;\n      exists: boolean;\n      error: string | null;\n      sampleKeys: string[];\n    }> =\n    [];\n\n  for (\n    const table\n    of tableNames\n  ) {\n    const supabase =\n      createSupabaseServerClient();\n\n    const result =\n      await supabase\n        .from(\n          table,\n        )\n        .select(\n          \"*\",\n        )\n        .limit(1);\n\n    results.push({\n      table,\n\n      exists:\n        !result.error,\n\n      error:\n        result.error\n          ?.message ??\n        null,\n\n      sampleKeys:\n        result.data?.[0]\n          ? Object.keys(\n              result.data[0],\n            )\n          : [],\n    });\n  }\n\n  return results;\n}\n\nasync function main() {\n  const startedAt =\n    new Date()\n      .toISOString();\n\n  const [\n    predictionGeneratedRange,\n    predictionDateRange,\n    snapshotRange,\n    dailyBarRange,\n    indexBarRange,\n  ] =\n    await Promise.all([\n      readRange(\n        \"ai_stock_predictions\",\n        \"generated_at\",\n      ),\n\n      readRange(\n        \"ai_stock_predictions\",\n        \"prediction_date\",\n      ),\n\n      readRange(\n        \"market_snapshots\",\n        \"observed_at\",\n      ),\n\n      readRange(\n        \"market_daily_bars\",\n        \"trading_date\",\n      ),\n\n      readRange(\n        \"market_index_daily_bars\",\n        \"trading_date\",\n      ),\n    ]);\n\n  const activeStocks =\n    await readActiveStockCodes();\n\n  const stockWarmups =\n    [];\n\n  for (\n    const stock\n    of activeStocks\n  ) {\n    stockWarmups.push(\n      await readNthTradingDateForStock(\n        stock.stockCode,\n        61,\n      ),\n    );\n  }\n\n  const indexWarmups =\n    [];\n\n  for (\n    const marketCode\n    of [\n      \"KOSPI\",\n      \"KOSDAQ\",\n    ]\n  ) {\n    indexWarmups.push(\n      await readNthTradingDateForIndex(\n        marketCode,\n        61,\n      ),\n    );\n  }\n\n  const sourceScan =\n    scanInvestorPersistenceSources();\n\n  const flowTableProbes =\n    await probeCandidateFlowTables(\n      sourceScan.tables,\n    );\n\n  const confirmedFlowTables =\n    flowTableProbes\n      .filter(\n        (\n          row,\n        ) =>\n          row.exists,\n      )\n      .map(\n        (\n          row,\n        ) =>\n          row.table,\n      );\n\n  const stockWarmupCompleteDate =\n    maxDateLike(\n      stockWarmups.map(\n        (\n          row,\n        ) =>\n          row.nthTradingDate,\n      ),\n    );\n\n  const indexWarmupCompleteDate =\n    maxDateLike(\n      indexWarmups.map(\n        (\n          row,\n        ) =>\n          row.nthTradingDate,\n      ),\n    );\n\n  const replayStartDate =\n    maxDateLike([\n      datePart(\n        predictionGeneratedRange\n          .earliest,\n      ),\n\n      predictionDateRange\n        .earliest,\n\n      datePart(\n        snapshotRange\n          .earliest,\n      ),\n\n      stockWarmupCompleteDate,\n\n      indexWarmupCompleteDate,\n    ]);\n\n  const replayEndDate =\n    minDateLike([\n      datePart(\n        predictionGeneratedRange\n          .latest,\n      ),\n\n      predictionDateRange\n        .latest,\n\n      datePart(\n        snapshotRange\n          .latest,\n      ),\n\n      dailyBarRange\n        .latest,\n\n      indexBarRange\n        .latest,\n    ]);\n\n  const blockers:\n    string[] =\n    [];\n\n  if (\n    !predictionGeneratedRange\n      .available ||\n    !predictionDateRange\n      .available\n  ) {\n    blockers.push(\n      \"PREDICTION_HISTORY_UNAVAILABLE\",\n    );\n  }\n\n  if (\n    !snapshotRange\n      .available\n  ) {\n    blockers.push(\n      \"MARKET_SNAPSHOT_HISTORY_UNAVAILABLE\",\n    );\n  }\n\n  if (\n    stockWarmups.some(\n      (\n        row,\n      ) =>\n        !row\n          .nthTradingDate,\n    )\n  ) {\n    blockers.push(\n      \"INSUFFICIENT_61_BAR_STOCK_WARMUP\",\n    );\n  }\n\n  if (\n    indexWarmups.some(\n      (\n        row,\n      ) =>\n        !row\n          .nthTradingDate,\n    )\n  ) {\n    blockers.push(\n      \"INSUFFICIENT_61_BAR_INDEX_WARMUP\",\n    );\n  }\n\n  if (\n    confirmedFlowTables.length ===\n    0\n  ) {\n    blockers.push(\n      \"HISTORICAL_FLOW_PERSISTENCE_NOT_CONFIRMED\",\n    );\n  }\n\n  if (\n    !replayStartDate ||\n    !replayEndDate ||\n    replayStartDate >\n      replayEndDate\n  ) {\n    blockers.push(\n      \"NO_COMMON_REPLAY_WINDOW\",\n    );\n  }\n\n  const fullReplayReady =\n    blockers.length ===\n    0;\n\n  const partialReplayReady =\n    Boolean(\n      replayStartDate &&\n      replayEndDate &&\n      predictionGeneratedRange\n        .available &&\n      snapshotRange\n        .available &&\n      !stockWarmups.some(\n        (\n          row,\n        ) =>\n          !row\n            .nthTradingDate,\n      ) &&\n      !indexWarmups.some(\n        (\n          row,\n        ) =>\n          !row\n            .nthTradingDate,\n      ),\n    );\n\n  const report = {\n    status:\n      \"ALPHA_V1_HISTORICAL_REPLAY_READINESS_COMPLETE\",\n\n    version:\n      VERSION,\n\n    startedAt,\n\n    finishedAt:\n      new Date()\n        .toISOString(),\n\n    sourceRanges: {\n      predictionGeneratedAt:\n        predictionGeneratedRange,\n\n      predictionDate:\n        predictionDateRange,\n\n      marketSnapshots:\n        snapshotRange,\n\n      marketDailyBars:\n        dailyBarRange,\n\n      marketIndexDailyBars:\n        indexBarRange,\n    },\n\n    warmup: {\n      requiredTradingBars:\n        61,\n\n      stocks:\n        stockWarmups,\n\n      indices:\n        indexWarmups,\n\n      stockWarmupCompleteDate,\n      indexWarmupCompleteDate,\n    },\n\n    flowPersistence: {\n      sourceScanTables:\n        sourceScan.tables,\n\n      sourceScanHits:\n        sourceScan.hits,\n\n      tableProbes:\n        flowTableProbes,\n\n      confirmedHistoricalFlowTables:\n        confirmedFlowTables,\n\n      ready:\n        confirmedFlowTables.length >\n        0,\n\n      rule:\n        \"CURRENT_KIS_INVESTOR_ENDPOINT_MUST_NOT_BE_USED_FOR_PAST_DECISION_DATES\",\n    },\n\n    replayWindow: {\n      startDate:\n        replayStartDate,\n\n      endDate:\n        replayEndDate,\n\n      partialReplayReady,\n      fullReplayReady,\n    },\n\n    blockers,\n\n    interpretation: {\n      partialReplay:\n        \"ALPHA_ENTRY_RISK_CAN_BE_REPLAYED_ONLY_WITH_SOURCES_AVAILABLE_AS_OF_EACH_DECISION_TIME\",\n\n      fullReplay:\n        \"REQUIRES_HISTORICAL_FLOW_SOURCE_WITH_AS_OF_SAFE_ACCESS\",\n\n      noLookahead:\n        true,\n\n      currentKisFlowFallbackAllowed:\n        false,\n    },\n\n    safety: {\n      databaseReadsOnly:\n        true,\n\n      databaseWrites:\n        0,\n\n      aiEntrySignalWrites:\n        0,\n\n      riskDecisionWrites:\n        0,\n\n      paperOrderWrites:\n        0,\n\n      ordersCreated:\n        0,\n\n      positionsChanged:\n        0,\n\n      productionDecisionApplied:\n        false,\n    },\n\n    nextGate:\n      fullReplayReady\n        ? \"ALPHA_V1_BUILD_FULL_HISTORICAL_READ_ONLY_REPLAY\"\n        : partialReplayReady\n        ? \"ALPHA_V1_BUILD_PARTIAL_HISTORICAL_REPLAY_AND_RESOLVE_FLOW_HISTORY\"\n        : \"ALPHA_V1_RESOLVE_HISTORICAL_SOURCE_GAPS_BEFORE_REPLAY\",\n\n    outputFile:\n      \"logs/alpha-v1-historical-replay-readiness.json\",\n  };\n\n  fs.mkdirSync(\n    path.dirname(\n      OUTPUT_FILE,\n    ),\n    {\n      recursive: true,\n    },\n  );\n\n  fs.writeFileSync(\n    OUTPUT_FILE,\n    JSON.stringify(\n      report,\n      null,\n      2,\n    ) + \"\\n\",\n    \"utf8\",\n  );\n\n  console.log(\n    JSON.stringify(\n      report,\n      null,\n      2,\n    ),\n  );\n}\n\nmain().catch(\n  (\n    error,\n  ) => {\n    console.error(\n      JSON.stringify(\n        {\n          status:\n            \"ALPHA_V1_HISTORICAL_REPLAY_READINESS_FAILED\",\n\n          version:\n            VERSION,\n\n          error:\n            String(\n              error instanceof Error\n                ? error.message\n                : error,\n            ),\n\n          databaseWrites:\n            0,\n\n          ordersCreated:\n            0,\n        },\n        null,\n        2,\n      ),\n    );\n\n    process.exitCode =\n      2;\n  },\n);\n";

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

  const temp =
    `${file}.tmp-${process.pid}-${Date.now()}`;

  fs.writeFileSync(
    temp,
    content,
    'utf8',
  );

  fs.renameSync(
    temp,
    file,
  );
}

try {
  const root =
    path.resolve(
      __dirname,
      '..',
    );

  const target =
    path.join(
      root,
      'scripts',
      'alpha-v1-historical-replay-readiness.ts',
    );

  atomicWrite(
    target,
    source,
  );

  console.log(
    JSON.stringify(
      {
        status:
          'ALPHA_V1_HISTORICAL_REPLAY_READINESS_INSTALLED',

        version:
          VERSION,

        generatedFile:
          'scripts/alpha-v1-historical-replay-readiness.ts',

        checks: [
          'PREDICTION_HISTORY_RANGE',
          'MARKET_SNAPSHOT_HISTORY_RANGE',
          'STOCK_DAILY_BAR_61_SESSION_WARMUP',
          'INDEX_DAILY_BAR_61_SESSION_WARMUP',
          'HISTORICAL_FLOW_PERSISTENCE',
          'COMMON_REPLAY_WINDOW',
        ],

        policy: {
          useCurrentKisFlowForHistoricalDecision:
            false,

          requireAsOfSafeSources:
            true,

          lowerThresholds:
            false,
        },

        safety: {
          databaseWrites:
            0,

          ordersCreated:
            0,

          positionsChanged:
            0,
        },

        nextAction:
          'RUN_HISTORICAL_REPLAY_READINESS',
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
          'ALPHA_V1_HISTORICAL_REPLAY_READINESS_INSTALL_FAILED',

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
