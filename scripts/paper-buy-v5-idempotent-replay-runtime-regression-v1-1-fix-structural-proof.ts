import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const fixMigrationPath =
  path.join(
    ROOT,
    "supabase",
    "migrations",
    "20261011000600_paper_buy_v5_idempotent_replay_runtime_regression_v1_1_fix.sql",
  );

const text =
  fs.existsSync(fixMigrationPath)
    ? fs.readFileSync(
        fixMigrationPath,
        "utf8",
      )
    : "";

const checks = {
  fixMigrationExists:
    text.length > 0,

  regressionFunctionReplaced:
    /create\s+or\s+replace\s+function[\s\S]*run_paper_buy_v5_idempotent_replay_runtime_regression_v1/i.test(
      text,
    ),

  riskDecisionFixtureInserted:
    /insert\s+into\s+public\.risk_decisions/i.test(
      text,
    ),

  riskDecisionIdReturned:
    /returning\s+id[\s\S]{0,80}?into\s+v_risk_decision_id/i.test(
      text,
    ),

  orderIncludesRiskDecisionId:
    /paper_order_requests[\s\S]{0,1800}?risk_decision_id/i.test(
      text,
    ),

  orderUsesFixtureRiskDecisionId:
    /'FAILED'[\s\S]{0,200}?v_risk_decision_id/i.test(
      text,
    ),

  preSeedsLedger:
    /insert\s+into\s+public\.paper_buy_execution_events_v1/i.test(
      text,
    ),

  callsV5:
    /execute_paper_buy_order_with_execution_price_v5/i.test(
      text,
    ),

  doesNotCallV4Directly:
    !/execute_paper_buy_order_with_execution_price_v4\s*\(/i.test(
      text,
    ),

  doesNotCallV3Directly:
    !/execute_paper_buy_order_with_execution_price_v3\s*\(/i.test(
      text,
    ),

  doesNotCallV2Directly:
    !/execute_paper_buy_order_with_execution_price_v2\s*\(/i.test(
      text,
    ),

  replayInvariantsRetained:
    /ASSERT_SECOND_CALL_NOT_IDEMPOTENT_REPLAY/i.test(
      text,
    ) &&
    /ASSERT_CASH_CHANGED_ON_REPLAY/i.test(
      text,
    ) &&
    /ASSERT_POSITION_CHANGED_ON_REPLAY/i.test(
      text,
    ) &&
    /ASSERT_ORDER_EXECUTION_ACCUMULATORS_CHANGED_ON_REPLAY/i.test(
      text,
    ) &&
    /ASSERT_LEDGER_COUNT_CHANGED/i.test(
      text,
    ),

  rollbackScopeRetained:
    /ROLLBACK_SENTINEL/i.test(
      text,
    ) &&
    /exception\s+when\s+raise_exception/i.test(
      text,
    ),

  riskDecisionRollbackAsserted:
    /v_risk_rows_after_rollback/i.test(
      text,
    ) &&
    /fixtureRiskDecisionRemoved/i.test(
      text,
    ),

  productionV5NotReplaced:
    !/create\s+or\s+replace\s+function\s+public\.execute_paper_buy_order_with_execution_price_v5/i.test(
      text,
    ),

  noTradingControlMutation:
    !/(insert\s+into|update|delete\s+from)\s+public\.trading_system_controls/i.test(
      text,
    ),

  noRealTradingEnablement:
    !/REAL_TRADING_ENABLED\s*=\s*true/i.test(
      text,
    ) &&
    !/ENABLE_REAL_TRADING\s*=\s*true/i.test(
      text,
    ) &&
    !/ENABLE_LIVE_TRADING\s*=\s*true/i.test(
      text,
    ),
};

const failed =
  Object.entries(checks)
    .filter(([, ok]) => ok !== true)
    .map(([name]) => name);

console.log(JSON.stringify({
  status:
    failed.length === 0
      ? "AI_STOCK_LAB_BUY_V5_IDEMPOTENT_REPLAY_RUNTIME_REGRESSION_V1_1_FIX_STRUCTURAL_PROOF_PASS"
      : "AI_STOCK_LAB_BUY_V5_IDEMPOTENT_REPLAY_RUNTIME_REGRESSION_V1_1_FIX_STRUCTURAL_PROOF_FAIL",

  classification:
    failed.length === 0
      ? "RISK_DECISION_FIXTURE_SCHEMA_GAP_REPAIRED_STRUCTURALLY"
      : "RISK_DECISION_FIXTURE_REPAIR_REVIEW_REQUIRED",

  checks,
  failed,

  interpretation:
    "Previous runtime failure occurred before V5 replay because the rollback fixture omitted the NOT NULL risk_decision_id relationship. V1.1 creates a transaction-local risk_decisions row and binds it to the fixture order.",

  productionTradingLogicModified:
    false,

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
      false,
  },

  nextGate:
    failed.length === 0
      ? "DB_PUSH_V1_1_FIX_AND_RERUN_RUNTIME_REGRESSION"
      : "REVIEW_FAILED_FIXTURE_CHECKS",
}, null, 2));

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
