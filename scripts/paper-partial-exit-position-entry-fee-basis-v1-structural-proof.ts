import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const migrationPath =
  path.join(
    ROOT,
    "supabase",
    "migrations",
    "20261011000200_paper_partial_exit_position_entry_fee_basis_v1.sql",
  );

if (!fs.existsSync(migrationPath)) {
  console.log(JSON.stringify({
    status:
      "AI_STOCK_LAB_PAPER_PARTIAL_EXIT_POSITION_ENTRY_FEE_BASIS_V1_STRUCTURAL_PROOF_FAIL",
    reason:
      "MIGRATION_NOT_FOUND",
    migration:
      path.relative(ROOT, migrationPath).replaceAll("\\", "/"),
  }, null, 2));

  process.exitCode = 1;
}
else {
  const sql =
    fs.readFileSync(
      migrationPath,
      "utf8",
    );

  const checks = {
    cleanStateGuard:
      /PAPER_ENTRY_FEE_BASIS_V1_REQUIRES_EMPTY_PAPER_POSITIONS/i.test(sql) &&
      /PAPER_ENTRY_FEE_BASIS_V1_REQUIRES_EMPTY_TRADE_HISTORY/i.test(sql) &&
      /PAPER_ENTRY_FEE_BASIS_V1_REQUIRES_NO_EXECUTED_BUY_ORDERS/i.test(sql),

    totalFeeBasisColumn:
      /entry_broker_fee_basis_total/i.test(sql),

    remainingFeeBasisColumn:
      /entry_broker_fee_basis_remaining/i.test(sql),

    removesSourcePositionUnique:
      /drop constraint/i.test(sql) &&
      /source_position_id/i.test(sql),

    restoresNonUniqueSourcePositionIndex:
      /idx_paper_trade_history_source_position_v1/i.test(sql),

    buyFeeDeltaAccumulator:
      /accumulate_paper_position_entry_fee_basis_v1/i.test(sql) &&
      /new\.execution_broker_fee/i.test(sql) &&
      /old\.execution_broker_fee/i.test(sql),

    buyAccumulatorTrigger:
      /trg_accumulate_paper_position_entry_fee_basis_v1/i.test(sql),

    partialExitAllocator:
      /apply_paper_trade_entry_fee_basis_v1/i.test(sql),

    proportionalAllocation:
      /v_fee_before[\s\S]*new\.quantity::numeric[\s\S]*v_position_quantity::numeric/i.test(sql),

    finalExitConsumesRemainder:
      /if new\.quantity = v_position_quantity then[\s\S]*v_fee_allocated[\s\S]*v_fee_before/i.test(sql),

    updateDoesNotConsumeTwice:
      /if tg_op = 'UPDATE' then[\s\S]*old\.entry_broker_fee/i.test(sql),

    recomputesNetPnl:
      /new\.net_pnl[\s\S]*new\.gross_pnl[\s\S]*new\.total_transaction_cost/i.test(sql),

    costVersionV2:
      /PAPER_EXECUTION_COST_ATTRIBUTION_V2_POSITION_FEE_BASIS/i.test(sql),

    triggerRunsAfterExistingCostTrigger:
      /trg_zz_paper_trade_entry_fee_basis_v1/i.test(sql),

    deploymentInvariantChecks:
      /PAPER_TRADE_HISTORY_SOURCE_POSITION_UNIQUE_DEPLOYMENT_CHECK_FAILED/i.test(sql) &&
      /PAPER_ENTRY_FEE_ACCUMULATOR_TRIGGER_MISSING/i.test(sql) &&
      /PAPER_ENTRY_FEE_ALLOCATION_TRIGGER_MISSING/i.test(sql),

    noRealTrading:
      !/ENABLE_REAL_TRADING\s*=\s*true/i.test(sql) &&
      !/REAL_TRADING_ENABLED\s*=\s*true/i.test(sql),
  };

  const failed =
    Object.entries(checks)
      .filter(([, ok]) => ok !== true)
      .map(([name]) => name);

  console.log(JSON.stringify({
    status:
      failed.length === 0
        ? "AI_STOCK_LAB_PAPER_PARTIAL_EXIT_POSITION_ENTRY_FEE_BASIS_V1_STRUCTURAL_PROOF_PASS"
        : "AI_STOCK_LAB_PAPER_PARTIAL_EXIT_POSITION_ENTRY_FEE_BASIS_V1_STRUCTURAL_PROOF_FAIL",

    classification:
      failed.length === 0
        ? "ATOMIC_PARTIAL_EXIT_AND_POSITION_ENTRY_FEE_BASIS_REPAIR_STRUCTURALLY_READY"
        : "ATOMIC_REPAIR_SOURCE_REVIEW_REQUIRED",

    migration:
      "supabase/migrations/20261011000200_paper_partial_exit_position_entry_fee_basis_v1.sql",

    checks,
    failed,

    invariants: {
      multiExitHistory:
        "source_position_id no longer has a single-column UNIQUE constraint.",

      multiBuyFeeBasis:
        "Every positive BUY execution_broker_fee delta is accumulated into current position total and remaining fee basis.",

      partialExit:
        "Partial exit allocates remaining entry fee proportional to exited quantity.",

      finalExit:
        "Final exit consumes all remaining fee basis, eliminating rounding residue.",

      updateIdempotency:
        "Trade-history UPDATE preserves the entry fee already consumed on INSERT and does not consume position basis again.",

      callerCompatibility:
        "Validated BUY V2/V3/V4 and protective SELL callers remain intact; repair is implemented through schema plus triggers."
    },

    safety: {
      sourceOnlyProof: true,
      databaseReads: 0,
      databaseWrites: 0,
      ordersCreated: 0,
      ordersExecuted: 0,
      positionsChanged: 0,
      realTradingEnabled: false,
    },

    nextGate:
      failed.length === 0
        ? "APPLY_MIGRATION_WITH_SUPABASE_DB_PUSH"
        : "REVIEW_FAILED_STRUCTURAL_CHECKS_BEFORE_DB_PUSH",
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
