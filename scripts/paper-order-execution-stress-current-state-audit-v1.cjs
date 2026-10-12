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
    path.join(
      ROOT,
      "supabase",
      "migrations",
    );

  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs
    .readdirSync(dir)
    .filter((name) =>
      name.endsWith(".sql")
    )
    .sort();
}

function latestMigrationContaining(
  files,
  needle,
) {
  const hits =
    files
      .filter((name) =>
        read(
          path.join(
            "supabase",
            "migrations",
            name,
          ),
        ).includes(needle)
      );

  return hits.length > 0
    ? hits[hits.length - 1]
    : null;
}

function functionBody(
  source,
  functionNeedle,
) {
  const start =
    source.indexOf(
      functionNeedle,
    );

  if (start < 0) {
    return "";
  }

  const asIndex =
    source.indexOf(
      "as $$",
      start,
    );

  if (asIndex < 0) {
    return source.slice(start);
  }

  const end =
    source.indexOf(
      "$$;",
      asIndex + 5,
    );

  if (end < 0) {
    return source.slice(start);
  }

  return source.slice(
    start,
    end + 3,
  );
}

const migrations =
  listSqlMigrations();

const buyV5Rel =
  "supabase/migrations/20261011000400_paper_buy_execution_event_idempotency_v1.sql";

const buyV5 =
  read(buyV5Rel);

const executorRel =
  "lib/trading/execute-paper-order.ts";

const executor =
  read(executorRel);

const sellV2Needle =
  "create or replace function public.execute_paper_protective_sell_v2";

const sellV3Needle =
  "create or replace function public.execute_paper_protective_sell_v3";

const latestSellV2File =
  latestMigrationContaining(
    migrations,
    sellV2Needle,
  );

const latestSellV3File =
  latestMigrationContaining(
    migrations,
    sellV3Needle,
  );

const latestSellV2Source =
  latestSellV2File
    ? read(
        path.join(
          "supabase",
          "migrations",
          latestSellV2File,
        ),
      )
    : "";

const latestSellV3Source =
  latestSellV3File
    ? read(
        path.join(
          "supabase",
          "migrations",
          latestSellV3File,
        ),
      )
    : "";

const sellV2Body =
  functionBody(
    latestSellV2Source,
    sellV2Needle,
  );

const sellV3Body =
  functionBody(
    latestSellV3Source,
    sellV3Needle,
  );

const fillLockHarness =
  migrations.find((name) =>
    name.includes(
      "fill_lock_order_stress_harness",
    )
  ) ?? null;

const rollbackHarnessCandidates =
  [
    ...migrations
      .filter((name) =>
        /buy.*v5.*rollback|v5.*idempotency.*test|buy.*execution.*idempotency.*test/i.test(name)
      ),

    ...(
      fs.existsSync(
        path.join(
          ROOT,
          "scripts",
        ),
      )
        ? fs.readdirSync(
            path.join(
              ROOT,
              "scripts",
            ),
          )
          .filter((name) =>
            /buy.*v5.*rollback|v5.*idempotency.*rollback|buy.*execution.*idempotency.*regression/i.test(name)
          )
        : []
    ),
  ];

