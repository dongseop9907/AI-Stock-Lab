const fs = require("fs");
const path = require("path");

const root = process.cwd();

const sourceMigrationRel =
  "supabase/migrations/20261008001600_kill_switch_db_create_fill_guards_v1.sql";

const targetMigrationRel =
  "supabase/migrations/20261008001700_data_freshness_db_create_fill_guards_v1.sql";

const staticVerifyRel =
  "scripts/alpha-v3-data-freshness-db-create-fill-guards-v1-static-verify.cjs";

function abs(rel) {
  return path.resolve(root, rel);
}

function read(rel) {
  const file = abs(rel);

  if (!fs.existsSync(file)) {
    throw new Error(`FILE_NOT_FOUND ${rel}`);
  }

  return fs.readFileSync(file, "utf8");
}

function write(rel, text) {
  const file = abs(rel);

  fs.mkdirSync(
    path.dirname(file),
    { recursive: true }
  );

  fs.writeFileSync(
    file,
    text,
    "utf8"
  );
}

function extractFunction(sql, fnName) {
  const re = new RegExp(
    String.raw`create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?${fnName}\s*\(`,
    "i"
  );

  const match = re.exec(sql);

  if (!match) {
    throw new Error(
      `FUNCTION_NOT_FOUND_IN_SOURCE_MIGRATION ${fnName}`
    );
  }

  const start = match.index;
  const after = sql.slice(start);

  const asMatch =
    after.match(/\bas\s+(\$[A-Za-z0-9_]*\$)/i);

  if (!asMatch) {
    throw new Error(
      `FUNCTION_DOLLAR_QUOTE_NOT_FOUND ${fnName}`
    );
  }

  const tag = asMatch[1];

  const bodyStart =
    start +
    asMatch.index +
    asMatch[0].length;

  const close =
    sql.indexOf(
      tag,
      bodyStart
    );

  if (close < 0) {
    throw new Error(
      `FUNCTION_DOLLAR_QUOTE_CLOSE_NOT_FOUND ${fnName}`
    );
  }

  const semicolon =
    sql.indexOf(
      ";",
      close + tag.length
    );

  if (semicolon < 0) {
    throw new Error(
      `FUNCTION_SEMICOLON_NOT_FOUND ${fnName}`
    );
  }

  return sql
    .slice(
      start,
      semicolon + 1
    )
    .trim();
}

function injectFreshnessAssert(
  functionText,
  fnName
) {
  if (
    functionText.includes(
      "assert_paper_buy_data_freshness_allowed_v1"
    )
  ) {
    return functionText;
  }

  const killSwitchCall =
    /perform\s+public\.assert_paper_buy_new_risk_allowed_v1\s*\(\s*\)\s*;/i;

  const match =
    killSwitchCall.exec(
      functionText
    );

  if (!match) {
    throw new Error(
      `KILL_SWITCH_ASSERTION_ANCHOR_NOT_FOUND ${fnName}`
    );
  }

  const insertAt =
    match.index +
    match[0].length;

  return (
    functionText.slice(
      0,
      insertAt
    ) +
    `

  -- Alpha V3 Data Freshness DB Guard V1:
  -- fail closed before any new-risk create/fill work proceeds.
  perform public.assert_paper_buy_data_freshness_allowed_v1();` +
    functionText.slice(
      insertAt
    )
  );
}

const source =
  read(sourceMigrationRel);

const createFn =
  injectFreshnessAssert(
    extractFunction(
      source,
      "create_paper_buy_order_with_committed_risk_v3"
    ),
    "create_paper_buy_order_with_committed_risk_v3"
  );

const fillFn =
  injectFreshnessAssert(
    extractFunction(
      source,
      "execute_paper_buy_order"
    ),
    "execute_paper_buy_order"
  );

