const fs = require("fs");
const path = require("path");

const target = path.resolve(
  process.cwd(),
  "scripts/alpha-v3-exit-v3-baseline-source-probe.ts"
);

const source = "import fs from \"node:fs\";\nimport path from \"node:path\";\n\nconst ROOT = process.cwd();\n\nconst TARGET_FILES = [\n  \"lib/trading/trailing-stop-policy.ts\",\n  \"lib/trading/update-trailing-stops.ts\",\n  \"lib/trading/risk-manager.ts\",\n  \"lib/trading/types.ts\",\n  \"app/api/trading/trailing-stop/update/route.ts\",\n  \"app/api/trading/stop-loss/check/route.ts\",\n  \"app/api/trading/trades/evaluate/route.ts\",\n  \"logs/alpha-v3-extended-entry-v3-replay-checkpoint.json\",\n];\n\nconst SEARCH_TERMS = [\n  \"trailing\",\n  \"stop\",\n  \"activation\",\n  \"drawdown\",\n  \"risk\",\n  \"entryPrice\",\n  \"stopPrice\",\n  \"highest\",\n  \"peak\",\n  \"atr\",\n  \"volatility\",\n];\n\nfunction excerpt(\n  text: string,\n  line: number,\n  radius = 4,\n) {\n  const lines =\n    text.split(/\\r?\\n/);\n\n  const start =\n    Math.max(\n      0,\n      line - 1 - radius,\n    );\n\n  const end =\n    Math.min(\n      lines.length,\n      line + radius,\n    );\n\n  return {\n    startLine:\n      start + 1,\n\n    endLine:\n      end,\n\n    text:\n      lines\n        .slice(\n          start,\n          end,\n        )\n        .join(\"\\n\"),\n  };\n}\n\nfunction scanTextFile(\n  relativePath: string,\n) {\n  const absolute =\n    path.resolve(\n      ROOT,\n      relativePath,\n    );\n\n  if (\n    !fs.existsSync(\n      absolute,\n    )\n  ) {\n    return {\n      file:\n        relativePath,\n\n      exists:\n        false,\n\n      matches: [],\n    };\n  }\n\n  const text =\n    fs.readFileSync(\n      absolute,\n      \"utf8\",\n    );\n\n  const lines =\n    text.split(/\\r?\\n/);\n\n  const matches:\n    Array<{\n      term: string;\n      line: number;\n      excerpt: ReturnType<typeof excerpt>;\n    }> = [];\n\n  for (\n    let i = 0;\n    i < lines.length;\n    i += 1\n  ) {\n    const lower =\n      lines[i].toLowerCase();\n\n    for (\n      const term of SEARCH_TERMS\n    ) {\n      if (\n        lower.includes(\n          term.toLowerCase(),\n        )\n      ) {\n        matches.push({\n          term,\n          line:\n            i + 1,\n\n          excerpt:\n            excerpt(\n              text,\n              i + 1,\n            ),\n        });\n\n        break;\n      }\n    }\n\n    if (\n      matches.length >= 12\n    ) {\n      break;\n    }\n  }\n\n  return {\n    file:\n      relativePath,\n\n    exists:\n      true,\n\n    lineCount:\n      lines.length,\n\n    matches,\n  };\n}\n\nfunction checkpointProbe() {\n  const relative =\n    \"logs/alpha-v3-extended-entry-v3-replay-checkpoint.json\";\n\n  const absolute =\n    path.resolve(\n      ROOT,\n      relative,\n    );\n\n  if (\n    !fs.existsSync(\n      absolute,\n    )\n  ) {\n    return {\n      exists:\n        false,\n    };\n  }\n\n  const parsed =\n    JSON.parse(\n      fs.readFileSync(\n        absolute,\n        \"utf8\",\n      ),\n    );\n\n  const results =\n    Array.isArray(\n      parsed?.results,\n    )\n      ? parsed.results\n      : [];\n\n  const qualified =\n    results.find(\n      (row: any) =>\n        row?.correctedEntry\n          ?.qualified ===\n        true,\n    );\n\n  return {\n    exists:\n      true,\n\n    topLevelKeys:\n      Object.keys(\n        parsed ?? {},\n      ),\n\n    resultCount:\n      results.length,\n\n    sampleQualified: qualified\n      ? {\n          sourceTradingDate:\n            qualified\n              .sourceTradingDate,\n\n          targetSessionDate:\n            qualified\n              .targetSessionDate,\n\n          stockCode:\n            qualified\n              .stockCode,\n\n          minuteCoverage:\n            qualified\n              .minuteCoverage,\n\n          correctedEntry:\n            qualified\n              .correctedEntry,\n\n          limitPolicies:\n            qualified\n              .limitPolicies,\n        }\n      : null,\n  };\n}\n\nconst files =\n  TARGET_FILES\n    .filter(\n      (file) =>\n        !file.endsWith(\n          \".json\",\n        ),\n    )\n    .map(\n      scanTextFile,\n    );\n\nconst output = {\n  status:\n    \"ALPHA_V3_EXIT_V3_BASELINE_SOURCE_PROBE_COMPLETE\",\n\n  version:\n    \"ALPHA_V3_EXIT_V3_BASELINE_SOURCE_PROBE_V1\",\n\n  files,\n\n  checkpoint:\n    checkpointProbe(),\n\n  safety: {\n    databaseReads:\n      0,\n\n    databaseWrites:\n      0,\n\n    kisRequests:\n      0,\n\n    ordersCreated:\n      0,\n\n    positionsChanged:\n      0,\n\n    productionChanged:\n      false,\n  },\n\n  nextGate:\n    \"BUILD_ALPHA_V3_EXIT_V3_BASELINE_REPLAY\",\n};\n\nconsole.log(\n  JSON.stringify(\n    output,\n    null,\n    2,\n  ),\n);\n";

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
        "ALPHA_V3_EXIT_V3_BASELINE_SOURCE_PROBE_INSTALLED",
      generatedFile:
        "scripts/alpha-v3-exit-v3-baseline-source-probe.ts",
      productionChanged:
        false,
      databaseWrites:
        0,
      ordersCreated:
        0,
      nextAction:
        "RUN_ALPHA_V3_EXIT_V3_BASELINE_SOURCE_PROBE"
    },
    null,
    2
  )
);
