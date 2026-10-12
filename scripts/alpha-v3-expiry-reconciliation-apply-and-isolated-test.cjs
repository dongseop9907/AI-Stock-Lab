const fs = require("fs");
const path = require("path");
const { spawnSync } = require("node:child_process");
const crypto = require("crypto");

const root = process.cwd();

const cli = path.resolve(
  root,
  "node_modules/.bin/supabase.cmd"
);

const productionMigration =
  "20261008001000_committed_risk_expiry_reconciliation_v2.sql";

const productionVersion =
  "20261008001000";

const verifierRel =
  "scripts/alpha-v3-committed-risk-expiry-reconciliation-v2-verify.cjs";

const harnessMigration =
  "20261008001100_committed_risk_expiry_reconciliation_test_harness.sql";

const cleanupMigration =
  "20261008001200_committed_risk_expiry_reconciliation_test_harness_cleanup.sql";

const harnessPath = path.resolve(
  root,
  "supabase/migrations",
  harnessMigration
);

const cleanupPath = path.resolve(
  root,
  "supabase/migrations",
  cleanupMigration
);

const reportFile = path.resolve(
  root,
  "logs/alpha-v3-expiry-reconciliation-apply-and-isolated-test.json"
);

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

function runNodeScript(rel, timeout = 120000) {
  return spawnSync(
    process.execPath,
    [path.resolve(root, rel)],
    {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      env: process.env,
      timeout,
      maxBuffer: 20 * 1024 * 1024,
    }
  );
}

