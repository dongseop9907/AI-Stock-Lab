import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function read(rel: string) {
  const abs =
    path.join(ROOT, rel);

  return fs.existsSync(abs)
    ? fs.readFileSync(abs, "utf8")
    : "";
}

const migration =
  read(
    "supabase/migrations/20261011000400_paper_buy_execution_event_idempotency_v1.sql",
  );

const caller =
  read(
    "lib/trading/execute-paper-order.ts",
  );

const checks = {
  migrationExists:
    migration.length > 0,

  ledgerCreated:
    /create\s+table\s+if\s+not\s+exists\s+public\.paper_buy_execution_events_v1/i.test(
      migration,
    ),

  uniqueOrderEventGuard:
    /unique\s*\(\s*order_id\s*,\s*event_fingerprint\s*\)/i.test(
      migration,
    ),

  v5Defined:
    /create\s+or\s+replace\s+function\s+public\.execute_paper_buy_order_with_execution_price_v5\s*\(/i.test(
      migration,
    ),

  v5SameSevenArgumentSurface:
    /p_order_id\s+uuid[\s\S]{0,700}?p_execution_price\s+numeric[\s\S]{0,700}?p_execution_observed_at\s+timestamptz[\s\S]{0,700}?p_execution_price_source\s+text[\s\S]{0,700}?p_execution_provenance\s+jsonb[\s\S]{0,700}?p_fill_quantity\s+integer\s+default\s+null[\s\S]{0,700}?p_broker_fee\s+numeric\s+default\s+0/i.test(
      migration,
    ),

  eventFingerprintIncludesOrder:
    /p_order_id::text/i.test(
      migration,
    ),

  eventFingerprintIncludesObservedAt:
    /extract\s*\(\s*epoch\s+from\s+p_execution_observed_at\s*\)/i.test(
      migration,
    ),

  eventFingerprintIncludesPrice:
    /trim_scale\s*\(\s*p_execution_price\s*\)/i.test(
      migration,
    ),

  eventFingerprintIncludesSource:
    /trim\s*\(\s*p_execution_price_source\s*\)/i.test(
      migration,
    ),

  eventFingerprintIncludesFillQuantity:
    /p_fill_quantity::text/i.test(
      migration,
    ),

  eventFingerprintIncludesProvenance:
    /md5\s*\(\s*p_execution_provenance::text\s*\)/i.test(
      migration,
    ),

  orderLockedBeforeLedgerCheck:
    /from\s+public\.paper_order_requests\s+o[\s\S]{0,500}?where\s+o\.id\s*=\s*p_order_id[\s\S]{0,250}?for\s+update[\s\S]{0,1400}?from\s+public\.paper_buy_execution_events_v1/i.test(
      migration,
    ),

  existingEventReturnsWithoutV4:
    /if\s+found\s+then[\s\S]{0,900}?idempotentReplay[\s\S]{0,500}?return/i.test(
      migration,
    ) ||
    /if\s+found\s+then[\s\S]{0,1200}?return[\s\S]{0,400}?idempotentReplay/i.test(
      migration,
    ),

  newEventDelegatesV4:
    /execute_paper_buy_order_with_execution_price_v4/i.test(
      migration,
    ),

  resultPersistedAfterV4:
    /execute_paper_buy_order_with_execution_price_v4[\s\S]{0,2500}?insert\s+into\s+public\.paper_buy_execution_events_v1/i.test(
      migration,
    ),

  serviceRoleOnly:
    /revoke\s+all[\s\S]{0,500}?execute_paper_buy_order_with_execution_price_v5/i.test(
      migration,
    ) &&
    /grant\s+execute[\s\S]{0,500}?to\s+service_role/i.test(
      migration,
    ),

  callerUsesV5:
    /execute_paper_buy_order_with_execution_price_v5/i.test(
      caller,
    ),

  callerNoLongerUsesV4:
    !/execute_paper_buy_order_with_execution_price_v4/i.test(
      caller,
    ),

  noRealTradingEnablement:
    !/REAL_TRADING_ENABLED\s*=\s*true/i.test(
      migration,
    ) &&
    !/ENABLE_REAL_TRADING\s*=\s*true/i.test(
      migration,
    ) &&
    !/ENABLE_LIVE_TRADING\s*=\s*true/i.test(
      migration,
    ),
};

const failed =
  Object.entries(checks)
    .filter(([, ok]) => ok !== true)
    .map(([name]) => name);

console.log(JSON.stringify({
  status:
    failed.length === 0
      ? "AI_STOCK_LAB_PAPER_BUY_EXECUTION_EVENT_IDEMPOTENCY_V1_STRUCTURAL_PROOF_PASS"
      : "AI_STOCK_LAB_PAPER_BUY_EXECUTION_EVENT_IDEMPOTENCY_V1_STRUCTURAL_PROOF_FAIL",

  classification:
    failed.length === 0
      ? "BUY_EXECUTION_EVENT_LEDGER_AND_V5_IDEMPOTENCY_STRUCTURALLY_READY"
      : "BUY_EXECUTION_EVENT_IDEMPOTENCY_REPAIR_REVIEW_REQUIRED",

  checks,
  failed,

  invariants: {
    sameEventReplay:
      "Same order + same canonical execution tuple/provenance returns stored result and cannot reach V4 twice.",

    newPartialFill:
      "A new execution tuple/provenance produces a new fingerprint and is allowed to delegate to V4.",

    transactionality:
      "V4 mutation and event-ledger persistence occur in one PostgreSQL transaction.",

    compatibility:
      "V5 keeps the same seven-argument RPC surface as V4, so production caller argument semantics are unchanged.",
  },

  safety: {
    sourceOnly: true,
    databaseReads: 0,
    databaseWrites: 0,
    rpcInvoked: false,
    ordersCreated: 0,
    ordersExecuted: 0,
    positionsChanged: 0,
    realTradingEnabled: false,
  },

  nextGate:
    failed.length === 0
      ? "APPLY_BUY_EXECUTION_EVENT_IDEMPOTENCY_V1_MIGRATION"
      : "REVIEW_FAILED_STRUCTURAL_CHECKS",
}, null, 2));

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
