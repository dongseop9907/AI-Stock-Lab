const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const MIG_DIR =
  path.join(ROOT, "supabase", "migrations");

const stressPath =
  path.join(
    ROOT,
    "scripts/paper-order-final-two-http-concurrent-duplicate-fill-stress-v1.cjs",
  );

const migrationFiles =
  fs.existsSync(MIG_DIR)
    ? fs.readdirSync(MIG_DIR)
        .filter(
          (name) =>
            name.endsWith(
              "_paper_buy_v2_position_entry_order_binding_fix_v1.sql",
            ),
        )
        .sort()
    : [];

const migration =
  migrationFiles.length
    ? migrationFiles[
        migrationFiles.length - 1
      ]
    : null;

const migrationSource =
  migration
    ? fs.readFileSync(
        path.join(
          MIG_DIR,
          migration,
        ),
        "utf8",
      )
    : "";

const stressSource =
  fs.existsSync(stressPath)
    ? fs.readFileSync(
        stressPath,
        "utf8",
      )
    : "";

const checks = {
  migrationFound:
    Boolean(migration),

  v2FunctionPresent:
    migrationSource.includes(
      "create or replace function public.execute_paper_buy_order_with_execution_price_v2(",
    ),

  positionInsertIncludesEntryOrderId:
    /insert into public\.paper_positions[\s\S]{0,500}\bentry_order_id\b/i
      .test(migrationSource),

  positionInsertUsesOriginOrderId:
    /entry_order_id[\s\S]{0,300}v_order\.id/i
      .test(migrationSource),

  noHistoricalDataRewrite:
    !/\bupdate\s+public\.paper_positions\b[\s\S]{0,200}\bentry_order_id\b/i
      .test(migrationSource),

  sellFixtureBelowStop:
    /exitPrice:\s*\n\s*8900,/.test(
      stressSource,
    ) &&
    /current_stop_price:\s*\n\s*9000,/.test(
      stressSource,
    ),

  sellRpcExitBelowStop:
    /p_exit_price:\s*\n\s*8900,/.test(
      stressSource,
    ),

  sellExpectedExitUpdated:
    /tradeRows\[0\]\?\.exit_price,\s*\n\s*8900,/.test(
      stressSource,
    ),

  buyEntryOrderAssertionStillEnabled:
    /positionEntryOrderMatches:\s*\n\s*positionRows\[0\]\?\.entry_order_id\s*===\s*\n\s*orderId/.test(
      stressSource,
    ),

  realTradingDisabledByHarness:
    /realTradingEnabled:\s*\n\s*false/.test(
      stressSource,
    ),
};

const failed =
  Object.entries(checks)
    .filter(
      ([, ok]) =>
        ok !== true,
    )
    .map(
      ([name]) =>
        name,
    );

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "AI_STOCK_LAB_PAPER_ORDER_FINAL_CONCURRENCY_FIXES_V1_VERIFIED"
          : "AI_STOCK_LAB_PAPER_ORDER_FINAL_CONCURRENCY_FIXES_V1_VERIFY_FAILED",

      migration:
        migration
          ? "supabase/migrations/" +
            migration
          : null,

      stressHarness:
        "scripts/paper-order-final-two-http-concurrent-duplicate-fill-stress-v1.cjs",

      checks,
      failed,

      safety: {
        sourceOnly:
          true,

        migrationApplied:
          false,

        historicalRowsRewritten:
          false,

        realBrokerApiInvoked:
          false,

        realTradingEnabled:
          false,
      },

      nextGate:
        failed.length === 0
          ? "SUPABASE_DB_PUSH_DRY_RUN_FOR_ENTRY_ORDER_BINDING_FIX"
          : "REPAIR_SOURCE_BEFORE_DB_APPLY",
    },
    null,
    2,
  ),
);

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
