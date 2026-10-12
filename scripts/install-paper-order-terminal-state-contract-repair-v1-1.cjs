const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const MIG_DIR = path.join(ROOT, "supabase", "migrations");
const SCRIPT_DIR = path.join(ROOT, "scripts");

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status: "AI_STOCK_LAB_PAPER_ORDER_TERMINAL_STATE_CONTRACT_REPAIR_V1_1_INSTALL_FAILED",
    reason,
    ...extra,
  }, null, 2));
  process.exitCode = 1;
}

if (!fs.existsSync(MIG_DIR)) {
  fail("MIGRATION_DIRECTORY_NOT_FOUND");
  return;
}

fs.mkdirSync(SCRIPT_DIR, { recursive: true });

const sourceMigration =
  path.join(
    MIG_DIR,
    "20261008001300_order_state_machine_audit_guard_v1.sql"
  );

if (!fs.existsSync(sourceMigration)) {
  fail("ORDER_STATE_MACHINE_SOURCE_MIGRATION_NOT_FOUND", {
    expected:
      "supabase/migrations/20261008001300_order_state_machine_audit_guard_v1.sql",
  });
  return;
}

const source =
  fs.readFileSync(sourceMigration, "utf8");

const requiredSourceFacts = {
  validatorFunctionPresent:
    /validate_paper_order_state_transition_v1/i.test(source),

  normalizerPresent:
    /normalize_paper_order_status_v1/i.test(source),

  versionPresent:
    /ALPHA_V3_ORDER_STATE_MACHINE_V1/i.test(source),

  createAllowedPresent:
    /CREATE_ALLOWED/i.test(source),

  transitionAllowedPresent:
    /TRANSITION_ALLOWED/i.test(source),

  terminalGuardPresent:
    /TERMINAL_STATE_CANNOT_TRANSITION/i.test(source),

  riskApprovedPresent:
    /RISK_APPROVED/i.test(source),

  filledPresent:
    /FILLED/i.test(source),

  expiredPresent:
    /EXPIRED/i.test(source),

  cancelledPresent:
    /CANCELLED/i.test(source),
};

const missingSourceFacts =
  Object.entries(requiredSourceFacts)
    .filter(([, ok]) => ok !== true)
    .map(([key]) => key);

if (missingSourceFacts.length > 0) {
  fail("ORDER_STATE_MACHINE_SOURCE_CONTRACT_NOT_RECOGNIZED", {
    requiredSourceFacts,
    missingSourceFacts,
  });
  return;
}

let maxStamp = 20261011002700;

for (const name of fs.readdirSync(MIG_DIR)) {
  if (!/^\d{14}_.*\.sql$/.test(name)) continue;
  const stamp = Number(name.slice(0, 14));
  if (Number.isFinite(stamp)) {
    maxStamp = Math.max(maxStamp, stamp);
  }
}

const stamp =
  Math.max(
    20261011002800,
    maxStamp + 100
  );

const migrationName =
  String(stamp) +
  "_paper_order_terminal_state_contract_repair_v1_1.sql";

const migrationRel =
  "supabase/migrations/" + migrationName;

const migrationPath =
  path.join(MIG_DIR, migrationName);

