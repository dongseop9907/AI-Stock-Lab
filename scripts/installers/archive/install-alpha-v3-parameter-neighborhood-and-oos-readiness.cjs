const fs = require("fs");
const path = require("path");

const sourceFile = path.resolve(
  process.cwd(),
  "scripts/alpha-v3-risk-v3-exact-cost-aware-portfolio-replay.ts"
);

const targetFile = path.resolve(
  process.cwd(),
  "scripts/alpha-v3-risk-v3-parameter-neighborhood-replay.ts"
);

const auditFile = path.resolve(
  process.cwd(),
  "scripts/alpha-v3-true-forward-oos-readiness-audit.ts"
);

if (!fs.existsSync(sourceFile)) {
  throw new Error(
    "EXACT_COST_AWARE_REPLAY_SOURCE_NOT_FOUND"
  );
}

let source = fs.readFileSync(
  sourceFile,
  "utf8"
).replace(/\r\n/g, "\n");

const policies = `const POLICIES = [
  {
    id: "BASELINE",
    initialStop: 0.025,
    activation: 0.03,
    trailing: 0.02,
    maxHoldingDays: 20,
  },
  {
    id: "TREND_FOLLOW",
    initialStop: 0.05,
    activation: 0.08,
    trailing: 0.05,
    maxHoldingDays: 20,
  },
  {
    id: "FIXED_STOP_3PCT",
    initialStop: 0.03,
    activation: 99,
    trailing: 0,
    maxHoldingDays: 20,
  },
  {
    id: "FIXED_STOP_3P5PCT",
    initialStop: 0.035,
    activation: 99,
    trailing: 0,
    maxHoldingDays: 20,
  },
  {
    id: "FIXED_STOP_4PCT",
    initialStop: 0.04,
    activation: 99,
    trailing: 0,
    maxHoldingDays: 20,
  },
  {
    id: "FIXED_STOP_4P5PCT",
    initialStop: 0.045,
    activation: 99,
    trailing: 0,
    maxHoldingDays: 20,
  },
  {
    id: "FIXED_STOP_5PCT",
    initialStop: 0.05,
    activation: 99,
    trailing: 0,
    maxHoldingDays: 20,
  },
  {
    id: "FIXED_STOP_4PCT_H15",
    initialStop: 0.04,
    activation: 99,
    trailing: 0,
    maxHoldingDays: 15,
  },
  {
    id: "FIXED_STOP_4PCT_H25",
    initialStop: 0.04,
    activation: 99,
    trailing: 0,
    maxHoldingDays: 25,
  },
] as const;`;

const policyPattern =
  /const POLICIES = \[[\s\S]*?\] as const;/;

if (!policyPattern.test(source)) {
  throw new Error(
    "PATCH_ANCHOR_NOT_FOUND:POLICIES"
  );
}

source = source.replace(
  policyPattern,
  policies
);

source = source.replace(
  /ALPHA_V3_RISK_V3_EXACT_COST_AWARE_PORTFOLIO_REPLAY_V1/g,
  "ALPHA_V3_RISK_V3_PARAMETER_NEIGHBORHOOD_REPLAY_V1"
);

source = source.replace(
  /ALPHA_V3_RISK_V3_EXACT_COST_AWARE_PORTFOLIO_REPLAY_COMPLETE/g,
  "ALPHA_V3_RISK_V3_PARAMETER_NEIGHBORHOOD_REPLAY_COMPLETE"
);

source = source.replace(
  /ALPHA_V3_RISK_V3_EXACT_COST_AWARE_PORTFOLIO_REPLAY_FAILED/g,
  "ALPHA_V3_RISK_V3_PARAMETER_NEIGHBORHOOD_REPLAY_FAILED"
);

source = source.replace(
  /logs\/alpha-v3-risk-v3-exact-cost-aware-portfolio-replay\.json/g,
  "logs/alpha-v3-risk-v3-parameter-neighborhood-replay.json"
);

source = source.replace(
  /RUN_PARAMETER_NEIGHBORHOOD_AND_TRUE_FORWARD_OOS_READINESS_CHECK/g,
  "ASSESS_PARAMETER_PLATEAU_AND_TRUE_FORWARD_OOS_READINESS"
);

fs.writeFileSync(
  targetFile,
  source,
  "utf8"
);

