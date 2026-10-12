const fs = require("fs");
const path = require("path");

const root =
  process.cwd();

const outputs = [
  {
    rel:
      "scripts/alpha-v3-index-gap-calendar-repair-v1.ts",

    text:
      "import fs from \"node:fs\";\nimport path from \"node:path\";\n\nimport {\n  createClient,\n} from \"@supabase/supabase-js\";\n\nimport {\n  syncIndexDailyBars,\n} from \"../lib/market/sync-index-daily-bars\";\n\nconst TARGET_INDEX_DATES = [\n  \"2026-09-04\",\n  \"2026-09-07\",\n  \"2026-09-08\",\n  \"2026-09-09\",\n  \"2026-09-10\",\n  \"2026-09-11\",\n  \"2026-09-14\",\n  \"2026-09-15\",\n  \"2026-09-16\",\n  \"2026-09-17\",\n  \"2026-09-18\",\n] as const;\n\nconst VERIFIED_CLOSED_DATES = [\n  {\n    calendar_date:\n      \"2026-09-24\",\n\n    reason:\n      \"2026 Chuseok public-holiday closure; KRX holiday period begins 2026-09-24.\",\n  },\n  {\n    calendar_date:\n      \"2026-09-25\",\n\n    reason:\n      \"2026 Chuseok public-holiday closure.\",\n  },\n  {\n    calendar_date:\n      \"2026-10-05\",\n\n    reason:\n      \"2026-10-05 substitute public holiday closure associated with National Foundation Day.\",\n  },\n] as const;\n\nfunction env(\n  ...names:\n    string[]\n): string {\n  for (const name of names) {\n    const value =\n      process.env[name]?.trim();\n\n    if (value) {\n      return value;\n    }\n  }\n\n  throw new Error(\n    `MISSING_ENV:${names.join(\"|\")}`,\n  );\n}\n\nfunction key(\n  market:\n    string,\n  date:\n    string,\n) {\n  return `${market}:${date}`;\n}\n\nasync function main() {\n  const supabase =\n    createClient(\n      env(\n        \"NEXT_PUBLIC_SUPABASE_URL\",\n        \"SUPABASE_URL\",\n      ),\n      env(\n        \"SUPABASE_SERVICE_ROLE_KEY\",\n        \"SUPABASE_SERVICE_KEY\",\n      ),\n      {\n        auth: {\n          persistSession:\n            false,\n          autoRefreshToken:\n            false,\n        },\n      },\n    );\n\n  const holidayDates =\n    VERIFIED_CLOSED_DATES.map(\n      (row) =>\n        row.calendar_date,\n    );\n\n  const {\n    data:\n      beforeOverrides,\n    error:\n      beforeOverridesError,\n  } =\n    await supabase\n      .from(\n        \"market_exchange_calendar_overrides\",\n      )\n      .select(\n        \"exchange_code,calendar_date,is_open,verified,reason,source\",\n      )\n      .eq(\n        \"exchange_code\",\n        \"KRX\",\n      )\n      .in(\n        \"calendar_date\",\n        holidayDates,\n      )\n      .order(\n        \"calendar_date\",\n        {\n          ascending:\n            true,\n        },\n      );\n\n  if (beforeOverridesError) {\n    throw new Error(\n      `OVERRIDE_PRECHECK_FAILED:${beforeOverridesError.message}`,\n    );\n  }\n\n  const conflictingOpen =\n    (\n      beforeOverrides ??\n      []\n    ).filter(\n      (row:\n        any) =>\n        row.verified ===\n          true &&\n        row.is_open ===\n          true,\n    );\n\n  if (\n    conflictingOpen.length >\n    0\n  ) {\n    throw new Error(\n      \"VERIFIED_OPEN_OVERRIDE_CONFLICT:\" +\n      JSON.stringify(\n        conflictingOpen,\n      ),\n    );\n  }\n\n  const {\n    data:\n      beforeIndex,\n    error:\n      beforeIndexError,\n  } =\n    await supabase\n      .from(\n        \"market_index_daily_bars\",\n      )\n      .select(\n        \"market_code,trading_date\",\n      )\n      .in(\n        \"market_code\",\n        [\n          \"KOSPI\",\n          \"KOSDAQ\",\n        ],\n      )\n      .in(\n        \"trading_date\",\n        [\n          ...TARGET_INDEX_DATES,\n        ],\n      );\n\n  if (beforeIndexError) {\n    throw new Error(\n      `INDEX_PRECHECK_FAILED:${beforeIndexError.message}`,\n    );\n  }\n\n  const beforeSet =\n    new Set(\n      (\n        beforeIndex ??\n        []\n      ).map(\n        (row:\n          any) =>\n          key(\n            String(\n              row.market_code,\n            ),\n            String(\n              row.trading_date,\n            ),\n          ),\n      ),\n    );\n\n  const missingBefore =\n    TARGET_INDEX_DATES\n      .flatMap(\n        (date) =>\n          [\n            \"KOSPI\",\n            \"KOSDAQ\",\n          ].map(\n            (market) => ({\n              market,\n              date,\n              present:\n                beforeSet.has(\n                  key(\n                    market,\n                    date,\n                  ),\n                ),\n            }),\n          ),\n      )\n      .filter(\n        (item) =>\n          !item.present,\n      );\n\n  const syncResult =\n    await syncIndexDailyBars({\n      markets: [\n        \"KOSPI\",\n        \"KOSDAQ\",\n      ],\n      startDate:\n        \"2026-09-04\",\n      endDate:\n        \"2026-09-18\",\n    });\n\n  const overrideRows =\n    VERIFIED_CLOSED_DATES.map(\n      (row) => ({\n        exchange_code:\n          \"KRX\",\n\n        calendar_date:\n          row.calendar_date,\n\n        is_open:\n          false,\n\n        verified:\n          true,\n\n        reason:\n          row.reason,\n\n        source:\n          \"MANUAL_VERIFIED_KRX_CALENDAR\",\n      }),\n    );\n\n  const {\n    error:\n      overrideWriteError,\n  } =\n    await supabase\n      .from(\n        \"market_exchange_calendar_overrides\",\n      )\n      .upsert(\n        overrideRows,\n        {\n          onConflict:\n            \"exchange_code,calendar_date\",\n        },\n      );\n\n  if (overrideWriteError) {\n    throw new Error(\n      `OVERRIDE_UPSERT_FAILED:${overrideWriteError.message}`,\n    );\n  }\n\n  const [\n    afterIndexResult,\n    afterOverrideResult,\n  ] =\n    await Promise.all([\n      supabase\n        .from(\n          \"market_index_daily_bars\",\n        )\n        .select(\n          \"market_code,trading_date\",\n        )\n        .in(\n          \"market_code\",\n          [\n            \"KOSPI\",\n            \"KOSDAQ\",\n          ],\n        )\n        .in(\n          \"trading_date\",\n          [\n            ...TARGET_INDEX_DATES,\n          ],\n        )\n        .order(\n          \"trading_date\",\n          {\n            ascending:\n              true,\n          },\n        ),\n\n      supabase\n        .from(\n          \"market_exchange_calendar_overrides\",\n        )\n        .select(\n          \"exchange_code,calendar_date,is_open,verified,reason,source\",\n        )\n        .eq(\n          \"exchange_code\",\n          \"KRX\",\n        )\n        .in(\n          \"calendar_date\",\n          holidayDates,\n        )\n        .order(\n          \"calendar_date\",\n          {\n            ascending:\n              true,\n          },\n        ),\n    ]);\n\n  if (\n    afterIndexResult.error\n  ) {\n    throw new Error(\n      `INDEX_POSTCHECK_FAILED:${afterIndexResult.error.message}`,\n    );\n  }\n\n  if (\n    afterOverrideResult.error\n  ) {\n    throw new Error(\n      `OVERRIDE_POSTCHECK_FAILED:${afterOverrideResult.error.message}`,\n    );\n  }\n\n  const afterSet =\n    new Set(\n      (\n        afterIndexResult.data ??\n        []\n      ).map(\n        (row:\n          any) =>\n          key(\n            String(\n              row.market_code,\n            ),\n            String(\n              row.trading_date,\n            ),\n          ),\n      ),\n    );\n\n  const missingAfter =\n    TARGET_INDEX_DATES\n      .flatMap(\n        (date) =>\n          [\n            \"KOSPI\",\n            \"KOSDAQ\",\n          ].map(\n            (market) => ({\n              market,\n              date,\n              present:\n                afterSet.has(\n                  key(\n                    market,\n                    date,\n                  ),\n                ),\n            }),\n          ),\n      )\n      .filter(\n        (item) =>\n          !item.present,\n      );\n\n  const overridesAfter =\n    (\n      afterOverrideResult.data ??\n      []\n    ) as any[];\n\n  const allOverridesVerifiedClosed =\n    VERIFIED_CLOSED_DATES.every(\n      (target) =>\n        overridesAfter.some(\n          (row) =>\n            row.calendar_date ===\n              target.calendar_date &&\n            row.exchange_code ===\n              \"KRX\" &&\n            row.is_open ===\n              false &&\n            row.verified ===\n              true,\n        ),\n    );\n\n  const checks = {\n    noVerifiedOpenConflict:\n      conflictingOpen.length ===\n      0,\n\n    targetIndexRowsComplete:\n      missingAfter.length ===\n      0,\n\n    expectedTargetIndexRowCount:\n      afterSet.size ===\n      TARGET_INDEX_DATES.length *\n        2,\n\n    verifiedClosedOverridesComplete:\n      allOverridesVerifiedClosed,\n\n    sourceConventionPreserved:\n      overridesAfter\n        .filter(\n          (row) =>\n            holidayDates.includes(\n              row.calendar_date,\n            ),\n        )\n        .every(\n          (row) =>\n            row.source ===\n              \"MANUAL_VERIFIED_KRX_CALENDAR\",\n        ),\n  };\n\n  const failed =\n    Object.entries(\n      checks,\n    )\n      .filter(\n        ([, value]) =>\n          !value,\n      )\n      .map(\n        ([name]) =>\n          name,\n      );\n\n  const report = {\n    status:\n      failed.length === 0\n        ? \"ALPHA_V3_INDEX_GAP_CALENDAR_REPAIR_V1_VERIFIED\"\n        : \"ALPHA_V3_INDEX_GAP_CALENDAR_REPAIR_V1_REVIEW\",\n\n    repair: {\n      indexBackfill: {\n        markets: [\n          \"KOSPI\",\n          \"KOSDAQ\",\n        ],\n\n        startDate:\n          \"2026-09-04\",\n\n        endDate:\n          \"2026-09-18\",\n\n        targetTradingDates: [\n          ...TARGET_INDEX_DATES,\n        ],\n\n        missingPairsBefore:\n          missingBefore,\n\n        missingPairsAfter:\n          missingAfter,\n\n        syncResult,\n      },\n\n      verifiedCalendarClosures: {\n        before:\n          beforeOverrides ??\n          [],\n\n        after:\n          overridesAfter,\n      },\n    },\n\n    checks,\n    failed,\n\n    safety: {\n      productionOrderEndpointCalled:\n        false,\n\n      autoOrder:\n        false,\n\n      orderTablesTouched:\n        false,\n\n      positionsTouched:\n        false,\n\n      databaseWrites: {\n        marketIndexDailyBars:\n          true,\n\n        marketExchangeCalendarOverrides:\n          true,\n\n        tradingTables:\n          false,\n      },\n    },\n\n    logFile:\n      \"logs/alpha-v3-index-gap-calendar-repair-v1.json\",\n\n    nextGate:\n      failed.length === 0\n        ? \"RERUN_ROOT_CAUSE_PROBE_AND_MARKET_DATA_MAINTENANCE_V2\"\n        : \"REVIEW_INDEX_PROVIDER_BACKFILL_OR_OVERRIDE_CONSTRAINTS\",\n  };\n\n  const logPath =\n    path.resolve(\n      process.cwd(),\n      report.logFile,\n    );\n\n  fs.mkdirSync(\n    path.dirname(\n      logPath,\n    ),\n    {\n      recursive:\n        true,\n    },\n  );\n\n  fs.writeFileSync(\n    logPath,\n    JSON.stringify(\n      report,\n      null,\n      2,\n    ) + \"\\n\",\n    \"utf8\",\n  );\n\n  console.log(\n    JSON.stringify(\n      report,\n      null,\n      2,\n    ),\n  );\n\n  if (\n    failed.length >\n    0\n  ) {\n    process.exitCode =\n      2;\n  }\n}\n\nmain().catch(\n  (error) => {\n    console.error(\n      JSON.stringify(\n        {\n          status:\n            \"ALPHA_V3_INDEX_GAP_CALENDAR_REPAIR_V1_FATAL\",\n\n          error:\n            error instanceof Error\n              ? error.message\n              : String(error),\n\n          safety: {\n            productionOrderEndpointCalled:\n              false,\n\n            orderTablesTouched:\n              false,\n\n            positionsTouched:\n              false,\n          },\n        },\n        null,\n        2,\n      ),\n    );\n\n    process.exitCode =\n      2;\n  },\n);\n"
  },
  {
    rel:
      "scripts/alpha-v3-index-gap-calendar-repair-v1-static-verify.cjs",

    text:
      "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst file =\n  path.resolve(\n    process.cwd(),\n    \"scripts/alpha-v3-index-gap-calendar-repair-v1.ts\"\n  );\n\nconst text =\n  fs.readFileSync(\n    file,\n    \"utf8\"\n  );\n\nconst requiredDates = [\n  \"2026-09-04\",\n  \"2026-09-07\",\n  \"2026-09-08\",\n  \"2026-09-09\",\n  \"2026-09-10\",\n  \"2026-09-11\",\n  \"2026-09-14\",\n  \"2026-09-15\",\n  \"2026-09-16\",\n  \"2026-09-17\",\n  \"2026-09-18\",\n  \"2026-09-24\",\n  \"2026-09-25\",\n  \"2026-10-05\"\n];\n\nconst checks = {\n  usesExistingIndexSync:\n    text.includes(\n      \"syncIndexDailyBars\"\n    ),\n\n  indexOnlyMarkets:\n    text.includes(\n      '\"KOSPI\"'\n    ) &&\n    text.includes(\n      '\"KOSDAQ\"'\n    ),\n\n  exactGapRange:\n    text.includes(\n      '\"2026-09-04\"'\n    ) &&\n    text.includes(\n      '\"2026-09-18\"'\n    ),\n\n  allTargetDatesPresent:\n    requiredDates.every(\n      (date) =>\n        text.includes(\n          `\"${date}\"`\n        )\n    ),\n\n  verifiedClosedOverrides:\n    text.includes(\n      \"verified:\" +\n        \"\\n          true\"\n    ) &&\n    text.includes(\n      \"is_open:\" +\n        \"\\n          false\"\n    ),\n\n  existingProjectSourceConvention:\n    text.includes(\n      '\"MANUAL_VERIFIED_KRX_CALENDAR\"'\n    ),\n\n  noOrderEndpoints:\n    !text.includes(\n      \"/api/orders/\"\n    ) &&\n    !text.includes(\n      \"/api/trading/automation/\"\n    ) &&\n    !text.includes(\n      \"/api/signals/entry/\"\n    ),\n\n  noTradingTableNames:\n    !/paper_order|paper_position|trading_order|trade_execution/i.test(\n      text\n    ),\n\n  conflictFailsClosed:\n    text.includes(\n      \"VERIFIED_OPEN_OVERRIDE_CONFLICT\"\n    ),\n\n  postVerification:\n    text.includes(\n      \"missingAfter\"\n    ) &&\n    text.includes(\n      \"allOverridesVerifiedClosed\"\n    ),\n};\n\nconst failed =\n  Object.entries(\n    checks\n  )\n    .filter(\n      ([, value]) =>\n        !value\n    )\n    .map(\n      ([name]) =>\n        name\n    );\n\nconsole.log(\n  JSON.stringify(\n    {\n      status:\n        failed.length === 0\n          ? \"ALPHA_V3_INDEX_GAP_CALENDAR_REPAIR_V1_STATIC_VERIFIED\"\n          : \"ALPHA_V3_INDEX_GAP_CALENDAR_REPAIR_V1_STATIC_REVIEW\",\n\n      checks,\n      failed,\n\n      repairScope: {\n        indexBackfill:\n          \"KOSPI_KOSDAQ_2026-09-04_TO_2026-09-18\",\n\n        verifiedClosures: [\n          \"2026-09-24\",\n          \"2026-09-25\",\n          \"2026-10-05\"\n        ]\n      },\n\n      safety: {\n        networkCalls:\n          0,\n\n        databaseWrites:\n          0,\n\n        productionOrderEndpointCalled:\n          false\n      },\n\n      nextGate:\n        failed.length === 0\n          ? \"EXECUTE_ONE_TIME_INDEX_AND_CALENDAR_REPAIR\"\n          : \"REVIEW_REPAIR_SCRIPT\"\n    },\n    null,\n    2\n  )\n);\n\nif (\n  failed.length >\n  0\n) {\n  process.exitCode =\n    2;\n}\n"
  }
];

