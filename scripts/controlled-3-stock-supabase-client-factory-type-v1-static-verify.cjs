const fs = require("fs");
const path = require("path");

const target = path.join(
  process.cwd(),
  "scripts",
  "alpha-v1-controlled-3-stock-daily-bar-insert-only.ts"
);

if (!fs.existsSync(target)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_CONTROLLED_3_STOCK_SUPABASE_CLIENT_FACTORY_TYPE_V1_STATIC_FAILED",
    failed: [
      "targetExists"
    ]
  }, null, 2));

  process.exitCode = 1;
} else {
  const source =
    fs.readFileSync(
      target,
      "utf8"
    );

  const checks = {
    factoryPresent:
      source.includes(
        "function createControlledApplySupabaseClient("
      ),

    typeAliasUsesFactoryReturn:
      source.includes(
        "type ControlledApplySupabaseClient ="
      ) &&
      source.includes(
        "typeof createControlledApplySupabaseClient"
      ),

    readScopeUsesAlias:
      source.includes(
        "ControlledApplySupabaseClient,"
      ),

    mainUsesFactory:
      source.includes(
        "createControlledApplySupabaseClient("
      ) &&
      source.includes(
        "config.url"
      ) &&
      source.includes(
        "config.key"
      ),

    genericCreateClientReturnTypeGone:
      !/ReturnType<\\s*typeof createClient\\s*>/.test(
        source
      ),

    authOptionsStillPresent:
      source.includes(
        "persistSession:"
      ) &&
      source.includes(
        "autoRefreshToken:"
      ),

    noSupabaseAnyCast:
      !source.includes(
        "supabase as any"
      )
  };

  const failed =
    Object.entries(
      checks
    )
      .filter(
        ([, value]) =>
          value !== true
      )
      .map(
        ([key]) =>
          key
      );

  console.log(JSON.stringify({
    status:
      failed.length === 0
        ? "AI_STOCK_LAB_CONTROLLED_3_STOCK_SUPABASE_CLIENT_FACTORY_TYPE_V1_STATIC_VERIFIED"
        : "AI_STOCK_LAB_CONTROLLED_3_STOCK_SUPABASE_CLIENT_FACTORY_TYPE_V1_STATIC_FAILED",

    checks,

    safety: {
      sourceOnly:
        true,

      controlledApplyExecuted:
        false,

      databaseReads:
        0,

      databaseWrites:
        0,

      ordersCreated:
        0,

      positionsChanged:
        0,

      promotionExecuted:
        false,

      realTradingEnabled:
        false
    },

    failed,

    nextGate:
      failed.length === 0
        ? "RUN_DASHBOARD_CONTRACT_AND_NEXT_BUILD"
        : "REPAIR_SUPABASE_CLIENT_TYPE_CONTRACT"
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
