const fs = require("fs");
const path = require("path");

const root = process.cwd();

const roots = [
  "lib/trading",
  "app/api",
  "scripts",
  "supabase/migrations",
];

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      out.push(...walk(abs));
    } else if (/\.(ts|tsx|js|cjs|sql)$/i.test(entry.name)) {
      out.push(abs);
    }
  }

  return out;
}

const terms = [
  "executionPrice",
  "execution_price",
  "slippage",
  "spread",
  "bid",
  "ask",
  "orderbook",
  "order_book",
  "partial fill",
  "partial_fill",
  "filled_quantity",
  "approved_quantity",
  "liquidity",
  "volume",
  "market impact",
  "market_impact",
  "commission",
  "fee",
  "tax",
  "transaction_cost",
  "paper execution",
  "PAPER_EXECUTION",
];

const files = roots
  .flatMap((r) => walk(path.resolve(root, r)));

const scored = [];

for (const abs of files) {
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

  let src;
  try {
    src = fs.readFileSync(abs, "utf8");
  } catch {
    continue;
  }

  const lines = src.split(/\r?\n/);
  const hits = [];

  for (let i = 0; i < lines.length; i += 1) {
    const lower = lines[i].toLowerCase();

    const matched = terms.filter((term) =>
      lower.includes(term.toLowerCase())
    );

    if (!matched.length) continue;

    hits.push({
      line: i + 1,
      matched,
      text: lines[i].trim().slice(0, 220),
    });
  }

  if (hits.length) {
    scored.push({
      file: rel,
      hitCount: hits.length,
      hits,
    });
  }
}

scored.sort((a, b) => b.hitCount - a.hitCount);

const candidates =
  scored.slice(0, 14);

const capability = {
  executionPriceModel:
    scored.some((x) =>
      /paper-execution-price|execution.*price/i.test(x.file)
    ),
  slippageModel:
    scored.some((x) =>
      x.hits.some((h) =>
        h.matched.some((m) => /slippage/i.test(m))
      )
    ),
  spreadModel:
    scored.some((x) =>
      x.hits.some((h) =>
        h.matched.some((m) => /spread|bid|ask|orderbook|order_book/i.test(m))
      )
    ),
  partialFillModel:
    scored.some((x) =>
      x.hits.some((h) =>
        h.matched.some((m) => /partial.fill|filled_quantity/i.test(m))
      )
    ),
  liquidityModel:
    scored.some((x) =>
      x.hits.some((h) =>
        h.matched.some((m) => /liquidity|volume|market impact|market_impact/i.test(m))
      )
    ),
  transactionCostModel:
    scored.some((x) =>
      x.hits.some((h) =>
        h.matched.some((m) => /commission|fee|tax|transaction_cost/i.test(m))
      )
    ),
};

const output = {
  status:
    "PAPER_EXECUTION_REALISM_V2_SURFACE_PROBE_V1_COMPLETE",

  capability,

  candidates:
    candidates.map((x) => ({
      file: x.file,
      hitCount: x.hitCount,
      lines: x.hits.slice(0, 8),
    })),

  auditQuestions: [
    "Is PAPER execution price derived only from requested/last price, or from spread/orderbook?",
    "Can fills be partial based on available liquidity?",
    "Is market impact modeled as order size grows?",
    "Are commissions, fees, and sell taxes reflected in realized PnL?",
    "Are stale/missing quote surfaces handled fail-closed?"
  ],

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    networkCalls: 0,
    sourceFilesModified: 0,
    ordersCreated: 0,
    positionsChanged: 0,
    realTradingChanged: false
  },

  fullDetails:
    "logs/paper-execution-realism-v2-surface-probe-v1.json",

  nextGate:
    "MAP_CURRENT_PAPER_EXECUTION_MODEL_AND_IDENTIFY_REALISM_GAPS"
};

fs.mkdirSync(path.resolve(root, "logs"), { recursive: true });

fs.writeFileSync(
  path.resolve(root, output.fullDetails),
  JSON.stringify(output, null, 2) + "\n",
  "utf8"
);

console.log(JSON.stringify({
  status: output.status,
  capability: output.capability,
  candidates: output.candidates,
  nextGate: output.nextGate,
  details: output.fullDetails
}, null, 2));
