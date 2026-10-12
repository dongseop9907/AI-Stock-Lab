import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const MIG_DIR = path.join(ROOT, "supabase", "migrations");

function sqlFiles() {
  if (!fs.existsSync(MIG_DIR)) return [];

  return fs.readdirSync(MIG_DIR)
    .filter(name => name.endsWith(".sql"))
    .sort()
    .map(name => ({
      name,
      text: fs.readFileSync(path.join(MIG_DIR, name), "utf8"),
    }));
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

function context(text: string, patterns: RegExp[], radius = 9) {
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

const files = sqlFiles();

const buyV2File =
  files.find(f =>
    /create\s+or\s+replace\s+function\s+public\.execute_paper_buy_order_with_execution_price_v2\s*\(/i.test(f.text)
  ) ?? null;

const buyV4File =
  files.find(f =>
    /create\s+or\s+replace\s+function\s+public\.execute_paper_buy_order_with_execution_price_v4\s*\(/i.test(f.text)
  ) ?? null;

const sellV2File =
  files.find(f =>
    /create\s+or\s+replace\s+function\s+public\.execute_paper_protective_sell_v2\s*\(/i.test(f.text)
  ) ?? null;

const sellV3File =
  files.find(f =>
    /create\s+or\s+replace\s+function\s+public\.execute_paper_protective_sell_v3\s*\(/i.test(f.text)
  ) ?? null;

const partialExitRepairFile =
  files.find(f =>
    /PAPER Partial Exit \+ Position Entry Fee Basis V1/i.test(f.text) ||
    /entry_broker_fee_basis_remaining/i.test(f.text)
  ) ?? null;

const buyV2 =
  buyV2File
    ? extractFunctionBody(
        buyV2File.text,
        "execute_paper_buy_order_with_execution_price_v2",
      )
    : "";

const buyV4 =
  buyV4File
    ? extractFunctionBody(
        buyV4File.text,
        "execute_paper_buy_order_with_execution_price_v4",
      )
    : "";

const sellV2 =
  sellV2File
    ? extractFunctionBody(
        sellV2File.text,
        "execute_paper_protective_sell_v2",
      )
    : "";

const sellV3 =
  sellV3File
    ? extractFunctionBody(
        sellV3File.text,
        "execute_paper_protective_sell_v3",
      )
    : "";

const allSql =
  files.map(f => f.text).join("\n\n");

const sourcePositionUniqueRemoved =
  Boolean(
    partialExitRepairFile &&
    /source_position_id/i.test(partialExitRepairFile.text) &&
    /drop constraint/i.test(partialExitRepairFile.text)
  );

const buyChecks = {
  canonicalV2Found:
    buyV2.length > 0,

  canonicalV4Found:
    buyV4.length > 0,

  orderRowLocked:
    /from\s+public\.paper_order_requests[\s\S]{0,600}?for\s+update/i.test(
      buyV2,
    ),

  alreadyFilledShortCircuit:
    /status\s*=\s*'FILLED'[\s\S]{0,1200}?alreadyFilled/i.test(
      buyV2,
    ) ||
    /alreadyFilled[\s\S]{0,1200}?status\s*=\s*'FILLED'/i.test(
      buyV2,
    ),

  supportsPartialFill:
    /p_fill_quantity/i.test(
      buyV2,
    ) &&
    /v_effective_fill_quantity/i.test(
      buyV2,
    ) &&
    /v_remaining_quantity/i.test(
      buyV2,
    ),

  cashDebitPresent:
    /update\s+public\.paper_accounts[\s\S]{0,500}?cash_balance\s*=\s*cash_balance\s*-\s*v_order_amount/i.test(
      buyV2,
    ),

  positionMutationPresent:
    /update\s+public\.paper_positions/i.test(
      buyV2,
    ) ||
    /insert\s+into\s+public\.paper_positions/i.test(
      buyV2,
    ),

  v4AlreadyFilledNoRewrite:
    /alreadyFilled/i.test(
      buyV4,
    ) &&
    /execute_paper_buy_order_with_execution_price_v3/i.test(
      buyV4,
    ),

  explicitExecutionIdempotencyParameter:
    /p_(?:idempotency|execution_event|fill_event|request_key|execution_key)/i.test(
      buyV2,
    ) ||
    /p_(?:idempotency|execution_event|fill_event|request_key|execution_key)/i.test(
      buyV4,
    ),

  perFillLedgerTableFound:
    /create\s+table[\s\S]{0,1000}?(?:paper_buy_execution_fills|paper_buy_fills|paper_order_execution_fills)/i.test(
      allSql,
    ),

  perFillUniqueEventGuardFound:
    /(?:paper_buy_execution_fills|paper_buy_fills|paper_order_execution_fills)[\s\S]{0,2500}?(?:unique|primary key)[\s\S]{0,800}?(?:event|request|execution|idempotency)/i.test(
      allSql,
    ),
};

const sellChecks = {
  canonicalV2Found:
    sellV2.length > 0,

  canonicalV3Found:
    sellV3.length > 0,

  positionRowLocked:
    /from\s+public\.paper_positions[\s\S]{0,600}?for\s+update/i.test(
      sellV2,
    ),

  supportsPartialExit:
    /p_fill_quantity\s+integer\s+default\s+null/i.test(
      sellV2,
    ) &&
    /v_remaining_position_quantity/i.test(
      sellV2,
    ),

  closedReplayFallbackUsesSourcePosition:
    /from\s+public\.paper_trade_history[\s\S]{0,500}?where\s+source_position_id\s*=\s*p_position_id/i.test(
      sellV2,
    ),

  closedReplayFallbackHasOrderBy:
    /from\s+public\.paper_trade_history[\s\S]{0,700}?where\s+source_position_id\s*=\s*p_position_id[\s\S]{0,700}?order\s+by/i.test(
      sellV2,
    ),

  closedReplayFallbackHasLimitOne:
    /from\s+public\.paper_trade_history[\s\S]{0,700}?where\s+source_position_id\s*=\s*p_position_id[\s\S]{0,700}?limit\s+1/i.test(
      sellV2,
    ),

  sourcePositionUniqueRemoved,

  explicitExecutionIdempotencyParameter:
    /p_(?:idempotency|execution_event|fill_event|request_key|execution_key)/i.test(
      sellV2,
    ) ||
    /p_(?:idempotency|execution_event|fill_event|request_key|execution_key)/i.test(
      sellV3,
    ),

  protectiveFillLedgerFound:
    /paper_protective_execution_fills_v2/i.test(
      allSql,
    ),

  protectiveLedgerUniqueEventGuardFound:
    /paper_protective_execution_fills_v2[\s\S]{0,2500}?(?:unique|primary key)[\s\S]{0,800}?(?:event|request|execution|idempotency|sell_order_id)/i.test(
      allSql,
    ),

  v3DelegatesV2:
    /execute_paper_protective_sell_v2/i.test(
      sellV3,
    ),
};

const derived = {
  buyPartialFillReplayRisk:
    buyChecks.canonicalV2Found &&
    buyChecks.supportsPartialFill &&
    buyChecks.cashDebitPresent &&
    buyChecks.positionMutationPresent &&
    !buyChecks.explicitExecutionIdempotencyParameter &&
    !buyChecks.perFillUniqueEventGuardFound,

  sellPartialExitReplayRisk:
    sellChecks.canonicalV2Found &&
    sellChecks.supportsPartialExit &&
    !sellChecks.explicitExecutionIdempotencyParameter &&
    !sellChecks.protectiveLedgerUniqueEventGuardFound,

  closedReplayLookupBecameMultiRowCapable:
    sellChecks.closedReplayFallbackUsesSourcePosition &&
    sellChecks.sourcePositionUniqueRemoved,

  closedReplayLookupNonDeterministic:
    sellChecks.closedReplayFallbackUsesSourcePosition &&
    sellChecks.sourcePositionUniqueRemoved &&
    !sellChecks.closedReplayFallbackHasOrderBy,

  wrapperSafetyPreserved:
    buyChecks.canonicalV4Found &&
    buyChecks.v4AlreadyFilledNoRewrite &&
    sellChecks.canonicalV3Found &&
    sellChecks.v3DelegatesV2,
};

let classification: string;
let nextGate: string;
let interpretation: string;

if (
  derived.buyPartialFillReplayRisk &&
  derived.sellPartialExitReplayRisk &&
  derived.closedReplayLookupNonDeterministic
) {
  classification =
    "PAPER_EXECUTION_IDEMPOTENCY_AND_CLOSED_REPLAY_GAPS_CONFIRMED";

  nextGate =
    "DESIGN_BUY_SELL_EXECUTION_EVENT_IDEMPOTENCY_AND_CLOSED_REPLAY_REPAIR";

  interpretation =
    "BUY partial fills and protective SELL partial exits are row-locked, but no explicit per-execution idempotency event key/unique guard was proven. After source_position_id uniqueness was removed, the protective SELL already-closed fallback can also see multiple trade rows and has no deterministic ORDER BY. Source wrappers remain intact, but retry/replay semantics need a dedicated repair before being considered concurrency-safe.";
}
else if (
  derived.closedReplayLookupNonDeterministic
) {
  classification =
    "PROTECTIVE_SELL_CLOSED_REPLAY_LOOKUP_GAP_CONFIRMED";

  nextGate =
    "DESIGN_DETERMINISTIC_PROTECTIVE_SELL_CLOSED_REPLAY_REPAIR";

  interpretation =
    "The partial-exit schema repair made source_position_id multi-row capable, while the already-closed protective SELL fallback still searches by source_position_id without a deterministic ordering.";
}
else if (
  derived.buyPartialFillReplayRisk ||
  derived.sellPartialExitReplayRisk
) {
  classification =
    "PAPER_PARTIAL_FILL_EXECUTION_REPLAY_GUARD_GAP_CONFIRMED";

  nextGate =
    "DESIGN_EXECUTION_EVENT_IDEMPOTENCY_GUARD";

  interpretation =
    "Row locking exists, but an explicit execution-event idempotency key/unique guard was not proven for one or more partial-fill paths.";
}
else {
  classification =
    "PAPER_EXECUTION_IDEMPOTENCY_STRUCTURALLY_SAFE_OR_REVIEW_REQUIRED";

  nextGate =
    "REVIEW_EVIDENCE_BEFORE_ANY_PRODUCTION_CHANGE";

  interpretation =
    "No decisive replay gap was proven by this source audit. Review exact evidence before changing production logic.";
}

console.log(JSON.stringify({
  status:
    "AI_STOCK_LAB_PAPER_EXECUTION_IDEMPOTENCY_REPLAY_CONCURRENCY_AUDIT_V1_COMPLETE",

  classification,

  sourceFiles: {
    buyV2:
      buyV2File?.name ?? null,
    buyV4:
      buyV4File?.name ?? null,
    sellV2:
      sellV2File?.name ?? null,
    sellV3:
      sellV3File?.name ?? null,
    partialExitRepair:
      partialExitRepairFile?.name ?? null,
  },

  buyChecks,
  sellChecks,
  derived,

  interpretation,

  invariants: {
    buyReplay:
      "The same external BUY execution/fill event must never debit cash or increase position quantity more than once.",

    sellReplay:
      "The same protective SELL execution/fill event must never credit cash, reduce position quantity, or realize PnL more than once.",

    closedReplay:
      "A replay against a fully closed position must return a deterministic final/related execution record, not an arbitrary prior partial-exit row.",

    concurrency:
      "Row locks protect state mutation ordering, but retry identity must be independently represented so a repeated event is distinguishable from a legitimate next partial fill.",
  },

  evidence: {
    buyV2:
      context(
        buyV2,
        [
          /for\s+update/i,
          /status\s*=\s*'FILLED'/i,
          /p_fill_quantity/i,
          /cash_balance/i,
          /paper_positions/i,
        ],
        9,
      ).slice(0, 28),

    buyV4:
      context(
        buyV4,
        [
          /alreadyFilled/i,
          /execute_paper_buy_order_with_execution_price_v3/i,
        ],
        9,
      ).slice(0, 18),

    sellV2:
      context(
        sellV2,
        [
          /for\s+update/i,
          /source_position_id\s*=\s*p_position_id/i,
          /p_fill_quantity/i,
          /v_remaining_position_quantity/i,
          /paper_trade_history/i,
        ],
        10,
      ).slice(0, 34),

    sellV3:
      context(
        sellV3,
        [
          /execute_paper_protective_sell_v2/i,
          /paper_protective_execution_fills_v2/i,
        ],
        9,
      ).slice(0, 24),

    partialExitRepair:
      partialExitRepairFile
        ? context(
            partialExitRepairFile.text,
            [
              /source_position_id/i,
              /drop constraint/i,
              /idx_paper_trade_history_source_position_v1/i,
            ],
            8,
          ).slice(0, 18)
        : [],
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