fs.writeFileSync(
  auditFile,
  "import fs from \"node:fs\";\nimport path from \"node:path\";\n\nconst VERSION =\n  \"ALPHA_V3_TRUE_FORWARD_OOS_READINESS_AUDIT_V1\";\n\nconst FILES = {\n  entry:\n    path.resolve(\n      process.cwd(),\n      \"scripts/alpha-v3-entry-v3-forward-shadow-oos.ts\",\n    ),\n\n  exit:\n    path.resolve(\n      process.cwd(),\n      \"scripts/alpha-v3-exit-v3-forward-shadow-oos.ts\",\n    ),\n};\n\nfunction read(\n  file: string,\n): string {\n  return fs.existsSync(file)\n    ? fs.readFileSync(\n        file,\n        \"utf8\",\n      )\n    : \"\";\n}\n\nfunction hasAny(\n  source: string,\n  patterns: RegExp[],\n): boolean {\n  return patterns.some(\n    (pattern) =>\n      pattern.test(\n        source,\n      ),\n  );\n}\n\nfunction main() {\n  const entry =\n    read(\n      FILES.entry,\n    );\n\n  const exit =\n    read(\n      FILES.exit,\n    );\n\n  const entryChecks = {\n    fileExists:\n      entry.length >\n      0,\n\n    hasFrozenCutoffConcept:\n      hasAny(\n        entry,\n        [\n          /cutoff/i,\n          /2026-10-07/,\n        ],\n      ),\n\n    hasFrozenEntryCap:\n      hasAny(\n        entry,\n        [\n          /0\\.01/,\n          /entryPremiumCap/i,\n        ],\n      ),\n\n    hasFrozenThreshold:\n      hasAny(\n        entry,\n        [\n          /0\\.66/,\n          /threshold/i,\n        ],\n      ),\n\n    readsHistoricalCheckpoint:\n      hasAny(\n        entry,\n        [\n          /replay-checkpoint/i,\n          /checkpoint/i,\n        ],\n      ),\n\n    filtersPostCutoff:\n      hasAny(\n        entry,\n        [\n          /targetSessionDate[\\s\\S]{0,120}>[\\s\\S]{0,120}cutoff/i,\n          /targetSessionDate[\\s\\S]{0,120}cutoff/i,\n          /unseenSessions/i,\n        ],\n      ),\n\n    persistsShadowState:\n      hasAny(\n        entry,\n        [\n          /writeFileSync/i,\n          /state/i,\n        ],\n      ),\n\n    hasLiveOrFutureDataSource:\n      hasAny(\n        entry,\n        [\n          /kis/i,\n          /market_snapshots/i,\n          /market_minute/i,\n          /minute.*bar/i,\n          /fetch/i,\n          /supabase/i,\n        ],\n      ),\n\n    appearsToAppendNewEntrySessions:\n      hasAny(\n        entry,\n        [\n          /checkpoint\\.results\\.push/i,\n          /results\\.push/i,\n          /append.*checkpoint/i,\n          /collect.*session/i,\n          /generate.*session/i,\n          /save.*session/i,\n        ],\n      ),\n\n    appearsToWriteBackCheckpointOrFutureDataset:\n      hasAny(\n        entry,\n        [\n          /writeFileSync[\\s\\S]{0,500}checkpoint/i,\n          /checkpoint[\\s\\S]{0,500}writeFileSync/i,\n          /upsert/i,\n          /insert/i,\n        ],\n      ),\n  };\n\n  const entryTrueCollectorEvidence =\n    (\n      entryChecks\n        .hasLiveOrFutureDataSource &&\n      entryChecks\n        .appearsToAppendNewEntrySessions &&\n      entryChecks\n        .appearsToWriteBackCheckpointOrFutureDataset\n    );\n\n  const exitChecks = {\n    fileExists:\n      exit.length >\n      0,\n\n    hasFrozenPolicySet:\n      (\n        /BASELINE/.test(\n          exit,\n        ) &&\n        /TREND_FOLLOW/.test(\n          exit,\n        ) &&\n        /FIXED_STOP_4PCT/.test(\n          exit,\n        )\n      ),\n\n    hasFrozenCutoffConcept:\n      hasAny(\n        exit,\n        [\n          /cutoff/i,\n          /2026-10-07/,\n        ],\n      ),\n\n    readsFutureDailyBars:\n      hasAny(\n        exit,\n        [\n          /market_daily_bars/i,\n          /supabase/i,\n        ],\n      ),\n\n    dependsOnEntryForwardData:\n      hasAny(\n        exit,\n        [\n          /entry.*forward/i,\n          /checkpoint/i,\n          /unseen/i,\n        ],\n      ),\n\n    persistsShadowState:\n      hasAny(\n        exit,\n        [\n          /writeFileSync/i,\n          /state/i,\n        ],\n      ),\n  };\n\n  const trueForwardReady =\n    (\n      entryChecks\n        .fileExists &&\n      entryChecks\n        .hasFrozenCutoffConcept &&\n      entryChecks\n        .hasFrozenEntryCap &&\n      entryChecks\n        .hasFrozenThreshold &&\n      entryChecks\n        .filtersPostCutoff &&\n      entryChecks\n        .persistsShadowState &&\n      entryTrueCollectorEvidence &&\n      exitChecks\n        .fileExists &&\n      exitChecks\n        .hasFrozenPolicySet &&\n      exitChecks\n        .hasFrozenCutoffConcept\n    );\n\n  const report = {\n    status:\n      \"ALPHA_V3_TRUE_FORWARD_OOS_READINESS_AUDIT_COMPLETE\",\n\n    version:\n      VERSION,\n\n    entryChecks,\n\n    entryTrueCollectorEvidence,\n\n    exitChecks,\n\n    decision: {\n      trueForwardReady,\n\n      historicalForwardScriptsCanBeTrustedAsTrueOOSCollector:\n        trueForwardReady,\n\n      likelyStaticCheckpointProblem:\n        !entryTrueCollectorEvidence,\n\n      productionPolicyLocked:\n        false,\n\n      nextUse:\n        trueForwardReady\n          ? \"START_TRUE_FORWARD_OOS_COLLECTION\"\n          : \"BUILD_TRUE_ENTRY_V3_FORWARD_OOS_COLLECTOR\",\n    },\n\n    safety: {\n      databaseReads:\n        0,\n      databaseWrites:\n        0,\n      kisRequests:\n        0,\n      ordersCreated:\n        0,\n      positionsChanged:\n        0,\n      productionChanged:\n        false,\n    },\n\n    nextGate:\n      trueForwardReady\n        ? \"START_TRUE_FORWARD_OOS_COLLECTION\"\n        : \"BUILD_TRUE_ENTRY_V3_FORWARD_OOS_COLLECTOR\",\n  };\n\n  console.log(\n    JSON.stringify(\n      report,\n      null,\n      2,\n    ),\n  );\n}\n\ntry {\n  main();\n} catch (\n  error\n) {\n  console.error(\n    JSON.stringify(\n      {\n        status:\n          \"ALPHA_V3_TRUE_FORWARD_OOS_READINESS_AUDIT_FAILED\",\n\n        error:\n          error instanceof Error\n            ? error.message\n            : String(\n                error,\n              ),\n      },\n      null,\n      2,\n    ),\n  );\n\n  process.exitCode =\n    1;\n}\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_PARAMETER_NEIGHBORHOOD_AND_OOS_READINESS_INSTALLED",

      generatedFiles: [
        "scripts/alpha-v3-risk-v3-parameter-neighborhood-replay.ts",
        "scripts/alpha-v3-true-forward-oos-readiness-audit.ts"
      ],

      parameterNeighborhood: [
        "FIXED_STOP_3PCT_H20",
        "FIXED_STOP_3P5PCT_H20",
        "FIXED_STOP_4PCT_H20",
        "FIXED_STOP_4P5PCT_H20",
        "FIXED_STOP_5PCT_H20",
        "FIXED_STOP_4PCT_H15",
        "FIXED_STOP_4PCT_H25"
      ],

      comparators: [
        "BASELINE",
        "TREND_FOLLOW"
      ],

      safety: {
        databaseWrites: 0,
        ordersCreated: 0,
        positionsChanged: 0
      },

      nextAction:
        "RUN_PARAMETER_NEIGHBORHOOD_THEN_OOS_READINESS_AUDIT"
    },
    null,
    2
  )
);
