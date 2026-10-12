const fs = require("fs");
const path = require("path");

const root =
  process.cwd();

function read(rel) {
  return fs.readFileSync(
    path.resolve(
      root,
      rel,
    ),
    "utf8",
  );
}

const stop =
  read(
    "lib/trading/check-stop-losses.ts",
  );

const trailing =
  read(
    "lib/trading/update-trailing-stops.ts",
  );

const helper =
  read(
    "lib/trading/resolve-protective-sell-execution-realism-v2.ts",
  );

const migration =
  read(
    "supabase/migrations/20261009000200_paper_execution_realism_v2_protective_sell.sql",
  );

const checks = {
  stopImportsProtectiveRealism:
    stop.includes(
      "resolveProtectiveSellExecutionRealismV2",
    ),

  trailingImportsProtectiveRealism:
    trailing.includes(
      "resolveProtectiveSellExecutionRealismV2",
    ),

  stopUsesV2Rpc:
    stop.includes(
      "execute_paper_protective_sell_v2",
    ),

  trailingUsesV2Rpc:
    trailing.includes(
      "execute_paper_protective_sell_v2",
    ),

  stopPassesFillQuantity:
    stop.includes(
      "p_fill_quantity:",
    ),

  trailingPassesFillQuantity:
    trailing.includes(
      "p_fill_quantity:",
    ),

  stopPassesCosts:
    stop.includes(
      "p_broker_fee:",
    ) &&
    stop.includes(
      "p_sell_tax:",
    ),

  trailingPassesCosts:
    trailing.includes(
      "p_broker_fee:",
    ) &&
    trailing.includes(
      "p_sell_tax:",
    ),

  helperUsesSellSide:
    helper.includes(
      'side:\n        "SELL"',
    ) ||
    helper.includes(
      'side: "SELL"',
    ),

  helperHasProtectiveFallback:
    helper.includes(
      "protectiveFallbackUsed",
    ) &&
    helper.includes(
      "intervalVolume:\n          null",
    ),

  migrationHasV2Rpc:
    migration.includes(
      "execute_paper_protective_sell_v2",
    ),

  migrationHasAuditTable:
    migration.includes(
      "paper_protective_execution_fills_v2",
    ),

  migrationHasPartialPositionUpdate:
    migration.includes(
      "v_remaining_position_quantity",
    ) &&
    migration.includes(
      "update public.paper_positions",
    ) &&
    migration.includes(
      "delete from public.paper_positions",
    ),

  migrationHasTransactionCosts:
    migration.includes(
      "p_broker_fee",
    ) &&
    migration.includes(
      "p_sell_tax",
    ) &&
    migration.includes(
      "v_total_transaction_cost",
    ),

  migrationAdjustsRealizedPnl:
    migration.includes(
      "v_realized_pnl :=\n    v_realized_pnl -\n    v_total_transaction_cost",
    ),

  protectiveExitNotKillSwitchBlocked:
    !migration.includes(
      "EMERGENCY_STOP_ACTIVE",
    ) &&
    !migration.includes(
      "PAPER_ORDER_DISABLED",
    ),

  noRealTradingEnable:
    !/real_order_enabled\s*=\s*true/i.test(
      stop +
      "\n" +
      trailing +
      "\n" +
      migration,
    ),

  trailingSyntaxGuard:
    !/=\s*\n\s*const\s+protectiveExecution\b/.test(
      trailing,
    ) &&
    trailing.includes(
      "const protectiveExecution",
    ) &&
    trailing.includes(
      "execute_paper_protective_sell_v2",
    ),
};

const failed =
  Object.entries(checks)
    .filter(([, ok]) =>
      !ok,
    )
    .map(([name]) =>
      name,
    );

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "PAPER_EXECUTION_REALISM_V2_PROTECTIVE_SELL_STATIC_VERIFIED"
          : "PAPER_EXECUTION_REALISM_V2_PROTECTIVE_SELL_STATIC_FAILED",
      checks,
      failed,
      databaseApplied:
        false,
    },
    null,
    2,
  ),
);

if (failed.length > 0) {
  process.exitCode = 1;
}
