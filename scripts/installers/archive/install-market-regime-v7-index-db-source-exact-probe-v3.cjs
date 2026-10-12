const fs = require("fs");
const path = require("path");

const target = path.resolve(
  process.cwd(),
  "scripts/market-regime-v7-index-db-source-exact-probe-v3.cjs"
);

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\nconst rel = \"lib/market/get-current-market-regime-features-v7.ts\";\nconst abs = path.resolve(root, rel);\n\nif (!fs.existsSync(abs)) {\n  throw new Error(\"GET_CURRENT_FEATURES_FILE_NOT_FOUND\");\n}\n\nconst lines = fs.readFileSync(abs, \"utf8\").split(/\\r?\\n/);\n\nfunction slice(start, end) {\n  return lines.slice(start - 1, end).map((text, i) => ({\n    line: start + i,\n    text: text.trim(),\n  }));\n}\n\nconst queryBlock = slice(65, 105);\n\nconst constants = lines\n  .map((text, i) => ({\n    line: i + 1,\n    text: text.trim(),\n  }))\n  .filter((row) =>\n    row.line <= 80 &&\n    (\n      /^const\\s+/i.test(row.text) ||\n      /TABLE|INDEX|MARKET|BAR/i.test(row.text)\n    )\n  )\n  .slice(0, 30);\n\nconst output = {\n  status:\n    \"MARKET_REGIME_V7_INDEX_DB_SOURCE_EXACT_PROBE_V3_COMPLETE\",\n  file: rel,\n  constants,\n  queryBlock,\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    networkCalls: 0,\n    filesModified: 0,\n    regimePolicyChanged: false\n  },\n  nextGate:\n    \"IDENTIFY_EXACT_INDEX_SOURCE_EXPRESSION\"\n};\n\nfs.mkdirSync(path.resolve(root, \"logs\"), { recursive: true });\n\nfs.writeFileSync(\n  path.resolve(\n    root,\n    \"logs/market-regime-v7-index-db-source-exact-probe-v3.json\"\n  ),\n  JSON.stringify(output, null, 2) + \"\\n\",\n  \"utf8\"\n);\n\nconsole.log(JSON.stringify(output, null, 2));\n", "utf8");

console.log(JSON.stringify({
  status:
    "MARKET_REGIME_V7_INDEX_DB_SOURCE_EXACT_PROBE_V3_INSTALLED",
  generatedFile:
    "scripts/market-regime-v7-index-db-source-exact-probe-v3.cjs",
  consoleOutputPolicy:
    "EXACT_QUERY_BLOCK",
  nextAction:
    "RUN_INDEX_DB_SOURCE_EXACT_PROBE"
}, null, 2));
