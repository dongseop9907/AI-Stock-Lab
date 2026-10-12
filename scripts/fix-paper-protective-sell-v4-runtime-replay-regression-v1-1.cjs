const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const sourceMigration = path.join(
  ROOT,
  "supabase",
  "migrations",
  "20261011001300_paper_protective_sell_v4_runtime_replay_regression_v1.sql"
);

const targetMigration = path.join(
  ROOT,
  "supabase",
  "migrations",
  "20261011001400_paper_protective_sell_v4_runtime_replay_regression_v1_1.sql"
);

const structuralPath = path.join(
  ROOT,
  "scripts",
  "paper-protective-sell-v4-runtime-replay-regression-v1-1-structural-proof.ts"
);

if (!fs.existsSync(sourceMigration)) {
  throw new Error(`SOURCE_MIGRATION_NOT_FOUND:${sourceMigration}`);
}

const source =
  fs.readFileSync(sourceMigration, "utf8");

const marker =
  "create or replace function public.run_paper_sell_v4_replay_rt_v1()";

const start =
  source.toLowerCase().indexOf(marker.toLowerCase());

if (start < 0) {
  throw new Error("TEST_RPC_DEFINITION_NOT_FOUND_IN_013");
}

const end =
  source.indexOf("$$;", start);

if (end < 0) {
  throw new Error("TEST_RPC_DEFINITION_END_NOT_FOUND_IN_013");
}

let fn =
  source.slice(start, end + 3);

const badAssertion = `    if coalesce(v_result ->> 'exitReason', '') <> 'TRAILING_STOP' then
      raise exception
        'ASSERT_HISTORICAL_EXIT_REASON_NOT_PRESERVED result=%',
        v_result;
    end if;

`;

if (!fn.includes(badAssertion)) {
  throw new Error("EXPECTED_FALSE_NEGATIVE_EXIT_REASON_RESPONSE_ASSERTION_NOT_FOUND");
}

fn =
  fn.replace(
    badAssertion,
    `    /*
     * V4 closed-replay response intentionally does not expose exitReason.
     * Prove historical reason preservation from the immutable trade row itself.
     */
    if coalesce(v_new_row_after ->> 'exit_reason', '') <> 'TRAILING_STOP' then
      raise exception
        'ASSERT_HISTORICAL_EXIT_REASON_ROW_NOT_PRESERVED row=%',
        v_new_row_after;
    end if;

`
  );

const badCheck = `        'historicalExitReasonPreserved',
          coalesce(v_result ->> 'exitReason', '') = 'TRAILING_STOP',`;

if (!fn.includes(badCheck)) {
  throw new Error("EXPECTED_FALSE_NEGATIVE_EXIT_REASON_RESULT_CHECK_NOT_FOUND");
}

fn =
  fn.replace(
    badCheck,
    `        'historicalExitReasonPreserved',
          coalesce(v_new_row_after ->> 'exit_reason', '') = 'TRAILING_STOP',

        'replayResponseContractDoesNotRequireExitReason',
          true,`
  );

const migration = [
  "begin;",
  "",
  "-- V1.1 fixes only the regression assertion contract.",
  "-- Production execute_paper_protective_sell_v4 is not modified.",
  "-- Closed replay does not return exitReason; historical reason is verified",
  "-- directly from the unchanged paper_trade_history row instead.",
  "",
  fn,
  "",
  "revoke all",
  "on function public.run_paper_sell_v4_replay_rt_v1()",
  "from public;",
  "",
  "revoke all",
  "on function public.run_paper_sell_v4_replay_rt_v1()",
  "from anon;",
  "",
  "revoke all",
  "on function public.run_paper_sell_v4_replay_rt_v1()",
  "from authenticated;",
  "",
  "grant execute",
  "on function public.run_paper_sell_v4_replay_rt_v1()",
  "to service_role;",
  "",
  "comment on function public.run_paper_sell_v4_replay_rt_v1()",
  "is",
  "  'Service-role-only V4 closed replay rollback regression V1.1; validates exit_reason from immutable trade row rather than non-contract response field.';",
  "",
  "notify pgrst, 'reload schema';",
  "",
  "commit;",
  "",
].join("\n");

