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
    'alpha-v2-entry-cadence-stratification.ts',
  ),
  "import fs from \"node:fs\";\nimport path from \"node:path\";\n\nfunction avg(\n  values: number[],\n): number | null {\n  return values.length\n    ? values.reduce((a, b) => a + b, 0) / values.length\n    : null;\n}\n\nfunction summarize(\n  rows: any[],\n  entryKey:\n    | \"currentEntry\"\n    | \"correctedEntry\",\n) {\n  const qualified =\n    rows.filter(\n      (row) =>\n        row[entryKey]\n          ?.qualified === true,\n    );\n\n  const mean = (\n    source:\n      | \"entry\"\n      | \"baseline\",\n    horizon:\n      | \"r1\"\n      | \"r3\"\n      | \"r5\",\n  ) => {\n    const values =\n      qualified\n        .map(\n          (row) =>\n            source === \"entry\"\n              ? row[entryKey]\n                  ?.returns?.[\n                    horizon\n                  ]\n              : row\n                  .sessionOpenBaseline?.[\n                    horizon\n                  ],\n        )\n        .filter(\n          Number.isFinite,\n        ) as number[];\n\n    return avg(values);\n  };\n\n  const entry = {\n    r1:\n      mean(\"entry\", \"r1\"),\n    r3:\n      mean(\"entry\", \"r3\"),\n    r5:\n      mean(\"entry\", \"r5\"),\n  };\n\n  const baseline = {\n    r1:\n      mean(\n        \"baseline\",\n        \"r1\",\n      ),\n    r3:\n      mean(\n        \"baseline\",\n        \"r3\",\n      ),\n    r5:\n      mean(\n        \"baseline\",\n        \"r5\",\n      ),\n  };\n\n  return {\n    sessionCount:\n      rows.length,\n\n    qualifiedSessions:\n      qualified.length,\n\n    qualificationRate:\n      rows.length\n        ? qualified.length /\n          rows.length\n        : null,\n\n    actualEntryReturn:\n      entry,\n\n    sameSessionsOpenBaseline:\n      baseline,\n\n    entryMinusOpenBaseline: {\n      r1:\n        entry.r1 !== null &&\n        baseline.r1 !== null\n          ? entry.r1 -\n            baseline.r1\n          : null,\n\n      r3:\n        entry.r3 !== null &&\n        baseline.r3 !== null\n          ? entry.r3 -\n            baseline.r3\n          : null,\n\n      r5:\n        entry.r5 !== null &&\n        baseline.r5 !== null\n          ? entry.r5 -\n            baseline.r5\n          : null,\n    },\n  };\n}\n\nfunction summarizeAllOpen(\n  rows: any[],\n) {\n  const get = (\n    horizon:\n      | \"r1\"\n      | \"r3\"\n      | \"r5\",\n  ) =>\n    avg(\n      rows\n        .map(\n          (row) =>\n            row\n              .sessionOpenBaseline?.[\n              horizon\n            ],\n        )\n        .filter(\n          Number.isFinite,\n        ) as number[],\n    );\n\n  return {\n    r1:\n      get(\"r1\"),\n    r3:\n      get(\"r3\"),\n    r5:\n      get(\"r5\"),\n  };\n}\n\nfunction averageDelayMinutes(\n  rows: any[],\n  entryKey:\n    | \"currentEntry\"\n    | \"correctedEntry\",\n) {\n  const values =\n    rows\n      .filter(\n        (row) =>\n          row[entryKey]\n            ?.qualified === true &&\n          row[entryKey]\n            ?.observedAt,\n      )\n      .map(\n        (row) => {\n          const entryMs =\n            new Date(\n              row[entryKey]\n                .observedAt,\n            ).getTime();\n\n          const openMs =\n            new Date(\n              `${row.targetSessionDate}T09:00:00+09:00`,\n            ).getTime();\n\n          return (\n            entryMs -\n            openMs\n          ) /\n          60000;\n        },\n      )\n      .filter(\n        Number.isFinite,\n      );\n\n  return avg(values);\n}\n\nfunction main() {\n  const root =\n    process.cwd();\n\n  const inputPath =\n    path.join(\n      root,\n      \"logs\",\n      \"alpha-v2-expanded-entry-comparison.json\",\n    );\n\n  if (\n    !fs.existsSync(\n      inputPath,\n    )\n  ) {\n    throw new Error(\n      \"EXPANDED_ENTRY_COMPARISON_LOG_NOT_FOUND\",\n    );\n  }\n\n  const report =\n    JSON.parse(\n      fs.readFileSync(\n        inputPath,\n        \"utf8\",\n      ),\n    );\n\n  const rows =\n    report.results ??\n    [];\n\n  const full381 =\n    rows.filter(\n      (row: any) =>\n        row.snapshotCount ===\n        381,\n    );\n\n  const sparse =\n    rows.filter(\n      (row: any) =>\n        row.snapshotCount !==\n        381,\n    );\n\n  const groups = {\n    full381: {\n      sessionCount:\n        full381.length,\n\n      currentEntry:\n        summarize(\n          full381,\n          \"currentEntry\",\n        ),\n\n      correctedEntry:\n        summarize(\n          full381,\n          \"correctedEntry\",\n        ),\n\n      allSessionsOpenBaseline:\n        summarizeAllOpen(\n          full381,\n        ),\n\n      averageEntryDelayMinutes: {\n        current:\n          averageDelayMinutes(\n            full381,\n            \"currentEntry\",\n          ),\n\n        corrected:\n          averageDelayMinutes(\n            full381,\n            \"correctedEntry\",\n          ),\n      },\n    },\n\n    sparse: {\n      sessionCount:\n        sparse.length,\n\n      currentEntry:\n        summarize(\n          sparse,\n          \"currentEntry\",\n        ),\n\n      correctedEntry:\n        summarize(\n          sparse,\n          \"correctedEntry\",\n        ),\n\n      allSessionsOpenBaseline:\n        summarizeAllOpen(\n          sparse,\n        ),\n\n      averageEntryDelayMinutes: {\n        current:\n          averageDelayMinutes(\n            sparse,\n            \"currentEntry\",\n          ),\n\n        corrected:\n          averageDelayMinutes(\n            sparse,\n            \"correctedEntry\",\n          ),\n      },\n    },\n  };\n\n  const result = {\n    status:\n      \"ALPHA_V2_ENTRY_CADENCE_STRATIFICATION_COMPLETE\",\n\n    counts: {\n      totalSessions:\n        rows.length,\n\n      full381Sessions:\n        full381.length,\n\n      sparseSessions:\n        sparse.length,\n    },\n\n    groups,\n\n    interpretationRule: {\n      primary:\n        \"Use full381 one-minute reconstructed sessions as the cleaner Entry comparison set.\",\n\n      sparse:\n        \"Treat sparse live-snapshot sessions separately because momentum and volume features depend on observation interval.\",\n\n      productionChanged:\n        false,\n    },\n\n    safety: {\n      databaseReads:\n        0,\n\n      databaseWrites:\n        0,\n\n      ordersCreated:\n        0,\n\n      positionsChanged:\n        0,\n    },\n\n    nextGate:\n      \"DECIDE_ENTRY_V2_FROM_FULL_381_SESSION_STRATUM\",\n  };\n\n  const outputPath =\n    path.join(\n      root,\n      \"logs\",\n      \"alpha-v2-entry-cadence-stratification.json\",\n    );\n\n  fs.writeFileSync(\n    outputPath,\n    JSON.stringify(\n      result,\n      null,\n      2,\n    ) + \"\\n\",\n    \"utf8\",\n  );\n\n  console.log(\n    JSON.stringify(\n      result,\n      null,\n      2,\n    ),\n  );\n}\n\ntry {\n  main();\n} catch (error) {\n  console.error(\n    JSON.stringify(\n      {\n        status:\n          \"ALPHA_V2_ENTRY_CADENCE_STRATIFICATION_FAILED\",\n\n        error:\n          String(\n            error instanceof Error\n              ? error.message\n              : error,\n          ),\n\n        databaseWrites:\n          0,\n\n        ordersCreated:\n          0,\n      },\n      null,\n      2,\n    ),\n  );\n\n  process.exitCode =\n    2;\n}\n",
  'utf8',
);

console.log(
  JSON.stringify(
    {
      status:
        'ALPHA_V2_ENTRY_CADENCE_STRATIFICATION_INSTALLED',

      generatedFile:
        'scripts/alpha-v2-entry-cadence-stratification.ts',

      productionChanged:
        false,

      databaseWrites:
        0,

      ordersCreated:
        0,

      nextAction:
        'RUN_ENTRY_CADENCE_STRATIFICATION'
    },
    null,
    2,
  ),
);
