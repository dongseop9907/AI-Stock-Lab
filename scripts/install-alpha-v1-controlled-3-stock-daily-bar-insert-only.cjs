#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VERSION =
  'ALPHA_V1_CONTROLLED_3_STOCK_DAILY_BAR_INSERT_ONLY_INSTALLER';

const script =
  "import fs from \"node:fs\";\nimport path from \"node:path\";\nimport { createHash } from \"node:crypto\";\n\nimport {\n  createClient,\n} from \"@supabase/supabase-js\";\n\nconst VERSION =\n  \"ALPHA_V1_CONTROLLED_3_STOCK_DAILY_BAR_INSERT_ONLY\";\n\nconst PLAN_FILE =\n  path.resolve(\n    process.cwd(),\n    \"logs\",\n    \"alpha-v1-controlled-3-stock-daily-bar-backfill-plan.json\",\n  );\n\nconst TARGETS = [\n  \"005930\",\n  \"035420\",\n  \"035720\",\n] as const;\n\nconst START_DATE =\n  \"2026-06-01\";\n\nconst END_DATE =\n  \"2026-10-02\";\n\nconst EXPECTED_DESIRED_ROWS =\n  255;\n\nconst EXPECTED_EXISTING_ROWS_BEFORE =\n  222;\n\nconst EXPECTED_INSERT_ROWS =\n  33;\n\nconst EXPECTED_INSERT_ROWS_PER_STOCK =\n  11;\n\nconst EXPECTED_FINAL_ROWS_PER_STOCK =\n  85;\n\nconst PRESERVED_CONFLICT_KEY =\n  \"035720|2026-10-02\";\n\nconst PRESERVED_CONFLICT_CLOSE =\n  33400;\n\ntype JsonRecord =\n  Record<string, any>;\n\nfunction readJson(\n  file: string,\n) {\n  return JSON.parse(\n    fs.readFileSync(\n      file,\n      \"utf8\",\n    ),\n  );\n}\n\nfunction stableJson(\n  value: unknown,\n): string {\n  if (\n    value === null ||\n    typeof value !==\n      \"object\"\n  ) {\n    return JSON.stringify(\n      value,\n    );\n  }\n\n  if (\n    Array.isArray(\n      value,\n    )\n  ) {\n    return (\n      \"[\" +\n      value\n        .map(stableJson)\n        .join(\",\") +\n      \"]\"\n    );\n  }\n\n  const object =\n    value as\n      Record<\n        string,\n        unknown\n      >;\n\n  return (\n    \"{\" +\n    Object.keys(object)\n      .sort()\n      .map(\n        (key) =>\n          JSON.stringify(key) +\n          \":\" +\n          stableJson(\n            object[key],\n          ),\n      )\n      .join(\",\") +\n    \"}\"\n  );\n}\n\nfunction sha256(\n  value: unknown,\n) {\n  return createHash(\n    \"sha256\",\n  )\n    .update(\n      stableJson(value),\n      \"utf8\",\n    )\n    .digest(\n      \"hex\",\n    );\n}\n\nfunction keyOf(\n  row: JsonRecord,\n) {\n  return (\n    `${String(row.stock_code)}|` +\n    `${String(row.trading_date)}`\n  );\n}\n\nfunction semanticRow(\n  row: JsonRecord,\n) {\n  return {\n    stock_code:\n      String(\n        row.stock_code,\n      ),\n\n    trading_date:\n      String(\n        row.trading_date,\n      ),\n\n    open_price:\n      Number(\n        row.open_price,\n      ),\n\n    high_price:\n      Number(\n        row.high_price,\n      ),\n\n    low_price:\n      Number(\n        row.low_price,\n      ),\n\n    close_price:\n      Number(\n        row.close_price,\n      ),\n\n    volume:\n      Number(\n        row.volume,\n      ),\n\n    trading_value:\n      Number(\n        row.trading_value,\n      ),\n\n    source:\n      String(\n        row.source,\n      ),\n\n    adjusted_price:\n      row.adjusted_price ===\n      true,\n  };\n}\n\nfunction sortedSemanticRows(\n  rows: JsonRecord[],\n) {\n  return rows\n    .map(\n      semanticRow,\n    )\n    .sort(\n      (a, b) =>\n        (\n          `${a.stock_code}|${a.trading_date}`\n        ).localeCompare(\n          `${b.stock_code}|${b.trading_date}`,\n        ),\n    );\n}\n\nfunction resolveSupabaseConfig() {\n  const url =\n    process.env\n      .NEXT_PUBLIC_SUPABASE_URL ??\n    process.env\n      .SUPABASE_URL;\n\n  const serviceKey =\n    process.env\n      .SUPABASE_SERVICE_ROLE_KEY ??\n    process.env\n      .SUPABASE_SERVICE_KEY;\n\n  if (!url) {\n    throw new Error(\n      \"SUPABASE_URL_ENV_MISSING\",\n    );\n  }\n\n  if (!serviceKey) {\n    throw new Error(\n      \"SUPABASE_SERVICE_ROLE_KEY_REQUIRED_FOR_CONTROLLED_APPLY\",\n    );\n  }\n\n  return {\n    url,\n    key:\n      serviceKey,\n  };\n}\n\nasync function readScopeRows(\n  supabase:\n    ReturnType<\n      typeof createClient\n    >,\n) {\n  const result =\n    await supabase\n      .from(\n        \"market_daily_bars\",\n      )\n      .select(\n        `\n          stock_code,\n          trading_date,\n          open_price,\n          high_price,\n          low_price,\n          close_price,\n          volume,\n          trading_value,\n          source,\n          adjusted_price,\n          raw_payload,\n          collected_at,\n          created_at,\n          updated_at\n        `,\n      )\n      .in(\n        \"stock_code\",\n        TARGETS as unknown as string[],\n      )\n      .gte(\n        \"trading_date\",\n        START_DATE,\n      )\n      .lte(\n        \"trading_date\",\n        END_DATE,\n      )\n      .order(\n        \"stock_code\",\n        {\n          ascending:\n            true,\n        },\n      )\n      .order(\n        \"trading_date\",\n        {\n          ascending:\n            true,\n        },\n      )\n      .limit(\n        1000,\n      );\n\n  if (result.error) {\n    throw new Error(\n      `MARKET_DAILY_BARS_READ_FAILED:${result.error.message}`,\n    );\n  }\n\n  return (\n    result.data ??\n    []\n  ) as JsonRecord[];\n}\n\nfunction countByStock(\n  rows: JsonRecord[],\n) {\n  return Object.fromEntries(\n    TARGETS.map(\n      (stockCode) => [\n        stockCode,\n        rows.filter(\n          (row) =>\n            String(\n              row.stock_code,\n            ) ===\n            stockCode,\n        ).length,\n      ],\n    ),\n  );\n}\n\nfunction validatePlanRows(\n  desiredRows: JsonRecord[],\n) {\n  if (\n    desiredRows.length !==\n    EXPECTED_DESIRED_ROWS\n  ) {\n    throw new Error(\n      `DESIRED_ROW_COUNT_MISMATCH:${desiredRows.length}`,\n    );\n  }\n\n  const keys =\n    new Set(\n      desiredRows.map(\n        keyOf,\n      ),\n    );\n\n  if (\n    keys.size !==\n    desiredRows.length\n  ) {\n    throw new Error(\n      \"DESIRED_ROWS_CONTAIN_DUPLICATE_KEYS\",\n    );\n  }\n\n  for (\n    const row\n    of desiredRows\n  ) {\n    if (\n      !TARGETS.includes(\n        String(\n          row.stock_code,\n        ) as\n          typeof TARGETS[\n            number\n          ],\n      )\n    ) {\n      throw new Error(\n        `OUT_OF_SCOPE_STOCK:${row.stock_code}`,\n      );\n    }\n\n    if (\n      String(\n        row.trading_date,\n      ) < START_DATE ||\n      String(\n        row.trading_date,\n      ) > END_DATE\n    ) {\n      throw new Error(\n        `OUT_OF_SCOPE_DATE:${keyOf(row)}`,\n      );\n    }\n\n    if (\n      row.source !==\n      \"KIS_DAILY_V8_3\"\n    ) {\n      throw new Error(\n        `NON_CANONICAL_SOURCE:${keyOf(row)}:${row.source}`,\n      );\n    }\n\n    if (\n      row.adjusted_price !==\n      true\n    ) {\n      throw new Error(\n        `NON_ADJUSTED_ROW:${keyOf(row)}`,\n      );\n    }\n  }\n}\n\nasync function main() {\n  if (\n    !fs.existsSync(\n      PLAN_FILE,\n    )\n  ) {\n    throw new Error(\n      `PLAN_FILE_NOT_FOUND:${PLAN_FILE}`,\n    );\n  }\n\n  const plan =\n    readJson(\n      PLAN_FILE,\n    );\n\n  const desiredRows =\n    Array.isArray(\n      plan.desiredRows,\n    )\n      ? (\n          plan.desiredRows as\n            JsonRecord[]\n        )\n      : [];\n\n  validatePlanRows(\n    desiredRows,\n  );\n\n  const config =\n    resolveSupabaseConfig();\n\n  const supabase =\n    createClient(\n      config.url,\n      config.key,\n      {\n        auth: {\n          persistSession:\n            false,\n\n          autoRefreshToken:\n            false,\n        },\n      },\n    );\n\n  const before =\n    await readScopeRows(\n      supabase,\n    );\n\n  if (\n    before.length !==\n    EXPECTED_EXISTING_ROWS_BEFORE\n  ) {\n    throw new Error(\n      `PRE_APPLY_EXISTING_ROW_COUNT_CHANGED:${before.length}:EXPECTED_${EXPECTED_EXISTING_ROWS_BEFORE}`,\n    );\n  }\n\n  const beforeByKey =\n    new Map(\n      before.map(\n        (row) => [\n          keyOf(row),\n          row,\n        ],\n      ),\n    );\n\n  const preservedConflict =\n    beforeByKey.get(\n      PRESERVED_CONFLICT_KEY,\n    );\n\n  if (\n    !preservedConflict\n  ) {\n    throw new Error(\n      `PRESERVED_CONFLICT_ROW_MISSING:${PRESERVED_CONFLICT_KEY}`,\n    );\n  }\n\n  if (\n    Number(\n      preservedConflict.close_price,\n    ) !==\n    PRESERVED_CONFLICT_CLOSE\n  ) {\n    throw new Error(\n      `PRESERVED_CONFLICT_ROW_CHANGED:${preservedConflict.close_price}:EXPECTED_${PRESERVED_CONFLICT_CLOSE}`,\n    );\n  }\n\n  const missingRows =\n    desiredRows.filter(\n      (row) =>\n        !beforeByKey.has(\n          keyOf(row),\n        ),\n    );\n\n  if (\n    missingRows.length !==\n    EXPECTED_INSERT_ROWS\n  ) {\n    throw new Error(\n      `MISSING_ROW_COUNT_CHANGED:${missingRows.length}:EXPECTED_${EXPECTED_INSERT_ROWS}`,\n    );\n  }\n\n  const missingByStock =\n    countByStock(\n      missingRows,\n    );\n\n  for (\n    const stockCode\n    of TARGETS\n  ) {\n    if (\n      missingByStock[\n        stockCode\n      ] !==\n      EXPECTED_INSERT_ROWS_PER_STOCK\n    ) {\n      throw new Error(\n        `MISSING_ROW_COUNT_PER_STOCK_CHANGED:${stockCode}:${missingByStock[stockCode]}:EXPECTED_${EXPECTED_INSERT_ROWS_PER_STOCK}`,\n      );\n    }\n  }\n\n  const existingFingerprintBefore =\n    sha256(\n      sortedSemanticRows(\n        before,\n      ),\n    );\n\n  const insertPayload =\n    missingRows.map(\n      (row) => ({\n        stock_code:\n          row.stock_code,\n\n        trading_date:\n          row.trading_date,\n\n        open_price:\n          row.open_price,\n\n        high_price:\n          row.high_price,\n\n        low_price:\n          row.low_price,\n\n        close_price:\n          row.close_price,\n\n        volume:\n          row.volume,\n\n        trading_value:\n          row.trading_value,\n\n        source:\n          row.source,\n\n        adjusted_price:\n          row.adjusted_price,\n\n        raw_payload:\n          row.raw_payload,\n\n        collected_at:\n          row.collected_at,\n\n        updated_at:\n          row.updated_at,\n      }),\n    );\n\n  const insertResult =\n    await supabase\n      .from(\n        \"market_daily_bars\",\n      )\n      .insert(\n        insertPayload,\n      )\n      .select(\n        \"stock_code,trading_date\",\n      );\n\n  if (\n    insertResult.error\n  ) {\n    throw new Error(\n      `INSERT_ONLY_APPLY_FAILED:${insertResult.error.message}`,\n    );\n  }\n\n  const insertedRows =\n    (\n      insertResult.data ??\n      []\n    ) as JsonRecord[];\n\n  if (\n    insertedRows.length !==\n    EXPECTED_INSERT_ROWS\n  ) {\n    throw new Error(\n      `INSERTED_ROW_COUNT_MISMATCH:${insertedRows.length}:EXPECTED_${EXPECTED_INSERT_ROWS}`,\n    );\n  }\n\n  const after =\n    await readScopeRows(\n      supabase,\n    );\n\n  const afterByKey =\n    new Map(\n      after.map(\n        (row) => [\n          keyOf(row),\n          row,\n        ],\n      ),\n    );\n\n  const preservedAfter =\n    before.map(\n      (row) =>\n        afterByKey.get(\n          keyOf(row),\n        ),\n    );\n\n  if (\n    preservedAfter.some(\n      (row) =>\n        !row,\n    )\n  ) {\n    throw new Error(\n      \"PRE_EXISTING_ROW_DISAPPEARED_AFTER_INSERT\",\n    );\n  }\n\n  const existingFingerprintAfter =\n    sha256(\n      sortedSemanticRows(\n        preservedAfter as\n          JsonRecord[],\n      ),\n    );\n\n  const existingRowsPreserved =\n    existingFingerprintBefore ===\n    existingFingerprintAfter;\n\n  const finalCounts =\n    countByStock(\n      after,\n    );\n\n  const finalCoverageComplete =\n    TARGETS.every(\n      (stockCode) =>\n        finalCounts[\n          stockCode\n        ] ===\n        EXPECTED_FINAL_ROWS_PER_STOCK,\n    );\n\n  const conflictAfter =\n    afterByKey.get(\n      PRESERVED_CONFLICT_KEY,\n    );\n\n  const conflictPreserved =\n    Boolean(\n      conflictAfter &&\n      Number(\n        conflictAfter.close_price,\n      ) ===\n        PRESERVED_CONFLICT_CLOSE &&\n      String(\n        conflictAfter.source,\n      ) ===\n        \"KIS_DAILY\",\n    );\n\n  const insertedKeys =\n    new Set(\n      insertedRows.map(\n        keyOf,\n      ),\n    );\n\n  const allInsertedRowsCanonical =\n    after\n      .filter(\n        (row) =>\n          insertedKeys.has(\n            keyOf(row),\n          ),\n      )\n      .every(\n        (row) =>\n          row.source ===\n            \"KIS_DAILY_V8_3\" &&\n          row.adjusted_price ===\n            true,\n      );\n\n  if (\n    !existingRowsPreserved ||\n    !finalCoverageComplete ||\n    !conflictPreserved ||\n    !allInsertedRowsCanonical ||\n    after.length !==\n      EXPECTED_DESIRED_ROWS\n  ) {\n    throw new Error(\n      [\n        \"POST_APPLY_VERIFICATION_FAILED\",\n        `existingRowsPreserved=${existingRowsPreserved}`,\n        `finalCoverageComplete=${finalCoverageComplete}`,\n        `conflictPreserved=${conflictPreserved}`,\n        `allInsertedRowsCanonical=${allInsertedRowsCanonical}`,\n        `finalRows=${after.length}`,\n      ].join(\":\"),\n    );\n  }\n\n  const report = {\n    status:\n      \"ALPHA_V1_CONTROLLED_3_STOCK_DAILY_BAR_INSERT_ONLY_COMPLETE\",\n\n    version:\n      VERSION,\n\n    policy: {\n      mode:\n        \"INSERT_ONLY\",\n\n      existingRows:\n        \"PRESERVE_ALL\",\n\n      metadataOnlyRows:\n        \"PRESERVE\",\n\n      providerRevisionConflict:\n        \"PRESERVE_EXISTING\",\n\n      deletes:\n        0,\n\n      updates:\n        0,\n    },\n\n    scope: {\n      targets:\n        TARGETS,\n\n      startDate:\n        START_DATE,\n\n      endDate:\n        END_DATE,\n    },\n\n    before: {\n      rowCount:\n        before.length,\n\n      countsByStock:\n        countByStock(\n          before,\n        ),\n\n      existingSemanticFingerprint:\n        existingFingerprintBefore,\n    },\n\n    apply: {\n      requestedInsertRows:\n        insertPayload.length,\n\n      insertedRows:\n        insertedRows.length,\n\n      insertedRowsByStock:\n        missingByStock,\n\n      databaseWriteRequests:\n        1,\n\n      updates:\n        0,\n\n      deletes:\n        0,\n    },\n\n    after: {\n      rowCount:\n        after.length,\n\n      countsByStock:\n        finalCounts,\n\n      existingSemanticFingerprintAfter:\n        existingFingerprintAfter,\n\n      existingRowsPreserved,\n\n      finalCoverageComplete,\n\n      allInsertedRowsCanonical,\n\n      preservedProviderRevisionConflict: {\n        key:\n          PRESERVED_CONFLICT_KEY,\n\n        closePrice:\n          conflictAfter\n            ?.close_price ??\n          null,\n\n        source:\n          conflictAfter\n            ?.source ??\n          null,\n\n        preserved:\n          conflictPreserved,\n      },\n    },\n\n    safety: {\n      databaseReads:\n        2,\n\n      databaseWriteRequests:\n        1,\n\n      databaseRowsInserted:\n        EXPECTED_INSERT_ROWS,\n\n      databaseRowsUpdated:\n        0,\n\n      databaseRowsDeleted:\n        0,\n\n      kisRequests:\n        0,\n\n      ordersCreated:\n        0,\n\n      positionsChanged:\n        0,\n\n      productionTradingDecisionApplied:\n        false,\n    },\n\n    nextGate:\n      \"ALPHA_V1_BUILD_DAILY_BAR_ALPHA_PRICE_VOLUME_AND_V7_REGIME_ADAPTERS\",\n  };\n\n  const outputFile =\n    path.resolve(\n      process.cwd(),\n      \"logs\",\n      \"alpha-v1-controlled-3-stock-daily-bar-insert-only-result.json\",\n    );\n\n  fs.mkdirSync(\n    path.dirname(\n      outputFile,\n    ),\n    {\n      recursive:\n        true,\n    },\n  );\n\n  fs.writeFileSync(\n    outputFile,\n    JSON.stringify(\n      report,\n      null,\n      2,\n    ) + \"\\n\",\n    \"utf8\",\n  );\n\n  console.log(\n    JSON.stringify(\n      report,\n      null,\n      2,\n    ),\n  );\n}\n\nmain().catch(\n  (error) => {\n    console.error(\n      JSON.stringify(\n        {\n          status:\n            \"ALPHA_V1_CONTROLLED_3_STOCK_DAILY_BAR_INSERT_ONLY_FAILED\",\n\n          version:\n            VERSION,\n\n          error:\n            String(\n              error instanceof Error\n                ? error.message\n                : error,\n            ),\n\n          policy:\n            \"FAIL_CLOSED_NO_UPDATE_NO_DELETE\",\n\n          nextGate:\n            \"REVIEW_FAILURE_BEFORE_ANY_RETRY\",\n        },\n        null,\n        2,\n      ),\n    );\n\n    process.exitCode =\n      2;\n  },\n);\n";

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

  const target =
    path.join(
      root,
      'scripts',
      'alpha-v1-controlled-3-stock-daily-bar-insert-only.ts',
    );

  atomicWrite(
    target,
    script,
  );

  console.log(
    JSON.stringify(
      {
        status:
          'ALPHA_V1_CONTROLLED_3_STOCK_DAILY_BAR_INSERT_ONLY_INSTALLED',

        version:
          VERSION,

        file:
          'scripts/alpha-v1-controlled-3-stock-daily-bar-insert-only.ts',

        gates: {
          expectedExistingRows:
            222,

          expectedMissingRows:
            33,

          expectedMissingRowsPerStock:
            11,

          expectedFinalRows:
            255,

          preserveConflict:
            '035720|2026-10-02 close=33400 source=KIS_DAILY',
        },

        writeContract: {
          inserts:
            33,

          updates:
            0,

          deletes:
            0,

          existingRowsPreserved:
            true,
        },

        nextAction:
          'RUN_CONTROLLED_INSERT_ONLY_33_ROWS',
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
          'ALPHA_V1_CONTROLLED_3_STOCK_DAILY_BAR_INSERT_ONLY_INSTALL_FAILED',

        version:
          VERSION,

        error:
          String(
            error?.message ??
            error,
          ),
      },
      null,
      2,
    ),
  );

  process.exitCode =
    2;
}
