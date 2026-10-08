#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VERSION =
  'ALPHA_V1_SINGLE_PRICE_CONFLICT_LINEAGE_TRACE_INSTALLER_FIXED';

const script =
  "import fs from \"node:fs\";\nimport path from \"node:path\";\n\nimport {\n  createClient,\n} from \"@supabase/supabase-js\";\n\nconst VERSION =\n  \"ALPHA_V1_SINGLE_PRICE_CONFLICT_LINEAGE_TRACE\";\n\nconst ANALYSIS_FILE =\n  path.resolve(\n    process.cwd(),\n    \"logs\",\n    \"alpha-v1-controlled-3-stock-daily-bar-backfill-conflict-analysis.json\",\n  );\n\nconst PLAN_FILE =\n  path.resolve(\n    process.cwd(),\n    \"logs\",\n    \"alpha-v1-controlled-3-stock-daily-bar-backfill-plan.json\",\n  );\n\nconst OUTPUT_FILE =\n  path.resolve(\n    process.cwd(),\n    \"logs\",\n    \"alpha-v1-single-price-conflict-lineage-trace.json\",\n  );\n\nfunction readJson(\n  file: string,\n) {\n  return JSON.parse(\n    fs.readFileSync(\n      file,\n      \"utf8\",\n    ),\n  );\n}\n\nfunction asNumber(\n  value: unknown,\n): number | null {\n  if (\n    value === null ||\n    value === undefined\n  ) {\n    return null;\n  }\n\n  const parsed =\n    Number(value);\n\n  return Number.isFinite(parsed)\n    ? parsed\n    : null;\n}\n\nfunction resolveSupabaseConfig() {\n  const url =\n    process.env\n      .NEXT_PUBLIC_SUPABASE_URL ??\n    process.env\n      .SUPABASE_URL;\n\n  const serviceKey =\n    process.env\n      .SUPABASE_SERVICE_ROLE_KEY ??\n    process.env\n      .SUPABASE_SERVICE_KEY;\n\n  const anonKey =\n    process.env\n      .NEXT_PUBLIC_SUPABASE_ANON_KEY ??\n    process.env\n      .SUPABASE_ANON_KEY;\n\n  const key =\n    serviceKey ??\n    anonKey;\n\n  if (!url) {\n    throw new Error(\n      \"SUPABASE_URL_ENV_MISSING\",\n    );\n  }\n\n  if (!key) {\n    throw new Error(\n      \"SUPABASE_KEY_ENV_MISSING\",\n    );\n  }\n\n  return {\n    url,\n    key,\n    authMode:\n      serviceKey\n        ? \"SERVICE_ROLE\"\n        : \"ANON\",\n  };\n}\n\nfunction rawPayloadSummary(\n  payload: unknown,\n) {\n  if (\n    !payload ||\n    typeof payload !==\n      \"object\"\n  ) {\n    return null;\n  }\n\n  const row =\n    payload as\n    Record<string, unknown>;\n\n  return {\n    stck_bsop_date:\n      row.stck_bsop_date ??\n      null,\n\n    stck_oprc:\n      asNumber(\n        row.stck_oprc,\n      ),\n\n    stck_hgpr:\n      asNumber(\n        row.stck_hgpr,\n      ),\n\n    stck_lwpr:\n      asNumber(\n        row.stck_lwpr,\n      ),\n\n    stck_clpr:\n      asNumber(\n        row.stck_clpr,\n      ),\n\n    acml_vol:\n      asNumber(\n        row.acml_vol,\n      ),\n\n    acml_tr_pbmn:\n      asNumber(\n        row.acml_tr_pbmn,\n      ),\n\n    mod_yn:\n      row.mod_yn ??\n      null,\n\n    prdy_vrss:\n      row.prdy_vrss ??\n      null,\n\n    prdy_vrss_sign:\n      row.prdy_vrss_sign ??\n      null,\n\n    revl_issu_reas:\n      row.revl_issu_reas ??\n      null,\n  };\n}\n\nasync function main() {\n  if (\n    !fs.existsSync(\n      ANALYSIS_FILE,\n    )\n  ) {\n    throw new Error(\n      `ANALYSIS_FILE_NOT_FOUND:${ANALYSIS_FILE}`,\n    );\n  }\n\n  if (\n    !fs.existsSync(\n      PLAN_FILE,\n    )\n  ) {\n    throw new Error(\n      `PLAN_FILE_NOT_FOUND:${PLAN_FILE}`,\n    );\n  }\n\n  const analysis =\n    readJson(\n      ANALYSIS_FILE,\n    );\n\n  const plan =\n    readJson(\n      PLAN_FILE,\n    );\n\n  const conflicts =\n    Array.isArray(\n      analysis.allConflicts,\n    )\n      ? analysis.allConflicts\n      : [];\n\n  const priceConflicts =\n    conflicts.filter(\n      (\n        row:\n        Record<string, unknown>,\n      ) =>\n        row.category ===\n          \"PRICE_VALUE_DIFFERENCE\",\n    );\n\n  if (\n    priceConflicts.length !==\n    1\n  ) {\n    throw new Error(\n      `EXPECTED_EXACTLY_ONE_PRICE_CONFLICT_GOT_${priceConflicts.length}`,\n    );\n  }\n\n  const conflict =\n    priceConflicts[0] as\n      Record<string, any>;\n\n  const key =\n    String(\n      conflict.key,\n    );\n\n  const [\n    stockCode,\n    tradingDate,\n  ] =\n    key.split(\"|\");\n\n  if (\n    !stockCode ||\n    !tradingDate\n  ) {\n    throw new Error(\n      `INVALID_CONFLICT_KEY:${key}`,\n    );\n  }\n\n  const desiredRows =\n    Array.isArray(\n      plan.desiredRows,\n    )\n      ? plan.desiredRows\n      : [];\n\n  const desiredRow =\n    desiredRows.find(\n      (\n        row:\n        Record<string, unknown>,\n      ) =>\n        String(\n          row.stock_code,\n        ) ===\n          stockCode &&\n        String(\n          row.trading_date,\n        ) ===\n          tradingDate,\n    );\n\n  if (!desiredRow) {\n    throw new Error(\n      `DESIRED_ROW_NOT_FOUND:${key}`,\n    );\n  }\n\n  const config =\n    resolveSupabaseConfig();\n\n  const supabase =\n    createClient(\n      config.url,\n      config.key,\n      {\n        auth: {\n          persistSession:\n            false,\n\n          autoRefreshToken:\n            false,\n        },\n      },\n    );\n\n  const result =\n    await supabase\n      .from(\n        \"market_daily_bars\",\n      )\n      .select(\n        `\n          id,\n          stock_code,\n          trading_date,\n          open_price,\n          high_price,\n          low_price,\n          close_price,\n          volume,\n          trading_value,\n          source,\n          adjusted_price,\n          raw_payload,\n          collected_at,\n          created_at,\n          updated_at\n        `,\n      )\n      .eq(\n        \"stock_code\",\n        stockCode,\n      )\n      .eq(\n        \"trading_date\",\n        tradingDate,\n      );\n\n  if (result.error) {\n    throw new Error(\n      `CONFLICT_ROW_READ_FAILED:${result.error.message}`,\n    );\n  }\n\n  const dbRows =\n    result.data ??\n    [];\n\n  const existingRow =\n    dbRows[0] ??\n    null;\n\n  const existingClose =\n    existingRow\n      ? asNumber(\n          existingRow\n            .close_price,\n        )\n      : null;\n\n  const desiredClose =\n    asNumber(\n      desiredRow\n        .close_price,\n    );\n\n  const existingRaw =\n    rawPayloadSummary(\n      existingRow\n        ?.raw_payload,\n    );\n\n  const desiredRaw =\n    rawPayloadSummary(\n      desiredRow\n        .raw_payload,\n    );\n\n  const dbColumnMatchesDbRaw =\n    existingClose !==\n      null &&\n    existingRaw\n      ?.stck_clpr !==\n      null &&\n    existingClose ===\n      existingRaw\n        ?.stck_clpr;\n\n  const desiredColumnMatchesDesiredRaw =\n    desiredClose !==\n      null &&\n    desiredRaw\n      ?.stck_clpr !==\n      null &&\n    desiredClose ===\n      desiredRaw\n        ?.stck_clpr;\n\n  const rawProviderCloseChanged =\n    existingRaw\n      ?.stck_clpr !==\n      null &&\n    desiredRaw\n      ?.stck_clpr !==\n      null &&\n    existingRaw\n      ?.stck_clpr !==\n      desiredRaw\n        ?.stck_clpr;\n\n  let interpretation:\n    Record<\n      string,\n      unknown\n    >;\n\n  if (\n    dbColumnMatchesDbRaw &&\n    desiredColumnMatchesDesiredRaw &&\n    rawProviderCloseChanged\n  ) {\n    interpretation = {\n      classification:\n        \"KIS_PROVIDER_HISTORY_VALUE_CHANGED_BETWEEN_COLLECTIONS\",\n\n      existingRowInternallyConsistent:\n        true,\n\n      desiredRowInternallyConsistent:\n        true,\n\n      safeToBlindOverwrite:\n        false,\n\n      recommendedPolicy:\n        \"PRESERVE_EXISTING_ROW_AND_INSERT_ONLY_MISSING_ROWS_UNTIL_PROVIDER_REVISION_POLICY_IS_EXPLICIT\",\n    };\n  } else if (\n    !dbColumnMatchesDbRaw &&\n    desiredColumnMatchesDesiredRaw\n  ) {\n    interpretation = {\n      classification:\n        \"EXISTING_DB_COLUMN_RAW_PAYLOAD_INCONSISTENCY\",\n\n      existingRowInternallyConsistent:\n        false,\n\n      desiredRowInternallyConsistent:\n        true,\n\n      safeToBlindOverwrite:\n        false,\n\n      recommendedPolicy:\n        \"REVIEW_EXISTING_DB_CORRUPTION_OR_LEGACY_TRANSFORM_BEFORE_REPAIR\",\n    };\n  } else if (\n    dbColumnMatchesDbRaw &&\n    !desiredColumnMatchesDesiredRaw\n  ) {\n    interpretation = {\n      classification:\n        \"DESIRED_PLAN_CONVERSION_INCONSISTENCY\",\n\n      existingRowInternallyConsistent:\n        true,\n\n      desiredRowInternallyConsistent:\n        false,\n\n      safeToBlindOverwrite:\n        false,\n\n      recommendedPolicy:\n        \"FIX_PLAN_CONVERSION_DO_NOT_WRITE\",\n    };\n  } else {\n    interpretation = {\n      classification:\n        \"UNRESOLVED_SINGLE_ROW_CONFLICT\",\n\n      existingRowInternallyConsistent:\n        dbColumnMatchesDbRaw,\n\n      desiredRowInternallyConsistent:\n        desiredColumnMatchesDesiredRaw,\n\n      safeToBlindOverwrite:\n        false,\n\n      recommendedPolicy:\n        \"DO_NOT_WRITE_CONFLICTING_ROW\",\n    };\n  }\n\n  const report = {\n    status:\n      \"ALPHA_V1_SINGLE_PRICE_CONFLICT_LINEAGE_TRACE_COMPLETE\",\n\n    version:\n      VERSION,\n\n    authMode:\n      config.authMode,\n\n    conflictKey:\n      key,\n\n    stockCode,\n    tradingDate,\n\n    classifierConflict: {\n      differingFields:\n        conflict\n          .differingFields ??\n        null,\n\n      existingSemantic:\n        conflict.existing ??\n        null,\n\n      desiredSemantic:\n        conflict.desired ??\n        null,\n    },\n\n    database: {\n      rowCount:\n        dbRows.length,\n\n      row:\n        existingRow\n          ? {\n              id:\n                existingRow.id,\n\n              stock_code:\n                existingRow\n                  .stock_code,\n\n              trading_date:\n                existingRow\n                  .trading_date,\n\n              open_price:\n                asNumber(\n                  existingRow\n                    .open_price,\n                ),\n\n              high_price:\n                asNumber(\n                  existingRow\n                    .high_price,\n                ),\n\n              low_price:\n                asNumber(\n                  existingRow\n                    .low_price,\n                ),\n\n              close_price:\n                existingClose,\n\n              volume:\n                asNumber(\n                  existingRow\n                    .volume,\n                ),\n\n              trading_value:\n                asNumber(\n                  existingRow\n                    .trading_value,\n                ),\n\n              source:\n                existingRow\n                  .source,\n\n              adjusted_price:\n                existingRow\n                  .adjusted_price,\n\n              collected_at:\n                existingRow\n                  .collected_at,\n\n              created_at:\n                existingRow\n                  .created_at,\n\n              updated_at:\n                existingRow\n                  .updated_at,\n\n              rawPayload:\n                existingRaw,\n            }\n          : null,\n    },\n\n    desiredFromPlan: {\n      stock_code:\n        desiredRow\n          .stock_code,\n\n      trading_date:\n        desiredRow\n          .trading_date,\n\n      open_price:\n        asNumber(\n          desiredRow\n            .open_price,\n        ),\n\n      high_price:\n        asNumber(\n          desiredRow\n            .high_price,\n        ),\n\n      low_price:\n        asNumber(\n          desiredRow\n            .low_price,\n        ),\n\n      close_price:\n        desiredClose,\n\n      volume:\n        asNumber(\n          desiredRow\n            .volume,\n        ),\n\n      trading_value:\n        asNumber(\n          desiredRow\n            .trading_value,\n        ),\n\n      source:\n        desiredRow\n          .source,\n\n      adjusted_price:\n        desiredRow\n          .adjusted_price,\n\n      collected_at:\n        desiredRow\n          .collected_at,\n\n      updated_at:\n        desiredRow\n          .updated_at,\n\n      rawPayload:\n        desiredRaw,\n    },\n\n    consistency: {\n      dbColumnMatchesDbRaw,\n      desiredColumnMatchesDesiredRaw,\n      rawProviderCloseChanged,\n\n      closeDifference:\n        existingClose !==\n          null &&\n        desiredClose !==\n          null\n          ? desiredClose -\n            existingClose\n          : null,\n\n      closeDifferenceRate:\n        existingClose !==\n          null &&\n        desiredClose !==\n          null &&\n        existingClose !==\n          0\n          ? (\n              desiredClose -\n              existingClose\n            ) /\n            existingClose\n          : null,\n    },\n\n    interpretation,\n\n    safeApplyPolicyCandidate: {\n      missingRowsOnly:\n        true,\n\n      metadataOnlyExistingRows:\n        \"PRESERVE\",\n\n      conflictingExistingRow:\n        \"PRESERVE_PENDING_EXPLICIT_PROVIDER_REVISION_POLICY\",\n\n      deletes:\n        0,\n\n      overwrites:\n        0,\n\n      expectedInsertRows:\n        plan.plan\n          ?.insertCount ??\n        null,\n    },\n\n    safety: {\n      databaseReads:\n        1,\n\n      databaseWrites:\n        0,\n\n      networkRequests:\n        1,\n\n      kisRequests:\n        0,\n\n      deletes:\n        0,\n\n      ordersCreated:\n        0,\n\n      positionsChanged:\n        0,\n\n      productionDecisionApplied:\n        false,\n    },\n\n    nextGate:\n      \"ALPHA_V1_DECIDE_INSERT_ONLY_33_ROWS_AFTER_SINGLE_CONFLICT_LINEAGE_REVIEW\",\n  };\n\n  fs.mkdirSync(\n    path.dirname(\n      OUTPUT_FILE,\n    ),\n    {\n      recursive:\n        true,\n    },\n  );\n\n  fs.writeFileSync(\n    OUTPUT_FILE,\n    JSON.stringify(\n      report,\n      null,\n      2,\n    ) + \"\\n\",\n    \"utf8\",\n  );\n\n  console.log(\n    JSON.stringify(\n      report,\n      null,\n      2,\n    ),\n  );\n}\n\nmain().catch(\n  (error) => {\n    console.error(\n      JSON.stringify(\n        {\n          status:\n            \"ALPHA_V1_SINGLE_PRICE_CONFLICT_LINEAGE_TRACE_FAILED\",\n\n          version:\n            VERSION,\n\n          error:\n            String(\n              error instanceof Error\n                ? error.message\n                : error,\n            ),\n\n          safety: {\n            databaseWrites:\n              0,\n\n            kisRequests:\n              0,\n\n            ordersCreated:\n              0,\n          },\n        },\n        null,\n        2,\n      ),\n    );\n\n    process.exitCode =\n      2;\n  },\n);\n";

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
      'alpha-v1-single-price-conflict-lineage-trace.ts',
    );

  atomicWrite(
    target,
    script,
  );

  console.log(
    JSON.stringify(
      {
        status:
          'ALPHA_V1_SINGLE_PRICE_CONFLICT_LINEAGE_TRACE_FIXED',

        version:
          VERSION,

        overwrittenFile:
          'scripts/alpha-v1-single-price-conflict-lineage-trace.ts',

        expectedRuntimeStatus:
          'ALPHA_V1_SINGLE_PRICE_CONFLICT_LINEAGE_TRACE_COMPLETE',

        safety: {
          databaseWrites:
            0,

          kisRequests:
            0,

          deletes:
            0,

          ordersCreated:
            0,
        },

        nextAction:
          'RUN_FIXED_SINGLE_PRICE_CONFLICT_LINEAGE_TRACE',
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
          'ALPHA_V1_SINGLE_PRICE_CONFLICT_LINEAGE_TRACE_FIX_FAILED',

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
