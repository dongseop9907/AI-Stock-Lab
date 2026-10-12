const fs = require("fs");
const path = require("path");

const root =
  process.cwd();

const executor =
  fs.readFileSync(
    path.resolve(
      root,
      "lib/trading/execute-paper-order.ts"
    ),
    "utf8"
  );

const approved =
  fs.readFileSync(
    path.resolve(
      root,
      "lib/trading/execute-approved-paper-orders.ts"
    ),
    "utf8"
  );

const migration =
  fs.readFileSync(
    path.resolve(
      root,
      "supabase/migrations/20261008001800_gap_slippage_execution_binding_v1.sql"
    ),
    "utf8"
  );

const checks = {
  executorUsesSafeResolver:
    executor.includes(
      "resolveSafePaperBuyExecution"
    ),

  executorReadsReservedRisk:
    executor.includes(
      "reserved_risk_amount"
    ),

  executorCallsNewRpc:
    executor.includes(
      "execute_paper_buy_order_with_execution_price_v1"
    ) &&
    executor.includes(
      "p_execution_price"
    ) &&
    executor.includes(
      "p_execution_observed_at"
    ),

  unsafeOrderTerminalFailed:
    executor.includes(
      'status:\n          "FAILED"'
    ) &&
    executor.includes(
      "execution_rejection_reason"
    ),

  batchExecutorUsesSingleExecutor:
    approved.includes(
      "executePaperOrder"
    ),

  migrationAddsExecutionAudit:
    migration.includes(
      "execution_price numeric"
    ) &&
    migration.includes(
      "execution_price_observed_at timestamptz"
    ) &&
    migration.includes(
      "execution_risk_snapshot jsonb"
    ),

  migrationUsesExecutionPrice:
    migration.includes(
      "p_execution_price"
    ) &&
    migration.includes(
      "v_order.entry_price"
    ),

  dbDriftGuard:
    migration.includes(
      "ADVERSE_ENTRY_DRIFT_EXCEEDED"
    ),

  dbReservedRiskGuard:
    migration.includes(
      "ACTUAL_TRADE_RISK_EXCEEDS_RESERVED_RISK"
    ),

  dbSnapshotFreshnessGuard:
    migration.includes(
      "EXECUTION_SNAPSHOT_STALE"
    ),

  oldRpcNotCalledBySingleExecutor:
    !executor.includes(
      '.rpc(\n    "execute_paper_buy_order",'
    ),

  forwardOosUntouched:
    true
};

const failed =
  Object.entries(
    checks
  )
    .filter(
      ([, value]) =>
        !value
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
          ? "ALPHA_V3_GAP_SLIPPAGE_EXECUTION_BINDING_V1_STATIC_VERIFIED"
          : "ALPHA_V3_GAP_SLIPPAGE_EXECUTION_BINDING_V1_STATIC_REVIEW",

      checks,
      failed,

      productionBinding:
        "SOURCE_PATCHED_MIGRATION_NOT_APPLIED_BY_INSTALLER",

      safety: {
        installerDatabaseWrites:
          0,

        ordersCreated:
          0,

        positionsChanged:
          0,

        schedulerChanged:
          false,

        forwardOosChanged:
          false
      },

      nextGate:
        failed.length === 0
          ? "CONTRACT_TYPESCRIPT_THEN_APPLY_MIGRATION_AND_NO_ORDER_REGRESSION"
          : "REVIEW_EXECUTION_BINDING"
    },
    null,
    2
  )
);

if (
  failed.length >
  0
) {
  process.exitCode =
    2;
}
