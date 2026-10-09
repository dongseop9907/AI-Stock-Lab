const fs = require("fs");
const path = require("path");

const root = process.cwd();

const executorPath =
  path.resolve(
    root,
    "lib/trading/execute-paper-order.ts",
  );

const migrationPath =
  path.resolve(
    root,
    "supabase/migrations/20261009000100_paper_execution_realism_v2_buy_partial_fill.sql",
  );

const helperPath =
  path.resolve(
    root,
    "lib/trading/resolve-paper-execution-realism-v2-market-input.ts",
  );

const executor =
  fs.readFileSync(
    executorPath,
    "utf8",
  );

const migration =
  fs.readFileSync(
    migrationPath,
    "utf8",
  );

const helper =
  fs.readFileSync(
    helperPath,
    "utf8",
  );

const checks = {
  executorImportsRealism:
    executor.includes(
      "paper-execution-realism-v2",
    ),

  executorImportsMarketInput:
    executor.includes(
      "resolve-paper-execution-realism-v2-market-input",
    ),

  executorEvaluatesRealism:
    executor.includes(
      "evaluatePaperExecutionRealismV2",
    ),

  executorUsesV2Rpc:
    executor.includes(
      "execute_paper_buy_order_with_execution_price_v2",
    ),

  executorPassesFillQuantity:
    executor.includes(
      "p_fill_quantity:",
    ),

  executorPassesBrokerFee:
    executor.includes(
      "p_broker_fee:",
    ),

  migrationHasV2Rpc:
    migration.includes(
      "execute_paper_buy_order_with_execution_price_v2",
    ),

  migrationPreservesAdvisoryLock:
    migration.includes(
      "pg_advisory_xact_lock",
    ),

  migrationPreservesFreshness:
    /freshness|quality_gate|data_quality/i.test(
      migration,
    ),

  migrationPreservesKillSwitch:
    migration.includes(
      "emergency_stop",
    ),

  migrationHasPartialFillState:
    migration.includes(
      "v_is_final_fill",
    ) &&
    migration.includes(
      "'RISK_APPROVED'",
    ),

  migrationHasRiskTransfer:
    migration.includes(
      "reserved_risk_amount",
    ) &&
    migration.includes(
      "v_actual_trade_risk",
    ),

  migrationHasTransactionCost:
    migration.includes(
      "execution_broker_fee",
    ) &&
    migration.includes(
      "execution_transaction_cost",
    ),

  helperUsesVolumeDelta:
    helper.includes(
      "MARKET_SNAPSHOT_VOLUME_DELTA",
    ),

  noRealTradingEnable:
    !/real_order_enabled\s*=\s*true/i.test(
      executor + "\n" + migration,
    ),
};

const ok =
  Object.values(
    checks,
  ).every(Boolean);

console.log(
  JSON.stringify(
    {
      status: ok
        ? "PAPER_EXECUTION_REALISM_V2_BUY_BINDING_STATIC_VERIFIED"
        : "PAPER_EXECUTION_REALISM_V2_BUY_BINDING_STATIC_FAILED",
      checks,
      databaseApplied: false,
    },
    null,
    2,
  ),
);

if (!ok) {
  process.exitCode = 1;
}
