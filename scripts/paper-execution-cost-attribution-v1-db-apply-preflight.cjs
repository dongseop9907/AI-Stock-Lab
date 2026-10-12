const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const TARGET_VERSION =
  "20261010000100";

const TARGET_NAME =
  "20261010000100_paper_execution_cost_attribution_v1.sql";

const MIGRATIONS_DIR =
  path.join(
    ROOT,
    "supabase",
    "migrations"
  );

const TARGET =
  path.join(
    MIGRATIONS_DIR,
    TARGET_NAME
  );

const files =
  fs.existsSync(
    MIGRATIONS_DIR
  )
    ? fs.readdirSync(
        MIGRATIONS_DIR
      )
    : [];

const versionMatches =
  files.filter(
    name =>
      name.startsWith(
        `${TARGET_VERSION}_`
      )
  );

const source =
  fs.existsSync(
    TARGET
  )
    ? fs.readFileSync(
        TARGET,
        "utf8"
      )
    : "";

const checks = {
  migrationDirectoryExists:
    fs.existsSync(
      MIGRATIONS_DIR
    ),

  targetExists:
    fs.existsSync(
      TARGET
    ),

  versionUnique:
    versionMatches.length ===
    1,

  exactTargetName:
    versionMatches.length ===
      1 &&
    versionMatches[0] ===
      TARGET_NAME,

  transactionWrapped:
    /^\s*begin\s*;/i.test(
      source
    ) &&
    /\bcommit\s*;\s*$/i.test(
      source
    ),

  historyColumnsPresent:
    [
      "gross_pnl",
      "entry_broker_fee",
      "exit_broker_fee",
      "sell_tax",
      "total_transaction_cost",
      "net_pnl",
      "gross_return",
      "net_return",
      "entry_slippage_amount",
      "entry_slippage_rate",
      "cost_attribution_complete",
      "cost_model_version",
      "cost_attribution_snapshot",
    ].every(
      name =>
        source.includes(
          name
        )
    ),

  triggerPresent:
    source.includes(
      "trg_paper_trade_cost_attribution_v1"
    ) &&
    source.includes(
      "apply_paper_trade_cost_attribution_v1"
    ),

  preservesLegacyRealizedPnl:
    !/new\.realized_pnl\s*:=/i.test(
      source
    ),

  noOrderInsert:
    !/insert\s+into\s+public\.paper_order_requests/i.test(
      source
    ),

  noPositionInsert:
    !/insert\s+into\s+public\.paper_positions/i.test(
      source
    ),

  noTradeHistoryInsert:
    !/insert\s+into\s+public\.paper_trade_history/i.test(
      source
    ),

  noRealTradingEnable:
    !/real_order_enabled\s*=\s*true/i.test(
      source
    ),
};

const failed =
  Object.entries(
    checks
  )
    .filter(
      ([, ok]) =>
        ok !== true
    )
    .map(
      ([name]) =>
        name
    );

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "AI_STOCK_LAB_PAPER_EXECUTION_COST_ATTRIBUTION_V1_DB_APPLY_PREFLIGHT_PASS"
          : "AI_STOCK_LAB_PAPER_EXECUTION_COST_ATTRIBUTION_V1_DB_APPLY_PREFLIGHT_FAILED",

      target: {
        version:
          TARGET_VERSION,
        migration:
          `supabase/migrations/${TARGET_NAME}`,
        sameVersionFiles:
          versionMatches,
      },

      checks,

      safety: {
        databaseReads:
          0,
        databaseWrites:
          0,
        migrationApplied:
          false,
        ordersCreated:
          0,
        ordersExecuted:
          0,
        positionsChanged:
          0,
        realTradingEnabled:
          false,
      },

      failed,

      nextGate:
        failed.length === 0
          ? "SUPABASE_MIGRATION_LIST_REQUIRE_ONLY_TARGET_PENDING"
          : "STOP_BEFORE_DB_PUSH",
    },
    null,
    2
  )
);

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
