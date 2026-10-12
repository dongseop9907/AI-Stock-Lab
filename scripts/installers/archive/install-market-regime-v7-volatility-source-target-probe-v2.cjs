const fs = require("fs");
const path = require("path");

const target = path.resolve(
  process.cwd(),
  "scripts/market-regime-v7-volatility-source-target-probe-v2.cjs"
);

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nconst files = [\n  \"lib/market/market-regime-feature-engine.ts\",\n  \"lib/market/market-regime-v7-policy.ts\",\n  \"lib/market/market-regime-shadow-comparator-v7-3.ts\",\n];\n\nfunction read(rel) {\n  const abs = path.resolve(root, rel);\n  if (!fs.existsSync(abs)) return null;\n  return fs.readFileSync(abs, \"utf8\").split(/\\r?\\n/);\n}\n\nfunction allMatches(lines, needle) {\n  if (!lines) return [];\n  return lines\n    .map((text, i) => ({ line: i + 1, text }))\n    .filter((x) => x.text.includes(needle));\n}\n\nfunction around(lines, lineNo, before = 8, after = 14) {\n  if (!lines || !lineNo) return null;\n  const start = Math.max(1, lineNo - before);\n  const end = Math.min(lines.length, lineNo + after);\n  return lines.slice(start - 1, end).map((text, i) => ({\n    line: start + i,\n    text: text.trim(),\n  }));\n}\n\nconst featureLines = read(files[0]);\nconst policyLines = read(files[1]);\nconst comparatorLines = read(files[2]);\n\nconst realizedMatches =\n  allMatches(featureLines, \"realizedVolatility20\");\n\nconst featureContexts =\n  realizedMatches.map((m) => ({\n    occurrenceLine: m.line,\n    context: around(featureLines, m.line, 10, 18),\n  }));\n\nconst avgMatches = [\n  ...allMatches(policyLines, \"averageVolatility20\"),\n  ...allMatches(comparatorLines, \"averageVolatility20\"),\n].map((m) => ({\n  line: m.line,\n  text: m.text.trim(),\n}));\n\nconst avgContexts = [\n  ...allMatches(policyLines, \"averageVolatility20\").map((m) => ({\n    file: files[1],\n    occurrenceLine: m.line,\n    context: around(policyLines, m.line, 10, 18),\n  })),\n  ...allMatches(comparatorLines, \"averageVolatility20\").map((m) => ({\n    file: files[2],\n    occurrenceLine: m.line,\n    context: around(comparatorLines, m.line, 10, 18),\n  })),\n];\n\nconst output = {\n  status:\n    \"MARKET_REGIME_V7_VOLATILITY_SOURCE_TARGET_PROBE_V2_COMPLETE\",\n\n  realizedVolatilityOccurrences:\n    realizedMatches.map((m) => m.line),\n\n  featureContexts,\n\n  averageVolatilityOccurrences:\n    avgMatches,\n\n  averageVolatilityContexts:\n    avgContexts,\n\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    networkCalls: 0,\n    filesModified: 0,\n    regimePolicyChanged: false,\n    forwardEvidenceChanged: false,\n  },\n\n  fullDetails:\n    \"logs/market-regime-v7-volatility-source-target-probe-v2.json\",\n\n  nextGate:\n    \"CLASSIFY_INDEX_VS_STOCK_VOLATILITY_SOURCE\",\n};\n\nfs.mkdirSync(\n  path.resolve(root, \"logs\"),\n  { recursive: true }\n);\n\nfs.writeFileSync(\n  path.resolve(root, output.fullDetails),\n  JSON.stringify(output, null, 2) + \"\\n\",\n  \"utf8\"\n);\n\nfunction compactContext(ctx) {\n  if (!ctx) return [];\n  return ctx.filter((row) =>\n    /realizedVolatility20|averageVolatility20|index|stock|breadth|map\\(|reduce\\(|avg|average|features|return\\s*\\{|volatility/i.test(row.text)\n  ).slice(0, 18);\n}\n\nconsole.log(JSON.stringify({\n  status: output.status,\n  realizedVolatilityOccurrences:\n    output.realizedVolatilityOccurrences,\n  featureContexts:\n    output.featureContexts.map((x) => ({\n      occurrenceLine: x.occurrenceLine,\n      context: compactContext(x.context),\n    })),\n  averageVolatilityContexts:\n    output.averageVolatilityContexts.map((x) => ({\n      file: x.file,\n      occurrenceLine: x.occurrenceLine,\n      context: compactContext(x.context),\n    })),\n  nextGate: output.nextGate,\n  details: output.fullDetails\n}, null, 2));\n", "utf8");

console.log(JSON.stringify({
  status:
    "MARKET_REGIME_V7_VOLATILITY_SOURCE_TARGET_PROBE_V2_INSTALLED",
  generatedFile:
    "scripts/market-regime-v7-volatility-source-target-probe-v2.cjs",
  consoleOutputPolicy:
    "VERY_COMPACT",
  nextAction:
    "RUN_SOURCE_TARGET_PROBE"
}, null, 2));
