const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const sourceMigration = path.join(
  ROOT,
  "supabase",
  "migrations",
  "20261011000800_paper_partial_exit_multi_buy_fee_basis_runtime_regression_v1.sql"
);

const targetMigration = path.join(
  ROOT,
  "supabase",
  "migrations",
  "20261011001000_paper_fee_basis_runtime_exit_reason_fix_v1.sql"
);

const structuralPath = path.join(
  ROOT,
  "scripts",
  "paper-fee-basis-runtime-exit-reason-fix-v1-structural-proof.ts"
);

if (!fs.existsSync(sourceMigration)) {
  throw new Error(`SOURCE_MIGRATION_NOT_FOUND:${sourceMigration}`);
}

const source =
  fs.readFileSync(
    sourceMigration,
    "utf8"
  );

const oldFunctionName =
  "public.run_paper_partial_exit_multi_buy_fee_basis_runtime_regression_v1()";

const newFunctionName =
  "public.run_paper_fee_basis_rt_v1()";

if (!source.includes(oldFunctionName)) {
  throw new Error(
    "EXPECTED_SOURCE_TEST_FUNCTION_NOT_FOUND"
  );
}

let next =
  source.replace(
    oldFunctionName,
    newFunctionName
  );

const replacements = [
  [
    "'ROLLBACK_REGRESSION_PARTIAL_EXIT_1'",
    "'PROTECTIVE_STOP'"
  ],
  [
    "'ROLLBACK_REGRESSION_PARTIAL_EXIT_2'",
    "'PROTECTIVE_STOP'"
  ],
  [
    "'ROLLBACK_REGRESSION_FINAL_EXIT'",
    "'PROTECTIVE_STOP'"
  ]
];

for (const [from, to] of replacements) {
  const count =
    next.split(from).length - 1;

  if (count !== 1) {
    throw new Error(
      `EXPECTED_EXACTLY_ONE_EXIT_REASON_FIXTURE value=${from} count=${count}`
    );
  }

  next =
    next.replace(
      from,
      to
    );
}

/*
 * The source migration's revoke/grant/comment statements still use
 * the original long function name. Replace all remaining occurrences
 * so migration 010 consistently targets the short deployed test RPC.
 */
next =
  next.split(
    "public.run_paper_partial_exit_multi_buy_fee_basis_runtime_regression_v1()"
  ).join(
    "public.run_paper_fee_basis_rt_v1()"
  );

fs.writeFileSync(
  targetMigration,
  next,
  "utf8"
);

const structural = `import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const targetMigration = path.join(
  ROOT,
  "supabase",
  "migrations",
  "20261011001000_paper_fee_basis_runtime_exit_reason_fix_v1.sql",
);

const runnerPath = path.join(
  ROOT,
  "scripts",
  "paper-partial-exit-multi-buy-fee-basis-runtime-regression-v1.ts",
);

const text =
  fs.existsSync(targetMigration)
    ? fs.readFileSync(targetMigration, "utf8")
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

  shortTestRpcReplaced:
    text.includes(
      "create or replace function public.run_paper_fee_basis_rt_v1()"
    ),

  longTestRpcDefinitionAbsent:
    !text.includes(
      "create or replace function public.run_paper_partial_exit_multi_buy_fee_basis_runtime_regression_v1()"
    ),

  allThreeFixtureExitReasonsCanonical:
    count(
      text,
      "'PROTECTIVE_STOP'"
    ) >= 3,

  oldFixtureExitReason1Absent:
    !text.includes(
      "'ROLLBACK_REGRESSION_PARTIAL_EXIT_1'"
    ),

  oldFixtureExitReason2Absent:
    !text.includes(
      "'ROLLBACK_REGRESSION_PARTIAL_EXIT_2'"
    ),

  oldFixtureFinalExitReasonAbsent:
    !text.includes(
      "'ROLLBACK_REGRESSION_FINAL_EXIT'"
    ),

  multiBuyAssertionsRetained:
    text.includes(
      "ASSERT_BUY1_FEE_BASIS_INVALID"
    ) &&
    text.includes(
      "ASSERT_BUY2_FEE_BASIS_INVALID"
    ),

  threeExitAllocationAssertionsRetained:
    text.includes(
      "ASSERT_EXIT1_ALLOCATION_INVALID"
    ) &&
    text.includes(
      "ASSERT_EXIT2_ALLOCATION_INVALID"
    ) &&
    text.includes(
      "ASSERT_EXIT3_FINAL_REMAINDER_INVALID"
    ),

  feeSumAssertionRetained:
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

  serviceRoleOnlyRetained:
    text.includes(
      "from public;"
    ) &&
    text.includes(
      "from anon;"
    ) &&
    text.includes(
      "from authenticated;"
    ) &&
    text.includes(
      "to service_role;"
    ),

  runnerStillUsesShortRpc:
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
      ? "AI_STOCK_LAB_PAPER_FEE_BASIS_RUNTIME_EXIT_REASON_FIX_V1_STRUCTURAL_PROOF_PASS"
      : "AI_STOCK_LAB_PAPER_FEE_BASIS_RUNTIME_EXIT_REASON_FIX_V1_STRUCTURAL_PROOF_FAIL",

  classification:
    failed.length === 0
      ? "CANONICAL_PROTECTIVE_STOP_EXIT_REASON_FIXTURE_READY"
      : "EXIT_REASON_FIXTURE_REVIEW_REQUIRED",

  checks,
  failed,

  diagnosis: {
    priorRuntimeSqlState:
      "23514",

    priorConstraint:
      "paper_trade_history_exit_reason_check",

    priorFailureStage:
      "FIRST_TRADE_INSERT_AFTER_BEFORE_TRIGGERS",

    evidenceObservedBeforeConstraintFailure: {
      entryBrokerFee:
        500,

      costModelVersion:
        "PAPER_EXECUTION_COST_ATTRIBUTION_V2_POSITION_FEE_BASIS"
    },

    canonicalFixtureExitReason:
      "PROTECTIVE_STOP",

    migration009AlreadyApplied:
      true,

    migration010Required:
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
      ? "DB_PUSH_010_THEN_RERUN_EXISTING_FEE_BASIS_RUNTIME_REGRESSION"
      : "STOP_AND_REVIEW"
}, null, 2));

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
`;

fs.writeFileSync(
  structuralPath,
  structural,
  "utf8"
);

console.log(JSON.stringify({
  status:
    "AI_STOCK_LAB_PAPER_FEE_BASIS_RUNTIME_EXIT_REASON_FIX_V1_INSTALLED",

  generatedFiles: [
    "supabase/migrations/20261011001000_paper_fee_basis_runtime_exit_reason_fix_v1.sql",
    "scripts/paper-fee-basis-runtime-exit-reason-fix-v1-structural-proof.ts"
  ],

  fixes: [
    "create/replace only the already-renamed short test RPC",
    "replace all three synthetic exit_reason labels with canonical PROTECTIVE_STOP",
    "preserve multi-BUY fee accumulation assertions",
    "preserve 50/100/50 partial-exit allocation assertions",
    "preserve transaction rollback and service-role-only safety"
  ],

  migration009Modified:
    false,

  productionTradingLogicModified:
    false,

  databaseModifiedDuringInstall:
    false,

  realTradingEnabled:
    false,

  nextAction:
    "RUN_STRUCTURAL_PROOF_THEN_DB_PUSH_010_THEN_RERUN_EXISTING_RUNTIME_REGRESSION"
}, null, 2));

process.exitCode = 0;