const sql = `-- AI Stock Lab
-- #5 / PAPER Order Terminal State Contract Repair V1.1
--
-- Explicit replacement of the canonical validator contract.
-- This avoids fragile source-string mutation.
--
-- Preserved contract:
--   CREATE: RISK_APPROVED / RISK_REJECTED / FILLED allowed
--   CREATE CANCELLED blocked
--   RISK_APPROVED -> FILLED allowed
--   RISK_APPROVED -> EXPIRED allowed
--   RISK_APPROVED -> CANCELLED blocked
--   terminal states cannot transition
--   normalized identical state = idempotent no-op
--   CANCELED normalizes to CANCELLED
--   unsupported source states are rejected
--
-- Added contract:
--   RISK_APPROVED -> FAILED allowed
--   FAILED is terminal
--   FAILED retry is idempotent
--
-- DB CHECK alignment:
--   add EXPIRED and FAILED.
--
-- Production BUY/SELL execution RPCs are NOT replaced.

begin;

create or replace function
  public.validate_paper_order_state_transition_v1(
    p_old_status text,
    p_new_status text,
    p_is_insert boolean default false
  )
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old_raw text := p_old_status;
  v_new_raw text := p_new_status;

  v_old text :=
    public.normalize_paper_order_status_v1(
      p_old_status
    );

  v_new text :=
    public.normalize_paper_order_status_v1(
      p_new_status
    );

  v_allowed boolean := false;
  v_reason text := 'TRANSITION_NOT_ALLOWED';
  v_idempotent boolean := false;
begin
  if v_new is null then
    v_allowed := false;
    v_reason := 'NEW_STATUS_REQUIRED';

  elsif p_is_insert then
    if v_new in (
      'RISK_APPROVED',
      'RISK_REJECTED',
      'FILLED'
    ) then
      v_allowed := true;
      v_reason := 'CREATE_ALLOWED';
    else
      v_allowed := false;
      v_reason := 'CREATE_STATUS_NOT_ALLOWED';
    end if;

  elsif v_old is null then
    v_allowed := false;
    v_reason := 'UNSUPPORTED_FROM_STATUS';

  elsif v_old = v_new then
    v_allowed := true;
    v_reason := 'IDEMPOTENT_NOOP';
    v_idempotent := true;

  elsif v_old in (
    'RISK_REJECTED',
    'FILLED',
    'CANCELLED',
    'EXPIRED',
    'FAILED'
  ) then
    v_allowed := false;
    v_reason := 'TERMINAL_STATE_CANNOT_TRANSITION';

  elsif v_old = 'RISK_APPROVED'
    and v_new in (
      'FILLED',
      'EXPIRED',
      'FAILED'
    )
  then
    v_allowed := true;
    v_reason := 'TRANSITION_ALLOWED';

  elsif v_old not in (
    'RISK_APPROVED',
    'RISK_REJECTED',
    'FILLED',
    'CANCELLED',
    'EXPIRED',
    'FAILED'
  ) then
    v_allowed := false;
    v_reason := 'UNSUPPORTED_FROM_STATUS';

  else
    v_allowed := false;
    v_reason := 'TRANSITION_NOT_ALLOWED';
  end if;

  return jsonb_build_object(
    'to',
      v_new,

    'from',
      v_old,

    'newRaw',
      v_new_raw,

    'oldRaw',
      v_old_raw,

    'reason',
      v_reason,

    'allowed',
      v_allowed,

    'version',
      'ALPHA_V3_ORDER_STATE_MACHINE_V1',

    'isInsert',
      coalesce(p_is_insert, false),

    'idempotent',
      v_idempotent
  );
end;
$$;

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
  public.run_paper_order_terminal_state_contract_regression_v1_1()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_case jsonb;

  v_failed_transition jsonb;
  v_failed_retry jsonb;
  v_failed_terminal jsonb;
  v_expired_transition jsonb;
  v_cancelled_transition jsonb;
  v_create_failed jsonb;
  v_create_filled jsonb;
  v_alias_retry jsonb;
  v_unsupported jsonb;

  v_status_constraint text;

  v_all_pass boolean := false;
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
        'AI_STOCK_LAB_PAPER_ORDER_TERMINAL_STATE_CONTRACT_REGRESSION_V1_1_REVIEW',
      'reason',
        'STATUS_CHECK_NOT_FOUND'
    );
  end if;

  v_failed_transition :=
    public.validate_paper_order_state_transition_v1(
      'RISK_APPROVED',
      'FAILED',
      false
    );

  v_failed_retry :=
    public.validate_paper_order_state_transition_v1(
      'FAILED',
      'FAILED',
      false
    );

  v_failed_terminal :=
    public.validate_paper_order_state_transition_v1(
      'FAILED',
      'FILLED',
      false
    );

  v_expired_transition :=
    public.validate_paper_order_state_transition_v1(
      'RISK_APPROVED',
      'EXPIRED',
      false
    );

  v_cancelled_transition :=
    public.validate_paper_order_state_transition_v1(
      'RISK_APPROVED',
      'CANCELLED',
      false
    );

  v_create_failed :=
    public.validate_paper_order_state_transition_v1(
      null,
      'FAILED',
      true
    );

  v_create_filled :=
    public.validate_paper_order_state_transition_v1(
      null,
      'FILLED',
      true
    );

  v_alias_retry :=
    public.validate_paper_order_state_transition_v1(
      'CANCELED',
      'CANCELLED',
      false
    );

  v_unsupported :=
    public.validate_paper_order_state_transition_v1(
      'APPROVED',
      'RISK_APPROVED',
      false
    );

  v_all_pass :=
    coalesce(
      (v_failed_transition ->> 'allowed')::boolean,
      false
    )
    and
    (v_failed_transition ->> 'reason') =
      'TRANSITION_ALLOWED'

    and

    coalesce(
      (v_failed_retry ->> 'allowed')::boolean,
      false
    )
    and
    coalesce(
      (v_failed_retry ->> 'idempotent')::boolean,
      false
    )
    and
    (v_failed_retry ->> 'reason') =
      'IDEMPOTENT_NOOP'

    and

    not coalesce(
      (v_failed_terminal ->> 'allowed')::boolean,
      true
    )
    and
    (v_failed_terminal ->> 'reason') =
      'TERMINAL_STATE_CANNOT_TRANSITION'

    and

    coalesce(
      (v_expired_transition ->> 'allowed')::boolean,
      false
    )
    and
    (v_expired_transition ->> 'reason') =
      'TRANSITION_ALLOWED'

    and

    not coalesce(
      (v_cancelled_transition ->> 'allowed')::boolean,
      true
    )
    and
    (v_cancelled_transition ->> 'reason') =
      'TRANSITION_NOT_ALLOWED'

    and

    not coalesce(
      (v_create_failed ->> 'allowed')::boolean,
      true
    )
    and
    (v_create_failed ->> 'reason') =
      'CREATE_STATUS_NOT_ALLOWED'

    and

    coalesce(
      (v_create_filled ->> 'allowed')::boolean,
      false
    )
    and
    (v_create_filled ->> 'reason') =
      'CREATE_ALLOWED'

    and

    coalesce(
      (v_alias_retry ->> 'allowed')::boolean,
      false
    )
    and
    coalesce(
      (v_alias_retry ->> 'idempotent')::boolean,
      false
    )
    and
    (v_alias_retry ->> 'reason') =
      'IDEMPOTENT_NOOP'

    and

    not coalesce(
      (v_unsupported ->> 'allowed')::boolean,
      true
    )
    and
    (v_unsupported ->> 'reason') =
      'UNSUPPORTED_FROM_STATUS'

    and

    position(
      'FAILED'
      in upper(v_status_constraint)
    ) > 0

    and

    position(
      'EXPIRED'
      in upper(v_status_constraint)
    ) > 0;

  return jsonb_build_object(
    'status',
      case
        when v_all_pass then
          'AI_STOCK_LAB_PAPER_ORDER_TERMINAL_STATE_CONTRACT_REGRESSION_V1_1_PASS'
        else
          'AI_STOCK_LAB_PAPER_ORDER_TERMINAL_STATE_CONTRACT_REGRESSION_V1_1_REVIEW'
      end,

    'classification',
      case
        when v_all_pass then
          'FAILED_AND_EXPIRED_ORDER_STATE_CONTRACT_ALIGNED'
        else
          'ORDER_STATE_CONTRACT_REVIEW_REQUIRED'
      end,

    'statusConstraint',
      v_status_constraint,

    'checks',
      jsonb_build_object(
        'riskApprovedToFailed',
          v_failed_transition,

        'failedRetry',
          v_failed_retry,

        'failedTerminal',
          v_failed_terminal,

        'riskApprovedToExpired',
          v_expired_transition,

        'riskApprovedToCancelled',
          v_cancelled_transition,

        'createFailed',
          v_create_failed,

        'createFilled',
          v_create_filled,

        'canceledAliasRetry',
          v_alias_retry,

        'unsupportedApprovedFrom',
          v_unsupported,

        'dbConstraintAllowsFailed',
          position(
            'FAILED'
            in upper(v_status_constraint)
          ) > 0,

        'dbConstraintAllowsExpired',
          position(
            'EXPIRED'
            in upper(v_status_constraint)
          ) > 0
      ),

    'safety',
      jsonb_build_object(
        'validatorOnly',
          true,
        'paperOrderWrites',
          0,
        'positionWrites',
          0,
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
      'TERMINAL_STATE_CONTRACT_RUNTIME_REVIEW'
  );
end;
$$;

revoke all on function
  public.run_paper_order_terminal_state_contract_regression_v1_1()
from public, anon, authenticated;

grant execute on function
  public.run_paper_order_terminal_state_contract_regression_v1_1()
to service_role;

comment on function
  public.run_paper_order_terminal_state_contract_regression_v1_1()
is
  'Read-only state-contract runtime regression for FAILED/EXPIRED alignment. No paper order or position writes.';

commit;
`;

