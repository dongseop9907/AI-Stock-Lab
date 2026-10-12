const fs = require("fs");
const path = require("path");
const { spawnSync } = require("node:child_process");
const crypto = require("crypto");

const root = process.cwd();

const cli = path.resolve(
  root,
  "node_modules/.bin/supabase.cmd"
);

const addMigrationName =
  "20261008000500_committed_risk_transfer_test_harness.sql";

const cleanupMigrationName =
  "20261008000600_committed_risk_transfer_test_harness_cleanup.sql";

const addMigrationPath = path.resolve(
  root,
  "supabase/migrations",
  addMigrationName
);

const cleanupMigrationPath = path.resolve(
  root,
  "supabase/migrations",
  cleanupMigrationName
);

const reportFile = path.resolve(
  root,
  "logs/alpha-v3-isolated-reservation-to-fill-transfer-test.json"
);

const reserveRpc =
  "committed_risk_transfer_test_reserve_v1";

const fillRpc =
  "committed_risk_transfer_test_fill_v1";

const summaryRpc =
  "committed_risk_transfer_test_summary_v1";

const resetRpc =
  "committed_risk_transfer_test_reset_v1";

function quoteCmdArg(value) {
  const text = String(value);

  if (/^[A-Za-z0-9_./:\\=-]+$/.test(text)) {
    return text;
  }

  return `"${text.replace(/"/g, '""')}"`;
}

function runCli(args, timeout = 240000) {
  if (!fs.existsSync(cli)) {
    throw new Error("LOCAL_SUPABASE_CLI_NOT_FOUND");
  }

  const comspec =
    process.env.ComSpec ||
    process.env.COMSPEC ||
    "C:\\Windows\\System32\\cmd.exe";

  const command = [
    quoteCmdArg(cli),
    ...args.map(quoteCmdArg),
  ].join(" ");

  return spawnSync(
    comspec,
    ["/d", "/s", "/c", command],
    {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      env: process.env,
      timeout,
      maxBuffer: 50 * 1024 * 1024,
    }
  );
}

function tail(value, count = 35) {
  return String(value ?? "")
    .split(/\r?\n/)
    .slice(-count)
    .join("\n")
    .trim();
}

function extractPendingSqlFiles(text) {
  const lines = String(text ?? "")
    .replace(/\x1b\[[0-9;]*m/g, "")
    .split(/\r?\n/);

  let inWouldPush = false;
  const files = [];

  for (const raw of lines) {
    const line = raw.trim();

    if (/Would push these migrations:/i.test(line)) {
      inWouldPush = true;
      continue;
    }

    if (/Remote database is up to date/i.test(line)) {
      inWouldPush = false;
      continue;
    }

    if (!inWouldPush) {
      continue;
    }

    const match = line.match(
      /([0-9]{3,14}_[A-Za-z0-9_.-]+\.sql)\s*$/
    );

    if (match) {
      files.push(match[1]);
    }
  }

  return [...new Set(files)].sort();
}

function parseEnvFile(rel) {
  const file = path.resolve(root, rel);
  const result = {};

  if (!fs.existsSync(file)) {
    return result;
  }

  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();

    if (
      !line ||
      line.startsWith("#") ||
      !line.includes("=")
    ) {
      continue;
    }

    const idx = line.indexOf("=");
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

const env = {
  ...parseEnvFile(".env"),
  ...parseEnvFile(".env.local"),
};

const supabaseUrl =
  env.NEXT_PUBLIC_SUPABASE_URL ||
  env.SUPABASE_URL;

const serviceRoleKey =
  env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    "SUPABASE_URL_OR_SERVICE_ROLE_KEY_MISSING"
  );
}

function randomUuid() {
  return crypto.randomUUID();
}