for (
  const item of
    outputs
) {
  const file =
    path.resolve(
      root,
      item.rel
    );

  fs.mkdirSync(
    path.dirname(
      file
    ),
    {
      recursive:
        true
    }
  );

  fs.writeFileSync(
    file,
    item.text,
    "utf8"
  );
}

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_INDEX_GAP_CALENDAR_REPAIR_V1_INSTALLED",

      generatedFiles:
        outputs.map(
          (item) =>
            item.rel
        ),

      diagnosis: {
        trueIndexGapDates: [
          "2026-09-04",
          "2026-09-07",
          "2026-09-08",
          "2026-09-09",
          "2026-09-10",
          "2026-09-11",
          "2026-09-14",
          "2026-09-15",
          "2026-09-16",
          "2026-09-17",
          "2026-09-18"
        ],

        verifiedHolidayClosures: [
          "2026-09-24",
          "2026-09-25",
          "2026-10-05"
        ]
      },

      repair: {
        index:
          "USE_EXISTING_SYNC_INDEX_DAILY_BARS_AND_UPSERT",

        calendar:
          "USE_EXISTING_VERIFIED_KRX_OVERRIDE_CONVENTION"
      },

      safety: {
        installerDatabaseWrites:
          0,

        installerNetworkCalls:
          0,

        productionOrderEndpointCalled:
          false,

        tradingTablesTouched:
          false
      },

      nextAction:
        "STATIC_VERIFY_THEN_EXECUTE_ONE_TIME_REPAIR"
    },
    null,
    2
  )
);
