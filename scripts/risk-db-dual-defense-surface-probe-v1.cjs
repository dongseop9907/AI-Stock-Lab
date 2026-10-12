const fs = require("fs");
const path = require("path");

const root = process.cwd();

const roots = [
  "lib",
  "app",
  "scripts",
  "supabase/migrations",
];

const includeExt = /\.(ts|tsx|js|cjs|sql)$/i;

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      out.push(...walk(abs));
    } else if (includeExt.test(entry.name)) {
      out.push(abs);
    }
  }

  return out;
}

const terms = [
  "aggregate committed risk",
  "AGGREGATE_COMMITTED_RISK",
  "reserved_risk",
  "reservedRisk",
  "risk_approved",
  "RISK_APPROVED",
  "advisory",
  "pg_advisory",
  "active_buy",
  "open_position",
  "stop_risk",
  "maxRiskAmount",
  "risk_amount",
  "paper_orders",
  "positions",
  "trading_orders",
  "emergency_stop",
];

const hits = [];

for (const abs of roots.flatMap((r) => walk(path.resolve(root, r)))) {
  const rel = path.relative(root, abs).replaceAll("\\", "/");

  if (
    rel.includes("install-") ||
    rel.includes("fix-") ||
    rel.includes("probe") ||
    rel.includes("contract-test") ||
    rel.includes("static-verify")
  ) {
    continue;
  }

  let source;
  try {
    source = fs.readFileSync(abs, "utf8");
  } catch {
    continue;
  }

  const lines = source.split(/\r?\n/);

  const matched = [];

  for (let i = 0; i < lines.length; i += 1) {
    const lower = lines[i].toLowerCase();

    const found = terms.filter((term) =>
      lower.includes(term.toLowerCase())
    );

    if (!found.length) continue;

    matched.push({
      line: i + 1,
      terms: found,
      text: lines[i].trim().slice(0, 240),
    });
  }

  if (matched.length) {
    hits.push({
      file: rel,
      hitCount: matched.length,
      lines: matched.slice(0, 18),
    });
  }
}

hits.sort((a, b) => b.hitCount - a.hitCount);

const candidates = hits.slice(0, 12);

const output = {
  status:
    "RISK_DB_DUAL_DEFENSE_SURFACE_PROBE_V1_COMPLETE",

  candidates,

  auditQuestions: [
    "Which risk invariants are enforced only in TypeScript?",
    "Which invariants are also enforced atomically in PostgreSQL?",
    "Can direct DB writes bypass reserved-risk limits or order-state rules?",
    "Are release transitions protected against double release?",
    "Are active-order and open-position risk totals guarded transactionally?"
  ],

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    networkCalls: 0,
    sourceFilesModified: 0,
    orderCreated: 0,
    positionChanged: 0,
    realTradingChanged: false
  },

  fullDetails:
    "logs/risk-db-dual-defense-surface-probe-v1.json",

  nextGate:
    "MAP_APP_RISK_INVARIANTS_TO_DB_CONSTRAINTS_AND_RPC_GUARDS"
};

fs.mkdirSync(path.resolve(root, "logs"), { recursive: true });

fs.writeFileSync(
  path.resolve(root, output.fullDetails),
  JSON.stringify(output, null, 2) + "\n",
  "utf8"
);

console.log(JSON.stringify({
  status: output.status,
  candidates: candidates.map((x) => ({
    file: x.file,
    hitCount: x.hitCount,
    lines: x.lines.slice(0, 6),
  })),
  nextGate: output.nextGate,
  details: output.fullDetails
}, null, 2));
