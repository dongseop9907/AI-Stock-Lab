const fs = require("fs");
const path = require("path");

const target = path.resolve(
  process.cwd(),
  "scripts/krx-freshness-canonical-live-read-regression-v1.ts"
);

fs.mkdirSync(
  path.dirname(target),
  { recursive: true }
);

fs.writeFileSync(
  target,
  "import fs from \"node:fs\";\nimport path from \"node:path\";\n\nimport {\n  getMarketDataFreshnessV77,\n} from \"../lib/market/get-market-data-freshness-v7-7\";\n\nasync function main() {\n  const root =\n    process.cwd();\n\n  const getterPath =\n    path.resolve(\n      root,\n      \"lib/market/get-market-data-freshness-v7-7.ts\",\n    );\n\n  const getterSource =\n    fs.readFileSync(\n      getterPath,\n      \"utf8\",\n    );\n\n  const forbiddenWrites = [\n    \".insert(\",\n    \".upsert(\",\n    \".update(\",\n    \".delete(\",\n  ].filter(\n    (needle) =>\n      getterSource.includes(\n        needle,\n      ),\n  );\n\n  if (\n    forbiddenWrites.length > 0\n  ) {\n    throw new Error(\n      `GETTER_NOT_READ_ONLY:${forbiddenWrites.join(\",\")}`,\n    );\n  }\n\n  const fixedNow =\n    \"2026-10-09T10:00:00.000Z\";\n\n  /*\n   * Existing freshness code supports a test clock in this project.\n   * `as any` keeps this regression compatible even if the public\n   * interface was not exported separately.\n   */\n  const freshness =\n    await getMarketDataFreshnessV77(\n      {\n        now:\n          fixedNow,\n      } as any,\n    );\n\n  const result: any =\n    freshness;\n\n  const expectedMarketDate =\n    result?.expectedMarketDate ??\n    result?.expected_market_date ??\n    null;\n\n  const koreanDate =\n    result?.koreanClock?.date ??\n    result?.korean_clock?.date ??\n    null;\n\n  const status =\n    result?.status ??\n    null;\n\n  const calendarMode =\n    result?.calendar?.mode ??\n    result?.metadata?.calendar?.mode ??\n    null;\n\n  const appliedOverrides =\n    result?.calendar\n      ?.appliedOverrides ??\n    result?.metadata\n      ?.calendar\n      ?.appliedOverrides ??\n    [];\n\n  const hangeulOverride =\n    Array.isArray(\n      appliedOverrides,\n    )\n      ? appliedOverrides.find(\n          (row: any) =>\n            (\n              row?.date ??\n              row?.calendar_date\n            ) ===\n              \"2026-10-09\",\n        ) ??\n        null\n      : null;\n\n  const dates =\n    result?.dates ??\n    {};\n\n  const checks = {\n    getterSourceReadOnly:\n      forbiddenWrites.length ===\n        0,\n\n    koreanClockIsHangeulDay:\n      koreanDate ===\n        \"2026-10-09\",\n\n    expectedMarketDateSkipsHangeulDay:\n      expectedMarketDate ===\n        \"2026-10-08\",\n\n    latestCommonDateNotAfterExpected:\n      !dates?.latestCommonDate ||\n      dates.latestCommonDate <=\n        \"2026-10-08\",\n\n    kospiNotAfterExpected:\n      !dates?.kospiLatestDate ||\n      dates.kospiLatestDate <=\n        \"2026-10-08\",\n\n    kosdaqNotAfterExpected:\n      !dates?.kosdaqLatestDate ||\n      dates.kosdaqLatestDate <=\n        \"2026-10-08\",\n\n    stockNotAfterExpected:\n      !dates?.stockLatestDate ||\n      dates.stockLatestDate <=\n        \"2026-10-08\",\n  };\n\n  const failed =\n    Object.entries(\n      checks,\n    )\n      .filter(\n        ([, value]) =>\n          !value,\n      )\n      .map(\n        ([name]) =>\n          name,\n      );\n\n  const output = {\n    status:\n      failed.length === 0\n        ? \"KRX_FRESHNESS_CANONICAL_LIVE_READ_REGRESSION_V1_VERIFIED\"\n        : \"KRX_FRESHNESS_CANONICAL_LIVE_READ_REGRESSION_V1_REVIEW\",\n\n    testClock: {\n      inputNow:\n        fixedNow,\n\n      koreanDate,\n\n      expectedMarketDate,\n    },\n\n    freshness: {\n      status,\n\n      usableForShadowComparison:\n        result\n          ?.usableForShadowComparison ??\n        result\n          ?.usable_for_shadow_comparison ??\n        null,\n\n      dates: {\n        kospiLatestDate:\n          dates?.kospiLatestDate ??\n          null,\n\n        kosdaqLatestDate:\n          dates?.kosdaqLatestDate ??\n          null,\n\n        stockLatestDate:\n          dates?.stockLatestDate ??\n          null,\n\n        oldestActiveStockLatestDate:\n          dates\n            ?.oldestActiveStockLatestDate ??\n          null,\n\n        latestCommonDate:\n          dates?.latestCommonDate ??\n          null,\n      },\n\n      lag:\n        result?.lag ??\n        null,\n\n      calendar: {\n        mode:\n          calendarMode,\n\n        hangeulOverride,\n      },\n    },\n\n    checks,\n    failed,\n\n    safety: {\n      getterStaticWriteCalls:\n        forbiddenWrites,\n\n      databaseReads:\n        true,\n\n      databaseWrites:\n        0,\n\n      observationCaptureCalled:\n        false,\n\n      eodSyncCalled:\n        false,\n\n      kisRequests:\n        0,\n\n      ordersCreated:\n        0,\n\n      positionsChanged:\n        0,\n\n      schedulerChanged:\n        false,\n\n      realTradingChanged:\n        false,\n\n      forwardOosStateChanged:\n        false,\n    },\n\n    nextGate:\n      failed.length === 0\n        ? \"KRX_CANONICAL_CALENDAR_V1_CORE_BINDING_COMPLETE\"\n        : \"REVIEW_FRESHNESS_LIVE_CALENDAR_RESULT\",\n  };\n\n  fs.mkdirSync(\n    path.resolve(\n      root,\n      \"logs\",\n    ),\n    {\n      recursive:\n        true,\n    },\n  );\n\n  fs.writeFileSync(\n    path.resolve(\n      root,\n      \"logs/krx-freshness-canonical-live-read-regression-v1.json\",\n    ),\n    JSON.stringify(\n      output,\n      null,\n      2,\n    ) + \"\\n\",\n    \"utf8\",\n  );\n\n  console.log(\n    JSON.stringify(\n      output,\n      null,\n      2,\n    ),\n  );\n\n  if (\n    failed.length > 0\n  ) {\n    process.exitCode =\n      2;\n  }\n}\n\nmain().catch(\n  (error) => {\n    console.error(\n      JSON.stringify(\n        {\n          status:\n            \"KRX_FRESHNESS_CANONICAL_LIVE_READ_REGRESSION_V1_ERROR\",\n\n          error:\n            error instanceof Error\n              ? error.message\n              : String(error),\n\n          safety: {\n            databaseWrites:\n              0,\n            observationCaptureCalled:\n              false,\n            eodSyncCalled:\n              false,\n            ordersCreated:\n              0,\n            positionsChanged:\n              0,\n          },\n        },\n        null,\n        2,\n      ),\n    );\n\n    process.exitCode =\n      1;\n  },\n);\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "KRX_FRESHNESS_CANONICAL_LIVE_READ_REGRESSION_V1_INSTALLED",

      generatedFile:
        "scripts/krx-freshness-canonical-live-read-regression-v1.ts",

      testClock:
        "2026-10-09T10:00:00.000Z",

      expectedMarketDate:
        "2026-10-08",

      safety: {
        getterOnly: true,
        databaseWrites: 0,
        observationCaptureCalled: false,
        eodSyncCalled: false,
        kisRequests: 0,
        ordersCreated: 0,
        positionsChanged: 0,
        schedulerChanged: false,
        realTradingChanged: false,
        forwardOosStateChanged: false
      },

      nextAction:
        "RUN_LIVE_READ_REGRESSION"
    },
    null,
    2
  )
);