function tail(value, count = 40) {
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

function parseMigrationRows(text) {
  const rows = [];

  for (
    const raw of String(text ?? "")
      .replace(/\x1b\[[0-9;]*m/g, "")
      .split(/\r?\n/)
  ) {
    if (!raw.includes("|") && !raw.includes("│")) {
      continue;
    }

    const parts = raw.split(/[|│]/);

    if (parts.length < 2) {
      continue;
    }

    const pick = (value) => {
      const m = String(value)
        .replace(/`/g, "")
        .match(/\b\d{3,14}\b/);

      return m ? m[0] : null;
    };

    const local = pick(parts[0]);
    const remote = pick(parts[1]);

    if (local || remote) {
      rows.push({
        local,
        remote,
        raw: raw.trim(),
      });
    }
  }

  return rows;
}

function parseEnvFile(rel) {
  const file = path.resolve(root, rel);
  const result = {};

  if (!fs.existsSync(file)) {
    return result;
  }

  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();

    if (!line || line.startsWith("#") || !line.includes("=")) {
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

function requireOnlyPending(expectedFile) {
  const dry = runCli(
    [
      "db",
      "push",
      "--dry-run",
      "--linked",
    ],
    180000
  );

  const combined =
    `${dry.stdout ?? ""}\n${dry.stderr ?? ""}`;

  const pending =
    extractPendingSqlFiles(combined);

  if (
    dry.status !== 0 ||
    pending.length !== 1 ||
    pending[0] !== expectedFile
  ) {
    const error = new Error(
      `UNEXPECTED_PENDING_MIGRATIONS:${JSON.stringify(pending)}`
    );

    error.output = tail(combined, 45);
    throw error;
  }

  return {
    pending,
    outputTail: tail(combined, 30),
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

    error.output = tail(combined, 45);
    throw error;
  }

  return {
    dryRun: dry,
    pushOutputTail: tail(combined, 35),
  };
}

function assertRemoteUpToDate() {
  const dry = runCli(
    [
      "db",
      "push",
      "--dry-run",
      "--linked",
    ],
    180000
  );

  const combined =
    `${dry.stdout ?? ""}\n${dry.stderr ?? ""}`;

  const pending =
    extractPendingSqlFiles(combined);

  const upToDate =
    dry.status === 0 &&
    pending.length === 0 &&
    /Remote database is up to date/i.test(combined);

  if (!upToDate) {
    const error = new Error(
      `REMOTE_NOT_UP_TO_DATE:${JSON.stringify(pending)}`
    );

    error.output = tail(combined, 45);
    throw error;
  }

  return {
    pendingSqlFiles: pending,
    remoteDatabaseUpToDate: true,
    outputTail: tail(combined, 25),
  };
}

function writeExact(file, content, name) {
  if (fs.existsSync(file)) {
    const current = fs.readFileSync(file, "utf8");

    if (current !== content) {
      throw new Error(
        `MIGRATION_ALREADY_EXISTS_WITH_DIFFERENT_CONTENT:${name}`
      );
    }

    return;
  }

  fs.writeFileSync(file, content, "utf8");
}

const harnessSql = String.raw`
create schema if not exists ai_stock_lab_expiry_test;

revoke all on schema ai_stock_lab_expiry_test from public;
revoke all on schema ai_stock_lab_expiry_test from anon;
revoke all on schema ai_stock_lab_expiry_test from authenticated;

create table if not exists ai_stock_lab_expiry_test.orders (
  run_id uuid not null,
  id uuid not null,
  account_key uuid not null,
  status text not null,
  side text not null default 'BUY',
  reserved_risk_amount numeric not null default 0,
  reserved_risk_at timestamptz,
  reserved_risk_released_at timestamptz,
  reserved_risk_release_reason text,
  created_at timestamptz not null default now(),
  committed_risk_reason text,
  primary key (run_id, id)
);

create or replace function ai_stock_lab_expiry_test.release_terminal_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, ai_stock_lab_expiry_test, pg_temp
as $$
begin
  if new.status in (
    'FILLED',
    'RISK_REJECTED',
    'REJECTED',
    'CANCELLED',
    'CANCELED',
    'EXPIRED',
    'FAILED',
    'CLOSED'
  )
  and coalesce(new.reserved_risk_amount, 0) > 0 then
    new.reserved_risk_amount := 0;
    new.reserved_risk_released_at :=
      coalesce(new.reserved_risk_released_at, now());
    new.reserved_risk_release_reason :=
      coalesce(
        new.reserved_risk_release_reason,
        'TERMINAL_STATUS:' || new.status
      );
  end if;

  return new;
end;
$$;

drop trigger if exists
  trg_expiry_test_terminal_release
on ai_stock_lab_expiry_test.orders;

create trigger
  trg_expiry_test_terminal_release
before update of status
on ai_stock_lab_expiry_test.orders
for each row
execute function ai_stock_lab_expiry_test.release_terminal_v1();

create or replace function public.expiry_test_seed_v1(
  p_run_id uuid,
  p_id uuid,
  p_account_key uuid,
  p_status text,
  p_reserved_risk numeric,
  p_age_seconds integer,
  p_reserved_at_null boolean default false,
  p_released_at_conflict boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, ai_stock_lab_expiry_test, pg_temp
as $$
begin
  insert into ai_stock_lab_expiry_test.orders (
    run_id,
    id,
    account_key,
    status,
    side,
    reserved_risk_amount,
    reserved_risk_at,
    reserved_risk_released_at,
    created_at
  )
  values (
    p_run_id,
    p_id,
    p_account_key,
    p_status,
    'BUY',
    p_reserved_risk,
    case
      when p_reserved_at_null then null
      else now() - make_interval(secs => p_age_seconds)
    end,
    case
      when p_released_at_conflict then now() - interval '30 seconds'
      else null
    end,
    now() - make_interval(secs => p_age_seconds)
  );

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.expiry_test_fill_v1(
  p_run_id uuid,
  p_id uuid,
  p_account_key uuid,
  p_hold_ms integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, ai_stock_lab_expiry_test, pg_temp
as $$
declare
  v_order ai_stock_lab_expiry_test.orders%rowtype;
begin
  perform pg_advisory_xact_lock(
    hashtext(
      'AI_STOCK_LAB_COMMITTED_RISK_V3:' ||
      p_account_key::text
    )
  );

  select *
  into v_order
  from ai_stock_lab_expiry_test.orders
  where run_id = p_run_id
    and id = p_id
  for update;

  if not found then
    raise exception 'TEST_ORDER_NOT_FOUND';
  end if;

  if v_order.account_key <> p_account_key then
    raise exception 'TEST_ACCOUNT_MISMATCH';
  end if;

  if v_order.status <> 'RISK_APPROVED' then
    return jsonb_build_object(
      'ok', false,
      'skipped', true,
      'status', v_order.status
    );
  end if;

  if p_hold_ms > 0 then
    perform pg_sleep(p_hold_ms::numeric / 1000.0);
  end if;

  update ai_stock_lab_expiry_test.orders
  set status = 'FILLED'
  where run_id = p_run_id
    and id = p_id;

  return jsonb_build_object(
    'ok', true,
    'status', 'FILLED'
  );
end;
$$;

create or replace function public.expiry_test_expire_v1(
  p_run_id uuid,
  p_stale_after interval,
  p_limit integer default 100,
  p_hold_ms integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, ai_stock_lab_expiry_test, pg_temp
as $$
declare
  v_candidate record;
  v_order ai_stock_lab_expiry_test.orders%rowtype;
  v_expired integer := 0;
  v_skipped integer := 0;
  v_cutoff timestamptz;
begin
  v_cutoff := now() - p_stale_after;

  for v_candidate in
    select id, account_key
    from ai_stock_lab_expiry_test.orders
    where run_id = p_run_id
      and status = 'RISK_APPROVED'
      and side = 'BUY'
      and reserved_risk_amount > 0
      and reserved_risk_released_at is null
      and coalesce(reserved_risk_at, created_at) <= v_cutoff
    order by account_key, id
    limit p_limit
  loop
    perform pg_advisory_xact_lock(
      hashtext(
        'AI_STOCK_LAB_COMMITTED_RISK_V3:' ||
        v_candidate.account_key::text
      )
    );

    select *
    into v_order
    from ai_stock_lab_expiry_test.orders
    where run_id = p_run_id
      and id = v_candidate.id
    for update;

    if not found
       or v_order.account_key <> v_candidate.account_key
       or v_order.status <> 'RISK_APPROVED'
       or coalesce(v_order.reserved_risk_amount, 0) <= 0
       or v_order.reserved_risk_released_at is not null
       or coalesce(v_order.reserved_risk_at, v_order.created_at) > v_cutoff then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if p_hold_ms > 0 then
      perform pg_sleep(p_hold_ms::numeric / 1000.0);
    end if;

    update ai_stock_lab_expiry_test.orders
    set
      status = 'EXPIRED',
      committed_risk_reason = 'STALE_RISK_APPROVED_EXPIRED'
    where run_id = p_run_id
      and id = v_order.id;

    v_expired := v_expired + 1;
  end loop;

  return jsonb_build_object(
    'expiredCount', v_expired,
    'skippedCount', v_skipped
  );
end;
$$;

create or replace function public.expiry_test_reconcile_v1(
  p_run_id uuid,
  p_limit integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, ai_stock_lab_expiry_test, pg_temp
as $$
declare
  v_candidate record;
  v_order ai_stock_lab_expiry_test.orders%rowtype;
  v_released integer := 0;
  v_released_risk numeric := 0;
  v_zero integer := 0;
  v_missing integer := 0;
  v_conflict integer := 0;
begin
  for v_candidate in
    select id, account_key
    from ai_stock_lab_expiry_test.orders
    where run_id = p_run_id
      and status in (
        'FILLED',
        'RISK_REJECTED',
        'REJECTED',
        'CANCELLED',
        'CANCELED',
        'EXPIRED',
        'FAILED',
        'CLOSED'
      )
      and reserved_risk_amount > 0
    order by account_key, id
    limit p_limit
  loop
    perform pg_advisory_xact_lock(
      hashtext(
        'AI_STOCK_LAB_COMMITTED_RISK_V3:' ||
        v_candidate.account_key::text
      )
    );

    select *
    into v_order
    from ai_stock_lab_expiry_test.orders
    where run_id = p_run_id
      and id = v_candidate.id
    for update;

    if not found
       or v_order.account_key <> v_candidate.account_key
       or v_order.status not in (
         'FILLED',
         'RISK_REJECTED',
         'REJECTED',
         'CANCELLED',
         'CANCELED',
         'EXPIRED',
         'FAILED',
         'CLOSED'
       )
       or coalesce(v_order.reserved_risk_amount, 0) <= 0 then
      continue;
    end if;

    v_released_risk :=
      v_released_risk + v_order.reserved_risk_amount;

    update ai_stock_lab_expiry_test.orders
    set
      reserved_risk_amount = 0,
      reserved_risk_released_at =
        coalesce(reserved_risk_released_at, now()),
      reserved_risk_release_reason =
        coalesce(
          reserved_risk_release_reason,
          'RECONCILED_TERMINAL_STATUS:' || v_order.status
        )
    where run_id = p_run_id
      and id = v_order.id;

    v_released := v_released + 1;
  end loop;

  select count(*)
  into v_zero
  from ai_stock_lab_expiry_test.orders
  where run_id = p_run_id
    and status = 'RISK_APPROVED'
    and coalesce(reserved_risk_amount, 0) <= 0;

  select count(*)
  into v_missing
  from ai_stock_lab_expiry_test.orders
  where run_id = p_run_id
    and status = 'RISK_APPROVED'
    and reserved_risk_amount > 0
    and reserved_risk_at is null;

  select count(*)
  into v_conflict
  from ai_stock_lab_expiry_test.orders
  where run_id = p_run_id
    and status = 'RISK_APPROVED'
    and reserved_risk_amount > 0
    and reserved_risk_released_at is not null;

  return jsonb_build_object(
    'releasedCount', v_released,
    'releasedRisk', v_released_risk,
    'zeroReservationCount', v_zero,
    'missingReservedAtCount', v_missing,
    'releasedAtConflictCount', v_conflict
  );
end;
$$;

create or replace function public.expiry_test_get_order_v1(
  p_run_id uuid,
  p_id uuid
)
returns jsonb
language sql
security definer
set search_path = pg_catalog, ai_stock_lab_expiry_test, pg_temp
as $$
  select to_jsonb(o)
  from ai_stock_lab_expiry_test.orders o
  where o.run_id = p_run_id
    and o.id = p_id;
$$;

create or replace function public.expiry_test_reset_v1(
  p_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, ai_stock_lab_expiry_test, pg_temp
as $$
declare
  v_deleted integer;
begin
  delete from ai_stock_lab_expiry_test.orders
  where run_id = p_run_id;

  get diagnostics v_deleted = row_count;

  return jsonb_build_object('deleted', v_deleted);
end;
$$;

revoke all on function public.expiry_test_seed_v1(
  uuid, uuid, uuid, text, numeric, integer, boolean, boolean
) from public;
revoke all on function public.expiry_test_seed_v1(
  uuid, uuid, uuid, text, numeric, integer, boolean, boolean
) from anon;
revoke all on function public.expiry_test_seed_v1(
  uuid, uuid, uuid, text, numeric, integer, boolean, boolean
) from authenticated;
grant execute on function public.expiry_test_seed_v1(
  uuid, uuid, uuid, text, numeric, integer, boolean, boolean
) to service_role;

revoke all on function public.expiry_test_fill_v1(
  uuid, uuid, uuid, integer
) from public;
revoke all on function public.expiry_test_fill_v1(
  uuid, uuid, uuid, integer
) from anon;
revoke all on function public.expiry_test_fill_v1(
  uuid, uuid, uuid, integer
) from authenticated;
grant execute on function public.expiry_test_fill_v1(
  uuid, uuid, uuid, integer
) to service_role;

revoke all on function public.expiry_test_expire_v1(
  uuid, interval, integer, integer
) from public;
revoke all on function public.expiry_test_expire_v1(
  uuid, interval, integer, integer
) from anon;
revoke all on function public.expiry_test_expire_v1(
  uuid, interval, integer, integer
) from authenticated;
grant execute on function public.expiry_test_expire_v1(
  uuid, interval, integer, integer
) to service_role;

revoke all on function public.expiry_test_reconcile_v1(
  uuid, integer
) from public;
revoke all on function public.expiry_test_reconcile_v1(
  uuid, integer
) from anon;
revoke all on function public.expiry_test_reconcile_v1(
  uuid, integer
) from authenticated;
grant execute on function public.expiry_test_reconcile_v1(
  uuid, integer
) to service_role;

revoke all on function public.expiry_test_get_order_v1(
  uuid, uuid
) from public;
revoke all on function public.expiry_test_get_order_v1(
  uuid, uuid
) from anon;
revoke all on function public.expiry_test_get_order_v1(
  uuid, uuid
) from authenticated;
grant execute on function public.expiry_test_get_order_v1(
  uuid, uuid
) to service_role;

revoke all on function public.expiry_test_reset_v1(
  uuid
) from public;
revoke all on function public.expiry_test_reset_v1(
  uuid
) from anon;
revoke all on function public.expiry_test_reset_v1(
  uuid
) from authenticated;
grant execute on function public.expiry_test_reset_v1(
  uuid
) to service_role;
`.trim() + "\n";

const cleanupSql = String.raw`
drop function if exists public.expiry_test_reset_v1(uuid);
drop function if exists public.expiry_test_get_order_v1(uuid, uuid);
drop function if exists public.expiry_test_reconcile_v1(uuid, integer);
drop function if exists public.expiry_test_expire_v1(
  uuid, interval, integer, integer
);
drop function if exists public.expiry_test_fill_v1(
  uuid, uuid, uuid, integer
);
drop function if exists public.expiry_test_seed_v1(
  uuid, uuid, uuid, text, numeric, integer, boolean, boolean
);

drop schema if exists ai_stock_lab_expiry_test cascade;
`.trim() + "\n";

async function seed(args) {
  return rpc(
    "expiry_test_seed_v1",
    {
      p_run_id: args.runId,
      p_id: args.id,
      p_account_key: args.accountKey,
      p_status: args.status,
      p_reserved_risk: args.reservedRisk,
      p_age_seconds: args.ageSeconds,
      p_reserved_at_null: args.reservedAtNull ?? false,
      p_released_at_conflict: args.releasedAtConflict ?? false,
    }
  );
}

async function getOrder(runId, id) {
  return rpc(
    "expiry_test_get_order_v1",
    {
      p_run_id: runId,
      p_id: id,
    }
  );
}

async function expire(runId, staleAfter, limit = 100, holdMs = 0) {
  return rpc(
    "expiry_test_expire_v1",
    {
      p_run_id: runId,
      p_stale_after: staleAfter,
      p_limit: limit,
      p_hold_ms: holdMs,
    }
  );
}

async function reconcile(runId, limit = 500) {
  return rpc(
    "expiry_test_reconcile_v1",
    {
      p_run_id: runId,
      p_limit: limit,
    }
  );
}

async function fill(runId, id, accountKey, holdMs = 0) {
  return rpc(
    "expiry_test_fill_v1",
    {
      p_run_id: runId,
      p_id: id,
      p_account_key: accountKey,
      p_hold_ms: holdMs,
    }
  );
}

async function reset(runId) {
  return rpc(
    "expiry_test_reset_v1",
    {
      p_run_id: runId,
    }
  );
}

async function scenarioStaleExpiresFreshSurvives() {
  const runId = randomUuid();
  const accountKey = randomUuid();
  const staleId = randomUuid();
  const freshId = randomUuid();

  await seed({
    runId,
    id: staleId,
    accountKey,
    status: "RISK_APPROVED",
    reservedRisk: 90000,
    ageSeconds: 600,
  });

  await seed({
    runId,
    id: freshId,
    accountKey,
    status: "RISK_APPROVED",
    reservedRisk: 80000,
    ageSeconds: 20,
  });

  const result = await expire(
    runId,
    "2 minutes",
    100,
    0
  );

  const stale = await getOrder(runId, staleId);
  const fresh = await getOrder(runId, freshId);

  const passed =
    Number(result.expiredCount) === 1 &&
    stale.status === "EXPIRED" &&
    Number(stale.reserved_risk_amount) === 0 &&
    stale.reserved_risk_released_at != null &&
    fresh.status === "RISK_APPROVED" &&
    Number(fresh.reserved_risk_amount) === 80000 &&
    fresh.reserved_risk_released_at == null;

  await reset(runId);

  return {
    name:
      "STALE_EXPIRES_FRESH_SURVIVES",

    passed,

    expected: {
      expiredCount: 1,
      staleStatus: "EXPIRED",
      staleReservedRisk: 0,
      freshStatus: "RISK_APPROVED",
      freshReservedRisk: 80000,
    },

    observed: {
      expireResult: result,
      stale,
      fresh,
    },
  };
}

async function scenarioTerminalReconciliation() {
  const runId = randomUuid();
  const accountKey = randomUuid();
  const id = randomUuid();

  await seed({
    runId,
    id,
    accountKey,
    status: "FAILED",
    reservedRisk: 65000,
    ageSeconds: 300,
  });

  const before = await getOrder(runId, id);
  const result = await reconcile(runId, 100);
  const after = await getOrder(runId, id);

  const passed =
    Number(before.reserved_risk_amount) === 65000 &&
    Number(result.releasedCount) === 1 &&
    Number(result.releasedRisk) === 65000 &&
    Number(after.reserved_risk_amount) === 0 &&
    after.reserved_risk_released_at != null;

  await reset(runId);

  return {
    name:
      "TERMINAL_LEFTOVER_RESERVATION_RECONCILED",

    passed,

    expected: {
      releasedCount: 1,
      releasedRisk: 65000,
      finalReservedRisk: 0,
    },

    observed: {
      before,
      reconcileResult: result,
      after,
    },
  };
}

async function scenarioActiveAnomaliesReportOnly() {
  const runId = randomUuid();
  const accountKey = randomUuid();

  const zeroId = randomUuid();
  const missingTimeId = randomUuid();
  const conflictId = randomUuid();

  await seed({
    runId,
    id: zeroId,
    accountKey,
    status: "RISK_APPROVED",
    reservedRisk: 0,
    ageSeconds: 100,
  });

  await seed({
    runId,
    id: missingTimeId,
    accountKey,
    status: "RISK_APPROVED",
    reservedRisk: 45000,
    ageSeconds: 100,
    reservedAtNull: true,
  });

  await seed({
    runId,
    id: conflictId,
    accountKey,
    status: "RISK_APPROVED",
    reservedRisk: 55000,
    ageSeconds: 100,
    releasedAtConflict: true,
  });

  const result = await reconcile(runId, 100);

  const zero = await getOrder(runId, zeroId);
  const missing = await getOrder(runId, missingTimeId);
  const conflict = await getOrder(runId, conflictId);

  const passed =
    Number(result.zeroReservationCount) === 1 &&
    Number(result.missingReservedAtCount) === 1 &&
    Number(result.releasedAtConflictCount) === 1 &&
    Number(zero.reserved_risk_amount) === 0 &&
    Number(missing.reserved_risk_amount) === 45000 &&
    Number(conflict.reserved_risk_amount) === 55000 &&
    missing.status === "RISK_APPROVED" &&
    conflict.status === "RISK_APPROVED";

  await reset(runId);

  return {
    name:
      "ACTIVE_ANOMALIES_REPORTED_NOT_MUTATED",

    passed,

    expected: {
      zeroReservationCount: 1,
      missingReservedAtCount: 1,
      releasedAtConflictCount: 1,
      activeRiskNotIncreasedOrDecreased: true,
    },

    observed: {
      reconcileResult: result,
      zero,
      missing,
      conflict,
    },
  };
}

async function scenarioFillExpiryRace() {
  const runId = randomUuid();
  const accountKey = randomUuid();
  const id = randomUuid();

  await seed({
    runId,
    id,
    accountKey,
    status: "RISK_APPROVED",
    reservedRisk: 100000,
    ageSeconds: 600,
  });

  const settled = await Promise.allSettled([
    fill(
      runId,
      id,
      accountKey,
      120
    ),
    expire(
      runId,
      "2 minutes",
      100,
      40
    ),
  ]);

  const after = await getOrder(runId, id);

  const failures =
    settled.filter(
      (row) => row.status === "rejected"
    );

  const legalTerminal =
    after.status === "FILLED" ||
    after.status === "EXPIRED";

  const passed =
    failures.length === 0 &&
    legalTerminal &&
    Number(after.reserved_risk_amount) === 0 &&
    after.reserved_risk_released_at != null;

  await reset(runId);

  return {
    name:
      "FILL_EXPIRY_RACE_SERIALIZES_TO_ONE_TERMINAL_STATE",

    passed,

    expected: {
      failures: 0,
      finalStatusOneOf: [
        "FILLED",
        "EXPIRED",
      ],
      finalReservedRisk: 0,
    },

    observed: {
      failures: failures.length,
      results: settled.map((row) =>
        row.status === "fulfilled"
          ? row.value
          : {
              error:
                String(
                  row.reason?.message ??
                  row.reason
                ),
            }
      ),
      after,
    },
  };
}

async function verifyHarnessAbsent() {
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

  const names = [
    "expiry_test_seed_v1",
    "expiry_test_fill_v1",
    "expiry_test_expire_v1",
    "expiry_test_reconcile_v1",
    "expiry_test_get_order_v1",
    "expiry_test_reset_v1",
  ];

  const checks =
    Object.fromEntries(
      names.map(
        (name) => [
          name,
          !text.includes(name),
        ]
      )
    );

  return {
    genTypesExitCode:
      types.status,

    checks,

    passed:
      types.status === 0 &&
      Object.values(checks).every(Boolean),
  };
}

async function main() {
  const report = {
    status:
      "ALPHA_V3_EXPIRY_RECONCILIATION_APPLY_AND_ISOLATED_TEST_RUNNING",

    productionApply: null,
    harnessApply: null,
    scenarios: [],
    cleanup: null,
    error: null,

    safety: {
      productionOrdersCreated: 0,
      productionOrdersChanged: 0,
      productionPositionsChanged: 0,
      tradingExecuted: false,
    },
  };

  let harnessApplied = false;

  try {
    const verifier =
      runNodeScript(verifierRel);

    const verifierCombined =
      `${verifier.stdout ?? ""}\n${verifier.stderr ?? ""}`;

    const staticVerified =
      verifier.status === 0 &&
      verifierCombined.includes(
        "ALPHA_V3_COMMITTED_RISK_EXPIRY_RECONCILIATION_V2_VERIFIED"
      ) &&
      /"failed"\s*:\s*\[\s*\]/.test(
        verifierCombined
      );

    if (!staticVerified) {
      const error = new Error(
        "EXPIRY_RECONCILIATION_STATIC_VERIFY_FAILED"
      );

      error.output = tail(verifierCombined, 45);
      throw error;
    }

    const productionApply =
      pushExpected(productionMigration);

    const migrationList =
      runCli(
        [
          "migration",
          "list",
          "--linked",
        ],
        180000
      );

    const migrationListCombined =
      `${migrationList.stdout ?? ""}\n${migrationList.stderr ?? ""}`;

    const rows =
      parseMigrationRows(migrationListCombined);

    const targetRow =
      rows.find(
        (row) =>
          row.local === productionVersion ||
          row.remote === productionVersion
      ) ?? null;

    const targetHistoryApplied =
      Boolean(
        targetRow &&
        targetRow.local === productionVersion &&
        targetRow.remote === productionVersion
      );

    if (!targetHistoryApplied) {
      throw new Error(
        "EXPIRY_RECONCILIATION_MIGRATION_HISTORY_NOT_APPLIED"
      );
    }

    const postProduction =
      assertRemoteUpToDate();

    const generatedTypes =
      runCli(
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

    const typesText =
      String(generatedTypes.stdout ?? "");

    const productionFunctionsPresent =
      generatedTypes.status === 0 &&
      typesText.includes(
        "expire_stale_paper_buy_reservations_v3"
      ) &&
      typesText.includes(
        "reconcile_paper_buy_reserved_risk_v3"
      );

    if (!productionFunctionsPresent) {
      throw new Error(
        "PRODUCTION_EXPIRY_RECONCILIATION_FUNCTIONS_NOT_VISIBLE"
      );
    }

    report.productionApply = {
      staticVerified: true,
      ...productionApply,
      targetHistoryApplied,
      targetHistoryRow: targetRow,
      productionFunctionsPresent,
      ...postProduction,
    };

    writeExact(
      harnessPath,
      harnessSql,
      harnessMigration
    );

    report.harnessApply =
      pushExpected(harnessMigration);

    harnessApplied = true;

    report.scenarios.push(
      await scenarioStaleExpiresFreshSurvives()
    );

    report.scenarios.push(
      await scenarioTerminalReconciliation()
    );

    report.scenarios.push(
      await scenarioActiveAnomaliesReportOnly()
    );

    report.scenarios.push(
      await scenarioFillExpiryRace()
    );
  } catch (error) {
    report.error = {
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
        writeExact(
          cleanupPath,
          cleanupSql,
          cleanupMigration
        );

        const cleanupPush =
          pushExpected(cleanupMigration);

        const absent =
          await verifyHarnessAbsent();

        const finalDb =
          assertRemoteUpToDate();

        report.cleanup = {
          ...cleanupPush,
          harnessFunctionsAbsent: absent,
          ...finalDb,

          passed:
            absent.passed &&
            finalDb.remoteDatabaseUpToDate,
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
              cleanupError?.output ?? null,
          },
        };
      }
    }
  }

  const productionApplied =
    report.productionApply?.targetHistoryApplied === true &&
    report.productionApply?.productionFunctionsPresent === true &&
    report.productionApply?.remoteDatabaseUpToDate === true;

  const scenariosPassed =
    report.scenarios.length === 4 &&
    report.scenarios.every(
      (row) => row.passed
    );

  const cleanupPassed =
    harnessApplied
      ? report.cleanup?.passed === true
      : false;

  const verified =
    !report.error &&
    productionApplied &&
    scenariosPassed &&
    cleanupPassed;

  report.status =
    verified
      ? "ALPHA_V3_EXPIRY_RECONCILIATION_APPLY_AND_ISOLATED_TEST_VERIFIED"
      : "ALPHA_V3_EXPIRY_RECONCILIATION_APPLY_AND_ISOLATED_TEST_REVIEW";

  report.decision = {
    productionExpiryReconciliationApplied:
      productionApplied,

    scenariosPassed,

    cleanupPassed,

    expirySemanticsVerified:
      verified,

    reconciliationSemanticsVerified:
      verified,

    fillExpiryRaceVerified:
      verified,

    nextGate:
      verified
        ? "CHOOSE_EXPIRY_SLA_AND_INTEGRATE_MAINTENANCE_CALLER"
        : cleanupPassed
          ? "REVIEW_EXPIRY_RECONCILIATION_TEST_FAILURE"
          : "CLEANUP_EXPIRY_TEST_HARNESS_BEFORE_CONTINUING",
  };

  report.safety = {
    productionOrdersCreated: 0,
    productionOrdersChanged: 0,
    productionPositionsChanged: 0,
    tradingExecuted: false,
    testSchemaCleaned: cleanupPassed,
  };

  report.outputFile =
    "logs/alpha-v3-expiry-reconciliation-apply-and-isolated-test.json";

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

        productionExpiryReconciliationApplied:
          report.decision
            .productionExpiryReconciliationApplied,

        scenarios:
          report.scenarios.map(
            (row) => ({
              name: row.name,
              passed: row.passed,
              expected: row.expected,
              observed: row.observed,
            })
          ),

        cleanupPassed:
          report.decision.cleanupPassed,

        expirySemanticsVerified:
          report.decision
            .expirySemanticsVerified,

        reconciliationSemanticsVerified:
          report.decision
            .reconciliationSemanticsVerified,

        fillExpiryRaceVerified:
          report.decision
            .fillExpiryRaceVerified,

        productionOrdersCreated: 0,
        productionOrdersChanged: 0,
        productionPositionsChanged: 0,
        tradingExecuted: false,
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
          "ALPHA_V3_EXPIRY_RECONCILIATION_APPLY_AND_ISOLATED_TEST_FATAL",

        error:
          String(error?.message ?? error),

        productionOrdersCreated: 0,
        productionOrdersChanged: 0,
        productionPositionsChanged: 0,

        nextGate:
          "INSPECT_EXPIRY_RECONCILIATION_APPLY_AND_TEST_STATE",
      },
      null,
      2
    )
  );

  process.exitCode = 2;
});