const buyChecks = {
  v5MigrationExists:
    buyV5.length > 0,

  ledgerTable:
    /paper_buy_execution_events_v1/.test(
      buyV5,
    ),

  uniqueOrderEventGuard:
    /paper_buy_execution_events_v1_order_event_unique/.test(
      buyV5,
    ) &&
    /unique/i.test(
      buyV5,
    ),

  v5Function:
    /execute_paper_buy_order_with_execution_price_v5/.test(
      buyV5,
    ),

  orderRowLock:
    /for update/i.test(
      buyV5,
    ),

  storedReplayResult:
    /execution_result/.test(
      buyV5,
    ) &&
    /idempotentReplay/.test(
      buyV5,
    ),

  delegatesV4:
    /execute_paper_buy_order_with_execution_price_v4\s*\(/.test(
      buyV5,
    ),

  productionExecutorExists:
    executor.length > 0,

  productionUsesV5:
    /rpc\s*\(\s*["']execute_paper_buy_order_with_execution_price_v5["']/.test(
      executor,
    ),

  productionUsesV4:
    /rpc\s*\(\s*["']execute_paper_buy_order_with_execution_price_v4["']/.test(
      executor,
    ),

  productionUsesOlderBuyRpc:
    /rpc\s*\(\s*["']execute_paper_buy_order_with_execution_price_v[123]["']/.test(
      executor,
    ),

  observedAtBound:
    /p_execution_observed_at/.test(
      executor,
    ),

  rollbackRegressionHarness:
    rollbackHarnessCandidates.length > 0,

  fillLockHarness:
    fillLockHarness !== null,
};

const sellChecks = {
  latestV2Definition:
    latestSellV2File,

  latestV3Definition:
    latestSellV3File,

  latestV2Found:
    sellV2Body.length > 0,

  latestV3Found:
    sellV3Body.length > 0,

  positionRowLock:
    /for update/i.test(
      sellV2Body,
    ),

  protectiveLedger:
    /paper_protective_execution_fills_v2/.test(
      latestSellV2Source +
      latestSellV3Source,
    ),

  uniqueEventGuard:
    /unique/i.test(
      latestSellV2Source +
      latestSellV3Source,
    ) &&
    /paper_protective_execution_fills_v2/.test(
      latestSellV2Source +
      latestSellV3Source,
    ),

  closedReplayUsesSourcePosition:
    /source_position_id/.test(
      sellV2Body,
    ),

  closedReplayHasOrderBy:
    /source_position_id[\s\S]{0,1200}order\s+by/i.test(
      sellV2Body,
    ),

  closedReplayHasLimitOne:
    /source_position_id[\s\S]{0,1400}limit\s+1/i.test(
      sellV2Body,
    ),

  v3DelegatesV2:
    /execute_paper_protective_sell_v2\s*\(/.test(
      sellV3Body,
    ),
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
    buyChecks.productionUsesV5,

  buyRollbackRegressionMissing:
    !buyChecks.rollbackRegressionHarness,

  sellReplayDeterministic:
    sellChecks.closedReplayHasOrderBy &&
    sellChecks.closedReplayHasLimitOne,

  sellProtectiveReplayGuarded:
    sellChecks.protectiveLedger &&
    sellChecks.uniqueEventGuard,

  existingConcurrencyHarness:
    buyChecks.fillLockHarness,
};

const gaps = [];

if (!derived.buyV5FoundationReady) {
  gaps.push(
    "BUY_V5_IDEMPOTENCY_FOUNDATION_INCOMPLETE",
  );
}

if (
  derived.buyV5FoundationReady &&
  !derived.buyV5ProductionBound
) {
  gaps.push(
    "BUY_V5_IDEMPOTENCY_NOT_BOUND_TO_PRODUCTION_EXECUTOR",
  );
}

if (
  derived.buyV5FoundationReady &&
  derived.buyRollbackRegressionMissing
) {
  gaps.push(
    "BUY_V5_EXACT_REPLAY_ROLLBACK_REGRESSION_HARNESS_MISSING",
  );
}

if (!derived.sellProtectiveReplayGuarded) {
  gaps.push(
    "PROTECTIVE_SELL_EVENT_REPLAY_GUARD_NOT_PROVEN",
  );
}

if (!derived.sellReplayDeterministic) {
  gaps.push(
    "PROTECTIVE_SELL_CLOSED_REPLAY_LOOKUP_NOT_DETERMINISTIC",
  );
}

let classification =
  "PAPER_ORDER_EXECUTION_STRESS_BASELINE_READY";

if (
  gaps.includes(
    "BUY_V5_IDEMPOTENCY_NOT_BOUND_TO_PRODUCTION_EXECUTOR",
  )
) {
  classification =
    "BUY_V5_PRODUCTION_BINDING_GAP_CONFIRMED";
} else if (
  gaps.includes(
    "PROTECTIVE_SELL_CLOSED_REPLAY_LOOKUP_NOT_DETERMINISTIC",
  )
) {
  classification =
    "PROTECTIVE_SELL_CLOSED_REPLAY_DETERMINISM_GAP_CONFIRMED";
} else if (
  gaps.includes(
    "BUY_V5_EXACT_REPLAY_ROLLBACK_REGRESSION_HARNESS_MISSING",
  )
) {
  classification =
    "BUY_V5_DB_ROLLBACK_REGRESSION_GAP_CONFIRMED";
} else if (
  gaps.length > 0
) {
  classification =
    "PAPER_ORDER_EXECUTION_STRESS_GAPS_REMAIN";
}

console.log(JSON.stringify({
  status:
    "AI_STOCK_LAB_PAPER_ORDER_EXECUTION_STRESS_CURRENT_STATE_AUDIT_V1_COMPLETE",

  classification,

  buyChecks,
  sellChecks,
  derived,
  gaps,

  sourceFiles: {
    buyV5:
      fs.existsSync(
        path.join(
          ROOT,
          buyV5Rel,
        ),
      )
        ? buyV5Rel
        : null,

    productionExecutor:
      fs.existsSync(
        path.join(
          ROOT,
          executorRel,
        ),
      )
        ? executorRel
        : null,

    latestProtectiveSellV2:
      latestSellV2File
        ? "supabase/migrations/" + latestSellV2File
        : null,

    latestProtectiveSellV3:
      latestSellV3File
        ? "supabase/migrations/" + latestSellV3File
        : null,

    fillLockHarness:
      fillLockHarness
        ? "supabase/migrations/" + fillLockHarness
        : null,

    rollbackHarnessCandidates,
  },

  requiredNextInvariants: {
    exactBuyReplay:
      "Same BUY execution event mutates cash/order/position/fees exactly once.",

    legitimateNextBuyFill:
      "A genuinely new partial-fill event for the same order remains allowed.",

    concurrentBuyReplay:
      "Concurrent exact duplicates serialize and only one event mutates state.",

    sellReplay:
      "Same protective SELL event never credits cash/reduces position/realizes PnL twice.",

    closedSellReplay:
      "Replay after full close returns one deterministic related/final execution row.",
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
      ? "BUILD_TRANSACTION_ROLLBACK_AND_CONCURRENT_REPLAY_STRESS_HARNESS"
      : "REPAIR_HIGHEST_PRIORITY_CONFIRMED_GAP_FIRST",
}, null, 2));

process.exitCode = 0;
