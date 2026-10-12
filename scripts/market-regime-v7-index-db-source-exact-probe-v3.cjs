const fs = require("fs");
const path = require("path");

const root = process.cwd();
const rel = "lib/market/get-current-market-regime-features-v7.ts";
const abs = path.resolve(root, rel);

if (!fs.existsSync(abs)) {
  throw new Error("GET_CURRENT_FEATURES_FILE_NOT_FOUND");
}

const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/);

function slice(start, end) {
  return lines.slice(start - 1, end).map((text, i) => ({
    line: start + i,
    text: text.trim(),
  }));
}

const queryBlock = slice(65, 105);

const constants = lines
  .map((text, i) => ({
    line: i + 1,
    text: text.trim(),
  }))
  .filter((row) =>
    row.line <= 80 &&
    (
      /^const\s+/i.test(row.text) ||
      /TABLE|INDEX|MARKET|BAR/i.test(row.text)
    )
  )
  .slice(0, 30);

const output = {
  status:
    "MARKET_REGIME_V7_INDEX_DB_SOURCE_EXACT_PROBE_V3_COMPLETE",
  file: rel,
  constants,
  queryBlock,
  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    networkCalls: 0,
    filesModified: 0,
    regimePolicyChanged: false
  },
  nextGate:
    "IDENTIFY_EXACT_INDEX_SOURCE_EXPRESSION"
};

fs.mkdirSync(path.resolve(root, "logs"), { recursive: true });

fs.writeFileSync(
  path.resolve(
    root,
    "logs/market-regime-v7-index-db-source-exact-probe-v3.json"
  ),
  JSON.stringify(output, null, 2) + "\n",
  "utf8"
);

console.log(JSON.stringify(output, null, 2));
