import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const MIG_DIR = path.join(ROOT, "supabase", "migrations");

function readSqlFiles() {
  if (!fs.existsSync(MIG_DIR)) return [];

  return fs.readdirSync(MIG_DIR)
    .filter(name => name.endsWith(".sql"))
    .sort()
    .map(name => ({
      name,
      abs: path.join(MIG_DIR, name),
      text: fs.readFileSync(path.join(MIG_DIR, name), "utf8"),
    }));
}

function context(text: string, patterns: RegExp[], radius = 10) {
  const lines = text.split(/\r?\n/);
  const out: any[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (!patterns.some(p => p.test(lines[i]))) continue;

    const start = Math.max(0, i - radius);
    const end = Math.min(lines.length - 1, i + radius);

    out.push({
      line: i + 1,
      text: lines[i],
      context: lines.slice(start, end + 1).map((line, offset) => ({
        line: start + offset + 1,
        text: line,
      })),
    });
  }

  return out;
}

function normalize(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

const files = readSqlFiles();

const schemaMentions = files
  .filter(f =>
    /paper_trade_history/i.test(f.text) &&
    /buy_order_id/i.test(f.text)
  )
  .map(f => ({
    file: f.name,
    addsColumn:
      /alter\s+table\s+(?:public\.)?paper_trade_history[\s\S]{0,1600}?add\s+column[\s\S]{0,500}?buy_order_id/i.test(f.text) ||
      /create\s+table[\s\S]{0,2500}?paper_trade_history[\s\S]{0,2500}?buy_order_id/i.test(f.text),

    updatesColumn:
      /update\s+(?:public\.)?paper_trade_history[\s\S]{0,1200}?set[\s\S]{0,500}?buy_order_id\s*=/i.test(f.text),

    insertsColumn:
      /insert\s+into\s+(?:public\.)?paper_trade_history\s*\([\s\S]{0,1800}?buy_order_id/i.test(f.text),

    assignsNewColumn:
      /new\.buy_order_id\s*:=/i.test(f.text) ||
      /new\.buy_order_id\s*=/i.test(f.text),

    triggerOnTradeHistory:
      /create\s+trigger[\s\S]{0,1200}?(?:before|after)\s+(?:insert|update)[\s\S]{0,600}?on\s+(?:public\.)?paper_trade_history/i.test(f.text),

    evidence:
      context(
        f.text,
        [
          /buy_order_id/i,
          /paper_trade_history/i,
          /create\s+trigger/i,
          /new\.buy_order_id/i,
        ],
        12,
      ).slice(0, 40),
  }));

const triggerDefs = files
  .filter(f =>
    /on\s+(?:public\.)?paper_trade_history/i.test(f.text) &&
    /create\s+trigger/i.test(f.text)
  )
  .map(f => ({
    file: f.name,
    text: f.text,
    triggerEvidence:
      context(
        f.text,
        [
          /create\s+trigger/i,
          /on\s+(?:public\.)?paper_trade_history/i,
          /execute\s+(?:function|procedure)/i,
        ],
        14,
      ).slice(0, 30),
  }));

const functionAssignmentDefs = files
  .filter(f =>
    /new\.buy_order_id\s*:=/i.test(f.text) ||
    /new\.buy_order_id\s*=/i.test(f.text)
  )
  .map(f => ({
    file: f.name,
    directNewBuyOrderAssignment: true,
    evidence:
      context(
        f.text,
        [
          /new\.buy_order_id/i,
          /source_position_id/i,
          /paper_order_requests/i,
          /paper_trade_history/i,
        ],
        14,
      ).slice(0, 35),
  }));

const insertDefs = files
  .filter(f =>
    /insert\s+into\s+(?:public\.)?paper_trade_history/i.test(f.text)
  )
  .map(f => ({
    file: f.name,
    hasBuyOrderIdInInsert:
      /insert\s+into\s+(?:public\.)?paper_trade_history\s*\([\s\S]{0,2000}?buy_order_id/i.test(f.text),

    linksBySourcePosition:
      /source_position_id/i.test(f.text),

    evidence:
      context(
        f.text,
        [
          /insert\s+into\s+(?:public\.)?paper_trade_history/i,
          /buy_order_id/i,
          /source_position_id/i,
        ],
        18,
      ).slice(0, 40),
  }));

const currentSell = files.find(
  f => f.name === "20261009000200_paper_execution_realism_v2_protective_sell.sql",
);

const currentCost = files.find(
  f => f.name === "20261010000100_paper_execution_cost_attribution_v1.sql",
);

const canonicalSellDirectBuyLink =
  Boolean(
    currentSell &&
    /insert\s+into\s+public\.paper_trade_history\s*\([\s\S]{0,2200}?buy_order_id/i.test(currentSell.text),
  );

const costRequiresBuyOrderId =
  Boolean(
    currentCost &&
    /if\s+new\.buy_order_id\s+is\s+not\s+null\s+then/i.test(currentCost.text) &&
    /where\s+id\s*=\s*new\.buy_order_id/i.test(currentCost.text),
  );

const costLoadsFullFee =
  Boolean(
    currentCost &&
    /v_entry_broker_fee\s*:=[\s\S]{0,700}?v_buy_order\.execution_broker_fee/i.test(currentCost.text),
  );

const costProratesFee =
  Boolean(
    currentCost &&
    (
      /v_entry_broker_fee\s*:=[\s\S]{0,1600}?new\.quantity[\s\S]{0,1600}?v_buy_order\.filled_quantity/i.test(currentCost.text) ||
      /v_entry_broker_fee\s*:=[\s\S]{0,1400}?v_buy_order\.execution_broker_fee[\s\S]{0,1200}?\*[\s\S]{0,500}?new\.quantity[\s\S]{0,800}?\/[\s\S]{0,500}?v_buy_order\.filled_quantity/i.test(currentCost.text)
    ),
  );

const reliableDirectAssignment =
  functionAssignmentDefs.length > 0;

const reliableInsertLink =
  insertDefs.some(x => x.hasBuyOrderIdInInsert);

const reliableTriggerPath =
  triggerDefs.length > 0 &&
  functionAssignmentDefs.length > 0;

let linkageClassification: string;
let accountingClassification: string;
let nextGate: string;

if (canonicalSellDirectBuyLink || reliableTriggerPath || reliableInsertLink) {
  linkageClassification = "BUY_ORDER_LINKAGE_PATH_EXISTS";
}
else {
  linkageClassification = "BUY_ORDER_LINKAGE_PATH_NOT_PROVEN";
}

if (
  linkageClassification === "BUY_ORDER_LINKAGE_PATH_NOT_PROVEN" &&
  costRequiresBuyOrderId
) {
  accountingClassification =
    "ENTRY_FEE_ATTRIBUTION_LINKAGE_GAP_CONFIRMED";
  nextGate =
    "DESIGN_BUY_ORDER_LINKAGE_AND_PARTIAL_EXIT_FEE_ALLOCATION_REPAIR";
}
else if (
  linkageClassification === "BUY_ORDER_LINKAGE_PATH_EXISTS" &&
  costLoadsFullFee &&
  !costProratesFee
) {
  accountingClassification =
    "ENTRY_FEE_PARTIAL_EXIT_DOUBLE_COUNT_CONFIRMED";
  nextGate =
    "DESIGN_PARTIAL_EXIT_ENTRY_FEE_PRORATION_REPAIR";
}
else if (
  linkageClassification === "BUY_ORDER_LINKAGE_PATH_EXISTS" &&
  costProratesFee
) {
  accountingClassification =
    "ENTRY_FEE_PARTIAL_EXIT_ALLOCATION_SAFE";
  nextGate =
    "CLOSE_PARTIAL_EXIT_ENTRY_FEE_ALLOCATION";
}
else {
  accountingClassification =
    "ENTRY_FEE_PARTIAL_EXIT_LINEAGE_INCONCLUSIVE";
  nextGate =
    "REVIEW_EXACT_LINEAGE_EVIDENCE";
}

console.log(JSON.stringify({
  status:
    "AI_STOCK_LAB_PAPER_PARTIAL_EXIT_ENTRY_FEE_LINEAGE_AUDIT_V3_COMPLETE",

  linkageClassification,
  accountingClassification,

  canonical: {
    protectiveSellMigrationFound:
      Boolean(currentSell),

    costAttributionMigrationFound:
      Boolean(currentCost),

    canonicalSellDirectBuyLink,

    costRequiresBuyOrderId,
    costLoadsFullFee,
    costProratesFee,
  },

  lineageEvidence: {
    schemaMentions,
    triggerDefs,
    functionAssignmentDefs,
    insertDefs,
  },

  interpretation:
    accountingClassification ===
      "ENTRY_FEE_ATTRIBUTION_LINKAGE_GAP_CONFIRMED"
      ? "Current SELL trade-history creation does not prove a reliable originating BUY-order link while cost attribution requires new.buy_order_id. Entry fee attribution can therefore be missing or incomplete."
      : accountingClassification ===
          "ENTRY_FEE_PARTIAL_EXIT_DOUBLE_COUNT_CONFIRMED"
        ? "A BUY-order linkage path exists, but the cost-attribution trigger consumes the full BUY execution fee without quantity allocation. Multiple partial exits can over-count the entry fee in aggregated net PnL."
        : accountingClassification ===
            "ENTRY_FEE_PARTIAL_EXIT_ALLOCATION_SAFE"
          ? "BUY-order linkage and partial-exit fee proration are both structurally present."
          : "The exact originating-BUY lineage or allocation formula still needs focused review.",

  safety: {
    sourceOnly: true,
    databaseReads: 0,
    databaseWrites: 0,
    externalApiCalls: 0,
    ordersCreated: 0,
    ordersExecuted: 0,
    positionsChanged: 0,
    realTradingEnabled: false,
  },

  nextGate,
}, null, 2));

process.exitCode = 0;
