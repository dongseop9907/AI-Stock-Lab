const fs = require("fs");
const path = require("path");

const target =
  path.resolve(
    process.cwd(),
    "scripts/alpha-v3-true-forward-oos-implementation-surface-probe-v1.cjs"
  );

fs.mkdirSync(
  path.dirname(target),
  { recursive: true }
);

fs.writeFileSync(
  target,
  "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nconst candidates = [\n  \"scripts/alpha-v3-extended-entry-v3-replay-batcher.ts\",\n  \"scripts/alpha-v3-extended-entry-v3-replay-batcher.cjs\",\n  \"scripts/alpha-v3-extended-entry-v3-replay.ts\",\n  \"scripts/alpha-v3-entry-v3-forward-shadow-oos.ts\",\n  \"scripts/alpha-v3-true-entry-forward-oos-batcher-probe.ts\",\n  \"lib/alpha/candidate-scoring.ts\",\n  \"lib/research/evaluate-alpha-forward-outcomes-v9-1.ts\",\n  \"logs/alpha-v3-extended-pricevolume-top1-history.json\",\n  \"logs/alpha-v3-extended-entry-v3-replay-checkpoint.json\",\n  \"alpha-v3-extended-entry-v3-replay-checkpoint.json\",\n  \"logs/alpha-v3-entry-v3-forward-shadow-oos-state.json\",\n  \"logs/alpha-v3-entry-v3-forward-shadow-oos.json\",\n  \"logs/alpha-v3-forward-top1-sessions.json\",\n];\n\nfunction read(rel) {\n  const abs = path.resolve(root, rel);\n\n  if (!fs.existsSync(abs)) {\n    return null;\n  }\n\n  return fs.readFileSync(abs, \"utf8\");\n}\n\nfunction summarizeSource(rel, text) {\n  const lines = text.split(/\\r?\\n/);\n\n  const imports = [];\n  const functions = [];\n  const exports = [];\n  const constants = [];\n  const fileRefs = [];\n  const scoreSignals = [];\n  const dateSignals = [];\n  const fillSignals = [];\n\n  for (let i = 0; i < lines.length; i += 1) {\n    const line = lines[i];\n    const trimmed = line.trim();\n\n    if (/^import\\b|^const .*require\\(/.test(trimmed)) {\n      imports.push({\n        line: i + 1,\n        text: trimmed,\n      });\n    }\n\n    if (\n      /^(export\\s+)?(async\\s+)?function\\s+\\w+/.test(trimmed) ||\n      /^const\\s+\\w+\\s*=\\s*(async\\s*)?\\(/.test(trimmed)\n    ) {\n      functions.push({\n        line: i + 1,\n        text: trimmed,\n      });\n    }\n\n    if (/^export\\b/.test(trimmed)) {\n      exports.push({\n        line: i + 1,\n        text: trimmed,\n      });\n    }\n\n    if (/^const\\s+[A-Z0-9_]+\\s*=/.test(trimmed)) {\n      constants.push({\n        line: i + 1,\n        text: trimmed,\n      });\n    }\n\n    if (\n      /alpha-v3-|\\.json|checkpoint|history|forward/i.test(trimmed)\n    ) {\n      fileRefs.push({\n        line: i + 1,\n        text: trimmed,\n      });\n    }\n\n    if (\n      /correctedEntry|qualification|qualified|entryScore|effectiveScore|rawPriceVolumeScore/i.test(\n        trimmed,\n      )\n    ) {\n      scoreSignals.push({\n        line: i + 1,\n        text: trimmed,\n      });\n    }\n\n    if (\n      /sourceTradingDate|targetSessionDate|tradingDate|nextTrading|sessionDate|HORIZON/i.test(\n        trimmed,\n      )\n    ) {\n      dateSignals.push({\n        line: i + 1,\n        text: trimmed,\n      });\n    }\n\n    if (\n      /maxPremium|limitPrice|fillPrice|filled|INTRAMINUTE|OPEN_AT_OR_BELOW_LIMIT|r1|r3|r5/i.test(\n        trimmed,\n      )\n    ) {\n      fillSignals.push({\n        line: i + 1,\n        text: trimmed,\n      });\n    }\n  }\n\n  return {\n    rel,\n    lineCount: lines.length,\n    imports: imports.slice(0, 80),\n    functions: functions.slice(0, 120),\n    exports: exports.slice(0, 80),\n    constants: constants.slice(0, 120),\n    fileRefs: fileRefs.slice(0, 140),\n    scoreSignals: scoreSignals.slice(0, 160),\n    dateSignals: dateSignals.slice(0, 160),\n    fillSignals: fillSignals.slice(0, 160),\n  };\n}\n\nfunction summarizeJson(rel, text) {\n  let value;\n\n  try {\n    value = JSON.parse(text);\n  } catch (error) {\n    return {\n      rel,\n      parseError:\n        error instanceof Error\n          ? error.message\n          : String(error),\n    };\n  }\n\n  const summary = {\n    rel,\n    type:\n      Array.isArray(value)\n        ? \"array\"\n        : typeof value,\n  };\n\n  if (Array.isArray(value)) {\n    summary.count = value.length;\n    summary.firstKeys =\n      value.length > 0 &&\n      value[0] &&\n      typeof value[0] === \"object\"\n        ? Object.keys(value[0])\n        : [];\n    summary.last =\n      value.length > 0\n        ? value[value.length - 1]\n        : null;\n  } else if (value && typeof value === \"object\") {\n    summary.keys = Object.keys(value);\n\n    for (const key of [\n      \"version\",\n      \"status\",\n      \"historicalCutoff\",\n      \"selectedCap\",\n      \"entryScoreThreshold\",\n      \"frozen\",\n      \"counts\",\n      \"decision\",\n    ]) {\n      if (key in value) {\n        summary[key] = value[key];\n      }\n    }\n\n    for (const key of [\n      \"rows\",\n      \"results\",\n      \"sessions\",\n      \"observations\",\n      \"items\",\n    ]) {\n      if (Array.isArray(value[key])) {\n        summary[`${key}Count`] = value[key].length;\n        summary[`${key}FirstKeys`] =\n          value[key].length > 0 &&\n          value[key][0] &&\n          typeof value[key][0] === \"object\"\n            ? Object.keys(value[key][0])\n            : [];\n        summary[`${key}Last`] =\n          value[key].length > 0\n            ? value[key][value[key].length - 1]\n            : null;\n      }\n    }\n  }\n\n  return summary;\n}\n\nconst inspected = candidates.map((rel) => {\n  const text = read(rel);\n\n  if (text === null) {\n    return {\n      rel,\n      exists: false,\n    };\n  }\n\n  const isJson = rel.endsWith(\".json\");\n\n  return {\n    rel,\n    exists: true,\n    kind: isJson ? \"json\" : \"source\",\n    summary: isJson\n      ? summarizeJson(rel, text)\n      : summarizeSource(rel, text),\n  };\n});\n\nconst sourceFiles = inspected\n  .filter((item) => item.exists && item.kind === \"source\")\n  .map((item) => item.summary);\n\nconst jsonFiles = inspected\n  .filter((item) => item.exists && item.kind === \"json\")\n  .map((item) => item.summary);\n\nconst report = {\n  status:\n    \"ALPHA_V3_TRUE_FORWARD_OOS_IMPLEMENTATION_SURFACE_PROBE_V1_COMPLETE\",\n\n  inspected,\n\n  conclusions: {\n    historicalCutoff:\n      \"2026-10-07\",\n\n    frozenEntryPremiumCap:\n      0.01,\n\n    frozenQualificationThreshold:\n      0.66,\n\n    retuningAllowed:\n      false,\n\n    forwardTop1FileExpected:\n      \"logs/alpha-v3-forward-top1-sessions.json\",\n\n    forwardEntryDatasetExpected:\n      \"logs/alpha-v3-entry-v3-forward-shadow-oos-state.json\",\n\n    implementationRule:\n      \"REUSE_EXISTING_BATCHER_AND_SCORING_LOGIC_WITHOUT_WRITING_HISTORICAL_CHECKPOINT\",\n  },\n\n  sourceFiles,\n  jsonFiles,\n\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    kisRequests: 0,\n    ordersCreated: 0,\n    positionsChanged: 0,\n    productionChanged: false,\n  },\n\n  logFile:\n    \"logs/alpha-v3-true-forward-oos-implementation-surface-probe-v1.json\",\n\n  nextGate:\n    \"BUILD_TRUE_FORWARD_TOP1_PRODUCER_AND_ENTRY_OOS_COLLECTOR_V1\",\n};\n\nfs.mkdirSync(\n  path.resolve(root, \"logs\"),\n  { recursive: true },\n);\n\nfs.writeFileSync(\n  path.resolve(root, report.logFile),\n  JSON.stringify(report, null, 2) + \"\\n\",\n  \"utf8\",\n);\n\nconsole.log(\n  JSON.stringify(\n    {\n      status: report.status,\n      files: inspected.map((item) => ({\n        rel: item.rel,\n        exists: item.exists,\n        kind: item.kind ?? null,\n      })),\n      sourceFiles,\n      jsonFiles,\n      conclusions: report.conclusions,\n      safety: report.safety,\n      logFile: report.logFile,\n      nextGate: report.nextGate,\n    },\n    null,\n    2,\n  ),\n);\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_TRUE_FORWARD_OOS_IMPLEMENTATION_SURFACE_PROBE_V1_INSTALLED",

      generatedFile:
        "scripts/alpha-v3-true-forward-oos-implementation-surface-probe-v1.cjs",

      purpose:
        "RESOLVE_EXACT_REUSABLE_BATCHER_SCORING_CHECKPOINT_INTERFACES_BEFORE_FORWARD_OOS_IMPLEMENTATION",

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        kisRequests: 0,
        ordersCreated: 0,
        positionsChanged: 0,
        productionChanged: false
      },

      nextAction:
        "RUN_PROBE_AND_BUILD_FORWARD_PRODUCER_COLLECTOR"
    },
    null,
    2
  )
);
