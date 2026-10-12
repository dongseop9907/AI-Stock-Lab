
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const migration = path.join(
  ROOT,
  "supabase",
  "migrations",
  "20261011000800_paper_partial_exit_multi_buy_fee_basis_runtime_regression_v1.sql",
);

const text =
  fs.existsSync(migration)
    ? fs.readFileSync(migration, "utf8")
    : "";

const checks = {
  migrationExists:
    text.length > 0,

  testRpcDefined:
    /run_paper_partial_exit_multi_buy_fee_basis_runtime_regression_v1/i.test(text),

  serviceRoleOnly:
    /revoke\s+all[\s\S]{0,900}?from\s+public/i.test(text) &&
    /revoke\s+all[\s\S]{0,1400}?from\s+anon/i.test(text) &&
    /revoke\s+all[\s\S]{0,1800}?from\s+authenticated/i.test(text) &&
    /grant\s+execute[\s\S]{0,500}?to\s+service_role/i.test(text),

  twoBuyOrders:
    /ROLLBACK_REGRESSION_FIXTURE_BUY_1/i.test(text) &&
    /ROLLBACK_REGRESSION_FIXTURE_BUY_2/i.test(text),

  feeUpdatesTriggerAccumulator:
    /execution_broker_fee\s*=\s*1000/i.test(text),

  basis1000Asserted:
    /ASSERT_BUY1_FEE_BASIS_INVALID/i.test(text),

  basis2000Asserted:
    /ASSERT_BUY2_FEE_BASIS_INVALID/i.test(text),

  threeTradeRows:
    /v_trade1/i.test(text) &&
    /v_trade2/i.test(text) &&
    /v_trade3/i.test(text),

  exit1Expected500:
    /ASSERT_EXIT1_ALLOCATION_INVALID/i.test(text),

  exit2Expected1000:
    /ASSERT_EXIT2_ALLOCATION_INVALID/i.test(text),

  exit3Expected500AndZeroRemaining:
    /ASSERT_EXIT3_FINAL_REMAINDER_INVALID/i.test(text),

  sumExactly2000:
    /ASSERT_ENTRY_FEE_SUM_INVALID/i.test(text),

  costMathAsserted:
    /ASSERT_TOTAL_TRANSACTION_COST_MATH_INVALID/i.test(text) &&
    /ASSERT_NET_PNL_MATH_INVALID/i.test(text),

  v2CostModelAsserted:
    /PAPER_EXECUTION_COST_ATTRIBUTION_V2_POSITION_FEE_BASIS/i.test(text) &&
    /ASSERT_COST_MODEL_V2_INVALID/i.test(text),

  rollbackSentinel:
    /PARTIAL_EXIT_MULTI_BUY_FEE_BASIS_ROLLBACK_SENTINEL/i.test(text),

  productionBuyRpcNotCalled:
    !/execute_paper_buy_order_with_execution_price_v[2345]\s*\(/i.test(text),

  productionSellRpcNotCalled:
    !/execute_paper_protective_sell_v[234]\s*\(/i.test(text),

  noRealTradingEnablement:
    !/REAL_TRADING_ENABLED\s*=\s*true/i.test(text) &&
    !/ENABLE_REAL_TRADING\s*=\s*true/i.test(text) &&
    !/ENABLE_LIVE_TRADING\s*=\s*true/i.test(text),
};

const failed =
  Object.entries(checks)
    .filter(([, ok]) => ok !== true)
    .map(([name]) => name);

console.log(JSON.stringify({
  status:
    failed.length === 0
      ? "AI_STOCK_LAB_PARTIAL_EXIT_MULTI_BUY_FEE_BASIS_RUNTIME_REGRESSION_V1_STRUCTURAL_PROOF_PASS"
      : "AI_STOCK_LAB_PARTIAL_EXIT_MULTI_BUY_FEE_BASIS_RUNTIME_REGRESSION_V1_STRUCTURAL_PROOF_FAIL",

  classification:
    failed.length === 0
      ? "MULTI_BUY_PARTIAL_EXIT_FEE_BASIS_ROLLBACK_RUNTIME_REGRESSION_STRUCTURALLY_READY"
      : "MULTI_BUY_PARTIAL_EXIT_RUNTIME_REGRESSION_REVIEW_REQUIRED",

  checks,
  failed,

  safety: {
    sourceOnly: true,
    databaseReads: 0,
    databaseWrites: 0,
    rpcInvoked: false,
    productionTradingLogicModified: false,
    realTradingEnabled: false,
  },

  nextGate:
    failed.length === 0
      ? "DB_PUSH_TEST_RPC_AND_RUN_MULTI_BUY_PARTIAL_EXIT_RUNTIME_REGRESSION"
      : "REVIEW_FAILED_STRUCTURAL_CHECKS",
}, null, 2));

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