const migration = `-- ============================================================================
-- AI Stock Lab
-- Alpha V3 Data Freshness DB Create/Fill Guards V1
-- Migration: 20261008001700
--
-- Purpose
--   Defense-in-depth freshness enforcement at the database boundary.
--
-- Policy
--   PAPER BUY CREATE   => requires canonical FRESH + quality PASS
--   PAPER BUY EXECUTE  => requires canonical FRESH + quality PASS
--   Protective exits   => intentionally untouched
--   Risk maintenance   => intentionally untouched
--
-- Canonical sources
--   public.market_data_freshness_observations
--   public.market_data_quality_gate_observations
--
-- Latest row selection
--   observed_at DESC NULLS LAST,
--   created_at  DESC NULLS LAST
--
-- Fail-closed conditions
--   missing freshness row
--   missing quality-gate row
--   freshness status != FRESH
--   freshness usable_for_shadow_comparison != true
--   business_weekday_lag != 0
--   index_date_aligned != true
--   all_source_dates_aligned != true
--   expected market date missing
--   stock latest date missing
--   expected market date != stock latest date
--   quality status != PASS
--   quality freshness_status != FRESH
--   quality usable_for_forward_shadow != true
--   freshness/quality expected dates missing or mismatched
--
-- production_applied is provenance metadata only and is NOT an allow condition.
-- ============================================================================

create or replace function public.validate_paper_buy_data_freshness_v1(
  p_freshness_status text,
  p_freshness_usable boolean,
  p_expected_market_date date,
  p_stock_latest_date date,
  p_business_weekday_lag integer,
  p_index_date_aligned boolean,
  p_all_source_dates_aligned boolean,
  p_quality_status text,
  p_quality_freshness_status text,
  p_quality_usable boolean,
  p_quality_expected_market_date date
)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_freshness_status text :=
    upper(trim(coalesce(p_freshness_status, '')));

  v_quality_status text :=
    upper(trim(coalesce(p_quality_status, '')));

  v_quality_freshness_status text :=
    upper(trim(coalesce(p_quality_freshness_status, '')));
begin
  if v_freshness_status <> 'FRESH' then
    return jsonb_build_object(
      'allowed', false,
      'reason',
        case
          when v_freshness_status = 'STALE'
            then 'STALE_MARKET_DATA'
          when v_freshness_status = ''
            then 'FRESHNESS_STATE_MISSING'
          else 'UNKNOWN_FRESHNESS_STATE_FAIL_CLOSED'
        end
    );
  end if;

  if
    p_expected_market_date is null
    or p_stock_latest_date is null
    or p_quality_expected_market_date is null
  then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'MARKET_DATE_MISSING'
    );
  end if;

  if
    p_index_date_aligned is distinct from true
    or p_all_source_dates_aligned is distinct from true
    or p_expected_market_date <> p_stock_latest_date
    or p_expected_market_date <> p_quality_expected_market_date
  then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'MARKET_DATE_MISMATCH'
    );
  end if;

  if
    p_business_weekday_lag is null
    or p_business_weekday_lag <> 0
  then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'STALE_MARKET_DATA'
    );
  end if;

  if
    v_quality_status <> 'PASS'
    or v_quality_freshness_status <> 'FRESH'
  then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'QUALITY_GATE_FAILED'
    );
  end if;

  if
    p_freshness_usable is distinct from true
    or p_quality_usable is distinct from true
  then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'FRESHNESS_NOT_USABLE_FOR_PRODUCTION'
    );
  end if;

  return jsonb_build_object(
    'allowed', true,
    'reason', 'FRESH_DATA_NEW_RISK_ALLOWED'
  );
end;
$$;

revoke all on function public.validate_paper_buy_data_freshness_v1(
  text,
  boolean,
  date,
  date,
  integer,
  boolean,
  boolean,
  text,
  text,
  boolean,
  date
) from public;

grant execute on function public.validate_paper_buy_data_freshness_v1(
  text,
  boolean,
  date,
  date,
  integer,
  boolean,
  boolean,
  text,
  text,
  boolean,
  date
) to service_role;

create or replace function public.assert_paper_buy_data_freshness_allowed_v1()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_freshness public.market_data_freshness_observations%rowtype;
  v_quality public.market_data_quality_gate_observations%rowtype;
  v_decision jsonb;
  v_allowed boolean;
  v_reason text;
begin
  select f.*
  into v_freshness
  from public.market_data_freshness_observations f
  order by
    f.observed_at desc nulls last,
    f.created_at desc nulls last
  limit 1;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'DATA_FRESHNESS_NEW_RISK_BLOCKED:FRESHNESS_STATE_MISSING';
  end if;

  select q.*
  into v_quality
  from public.market_data_quality_gate_observations q
  order by
    q.observed_at desc nulls last,
    q.created_at desc nulls last
  limit 1;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'DATA_FRESHNESS_NEW_RISK_BLOCKED:QUALITY_GATE_STATE_MISSING';
  end if;

  v_decision :=
    public.validate_paper_buy_data_freshness_v1(
      v_freshness.status,
      v_freshness.usable_for_shadow_comparison,
      v_freshness.expected_market_date,
      v_freshness.stock_latest_date,
      v_freshness.business_weekday_lag,
      v_freshness.index_date_aligned,
      v_freshness.all_source_dates_aligned,
      v_quality.status,
      v_quality.freshness_status,
      v_quality.usable_for_forward_shadow,
      v_quality.expected_market_date
    );

  v_allowed :=
    coalesce(
      (v_decision ->> 'allowed')::boolean,
      false
    );

  v_reason :=
    coalesce(
      nullif(
        v_decision ->> 'reason',
        ''
      ),
      'UNKNOWN_FRESHNESS_STATE_FAIL_CLOSED'
    );

  if not v_allowed then
    raise exception using
      errcode = 'P0001',
      message =
        'DATA_FRESHNESS_NEW_RISK_BLOCKED:' ||
        v_reason;
  end if;
end;
$$;

revoke all on function public.assert_paper_buy_data_freshness_allowed_v1()
from public;

grant execute on function public.assert_paper_buy_data_freshness_allowed_v1()
to service_role;

-- --------------------------------------------------------------------------
-- Preserve the exact current 01600 RPC bodies and add only the freshness
-- assertion immediately after the existing Kill Switch assertion.
-- --------------------------------------------------------------------------

${createFn}

${fillFn}
`;

