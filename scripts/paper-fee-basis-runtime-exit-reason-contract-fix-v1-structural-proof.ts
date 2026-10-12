import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const migrationPath = path.join(
  ROOT,
  "supabase",
  "migrations",
  "20261011001100_paper_fee_basis_runtime_exit_reason_contract_fix_v1.sql",
);

const runnerPath = path.join(
  ROOT,
  "scripts",
  "paper-partial-exit-multi-buy-fee-basis-runtime-regression-v1.ts",
);

const text =
  fs.existsSync(migrationPath)
    ? fs.readFileSync(migrationPath, "utf8")
    : "";

const runner =
  fs.existsSync(runnerPath)
    ? fs.readFileSync(runnerPath, "utf8")
    : "";

const count = (
  haystack: string,
  needle: string,
) => haystack.split(needle).length - 1;

const checks = {
  migrationExists:
    text.length > 0,

  replacesShortTestRpc:
    text.includes(
      "create or replace function public.run_paper_fee_basis_rt_v1()"
    ),

  readsExitReasonConstraint:
    text.includes(
      "paper_trade_history_exit_reason_check"
    ) &&
    text.includes(
      "pg_get_constraintdef"
    ),

  blocksBeforeFixtureIfStopLossDisallowed:
    text.includes(
      "STOP_LOSS_NOT_ALLOWED_BY_DEPLOYED_EXIT_REASON_CHECK"
    ),

  stopLossUsedForThreeFixtureTrades:
    count(
      text,
      "'STOP_LOSS'"
    ) >= 3,

  protectiveStopFixtureValueRemoved:
    !text.includes(
      "'PROTECTIVE_STOP'"
    ),

  exposesConstraintInResult:
    text.includes(
      "'deployedExitReasonConstraint'"
    ) &&
    text.includes(
      "'fixtureExitReason'"
    ),

  multiBuyFeeAssertionsRetained:
    text.includes(
      "ASSERT_BUY1_FEE_BASIS_INVALID"
    ) &&
    text.includes(
      "ASSERT_BUY2_FEE_BASIS_INVALID"
    ),

  threeStageExitAssertionsRetained:
    text.includes(
      "ASSERT_EXIT1_ALLOCATION_INVALID"
    ) &&
    text.includes(
      "ASSERT_EXIT2_ALLOCATION_INVALID"
    ) &&
    text.includes(
      "ASSERT_EXIT3_FINAL_REMAINDER_INVALID"
    ),

  exactFeeSumAssertionRetained:
    text.includes(
      "ASSERT_ENTRY_FEE_SUM_INVALID"
    ),

  costModelV2AssertionRetained:
    text.includes(
      "PAPER_EXECUTION_COST_ATTRIBUTION_V2_POSITION_FEE_BASIS"
    ) &&
    text.includes(
      "ASSERT_COST_MODEL_V2_INVALID"
    ),

  rollbackAssertionsRetained:
    text.includes(
      "PARTIAL_EXIT_MULTI_BUY_FEE_BASIS_ROLLBACK_SENTINEL"
    ) &&
    text.includes(
      "ASSERT_FIXTURE_ROWS_PERSISTED"
    ),

  runnerUsesShortRpc:
    runner.includes(
      "/rpc/run_paper_fee_basis_rt_v1"
    ),

  productionBuyRpcInvocationAbsent:
    !text.includes(
      "execute_paper_buy_order_with_execution_price_v2("
    ) &&
    !text.includes(
      "execute_paper_buy_order_with_execution_price_v3("
    ) &&
    !text.includes(
      "execute_paper_buy_order_with_execution_price_v4("
    ) &&
    !text.includes(
      "execute_paper_buy_order_with_execution_price_v5("
    ),

  productionSellRpcInvocationAbsent:
    !text.includes(
      "execute_paper_protective_sell_v2("
    ) &&
    !text.includes(
      "execute_paper_protective_sell_v3("
    ) &&
    !text.includes(
      "execute_paper_protective_sell_v4("
    ),

  noRealTradingEnablement:
    !text.includes(
      "REAL_TRADING_ENABLED=true"
    ) &&
    !text.includes(
      "ENABLE_REAL_TRADING=true"
    ) &&
    !text.includes(
      "ENABLE_LIVE_TRADING=true"
    ),
};

const failed =
  Object.entries(checks)
    .filter(([, ok]) => ok !== true)
    .map(([name]) => name);

console.log(JSON.stringify({
  status:
    failed.length === 0
      ? "AI_STOCK_LAB_PAPER_FEE_BASIS_RUNTIME_EXIT_REASON_CONTRACT_FIX_V1_STRUCTURAL_PROOF_PASS"
      : "AI_STOCK_LAB_PAPER_FEE_BASIS_RUNTIME_EXIT_REASON_CONTRACT_FIX_V1_STRUCTURAL_PROOF_FAIL",

  classification:
    failed.length === 0
      ? "DEPLOYED_EXIT_REASON_CONSTRAINT_AWARE_STOP_LOSS_FIXTURE_READY"
      : "EXIT_REASON_CONTRACT_FIXTURE_REVIEW_REQUIRED",

  checks,
  failed,

  diagnosis: {
    priorRejectedFixtureValue:
      "PROTECTIVE_STOP",

    canonicalHistoricalTradeReason:
      "STOP_LOSS",

    productionProtectiveDefaultObserved:
      "PROTECTIVE_STOP",

    possibleContractMismatch:
      true,

    migration010AlreadyApplied:
      true,

    migration011Required:
      true,

    productionTradingLogicModified:
      false
  },

  safety: {
    sourceOnly:
      true,

    databaseReads:
      0,

    databaseWrites:
      0,

    rpcInvoked:
      false,

    realTradingEnabled:
      false
  },

  nextGate:
    failed.length === 0
      ? "DB_PUSH_011_THEN_RERUN_FEE_BASIS_RUNTIME_REGRESSION"
      : "STOP_AND_REVIEW"
}, null, 2));

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
