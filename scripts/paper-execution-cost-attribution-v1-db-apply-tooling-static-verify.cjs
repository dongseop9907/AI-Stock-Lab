const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const PREFLIGHT =
  path.join(
    ROOT,
    "scripts",
    "paper-execution-cost-attribution-v1-db-apply-preflight.cjs"
  );

const VERIFY =
  path.join(
    ROOT,
    "scripts",
    "paper-execution-cost-attribution-v1-db-verify.ts"
  );

function read(file) {
  return fs.existsSync(file)
    ? fs.readFileSync(
        file,
        "utf8"
      )
    : "";
}

const preflight =
  read(
    PREFLIGHT
  );

const verify =
  read(
    VERIFY
  );

const checks = {
  preflightExists:
    Boolean(
      preflight
    ),

  verifierExists:
    Boolean(
      verify
    ),

  exactMigrationVersion:
    preflight.includes(
      "20261010000100"
    ),

  duplicateVersionGuard:
    preflight.includes(
      "versionUnique"
    ),

  requiresCostColumns:
    verify.includes(
      "gross_pnl"
    ) &&
    verify.includes(
      "net_pnl"
    ) &&
    verify.includes(
      "total_transaction_cost"
    ) &&
    verify.includes(
      "sell_tax"
    ),

  confirmsExistingBuyFeeColumns:
    verify.includes(
      "execution_broker_fee"
    ) &&
    verify.includes(
      "execution_transaction_cost"
    ),

  readOnlyVerifier:
    !verify.includes(
      ".insert("
    ) &&
    !verify.includes(
      ".update("
    ) &&
    !verify.includes(
      ".delete("
    ) &&
    !verify.includes(
      ".upsert("
    ) &&
    !verify.includes(
      ".rpc("
    ),

  noSyntheticTrade:
    !verify.includes(
      "paper_trade_history"
    ) ||
    !verify.includes(
      ".insert("
    ),

  noRealTradingEnable:
    !preflight.includes(
      "real_order_enabled = true"
    ) &&
    !verify.includes(
      "REAL_TRADING_ENABLED=true"
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
          ? "AI_STOCK_LAB_PAPER_EXECUTION_COST_ATTRIBUTION_V1_DB_APPLY_TOOLING_STATIC_VERIFIED"
          : "AI_STOCK_LAB_PAPER_EXECUTION_COST_ATTRIBUTION_V1_DB_APPLY_TOOLING_STATIC_FAILED",

      checks,

      safety: {
        sourceOnly:
          true,
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
          false
      },

      failed,

      nextGate:
        failed.length === 0
          ? "RUN_PREFLIGHT_MIGRATION_LIST_EXACT_TARGET_PUSH_DB_VERIFY"
          : "REPAIR_DB_APPLY_TOOLING"
    },
    null,
    2
  )
);

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
