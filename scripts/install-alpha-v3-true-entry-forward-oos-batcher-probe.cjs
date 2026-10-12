const fs = require("fs");
const path = require("path");

const target = path.resolve(
  process.cwd(),
  "scripts/alpha-v3-true-entry-forward-oos-batcher-probe.ts"
);

const source = "import fs from \"node:fs\";\nimport path from \"node:path\";\n\nconst VERSION =\n  \"ALPHA_V3_TRUE_ENTRY_FORWARD_OOS_BATCHER_PROBE_V1\";\n\nconst ROOT =\n  process.cwd();\n\nconst TARGETS = [\n  \"scripts/alpha-v3-extended-entry-v3-replay-batcher.ts\",\n  \"scripts/alpha-v3-lock-entry-v3-structure.ts\",\n  \"scripts/alpha-v3-analyze-extended-entry-replay.ts\",\n];\n\nfunction readText(\n  rel: string,\n): string | null {\n  const file =\n    path.resolve(\n      ROOT,\n      rel,\n    );\n\n  if (\n    !fs.existsSync(file)\n  ) {\n    return null;\n  }\n\n  return fs\n    .readFileSync(\n      file,\n      \"utf8\",\n    )\n    .replace(\n      /\\r\\n/g,\n      \"\\n\",\n    );\n}\n\nfunction numbered(\n  lines: string[],\n  from: number,\n  to: number,\n): string {\n  return lines\n    .slice(from, to)\n    .map(\n      (line, index) =>\n        String(\n          from + index + 1,\n        ) +\n        \": \" +\n        line,\n    )\n    .join(\"\\n\");\n}\n\nfunction inspect(\n  rel: string,\n) {\n  const source =\n    readText(rel);\n\n  if (\n    source === null\n  ) {\n    return {\n      file: rel,\n      exists: false,\n    };\n  }\n\n  const lines =\n    source.split(\"\\n\");\n\n  const terms = [\n    \"createSupabaseServerClient\",\n    \".from(\",\n    \"market_minute\",\n    \"market_daily_bars\",\n    \"market_snapshots\",\n    \"stocks\",\n    \"sourceTradingDate\",\n    \"targetSessionDate\",\n    \"entryScoreThreshold\",\n    \"0.66\",\n    \"premiumCaps\",\n    \"0.01\",\n    \"correctedEntry\",\n    \"entryPrice\",\n    \"observedAt\",\n    \"limitPolicies\",\n    \"fillPrice\",\n    \"fillType\",\n    \"INTRAMINUTE_LIMIT_TOUCH\",\n    \"OPEN_AT_OR_BELOW_LIMIT\",\n    \"directReturns\",\n    \"returns:\",\n    \"r1\",\n    \"r3\",\n    \"r5\",\n    \"checkpoint\",\n    \"CHECKPOINT\",\n    \"results.push\",\n    \".push(\",\n    \"writeFileSync\",\n    \"appendFileSync\",\n    \"usableRange\",\n    \"startDate\",\n    \"endDate\",\n    \"batch\",\n    \"cursor\",\n    \"next\",\n    \"resume\",\n    \"existing\",\n    \"fullCoverage\",\n    \"381\",\n    \"alphaV2EffectiveScore\",\n    \"alphaV2RawPriceVolumeScore\",\n  ];\n\n  const snippets = [];\n  const seen =\n    new Set<string>();\n\n  for (\n    const term\n    of terms\n  ) {\n    const matching =\n      lines\n        .map(\n          (line, index) => ({\n            line,\n            index,\n          }),\n        )\n        .filter(\n          (row) =>\n            row.line\n              .toLowerCase()\n              .includes(\n                term.toLowerCase(),\n              ),\n        )\n        .slice(\n          0,\n          12,\n        );\n\n    for (\n      const row\n      of matching\n    ) {\n      const from =\n        Math.max(\n          0,\n          row.index - 8,\n        );\n\n      const to =\n        Math.min(\n          lines.length,\n          row.index + 22,\n        );\n\n      const key =\n        from + \":\" + to;\n\n      if (\n        seen.has(key)\n      ) {\n        continue;\n      }\n\n      seen.add(key);\n\n      snippets.push({\n        term,\n        line:\n          row.index + 1,\n        text:\n          numbered(\n            lines,\n            from,\n            to,\n          ),\n      });\n    }\n  }\n\n  const functions =\n    lines\n      .map(\n        (line, index) => ({\n          line:\n            line.trim(),\n          index,\n        }),\n      )\n      .filter(\n        (row) =>\n          /^(export\\s+)?(async\\s+)?function\\s+\\w+/.test(\n            row.line,\n          ) ||\n          /^(export\\s+)?const\\s+\\w+\\s*=\\s*(async\\s*)?\\(/.test(\n            row.line,\n          ),\n      )\n      .map(\n        (row) => ({\n          line:\n            row.index + 1,\n          declaration:\n            row.line,\n        }),\n      );\n\n  const constants =\n    lines\n      .map(\n        (line, index) => ({\n          line:\n            line.trim(),\n          index,\n        }),\n      )\n      .filter(\n        (row) =>\n          /^const\\s+[A-Z0-9_]+\\s*=/.test(\n            row.line,\n          ),\n      )\n      .slice(\n        0,\n        120,\n      )\n      .map(\n        (row) => ({\n          line:\n            row.index + 1,\n          declaration:\n            row.line,\n        }),\n      );\n\n  return {\n    file: rel,\n    exists: true,\n    lineCount:\n      lines.length,\n    functions,\n    constants,\n    snippets:\n      snippets.slice(\n        0,\n        140,\n      ),\n  };\n}\n\nconst batcher =\n  readText(\n    TARGETS[0],\n  );\n\nconst references =\n  batcher\n    ? [...batcher.matchAll(\n        /[\"']([^\"']+\\.(?:ts|json))[\"']/g,\n      )]\n        .map(\n          (match) =>\n            match[1],\n        )\n        .filter(\n          (value, index, array) =>\n            array.indexOf(value) ===\n            index,\n        )\n        .slice(\n          0,\n          100,\n        )\n    : [];\n\nconst report = {\n  status:\n    \"ALPHA_V3_TRUE_ENTRY_FORWARD_OOS_BATCHER_PROBE_COMPLETE\",\n\n  version:\n    VERSION,\n\n  targets:\n    TARGETS.map(\n      inspect,\n    ),\n\n  batcherReferencedFiles:\n    references,\n\n  collectorDesignGate: {\n    needExactSourceBeforePatch:\n      true,\n\n    requiredReusablePieces: [\n      \"trading-day/source-target session construction\",\n      \"candidate stock selection\",\n      \"minute row loading\",\n      \"correctedEntry score and qualification\",\n      \"1pct cap fill simulation\",\n      \"r1/r3/r5 maturity calculation\",\n      \"checkpoint dedupe/resume logic\",\n    ],\n\n    forwardDatasetRule:\n      \"write to an independent forward dataset; never append to the historical checkpoint\",\n\n    frozenContract: {\n      historicalCutoff:\n        \"2026-10-07\",\n      entryScoreThreshold:\n        0.66,\n      selectedCap:\n        0.01,\n      retuningAllowed:\n        false,\n    },\n  },\n\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    kisRequests: 0,\n    ordersCreated: 0,\n    positionsChanged: 0,\n    productionChanged: false,\n  },\n\n  nextGate:\n    \"BUILD_TRUE_ENTRY_V3_FORWARD_OOS_COLLECTOR_USING_BATCHER_LOGIC\",\n};\n\nconsole.log(\n  JSON.stringify(\n    report,\n    null,\n    2,\n  ),\n);\n";

fs.mkdirSync(
  path.dirname(target),
  { recursive: true }
);

fs.writeFileSync(
  target,
  source,
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_TRUE_ENTRY_FORWARD_OOS_BATCHER_PROBE_INSTALLED",

      generatedFile:
        "scripts/alpha-v3-true-entry-forward-oos-batcher-probe.ts",

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        ordersCreated: 0,
        positionsChanged: 0
      },

      nextAction:
        "RUN_TRUE_ENTRY_FORWARD_OOS_BATCHER_PROBE"
    },
    null,
    2
  )
);