write(
  targetMigrationRel,
  migration
);

const staticVerify = `const fs = require("fs");
const path = require("path");

const root = process.cwd();

const rel =
  "${targetMigrationRel}";

const text =
  fs.readFileSync(
    path.resolve(root, rel),
    "utf8"
  );

function functionBlock(name) {
  const re =
    new RegExp(
      "create\\\\s+(?:or\\\\s+replace\\\\s+)?function\\\\s+(?:public\\\\.)?" +
      name +
      "\\\\s*\\\\(",
      "i"
    );

  const match =
    re.exec(text);

  if (!match) {
    return "";
  }

  const start =
    match.index;

  const after =
    text.slice(start);

  const asMatch =
    after.match(
      /\\\\bas\\\\s+(\\\\$[A-Za-z0-9_]*\\\\$)/i
    );

  if (!asMatch) {
    return "";
  }

  const tag =
    asMatch[1];

  const bodyStart =
    start +
    asMatch.index +
    asMatch[0].length;

  const close =
    text.indexOf(
      tag,
      bodyStart
    );

  if (close < 0) {
    return "";
  }

  return text.slice(
    start,
    close + tag.length
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
    freshnessIndex >
      killIndex
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
    !/v_freshness\\.production_applied|v_quality\\.production_applied/.test(
      text
    ),

  createFunctionPresent:
    Boolean(createFn),

  fillFunctionPresent:
    Boolean(fillFn),

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
`;

write(
  staticVerifyRel,
  staticVerify
);

const checks = {
  sourceMigrationFound:
    fs.existsSync(
      abs(sourceMigrationRel)
    ),

  targetMigrationWritten:
    fs.existsSync(
      abs(targetMigrationRel)
    ),

  staticVerifierWritten:
    fs.existsSync(
      abs(staticVerifyRel)
    ),

  createFunctionPatched:
    createFn.includes(
      "assert_paper_buy_data_freshness_allowed_v1"
    ),

  fillFunctionPatched:
    fillFn.includes(
      "assert_paper_buy_data_freshness_allowed_v1"
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
          ? "ALPHA_V3_DATA_FRESHNESS_DB_CREATE_FILL_GUARDS_V1_INSTALLED"
          : "ALPHA_V3_DATA_FRESHNESS_DB_CREATE_FILL_GUARDS_V1_REVIEW",

      sourceMigration:
        sourceMigrationRel,

      generatedFiles: [
        targetMigrationRel,
        staticVerifyRel
      ],

      checks,
      failed,

      migrationDesign: {
        preserveLatest01600RpcBodies:
          true,

        addPureValidator:
          true,

        addCanonicalDbAssertion:
          true,

        assertionPlacement:
          "IMMEDIATELY_AFTER_EXISTING_KILL_SWITCH_ASSERTION",

        protectiveExitChanged:
          false
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

      nextAction:
        failed.length === 0
          ? "RUN_STATIC_VERIFY_BEFORE_DB_PUSH"
          : "REVIEW_INSTALLER_OUTPUT"
    },
    null,
    2
  )
);

if (failed.length > 0) {
  process.exitCode = 2;
}
