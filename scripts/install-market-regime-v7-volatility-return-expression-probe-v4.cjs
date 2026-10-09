const fs = require("fs");
const path = require("path");

const target = path.resolve(
  process.cwd(),
  "scripts/market-regime-v7-volatility-return-expression-probe-v4.cjs"
);

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\nconst rel = \"lib/market/market-regime-feature-engine.ts\";\nconst abs = path.resolve(root, rel);\n\nif (!fs.existsSync(abs)) {\n  throw new Error(\"FEATURE_ENGINE_NOT_FOUND\");\n}\n\nconst lines = fs.readFileSync(abs, \"utf8\").split(/\\r?\\n/);\n\nconst start = 252;\nconst end = 268;\n\nconst exact = lines\n  .slice(start - 1, end)\n  .map((text, i) => ({\n    line: start + i,\n    text: text.trim(),\n  }));\n\nconst output = {\n  status:\n    \"MARKET_REGIME_V7_VOLATILITY_RETURN_EXPRESSION_PROBE_V4_COMPLETE\",\n  file: rel,\n  exact,\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    networkCalls: 0,\n    filesModified: 0,\n    regimePolicyChanged: false,\n  },\n  nextGate:\n    \"CONFIRM_DECIMAL_VS_PERCENT_RETURN_UNIT\",\n};\n\nfs.mkdirSync(path.resolve(root, \"logs\"), { recursive: true });\n\nfs.writeFileSync(\n  path.resolve(\n    root,\n    \"logs/market-regime-v7-volatility-return-expression-probe-v4.json\"\n  ),\n  JSON.stringify(output, null, 2) + \"\\n\",\n  \"utf8\"\n);\n\nconsole.log(JSON.stringify(output, null, 2));\n", "utf8");

console.log(JSON.stringify({
  status:
    "MARKET_REGIME_V7_VOLATILITY_RETURN_EXPRESSION_PROBE_V4_INSTALLED",
  generatedFile:
    "scripts/market-regime-v7-volatility-return-expression-probe-v4.cjs",
  consoleOutputPolicy:
    "EXACT_17_LINES",
  nextAction:
    "RUN_RETURN_EXPRESSION_PROBE"
}, null, 2));
