const fs = require("fs");
const path = require("path");

const root = process.cwd();

const preferred = [
  "app/api/trading/stop-loss/check/route.ts",
  "app/api/trading/trailing-stop/update/route.ts",
  "lib/trading/execute-paper-order.ts",
];

const terms = [
  "paper_positions",
  "paper_trade",
  "sell",
  "SELL",
  "quantity",
  "cash_balance",
  "realized_pnl",
  "current_stop_price",
  "stop_price",
  "trailing",
  "execution_price",
  "update(",
  "delete(",
  ".from(",
  ".rpc(",
];

function walk(dir, maxDepth = 5, depth = 0) {
  if (depth > maxDepth) return [];
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", ".next", "logs"].includes(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(abs, maxDepth, depth + 1));
    } else if (/\.(ts|tsx|js|cjs|sql)$/i.test(entry.name)) {
      out.push(abs);
    }
  }
  return out;
}

function rel(abs) {
  return path.relative(root, abs).replace(/\\/g, "/");
}

function read(relPath) {
  const abs = path.resolve(root, relPath);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, "utf8");
}

function matchingLines(source) {
  const lines = source.split(/\r?\n/);
  const hits = [];
  for (let i = 0; i < lines.length; i += 1) {
    const text = lines[i];
    const matched = terms.filter((term) => text.includes(term));
    if (matched.length) {
      hits.push({
        line: i + 1,
        matched,
        text: text.trimEnd(),
      });
    }
  }
  return hits;
}

function excerpt(source, lineNo, before = 18, after = 30) {
  const lines = source.split(/\r?\n/);
  const start = Math.max(0, lineNo - 1 - before);
  const end = Math.min(lines.length, lineNo + after);
  return lines.slice(start, end).map((text, idx) => ({
    line: start + idx + 1,
    text: text.trimEnd(),
  }));
}

function functionBlocks(source) {
  const lines = source.split(/\r?\n/);
  const blocks = [];
  const re = /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/;
  for (let i = 0; i < lines.length; i += 1) {
    const m = re.exec(lines[i]);
    if (m) {
      blocks.push({
        line: i + 1,
        name: m[1],
        declaration: lines[i].trim(),
      });
    }
  }
  return blocks;
}

const allFiles = walk(root, 6);
const related = [];

for (const abs of allFiles) {
  const r = rel(abs);
  const source = fs.readFileSync(abs, "utf8");

  const scoreTerms = [
    "paper_positions",
    "realized_pnl",
    "stop-loss",
    "trailing-stop",
    "current_stop_price",
    "exit_reason",
    "sell_price",
    "closed_at",
  ];

  let score = 0;
  for (const t of scoreTerms) {
    if (source.includes(t)) score += 1;
  }

  if (score >= 2 || preferred.includes(r)) {
    const hits = matchingLines(source);
    related.push({
      file: r,
      score,
      functions: functionBlocks(source),
      hits,
    });
  }
}

related.sort((a, b) =>
  b.score - a.score ||
  a.file.localeCompare(b.file),
);

const top = related.slice(0, 12);

const detailed = [];

for (const item of top) {
  const source = read(item.file);
  const anchors = item.hits
    .filter((h) =>
      h.matched.some((x) =>
        [
          "paper_positions",
          "cash_balance",
          "realized_pnl",
          "quantity",
          "current_stop_price",
          "execution_price",
          ".rpc(",
          "delete(",
        ].includes(x),
      ),
    )
    .slice(0, 6);

  detailed.push({
    file: item.file,
    score: item.score,
    functions: item.functions,
    anchors,
    excerpts: anchors.map((a) => ({
      anchorLine: a.line,
      block: excerpt(source, a.line),
    })),
  });
}

const capability = {
  stopLossRoutePresent:
    fs.existsSync(
      path.resolve(
        root,
        "app/api/trading/stop-loss/check/route.ts",
      ),
    ),

  trailingRoutePresent:
    fs.existsSync(
      path.resolve(
        root,
        "app/api/trading/trailing-stop/update/route.ts",
      ),
    ),

  anyRealizedPnlMutation:
    related.some((x) =>
      x.hits.some((h) =>
        h.text.includes("realized_pnl"),
      ),
    ),

  anyPositionQuantityMutation:
    related.some((x) =>
      x.hits.some((h) =>
        h.text.includes("quantity"),
      ),
    ),

  anyExecutionPriceField:
    related.some((x) =>
      x.hits.some((h) =>
        h.text.includes("execution_price"),
      ),
    ),

  anySellRpc:
    related.some((x) =>
      x.hits.some((h) =>
        h.text.includes(".rpc(") &&
        /sell|exit|close/i.test(h.text),
      ),
    ),
};

const summary = top.map((x) => ({
  file: x.file,
  score: x.score,
  functions: x.functions.slice(0, 8),
  importantHits: x.hits
    .filter((h) =>
      h.matched.some((m) =>
        [
          "paper_positions",
          "cash_balance",
          "realized_pnl",
          "quantity",
          "current_stop_price",
          ".rpc(",
          "delete(",
        ].includes(m),
      ),
    )
    .slice(0, 10),
}));

const output = {
  status:
    "PAPER_EXECUTION_REALISM_V2_PROTECTIVE_SELL_BINDING_PROBE_V1_COMPLETE",
  capability,
  candidates: summary,
  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    networkCalls: 0,
    sourceFilesModified: 0,
    ordersCreated: 0,
    positionsChanged: 0,
    realTradingChanged: false,
  },
  invariant:
    "PROTECTIVE_SELL_MUST_NEVER_BE_BLOCKED_SOLELY_BY_ADVERSE_SLIPPAGE_OR_PARTIAL_FILL_REALISM",
  nextGate:
    "DESIGN_CONFIRMED_PROTECTIVE_SELL_REALISM_BINDING",
  details:
    "logs/paper-execution-realism-v2-protective-sell-binding-probe-v1.json",
};

fs.mkdirSync(
  path.resolve(root, "logs"),
  { recursive: true },
);

fs.writeFileSync(
  path.resolve(root, output.details),
  JSON.stringify(
    {
      ...output,
      detailed,
    },
    null,
    2,
  ) + "\n",
  "utf8",
);

console.log(
  JSON.stringify(
    {
      status: output.status,
      capability: output.capability,
      topCandidates: summary
        .slice(0, 8)
        .map((x) => ({
          file: x.file,
          score: x.score,
          functions: x.functions.map((f) => f.name),
          importantHitLines:
            x.importantHits.map((h) => h.line),
        })),
      invariant: output.invariant,
      nextGate: output.nextGate,
      details: output.details,
    },
    null,
    2,
  ),
);
