#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VERSION =
  'ALPHA_V1_HISTORICAL_FLOW_PERSISTENCE_VERIFY_INSTALLER';

const source =
"import {\n  createSupabaseServerClient,\n} from \"../lib/supabase\";\n\nconst VERSION =\n  \"ALPHA_V1_HISTORICAL_FLOW_PERSISTENCE_VERIFY\";\n\nconst START_DATE =\n  \"2026-07-30\";\n\nconst END_DATE =\n  \"2026-10-02\";\n\nasync function main() {\n  const supabase =\n    createSupabaseServerClient();\n\n  const stocksResult =\n    await supabase\n      .from(\"stocks\")\n      .select(\"stock_code\")\n      .eq(\"is_active\", true)\n      .order(\"stock_code\");\n\n  if (stocksResult.error) {\n    throw new Error(\n      `ACTIVE_STOCK_READ_FAILED:${stocksResult.error.message}`,\n    );\n  }\n\n  const stockCodes =\n    (stocksResult.data ?? [])\n      .map((row) => String(row.stock_code));\n\n  const flowResult =\n    await supabase\n      .from(\"kis_investor_flow_daily\")\n      .select(\"stock_code,trading_date\")\n      .gte(\"trading_date\", START_DATE)\n      .lte(\"trading_date\", END_DATE)\n      .order(\"trading_date\");\n\n  if (flowResult.error) {\n    throw new Error(\n      `FLOW_TABLE_READ_FAILED:${flowResult.error.message}`,\n    );\n  }\n\n  const rows =\n    flowResult.data ?? [];\n\n  const byStock =\n    stockCodes.map(\n      (stockCode) => {\n        const dates =\n          rows\n            .filter(\n              (row) =>\n                String(row.stock_code) ===\n                stockCode,\n            )\n            .map(\n              (row) =>\n                String(row.trading_date),\n            )\n            .sort();\n\n        return {\n          stockCode,\n          rowCount:\n            dates.length,\n          earliest:\n            dates[0] ?? null,\n          latest:\n            dates.at(-1) ?? null,\n        };\n      },\n    );\n\n  const ready =\n    stockCodes.length > 0 &&\n    rows.length > 0 &&\n    byStock.every(\n      (row) =>\n        row.rowCount > 0 &&\n        row.earliest === START_DATE &&\n        row.latest === END_DATE,\n    );\n\n  console.log(\n    JSON.stringify(\n      {\n        status:\n          \"ALPHA_V1_HISTORICAL_FLOW_PERSISTENCE_VERIFY_COMPLETE\",\n        version:\n          VERSION,\n        table:\n          \"kis_investor_flow_daily\",\n        totalRows:\n          rows.length,\n        activeStockCount:\n          stockCodes.length,\n        byStock,\n        ready,\n        blocker:\n          ready\n            ? null\n            : \"HISTORICAL_FLOW_PERSISTENCE_INCOMPLETE\",\n        nextGate:\n          ready\n            ? \"ALPHA_V1_FULL_HISTORICAL_REPLAY_READY\"\n            : \"ALPHA_V1_REPAIR_HISTORICAL_FLOW_PERSISTENCE\",\n        safety: {\n          databaseWrites: 0,\n          ordersCreated: 0,\n          positionsChanged: 0,\n        },\n      },\n      null,\n      2,\n    ),\n  );\n}\n\nmain().catch(\n  (error) => {\n    console.error(\n      JSON.stringify(\n        {\n          status:\n            \"ALPHA_V1_HISTORICAL_FLOW_PERSISTENCE_VERIFY_FAILED\",\n          version:\n            VERSION,\n          error:\n            String(\n              error instanceof Error\n                ? error.message\n                : error,\n            ),\n          databaseWrites: 0,\n          ordersCreated: 0,\n        },\n        null,\n        2,\n      ),\n    );\n\n    process.exitCode =\n      2;\n  },\n);\n";

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
      'alpha-v1-historical-flow-persistence-verify.ts',
    );

  fs.writeFileSync(
    target,
    source,
    'utf8',
  );

  console.log(
    JSON.stringify(
      {
        status:
          'ALPHA_V1_HISTORICAL_FLOW_PERSISTENCE_VERIFY_INSTALLED',
        version:
          VERSION,
        generatedFile:
          'scripts/alpha-v1-historical-flow-persistence-verify.ts',
        nextAction:
          'RUN_FLOW_PERSISTENCE_VERIFY',
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
          'ALPHA_V1_HISTORICAL_FLOW_PERSISTENCE_VERIFY_INSTALL_FAILED',
        error:
          String(error?.message ?? error),
      },
      null,
      2,
    ),
  );

  process.exitCode = 2;
}
