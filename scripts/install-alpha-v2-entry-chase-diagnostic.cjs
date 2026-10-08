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
    'alpha-v2-entry-chase-diagnostic.ts',
  ),
  "import fs from \"node:fs\";\nimport path from \"node:path\";\n\nimport {\n  createSupabaseServerClient,\n} from \"../lib/supabase\";\n\nfunction avg(values: number[]): number | null {\n  return values.length\n    ? values.reduce((a, b) => a + b, 0) / values.length\n    : null;\n}\n\nfunction summarize(rows: any[]) {\n  const horizons = [\"r1\", \"r3\", \"r5\"] as const;\n\n  const meanReturn: Record<string, number | null> = {};\n  const positiveRate: Record<string, number | null> = {};\n\n  for (const horizon of horizons) {\n    const values = rows\n      .map((row) => row.correctedEntry?.returns?.[horizon])\n      .filter(Number.isFinite) as number[];\n\n    meanReturn[horizon] = avg(values);\n\n    positiveRate[horizon] = values.length\n      ? values.filter((value) => value > 0).length / values.length\n      : null;\n  }\n\n  return {\n    selectedSessions: rows.length,\n    meanReturn,\n    positiveRate,\n    averageDelayMinutes:\n      avg(\n        rows\n          .map((row) => row.delayMinutes)\n          .filter(Number.isFinite),\n      ),\n    averageEntryPremiumOverOpen:\n      avg(\n        rows\n          .map((row) => row.entryPremiumOverOpen)\n          .filter(Number.isFinite),\n      ),\n  };\n}\n\nasync function main() {\n  const root = process.cwd();\n\n  const inputPath = path.join(\n    root,\n    \"logs\",\n    \"alpha-v2-expanded-entry-comparison.json\",\n  );\n\n  if (!fs.existsSync(inputPath)) {\n    throw new Error(\n      \"EXPANDED_ENTRY_COMPARISON_LOG_NOT_FOUND\",\n    );\n  }\n\n  const expanded = JSON.parse(\n    fs.readFileSync(inputPath, \"utf8\"),\n  );\n\n  const full381 = (expanded.results ?? [])\n    .filter(\n      (row: any) =>\n        row.snapshotCount === 381,\n    );\n\n  if (!full381.length) {\n    throw new Error(\n      \"NO_FULL_381_SESSIONS\",\n    );\n  }\n\n  const stockCodes = [\n    ...new Set(\n      full381.map(\n        (row: any) =>\n          String(row.stockCode),\n      ),\n    ),\n  ];\n\n  const sessionDates = full381\n    .map(\n      (row: any) =>\n        String(row.targetSessionDate),\n    )\n    .sort();\n\n  const supabase =\n    createSupabaseServerClient();\n\n  const {\n    data,\n    error,\n  } = await supabase\n    .from(\"market_daily_bars\")\n    .select(\n      \"stock_code,trading_date,open_price,adjusted_price\",\n    )\n    .in(\"stock_code\", stockCodes)\n    .eq(\"adjusted_price\", true)\n    .gte(\"trading_date\", sessionDates[0])\n    .lte(\n      \"trading_date\",\n      sessionDates.at(-1)!,\n    )\n    .order(\"stock_code\")\n    .order(\"trading_date\")\n    .limit(10000);\n\n  if (error) {\n    throw error;\n  }\n\n  const openByKey =\n    new Map<string, number>();\n\n  for (const row of data ?? []) {\n    const open = Number(row.open_price);\n\n    if (\n      Number.isFinite(open) &&\n      open > 0\n    ) {\n      openByKey.set(\n        `${String(row.stock_code)}|${String(row.trading_date)}`,\n        open,\n      );\n    }\n  }\n\n  const rows = full381.map(\n    (row: any) => {\n      const open =\n        openByKey.get(\n          `${row.stockCode}|${row.targetSessionDate}`,\n        ) ?? null;\n\n      const entry =\n        row.correctedEntry;\n\n      const observedAt =\n        entry?.observedAt ?? null;\n\n      const entryPrice =\n        Number(\n          entry?.entryPrice,\n        );\n\n      const delayMinutes =\n        observedAt\n          ? (\n              new Date(observedAt).getTime() -\n              new Date(\n                `${row.targetSessionDate}T09:00:00+09:00`,\n              ).getTime()\n            ) / 60000\n          : null;\n\n      const entryPremiumOverOpen =\n        open !== null &&\n        Number.isFinite(entryPrice) &&\n        entryPrice > 0\n          ? entryPrice / open - 1\n          : null;\n\n      return {\n        alphaDate:\n          row.alphaDate,\n\n        stockCode:\n          row.stockCode,\n\n        targetSessionDate:\n          row.targetSessionDate,\n\n        sessionOpen:\n          open,\n\n        correctedQualified:\n          entry?.qualified === true,\n\n        correctedEntry:\n          entry,\n\n        delayMinutes,\n\n        entryPremiumOverOpen,\n      };\n    },\n  );\n\n  const qualified = rows.filter(\n    (row: any) =>\n      row.correctedQualified &&\n      Number.isFinite(row.delayMinutes) &&\n      Number.isFinite(row.entryPremiumOverOpen),\n  );\n\n  const premiumCaps = [\n    0.0025,\n    0.005,\n    0.0075,\n    0.01,\n    0.015,\n  ];\n\n  const delayCaps = [\n    10,\n    20,\n    30,\n    45,\n    60,\n  ];\n\n  const premiumCapResults =\n    premiumCaps.map(\n      (cap) => ({\n        maxPremium:\n          cap,\n\n        ...summarize(\n          qualified.filter(\n            (row: any) =>\n              row.entryPremiumOverOpen <= cap,\n          ),\n        ),\n      }),\n    );\n\n  const delayCapResults =\n    delayCaps.map(\n      (cap) => ({\n        maxDelayMinutes:\n          cap,\n\n        ...summarize(\n          qualified.filter(\n            (row: any) =>\n              row.delayMinutes <= cap,\n          ),\n        ),\n      }),\n    );\n\n  const combinedPolicies = [\n    {\n      maxDelayMinutes: 20,\n      maxPremium: 0.005,\n    },\n    {\n      maxDelayMinutes: 30,\n      maxPremium: 0.005,\n    },\n    {\n      maxDelayMinutes: 30,\n      maxPremium: 0.0075,\n    },\n    {\n      maxDelayMinutes: 45,\n      maxPremium: 0.0075,\n    },\n    {\n      maxDelayMinutes: 60,\n      maxPremium: 0.01,\n    },\n  ].map((policy) => ({\n    ...policy,\n\n    ...summarize(\n      qualified.filter(\n        (row: any) =>\n          row.delayMinutes <= policy.maxDelayMinutes &&\n          row.entryPremiumOverOpen <= policy.maxPremium,\n      ),\n    ),\n  }));\n\n  const result = {\n    status:\n      \"ALPHA_V2_ENTRY_CHASE_DIAGNOSTIC_COMPLETE\",\n\n    counts: {\n      full381Sessions:\n        rows.length,\n\n      correctedQualifiedSessions:\n        qualified.length,\n\n      rejectedSessions:\n        rows.length -\n        qualified.length,\n    },\n\n    baselineCorrectedQualified:\n      summarize(\n        qualified,\n      ),\n\n    premiumCapResults,\n\n    delayCapResults,\n\n    combinedPolicies,\n\n    perSession:\n      qualified.map(\n        (row: any) => ({\n          alphaDate:\n            row.alphaDate,\n\n          stockCode:\n            row.stockCode,\n\n          targetSessionDate:\n            row.targetSessionDate,\n\n          delayMinutes:\n            row.delayMinutes,\n\n          entryPremiumOverOpen:\n            row.entryPremiumOverOpen,\n\n          entryScore:\n            row.correctedEntry?.score ?? null,\n\n          returns:\n            row.correctedEntry?.returns ?? null,\n        }),\n      ),\n\n    interpretationRule: {\n      purpose:\n        \"Diagnose whether Entry underperformance is primarily caused by late/chasing execution.\",\n\n      productionThresholdSelectionAllowed:\n        false,\n\n      reason:\n        \"Only 12 full one-minute sessions exist; use this as directional evidence, not final parameter fitting.\",\n    },\n\n    safety: {\n      databaseReadsOnly:\n        true,\n\n      databaseWrites:\n        0,\n\n      ordersCreated:\n        0,\n\n      positionsChanged:\n        0,\n\n      productionChanged:\n        false,\n    },\n\n    nextGate:\n      \"DECIDE_IF_ENTRY_V3_SHOULD_ADD_NO_CHASE_AND_MAX_DELAY_POLICY\",\n  };\n\n  fs.writeFileSync(\n    path.join(\n      root,\n      \"logs\",\n      \"alpha-v2-entry-chase-diagnostic.json\",\n    ),\n    JSON.stringify(\n      result,\n      null,\n      2,\n    ) + \"\\n\",\n    \"utf8\",\n  );\n\n  console.log(\n    JSON.stringify(\n      {\n        status:\n          result.status,\n\n        counts:\n          result.counts,\n\n        baselineCorrectedQualified:\n          result.baselineCorrectedQualified,\n\n        premiumCapResults:\n          result.premiumCapResults,\n\n        delayCapResults:\n          result.delayCapResults,\n\n        combinedPolicies:\n          result.combinedPolicies,\n\n        nextGate:\n          result.nextGate,\n\n        outputFile:\n          \"logs/alpha-v2-entry-chase-diagnostic.json\",\n      },\n      null,\n      2,\n    ),\n  );\n}\n\nmain().catch((error) => {\n  console.error(\n    JSON.stringify(\n      {\n        status:\n          \"ALPHA_V2_ENTRY_CHASE_DIAGNOSTIC_FAILED\",\n\n        error:\n          String(\n            error instanceof Error\n              ? error.message\n              : error,\n          ),\n\n        databaseWrites:\n          0,\n\n        ordersCreated:\n          0,\n      },\n      null,\n      2,\n    ),\n  );\n\n  process.exitCode =\n    2;\n});\n",
  'utf8',
);

console.log(
  JSON.stringify(
    {
      status:
        'ALPHA_V2_ENTRY_CHASE_DIAGNOSTIC_INSTALLED',

      generatedFile:
        'scripts/alpha-v2-entry-chase-diagnostic.ts',

      productionChanged:
        false,

      thresholdChanged:
        false,

      databaseWrites:
        0,

      ordersCreated:
        0,

      nextAction:
        'RUN_ALPHA_V2_ENTRY_CHASE_DIAGNOSTIC'
    },
    null,
    2,
  ),
);
