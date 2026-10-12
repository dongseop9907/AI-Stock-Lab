const fs = require("fs");
const path = require("path");

const root = process.cwd();

const targets = [
  "lib/trading/paper-execution-price-model.ts",
  "lib/trading/execute-paper-order.ts",
  "supabase/migrations/20261008001800_gap_slippage_execution_binding_v1.sql",
];

function read(rel) {
  const abs = path.resolve(root, rel);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, "utf8");
}

function scan(rel, source) {
  if (!source) {
    return {
      file: rel,
      exists: false,
      signals: {},
      importantLines: [],
    };
  }

  const terms = [
    "bid",
    "ask",
    "spread",
    "orderbook",
    "order_book",
    "volume",
    "liquidity",
    "partial",
    "filled_quantity",
    "executionPrice",
    "execution_price",
    "slippage",
    "commission",
    "brokerFee",
    "fee",
    "tax",
    "transaction_cost",
    "marketImpact",
    "market_impact",
    "observedAt",
    "observed_at",
    "stale",
  ];

  const lines = source.split(/\r?\n/);

  const importantLines = [];

  for (let i = 0; i < lines.length; i += 1) {
    const matched =
      terms.filter((term) =>
        lines[i].toLowerCase().includes(term.toLowerCase())
      );

    if (!matched.length) continue;

    importantLines.push({
      line: i + 1,
      matched,
      text: lines[i].trim().slice(0, 240),
    });
  }

  const lower = source.toLowerCase();

  return {
    file: rel,
    exists: true,
    signals: {
      usesBidAsk:
        /\bbid\b/i.test(source) ||
        /\bask\b/i.test(source),
      usesSpread:
        /spread/i.test(source),
      usesOrderbook:
        /orderbook|order_book/i.test(source),
      usesVolumeLiquidity:
        /liquidity|market_impact|marketimpact/i.test(source) ||
        (
          /\bvolume\b/i.test(source) &&
          /fill|execution/i.test(source)
        ),
      partialFill:
        /partial[_\s-]?fill/i.test(source) ||
        (
          /filled_quantity/i.test(source) &&
          /approved_quantity/i.test(source) &&
          /least\s*\(/i.test(source)
        ),
      transactionCosts:
        /commission|brokerfee|transaction_cost|sell.*tax|buy.*fee|sell.*fee/i.test(source),
      executionPrice:
        /executionprice|execution_price/i.test(source),
      quoteFreshness:
        /stale|observed_at|observedat/i.test(source),
    },
    importantLines: importantLines.slice(0, 24),
  };
}

const surfaces = targets.map((rel) =>
  scan(rel, read(rel))
);

const packageFiles = [
  "lib/trading",
  "app/api",
];

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const found = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) found.push(...walk(abs));
    else if (/\.(ts|tsx|js|cjs)$/i.test(e.name)) found.push(abs);
  }
  return found;
}

const costHits = [];

for (const abs of packageFiles.flatMap((rel) => walk(path.resolve(root, rel)))) {
  const rel = path.relative(root, abs).replaceAll("\\", "/");

  if (
    rel.includes("probe") ||
    rel.includes("install-") ||
    rel.includes("fix-") ||
    rel.includes("contract-test") ||
    rel.includes("static-verify")
  ) continue;

  let src;
  try {
    src = fs.readFileSync(abs, "utf8");
  } catch {
    continue;
  }

  if (!/commission|brokerFee|sellTax|transaction_cost|trade_fee|tax_rate/i.test(src)) {
    continue;
  }

  costHits.push({
    file: rel,
    lines: src
      .split(/\r?\n/)
      .map((text, i) => ({
        line: i + 1,
        text: text.trim(),
      }))
      .filter((x) =>
        /commission|brokerFee|sellTax|transaction_cost|trade_fee|tax_rate/i.test(x.text)
      )
      .slice(0, 12),
  });
}

const priceModel =
  surfaces.find((x) =>
    x.file.endsWith("paper-execution-price-model.ts")
  );

const executor =
  surfaces.find((x) =>
    x.file.endsWith("execute-paper-order.ts")
  );

const dbBinding =
  surfaces.find((x) =>
    x.file.endsWith("20261008001800_gap_slippage_execution_binding_v1.sql")
  );

const capability = {
  executionPriceBound:
    Boolean(
      priceModel?.signals.executionPrice &&
      executor?.signals.executionPrice &&
      dbBinding?.signals.executionPrice
    ),

  spreadOrBidAskBound:
    Boolean(
      priceModel?.signals.usesBidAsk ||
      priceModel?.signals.usesSpread ||
      executor?.signals.usesBidAsk ||
      executor?.signals.usesSpread
    ),

  orderbookBound:
    Boolean(
      priceModel?.signals.usesOrderbook ||
      executor?.signals.usesOrderbook
    ),

  partialFillBound:
    Boolean(
      executor?.signals.partialFill ||
      dbBinding?.signals.partialFill
    ),

  liquidityMarketImpactBound:
    Boolean(
      priceModel?.signals.usesVolumeLiquidity ||
      executor?.signals.usesVolumeLiquidity ||
      dbBinding?.signals.usesVolumeLiquidity
    ),

  transactionCostBound:
    costHits.length > 0,

  quoteFreshnessBound:
    Boolean(
      priceModel?.signals.quoteFreshness ||
      executor?.signals.quoteFreshness ||
      dbBinding?.signals.quoteFreshness
    ),
};

const likelyGaps = [];

if (!capability.spreadOrBidAskBound) {
  likelyGaps.push("NO_LIVE_SPREAD_OR_BID_ASK_EXECUTION_MODEL");
}

if (!capability.orderbookBound) {
  likelyGaps.push("NO_ORDERBOOK_DEPTH_EXECUTION_MODEL");
}

if (!capability.partialFillBound) {
  likelyGaps.push("NO_PARTIAL_FILL_EXECUTION_MODEL");
}

if (!capability.liquidityMarketImpactBound) {
  likelyGaps.push("NO_LIQUIDITY_OR_MARKET_IMPACT_MODEL");
}

if (!capability.transactionCostBound) {
  likelyGaps.push("NO_PAPER_TRANSACTION_COST_BINDING");
}

if (!capability.quoteFreshnessBound) {
  likelyGaps.push("NO_QUOTE_FRESHNESS_BINDING");
}

const output = {
  status:
    "PAPER_EXECUTION_REALISM_V2_BINDING_AUDIT_V1_COMPLETE",

  capability,

  likelyGaps,

  surfaces,

  paperCostBindingCandidates:
    costHits.slice(0, 8),

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
    "logs/paper-execution-realism-v2-binding-audit-v1.json",

  nextGate:
    likelyGaps.length
      ? "DESIGN_ONLY_MISSING_PAPER_EXECUTION_REALISM_COMPONENTS"
      : "PAPER_EXECUTION_REALISM_V2_ALREADY_BOUND",
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

console.log(
  JSON.stringify(
    {
      status: output.status,
      capability: output.capability,
      likelyGaps: output.likelyGaps,
      costCandidates:
        output.paperCostBindingCandidates.map((x) => x.file),
      nextGate: output.nextGate,
      details: output.fullDetails,
    },
    null,
    2,
  ),
);
