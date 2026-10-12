const fs = require("fs");
const path = require("path");

const target = path.resolve(
  process.cwd(),
  "scripts/market-regime-v7-volatility-formula-unit-probe-v3.cjs"
);

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\nconst rel = \"lib/market/market-regime-feature-engine.ts\";\nconst abs = path.resolve(root, rel);\n\nif (!fs.existsSync(abs)) {\n  throw new Error(\"FEATURE_ENGINE_NOT_FOUND\");\n}\n\nconst lines = fs.readFileSync(abs, \"utf8\").split(/\\r?\\n/);\n\nfunction extractFunction(name) {\n  const start = lines.findIndex((line) =>\n    line.includes(`function ${name}(`)\n  );\n\n  if (start < 0) return null;\n\n  const picked = [];\n  let depth = 0;\n  let started = false;\n\n  for (let i = start; i < lines.length; i += 1) {\n    const text = lines[i];\n    picked.push({\n      line: i + 1,\n      text: text.trim(),\n    });\n\n    for (const ch of text) {\n      if (ch === \"{\") {\n        depth += 1;\n        started = true;\n      } else if (ch === \"}\") {\n        depth -= 1;\n        if (started && depth === 0) {\n          return picked;\n        }\n      }\n    }\n\n    if (picked.length >= 80) break;\n  }\n\n  return picked;\n}\n\nconst candidates = [\n  \"calculateAnnualizedVolatility\",\n  \"calculateReturns\",\n  \"calculateReturnSeries\",\n  \"pctReturn\",\n  \"simpleReturn\",\n];\n\nconst blocks = candidates\n  .map((name) => ({\n    name,\n    block: extractFunction(name),\n  }))\n  .filter((x) => x.block);\n\nconst nearbyReturnMath = lines\n  .map((text, i) => ({\n    line: i + 1,\n    text: text.trim(),\n  }))\n  .filter((row) =>\n    row.line >= 220 &&\n    row.line <= 310 &&\n    (\n      /return/i.test(row.text) ||\n      /close/i.test(row.text) ||\n      /Math\\.log/i.test(row.text) ||\n      /100/.test(row.text) ||\n      /sqrt\\(252/i.test(row.text) ||\n      /std|variance|mean/i.test(row.text)\n    )\n  );\n\nconst output = {\n  status:\n    \"MARKET_REGIME_V7_VOLATILITY_FORMULA_UNIT_PROBE_V3_COMPLETE\",\n  blocks,\n  nearbyReturnMath,\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    networkCalls: 0,\n    filesModified: 0,\n    regimePolicyChanged: false,\n    forwardEvidenceChanged: false,\n  },\n  fullDetails:\n    \"logs/market-regime-v7-volatility-formula-unit-probe-v3.json\",\n  nextGate:\n    \"CONFIRM_RETURN_UNIT_AND_VOLATILITY_SCALE\",\n};\n\nfs.mkdirSync(\n  path.resolve(root, \"logs\"),\n  { recursive: true },\n);\n\nfs.writeFileSync(\n  path.resolve(root, output.fullDetails),\n  JSON.stringify(output, null, 2) + \"\\n\",\n  \"utf8\",\n);\n\nfunction compact(rows) {\n  if (!rows) return null;\n\n  return rows.filter((row) =>\n    /return|close|Math\\.log|100|sqrt|variance|mean|std|length|slice/i.test(\n      row.text\n    )\n  ).slice(0, 24);\n}\n\nconsole.log(JSON.stringify({\n  status: output.status,\n  functions: blocks.map((x) => ({\n    name: x.name,\n    lines: compact(x.block),\n  })),\n  nearby: compact(nearbyReturnMath),\n  nextGate: output.nextGate,\n  details: output.fullDetails\n}, null, 2));\n", "utf8");

console.log(JSON.stringify({
  status:
    "MARKET_REGIME_V7_VOLATILITY_FORMULA_UNIT_PROBE_V3_INSTALLED",
  generatedFile:
    "scripts/market-regime-v7-volatility-formula-unit-probe-v3.cjs",
  consoleOutputPolicy:
    "VERY_COMPACT",
  nextAction:
    "RUN_VOLATILITY_FORMULA_UNIT_PROBE"
}, null, 2));
