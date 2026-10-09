const fs = require("fs");
const path = require("path");

const target = path.resolve(
  process.cwd(),
  "scripts/market-regime-v7-index-db-source-probe-v2.cjs"
);

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\nconst rel = \"lib/market/get-current-market-regime-features-v7.ts\";\nconst abs = path.resolve(root, rel);\n\nif (!fs.existsSync(abs)) {\n  throw new Error(\"GET_CURRENT_FEATURES_FILE_NOT_FOUND\");\n}\n\nconst lines = fs.readFileSync(abs, \"utf8\").split(/\\r?\\n/);\n\nfunction block(start, end) {\n  return lines.slice(start - 1, end).map((text, i) => ({\n    line: start + i,\n    text: text.trim(),\n  }));\n}\n\nconst ranges = [\n  { name: \"indexQuery\", start: 80, end: 118 },\n  { name: \"indexMapping\", start: 119, end: 170 },\n];\n\nconst compact = ranges.map((r) => ({\n  name: r.name,\n  lines: block(r.start, r.end).filter((row) =>\n    /\\.from\\(|\\.select\\(|\\.in\\(|\\.eq\\(|KOSPI|KOSDAQ|index|market|code|symbol|close|date|map\\(|filter\\(/i.test(\n      row.text\n    )\n  ),\n}));\n\nconst output = {\n  status:\n    \"MARKET_REGIME_V7_INDEX_DB_SOURCE_PROBE_V2_COMPLETE\",\n  file: rel,\n  compact,\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    networkCalls: 0,\n    filesModified: 0,\n    regimePolicyChanged: false,\n  },\n  nextGate:\n    \"CONFIRM_INDEX_DB_SOURCE_THEN_CLASSIFY_V7_AS_DESIGN_CALIBRATION_ISSUE\",\n};\n\nfs.mkdirSync(path.resolve(root, \"logs\"), { recursive: true });\n\nfs.writeFileSync(\n  path.resolve(\n    root,\n    \"logs/market-regime-v7-index-db-source-probe-v2.json\"\n  ),\n  JSON.stringify(\n    {\n      ...output,\n      rawRanges: ranges.map((r) => ({\n        ...r,\n        lines: block(r.start, r.end),\n      })),\n    },\n    null,\n    2\n  ) + \"\\n\",\n  \"utf8\"\n);\n\nconsole.log(JSON.stringify(output, null, 2));\n", "utf8");

console.log(JSON.stringify({
  status:
    "MARKET_REGIME_V7_INDEX_DB_SOURCE_PROBE_V2_INSTALLED",
  generatedFile:
    "scripts/market-regime-v7-index-db-source-probe-v2.cjs",
  consoleOutputPolicy:
    "VERY_COMPACT",
  nextAction:
    "RUN_INDEX_DB_SOURCE_PROBE"
}, null, 2));
