const fs = require("fs");
const path = require("path");

const root = process.cwd();

const scanRoots = ["lib/market", "lib/trading", "scripts"];

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...walk(abs));
    } else if (/\.(ts|tsx|js|cjs)$/i.test(e.name)) {
      out.push(abs);
    }
  }
  return out;
}

const needles = [
  "highVolatility20Min",
  "realizedVolatility20",
  "Math.sqrt(252",
  "Math.sqrt(252)",
  "sqrt(252",
  "breadth20Max",
  "BLOCK_BREADTH_OR_HIGH_VOL",
];

const hits = [];

for (const abs of scanRoots.flatMap(r => walk(path.resolve(root, r)))) {
  const rel = path.relative(root, abs).replaceAll("\\", "/");

  if (
    rel.includes("install-") ||
    rel.includes("fix-") ||
    rel.includes("probe") ||
    rel.includes("contract-test") ||
    rel.includes("static-verify")
  ) continue;

  let src;
  try { src = fs.readFileSync(abs, "utf8"); } catch { continue; }

  const lines = src.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const matched = needles.filter(n => lines[i].includes(n));
    if (!matched.length) continue;

    hits.push({
      file: rel,
      line: i + 1,
      matched,
      text: lines[i].trim().slice(0, 240),
    });
  }
}

const grouped = {};
for (const h of hits) {
  (grouped[h.file] ??= []).push(h);
}

const policyHits =
  hits.filter(h =>
    h.file === "lib/market/market-regime-v7-policy.ts"
  );

const volatilityHits =
  hits.filter(h =>
    h.matched.some(x =>
      x.includes("realizedVolatility20") ||
      x.includes("sqrt(252") ||
      x.includes("Math.sqrt(252")
    )
  );

const output = {
  status:
    "MARKET_REGIME_V7_THRESHOLD_PROVENANCE_UNIT_AUDIT_V1_COMPLETE",

  policyThresholdSurface:
    policyHits.slice(0, 16),

  volatilityUnitSurface:
    volatilityHits.slice(0, 20),

  allMatchedFiles:
    Object.keys(grouped),

  questions: [
    "Is realizedVolatility20 annualized?",
    "Does 0.30 mean 30% annualized volatility?",
    "Was 0.30 defined before forward evidence?",
    "Is breadth20 based on a five-stock universe and therefore quantized by 0.20?"
  ],

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    networkCalls: 0,
    filesModified: 0,
    regimePolicyChanged: false,
    forwardEvidenceChanged: false
  },

  fullDetails:
    "logs/market-regime-v7-threshold-provenance-unit-audit-v1.json",

  nextGate:
    "CLASSIFY_POLICY_SATURATION_AS_UNIT_BUG_OR_DESIGN_CALIBRATION_ISSUE"
};

fs.mkdirSync(path.resolve(root, "logs"), { recursive: true });
fs.writeFileSync(
  path.resolve(root, output.fullDetails),
  JSON.stringify({ ...output, grouped }, null, 2) + "\n",
  "utf8"
);

console.log(JSON.stringify({
  status: output.status,
  policy: output.policyThresholdSurface.slice(0, 8),
  volatility: output.volatilityUnitSurface.slice(0, 10),
  matchedFiles: output.allMatchedFiles,
  nextGate: output.nextGate,
  details: output.fullDetails
}, null, 2));
