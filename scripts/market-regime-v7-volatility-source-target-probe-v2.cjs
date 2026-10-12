const fs = require("fs");
const path = require("path");

const root = process.cwd();

const files = [
  "lib/market/market-regime-feature-engine.ts",
  "lib/market/market-regime-v7-policy.ts",
  "lib/market/market-regime-shadow-comparator-v7-3.ts",
];

function read(rel) {
  const abs = path.resolve(root, rel);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, "utf8").split(/\r?\n/);
}

function allMatches(lines, needle) {
  if (!lines) return [];
  return lines
    .map((text, i) => ({ line: i + 1, text }))
    .filter((x) => x.text.includes(needle));
}

function around(lines, lineNo, before = 8, after = 14) {
  if (!lines || !lineNo) return null;
  const start = Math.max(1, lineNo - before);
  const end = Math.min(lines.length, lineNo + after);
  return lines.slice(start - 1, end).map((text, i) => ({
    line: start + i,
    text: text.trim(),
  }));
}

const featureLines = read(files[0]);
const policyLines = read(files[1]);
const comparatorLines = read(files[2]);

const realizedMatches =
  allMatches(featureLines, "realizedVolatility20");

const featureContexts =
  realizedMatches.map((m) => ({
    occurrenceLine: m.line,
    context: around(featureLines, m.line, 10, 18),
  }));

const avgMatches = [
  ...allMatches(policyLines, "averageVolatility20"),
  ...allMatches(comparatorLines, "averageVolatility20"),
].map((m) => ({
  line: m.line,
  text: m.text.trim(),
}));

const avgContexts = [
  ...allMatches(policyLines, "averageVolatility20").map((m) => ({
    file: files[1],
    occurrenceLine: m.line,
    context: around(policyLines, m.line, 10, 18),
  })),
  ...allMatches(comparatorLines, "averageVolatility20").map((m) => ({
    file: files[2],
    occurrenceLine: m.line,
    context: around(comparatorLines, m.line, 10, 18),
  })),
];

const output = {
  status:
    "MARKET_REGIME_V7_VOLATILITY_SOURCE_TARGET_PROBE_V2_COMPLETE",

  realizedVolatilityOccurrences:
    realizedMatches.map((m) => m.line),

  featureContexts,

  averageVolatilityOccurrences:
    avgMatches,

  averageVolatilityContexts:
    avgContexts,

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    networkCalls: 0,
    filesModified: 0,
    regimePolicyChanged: false,
    forwardEvidenceChanged: false,
  },

  fullDetails:
    "logs/market-regime-v7-volatility-source-target-probe-v2.json",

  nextGate:
    "CLASSIFY_INDEX_VS_STOCK_VOLATILITY_SOURCE",
};

fs.mkdirSync(
  path.resolve(root, "logs"),
  { recursive: true }
);

fs.writeFileSync(
  path.resolve(root, output.fullDetails),
  JSON.stringify(output, null, 2) + "\n",
  "utf8"
);

function compactContext(ctx) {
  if (!ctx) return [];
  return ctx.filter((row) =>
    /realizedVolatility20|averageVolatility20|index|stock|breadth|map\(|reduce\(|avg|average|features|return\s*\{|volatility/i.test(row.text)
  ).slice(0, 18);
}

console.log(JSON.stringify({
  status: output.status,
  realizedVolatilityOccurrences:
    output.realizedVolatilityOccurrences,
  featureContexts:
    output.featureContexts.map((x) => ({
      occurrenceLine: x.occurrenceLine,
      context: compactContext(x.context),
    })),
  averageVolatilityContexts:
    output.averageVolatilityContexts.map((x) => ({
      file: x.file,
      occurrenceLine: x.occurrenceLine,
      context: compactContext(x.context),
    })),
  nextGate: output.nextGate,
  details: output.fullDetails
}, null, 2));
