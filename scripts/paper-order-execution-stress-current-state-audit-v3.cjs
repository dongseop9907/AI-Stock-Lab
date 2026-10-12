const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

function read(rel) {
  const full = path.join(ROOT, rel);
  return fs.existsSync(full)
    ? fs.readFileSync(full, "utf8")
    : "";
}

function listSqlMigrations() {
  const dir =
    path.join(ROOT, "supabase", "migrations");

  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

function filesContaining(files, needle) {
  return files.filter((name) =>
    read(
      path.join(
        "supabase",
        "migrations",
        name,
      ),
    ).includes(needle)
  );
}

function latestContaining(files, needle) {
  const hits = filesContaining(files, needle);
  return hits.length > 0
    ? hits[hits.length - 1]
    : null;
}

function fnBody(source, needle) {
  const start = source.indexOf(needle);
  if (start < 0) return "";

  const asIndex = source.indexOf("as $$", start);
  if (asIndex < 0) return source.slice(start);

  const end = source.indexOf("$$;", asIndex + 5);
  if (end < 0) return source.slice(start);

  return source.slice(start, end + 3);
}

const migrations = listSqlMigrations();

const buyV5Rel =
  "supabase/migrations/20261011000400_paper_buy_execution_event_idempotency_v1.sql";
const buyV5 = read(buyV5Rel);

const executorRel =
  "lib/trading/execute-paper-order.ts";
const executor = read(executorRel);

const stopLossRel =
  "lib/trading/check-stop-losses.ts";
const stopLoss = read(stopLossRel);

const trailingRel =
  "lib/trading/update-trailing-stops.ts";
const trailing = read(trailingRel);

const sellV2Needle =
  "create or replace function public.execute_paper_protective_sell_v2";
const sellV3Needle =
  "create or replace function public.execute_paper_protective_sell_v3";
const sellV4Needle =
  "create or replace function public.execute_paper_protective_sell_v4";

const latestV2File =
  latestContaining(migrations, sellV2Needle);
const latestV3File =
  latestContaining(migrations, sellV3Needle);
const latestV4File =
  latestContaining(migrations, sellV4Needle);

const latestV2Source =
  latestV2File
    ? read(
        path.join(
          "supabase",
          "migrations",
          latestV2File,
        ),
      )
    : "";

const latestV3Source =
  latestV3File
    ? read(
        path.join(
          "supabase",
          "migrations",
          latestV3File,
        ),
      )
    : "";

const latestV4Source =
  latestV4File
    ? read(
        path.join(
          "supabase",
          "migrations",
          latestV4File,
        ),
      )
    : "";

const v2Body =
  fnBody(latestV2Source, sellV2Needle);
const v3Body =
  fnBody(latestV3Source, sellV3Needle);
const v4Body =
  fnBody(latestV4Source, sellV4Needle);

const allSellSource =
  migrations
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

const fillTableDefinitions =
  filesContaining(
    migrations,
    "paper_protective_execution_fills_v2",
  );

const fillLockHarness =
  migrations.find((name) =>
    name.includes(
      "fill_lock_order_stress_harness",
    )
  ) ?? null;

const rollbackHarnessCandidates = [
  ...migrations.filter((name) =>
    /buy.*v5.*rollback|v5.*idempotency.*test|buy.*execution.*idempotency.*test/i.test(name)
  ),
  ...(
    fs.existsSync(path.join(ROOT, "scripts"))
      ? fs
          .readdirSync(path.join(ROOT, "scripts"))
          .filter((name) =>
            /buy.*v5.*rollback|v5.*idempotency.*rollback|buy.*execution.*idempotency.*regression/i.test(name)
          )
      : []
  ),
];

const sellV4RuntimeRegressionCandidates =
  fs.existsSync(path.join(ROOT, "scripts"))
    ? fs
        .readdirSync(path.join(ROOT, "scripts"))
        .filter((name) =>
          /protective.*sell.*v4.*(regression|rollback|runtime|verify)|closed.*replay.*(regression|rollback|runtime|verify)/i.test(name)
        )
    : [];

const buyChecks = {
  v5MigrationExists:
    buyV5.length > 0,

  ledgerTable:
    /paper_buy_execution_events_v1/.test(buyV5),

  uniqueOrderEventGuard:
    /paper_buy_execution_events_v1_order_event_unique/.test(buyV5) &&
    /unique/i.test(buyV5),

  v5Function:
    /execute_paper_buy_order_with_execution_price_v5/.test(buyV5),

  orderRowLock:
    /for update/i.test(buyV5),

  storedReplayResult:
    /execution_result/.test(buyV5) &&
    /idempotentReplay/.test(buyV5),

  delegatesV4:
    /execute_paper_buy_order_with_execution_price_v4\s*\(/.test(buyV5),

  productionUsesV5:
    /rpc\s*\(\s*["']execute_paper_buy_order_with_execution_price_v5["']/.test(executor),

  productionUsesOlderBuyRpc:
    /rpc\s*\(\s*["']execute_paper_buy_order_with_execution_price_v[1-4]["']/.test(executor),

  observedAtBound:
    /p_execution_observed_at/.test(executor),

  rollbackRegressionHarness:
    rollbackHarnessCandidates.length > 0,

  fillLockHarness:
    fillLockHarness !== null,
};

const sellChecks = {
  latestV2Definition:
    latestV2File,

  latestV3Definition:
    latestV3File,

  latestV4Definition:
    latestV4File,

  v2Found:
    v2Body.length > 0,

  v3Found:
    v3Body.length > 0,

  v4Found:
    v4Body.length > 0,

  v2PositionRowLock:
    /for update/i.test(v2Body),

  v3DelegatesV2:
    /execute_paper_protective_sell_v2\s*\(/.test(v3Body),

  v4DelegatesV3:
    /execute_paper_protective_sell_v3\s*\(/.test(v4Body),

  v4ClosedReplayUsesTradeHistory:
    /paper_trade_history/.test(v4Body),

  v4ClosedReplayOrdersByClosedAtDesc:
    /order\s+by[\s\S]{0,300}closed_at\s+desc/i.test(v4Body),

  v4ClosedReplayOrdersByIdDesc:
    /order\s+by[\s\S]{0,500}id\s+desc/i.test(v4Body),

  v4ClosedReplayLimitOne:
    /limit\s+1/i.test(v4Body),

  protectiveLedger:
    /paper_protective_execution_fills_v2/.test(allSellSource),

  uniqueEventGuardNamed:
    /paper_protective_execution_fills_v2[\s\S]{0,5000}(unique|constraint)/i.test(allSellSource),

  uniqueEventFingerprintSignals:
    /position_id/.test(allSellSource) &&
    /execution_price/.test(allSellSource) &&
    /observed_at/.test(allSellSource) &&
    /execution_source/.test(allSellSource),

  stopLossUsesV4:
    /execute_paper_protective_sell_v4/.test(stopLoss),

  trailingUsesV4:
    /execute_paper_protective_sell_v4/.test(trailing),

  runtimeRegressionCandidate:
    sellV4RuntimeRegressionCandidates.length > 0,
};

const derived = {
  buyV5FoundationReady:
    buyChecks.v5MigrationExists &&
    buyChecks.ledgerTable &&
    buyChecks.uniqueOrderEventGuard &&
    buyChecks.v5Function &&
    buyChecks.orderRowLock &&
    buyChecks.storedReplayResult &&
    buyChecks.delegatesV4,

  buyV5ProductionBound:
    buyChecks.productionUsesV5 &&
    !buyChecks.productionUsesOlderBuyRpc,

  buyRollbackRegressionPresent:
    buyChecks.rollbackRegressionHarness,

  sellV4DeterministicClosedReplay:
    sellChecks.v4Found &&
    sellChecks.v4ClosedReplayUsesTradeHistory &&
    sellChecks.v4ClosedReplayOrdersByClosedAtDesc &&
    sellChecks.v4ClosedReplayOrdersByIdDesc &&
    sellChecks.v4ClosedReplayLimitOne,

  sellV4ProductionBound:
    sellChecks.stopLossUsesV4 &&
    sellChecks.trailingUsesV4,

  sellReplayLedgerPresent:
    sellChecks.protectiveLedger,

  sellReplayIdentitySignalsPresent:
    sellChecks.uniqueEventFingerprintSignals,

  sellRuntimeRegressionPresent:
    sellChecks.runtimeRegressionCandidate,
};

const gaps = [];

if (!derived.buyV5FoundationReady) {
  gaps.push(
    "BUY_V5_IDEMPOTENCY_FOUNDATION_INCOMPLETE",
  );
}

if (!derived.buyV5ProductionBound) {
  gaps.push(
    "BUY_V5_PRODUCTION_BINDING_INCOMPLETE",
  );
}

if (!derived.buyRollbackRegressionPresent) {
  gaps.push(
    "BUY_V5_ROLLBACK_REGRESSION_NOT_FOUND",
  );
}

if (!derived.sellV4DeterministicClosedReplay) {
  gaps.push(
    "SELL_V4_DETERMINISTIC_CLOSED_REPLAY_NOT_PROVEN",
  );
}

if (!derived.sellV4ProductionBound) {
  gaps.push(
    "SELL_V4_NOT_BOUND_TO_ALL_PROTECTIVE_CALLERS",
  );
}

if (!derived.sellReplayLedgerPresent) {
  gaps.push(
    "PROTECTIVE_SELL_REPLAY_LEDGER_NOT_FOUND",
  );
}

if (!derived.sellReplayIdentitySignalsPresent) {
  gaps.push(
    "PROTECTIVE_SELL_REPLAY_IDENTITY_NOT_PROVEN",
  );
}

let classification =
  "PAPER_ORDER_EXECUTION_STRESS_BASELINE_COMPLETE";

if (gaps.length > 0) {
  classification =
    "PAPER_ORDER_EXECUTION_STRESS_GAPS_REMAIN";
}

console.log(
  JSON.stringify(
    {
      status:
        "AI_STOCK_LAB_PAPER_ORDER_EXECUTION_STRESS_CURRENT_STATE_AUDIT_V3_COMPLETE",

      classification,

      buyChecks,
      sellChecks,
      derived,
      gaps,

      sourceFiles: {
        buyV5:
          fs.existsSync(
            path.join(ROOT, buyV5Rel),
          )
            ? buyV5Rel
            : null,

        productionExecutor:
          fs.existsSync(
            path.join(ROOT, executorRel),
          )
            ? executorRel
            : null,

        latestProtectiveSellV2:
          latestV2File
            ? "supabase/migrations/" + latestV2File
            : null,

        latestProtectiveSellV3:
          latestV3File
            ? "supabase/migrations/" + latestV3File
            : null,

        latestProtectiveSellV4:
          latestV4File
            ? "supabase/migrations/" + latestV4File
            : null,

        fillTableDefinitionFiles:
          fillTableDefinitions.map(
            (name) =>
              "supabase/migrations/" + name,
          ),

        buyRollbackHarnessCandidates:
          rollbackHarnessCandidates,

        sellV4RuntimeRegressionCandidates,
      },

      interpretation: {
        previousV2AuditLimitation:
          "V2/V3-only closed replay checks are not authoritative once V4 exists.",

        authoritativeSellClosedReplay:
          sellChecks.v4Found
            ? "V4"
            : "NOT_FOUND",
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
          ? "RUN_DB_LEVEL_CONCURRENT_DUPLICATE_FILL_STRESS_OR_ADVANCE_TO_RISK_STRESS"
          : "REPAIR_ONLY_CONFIRMED_CURRENT_GAPS",
    },
    null,
    2,
  ),
);

process.exitCode = 0;