fs.writeFileSync(
  targetMigration,
  migration,
  "utf8"
);

const structural = `import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const migrationPath = path.join(
  ROOT,
  "supabase",
  "migrations",
  "20261011001400_paper_protective_sell_v4_runtime_replay_regression_v1_1.sql",
);

const runnerPath = path.join(
  ROOT,
  "scripts",
  "paper-protective-sell-v4-runtime-replay-regression-v1.ts",
);

const text =
  fs.existsSync(migrationPath)
    ? fs.readFileSync(migrationPath, "utf8")
    : "";

const runner =
  fs.existsSync(runnerPath)
    ? fs.readFileSync(runnerPath, "utf8")
    : "";

const checks = {
  migrationExists:
    text.length > 0,

  testRpcReplaced:
    text.includes(
      "create or replace function public.run_paper_sell_v4_replay_rt_v1()"
    ),

  productionV4DefinitionAbsent:
    !text.includes(
      "create or replace function public.execute_paper_protective_sell_v4("
    ),

  stillCallsProductionV4:
    text.includes(
      "select public.execute_paper_protective_sell_v4("
    ),

  falseResponseExitReasonAssertionRemoved:
    !text.includes(
      "coalesce(v_result ->> 'exitReason', '') <> 'TRAILING_STOP'"
    ),

  rowExitReasonAssertionPresent:
    text.includes(
      "coalesce(v_new_row_after ->> 'exit_reason', '') <> 'TRAILING_STOP'"
    ) &&
    text.includes(
      "ASSERT_HISTORICAL_EXIT_REASON_ROW_NOT_PRESERVED"
    ),

  rowExitReasonResultCheckPresent:
    text.includes(
      "coalesce(v_new_row_after ->> 'exit_reason', '') = 'TRAILING_STOP'"
    ),

  immutableWholeRowAssertionsRetained:
    text.includes(
      "ASSERT_OLD_TRADE_REWRITTEN"
    ) &&
    text.includes(
      "ASSERT_LATEST_TRADE_REWRITTEN"
    ),

  latestTradeAssertionRetained:
    text.includes(
      "ASSERT_LATEST_TRADE_NOT_RETURNED"
    ),

  exitPriceAssertionRetained:
    text.includes(
      "ASSERT_HISTORICAL_EXIT_PRICE_NOT_PRESERVED"
    ),

  quantityAssertionRetained:
    text.includes(
      "ASSERT_HISTORICAL_QUANTITY_NOT_PRESERVED"
    ),

  zeroDuplicateMutationAssertionsRetained:
    text.includes(
      "ASSERT_REPLAY_CREATED_OR_REMOVED_TRADE"
    ) &&
    text.includes(
      "ASSERT_REPLAY_CREATED_ORDER"
    ) &&
    text.includes(
      "ASSERT_REPLAY_CREATED_PROTECTIVE_FILL"
    ),

  accountCashAssertionsRetained:
    text.includes(
      "ASSERT_ACCOUNT_CASH_CHANGED"
    ) &&
    text.includes(
      "ASSERT_ACCOUNT_CASH_NOT_RESTORED"
    ),

  rollbackSentinelRetained:
    text.includes(
      "PROTECTIVE_SELL_V4_REPLAY_ROLLBACK_SENTINEL"
    ),

  runnerStillTargetsSameTestRpc:
    runner.includes(
      "/rpc/run_paper_sell_v4_replay_rt_v1"
    ),

  serviceRoleOnly:
    text.includes("from public;") &&
    text.includes("from anon;") &&
    text.includes("from authenticated;") &&
    text.includes("to service_role;"),

  noRealTradingEnablement:
    !text.includes("REAL_TRADING_ENABLED=true") &&
    !text.includes("ENABLE_REAL_TRADING=true") &&
    !text.includes("ENABLE_LIVE_TRADING=true"),
};

const failed =
  Object.entries(checks)
    .filter(([, ok]) => ok !== true)
    .map(([name]) => name);

console.log(JSON.stringify({
  status:
    failed.length === 0
      ? "AI_STOCK_LAB_PROTECTIVE_SELL_V4_RUNTIME_REPLAY_REGRESSION_V1_1_STRUCTURAL_PROOF_PASS"
      : "AI_STOCK_LAB_PROTECTIVE_SELL_V4_RUNTIME_REPLAY_REGRESSION_V1_1_STRUCTURAL_PROOF_FAIL",

  classification:
    failed.length === 0
      ? "SELL_V4_REPLAY_ASSERTION_ALIGNED_TO_ACTUAL_RESPONSE_CONTRACT_AND_ROW_IMMUTABILITY"
      : "SELL_V4_REPLAY_ASSERTION_FIX_REVIEW_REQUIRED",

  checks,
  failed,

  diagnosis: {
    priorRuntimeFailure:
      "AUDITOR_FALSE_NEGATIVE",

    priorObservedReplayResult: {
      alreadyClosed:
        true,
      exitPrice:
        11000,
      quantity:
        1,
      replayVersion:
        "PAPER_PROTECTIVE_SELL_CLOSED_REPLAY_V1",
      replayResolution:
        "FINAL_TRADE_BY_CLOSED_AT_DESC_ID_DESC",
      exitReasonField:
        "NOT_PART_OF_REPLAY_RESPONSE_CONTRACT",
    },

    correctedVerification:
      "Verify historical exit_reason from immutable paper_trade_history row before/after replay.",

    productionTradingLogicModified:
      false,
  },

  safety: {
    sourceOnly: true,
    databaseReads: 0,
    databaseWrites: 0,
    rpcInvoked: false,
    realTradingEnabled: false,
  },

  nextGate:
    failed.length === 0
      ? "DB_PUSH_014_THEN_RERUN_EXISTING_SELL_V4_RUNTIME_REPLAY"
      : "STOP_AND_REVIEW",
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
    "AI_STOCK_LAB_PROTECTIVE_SELL_V4_RUNTIME_REPLAY_REGRESSION_V1_1_INSTALLED",

  generatedFiles: [
    "supabase/migrations/20261011001400_paper_protective_sell_v4_runtime_replay_regression_v1_1.sql",
    "scripts/paper-protective-sell-v4-runtime-replay-regression-v1-1-structural-proof.ts"
  ],

  diagnosis: {
    priorFailureType:
      "AUDITOR_FALSE_NEGATIVE",
    actualReplayResponseDoesNotExposeExitReason:
      true,
    actualReplayAlreadyClosed:
      true,
    actualReplayReturnedLatestTrade:
      true,
    actualReplayExitPrice:
      11000,
    actualReplayQuantity:
      1
  },

  fix: [
    "remove invalid expectation that V4 replay response contains exitReason",
    "verify latest historical row exit_reason remains TRAILING_STOP",
    "retain whole-row immutability checks for both historical trades",
    "retain latest-trade deterministic resolution assertion",
    "retain zero duplicate trade/order/protective-fill mutation assertions",
    "retain account cash invariant and rollback proof"
  ],

  migration013Modified:
    false,

  productionTradingLogicModified:
    false,

  databaseModifiedDuringInstall:
    false,

  realTradingEnabled:
    false,

  nextAction:
    "RUN_V1_1_STRUCTURAL_PROOF_THEN_DB_PUSH_014_THEN_RERUN_EXISTING_RUNTIME_REPLAY"
}, null, 2));

process.exitCode = 0;
