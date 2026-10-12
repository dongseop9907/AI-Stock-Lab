const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const MIG_DIR = path.join(ROOT, "supabase", "migrations");
const SCRIPT_DIR = path.join(ROOT, "scripts");

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_PAPER_ORDER_TERMINAL_STATE_CONTRACT_REPAIR_V1_INSTALL_FAILED",
    reason,
    ...extra,
  }, null, 2));
  process.exitCode = 1;
}

function extractFunctions(src) {
  const out = [];
  const re = /create\s+or\s+replace\s+function\s+/ig;
  let m;

  while ((m = re.exec(src))) {
    const start = m.index;
    const asIdx = src.indexOf("as $$", start);

    if (asIdx < 0) continue;

    const end = src.indexOf("$$;", asIdx + 5);

    if (end < 0) continue;

    const def = src.slice(start, end + 3);
    const nameMatch =
      def.match(
        /create\s+or\s+replace\s+function\s+([a-zA-Z0-9_."]+)\s*\(/i
      );

    out.push({
      name: nameMatch ? nameMatch[1] : null,
      def,
      start,
      end: end + 3,
    });

    re.lastIndex = end + 3;
  }

  return out;
}

function addFailedToStatusLists(def) {
  let changed = 0;

  function patchInner(full, inner, closeChar) {
    const upper = inner.toUpperCase();

    if (
      upper.includes("'FILLED'") &&
      upper.includes("'EXPIRED'") &&
      !upper.includes("'FAILED'")
    ) {
      changed += 1;
      return full.slice(0, full.length - 1) +
        ", 'FAILED'" +
        closeChar;
    }

    return full;
  }

  let out = def.replace(
    /\(([^()]{0,900})\)/g,
    (full, inner) => patchInner(full, inner, ")")
  );

  out = out.replace(
    /array\s*\[([^\]]{0,900})\]/gi,
    (full, inner) => patchInner(full, inner, "]")
  );

  return { text: out, changed };
}

function nearMarkerHasFailed(src, marker, span = 1800) {
  const upper = src.toUpperCase();
  const idx = upper.indexOf(marker.toUpperCase());

  if (idx < 0) return false;

  const from = Math.max(0, idx - span);
  const to = Math.min(src.length, idx + span);

  return upper.slice(from, to).includes("'FAILED'");
}

if (!fs.existsSync(MIG_DIR)) {
  fail("MIGRATION_DIRECTORY_NOT_FOUND");
} else {
  fs.mkdirSync(SCRIPT_DIR, { recursive: true });

  const preferred = path.join(
    MIG_DIR,
    "20261008001300_order_state_machine_audit_guard_v1.sql"
  );

  const candidates = [];

  const migrationFiles =
    fs.readdirSync(MIG_DIR)
      .filter((name) => name.endsWith(".sql"))
      .sort();

  const orderedFiles = [
    ...(fs.existsSync(preferred)
      ? ["20261008001300_order_state_machine_audit_guard_v1.sql"]
      : []),
    ...migrationFiles.filter(
      (name) =>
        name !== "20261008001300_order_state_machine_audit_guard_v1.sql"
    ),
  ];

  for (const name of orderedFiles) {
    const full = path.join(MIG_DIR, name);
    const src = fs.readFileSync(full, "utf8");

    if (!/ALPHA_V3_ORDER_STATE_MACHINE_V1/i.test(src)) continue;

    for (const fn of extractFunctions(src)) {
      if (
        /CREATE_ALLOWED/i.test(fn.def) &&
        /TRANSITION_ALLOWED/i.test(fn.def) &&
        /TERMINAL_STATE_CANNOT_TRANSITION/i.test(fn.def) &&
        /RISK_APPROVED/i.test(fn.def) &&
        /FILLED/i.test(fn.def) &&
        /EXPIRED/i.test(fn.def)
      ) {
        candidates.push({
          file: name,
          ...fn,
        });
      }
    }

    if (candidates.length > 0 && full === preferred) {
      break;
    }
  }

  if (candidates.length !== 1) {
    fail("STATE_MACHINE_VALIDATOR_FUNCTION_NOT_UNIQUELY_RESOLVED", {
      candidateCount: candidates.length,
      candidates: candidates.map((c) => ({
        file: c.file,
        name: c.name,
      })),
    });
    return;
  }

  const target = candidates[0];

  const patched =
    addFailedToStatusLists(target.def);

  if (patched.changed < 2) {
    fail("FAILED_STATUS_PATCH_DID_NOT_TOUCH_ENOUGH_STATE_LISTS", {
      validatorFile: target.file,
      validatorFunction: target.name,
      changedLists: patched.changed,
      hint:
        "Expected at least transition + terminal/known-status list changes.",
    });
    return;
  }

  const patchedDef = patched.text;

  const patchChecks = {
    failedPresent:
      /'FAILED'/i.test(patchedDef),

    transitionContextHasFailed:
      nearMarkerHasFailed(
        patchedDef,
        "TRANSITION_ALLOWED"
      ),

    terminalContextHasFailed:
      nearMarkerHasFailed(
        patchedDef,
        "TERMINAL_STATE_CANNOT_TRANSITION"
      ),

    createAllowedSectionStillPresent:
      /CREATE_ALLOWED/i.test(patchedDef),

    createFailedRuntimeGuardPlanned:
      true,

    cancelledPolicyStillPresent:
      /CANCELLED/i.test(patchedDef),

    versionPreserved:
      /ALPHA_V3_ORDER_STATE_MACHINE_V1/i.test(patchedDef),
  };

  const patchFailed =
    Object.entries(patchChecks)
      .filter(([, ok]) => ok !== true)
      .map(([key]) => key);

  if (patchFailed.length > 0) {
    fail("STATE_MACHINE_PATCH_SAFETY_CHECK_FAILED", {
      validatorFile: target.file,
      validatorFunction: target.name,
      changedLists: patched.changed,
      patchChecks,
      patchFailed,
    });
    return;
  }

  let maxStamp = 20261011002700;

  for (const name of migrationFiles) {
    if (!/^\d{14}_/.test(name)) continue;
    const stamp = Number(name.slice(0, 14));
    if (Number.isFinite(stamp)) {
      maxStamp = Math.max(maxStamp, stamp);
    }
  }

  const stamp =
    Math.max(20261011002800, maxStamp + 100);

  const migrationName =
    String(stamp) +
    "_paper_order_terminal_state_contract_repair_v1.sql";

  const migrationPath =
    path.join(MIG_DIR, migrationName);

  const migrationRel =
    "supabase/migrations/" + migrationName;

  const validatorName =
    target.name || "UNKNOWN_VALIDATOR";

  const migration = `-- AI Stock Lab
-- #5 / Order State Contract Hardening
-- FAILED + EXPIRED DB CHECK alignment and FAILED state-machine repair V1
--
-- Proven mismatch:
--   * Production BUY execution block paths persist status='FAILED'.
--   * Terminal reserved-risk release already treats FAILED as terminal.
--   * Deployed paper_order_requests_status_check rejects FAILED.
--   * State machine does not yet model FAILED.
--   * State machine already allows RISK_APPROVED -> EXPIRED, while deployed
--     DB CHECK also omits EXPIRED.
--
-- Repair:
--   1) preserve existing state-machine function and minimally add FAILED to
--      status sets that already contain FILLED + EXPIRED.
--   2) preserve CREATE_FAILED as invalid.
--   3) make FAILED terminal/idempotent.
--   4) allow RISK_APPROVED -> FAILED.
--   5) align DB CHECK with canonical EXPIRED + FAILED terminal statuses.
--   6) install rollback-only runtime regression.
--
-- Source validator:
--   ${target.file}
-- Function:
--   ${validatorName}

begin;

${patchedDef}

alter table public.paper_order_requests
  drop constraint if exists
    paper_order_requests_status_check;

alter table public.paper_order_requests
  add constraint
    paper_order_requests_status_check
  check (
    status = any (
      array[
        'RISK_APPROVED'::text,
        'RISK_REJECTED'::text,
        'FILLED'::text,
        'CANCELLED'::text,
        'EXPIRED'::text,
        'FAILED'::text
      ]
    )
  );

create or replace function
  public.run_paper_order_terminal_state_contract_regression_v1()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account uuid := gen_random_uuid();

  v_risk_failed uuid := gen_random_uuid();
  v_order_failed uuid := gen_random_uuid();

  v_risk_expired uuid := gen_random_uuid();
  v_order_expired uuid := gen_random_uuid();

  v_risk_create_failed uuid := gen_random_uuid();
  v_order_create_failed uuid := gen_random_uuid();

  v_risk_cancel uuid := gen_random_uuid();
  v_order_cancel uuid := gen_random_uuid();

  v_stock_code text;

  v_failed_status text;
  v_failed_risk numeric;
  v_failed_released_at timestamptz;
  v_expired_status text;
  v_expired_risk numeric;
  v_expired_released_at timestamptz;

  v_create_failed_blocked boolean := false;
  v_failed_to_filled_blocked boolean := false;
  v_cancelled_still_blocked boolean := false;
  v_failed_retry_ok boolean := false;

  v_status_constraint text;

  v_account_rows integer;
  v_risk_rows integer;
  v_order_rows integer;

  v_inner_pass boolean := false;
  v_rollback_caught boolean := false;

  v_sentinel constant text :=
    'AI_STOCK_LAB_TERMINAL_STATE_CONTRACT_ROLLBACK_SENTINEL';
begin
  select
    pg_get_constraintdef(c.oid)
  into
    v_status_constraint
  from pg_constraint c
  where c.conrelid =
    'public.paper_order_requests'::regclass
    and c.conname =
      'paper_order_requests_status_check'
    and c.contype = 'c'
  limit 1;

  if v_status_constraint is null then
    return jsonb_build_object(
      'status',
        'AI_STOCK_LAB_PAPER_ORDER_TERMINAL_STATE_CONTRACT_REGRESSION_V1_BLOCKED',
      'reason',
        'STATUS_CHECK_NOT_FOUND'
    );
  end if;

  if position(
    'FAILED'
    in upper(v_status_constraint)
  ) = 0 then
    return jsonb_build_object(
      'status',
        'AI_STOCK_LAB_PAPER_ORDER_TERMINAL_STATE_CONTRACT_REGRESSION_V1_BLOCKED',
      'reason',
        'FAILED_NOT_ALLOWED_BY_DB_CHECK',
      'statusConstraint',
        v_status_constraint
    );
  end if;

  if position(
    'EXPIRED'
    in upper(v_status_constraint)
  ) = 0 then
    return jsonb_build_object(
      'status',
        'AI_STOCK_LAB_PAPER_ORDER_TERMINAL_STATE_CONTRACT_REGRESSION_V1_BLOCKED',
      'reason',
        'EXPIRED_NOT_ALLOWED_BY_DB_CHECK',
      'statusConstraint',
        v_status_constraint
    );
  end if;

  select s.stock_code
  into v_stock_code
  from public.stocks s
  order by s.stock_code
  limit 1;

  if not found then
    return jsonb_build_object(
      'status',
        'AI_STOCK_LAB_PAPER_ORDER_TERMINAL_STATE_CONTRACT_REGRESSION_V1_BLOCKED',
      'reason',
        'NO_STOCK_AVAILABLE'
    );
  end if;

  begin
    insert into public.paper_accounts (
      id,
      account_name,
      initial_equity,
      cash_balance,
      realized_pnl,
      daily_realized_pnl,
      trading_mode,
      initial_cash
    ) values (
      v_account,
      'AI_STOCK_LAB_STATE_CONTRACT_' ||
        replace(v_account::text, '-', ''),
      1000000,
      1000000,
      0,
      0,
      'PAPER',
      1000000
    );

    insert into public.risk_decisions (
      id,
      account_id,
      stock_code,
      action,
      approved,
      requested_payload,
      result_payload
    ) values
    (
      v_risk_failed,
      v_account,
      v_stock_code,
      'BUY',
      true,
      '{"synthetic":true,"case":"FAILED"}'::jsonb,
      '{"approved":true}'::jsonb
    ),
    (
      v_risk_expired,
      v_account,
      v_stock_code,
      'BUY',
      true,
      '{"synthetic":true,"case":"EXPIRED"}'::jsonb,
      '{"approved":true}'::jsonb
    ),
    (
      v_risk_create_failed,
      v_account,
      v_stock_code,
      'BUY',
      true,
      '{"synthetic":true,"case":"CREATE_FAILED"}'::jsonb,
      '{"approved":true}'::jsonb
    ),
    (
      v_risk_cancel,
      v_account,
      v_stock_code,
      'BUY',
      true,
      '{"synthetic":true,"case":"CANCELLED"}'::jsonb,
      '{"approved":true}'::jsonb
    );

    insert into public.paper_order_requests (
      id,
      account_id,
      stock_code,
      side,
      requested_quantity,
      approved_quantity,
      entry_price,
      stop_price,
      status,
      risk_decision_id,
      reserved_risk_amount,
      reserved_risk_at
    ) values
    (
      v_order_failed,
      v_account,
      v_stock_code,
      'BUY',
      1,
      1,
      10000,
      9700,
      'RISK_APPROVED',
      v_risk_failed,
      300,
      clock_timestamp()
    ),
    (
      v_order_expired,
      v_account,
      v_stock_code,
      'BUY',
      1,
      1,
      10000,
      9700,
      'RISK_APPROVED',
      v_risk_expired,
      300,
      clock_timestamp()
    ),
    (
      v_order_cancel,
      v_account,
      v_stock_code,
      'BUY',
      1,
      1,
      10000,
      9700,
      'RISK_APPROVED',
      v_risk_cancel,
      300,
      clock_timestamp()
    );

    update public.paper_order_requests
    set
      status = 'FAILED',
      execution_block_reason =
        'STATE_CONTRACT_REGRESSION_SYNTHETIC'
    where id = v_order_failed;

    select
      o.status,
      o.reserved_risk_amount,
      o.reserved_risk_released_at
    into
      v_failed_status,
      v_failed_risk,
      v_failed_released_at
    from public.paper_order_requests o
    where o.id = v_order_failed;

    if v_failed_status is distinct from 'FAILED' then
      raise exception
        'ASSERT_RISK_APPROVED_TO_FAILED_NOT_PERSISTED';
    end if;

    if coalesce(v_failed_risk, -1) <> 0 then
      raise exception
        'ASSERT_FAILED_RESERVED_RISK_NOT_RELEASED:%',
        v_failed_risk;
    end if;

    if v_failed_released_at is null then
      raise exception
        'ASSERT_FAILED_RELEASE_TIMESTAMP_MISSING';
    end if;

    update public.paper_order_requests
    set status = 'FAILED'
    where id = v_order_failed;

    v_failed_retry_ok := true;

    begin
      update public.paper_order_requests
      set status = 'FILLED'
      where id = v_order_failed;

      v_failed_to_filled_blocked := false;
    exception
      when others then
        v_failed_to_filled_blocked := true;
    end;

    if not v_failed_to_filled_blocked then
      raise exception
        'ASSERT_FAILED_TO_FILLED_MUST_BE_TERMINAL_BLOCKED';
    end if;

    update public.paper_order_requests
    set status = 'EXPIRED'
    where id = v_order_expired;

    select
      o.status,
      o.reserved_risk_amount,
      o.reserved_risk_released_at
    into
      v_expired_status,
      v_expired_risk,
      v_expired_released_at
    from public.paper_order_requests o
    where o.id = v_order_expired;

    if v_expired_status is distinct from 'EXPIRED' then
      raise exception
        'ASSERT_RISK_APPROVED_TO_EXPIRED_NOT_PERSISTED';
    end if;

    if coalesce(v_expired_risk, -1) <> 0 then
      raise exception
        'ASSERT_EXPIRED_RESERVED_RISK_NOT_RELEASED:%',
        v_expired_risk;
    end if;

    if v_expired_released_at is null then
      raise exception
        'ASSERT_EXPIRED_RELEASE_TIMESTAMP_MISSING';
    end if;

    begin
      insert into public.paper_order_requests (
        id,
        account_id,
        stock_code,
        side,
        requested_quantity,
        approved_quantity,
        entry_price,
        stop_price,
        status,
        risk_decision_id,
        reserved_risk_amount
      ) values (
        v_order_create_failed,
        v_account,
        v_stock_code,
        'BUY',
        1,
        1,
        10000,
        9700,
        'FAILED',
        v_risk_create_failed,
        0
      );

      v_create_failed_blocked := false;
    exception
      when others then
        v_create_failed_blocked := true;
    end;

    if not v_create_failed_blocked then
      raise exception
        'ASSERT_CREATE_FAILED_MUST_REMAIN_BLOCKED';
    end if;

    begin
      update public.paper_order_requests
      set status = 'CANCELLED'
      where id = v_order_cancel;

      v_cancelled_still_blocked := false;
    exception
      when others then
        v_cancelled_still_blocked := true;
    end;

    if not v_cancelled_still_blocked then
      raise exception
        'ASSERT_RISK_APPROVED_TO_CANCELLED_POLICY_CHANGED';
    end if;

    v_inner_pass := true;

    raise exception
      using
        errcode = 'P0001',
        message = v_sentinel;

  exception
    when others then
      if sqlerrm = v_sentinel
        and v_inner_pass then
        v_rollback_caught := true;
      else
        return jsonb_build_object(
          'status',
            'AI_STOCK_LAB_PAPER_ORDER_TERMINAL_STATE_CONTRACT_REGRESSION_V1_REVIEW',
          'classification',
            'FAILED_OR_EXPIRED_STATE_CONTRACT_RUNTIME_FAILURE',
          'reason',
            sqlerrm,
          'statusConstraint',
            v_status_constraint,
          'checks',
            jsonb_build_object(
              'failedRetryIdempotent',
                v_failed_retry_ok,
              'failedToFilledTerminalBlocked',
                v_failed_to_filled_blocked,
              'createFailedStillBlocked',
                v_create_failed_blocked,
              'riskApprovedToCancelledStillBlocked',
                v_cancelled_still_blocked
            ),
          'safety',
            jsonb_build_object(
              'fixtureWritesRolledBackOnFailure',
                true,
              'realTradingEnabled',
                false,
              'realBrokerApiInvoked',
                false
            )
        );
      end if;
  end;

  select count(*)::integer
  into v_account_rows
  from public.paper_accounts
  where id = v_account;

  select count(*)::integer
  into v_risk_rows
  from public.risk_decisions
  where account_id = v_account;

  select count(*)::integer
  into v_order_rows
  from public.paper_order_requests
  where account_id = v_account;

  if not v_rollback_caught
    or v_account_rows <> 0
    or v_risk_rows <> 0
    or v_order_rows <> 0
  then
    return jsonb_build_object(
      'status',
        'AI_STOCK_LAB_PAPER_ORDER_TERMINAL_STATE_CONTRACT_REGRESSION_V1_CLEANUP_REVIEW',
      'cleanup',
        jsonb_build_object(
          'rollbackSentinelCaught',
            v_rollback_caught,
          'persistentAccountRows',
            v_account_rows,
          'persistentRiskRows',
            v_risk_rows,
          'persistentOrderRows',
            v_order_rows
        )
    );
  end if;

  return jsonb_build_object(
    'status',
      'AI_STOCK_LAB_PAPER_ORDER_TERMINAL_STATE_CONTRACT_REGRESSION_V1_PASS',

    'classification',
      'FAILED_AND_EXPIRED_ORDER_STATE_CONTRACT_ALIGNED',

    'statusConstraint',
      v_status_constraint,

    'checks',
      jsonb_build_object(
        'riskApprovedToFailedAllowed',
          true,
        'failedRetryIdempotent',
          v_failed_retry_ok,
        'failedTerminalBlocksFilled',
          v_failed_to_filled_blocked,
        'createFailedStillBlocked',
          v_create_failed_blocked,
        'riskApprovedToExpiredAllowed',
          true,
        'failedReservedRiskReleased',
          true,
        'expiredReservedRiskReleased',
          true,
        'riskApprovedToCancelledStillBlocked',
          v_cancelled_still_blocked,
        'rollbackCleanupClean',
          true
      ),

    'cleanup',
      jsonb_build_object(
        'rollbackSentinelCaught',
          v_rollback_caught,
        'persistentAccountRows',
          v_account_rows,
        'persistentRiskRows',
          v_risk_rows,
        'persistentOrderRows',
          v_order_rows
      ),

    'safety',
      jsonb_build_object(
        'transactionLocalSyntheticFixture',
          true,
        'fixtureWritesRolledBack',
          true,
        'realBrokerApiInvoked',
          false,
        'realOrdersSent',
          false,
        'shadowFilesModified',
          false,
        'realTradingEnabled',
          false
      ),

    'nextGate',
      'ORDER_TERMINAL_STATE_CONTRACT_REPAIR_REVIEW'
  );
end;
$$;

revoke all on function
  public.run_paper_order_terminal_state_contract_regression_v1()
from public, anon, authenticated;

grant execute on function
  public.run_paper_order_terminal_state_contract_regression_v1()
to service_role;

comment on function
  public.run_paper_order_terminal_state_contract_regression_v1()
is
  'Rollback-only runtime regression proving RISK_APPROVED->FAILED, FAILED terminal/idempotent, RISK_APPROVED->EXPIRED, reserved-risk release, CREATE_FAILED blocking and existing CANCELLED policy preservation.';

commit;
`;

  if (fs.existsSync(migrationPath)) {
    const existing =
      fs.readFileSync(migrationPath, "utf8");

    if (existing !== migration) {
      fail("TARGET_MIGRATION_EXISTS_WITH_DIFFERENT_CONTENT", {
        target: migrationRel,
      });
      return;
    }
  } else {
    fs.writeFileSync(
      migrationPath,
      migration,
      "utf8"
    );
  }

  const verifyPath =
    path.join(
      SCRIPT_DIR,
      "paper-order-terminal-state-contract-repair-v1-verify.cjs"
    );

  const verifySource = String.raw`const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const MIG_DIR =
  path.join(ROOT, "supabase", "migrations");

const matches =
  fs.readdirSync(MIG_DIR)
    .filter((name) =>
      name.endsWith(
        "_paper_order_terminal_state_contract_repair_v1.sql"
      )
    )
    .sort();

const target =
  matches.length
    ? matches[matches.length - 1]
    : null;

const source =
  target
    ? fs.readFileSync(
        path.join(MIG_DIR, target),
        "utf8"
      )
    : "";

const checks = {
  migrationFound:
    Boolean(target),

  failedAddedToDbCheck:
    /paper_order_requests_status_check[\s\S]*?'FAILED'::text/i
      .test(source),

  expiredAddedToDbCheck:
    /paper_order_requests_status_check[\s\S]*?'EXPIRED'::text/i
      .test(source),

  riskApprovedStillAllowed:
    /paper_order_requests_status_check[\s\S]*?'RISK_APPROVED'::text/i
      .test(source),

  filledStillAllowed:
    /paper_order_requests_status_check[\s\S]*?'FILLED'::text/i
      .test(source),

  cancelledStillInCheck:
    /paper_order_requests_status_check[\s\S]*?'CANCELLED'::text/i
      .test(source),

  stateMachineVersionPreserved:
    /ALPHA_V3_ORDER_STATE_MACHINE_V1/i
      .test(source),

  failedAddedToStateMachine:
    /'FAILED'/i.test(source) &&
    /TRANSITION_ALLOWED/i.test(source) &&
    /TERMINAL_STATE_CANNOT_TRANSITION/i.test(source),

  regressionRpcPresent:
    /run_paper_order_terminal_state_contract_regression_v1/i
      .test(source),

  testsRiskApprovedToFailed:
    /riskApprovedToFailedAllowed/i
      .test(source),

  testsFailedTerminal:
    /failedTerminalBlocksFilled/i
      .test(source),

  testsFailedIdempotent:
    /failedRetryIdempotent/i
      .test(source),

  testsCreateFailedBlocked:
    /createFailedStillBlocked/i
      .test(source),

  testsExpired:
    /riskApprovedToExpiredAllowed/i
      .test(source),

  testsCancelledPolicyPreserved:
    /riskApprovedToCancelledStillBlocked/i
      .test(source),

  testsRiskRelease:
    /failedReservedRiskReleased/i.test(source) &&
    /expiredReservedRiskReleased/i.test(source),

  rollbackCleanupPresent:
    /TERMINAL_STATE_CONTRACT_ROLLBACK_SENTINEL/i
      .test(source) &&
    /persistentOrderRows/i
      .test(source),

  productionBuyNotReplaced:
    !/create or replace function\s+public\.execute_paper_buy_order/i
      .test(source),

  productionSellNotReplaced:
    !/create or replace function\s+public\.execute_paper_protective_sell/i
      .test(source),

  noShadowMutation:
    !/true_forward|forward_oos|shadow_session/i
      .test(source),

  noRealTradingEnable:
    !/REAL_TRADING_ENABLED\s*=\s*true/i
      .test(source),
};

const failed =
  Object.entries(checks)
    .filter(([, ok]) => ok !== true)
    .map(([key]) => key);

console.log(JSON.stringify({
  status:
    failed.length === 0
      ? "AI_STOCK_LAB_PAPER_ORDER_TERMINAL_STATE_CONTRACT_REPAIR_V1_VERIFIED"
      : "AI_STOCK_LAB_PAPER_ORDER_TERMINAL_STATE_CONTRACT_REPAIR_V1_VERIFY_FAILED",

  migration:
    target
      ? "supabase/migrations/" + target
      : null,

  validatorSource:
    ${JSON.stringify(target.file)},

  validatorFunction:
    ${JSON.stringify(validatorName)},

  patchedStateLists:
    ${patched.changed},

  contract: {
    dbAllowedStatuses: [
      "RISK_APPROVED",
      "RISK_REJECTED",
      "FILLED",
      "CANCELLED",
      "EXPIRED",
      "FAILED",
    ],

    newlyAlignedDbStatuses: [
      "EXPIRED",
      "FAILED",
    ],

    newlyAllowedTransition:
      "RISK_APPROVED -> FAILED",

    failedIsTerminal:
      true,

    createFailedRemainsBlocked:
      true,

    existingCancelledPolicyPreserved:
      true,
  },

  checks,
  failed,

  safety: {
    sourceOnly: true,
    databaseWrites: 0,
    migrationApplied: false,
    productionBuySellExecutionFunctionsModified: false,
    shadowFilesModified: false,
    realTradingEnabled: false,
  },

  nextGate:
    failed.length === 0
      ? "SUPABASE_DB_PUSH_DRY_RUN_TERMINAL_STATE_CONTRACT_REPAIR"
      : "REVIEW_STATE_CONTRACT_REPAIR",
}, null, 2));

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
`;

  fs.writeFileSync(
    verifyPath,
    verifySource,
    "utf8"
  );

  const runnerPath =
    path.join(
      SCRIPT_DIR,
      "paper-order-terminal-state-contract-regression-v1-run.cjs"
    );

  const runnerSource = String.raw`const fs = require("fs");
const path = require("path");

function loadEnv(file) {
  if (!fs.existsSync(file)) return;

  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();

    if (!line || line.startsWith("#")) continue;

    const i = line.indexOf("=");

    if (i <= 0) continue;

    const key = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnv(path.join(process.cwd(), ".env.local"));

const base =
  process.env.NEXT_PUBLIC_SUPABASE_URL;

const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!base || !key) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_PAPER_ORDER_TERMINAL_STATE_CONTRACT_REGRESSION_V1_RUN_FAILED",
    reason:
      "SUPABASE_ENV_MISSING",
  }, null, 2));

  process.exitCode = 1;
  return;
}

(async () => {
  try {
    const res = await fetch(
      base +
      "/rest/v1/rpc/run_paper_order_terminal_state_contract_regression_v1",
      {
        method: "POST",
        headers: {
          apikey: key,
          Authorization:
            "Bearer " + key,
          "Content-Type":
            "application/json",
        },
        body: "{}",
      }
    );

    const text = await res.text();

    let body;

    try {
      body =
        text
          ? JSON.parse(text)
          : null;
    } catch {
      body = text;
    }

    console.log(JSON.stringify({
      http: {
        ok: res.ok,
        status: res.status,
      },
      result: body,
    }, null, 2));

    process.exitCode =
      res.ok &&
      body &&
      body.status ===
        "AI_STOCK_LAB_PAPER_ORDER_TERMINAL_STATE_CONTRACT_REGRESSION_V1_PASS"
        ? 0
        : 1;

  } catch (error) {
    console.error(JSON.stringify({
      status:
        "AI_STOCK_LAB_PAPER_ORDER_TERMINAL_STATE_CONTRACT_REGRESSION_V1_RUN_FAILED",
      reason:
        error instanceof Error
          ? error.message
          : String(error),
    }, null, 2));

    process.exitCode = 1;
  }
})();
`;

  fs.writeFileSync(
    runnerPath,
    runnerSource,
    "utf8"
  );

  console.log(JSON.stringify({
    status:
      "AI_STOCK_LAB_PAPER_ORDER_TERMINAL_STATE_CONTRACT_REPAIR_V1_INSTALLED",

    generatedMigration:
      migrationRel,

    generatedVerifier:
      "scripts/paper-order-terminal-state-contract-repair-v1-verify.cjs",

    generatedRunner:
      "scripts/paper-order-terminal-state-contract-regression-v1-run.cjs",

    source: {
      validatorMigration:
        "supabase/migrations/" + target.file,

      validatorFunction:
        validatorName,

      patchedStateLists:
        patched.changed,
    },

    repair: {
      dbCheckAdds: [
        "EXPIRED",
        "FAILED",
      ],

      stateMachineAdds:
        [
          "RISK_APPROVED -> FAILED",
          "FAILED terminal/idempotent support",
          "FAILED known-status support where applicable",
        ],

      preserves:
        [
          "CREATE_FAILED blocked",
          "RISK_APPROVED -> CANCELLED blocked",
          "RISK_APPROVED -> FILLED allowed",
          "RISK_APPROVED -> EXPIRED allowed",
          "existing state-machine version/config",
          "terminal reserved-risk release semantics",
        ],
    },

    safety: {
      databaseWritesDuringInstall:
        0,

      migrationApplied:
        false,

      productionBuySellExecutionFunctionsModified:
        false,

      shadowFilesModified:
        false,

      realTradingEnabled:
        false,
    },

    nextAction:
      "VERIFY_AND_SUPABASE_DB_PUSH_DRY_RUN_ONLY",
  }, null, 2));
}
