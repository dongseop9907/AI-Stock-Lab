const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

function read(rel) {
  const full = path.join(ROOT, rel);
  return fs.existsSync(full)
    ? fs.readFileSync(full, "utf8")
    : "";
}

function exists(rel) {
  return fs.existsSync(
    path.join(ROOT, rel),
  );
}

function list(dirRel) {
  const dir = path.join(ROOT, dirRel);

  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs.readdirSync(dir);
}

const scriptNames = list("scripts");
const migrationNames =
  list("supabase/migrations");

const buyCandidates =
  scriptNames.filter((name) =>
    /paper-buy-execution-event-idempotency-v1-post-deploy-regression|buy-v5.*idempotency.*(regression|rollback|stress)/i.test(name)
  );

const sellCandidates =
  scriptNames.filter((name) =>
    /paper-protective-sell-v4-runtime-replay-regression|protective.*sell.*v4.*(regression|rollback|stress)/i.test(name)
  );

const fillLockCandidates =
  migrationNames.filter((name) =>
    /fill_lock_order_stress_harness/i.test(name)
  );

const buyCombined =
  buyCandidates
    .map((name) =>
      read(
        path.join(
          "scripts",
          name,
        ),
      )
    )
    .join("\n");

const sellCombined =
  sellCandidates
    .map((name) =>
      read(
        path.join(
          "scripts",
          name,
        ),
      )
    )
    .join("\n");

const fillLockCombined =
  fillLockCandidates
    .map((name) =>
      read(
        path.join(
          "supabase",
          "migrations",
          name,
        ),
      )
    )
    .join("\n");

function concurrencySignals(src) {
  return {
    promiseAll:
      /Promise\.all\s*\(/.test(src),

    parallelClients:
      /client1|client2|session1|session2|connection1|connection2|pool\.connect/i.test(src),

    pgSleep:
      /pg_sleep\s*\(/i.test(src),

    explicitBegin:
      /\bBEGIN\b|begin\s*;|query\s*\(\s*["']BEGIN["']\s*\)/i.test(src),

    explicitRollback:
      /\bROLLBACK\b|rollback\s*;|query\s*\(\s*["']ROLLBACK["']\s*\)/i.test(src),

    duplicateCalls:
      /idempotentReplay|duplicate|same.*event|exact.*same|replay/i.test(src),

    v5Call:
      /execute_paper_buy_order_with_execution_price_v5/.test(src),

    sellV4Call:
      /execute_paper_protective_sell_v4/.test(src),

    psqlBackground:
      /Start-Job|start-process|&\s*psql|psql[\s\S]{0,400}psql/i.test(src),

    advisoryOrRowLock:
      /for update|advisory|lock/i.test(src),
  };
}

const buySignals =
  concurrencySignals(
    buyCombined,
  );

const sellSignals =
  concurrencySignals(
    sellCombined,
  );

const fillLockSignals =
  concurrencySignals(
    fillLockCombined,
  );

const buyConcurrentHarness =
  buySignals.v5Call &&
  buySignals.duplicateCalls &&
  (
    buySignals.promiseAll ||
    buySignals.parallelClients ||
    buySignals.pgSleep ||
    buySignals.psqlBackground
  );

const sellConcurrentHarness =
  sellSignals.sellV4Call &&
  sellSignals.duplicateCalls &&
  (
    sellSignals.promiseAll ||
    sellSignals.parallelClients ||
    sellSignals.pgSleep ||
    sellSignals.psqlBackground
  );

const genericDbConcurrencyHarness =
  fillLockCandidates.length > 0 &&
  (
    fillLockSignals.pgSleep ||
    fillLockSignals.parallelClients ||
    fillLockSignals.psqlBackground ||
    fillLockSignals.advisoryOrRowLock
  );

const rollbackSafety = {
  buy:
    buySignals.explicitRollback ||
    /rollback/i.test(
      buyCombined,
    ),

  sell:
    sellSignals.explicitRollback ||
    /rollback/i.test(
      sellCombined,
    ),

  generic:
    fillLockSignals.explicitRollback ||
    /rollback/i.test(
      fillLockCombined,
    ),
};

const gaps = [];

if (!buyConcurrentHarness) {
  gaps.push(
    "BUY_V5_TRUE_CONCURRENT_EXACT_DUPLICATE_HARNESS_NOT_PROVEN",
  );
}

if (!sellConcurrentHarness) {
  gaps.push(
    "SELL_V4_TRUE_CONCURRENT_EXACT_DUPLICATE_HARNESS_NOT_PROVEN",
  );
}

if (!genericDbConcurrencyHarness) {
  gaps.push(
    "GENERIC_DB_CONCURRENCY_HARNESS_NOT_PROVEN",
  );
}

const classification =
  gaps.length === 0
    ? "DB_CONCURRENT_DUPLICATE_FILL_STRESS_HARNESS_READY"
    : "DB_CONCURRENT_DUPLICATE_FILL_STRESS_HARNESS_GAP_CONFIRMED";

console.log(
  JSON.stringify(
    {
      status:
        "AI_STOCK_LAB_PAPER_ORDER_DB_CONCURRENT_DUPLICATE_FILL_STRESS_READINESS_V1_COMPLETE",

      classification,

      discovered: {
        buyCandidates,
        sellCandidates,
        fillLockCandidates,
      },

      buySignals,
      sellSignals,
      fillLockSignals,

      derived: {
        buyConcurrentHarness,
        sellConcurrentHarness,
        genericDbConcurrencyHarness,
        rollbackSafety,
      },

      gaps,

      requiredStressSemantics: {
        buy:
          "Two independent DB sessions invoke the exact same V5 BUY event concurrently; only one mutates cash/order/position/fee state and one ledger event survives.",

        sell:
          "Two independent DB sessions invoke the exact same V4 protective SELL event concurrently; cash/position/PnL/history mutate exactly once.",

        rollback:
          "All synthetic fixtures and mutations are rolled back or cleaned so production PAPER state is unchanged.",
      },

      safety: {
        readOnly: true,
        sourceFilesModified: 0,
        databaseReads: 0,
        databaseWrites: 0,
        rpcInvoked: false,
        ordersCreated: 0,
        ordersExecuted: 0,
        positionsChanged: 0,
        realTradingEnabled: false,
      },

      nextGate:
        gaps.length === 0
          ? "RUN_EXISTING_DB_CONCURRENT_DUPLICATE_FILL_STRESS"
          : "BUILD_ISOLATED_ROLLBACK_CONCURRENT_DUPLICATE_FILL_STRESS_HARNESS",
    },
    null,
    2,
  ),
);

process.exitCode = 0;