async function rpc(name, body) {
  const response = await fetch(
    `${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/${name}`,
    {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  const text = await response.text();

  let parsed = null;

  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  if (!response.ok) {
    const error = new Error(
      `RPC_FAILED:${name}:${response.status}`
    );

    error.details = parsed;
    throw error;
  }

  return parsed;
}

async function reserve({
  runId,
  accountKey,
  requestId,
  equity = 10_000_000,
  proposedRisk,
  rate = 0.02,
  holdMs = 0,
}) {
  const started = Date.now();

  const result = await rpc(
    reserveRpc,
    {
      p_run_id: runId,
      p_account_key: accountKey,
      p_request_id: requestId,
      p_equity: equity,
      p_proposed_risk: proposedRisk,
      p_budget_rate: rate,
      p_hold_ms: holdMs,
    }
  );

  return {
    ...result,
    clientDurationMs: Date.now() - started,
  };
}

async function fill({
  runId,
  accountKey,
  requestId,
  positionKey,
  positionRisk,
  holdMs = 0,
}) {
  const started = Date.now();

  const result = await rpc(
    fillRpc,
    {
      p_run_id: runId,
      p_account_key: accountKey,
      p_request_id: requestId,
      p_position_key: positionKey,
      p_position_risk: positionRisk,
      p_hold_ms: holdMs,
    }
  );

  return {
    ...result,
    clientDurationMs: Date.now() - started,
  };
}

async function summary(runId, accountKey) {
  return rpc(
    summaryRpc,
    {
      p_run_id: runId,
      p_account_key: accountKey,
    }
  );
}

async function resetRun(runId) {
  return rpc(
    resetRpc,
    {
      p_run_id: runId,
    }
  );
}

const addMigration = String.raw`
create schema if not exists ai_stock_lab_transfer_test;

revoke all on schema ai_stock_lab_transfer_test from public;
revoke all on schema ai_stock_lab_transfer_test from anon;
revoke all on schema ai_stock_lab_transfer_test from authenticated;

create table if not exists ai_stock_lab_transfer_test.reservations (
  run_id uuid not null,
  account_key uuid not null,
  request_id uuid not null,
  proposed_risk numeric not null,
  reserved_risk numeric not null default 0,
  approved boolean not null,
  filled boolean not null default false,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (run_id, request_id)
);

create index if not exists committed_risk_transfer_test_reservation_account_idx
on ai_stock_lab_transfer_test.reservations(run_id, account_key);

create table if not exists ai_stock_lab_transfer_test.positions (
  run_id uuid not null,
  account_key uuid not null,
  position_key uuid not null,
  stop_risk numeric not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (run_id, position_key)
);

create index if not exists committed_risk_transfer_test_position_account_idx
on ai_stock_lab_transfer_test.positions(run_id, account_key);

create or replace function public.committed_risk_transfer_test_reserve_v1(
  p_run_id uuid,
  p_account_key uuid,
  p_request_id uuid,
  p_equity numeric,
  p_proposed_risk numeric,
  p_budget_rate numeric default 0.02,
  p_hold_ms integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, ai_stock_lab_transfer_test, pg_temp
as $$
declare
  v_existing ai_stock_lab_transfer_test.reservations%rowtype;
  v_budget numeric;
  v_reserved numeric;
  v_position numeric;
  v_before numeric;
  v_after numeric;
  v_approved boolean;
begin
  if p_run_id is null
     or p_account_key is null
     or p_request_id is null then
    raise exception 'TEST_IDENTIFIERS_REQUIRED';
  end if;

  if p_equity is null
     or p_equity <= 0 then
    raise exception 'TEST_EQUITY_MUST_BE_POSITIVE';
  end if;

  if p_proposed_risk is null
     or p_proposed_risk <= 0 then
    raise exception 'TEST_PROPOSED_RISK_MUST_BE_POSITIVE';
  end if;

  if p_budget_rate is null
     or p_budget_rate <= 0
     or p_budget_rate > 1 then
    raise exception 'TEST_BUDGET_RATE_INVALID';
  end if;

  if p_hold_ms is null
     or p_hold_ms < 0
     or p_hold_ms > 1000 then
    raise exception 'TEST_HOLD_MS_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(
      'AI_STOCK_LAB_COMMITTED_RISK_V3:' ||
      p_account_key::text
    )
  );

  select *
  into v_existing
  from ai_stock_lab_transfer_test.reservations
  where run_id = p_run_id
    and request_id = p_request_id
  limit 1;

  if found then
    return pg_catalog.jsonb_build_object(
      'idempotent', true,
      'approved', v_existing.approved,
      'requestId', v_existing.request_id,
      'reservedRisk', v_existing.reserved_risk,
      'filled', v_existing.filled
    );
  end if;

  if p_hold_ms > 0 then
    perform pg_catalog.pg_sleep(
      p_hold_ms::numeric / 1000.0
    );
  end if;

  v_budget := p_equity * p_budget_rate;

  select coalesce(sum(reserved_risk), 0)
  into v_reserved
  from ai_stock_lab_transfer_test.reservations
  where run_id = p_run_id
    and account_key = p_account_key
    and approved = true
    and filled = false
    and released_at is null;

  select coalesce(sum(stop_risk), 0)
  into v_position
  from ai_stock_lab_transfer_test.positions
  where run_id = p_run_id
    and account_key = p_account_key;

  v_before := v_reserved + v_position;

  v_approved :=
    v_before + p_proposed_risk <= v_budget;

  v_after :=
    v_before +
    case
      when v_approved
        then p_proposed_risk
      else 0
    end;

  insert into ai_stock_lab_transfer_test.reservations (
    run_id,
    account_key,
    request_id,
    proposed_risk,
    reserved_risk,
    approved,
    filled,
    released_at
  )
  values (
    p_run_id,
    p_account_key,
    p_request_id,
    p_proposed_risk,
    case
      when v_approved
        then p_proposed_risk
      else 0
    end,
    v_approved,
    false,
    case
      when v_approved
        then null
      else now()
    end
  );

  return pg_catalog.jsonb_build_object(
    'idempotent', false,
    'approved', v_approved,
    'requestId', p_request_id,
    'reservedRisk',
      case
        when v_approved
          then p_proposed_risk
        else 0
      end,
    'positionRisk', v_position,
    'committedRiskBefore', v_before,
    'committedRiskAfter', v_after,
    'budget', v_budget
  );
end;
$$;

create or replace function public.committed_risk_transfer_test_fill_v1(
  p_run_id uuid,
  p_account_key uuid,
  p_request_id uuid,
  p_position_key uuid,
  p_position_risk numeric,
  p_hold_ms integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, ai_stock_lab_transfer_test, pg_temp
as $$
declare
  v_reservation ai_stock_lab_transfer_test.reservations%rowtype;
  v_before_reserved numeric;
  v_before_position numeric;
  v_after_reserved numeric;
  v_after_position numeric;
begin
  if p_run_id is null
     or p_account_key is null
     or p_request_id is null
     or p_position_key is null then
    raise exception 'TEST_IDENTIFIERS_REQUIRED';
  end if;

  if p_position_risk is null
     or p_position_risk < 0 then
    raise exception 'TEST_POSITION_RISK_INVALID';
  end if;

  if p_hold_ms is null
     or p_hold_ms < 0
     or p_hold_ms > 1000 then
    raise exception 'TEST_HOLD_MS_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(
      'AI_STOCK_LAB_COMMITTED_RISK_V3:' ||
      p_account_key::text
    )
  );

  select *
  into v_reservation
  from ai_stock_lab_transfer_test.reservations
  where run_id = p_run_id
    and account_key = p_account_key
    and request_id = p_request_id
  for update;

  if not found then
    raise exception 'TEST_RESERVATION_NOT_FOUND';
  end if;

  if not v_reservation.approved then
    raise exception 'TEST_RESERVATION_NOT_APPROVED';
  end if;

  if v_reservation.filled then
    return pg_catalog.jsonb_build_object(
      'idempotent', true,
      'requestId', p_request_id,
      'positionKey', p_position_key
    );
  end if;

  select coalesce(sum(reserved_risk), 0)
  into v_before_reserved
  from ai_stock_lab_transfer_test.reservations
  where run_id = p_run_id
    and account_key = p_account_key
    and approved = true
    and filled = false
    and released_at is null;

  select coalesce(sum(stop_risk), 0)
  into v_before_position
  from ai_stock_lab_transfer_test.positions
  where run_id = p_run_id
    and account_key = p_account_key;

  if p_hold_ms > 0 then
    perform pg_catalog.pg_sleep(
      p_hold_ms::numeric / 1000.0
    );
  end if;

  insert into ai_stock_lab_transfer_test.positions (
    run_id,
    account_key,
    position_key,
    stop_risk,
    created_at,
    updated_at
  )
  values (
    p_run_id,
    p_account_key,
    p_position_key,
    p_position_risk,
    now(),
    now()
  )
  on conflict (run_id, position_key)
  do update set
    stop_risk = excluded.stop_risk,
    updated_at = now();

  update ai_stock_lab_transfer_test.reservations
  set
    filled = true,
    reserved_risk = 0,
    released_at = now()
  where run_id = p_run_id
    and request_id = p_request_id;

  select coalesce(sum(reserved_risk), 0)
  into v_after_reserved
  from ai_stock_lab_transfer_test.reservations
  where run_id = p_run_id
    and account_key = p_account_key
    and approved = true
    and filled = false
    and released_at is null;

  select coalesce(sum(stop_risk), 0)
  into v_after_position
  from ai_stock_lab_transfer_test.positions
  where run_id = p_run_id
    and account_key = p_account_key;

  return pg_catalog.jsonb_build_object(
    'idempotent', false,
    'requestId', p_request_id,
    'positionKey', p_position_key,
    'reservationRiskBefore', v_reservation.reserved_risk,
    'positionRiskApplied', p_position_risk,
    'committedRiskBefore',
      v_before_reserved + v_before_position,
    'committedRiskAfter',
      v_after_reserved + v_after_position,
    'reservedRiskAfter', v_after_reserved,
    'positionRiskAfter', v_after_position
  );
end;
$$;

create or replace function public.committed_risk_transfer_test_summary_v1(
  p_run_id uuid,
  p_account_key uuid
)
returns jsonb
language sql
security definer
set search_path = pg_catalog, ai_stock_lab_transfer_test, pg_temp
as $$
  with r as (
    select
      count(*) filter (
        where approved = true
          and filled = false
          and released_at is null
      ) as active_reservation_count,
      coalesce(
        sum(reserved_risk) filter (
          where approved = true
            and filled = false
            and released_at is null
        ),
        0
      ) as reserved_risk
    from ai_stock_lab_transfer_test.reservations
    where run_id = p_run_id
      and account_key = p_account_key
  ),
  p as (
    select
      count(*) as position_count,
      coalesce(sum(stop_risk), 0) as position_risk
    from ai_stock_lab_transfer_test.positions
    where run_id = p_run_id
      and account_key = p_account_key
  )
  select pg_catalog.jsonb_build_object(
    'activeReservationCount', r.active_reservation_count,
    'reservedRisk', r.reserved_risk,
    'positionCount', p.position_count,
    'positionRisk', p.position_risk,
    'committedRisk', r.reserved_risk + p.position_risk
  )
  from r, p;
$$;

create or replace function public.committed_risk_transfer_test_reset_v1(
  p_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, ai_stock_lab_transfer_test, pg_temp
as $$
declare
  v_reservations integer;
  v_positions integer;
begin
  delete from ai_stock_lab_transfer_test.positions
  where run_id = p_run_id;

  get diagnostics v_positions = row_count;

  delete from ai_stock_lab_transfer_test.reservations
  where run_id = p_run_id;

  get diagnostics v_reservations = row_count;

  return pg_catalog.jsonb_build_object(
    'reservationsDeleted', v_reservations,
    'positionsDeleted', v_positions
  );
end;
$$;

revoke all on function public.committed_risk_transfer_test_reserve_v1(
  uuid, uuid, uuid, numeric, numeric, numeric, integer
) from public;
revoke all on function public.committed_risk_transfer_test_reserve_v1(
  uuid, uuid, uuid, numeric, numeric, numeric, integer
) from anon;
revoke all on function public.committed_risk_transfer_test_reserve_v1(
  uuid, uuid, uuid, numeric, numeric, numeric, integer
) from authenticated;
grant execute on function public.committed_risk_transfer_test_reserve_v1(
  uuid, uuid, uuid, numeric, numeric, numeric, integer
) to service_role;

revoke all on function public.committed_risk_transfer_test_fill_v1(
  uuid, uuid, uuid, uuid, numeric, integer
) from public;
revoke all on function public.committed_risk_transfer_test_fill_v1(
  uuid, uuid, uuid, uuid, numeric, integer
) from anon;
revoke all on function public.committed_risk_transfer_test_fill_v1(
  uuid, uuid, uuid, uuid, numeric, integer
) from authenticated;
grant execute on function public.committed_risk_transfer_test_fill_v1(
  uuid, uuid, uuid, uuid, numeric, integer
) to service_role;

revoke all on function public.committed_risk_transfer_test_summary_v1(
  uuid, uuid
) from public;
revoke all on function public.committed_risk_transfer_test_summary_v1(
  uuid, uuid
) from anon;
revoke all on function public.committed_risk_transfer_test_summary_v1(
  uuid, uuid
) from authenticated;
grant execute on function public.committed_risk_transfer_test_summary_v1(
  uuid, uuid
) to service_role;

revoke all on function public.committed_risk_transfer_test_reset_v1(
  uuid
) from public;
revoke all on function public.committed_risk_transfer_test_reset_v1(
  uuid
) from anon;
revoke all on function public.committed_risk_transfer_test_reset_v1(
  uuid
) from authenticated;
grant execute on function public.committed_risk_transfer_test_reset_v1(
  uuid
) to service_role;
`.trim() + "\n";

const cleanupMigration = String.raw`
drop function if exists public.committed_risk_transfer_test_reset_v1(uuid);
drop function if exists public.committed_risk_transfer_test_summary_v1(uuid, uuid);
drop function if exists public.committed_risk_transfer_test_fill_v1(
  uuid, uuid, uuid, uuid, numeric, integer
);
drop function if exists public.committed_risk_transfer_test_reserve_v1(
  uuid, uuid, uuid, numeric, numeric, numeric, integer
);

drop schema if exists ai_stock_lab_transfer_test cascade;
`.trim() + "\n";

function assertNoProductionReferences() {
  const forbidden = [
    "paper_order_requests",
    "paper_positions",
    "paper_accounts",
    "risk_decisions",
    "paper_trade_history",
  ];

  const bad = forbidden.filter((name) =>
    new RegExp(`\\b${name}\\b`, "i").test(addMigration)
  );

  if (bad.length > 0) {
    throw new Error(
      `HARNESS_REFERENCES_PRODUCTION_TABLES:${bad.join(",")}`
    );
  }
}

function writeMigration(file, expectedContent, name) {
  if (fs.existsSync(file)) {
    const current = fs.readFileSync(file, "utf8");

    if (current !== expectedContent) {
      throw new Error(
        `MIGRATION_ALREADY_EXISTS_WITH_DIFFERENT_CONTENT:${name}`
      );
    }

    return;
  }

  fs.writeFileSync(
    file,
    expectedContent,
    "utf8"
  );
}

function requireOnlyPending(expectedFile) {
  const result = runCli(
    [
      "db",
      "push",
      "--dry-run",
      "--linked",
    ],
    180000
  );

  const combined =
    `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

  const pending = extractPendingSqlFiles(combined);

  if (
    result.status !== 0 ||
    pending.length !== 1 ||
    pending[0] !== expectedFile
  ) {
    const error = new Error(
      `UNEXPECTED_PENDING_MIGRATIONS:${JSON.stringify(pending)}`
    );

    error.output = tail(combined, 40);
    throw error;
  }

  return {
    pending,
    outputTail: tail(combined, 25),
  };
}

function pushExpected(expectedFile) {
  const dry = requireOnlyPending(expectedFile);

  const push = runCli(
    [
      "db",
      "push",
      "--linked",
      "--yes",
    ],
    240000
  );

  const combined =
    `${push.stdout ?? ""}\n${push.stderr ?? ""}`;

  if (push.status !== 0) {
    const error = new Error(
      `DB_PUSH_FAILED:${expectedFile}`
    );

    error.output = tail(combined, 40);
    throw error;
  }

  return {
    dryRun: dry,
    pushOutputTail: tail(combined, 30),
  };
}

async function verifyFunctionsAbsentAfterCleanup() {
  const types = runCli(
    [
      "gen",
      "types",
      "typescript",
      "--linked",
      "--schema",
      "public",
    ],
    180000
  );

  const text = String(types.stdout ?? "");

  const absent =
    !text.includes(reserveRpc) &&
    !text.includes(fillRpc) &&
    !text.includes(summaryRpc) &&
    !text.includes(resetRpc);

  return {
    genTypesExitCode: types.status,
    reserveRpcAbsent: !text.includes(reserveRpc),
    fillRpcAbsent: !text.includes(fillRpc),
    summaryRpcAbsent: !text.includes(summaryRpc),
    resetRpcAbsent: !text.includes(resetRpc),
    passed: types.status === 0 && absent,
  };
}

async function scenarioSimpleTransfer() {
  const runId = randomUuid();
  const accountKey = randomUuid();
  const requestId = randomUuid();
  const positionKey = randomUuid();

  const r = await reserve({
    runId,
    accountKey,
    requestId,
    proposedRisk: 80_000,
  });

  const before = await summary(
    runId,
    accountKey
  );

  const f = await fill({
    runId,
    accountKey,
    requestId,
    positionKey,
    positionRisk: 80_000,
  });

  const after = await summary(
    runId,
    accountKey
  );

  const passed =
    r.approved === true &&
    Number(before.reservedRisk) === 80_000 &&
    Number(before.positionRisk) === 0 &&
    Number(before.committedRisk) === 80_000 &&
    Number(f.committedRiskBefore) === 80_000 &&
    Number(f.committedRiskAfter) === 80_000 &&
    Number(after.reservedRisk) === 0 &&
    Number(after.positionRisk) === 80_000 &&
    Number(after.committedRisk) === 80_000;

  await resetRun(runId);

  return {
    name:
      "RESERVATION_TO_POSITION_TRANSFER_PRESERVES_COMMITTED_RISK",

    passed,

    expected: {
      beforeCommittedRisk: 80_000,
      afterCommittedRisk: 80_000,
      afterReservedRisk: 0,
      afterPositionRisk: 80_000,
    },

    observed: {
      reserve: r,
      before,
      fill: f,
      after,
    },
  };
}

async function scenarioConcurrentFillAndNewReservation() {
  const runId = randomUuid();
  const accountKey = randomUuid();
  const existingRequest = randomUuid();
  const newRequest = randomUuid();
  const positionKey = randomUuid();

  const initial = await reserve({
    runId,
    accountKey,
    requestId: existingRequest,
    proposedRisk: 120_000,
  });

  if (!initial.approved) {
    throw new Error(
      "SETUP_RESERVATION_NOT_APPROVED"
    );
  }

  const [fillResult, newReservation] =
    await Promise.all([
      fill({
        runId,
        accountKey,
        requestId: existingRequest,
        positionKey,
        positionRisk: 120_000,
        holdMs: 120,
      }),

      reserve({
        runId,
        accountKey,
        requestId: newRequest,
        proposedRisk: 100_000,
        holdMs: 40,
      }),
    ]);

  const after = await summary(
    runId,
    accountKey
  );

  const passed =
    fillResult.idempotent === false &&
    newReservation.approved === false &&
    Number(after.reservedRisk) === 0 &&
    Number(after.positionRisk) === 120_000 &&
    Number(after.committedRisk) === 120_000;

  await resetRun(runId);

  return {
    name:
      "CONCURRENT_FILL_AND_NEW_RESERVATION_HAS_NO_RISK_GAP",

    passed,

    expected: {
      existingRisk: 120_000,
      newRisk: 100_000,
      budget: 200_000,
      newReservationApproved: false,
      finalCommittedRisk: 120_000,
    },

    observed: {
      fillResult,
      newReservation,
      after,
    },
  };
}

async function scenarioReducedRiskFillReleasesCapacity() {
  const runId = randomUuid();
  const accountKey = randomUuid();
  const existingRequest = randomUuid();
  const nextRequest = randomUuid();
  const positionKey = randomUuid();

  await reserve({
    runId,
    accountKey,
    requestId: existingRequest,
    proposedRisk: 120_000,
  });

  const fillResult = await fill({
    runId,
    accountKey,
    requestId: existingRequest,
    positionKey,
    positionRisk: 80_000,
  });

  const nextReservation = await reserve({
    runId,
    accountKey,
    requestId: nextRequest,
    proposedRisk: 120_000,
  });

  const after = await summary(
    runId,
    accountKey
  );

  const passed =
    Number(fillResult.committedRiskAfter) === 80_000 &&
    nextReservation.approved === true &&
    Number(after.reservedRisk) === 120_000 &&
    Number(after.positionRisk) === 80_000 &&
    Number(after.committedRisk) === 200_000;

  await resetRun(runId);

  return {
    name:
      "REDUCED_FILL_RISK_RELEASES_ONLY_REAL_CAPACITY",

    passed,

    expected: {
      filledPositionRisk: 80_000,
      nextReservationRisk: 120_000,
      finalCommittedRisk: 200_000,
    },

    observed: {
      fillResult,
      nextReservation,
      after,
    },
  };
}

async function scenarioFillIdempotency() {
  const runId = randomUuid();
  const accountKey = randomUuid();
  const requestId = randomUuid();
  const positionKey = randomUuid();

  await reserve({
    runId,
    accountKey,
    requestId,
    proposedRisk: 70_000,
  });

  const first = await fill({
    runId,
    accountKey,
    requestId,
    positionKey,
    positionRisk: 70_000,
  });

  const second = await fill({
    runId,
    accountKey,
    requestId,
    positionKey,
    positionRisk: 70_000,
  });

  const after = await summary(
    runId,
    accountKey
  );

  const passed =
    first.idempotent === false &&
    second.idempotent === true &&
    Number(after.positionCount) === 1 &&
    Number(after.positionRisk) === 70_000 &&
    Number(after.reservedRisk) === 0 &&
    Number(after.committedRisk) === 70_000;

  await resetRun(runId);

  return {
    name:
      "FILL_RETRY_IS_IDEMPOTENT",

    passed,

    expected: {
      positionCount: 1,
      finalCommittedRisk: 70_000,
      secondFillIdempotent: true,
    },

    observed: {
      first,
      second,
      after,
    },
  };
}

async function main() {
  const report = {
    status:
      "ALPHA_V3_ISOLATED_RESERVATION_TO_FILL_TRANSFER_TEST_RUNNING",

    harness: {
      schema:
        "ai_stock_lab_transfer_test",

      addMigration:
        addMigrationName,

      cleanupMigration:
        cleanupMigrationName,

      sharedLockKey:
        "AI_STOCK_LAB_COMMITTED_RISK_V3:<account_id>",

      productionTablesReferenced:
        false,
    },

    apply:
      null,

    scenarios:
      [],

    cleanup:
      null,

    testError:
      null,

    safety: {
      productionOrdersCreated:
        0,

      productionPositionsChanged:
        0,

      productionTablesReferenced:
        false,
    },
  };

  let harnessApplied = false;

  try {
    assertNoProductionReferences();

    const baselineDry = runCli(
      [
        "db",
        "push",
        "--dry-run",
        "--linked",
      ],
      180000
    );

    const baselineCombined =
      `${baselineDry.stdout ?? ""}\n${baselineDry.stderr ?? ""}`;

    const baselinePending =
      extractPendingSqlFiles(
        baselineCombined
      );

    if (
      baselineDry.status !== 0 ||
      baselinePending.length !== 0 ||
      !/Remote database is up to date/i.test(
        baselineCombined
      )
    ) {
      throw new Error(
        `BASELINE_DB_NOT_UP_TO_DATE:${JSON.stringify(baselinePending)}`
      );
    }

    writeMigration(
      addMigrationPath,
      addMigration,
      addMigrationName
    );

    report.apply = pushExpected(
      addMigrationName
    );

    harnessApplied = true;

    report.scenarios.push(
      await scenarioSimpleTransfer()
    );

    report.scenarios.push(
      await scenarioConcurrentFillAndNewReservation()
    );

    report.scenarios.push(
      await scenarioReducedRiskFillReleasesCapacity()
    );

    report.scenarios.push(
      await scenarioFillIdempotency()
    );
  } catch (error) {
    report.testError = {
      message:
        String(error?.message ?? error),

      details:
        error?.details ?? null,

      output:
        error?.output ?? null,

      stack:
        String(error?.stack ?? "")
          .split(/\r?\n/)
          .slice(0, 12)
          .join("\n"),
    };
  } finally {
    if (harnessApplied) {
      try {
        writeMigration(
          cleanupMigrationPath,
          cleanupMigration,
          cleanupMigrationName
        );

        const cleanupPush = pushExpected(
          cleanupMigrationName
        );

        const absence =
          await verifyFunctionsAbsentAfterCleanup();

        const finalDry = runCli(
          [
            "db",
            "push",
            "--dry-run",
            "--linked",
          ],
          180000
        );

        const finalCombined =
          `${finalDry.stdout ?? ""}\n${finalDry.stderr ?? ""}`;

        const finalPending =
          extractPendingSqlFiles(
            finalCombined
          );

        report.cleanup = {
          ...cleanupPush,

          functionAbsence:
            absence,

          finalDryRun: {
            exitCode:
              finalDry.status,

            pendingSqlFiles:
              finalPending,

            remoteDatabaseUpToDate:
              /Remote database is up to date/i.test(
                finalCombined
              ),
          },

          passed:
            absence.passed &&
            finalDry.status === 0 &&
            finalPending.length === 0 &&
            /Remote database is up to date/i.test(
              finalCombined
            ),
        };
      } catch (cleanupError) {
        report.cleanup = {
          passed: false,

          error: {
            message:
              String(
                cleanupError?.message ??
                cleanupError
              ),

            output:
              cleanupError?.output ??
              null,
          },
        };
      }
    }
  }

  const allScenariosPassed =
    report.scenarios.length === 4 &&
    report.scenarios.every(
      (row) => row.passed
    );

  const cleanupPassed =
    harnessApplied
      ? report.cleanup?.passed === true
      : false;

  const verified =
    !report.testError &&
    allScenariosPassed &&
    cleanupPassed;

  report.status =
    verified
      ? "ALPHA_V3_ISOLATED_RESERVATION_TO_FILL_TRANSFER_TEST_VERIFIED"
      : "ALPHA_V3_ISOLATED_RESERVATION_TO_FILL_TRANSFER_TEST_REVIEW";

  report.decision = {
    allScenariosPassed,
    cleanupPassed,

    reservationToFillTransferVerified:
      verified,

    committedRiskContinuityVerified:
      verified,

    sharedAccountLockEndToEndVerified:
      verified,

    nextGate:
      verified
        ? "COMMITTED_RISK_V3_CORE_COMPLETE_BEGIN_EXPIRY_RECONCILIATION"
        : cleanupPassed
          ? "REVIEW_TRANSFER_TEST_FAILURE"
          : "CLEANUP_TRANSFER_TEST_HARNESS_BEFORE_CONTINUING",
  };

  report.safety = {
    productionOrdersCreated: 0,
    productionPositionsChanged: 0,
    productionTablesReferenced: false,
    testSchemaCleaned: cleanupPassed,
  };

  report.outputFile =
    "logs/alpha-v3-isolated-reservation-to-fill-transfer-test.json";

  fs.mkdirSync(
    path.dirname(reportFile),
    { recursive: true }
  );

  fs.writeFileSync(
    reportFile,
    JSON.stringify(report, null, 2) + "\n",
    "utf8"
  );

  console.log(
    JSON.stringify(
      {
        status:
          report.status,

        scenarios:
          report.scenarios.map(
            (row) => ({
              name: row.name,
              passed: row.passed,
              expected: row.expected,
              observed: row.observed,
            })
          ),

        testError:
          report.testError,

        cleanupPassed:
          report.decision.cleanupPassed,

        reservationToFillTransferVerified:
          report.decision
            .reservationToFillTransferVerified,

        committedRiskContinuityVerified:
          report.decision
            .committedRiskContinuityVerified,

        sharedAccountLockEndToEndVerified:
          report.decision
            .sharedAccountLockEndToEndVerified,

        productionOrdersCreated: 0,
        productionPositionsChanged: 0,
        testSchemaCleaned:
          report.safety.testSchemaCleaned,

        nextGate:
          report.decision.nextGate,

        outputFile:
          report.outputFile,
      },
      null,
      2
    )
  );

  if (!verified) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status:
          "ALPHA_V3_ISOLATED_RESERVATION_TO_FILL_TRANSFER_TEST_FATAL",

        error:
          String(error?.message ?? error),

        databaseWritesMayHaveOccurred:
          true,

        productionOrdersCreated:
          0,

        productionPositionsChanged:
          0,

        nextGate:
          "INSPECT_TRANSFER_TEST_HARNESS_STATE_BEFORE_CONTINUING",
      },
      null,
      2
    )
  );

  process.exitCode = 2;
});
