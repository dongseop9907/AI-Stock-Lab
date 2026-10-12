const fs = require("fs");
const path = require("path");

const root = process.cwd();
const rel = "lib/market/market-regime-feature-engine.ts";
const abs = path.resolve(root, rel);

if (!fs.existsSync(abs)) {
  throw new Error("FEATURE_ENGINE_NOT_FOUND");
}

const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/);

function excerpt(start, end) {
  return lines.slice(start - 1, end).map((text, i) => ({
    line: start + i,
    text: text.trim(),
  }));
}

function aroundNeedle(needle, before = 6, after = 12) {
  const idx = lines.findIndex((line) => line.includes(needle));
  if (idx < 0) return null;
  return excerpt(
    Math.max(1, idx + 1 - before),
    Math.min(lines.length, idx + 1 + after),
  );
}

const output = {
  status:
    "MARKET_REGIME_V7_VOLATILITY_AGGREGATION_PROBE_V1_COMPLETE",

  realizedVolFormula:
    aroundNeedle("Math.sqrt(252)", 10, 10),

  realizedVolAssignment:
    aroundNeedle("realizedVolatility20:", 8, 14),

  aggregationSurface:
    [
      "averageVolatility20",
      "avg(",
      "realizedVolatility20",
      "active",
      "stock",
    ].map((needle) => ({
      needle,
      excerpt: aroundNeedle(needle, 8, 16),
    })),

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    networkCalls: 0,
    filesModified: 0,
    regimePolicyChanged: false,
  },

  fullDetails:
    "logs/market-regime-v7-volatility-aggregation-probe-v1.json",

  nextGate:
    "CLASSIFY_VOLATILITY_FEATURE_TARGET_MISMATCH",
};

fs.mkdirSync(path.resolve(root, "logs"), { recursive: true });

fs.writeFileSync(
  path.resolve(root, output.fullDetails),
  JSON.stringify(output, null, 2) + "\n",
  "utf8"
);

function compactBlock(block) {
  if (!block) return null;
  return block.filter((row) =>
    /sqrt|volatility|average|avg|return|stock|index|breadth/i.test(row.text)
  ).slice(0, 14);
}

console.log(JSON.stringify({
  status: output.status,
  formula: compactBlock(output.realizedVolFormula),
  assignment: compactBlock(output.realizedVolAssignment),
  aggregation:
    output.aggregationSurface
      .map((x) => ({
        needle: x.needle,
        excerpt: compactBlock(x.excerpt),
      }))
      .filter((x) => x.excerpt && x.excerpt.length),
  nextGate: output.nextGate,
  details: output.fullDetails
}, null, 2));
