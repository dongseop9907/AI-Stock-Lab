const fs = require("fs");
const path = require("path");

const root = process.cwd();

const rel =
  "supabase/migrations/20261008001700_data_freshness_db_create_fill_guards_v1.sql";

const text =
  fs.readFileSync(
    path.resolve(root, rel),
    "utf8"
  );

function functionBlock(name) {
  const lower =
    text.toLowerCase();

  const candidates = [
    "create or replace function public." +
      name.toLowerCase() +
      "(",

    "create function public." +
      name.toLowerCase() +
      "("
  ];

  let start = -1;

  for (const candidate of candidates) {
    const index =
      lower.indexOf(candidate);

    if (index >= 0) {
      start = index;
      break;
    }
  }

  if (start < 0) {
    return "";
  }

  const asIndex =
    lower.indexOf(
      "as $$",
      start
    );

  if (asIndex < 0) {
    return "";
  }

  const closeIndex =
    lower.indexOf(
      "$$;",
      asIndex + 5
    );

  if (closeIndex < 0) {
    return "";
  }

  return text.slice(
    start,
    closeIndex + 3
  );
}

const createFn =
  functionBlock(
    "create_paper_buy_order_with_committed_risk_v3"
  );

const fillFn =
  functionBlock(
    "execute_paper_buy_order"
  );

function assertionOrderOk(fn) {
  const killIndex =
    fn.indexOf(
      "assert_paper_buy_new_risk_allowed_v1"
    );

  const freshnessIndex =
    fn.indexOf(
      "assert_paper_buy_data_freshness_allowed_v1"
    );

  return (
    killIndex >= 0 &&
    freshnessIndex > killIndex
  );
}

const checks = {
  migrationVersion:
    text.includes(
      "20261008001700"
    ),

  pureValidatorPresent:
    text.includes(
      "validate_paper_buy_data_freshness_v1"
    ),

  assertFunctionPresent:
    text.includes(
      "assert_paper_buy_data_freshness_allowed_v1"
    ),

  canonicalFreshnessTable:
    text.includes(
      "market_data_freshness_observations"
    ),

  canonicalQualityTable:
    text.includes(
      "market_data_quality_gate_observations"
    ),

  latestObservedAtSelection:
    (
      text.match(
        /observed_at desc nulls last/gi
      ) || []
    ).length >= 2,

  latestCreatedAtTieBreaker:
    (
      text.match(
        /created_at desc nulls last/gi
      ) || []
    ).length >= 2,

  failClosedMissingFreshness:
    text.includes(
      "FRESHNESS_STATE_MISSING"
    ),

  failClosedMissingQuality:
    text.includes(
      "QUALITY_GATE_STATE_MISSING"
    ),

  requiresFresh:
    text.includes(
      "STALE_MARKET_DATA"
    ) &&
    text.includes(
      "UNKNOWN_FRESHNESS_STATE_FAIL_CLOSED"
    ),

  requiresZeroLag:
    text.includes(
      "p_business_weekday_lag <> 0"
    ),

  requiresAlignment:
    text.includes(
      "p_index_date_aligned is distinct from true"
    ) &&
    text.includes(
      "p_all_source_dates_aligned is distinct from true"
    ),

  requiresQualityPass:
    text.includes(
      "v_quality_status <> 'PASS'"
    ),

  requiresBothUsableFlags:
    text.includes(
      "p_freshness_usable is distinct from true"
    ) &&
    text.includes(
      "p_quality_usable is distinct from true"
    ),

  productionAppliedNotUsedAsAllowCondition:
    !/v_freshness\.production_applied|v_quality\.production_applied/.test(
      text
    ),

  createFunctionPresent:
    createFn.length > 0,

  fillFunctionPresent:
    fillFn.length > 0,

  createKeepsKillSwitch:
    createFn.includes(
      "assert_paper_buy_new_risk_allowed_v1"
    ),

  fillKeepsKillSwitch:
    fillFn.includes(
      "assert_paper_buy_new_risk_allowed_v1"
    ),

  createFreshnessAfterKillSwitch:
    assertionOrderOk(
      createFn
    ),

  fillFreshnessAfterKillSwitch:
    assertionOrderOk(
      fillFn
    ),

  createKeepsAdvisoryLock:
    /advisory.*lock|pg_advisory/i.test(
      createFn
    ),

  fillKeepsAdvisoryLock:
    /advisory.*lock|pg_advisory/i.test(
      fillFn
    ),

  createKeepsCommittedRisk:
    /committed.*risk|reserved.*risk|risk_reservation/i.test(
      createFn
    ),

  fillKeepsCommittedRisk:
    /committed.*risk|reserved.*risk|risk_reservation/i.test(
      fillFn
    ),

  protectiveExitUntouched:
    !text.includes(
      "create or replace function public.execute_paper_stop_loss"
    )
};

const failed =
  Object.entries(checks)
    .filter(([, value]) => !value)
    .map(([key]) => key);

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "ALPHA_V3_DATA_FRESHNESS_DB_CREATE_FILL_GUARDS_V1_STATIC_VERIFIED"
          : "ALPHA_V3_DATA_FRESHNESS_DB_CREATE_FILL_GUARDS_V1_STATIC_REVIEW",

      checks,
      failed,

      extractedFunctionLengths: {
        create:
          createFn.length,

        fill:
          fillFn.length
      },

      semantics: {
        create:
          "KILL_SWITCH_ASSERT_THEN_FRESHNESS_ASSERT_THEN_EXISTING_LOGIC",

        fill:
          "KILL_SWITCH_ASSERT_THEN_FRESHNESS_ASSERT_THEN_EXISTING_LOGIC",

        protectiveExit:
          "UNCHANGED",

        riskMaintenance:
          "UNCHANGED",

        missingState:
          "FAIL_CLOSED",

        productionApplied:
          "PROVENANCE_ONLY"
      },

      safety: {
        databaseReads:
          0,

        databaseWrites:
          0,

        migrationApplied:
          false,

        ordersCreated:
          0,

        positionsChanged:
          0
      },

      nextGate:
        failed.length === 0
          ? "APPLY_01700_AND_VERIFY_DB_FRESHNESS_GUARDS_V1"
          : "REVIEW_01700_MIGRATION"
    },
    null,
    2
  )
);

if (failed.length > 0) {
  process.exitCode = 2;
}
