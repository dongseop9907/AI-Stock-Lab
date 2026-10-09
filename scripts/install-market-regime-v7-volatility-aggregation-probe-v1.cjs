const fs = require("fs");
const path = require("path");

const target = path.resolve(
  process.cwd(),
  "scripts/market-regime-v7-volatility-aggregation-probe-v1.cjs"
);

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\nconst rel = \"lib/market/market-regime-feature-engine.ts\";\nconst abs = path.resolve(root, rel);\n\nif (!fs.existsSync(abs)) {\n  throw new Error(\"FEATURE_ENGINE_NOT_FOUND\");\n}\n\nconst lines = fs.readFileSync(abs, \"utf8\").split(/\\r?\\n/);\n\nfunction excerpt(start, end) {\n  return lines.slice(start - 1, end).map((text, i) => ({\n    line: start + i,\n    text: text.trim(),\n  }));\n}\n\nfunction aroundNeedle(needle, before = 6, after = 12) {\n  const idx = lines.findIndex((line) => line.includes(needle));\n  if (idx < 0) return null;\n  return excerpt(\n    Math.max(1, idx + 1 - before),\n    Math.min(lines.length, idx + 1 + after),\n  );\n}\n\nconst output = {\n  status:\n    \"MARKET_REGIME_V7_VOLATILITY_AGGREGATION_PROBE_V1_COMPLETE\",\n\n  realizedVolFormula:\n    aroundNeedle(\"Math.sqrt(252)\", 10, 10),\n\n  realizedVolAssignment:\n    aroundNeedle(\"realizedVolatility20:\", 8, 14),\n\n  aggregationSurface:\n    [\n      \"averageVolatility20\",\n      \"avg(\",\n      \"realizedVolatility20\",\n      \"active\",\n      \"stock\",\n    ].map((needle) => ({\n      needle,\n      excerpt: aroundNeedle(needle, 8, 16),\n    })),\n\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    networkCalls: 0,\n    filesModified: 0,\n    regimePolicyChanged: false,\n  },\n\n  fullDetails:\n    \"logs/market-regime-v7-volatility-aggregation-probe-v1.json\",\n\n  nextGate:\n    \"CLASSIFY_VOLATILITY_FEATURE_TARGET_MISMATCH\",\n};\n\nfs.mkdirSync(path.resolve(root, \"logs\"), { recursive: true });\n\nfs.writeFileSync(\n  path.resolve(root, output.fullDetails),\n  JSON.stringify(output, null, 2) + \"\\n\",\n  \"utf8\"\n);\n\nfunction compactBlock(block) {\n  if (!block) return null;\n  return block.filter((row) =>\n    /sqrt|volatility|average|avg|return|stock|index|breadth/i.test(row.text)\n  ).slice(0, 14);\n}\n\nconsole.log(JSON.stringify({\n  status: output.status,\n  formula: compactBlock(output.realizedVolFormula),\n  assignment: compactBlock(output.realizedVolAssignment),\n  aggregation:\n    output.aggregationSurface\n      .map((x) => ({\n        needle: x.needle,\n        excerpt: compactBlock(x.excerpt),\n      }))\n      .filter((x) => x.excerpt && x.excerpt.length),\n  nextGate: output.nextGate,\n  details: output.fullDetails\n}, null, 2));\n", "utf8");

console.log(JSON.stringify({
  status:
    "MARKET_REGIME_V7_VOLATILITY_AGGREGATION_PROBE_V1_INSTALLED",
  generatedFile:
    "scripts/market-regime-v7-volatility-aggregation-probe-v1.cjs",
  consoleOutputPolicy:
    "VERY_COMPACT",
  nextAction:
    "RUN_VOLATILITY_AGGREGATION_PROBE"
}, null, 2));
