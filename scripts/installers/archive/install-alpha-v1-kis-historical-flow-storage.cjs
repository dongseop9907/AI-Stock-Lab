#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VERSION =
  'ALPHA_V1_KIS_HISTORICAL_FLOW_STORAGE_INSTALLER';

const migration =
  "create table if not exists public.kis_investor_flow_daily (\n  stock_code text not null,\n  trading_date date not null,\n\n  close_price numeric null,\n  accumulated_volume numeric null,\n  accumulated_trading_value numeric null,\n\n  individual_net_buy_quantity numeric null,\n  foreign_net_buy_quantity numeric null,\n  institution_net_buy_quantity numeric null,\n\n  individual_net_buy_amount numeric null,\n  foreign_net_buy_amount numeric null,\n  institution_net_buy_amount numeric null,\n\n  source text not null default 'KIS_INVESTOR_TRADE_BY_STOCK_DAILY',\n  source_version text not null default 'FHPTJ04160001',\n\n  collected_at timestamptz not null default now(),\n  raw_payload jsonb null,\n\n  primary key (stock_code, trading_date)\n);\n\ncreate index if not exists kis_investor_flow_daily_trading_date_idx\n  on public.kis_investor_flow_daily (trading_date);\n\ncreate index if not exists kis_investor_flow_daily_stock_date_idx\n  on public.kis_investor_flow_daily (stock_code, trading_date desc);\n";

