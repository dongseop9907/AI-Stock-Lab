const fs = require("fs");
const path = require("path");

const root = process.cwd();

const targets = [
  "lib/trading/paper-execution-price-model.ts",
  "lib/trading/execute-paper-order.ts",
  "supabase/migrations/20261008001800_gap_slippage_execution_binding_v1.sql",
];

function lines(rel) {
  const abs = path.resolve(root, rel);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, "utf8").split(/\r?\n/);
}

function around(ls, needle, before = 8, after = 18, maxMatches = 4) {
  if (!ls) return [];
  const out = [];
  for (let i = 0; i < ls.length; i += 1) {
    if (!ls[i].includes(needle)) continue;
    const start = Math.max(0, i - before);
    const end = Math.min(ls.length, i + after + 1);
    out.push({
      line: i + 1,
      excerpt: ls.slice(start, end).map((text, j) => ({
        line: start + j + 1,
        text: text.trim(),
      })),
    });
    if (out.length >= maxMatches) break;
  }
  return out;
}

const result = {};

for (const rel of targets) {
  const ls = lines(rel);

  result[rel] = {
    exists: Boolean(ls),
    anchors: ls
      ? {
          decidePaperExecutionPrice:
            around(ls, "decidePaperExecutionPrice", 10, 34, 3),
          derive:
            around(ls, "executionPrice", 10, 24, 5),
          rpc:
            around(ls, "execute_paper_buy_order_with_execution_price_v1", 8, 34, 3),
          observed:
            around(ls, "observed", 8, 18, 3),
          filledQuantity:
            around(ls, "filled_quantity", 8, 20, 4),
          approvedQuantity:
            around(ls, "approved_quantity", 8, 20, 4),
        }
      : {},
  };
}

/* Find likely real-time quote/orderbook sources in production code only. */
const searchRoots = ["lib", "app"];
const quoteTerms = [
  "bid_price",
  "ask_price",
  "best_bid",
  "best_ask",
  "orderbook",
  "order_book",
  "askPrice",
  "bidPrice",
  "ask_qty",
  "bid_qty",
  "askQuantity",
  "bidQuantity",
  "호가",
];

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(abs));
    else if (/\.(ts|tsx|js|cjs)$/i.test(e.name)) out.push(abs);
  }
  return out;
}

const quoteHits = [];

for (const abs of searchRoots.flatMap((r) => walk(path.resolve(root, r)))) {
  const rel = path.relative(root, abs).replaceAll("\\", "/");

  let src;
  try { src = fs.readFileSync(abs, "utf8"); } catch { continue; }

  const ls = src.split(/\r?\n/);

  const hits = [];
  for (let i = 0; i < ls.length; i += 1) {
    const matched = quoteTerms.filter((term) =>
      ls[i].toLowerCase().includes(term.toLowerCase())
    );
    if (!matched.length) continue;

    hits.push({
      line: i + 1,
      matched,
      text: ls[i].trim().slice(0, 220),
    });
  }

  if (hits.length) {
    quoteHits.push({
      file: rel,
      hitCount: hits.length,
      hits: hits.slice(0, 12),
    });
  }
}

quoteHits.sort((a, b) => b.hitCount - a.hitCount);

/* Search production paper PnL/cost path. */
const costTerms = [
  "brokerFee",
  "commission",
  "sellTax",
  "transactionCost",
  "transaction_cost",
  "feeRate",
  "taxRate",
  "realizedPnl",
  "realized_pnl",
];

const costHits = [];

for (const abs of searchRoots.flatMap((r) => walk(path.resolve(root, r)))) {
  const rel = path.relative(root, abs).replaceAll("\\", "/");

  let src;
  try { src = fs.readFileSync(abs, "utf8"); } catch { continue; }

  const ls = src.split(/\r?\n/);
  const hits = [];

  for (let i = 0; i < ls.length; i += 1) {
    const matched = costTerms.filter((term) =>
      ls[i].toLowerCase().includes(term.toLowerCase())
    );

    if (!matched.length) continue;

    hits.push({
      line: i + 1,
      matched,
      text: ls[i].trim().slice(0, 220),
    });
  }

  if (hits.length) {
    costHits.push({
      file: rel,
      hitCount: hits.length,
      hits: hits.slice(0, 12),
    });
  }
}

costHits.sort((a, b) => b.hitCount - a.hitCount);

const output = {
  status:
    "PAPER_EXECUTION_REALISM_V2_EXACT_SOURCE_PROBE_V1_COMPLETE",

  core: result,

  quoteSourceCandidates:
    quoteHits.slice(0, 10),

  costPathCandidates:
    costHits.slice(0, 10),

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    networkCalls: 0,
    sourceFilesModified: 0,
    ordersCreated: 0,
    positionsChanged: 0,
    realTradingChanged: false,
  },

  fullDetails:
    "logs/paper-execution-realism-v2-exact-source-probe-v1.json",

  nextGate:
    "DESIGN_V2_AGAINST_CONFIRMED_EXECUTOR_AND_MARKET_DATA_SURFACES",
};

fs.mkdirSync(path.resolve(root, "logs"), { recursive: true });

fs.writeFileSync(
  path.resolve(root, output.fullDetails),
  JSON.stringify(output, null, 2) + "\n",
  "utf8"
);

/* Keep console compact: show anchors counts + top quote/cost files only. */
console.log(JSON.stringify({
  status: output.status,
  core: Object.fromEntries(
    Object.entries(result).map(([file, x]) => [
      file,
      {
        exists: x.exists,
        anchorCounts: Object.fromEntries(
          Object.entries(x.anchors ?? {}).map(([k, v]) => [k, v.length])
        )
      }
    ])
  ),
  quoteSourceCandidates:
    output.quoteSourceCandidates.map((x) => ({
      file: x.file,
      hitCount: x.hitCount,
      sample: x.hits.slice(0, 4),
    })),
  costPathCandidates:
    output.costPathCandidates.map((x) => ({
      file: x.file,
      hitCount: x.hitCount,
      sample: x.hits.slice(0, 4),
    })),
  nextGate: output.nextGate,
  details: output.fullDetails
}, null, 2));
