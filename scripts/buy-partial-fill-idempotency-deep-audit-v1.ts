import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const MIG_DIR = path.join(ROOT, "supabase", "migrations");

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];

  const out: string[] = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      out.push(...walk(abs));
    } else if (
      entry.isFile() &&
      /\.(ts|tsx|js|mjs|cjs|sql)$/.test(entry.name)
    ) {
      out.push(abs);
    }
  }

  return out;
}

function read(abs: string) {
  return fs.existsSync(abs)
    ? fs.readFileSync(abs, "utf8")
    : "";
}

function rel(abs: string) {
  return path.relative(ROOT, abs).replaceAll("\\", "/");
}

function extractFunctionBody(text: string, fnName: string) {
  const startRe = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${fnName}\\s*\\(`,
    "i",
  );

  const m = startRe.exec(text);
  if (!m) return "";

  const tail = text.slice(m.index);
  const end = tail.search(/\$\$\s*;/);

  return end >= 0
    ? tail.slice(0, end + 3)
    : tail;
}

function context(text: string, patterns: RegExp[], radius = 8) {
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

const sqlFiles = fs.existsSync(MIG_DIR)
  ? fs.readdirSync(MIG_DIR)
      .filter(name => name.endsWith(".sql"))
      .sort()
      .map(name => ({
        name,
        abs: path.join(MIG_DIR, name),
        text: read(path.join(MIG_DIR, name)),
      }))
  : [];

const buyV2File =
  sqlFiles.find(f =>
    /create\s+or\s+replace\s+function\s+public\.execute_paper_buy_order_with_execution_price_v2\s*\(/i.test(f.text)
  ) ?? null;

const buyV4File =
  sqlFiles.find(f =>
    /create\s+or\s+replace\s+function\s+public\.execute_paper_buy_order_with_execution_price_v4\s*\(/i.test(f.text)
  ) ?? null;

const buyV2 = buyV2File
  ? extractFunctionBody(
      buyV2File.text,
      "execute_paper_buy_order_with_execution_price_v2",
    )
  : "";

const buyV4 = buyV4File
  ? extractFunctionBody(
      buyV4File.text,
      "execute_paper_buy_order_with_execution_price_v4",
    )
  : "";

const productionFiles = [
  ...walk(path.join(ROOT, "lib")),
  ...walk(path.join(ROOT, "app")),
];

const productionRows = productionFiles.map(abs => ({
  file: rel(abs),
  text: read(abs),
}));

const buyV4CallSites = productionRows
  .filter(row =>
    /execute_paper_buy_order_with_execution_price_v4/i.test(row.text)
  )
  .map(row => ({
    file: row.file,
    rpcCall:
      /\.rpc\s*\(\s*['"`]execute_paper_buy_order_with_execution_price_v4['"`]/i.test(
        row.text,
      ),
  }));

const allSql = sqlFiles.map(f => f.text).join("\n\n");

const ledgerCandidates = sqlFiles
  .filter(f =>
    /create\s+table/i.test(f.text) &&
    /(buy|order)/i.test(f.text) &&
    /fill|execution/i.test(f.text)
  )
  .map(f => f.name);

const eventIdentityCandidates = sqlFiles
  .filter(f =>
    /(idempotency|event_key|execution_key|fill_key|request_key|dedup|dedupe)/i.test(
      f.text,
    )
  )
  .map(f => f.name);