const backfill =
  "import fs from \"node:fs\";\nimport path from \"node:path\";\n\nimport {\n  createSupabaseServerClient,\n} from \"../lib/supabase\";\n\nconst VERSION =\n  \"ALPHA_V1_KIS_HISTORICAL_FLOW_CONTROLLED_BACKFILL\";\n\nconst INPUT_FILE =\n  path.resolve(\n    process.cwd(),\n    \"logs\",\n    \"alpha-v1-kis-historical-flow-coverage-read-only.json\",\n  );\n\nconst WRITE_ENABLED =\n  process.argv.includes(\n    \"--write\",\n  );\n\nconst RANGE_START =\n  \"20260730\";\n\nconst RANGE_END =\n  \"20261002\";\n\nfunction compactDate(\n  value: string,\n) {\n  return value\n    .replace(\n      /-/g,\n      \"\",\n    )\n    .trim();\n}\n\nfunction isoDate(\n  value: string,\n) {\n  const normalized =\n    compactDate(\n      value,\n    );\n\n  return `${normalized.slice(0,4)}-${normalized.slice(4,6)}-${normalized.slice(6,8)}`;\n}\n\nasync function main() {\n  const report =\n    JSON.parse(\n      fs.readFileSync(\n        INPUT_FILE,\n        \"utf8\",\n      ),\n    );\n\n  if (\n    report\n      ?.backfillDecision\n      ?.historicalFlowCoverageProven !==\n    true\n  ) {\n    throw new Error(\n      \"HISTORICAL_FLOW_COVERAGE_NOT_PROVEN\",\n    );\n  }\n\n  const sourceRows =\n    Array.isArray(\n      report.normalizedRows,\n    )\n      ? report.normalizedRows\n      : [];\n\n  const unique =\n    new Map<\n      string,\n      any\n    >();\n\n  for (\n    const row\n    of sourceRows\n  ) {\n    const stockCode =\n      String(\n        row.stockCode ??\n        \"\",\n      );\n\n    const tradingDate =\n      String(\n        row.tradingDate ??\n        \"\",\n      );\n\n    if (\n      !/^\\d{6}$/.test(\n        stockCode,\n      ) ||\n      !/^\\d{8}$/.test(\n        tradingDate,\n      )\n    ) {\n      continue;\n    }\n\n    if (\n      tradingDate <\n        RANGE_START ||\n      tradingDate >\n        RANGE_END\n    ) {\n      continue;\n    }\n\n    unique.set(\n      `${stockCode}|${tradingDate}`,\n      {\n        stock_code:\n          stockCode,\n\n        trading_date:\n          isoDate(\n            tradingDate,\n          ),\n\n        close_price:\n          row.closePrice ??\n          null,\n\n        accumulated_volume:\n          row.accumulatedVolume ??\n          null,\n\n        accumulated_trading_value:\n          row.accumulatedTradingValue ??\n          null,\n\n        individual_net_buy_quantity:\n          row.individualNetBuyQuantity ??\n          null,\n\n        foreign_net_buy_quantity:\n          row.foreignNetBuyQuantity ??\n          null,\n\n        institution_net_buy_quantity:\n          row.institutionNetBuyQuantity ??\n          null,\n\n        individual_net_buy_amount:\n          row.individualNetBuyAmount ??\n          null,\n\n        foreign_net_buy_amount:\n          row.foreignNetBuyAmount ??\n          null,\n\n        institution_net_buy_amount:\n          row.institutionNetBuyAmount ??\n          null,\n\n        source:\n          \"KIS_INVESTOR_TRADE_BY_STOCK_DAILY\",\n\n        source_version:\n          \"FHPTJ04160001\",\n\n        raw_payload:\n          row,\n      },\n    );\n  }\n\n  const rows =\n    [...unique.values()]\n      .sort(\n        (\n          a,\n          b,\n        ) =>\n          `${a.stock_code}|${a.trading_date}`\n            .localeCompare(\n              `${b.stock_code}|${b.trading_date}`,\n            ),\n      );\n\n  const result: any = {\n    status:\n      WRITE_ENABLED\n        ? \"ALPHA_V1_KIS_HISTORICAL_FLOW_BACKFILL_COMPLETE\"\n        : \"ALPHA_V1_KIS_HISTORICAL_FLOW_BACKFILL_DRY_RUN_COMPLETE\",\n\n    version:\n      VERSION,\n\n    writeEnabled:\n      WRITE_ENABLED,\n\n    inputRows:\n      sourceRows.length,\n\n    eligibleUniqueRows:\n      rows.length,\n\n    range: {\n      start:\n        RANGE_START,\n\n      end:\n        RANGE_END,\n    },\n\n    safety: {\n      databaseWrites:\n        0,\n\n      ordersCreated:\n        0,\n\n      positionsChanged:\n        0,\n    },\n  };\n\n  if (\n    !WRITE_ENABLED\n  ) {\n    console.log(\n      JSON.stringify(\n        result,\n        null,\n        2,\n      ),\n    );\n\n    return;\n  }\n\n  const supabase =\n    createSupabaseServerClient();\n\n  const chunkSize =\n    200;\n\n  let written =\n    0;\n\n  for (\n    let index =\n      0;\n    index <\n      rows.length;\n    index +=\n      chunkSize\n  ) {\n    const chunk =\n      rows.slice(\n        index,\n        index +\n        chunkSize,\n      );\n\n    const write =\n      await supabase\n        .from(\n          \"kis_investor_flow_daily\",\n        )\n        .upsert(\n          chunk,\n          {\n            onConflict:\n              \"stock_code,trading_date\",\n\n            ignoreDuplicates:\n              false,\n          },\n        );\n\n    if (\n      write.error\n    ) {\n      throw new Error(\n        `HISTORICAL_FLOW_UPSERT_FAILED:${write.error.message}`,\n      );\n    }\n\n    written +=\n      chunk.length;\n  }\n\n  result.writtenRows =\n    written;\n\n  result.safety.databaseWrites =\n    written;\n\n  console.log(\n    JSON.stringify(\n      result,\n      null,\n      2,\n    ),\n  );\n}\n\nmain().catch(\n  (\n    error,\n  ) => {\n    console.error(\n      JSON.stringify(\n        {\n          status:\n            \"ALPHA_V1_KIS_HISTORICAL_FLOW_BACKFILL_FAILED\",\n\n          version:\n            VERSION,\n\n          writeEnabled:\n            WRITE_ENABLED,\n\n          error:\n            String(\n              error instanceof Error\n                ? error.message\n                : error,\n            ),\n\n          ordersCreated:\n            0,\n\n          positionsChanged:\n            0,\n        },\n        null,\n        2,\n      ),\n    );\n\n    process.exitCode =\n      2;\n  },\n);\n";

function write(
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

  fs.writeFileSync(
    file,
    content,
    'utf8',
  );
}

try {
  const root =
    path.resolve(
      __dirname,
      '..',
    );

  write(
    path.join(
      root,
      'supabase',
      'migrations',
      '20261006_alpha_v1_kis_investor_flow_daily.sql',
    ),
    migration,
  );

  write(
    path.join(
      root,
      'scripts',
      'alpha-v1-kis-historical-flow-controlled-backfill.ts',
    ),
    backfill,
  );

  console.log(
    JSON.stringify(
      {
        status:
          'ALPHA_V1_KIS_HISTORICAL_FLOW_STORAGE_INSTALLED',

        version:
          VERSION,

        generatedFiles: [
          'supabase/migrations/20261006_alpha_v1_kis_investor_flow_daily.sql',
          'scripts/alpha-v1-kis-historical-flow-controlled-backfill.ts',
        ],

        backfillDefault:
          'DRY_RUN',

        writeRequires:
          '--write',

        nextAction:
          'APPLY_MIGRATION_THEN_RUN_DRY_RUN',
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
          'ALPHA_V1_KIS_HISTORICAL_FLOW_STORAGE_INSTALL_FAILED',

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
