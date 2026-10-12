const fs = require("fs");
const path = require("path");

const root = process.cwd();
const rel = "lib/market/market-regime-feature-engine.ts";
const abs = path.resolve(root, rel);

if (!fs.existsSync(abs)) {
  throw new Error("FEATURE_ENGINE_NOT_FOUND");
}

const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/);

const start = 252;
const end = 268;

const exact = lines
  .slice(start - 1, end)
  .map((text, i) => ({
    line: start + i,
    text: text.trim(),
  }));

const output = {
  status:
    "MARKET_REGIME_V7_VOLATILITY_RETURN_EXPRESSION_PROBE_V4_COMPLETE",
  file: rel,
  exact,
  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    networkCalls: 0,
    filesModified: 0,
    regimePolicyChanged: false,
  },
  nextGate:
    "CONFIRM_DECIMAL_VS_PERCENT_RETURN_UNIT",
};

fs.mkdirSync(path.resolve(root, "logs"), { recursive: true });

fs.writeFileSync(
  path.resolve(
    root,
    "logs/market-regime-v7-volatility-return-expression-probe-v4.json"
  ),
  JSON.stringify(output, null, 2) + "\n",
  "utf8"
);

console.log(JSON.stringify(output, null, 2));