const buyChecks = {
  canonicalV2Found:
    buyV2.length > 0,

  canonicalV4Found:
    buyV4.length > 0,

  v2OrderRowLocked:
    /from\s+public\.paper_order_requests[\s\S]{0,700}?where\s+id\s*=\s*p_order_id[\s\S]{0,300}?for\s+update/i.test(
      buyV2,
    ),

  v2FullFillShortCircuitOnly:
    /if\s+v_order\.status\s*=\s*'FILLED'\s+then[\s\S]{0,800}?alreadyFilled/i.test(
      buyV2,
    ),

  v2PartialFillSupported:
    /p_fill_quantity/i.test(buyV2) &&
    /v_effective_fill_quantity/i.test(buyV2) &&
    /v_remaining_quantity/i.test(buyV2),

  v2PartialFillLeavesRiskApproved:
    /when\s+v_is_final_fill\s+then\s+'FILLED'[\s\S]{0,250}?else\s+'RISK_APPROVED'/i.test(
      buyV2,
    ),

  v2DebitsCashPerCall:
    /cash_balance\s*=\s*cash_balance\s*-\s*v_order_amount/i.test(
      buyV2,
    ),

  v2MutatesPositionPerCall:
    /update\s+public\.paper_positions/i.test(buyV2) &&
    /insert\s+into\s+public\.paper_positions/i.test(buyV2),

  v2IncrementsFilledQuantity:
    /filled_quantity\s*=[\s\S]{0,400}?v_prior_filled_quantity\s*\+\s*v_effective_fill_quantity/i.test(
      buyV2,
    ),

  v4DelegatesV3:
    /execute_paper_buy_order_with_execution_price_v3/i.test(
      buyV4,
    ),

  v4AlreadyFilledNoRewrite:
    /alreadyFilled/i.test(buyV4) &&
    /return\s+v_result/i.test(buyV4),

  v4HasObservedAt:
    /p_execution_observed_at\s+timestamptz/i.test(
      buyV4,
    ),

  explicitIdempotencyParameter:
    /p_(?:idempotency|event_key|execution_key|fill_key|request_key)/i.test(
      buyV2,
    ) ||
    /p_(?:idempotency|event_key|execution_key|fill_key|request_key)/i.test(
      buyV4,
    ),

  v2UsesObservedAtForDedup:
    /where[\s\S]{0,1200}?p_execution_observed_at[\s\S]{0,1200}?(?:unique|exists|not exists|already)/i.test(
      buyV2,
    ),

  v4UsesObservedAtForDedup:
    /where[\s\S]{0,1200}?p_execution_observed_at[\s\S]{0,1200}?(?:unique|exists|not exists|already)/i.test(
      buyV4,
    ),

  dedicatedBuyFillLedgerFound:
    /create\s+table[\s\S]{0,1500}?(?:paper_buy_execution_fills|paper_buy_fills|paper_order_execution_fills|paper_execution_fills)/i.test(
      allSql,
    ),

  uniqueExecutionEventGuardFound:
    /(?:idempotency|event_key|execution_key|fill_key|request_key)[\s\S]{0,800}?(?:unique|primary key)|(?:unique|primary key)[\s\S]{0,800}?(?:idempotency|event_key|execution_key|fill_key|request_key)/i.test(
      allSql,
    ),

  productionV4CallSiteFound:
    buyV4CallSites.length > 0,
};

const productionIdentityChecks = {
  callSiteCount:
    buyV4CallSites.length,

  callSites:
    buyV4CallSites,

  anyProductionIdempotencyTokenNearBuyExecution:
    productionRows.some(row =>
      /execute_paper_buy_order_with_execution_price_v4/i.test(row.text) &&
      /(idempotency|eventKey|executionKey|fillKey|requestKey)/i.test(row.text)
    ),

  anyProductionObservedAtPassed:
    productionRows.some(row =>
      /execute_paper_buy_order_with_execution_price_v4/i.test(row.text) &&
      /execution_observed_at|p_execution_observed_at/i.test(row.text)
    ),
};

const derived = {
  rowLockSerializesConcurrentCalls:
    buyChecks.v2OrderRowLocked,

  duplicatePartialFillCanRemainEligible:
    buyChecks.v2PartialFillSupported &&
    buyChecks.v2PartialFillLeavesRiskApproved,

  duplicatePartialFillWouldRepeatMutation:
    buyChecks.v2DebitsCashPerCall &&
    buyChecks.v2MutatesPositionPerCall &&
    buyChecks.v2IncrementsFilledQuantity,

  eventIdentityNotRepresented:
    !buyChecks.explicitIdempotencyParameter &&
    !buyChecks.dedicatedBuyFillLedgerFound &&
    !buyChecks.uniqueExecutionEventGuardFound,

  observedAtNotUsedAsDedupIdentity:
    buyChecks.v4HasObservedAt &&
    !buyChecks.v2UsesObservedAtForDedup &&
    !buyChecks.v4UsesObservedAtForDedup,

  replayRiskConfirmed:
    buyChecks.v2OrderRowLocked &&
    buyChecks.v2FullFillShortCircuitOnly &&
    buyChecks.v2PartialFillSupported &&
    buyChecks.v2PartialFillLeavesRiskApproved &&
    buyChecks.v2DebitsCashPerCall &&
    buyChecks.v2MutatesPositionPerCall &&
    buyChecks.v2IncrementsFilledQuantity &&
    !buyChecks.explicitIdempotencyParameter &&
    !buyChecks.uniqueExecutionEventGuardFound,
};

