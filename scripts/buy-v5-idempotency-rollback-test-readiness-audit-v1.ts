import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const MIG_DIR = path.join(ROOT, "supabase", "migrations");

function read(abs: string) {
  return fs.existsSync(abs)
    ? fs.readFileSync(abs, "utf8")
    : "";
}

function rel(abs: string) {
  return path.relative(ROOT, abs).replaceAll("\\", "/");
}

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];

  const out: string[] = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      out.push(...walk(abs));
    } else if (
      entry.isFile() &&
      /\.(sql|ts|tsx|js|mjs|cjs)$/.test(entry.name)
    ) {
      out.push(abs);
    }
  }

  return out;
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

const files = walk(ROOT);

const sqlRows = files
  .filter(f => f.endsWith(".sql"))
  .map(abs => ({
    file: rel(abs),
    text: read(abs),
  }));

const migrationV5 =
  sqlRows.find(row =>
    /execute_paper_buy_order_with_execution_price_v5/i.test(row.text)
  ) ?? null;

const accountSchemaRows =
  sqlRows.filter(row =>
    /create\s+table[\s\S]{0,300}?paper_accounts/i.test(row.text) ||
    /alter\s+table\s+public\.paper_accounts/i.test(row.text)
  );

const orderSchemaRows =
  sqlRows.filter(row =>
    /create\s+table[\s\S]{0,300}?paper_order_requests/i.test(row.text) ||
    /alter\s+table\s+public\.paper_order_requests/i.test(row.text)
  );

const positionSchemaRows =
  sqlRows.filter(row =>
    /create\s+table[\s\S]{0,300}?paper_positions/i.test(row.text) ||
    /alter\s+table\s+public\.paper_positions/i.test(row.text)
  );

const rollbackHarnessRows =
  sqlRows.filter(row =>
    /\bbegin\s*;/i.test(row.text) &&
    /\brollback\s*;/i.test(row.text) &&
    /(test|harness|stress|regression|probe)/i.test(row.file)
  );

const fillLockHarnessRows =
  sqlRows.filter(row =>
    /fill_lock|fill lock|advisory_xact_lock|for\s+update/i.test(row.text) &&
    /(harness|stress|test)/i.test(row.file)
  );

const rpcV5 =
  migrationV5?.text ?? "";

const checks = {
  v5MigrationFound:
    Boolean(migrationV5),

  v5OrderLockPresent:
    /from\s+public\.paper_order_requests\s+o[\s\S]{0,500}?for\s+update/i.test(
      rpcV5,
    ),

  v5ReplayLedgerPresent:
    /paper_buy_execution_events_v1/i.test(
      rpcV5,
    ),

  v5UniqueGuardPresent:
    /unique\s*\(\s*order_id\s*,\s*event_fingerprint\s*\)/i.test(
      rpcV5,
    ),

  v5StoredReplayResultPresent:
    /execution_result[\s\S]{0,1000}?idempotentReplay/i.test(
      rpcV5,
    ),

  rollbackHarnessPatternFound:
    rollbackHarnessRows.length > 0,

  fillLockHarnessPatternFound:
    fillLockHarnessRows.length > 0,

  paperAccountSchemaFound:
    accountSchemaRows.length > 0,

  paperOrderSchemaFound:
    orderSchemaRows.length > 0,

  paperPositionSchemaFound:
    positionSchemaRows.length > 0,
};

const requiredRegressionAssertions = {
  firstCallIsNewEvent:
    "First V5 invocation must return idempotentReplay=false.",

  secondCallIsReplay:
    "Second invocation with the exact same seven arguments must return idempotentReplay=true.",

  oneLedgerRow:
    "Exactly one paper_buy_execution_events_v1 row must exist for the test order inside the transaction.",

  cashDebitedOnce:
    "Paper account cash after second call must equal cash after first call.",

  positionChangedOnce:
    "Position quantity/average price after second call must equal state after first call.",

  orderFilledQuantityChangedOnce:
    "filled_quantity and execution_fill_count after second call must equal values after first call.",

  feeChangedOnce:
    "execution_broker_fee after second call must equal value after first call.",

  rollback:
    "All fixture rows and mutations must be rolled back before the test connection ends.",
};

const failed =
  Object.entries(checks)
    .filter(([, ok]) => ok !== true)
    .map(([name]) => name);

let classification: string;
let nextGate: string;

if (
  checks.v5MigrationFound &&
  checks.v5ReplayLedgerPresent &&
  checks.v5UniqueGuardPresent &&
  checks.paperAccountSchemaFound &&
  checks.paperOrderSchemaFound &&
  checks.paperPositionSchemaFound
) {
  classification =
    checks.rollbackHarnessPatternFound
      ? "BUY_V5_ROLLBACK_REGRESSION_HARNESS_READY"
      : "BUY_V5_ROLLBACK_REGRESSION_FIXTURE_SCHEMA_READY_NO_EXISTING_ROLLBACK_PATTERN";

  nextGate =
    "BUILD_TRANSACTION_ROLLBACK_BUY_V5_IDEMPOTENCY_REGRESSION_V1";
} else {
  classification =
    "BUY_V5_ROLLBACK_REGRESSION_READINESS_REVIEW_REQUIRED";

  nextGate =
    "REVIEW_MISSING_SCHEMA_OR_V5_EVIDENCE_BEFORE_TEST_HARNESS";
}

console.log(JSON.stringify({
  status:
    "AI_STOCK_LAB_BUY_V5_IDEMPOTENCY_ROLLBACK_TEST_READINESS_AUDIT_V1_COMPLETE",

  classification,

  checks,
  failed,

  source: {
    v5Migration:
      migrationV5?.file ?? null,

    rollbackHarnessFiles:
      rollbackHarnessRows.map(row => row.file),

    fillLockHarnessFiles:
      fillLockHarnessRows.map(row => row.file),

    paperAccountSchemaFiles:
      accountSchemaRows.map(row => row.file).slice(0, 12),

    paperOrderSchemaFiles:
      orderSchemaRows.map(row => row.file).slice(0, 20),

    paperPositionSchemaFiles:
      positionSchemaRows.map(row => row.file).slice(0, 20),
  },

  requiredRegressionAssertions,

  evidence: {
    v5:
      context(
        rpcV5,
        [
          /for\s+update/i,
          /paper_buy_execution_events_v1/i,
          /idempotentReplay/i,
          /execute_paper_buy_order_with_execution_price_v4/i,
        ],
        8,
      ).slice(0, 24),

    rollbackHarnesses:
      rollbackHarnessRows.slice(0, 5).map(row => ({
        file: row.file,
        evidence:
          context(
            row.text,
            [
              /\bbegin\s*;/i,
              /\brollback\s*;/i,
              /insert\s+into\s+public\.paper_accounts/i,
              /insert\s+into\s+public\.paper_order_requests/i,
            ],
            6,
          ).slice(0, 18),
      })),
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
