#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root =
  path.resolve(
    __dirname,
    '..',
  );

const target =
  path.join(
    root,
    'scripts',
    'alpha-v1-historical-replay-date-blocker-diag.ts',
  );

fs.writeFileSync(
  target,
  "import fs from \"node:fs\";\nimport path from \"node:path\";\n\nimport {\n  createSupabaseServerClient,\n} from \"../lib/supabase\";\n\nconst START =\n  \"2026-07-30\";\n\nconst END =\n  \"2026-10-02\";\n\nconst FLOW_LOOKBACK =\n  7;\n\nasync function main() {\n  const supabase =\n    createSupabaseServerClient();\n\n  const {\n    data: stocks,\n    error: stockError,\n  } =\n    await supabase\n      .from(\"stocks\")\n      .select(\"stock_code\")\n      .eq(\"is_active\", true)\n      .order(\"stock_code\");\n\n  if (stockError) {\n    throw stockError;\n  }\n\n  const stockCodes =\n    (stocks ?? [])\n      .map((row) =>\n        String(row.stock_code)\n      );\n\n  const {\n    data: predictions,\n    error: predictionError,\n  } =\n    await supabase\n      .from(\"ai_stock_predictions\")\n      .select(\"prediction_date,generated_at\")\n      .gte(\"prediction_date\", START)\n      .lte(\"prediction_date\", END)\n      .order(\"prediction_date\")\n      .order(\"generated_at\");\n\n  if (predictionError) {\n    throw predictionError;\n  }\n\n  const byDate =\n    new Map<\n      string,\n      string[]\n    >();\n\n  for (const row of predictions ?? []) {\n    const date =\n      String(row.prediction_date);\n\n    const arr =\n      byDate.get(date) ?? [];\n\n    arr.push(\n      String(row.generated_at)\n    );\n\n    byDate.set(\n      date,\n      arr,\n    );\n  }\n\n  const rows = [];\n\n  for (const [date, times] of byDate) {\n    const decisionAt =\n      [...times]\n        .sort()\n        .at(-1)!;\n\n    const snapshotResult =\n      await supabase\n        .from(\"market_snapshots\")\n        .select(\n          \"stock_code\",\n          {\n            count: \"exact\",\n            head: true,\n          },\n        )\n        .gte(\n          \"observed_at\",\n          `${date}T00:00:00.000Z`,\n        )\n        .lte(\n          \"observed_at\",\n          decisionAt,\n        );\n\n    if (snapshotResult.error) {\n      throw snapshotResult.error;\n    }\n\n    const flowResult =\n      await supabase\n        .from(\"kis_investor_flow_daily\")\n        .select(\"stock_code,trading_date\")\n        .lt(\"trading_date\", date)\n        .order(\n          \"trading_date\",\n          {\n            ascending: false,\n          },\n        )\n        .limit(\n          stockCodes.length *\n            FLOW_LOOKBACK,\n        );\n\n    if (flowResult.error) {\n      throw flowResult.error;\n    }\n\n    const counts =\n      new Map<\n        string,\n        number\n      >();\n\n    for (const row of flowResult.data ?? []) {\n      const code =\n        String(row.stock_code);\n\n      counts.set(\n        code,\n        (counts.get(code) ?? 0) + 1,\n      );\n    }\n\n    const flowMin =\n      stockCodes.length\n        ? Math.min(\n            ...stockCodes.map(\n              (code) =>\n                counts.get(code) ?? 0,\n            ),\n          )\n        : 0;\n\n    const snapshotRows =\n      snapshotResult.count ?? 0;\n\n    const blockers: string[] = [];\n\n    if (\n      flowMin <\n      FLOW_LOOKBACK\n    ) {\n      blockers.push(\n        \"FLOW_LOOKBACK_LT_7\",\n      );\n    }\n\n    if (\n      snapshotRows ===\n      0\n    ) {\n      blockers.push(\n        \"NO_SNAPSHOT_BEFORE_DECISION\",\n      );\n    }\n\n    rows.push({\n      date,\n      decisionAt,\n      snapshotRows,\n      priorFlowRowsMinimum:\n        flowMin,\n      replayReady:\n        blockers.length === 0,\n      blockers,\n    });\n  }\n\n  const summary = {\n    totalPredictionDates:\n      rows.length,\n\n    replayReadyDates:\n      rows.filter(\n        (row) =>\n          row.replayReady,\n      ).length,\n\n    noSnapshotDates:\n      rows.filter(\n        (row) =>\n          row.blockers.includes(\n            \"NO_SNAPSHOT_BEFORE_DECISION\",\n          ),\n      ).length,\n\n    flowLookbackDates:\n      rows.filter(\n        (row) =>\n          row.blockers.includes(\n            \"FLOW_LOOKBACK_LT_7\",\n          ),\n      ).length,\n  };\n\n  const report = {\n    status:\n      \"ALPHA_V1_HISTORICAL_REPLAY_DATE_BLOCKER_DIAG_COMPLETE\",\n    summary,\n    rows,\n    safety: {\n      databaseWrites: 0,\n      ordersCreated: 0,\n    },\n  };\n\n  const out =\n    path.resolve(\n      process.cwd(),\n      \"logs\",\n      \"alpha-v1-historical-replay-date-blocker-diag.json\",\n    );\n\n  fs.mkdirSync(\n    path.dirname(out),\n    {\n      recursive: true,\n    },\n  );\n\n  fs.writeFileSync(\n    out,\n    JSON.stringify(\n      report,\n      null,\n      2,\n    ) + \"\\n\",\n    \"utf8\",\n  );\n\n  console.log(\n    JSON.stringify(\n      {\n        status:\n          report.status,\n        ...summary,\n        blockedDates:\n          rows\n            .filter(\n              (row) =>\n                !row.replayReady,\n            )\n            .map(\n              (row) => ({\n                date:\n                  row.date,\n                snapshotRows:\n                  row.snapshotRows,\n                flowMin:\n                  row.priorFlowRowsMinimum,\n                blockers:\n                  row.blockers,\n              }),\n            ),\n        outputFile:\n          \"logs/alpha-v1-historical-replay-date-blocker-diag.json\",\n      },\n      null,\n      2,\n    ),\n  );\n}\n\nmain().catch(\n  (error) => {\n    console.error(\n      JSON.stringify(\n        {\n          status:\n            \"ALPHA_V1_HISTORICAL_REPLAY_DATE_BLOCKER_DIAG_FAILED\",\n          error:\n            String(\n              error instanceof Error\n                ? error.message\n                : error,\n            ),\n        },\n        null,\n        2,\n      ),\n    );\n\n    process.exitCode =\n      2;\n  },\n);\n",
  'utf8',
);

console.log(
  JSON.stringify(
    {
      status:
        'ALPHA_V1_HISTORICAL_REPLAY_DATE_BLOCKER_DIAG_INSTALLED',
      generatedFile:
        'scripts/alpha-v1-historical-replay-date-blocker-diag.ts',
      nextAction:
        'RUN_DATE_BLOCKER_DIAG',
    },
    null,
    2,
  ),
);