if (fs.existsSync(migrationPath)) {
  const existing =
    fs.readFileSync(migrationPath, "utf8");

  if (existing !== sql) {
    fail("TARGET_MIGRATION_EXISTS_WITH_DIFFERENT_CONTENT", {
      target: migrationRel,
    });
    return;
  }
} else {
  fs.writeFileSync(
    migrationPath,
    sql,
    "utf8"
  );
}

const verifierPath =
  path.join(
    SCRIPT_DIR,
    "paper-order-terminal-state-contract-repair-v1-1-verify.cjs"
  );

const verifier = String.raw`const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const MIG_DIR =
  path.join(ROOT, "supabase", "migrations");

const matches =
  fs.readdirSync(MIG_DIR)
    .filter((name) =>
      name.endsWith(
        "_paper_order_terminal_state_contract_repair_v1_1.sql"
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

  validatorExplicitlyReplaced:
    /create or replace function\s+public\.validate_paper_order_state_transition_v1/i
      .test(source),

  normalizerUsed:
    /normalize_paper_order_status_v1/i
      .test(source),

  versionPreserved:
    /ALPHA_V3_ORDER_STATE_MACHINE_V1/i
      .test(source),

  createAllowedStatusesPreserved:
    /p_is_insert[\s\S]*?'RISK_APPROVED'[\s\S]*?'RISK_REJECTED'[\s\S]*?'FILLED'[\s\S]*?CREATE_ALLOWED/i
      .test(source),

  failedNotCreateAllowed:
    /CREATE_STATUS_NOT_ALLOWED/i
      .test(source) &&
    /run_paper_order_terminal_state_contract_regression_v1_1/i
      .test(source),

  riskApprovedToFailedAdded:
    /v_old\s*=\s*'RISK_APPROVED'[\s\S]*?v_new\s+in\s*\([\s\S]*?'FAILED'/i
      .test(source),

  failedTerminalAdded:
    /'FAILED'[\s\S]*?TERMINAL_STATE_CANNOT_TRANSITION/i
      .test(source),

  failedIdempotentCovered:
    /'FAILED',[\s\S]*?'FAILED'[\s\S]*?IDEMPOTENT_NOOP/i
      .test(source),

  expiredStillAllowed:
    /'RISK_APPROVED',[\s\S]*?'EXPIRED'[\s\S]*?TRANSITION_ALLOWED/i
      .test(source),

  cancelledStillBlocked:
    /'RISK_APPROVED',[\s\S]*?'CANCELLED'[\s\S]*?TRANSITION_NOT_ALLOWED/i
      .test(source),

  canceledAliasCovered:
    /'CANCELED',[\s\S]*?'CANCELLED'[\s\S]*?IDEMPOTENT_NOOP/i
      .test(source),

  unsupportedFromCovered:
    /'APPROVED',[\s\S]*?'RISK_APPROVED'[\s\S]*?UNSUPPORTED_FROM_STATUS/i
      .test(source),

  failedAddedToDbCheck:
    /paper_order_requests_status_check[\s\S]*?'FAILED'::text/i
      .test(source),

  expiredAddedToDbCheck:
    /paper_order_requests_status_check[\s\S]*?'EXPIRED'::text/i
      .test(source),

  readOnlyRegression:
    /paperOrderWrites'[\s\S]*?0/i
      .test(source) &&
    /positionWrites'[\s\S]*?0/i
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
      ? "AI_STOCK_LAB_PAPER_ORDER_TERMINAL_STATE_CONTRACT_REPAIR_V1_1_VERIFIED"
      : "AI_STOCK_LAB_PAPER_ORDER_TERMINAL_STATE_CONTRACT_REPAIR_V1_1_VERIFY_FAILED",

  migration:
    target
      ? "supabase/migrations/" + target
      : null,

  contract: {
    createAllowed: [
      "RISK_APPROVED",
      "RISK_REJECTED",
      "FILLED"
    ],

    transitionsAllowed: [
      "RISK_APPROVED -> FILLED",
      "RISK_APPROVED -> EXPIRED",
      "RISK_APPROVED -> FAILED"
    ],

    terminal: [
      "RISK_REJECTED",
      "FILLED",
      "CANCELLED",
      "EXPIRED",
      "FAILED"
    ],

    preservedBlocks: [
      "CREATE FAILED",
      "RISK_APPROVED -> CANCELLED"
    ],

    dbCheckAdds: [
      "EXPIRED",
      "FAILED"
    ],
  },

  checks,
  failed,

  safety: {
    sourceOnly: true,
    databaseWrites: 0,
    migrationApplied: false,
    runtimeRegressionWritesOrders: 0,
    runtimeRegressionWritesPositions: 0,
    productionBuySellExecutionFunctionsModified: false,
    shadowFilesModified: false,
    realTradingEnabled: false,
  },

  nextGate:
    failed.length === 0
      ? "SUPABASE_DB_PUSH_DRY_RUN_V1_1"
      : "REVIEW_V1_1_REPAIR",
}, null, 2));

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
`;

