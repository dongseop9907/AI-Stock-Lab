import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const migrationPath = path.join(
  ROOT,
  "supabase",
  "migrations",
  "20261011001500_paper_buy_v5_concurrency_stress_harness_v1.sql",
);

const runnerPath = path.join(
  ROOT,
  "scripts",
  "paper-buy-v5-concurrency-stress-v1.ts",
);

const migration =
  fs.existsSync(migrationPath)
    ? fs.readFileSync(migrationPath, "utf8")
    : "";

const runner =
  fs.existsSync(runnerPath)
    ? fs.readFileSync(runnerPath, "utf8")
    : "";

const m =
  migration
    .replace(/\s+/g, " ")
    .trim();

const r =
  runner
    .replace(/\s+/g, " ")
    .trim();

const checks = {
  migrationExists:
    migration.length > 0,

  runnerExists:
    runner.length > 0,

  fixtureRegistryPresent:
    m.includes(
      "paper_buy_v5_concurrency_fixtures_v1"
    ),

  readinessChecksProductionGuards:
    m.includes(
      "assert_paper_buy_new_risk_allowed_v1()"
    ) &&
    m.includes(
      "assert_paper_buy_data_freshness_allowed_v1()"
    ),

  setupUsesRiskApproved:
    m.includes(
      "'RISK_APPROVED'"
    ),

  setupUsesSafePrices:
    m.includes(
      "v_entry_price numeric(18, 2) := 10000"
    ) &&
    m.includes(
      "v_execution_price numeric(18, 2) := 10000"
    ) &&
    m.includes(
      "v_stop_price numeric(18, 2) := 9700"
    ),

  setupIsPartialFill:
    m.includes(
      "v_approved_quantity integer := 4"
    ) &&
    m.includes(
      "v_fill_quantity integer := 1"
    ),

  setupDoesNotCallV5:
    !migration
      .slice(
        migration.indexOf(
          "create or replace function public.paper_buy_v5_conc_setup_v1()"
        ),
        migration.indexOf(
          "create or replace function public.paper_buy_v5_conc_state_v1("
        )
      )
      .includes(
        "execute_paper_buy_order_with_execution_price_v5("
      ),

  runnerCallsProductionV5Directly:
    r.includes(
      '"execute_paper_buy_order_with_execution_price_v5"'
    ),

  runnerUsesPromiseAll:
    r.includes(
      "Promise.all(calls)"
    ),

  runnerUsesEightConcurrentCalls:
    r.includes(
      "const CONCURRENCY = 8"
    ),

  exactSameEventPayloadShared:
    r.includes(
      "const executionPayload ="
    ) &&
    r.includes(
      "p_execution_observed_at: observedAt"
    ),

  checksOneNewSevenReplay:
    r.includes(
      "newEventResponses === 1"
    ) &&
    r.includes(
      "replayResponses === CONCURRENCY - 1"
    ),

  checksOneLedgerRow:
    r.includes(
      "state?.ledger?.rows === 1"
    ),

  checksFilledOnce:
    r.includes(
      "state?.order?.filledQuantity === 1"
    ) &&
    r.includes(
      "state?.order ?.executionFillCount === 1"
    ),

  checksFeeOnce:
    r.includes(
      "Number( state?.order ?.executionBrokerFee ) === 100"
    ),

  checksPositionOnce:
    r.includes(
      "state?.position?.quantity === 1"
    ) &&
    r.includes(
      "Number( state?.position?.averagePrice ) === 10000"
    ),

  checksFeeBasisOnce:
    r.includes(
      "Number( state?.position ?.entryFeeBasisTotal ) === 100"
    ) &&
    r.includes(
      "Number( state?.position ?.entryFeeBasisRemaining ) === 100"
    ),

  checksCashOnce:
    r.includes(
      "Number( state?.cashDelta ) === -10100"
    ),

  cleanupInFinally:
    r.includes(
      "} finally {"
    ) &&
    r.includes(
      '"paper_buy_v5_conc_cleanup_v1"'
    ),

  cleanupUsesPersistedActualFill:
    m.includes(
      "coalesce(filled_quantity, 0)"
    ) &&
    m.includes(
      "coalesce(execution_broker_fee, 0)"
    ) &&
    m.includes(
      "v_restore_amount"
    ),

  naturalEvidenceExplicitlyFalse:
    m.includes(
      "'naturalEvidence', false"
    ),

  productionV5DefinitionAbsent:
    !m.includes(
      "create or replace function public.execute_paper_buy_order_with_execution_price_v5("
    ),

  noRealTradingEnablement:
    !m.includes(
      "REAL_TRADING_ENABLED=true"
    ) &&
    !m.includes(
      "ENABLE_REAL_TRADING=true"
    ) &&
    !m.includes(
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
      ? "AI_STOCK_LAB_BUY_V5_CONCURRENCY_STRESS_V1_1_STRUCTURAL_PROOF_PASS"
      : "AI_STOCK_LAB_BUY_V5_CONCURRENCY_STRESS_V1_1_STRUCTURAL_PROOF_FAIL",

  classification:
    failed.length === 0
      ? "BUY_V5_FIRST_SEEN_PARALLEL_RACE_HARNESS_STRUCTURALLY_READY"
      : "BUY_V5_CONCURRENCY_HARNESS_REVIEW_REQUIRED",

  checks,
  failed,

  testModel: {
    concurrency:
      8,

    sameOrder:
      true,

    sameSevenV5Arguments:
      true,

    expectedNewEvents:
      1,

    expectedReplays:
      7,

    expectedLedgerRows:
      1,

    expectedFilledQuantity:
      1,

    expectedExecutionFillCount:
      1,

    expectedBrokerFee:
      100,

    expectedPositionQuantity:
      1,

    expectedCashDelta:
      -10100,
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

    productionTradingLogicModified:
      false,

    persistentFixtureDesign:
      "TEMPORARY_TAGGED_PAPER_ONLY_REQUIRED_FOR_CROSS_TRANSACTION_CONCURRENCY",

    naturalEvidence:
      false,

    realTradingEnabled:
      false,
  },

  nextGate:
    failed.length === 0
      ? "DB_PUSH_015_THEN_RUN_BUY_V5_PARALLEL_FIRST_SEEN_STRESS"
      : "STOP_AND_REVIEW",
}, null, 2));

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
