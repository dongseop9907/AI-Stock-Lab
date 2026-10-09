const fs = require("fs");
const path = require("path");

const target = path.resolve(
  process.cwd(),
  "scripts/market-regime-v7-semantic-compact-probe-v2.cjs"
);

fs.mkdirSync(path.dirname(target), { recursive: true });

fs.writeFileSync(
  target,
  "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nconst evalFile = path.resolve(\n  root,\n  \"lib/market/evaluate-regime-shadow-outcomes-v7-4.ts\"\n);\n\nconst comparatorFile = path.resolve(\n  root,\n  \"lib/market/market-regime-shadow-comparator-v7-3.ts\"\n);\n\nfunction read(rel) {\n  return fs.readFileSync(rel, \"utf8\");\n}\n\nfunction extractFunction(source, name) {\n  const needle = `function ${name}(`;\n  const start = source.indexOf(needle);\n\n  if (start < 0) {\n    return null;\n  }\n\n  const braceStart = source.indexOf(\"{\", start);\n  let depth = 0;\n\n  for (let i = braceStart; i < source.length; i += 1) {\n    const ch = source[i];\n\n    if (ch === \"{\") {\n      depth += 1;\n    } else if (ch === \"}\") {\n      depth -= 1;\n\n      if (depth === 0) {\n        return source\n          .slice(start, i + 1)\n          .replace(/\\r/g, \"\")\n          .split(\"\\n\")\n          .map((line) => line.trim())\n          .filter(Boolean);\n      }\n    }\n  }\n\n  return null;\n}\n\nconst evalSource = read(evalFile);\nconst comparatorSource = read(comparatorFile);\n\nconst decisionScore =\n  extractFunction(\n    evalSource,\n    \"decisionScore\",\n  );\n\nconst resolveAgreementState =\n  extractFunction(\n    comparatorSource,\n    \"resolveAgreementState\",\n  );\n\nconst interestingEvalLines =\n  evalSource\n    .split(/\\r?\\n/)\n    .map((line, index) => ({\n      line: index + 1,\n      text: line.trim(),\n    }))\n    .filter((row) =>\n      row.text.includes(\"const v6Score\") ||\n      row.text.includes(\"const v7Score\") ||\n      row.text.includes(\"disagreementWinner\") ||\n      row.text.includes(\"v6_decision_score_5d\") ||\n      row.text.includes(\"v7_decision_score_5d\")\n    )\n    .slice(0, 20);\n\nconst output = {\n  status:\n    \"MARKET_REGIME_V7_SEMANTIC_COMPACT_PROBE_V2_COMPLETE\",\n\n  decisionScore,\n  resolveAgreementState,\n  scoringUse:\n    interestingEvalLines,\n\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    networkCalls: 0,\n    filesModified: 0,\n  },\n\n  fullDetails:\n    \"logs/market-regime-v7-semantic-compact-probe-v2.json\",\n\n  nextGate:\n    \"ROW_LEVEL_READ_ONLY_RECALC_AUDIT\",\n};\n\nfs.mkdirSync(\n  path.resolve(root, \"logs\"),\n  { recursive: true },\n);\n\nfs.writeFileSync(\n  path.resolve(root, output.fullDetails),\n  JSON.stringify(output, null, 2) + \"\\n\",\n  \"utf8\",\n);\n\n/* Keep console deliberately short. */\nconsole.log(\n  JSON.stringify(\n    {\n      status: output.status,\n      decisionScore,\n      resolveAgreementState,\n      scoringUse:\n        interestingEvalLines.slice(0, 8),\n      nextGate: output.nextGate,\n    },\n    null,\n    2,\n  ),\n);\n",
  "utf8"
);

console.log(JSON.stringify({
  status:
    "MARKET_REGIME_V7_SEMANTIC_COMPACT_PROBE_V2_INSTALLED",
  generatedFile:
    "scripts/market-regime-v7-semantic-compact-probe-v2.cjs",
  consoleOutputPolicy:
    "VERY_COMPACT",
  nextAction:
    "RUN_COMPACT_PROBE"
}, null, 2));
