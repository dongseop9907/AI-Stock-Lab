const fs = require("fs");
const path = require("path");

const root = process.cwd();
const rel = "lib/market/market-regime-feature-engine.ts";
const abs = path.resolve(root, rel);

if (!fs.existsSync(abs)) {
  throw new Error("FEATURE_ENGINE_NOT_FOUND");
}

const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/);

function extractFunction(name) {
  const start = lines.findIndex((line) =>
    line.includes(`function ${name}(`)
  );

  if (start < 0) return null;

  const picked = [];
  let depth = 0;
  let started = false;

  for (let i = start; i < lines.length; i += 1) {
    const text = lines[i];
    picked.push({
      line: i + 1,
      text: text.trim(),
    });

    for (const ch of text) {
      if (ch === "{") {
        depth += 1;
        started = true;
      } else if (ch === "}") {
        depth -= 1;
        if (started && depth === 0) {
          return picked;
        }
      }
    }

    if (picked.length >= 80) break;
  }

  return picked;
}

const candidates = [
  "calculateAnnualizedVolatility",
  "calculateReturns",
  "calculateReturnSeries",
  "pctReturn",
  "simpleReturn",
];

const blocks = candidates
  .map((name) => ({
    name,
    block: extractFunction(name),
  }))
  .filter((x) => x.block);

const nearbyReturnMath = lines
  .map((text, i) => ({
    line: i + 1,
    text: text.trim(),
  }))
  .filter((row) =>
    row.line >= 220 &&
    row.line <= 310 &&
    (
      /return/i.test(row.text) ||
      /close/i.test(row.text) ||
      /Math\.log/i.test(row.text) ||
      /100/.test(row.text) ||
      /sqrt\(252/i.test(row.text) ||
      /std|variance|mean/i.test(row.text)
    )
  );

const output = {
  status:
    "MARKET_REGIME_V7_VOLATILITY_FORMULA_UNIT_PROBE_V3_COMPLETE",
  blocks,
  nearbyReturnMath,
  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    networkCalls: 0,
    filesModified: 0,
    regimePolicyChanged: false,
    forwardEvidenceChanged: false,
  },
  fullDetails:
    "logs/market-regime-v7-volatility-formula-unit-probe-v3.json",
  nextGate:
    "CONFIRM_RETURN_UNIT_AND_VOLATILITY_SCALE",
};

fs.mkdirSync(
  path.resolve(root, "logs"),
  { recursive: true },
);

fs.writeFileSync(
  path.resolve(root, output.fullDetails),
  JSON.stringify(output, null, 2) + "\n",
  "utf8",
);

function compact(rows) {
  if (!rows) return null;

  return rows.filter((row) =>
    /return|close|Math\.log|100|sqrt|variance|mean|std|length|slice/i.test(
      row.text
    )
  ).slice(0, 24);
}

console.log(JSON.stringify({
  status: output.status,
  functions: blocks.map((x) => ({
    name: x.name,
    lines: compact(x.block),
  })),
  nearby: compact(nearbyReturnMath),
  nextGate: output.nextGate,
  details: output.fullDetails
}, null, 2));