fs.writeFileSync(
  verifierPath,
  verifier,
  "utf8"
);

const runnerPath =
  path.join(
    SCRIPT_DIR,
    "paper-order-terminal-state-contract-regression-v1-1-run.cjs"
  );

const runner = String.raw`const fs = require("fs");
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
      "AI_STOCK_LAB_PAPER_ORDER_TERMINAL_STATE_CONTRACT_REGRESSION_V1_1_RUN_FAILED",
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
      "/rest/v1/rpc/run_paper_order_terminal_state_contract_regression_v1_1",
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
        "AI_STOCK_LAB_PAPER_ORDER_TERMINAL_STATE_CONTRACT_REGRESSION_V1_1_PASS"
        ? 0
        : 1;

  } catch (error) {
    console.error(JSON.stringify({
      status:
        "AI_STOCK_LAB_PAPER_ORDER_TERMINAL_STATE_CONTRACT_REGRESSION_V1_1_RUN_FAILED",
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
  runner,
  "utf8"
);

console.log(JSON.stringify({
  status:
    "AI_STOCK_LAB_PAPER_ORDER_TERMINAL_STATE_CONTRACT_REPAIR_V1_1_INSTALLED",

  generatedMigration:
    migrationRel,

  generatedVerifier:
    "scripts/paper-order-terminal-state-contract-repair-v1-1-verify.cjs",

  generatedRunner:
    "scripts/paper-order-terminal-state-contract-regression-v1-1-run.cjs",

  approach:
    "EXPLICIT_CANONICAL_VALIDATOR_REPLACEMENT_NOT_FRAGILE_SOURCE_LIST_PATCHING",

  repair: {
    dbCheckAdds: [
      "EXPIRED",
      "FAILED"
    ],

    stateMachineAdds: [
      "RISK_APPROVED -> FAILED",
      "FAILED terminal",
      "FAILED idempotent retry"
    ],

    preserves: [
      "CREATE RISK_APPROVED/RISK_REJECTED/FILLED",
      "RISK_APPROVED -> FILLED",
      "RISK_APPROVED -> EXPIRED",
      "CREATE FAILED blocked",
      "RISK_APPROVED -> CANCELLED blocked",
      "CANCELED -> CANCELLED alias idempotency",
      "unsupported source status blocking",
      "ALPHA_V3_ORDER_STATE_MACHINE_V1 version"
    ],
  },

  safety: {
    databaseWritesDuringInstall: 0,
    migrationApplied: false,
    runtimeRegressionPaperOrderWrites: 0,
    runtimeRegressionPositionWrites: 0,
    productionBuySellExecutionFunctionsModified: false,
    shadowFilesModified: false,
    realTradingEnabled: false,
  },

  nextAction:
    "VERIFY_AND_SUPABASE_DB_PUSH_DRY_RUN_ONLY",
}, null, 2));
