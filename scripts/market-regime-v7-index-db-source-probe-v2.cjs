const fs = require("fs");
const path = require("path");

const root = process.cwd();
const rel = "lib/market/get-current-market-regime-features-v7.ts";
const abs = path.resolve(root, rel);

if (!fs.existsSync(abs)) {
  throw new Error("GET_CURRENT_FEATURES_FILE_NOT_FOUND");
}

const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/);

function block(start, end) {
  return lines.slice(start - 1, end).map((text, i) => ({
    line: start + i,
    text: text.trim(),
  }));
}

const ranges = [
  { name: "indexQuery", start: 80, end: 118 },
  { name: "indexMapping", start: 119, end: 170 },
];

const compact = ranges.map((r) => ({
  name: r.name,
  lines: block(r.start, r.end).filter((row) =>
    /\.from\(|\.select\(|\.in\(|\.eq\(|KOSPI|KOSDAQ|index|market|code|symbol|close|date|map\(|filter\(/i.test(
      row.text
    )
  ),
}));

const output = {
  status:
    "MARKET_REGIME_V7_INDEX_DB_SOURCE_PROBE_V2_COMPLETE",
  file: rel,
  compact,
  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    networkCalls: 0,
    filesModified: 0,
    regimePolicyChanged: false,
  },
  nextGate:
    "CONFIRM_INDEX_DB_SOURCE_THEN_CLASSIFY_V7_AS_DESIGN_CALIBRATION_ISSUE",
};

fs.mkdirSync(path.resolve(root, "logs"), { recursive: true });

fs.writeFileSync(
  path.resolve(
    root,
    "logs/market-regime-v7-index-db-source-probe-v2.json"
  ),
  JSON.stringify(
    {
      ...output,
      rawRanges: ranges.map((r) => ({
        ...r,
        lines: block(r.start, r.end),
      })),
    },
    null,
    2
  ) + "\n",
  "utf8"
);

console.log(JSON.stringify(output, null, 2));
