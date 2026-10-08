#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root =
  path.resolve(
    __dirname,
    '..',
  );

fs.writeFileSync(
  path.join(
    root,
    'scripts',
    'alpha-v2-controlled-intraday-backfill-post-apply-verify.ts',
  ),
  "import fs from \"node:fs\";\nimport path from \"node:path\";\n\nimport {\n  createSupabaseServerClient,\n} from \"../lib/supabase\";\n\nconst EXPECTED_TARGET_COUNT = 12;\nconst EXPECTED_ROW_COUNT = 4572;\nconst EXPECTED_ROWS_PER_TARGET = 381;\n\nfunction normalizedKey(\n  stockCode: string,\n  observedAt: string,\n) {\n  const ms =\n    new Date(\n      observedAt,\n    ).getTime();\n\n  if (\n    !Number.isFinite(ms)\n  ) {\n    throw new Error(\n      `INVALID_TIMESTAMP:${observedAt}`,\n    );\n  }\n\n  return (\n    `${stockCode}|${ms}`\n  );\n}\n\nasync function main() {\n  const root =\n    process.cwd();\n\n  const planPath =\n    path.join(\n      root,\n      \"logs\",\n      \"alpha-v2-controlled-intraday-backfill-plan.json\",\n    );\n\n  const desiredPath =\n    path.join(\n      root,\n      \"logs\",\n      \"alpha-v2-controlled-intraday-backfill-desired-rows.json\",\n    );\n\n  if (\n    !fs.existsSync(planPath) ||\n    !fs.existsSync(desiredPath)\n  ) {\n    throw new Error(\n      \"BACKFILL_PLAN_OR_DESIRED_ROWS_FILE_MISSING\",\n    );\n  }\n\n  const plan =\n    JSON.parse(\n      fs.readFileSync(\n        planPath,\n        \"utf8\",\n      ),\n    );\n\n  const desiredFile =\n    JSON.parse(\n      fs.readFileSync(\n        desiredPath,\n        \"utf8\",\n      ),\n    );\n\n  const targets =\n    (\n      plan.targets ??\n      []\n    ) as Array<{\n      stockCode: string;\n      targetSessionDate: string;\n    }>;\n\n  const desiredRows =\n    (\n      desiredFile.rows ??\n      []\n    ) as Array<{\n      stock_code: string;\n      observed_at: string;\n      raw_payload?: Record<string, unknown>;\n    }>;\n\n  if (\n    targets.length !==\n    EXPECTED_TARGET_COUNT\n  ) {\n    throw new Error(\n      `TARGET_COUNT_MISMATCH:${targets.length}:${EXPECTED_TARGET_COUNT}`,\n    );\n  }\n\n  if (\n    desiredRows.length !==\n    EXPECTED_ROW_COUNT\n  ) {\n    throw new Error(\n      `DESIRED_ROW_COUNT_MISMATCH:${desiredRows.length}:${EXPECTED_ROW_COUNT}`,\n    );\n  }\n\n  const supabase =\n    createSupabaseServerClient();\n\n  const actualRows:\n    Array<{\n      stock_code: string;\n      observed_at: string;\n      raw_payload: Record<string, unknown> | null;\n    }> =\n    [];\n\n  const perTarget:\n    Array<{\n      stockCode: string;\n      targetSessionDate: string;\n      actualRowCount: number;\n      canonicalRowCount: number;\n    }> =\n    [];\n\n  for (\n    const target\n    of targets\n  ) {\n    const start =\n      `${target.targetSessionDate}T00:00:00+09:00`;\n\n    const end =\n      `${target.targetSessionDate}T23:59:59+09:00`;\n\n    const result =\n      await supabase\n        .from(\n          \"market_snapshots\",\n        )\n        .select(\n          \"stock_code,observed_at,raw_payload\",\n        )\n        .eq(\n          \"stock_code\",\n          target.stockCode,\n        )\n        .gte(\n          \"observed_at\",\n          start,\n        )\n        .lte(\n          \"observed_at\",\n          end,\n        )\n        .order(\n          \"observed_at\",\n          {\n            ascending:\n              true,\n          },\n        )\n        .limit(\n          1000,\n        );\n\n    if (\n      result.error\n    ) {\n      throw result.error;\n    }\n\n    const rows =\n      (\n        result.data ??\n        []\n      ) as Array<{\n        stock_code: string;\n        observed_at: string;\n        raw_payload: Record<string, unknown> | null;\n      }>;\n\n    actualRows.push(\n      ...rows,\n    );\n\n    const canonicalRowCount =\n      rows.filter(\n        (row) =>\n          row.raw_payload\n            ?.source ===\n            \"KIS_HISTORICAL_INTRADAY_RECONSTRUCTED\" &&\n          row.raw_payload\n            ?.source_version ===\n            \"FHKST03010230_ALPHA_V2_BACKFILL_V1\",\n      ).length;\n\n    perTarget.push({\n      stockCode:\n        target.stockCode,\n\n      targetSessionDate:\n        target.targetSessionDate,\n\n      actualRowCount:\n        rows.length,\n\n      canonicalRowCount,\n    });\n  }\n\n  const desiredKeys =\n    new Set(\n      desiredRows.map(\n        (row) =>\n          normalizedKey(\n            row.stock_code,\n            row.observed_at,\n          ),\n      ),\n    );\n\n  const actualKeys =\n    new Set(\n      actualRows.map(\n        (row) =>\n          normalizedKey(\n            row.stock_code,\n            row.observed_at,\n          ),\n      ),\n    );\n\n  const missingDesiredKeys =\n    [\n      ...desiredKeys,\n    ].filter(\n      (key) =>\n        !actualKeys.has(\n          key,\n        ),\n    );\n\n  const unexpectedActualKeys =\n    [\n      ...actualKeys,\n    ].filter(\n      (key) =>\n        !desiredKeys.has(\n          key,\n        ),\n    );\n\n  const allPerTargetExact =\n    perTarget.every(\n      (row) =>\n        row.actualRowCount ===\n          EXPECTED_ROWS_PER_TARGET &&\n        row.canonicalRowCount ===\n          EXPECTED_ROWS_PER_TARGET,\n    );\n\n  const allDesiredPresent =\n    missingDesiredKeys.length ===\n    0;\n\n  const noUnexpectedRows =\n    unexpectedActualKeys.length ===\n    0;\n\n  const exactTotal =\n    actualRows.length ===\n    EXPECTED_ROW_COUNT;\n\n  const verified =\n    exactTotal &&\n    allPerTargetExact &&\n    allDesiredPresent &&\n    noUnexpectedRows;\n\n  const report = {\n    status:\n      verified\n        ? \"ALPHA_V2_CONTROLLED_INTRADAY_BACKFILL_POST_APPLY_VERIFIED\"\n        : \"ALPHA_V2_CONTROLLED_INTRADAY_BACKFILL_POST_APPLY_VERIFY_FAILED\",\n\n    applied:\n      verified,\n\n    verificationMethod: {\n      timestampComparison:\n        \"NORMALIZED_TO_EPOCH_MILLISECONDS\",\n\n      rawStringTimestampComparison:\n        false,\n\n      databaseWrites:\n        0,\n    },\n\n    counts: {\n      expectedRows:\n        EXPECTED_ROW_COUNT,\n\n      actualRows:\n        actualRows.length,\n\n      desiredUniqueKeys:\n        desiredKeys.size,\n\n      actualUniqueKeys:\n        actualKeys.size,\n\n      missingDesiredKeys:\n        missingDesiredKeys.length,\n\n      unexpectedActualKeys:\n        unexpectedActualKeys.length,\n\n      exactTargetCount:\n        perTarget.filter(\n          (row) =>\n            row.actualRowCount ===\n            EXPECTED_ROWS_PER_TARGET,\n        ).length,\n\n      canonicalTargetCount:\n        perTarget.filter(\n          (row) =>\n            row.canonicalRowCount ===\n            EXPECTED_ROWS_PER_TARGET,\n        ).length,\n    },\n\n    perTarget,\n\n    diagnostics: {\n      sampleMissingDesiredKeys:\n        missingDesiredKeys.slice(\n          0,\n          10,\n        ),\n\n      sampleUnexpectedActualKeys:\n        unexpectedActualKeys.slice(\n          0,\n          10,\n        ),\n    },\n\n    conclusion:\n      verified\n        ? \"THE_PRIOR_INSERT SUCCEEDED; THE FAILURE WAS ONLY THE RAW TIMESTAMP STRING KEY COMPARISON.\"\n        : \"DO_NOT_INSERT AGAIN. REVIEW THE KEY DIFFERENCES BEFORE ANY WRITE.\",\n\n    safety: {\n      databaseReadsOnly:\n        true,\n\n      databaseWrites:\n        0,\n\n      ordersCreated:\n        0,\n\n      positionsChanged:\n        0,\n    },\n\n    nextGate:\n      verified\n        ? \"RERUN_ALPHA_V2_TARGET_SESSION_COVERAGE_AND_ENTRY_REPLAY\"\n        : \"REVIEW_POST_APPLY_TIMESTAMP_OR_ROW_DIFFERENCES\",\n  };\n\n  fs.writeFileSync(\n    path.join(\n      root,\n      \"logs\",\n      \"alpha-v2-controlled-intraday-backfill-post-apply-verify.json\",\n    ),\n    JSON.stringify(\n      report,\n      null,\n      2,\n    ) + \"\\n\",\n    \"utf8\",\n  );\n\n  console.log(\n    JSON.stringify(\n      report,\n      null,\n      2,\n    ),\n  );\n}\n\nmain().catch(\n  (error) => {\n    console.error(\n      JSON.stringify(\n        {\n          status:\n            \"ALPHA_V2_CONTROLLED_INTRADAY_BACKFILL_POST_APPLY_VERIFY_CRASHED\",\n\n          error:\n            String(\n              error instanceof Error\n                ? error.message\n                : error,\n            ),\n\n          databaseWrites:\n            0,\n\n          ordersCreated:\n            0,\n        },\n        null,\n        2,\n      ),\n    );\n\n    process.exitCode =\n      2;\n  },\n);\n",
  'utf8',
);

console.log(
  JSON.stringify(
    {
      status:
        'ALPHA_V2_CONTROLLED_INTRADAY_BACKFILL_POST_APPLY_VERIFY_INSTALLED',

      generatedFile:
        'scripts/alpha-v2-controlled-intraday-backfill-post-apply-verify.ts',

      databaseWrites:
        0,

      ordersCreated:
        0,

      warning:
        'READ_ONLY VERIFICATION. DO NOT RERUN THE INSERT SCRIPT.',

      nextAction:
        'RUN_POST_APPLY_VERIFY'
    },
    null,
    2,
  ),
);