let classification: string;
let nextGate: string;
let interpretation: string;

if (derived.replayRiskConfirmed) {
  classification =
    "BUY_PARTIAL_FILL_REPLAY_IDEMPOTENCY_GAP_CONFIRMED";

  nextGate =
    "DESIGN_BUY_EXECUTION_EVENT_LEDGER_AND_V5_IDEMPOTENT_WRAPPER";

  interpretation =
    "The BUY path serializes mutations with row locks, but a non-final partial fill leaves the order RISK_APPROVED. Replaying the same incremental fill event can therefore debit cash and increase position/filled_quantity again. No explicit execution-event idempotency parameter or unique event guard was proven.";
} else if (
  derived.eventIdentityNotRepresented ||
  derived.observedAtNotUsedAsDedupIdentity
) {
  classification =
    "BUY_EXECUTION_EVENT_IDENTITY_REVIEW_REQUIRED";

  nextGate =
    "REVIEW_BUY_CALLER_AND_DB_EVENT_IDENTITY_BEFORE_REPAIR";

  interpretation =
    "A full duplicate-mutation chain was not proven, but the current BUY execution surface does not clearly represent a unique fill event.";
} else {
  classification =
    "BUY_PARTIAL_FILL_IDEMPOTENCY_STRUCTURALLY_SAFE_OR_NOT_PROVEN";

  nextGate =
    "CLOSE_OR_REVIEW_BASED_ON_EVIDENCE";

  interpretation =
    "This audit did not prove a BUY partial-fill replay gap.";
}

console.log(JSON.stringify({
  status:
    "AI_STOCK_LAB_BUY_PARTIAL_FILL_IDEMPOTENCY_DEEP_AUDIT_V1_COMPLETE",

  classification,

  sourceFiles: {
    buyV2:
      buyV2File?.name ?? null,
    buyV4:
      buyV4File?.name ?? null,
  },

  buyChecks,
  productionIdentityChecks,
  ledgerCandidates,
  eventIdentityCandidates,
  derived,

  interpretation,

  invariants: {
    replay:
      "The exact same BUY execution/fill event must be harmless when retried.",

    legitimateNextFill:
      "A genuinely new partial fill for the same order must still be allowed.",

    concurrency:
      "Row locking serializes state changes but does not by itself identify whether a second call is a retry or a new fill.",

    accounting:
      "Idempotency must protect cash debit, position quantity, cumulative filled quantity, fees, provenance and filled-price semantics together.",
  },

  evidence: {
    buyV2:
      context(
        buyV2,
        [
          /for\s+update/i,
          /status\s*=\s*'FILLED'/i,
          /p_fill_quantity/i,
          /RISK_APPROVED/i,
          /cash_balance\s*=/i,
          /filled_quantity\s*=/i,
          /paper_positions/i,
        ],
        8,
      ).slice(0, 34),

    buyV4:
      context(
        buyV4,
        [
          /p_execution_observed_at/i,
          /execute_paper_buy_order_with_execution_price_v3/i,
          /alreadyFilled/i,
        ],
        8,
      ).slice(0, 22),
  },

  safety: {
    sourceOnly: true,
    databaseReads: 0,
    databaseWrites: 0,
    externalApiCalls: 0,
    rpcInvoked: false,
    ordersCreated: 0,
    ordersExecuted: 0,
    positionsChanged: 0,
    realTradingEnabled: false,
  },

  nextGate,
}, null, 2));

process.exitCode = 0;
