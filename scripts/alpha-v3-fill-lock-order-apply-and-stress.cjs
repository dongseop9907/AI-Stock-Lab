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
  "20261008000700_execute_paper_buy_order_lock_order_v2.sql";

const productionVersion =
  "20261008000700";

const verifierRel =
  "scripts/alpha-v3-fill-lock-order-hardening-verify.cjs";

const harnessMigration =
  "20261008000800_fill_lock_order_stress_harness.sql";

const cleanupMigration =
  "20261008000900_fill_lock_order_stress_harness_cleanup.sql";

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
  "logs/alpha-v3-fill-lock-order-apply-and-stress.json"
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
create schema if not exists ai_stock_lab_lock_order_test;

revoke all on schema ai_stock_lab_lock_order_test from public;
revoke all on schema ai_stock_lab_lock_order_test from anon;
revoke all on schema ai_stock_lab_lock_order_test from authenticated;

create table if not exists ai_stock_lab_lock_order_test.state (
  run_id uuid not null,
  account_key uuid not null,
  row_key uuid not null,
  reserve_count integer not null default 0,
  fill_count integer not null default 0,
  version integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (run_id, row_key)
);

create index if not exists fill_lock_order_test_account_idx
on ai_stock_lab_lock_order_test.state(run_id, account_key);

create or replace function public.fill_lock_order_test_setup_v1(
  p_run_id uuid,
  p_account_key uuid,
  p_row_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, ai_stock_lab_lock_order_test, pg_temp
as $$
begin
  insert into ai_stock_lab_lock_order_test.state (
    run_id,
    account_key,
    row_key
  )
  values (
    p_run_id,
    p_account_key,
    p_row_key
  )
  on conflict (run_id, row_key)
  do nothing;

  return pg_catalog.jsonb_build_object(
    'ok', true
  );
end;
$$;

create or replace function public.fill_lock_order_test_reserve_v1(
  p_run_id uuid,
  p_account_key uuid,
  p_row_key uuid,
  p_hold_ms integer default 25
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, ai_stock_lab_lock_order_test, pg_temp
as $$
declare
  v_row ai_stock_lab_lock_order_test.state%rowtype;
begin
  if p_hold_ms is null
     or p_hold_ms < 0
     or p_hold_ms > 500 then
    raise exception 'TEST_HOLD_MS_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(
      'AI_STOCK_LAB_COMMITTED_RISK_V3:' ||
      p_account_key::text
    )
  );

  select *
  into v_row
  from ai_stock_lab_lock_order_test.state
  where run_id = p_run_id
    and row_key = p_row_key
  for update;

  if not found then
    raise exception 'TEST_ROW_NOT_FOUND';
  end if;

  if v_row.account_key <> p_account_key then
    raise exception 'TEST_ACCOUNT_MISMATCH';
  end if;

  if p_hold_ms > 0 then
    perform pg_catalog.pg_sleep(
      p_hold_ms::numeric / 1000.0
    );
  end if;

  update ai_stock_lab_lock_order_test.state
  set
    reserve_count = reserve_count + 1,
    version = version + 1,
    updated_at = now()
  where run_id = p_run_id
    and row_key = p_row_key;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'operation', 'reserve'
  );
end;
$$;

create or replace function public.fill_lock_order_test_fill_v1(
  p_run_id uuid,
  p_account_key uuid,
  p_row_key uuid,
  p_hold_ms integer default 25
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, ai_stock_lab_lock_order_test, pg_temp
as $$
declare
  v_row ai_stock_lab_lock_order_test.state%rowtype;
begin
  if p_hold_ms is null
     or p_hold_ms < 0
     or p_hold_ms > 500 then
    raise exception 'TEST_HOLD_MS_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(
      'AI_STOCK_LAB_COMMITTED_RISK_V3:' ||
      p_account_key::text
    )
  );

  select *
  into v_row
  from ai_stock_lab_lock_order_test.state
  where run_id = p_run_id
    and row_key = p_row_key
  for update;

  if not found then
    raise exception 'TEST_ROW_NOT_FOUND';
  end if;

  if v_row.account_key <> p_account_key then
    raise exception 'TEST_ACCOUNT_MISMATCH';
  end if;

  if p_hold_ms > 0 then
    perform pg_catalog.pg_sleep(
      p_hold_ms::numeric / 1000.0
    );
  end if;

  update ai_stock_lab_lock_order_test.state
  set
    fill_count = fill_count + 1,
    version = version + 1,
    updated_at = now()
  where run_id = p_run_id
    and row_key = p_row_key;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'operation', 'fill'
  );
end;
$$;

create or replace function public.fill_lock_order_test_summary_v1(
  p_run_id uuid
)
returns jsonb
language sql
security definer
set search_path = pg_catalog, ai_stock_lab_lock_order_test, pg_temp
as $$
  select pg_catalog.jsonb_build_object(
    'rowCount', count(*),
    'reserveCount', coalesce(sum(reserve_count), 0),
    'fillCount', coalesce(sum(fill_count), 0),
    'version', coalesce(sum(version), 0)
  )
  from ai_stock_lab_lock_order_test.state
  where run_id = p_run_id;
$$;

create or replace function public.fill_lock_order_test_reset_v1(
  p_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, ai_stock_lab_lock_order_test, pg_temp
as $$
declare
  v_deleted integer;
begin
  delete from ai_stock_lab_lock_order_test.state
  where run_id = p_run_id;

  get diagnostics v_deleted = row_count;

  return pg_catalog.jsonb_build_object(
    'deleted', v_deleted
  );
end;
$$;

revoke all on function public.fill_lock_order_test_setup_v1(
  uuid, uuid, uuid
) from public;
revoke all on function public.fill_lock_order_test_setup_v1(
  uuid, uuid, uuid
) from anon;
revoke all on function public.fill_lock_order_test_setup_v1(
  uuid, uuid, uuid
) from authenticated;
grant execute on function public.fill_lock_order_test_setup_v1(
  uuid, uuid, uuid
) to service_role;

revoke all on function public.fill_lock_order_test_reserve_v1(
  uuid, uuid, uuid, integer
) from public;
revoke all on function public.fill_lock_order_test_reserve_v1(
  uuid, uuid, uuid, integer
) from anon;
revoke all on function public.fill_lock_order_test_reserve_v1(
  uuid, uuid, uuid, integer
) from authenticated;
grant execute on function public.fill_lock_order_test_reserve_v1(
  uuid, uuid, uuid, integer
) to service_role;

revoke all on function public.fill_lock_order_test_fill_v1(
  uuid, uuid, uuid, integer
) from public;
revoke all on function public.fill_lock_order_test_fill_v1(
  uuid, uuid, uuid, integer
) from anon;
revoke all on function public.fill_lock_order_test_fill_v1(
  uuid, uuid, uuid, integer
) from authenticated;
grant execute on function public.fill_lock_order_test_fill_v1(
  uuid, uuid, uuid, integer
) to service_role;

revoke all on function public.fill_lock_order_test_summary_v1(
  uuid
) from public;
revoke all on function public.fill_lock_order_test_summary_v1(
  uuid
) from anon;
revoke all on function public.fill_lock_order_test_summary_v1(
  uuid
) from authenticated;
grant execute on function public.fill_lock_order_test_summary_v1(
  uuid
) to service_role;

revoke all on function public.fill_lock_order_test_reset_v1(
  uuid
) from public;
revoke all on function public.fill_lock_order_test_reset_v1(
  uuid
) from anon;
revoke all on function public.fill_lock_order_test_reset_v1(
  uuid
) from authenticated;
grant execute on function public.fill_lock_order_test_reset_v1(
  uuid
) to service_role;
`.trim() + "\n";

const cleanupSql = String.raw`
drop function if exists public.fill_lock_order_test_reset_v1(uuid);
drop function if exists public.fill_lock_order_test_summary_v1(uuid);
drop function if exists public.fill_lock_order_test_fill_v1(
  uuid, uuid, uuid, integer
);
drop function if exists public.fill_lock_order_test_reserve_v1(
  uuid, uuid, uuid, integer
);
drop function if exists public.fill_lock_order_test_setup_v1(
  uuid, uuid, uuid
);

drop schema if exists ai_stock_lab_lock_order_test cascade;
`.trim() + "\n";

async function setup(runId, accountKey, rowKey) {
  return rpc(
    "fill_lock_order_test_setup_v1",
    {
      p_run_id: runId,
      p_account_key: accountKey,
      p_row_key: rowKey,
    }
  );
}

async function reserve(runId, accountKey, rowKey, holdMs) {
  const started = Date.now();

  const result = await rpc(
    "fill_lock_order_test_reserve_v1",
    {
      p_run_id: runId,
      p_account_key: accountKey,
      p_row_key: rowKey,
      p_hold_ms: holdMs,
    }
  );

  return {
    ...result,
    durationMs: Date.now() - started,
  };
}

async function fill(runId, accountKey, rowKey, holdMs) {
  const started = Date.now();

  const result = await rpc(
    "fill_lock_order_test_fill_v1",
    {
      p_run_id: runId,
      p_account_key: accountKey,
      p_row_key: rowKey,
      p_hold_ms: holdMs,
    }
  );

  return {
    ...result,
    durationMs: Date.now() - started,
  };
}

async function summary(runId) {
  return rpc(
    "fill_lock_order_test_summary_v1",
    {
      p_run_id: runId,
    }
  );
}

async function reset(runId) {
  return rpc(
    "fill_lock_order_test_reset_v1",
    {
      p_run_id: runId,
    }
  );
}

async function sameRowMixedStress() {
  const runId = randomUuid();
  const accountKey = randomUuid();
  const rowKey = randomUuid();

  await setup(runId, accountKey, rowKey);

  const tasks = [];

  for (let i = 0; i < 20; i += 1) {
    tasks.push(
      reserve(
        runId,
        accountKey,
        rowKey,
        25
      )
    );

    tasks.push(
      fill(
        runId,
        accountKey,
        rowKey,
        25
      )
    );
  }

  const started = Date.now();

  const settled =
    await Promise.allSettled(tasks);

  const wallMs =
    Date.now() - started;

  const rejected =
    settled.filter(
      (row) =>
        row.status === "rejected"
    );

  const s =
    await summary(runId);

  const passed =
    rejected.length === 0 &&
    Number(s.rowCount) === 1 &&
    Number(s.reserveCount) === 20 &&
    Number(s.fillCount) === 20 &&
    Number(s.version) === 40;

  await reset(runId);

  return {
    name:
      "SAME_ROW_RESERVE_FILL_MIXED_STRESS",

    passed,

    expected: {
      reserveCalls: 20,
      fillCalls: 20,
      failures: 0,
      finalVersion: 40,
    },

    observed: {
      failures: rejected.length,
      summary: s,
      wallMs,
      maxCallDurationMs:
        Math.max(
          ...settled
            .filter(
              (row) =>
                row.status === "fulfilled"
            )
            .map(
              (row) =>
                row.value.durationMs
            )
        ),
      errorMessages:
        rejected
          .slice(0, 5)
          .map(
            (row) =>
              String(
                row.reason?.message ??
                row.reason
              )
          ),
    },
  };
}

async function sameAccountDifferentRowsStress() {
  const runId = randomUuid();
  const accountKey = randomUuid();
  const rowA = randomUuid();
  const rowB = randomUuid();

  await setup(runId, accountKey, rowA);
  await setup(runId, accountKey, rowB);

  const tasks = [];

  for (let i = 0; i < 12; i += 1) {
    tasks.push(
      reserve(
        runId,
        accountKey,
        rowA,
        20
      )
    );

    tasks.push(
      fill(
        runId,
        accountKey,
        rowB,
        20
      )
    );
  }

  const settled =
    await Promise.allSettled(tasks);

  const rejected =
    settled.filter(
      (row) =>
        row.status === "rejected"
    );

  const s =
    await summary(runId);

  const passed =
    rejected.length === 0 &&
    Number(s.rowCount) === 2 &&
    Number(s.reserveCount) === 12 &&
    Number(s.fillCount) === 12 &&
    Number(s.version) === 24;

  await reset(runId);

  return {
    name:
      "SAME_ACCOUNT_DIFFERENT_ROWS_SHARED_LOCK_STRESS",

    passed,

    expected: {
      failures: 0,
      reserveCount: 12,
      fillCount: 12,
      finalVersion: 24,
    },

    observed: {
      failures: rejected.length,
      summary: s,
      errorMessages:
        rejected
          .slice(0, 5)
          .map(
            (row) =>
              String(
                row.reason?.message ??
                row.reason
              )
          ),
    },
  };
}

async function separateAccountsStress() {
  const runId = randomUuid();

  const accountA = randomUuid();
  const accountB = randomUuid();

  const rowA = randomUuid();
  const rowB = randomUuid();

  await setup(runId, accountA, rowA);
  await setup(runId, accountB, rowB);

  const tasks = [];

  for (let i = 0; i < 10; i += 1) {
    tasks.push(
      reserve(
        runId,
        accountA,
        rowA,
        20
      )
    );

    tasks.push(
      fill(
        runId,
        accountB,
        rowB,
        20
      )
    );
  }

  const settled =
    await Promise.allSettled(tasks);

  const rejected =
    settled.filter(
      (row) =>
        row.status === "rejected"
    );

  const s =
    await summary(runId);

  const passed =
    rejected.length === 0 &&
    Number(s.rowCount) === 2 &&
    Number(s.reserveCount) === 10 &&
    Number(s.fillCount) === 10 &&
    Number(s.version) === 20;

  await reset(runId);

  return {
    name:
      "SEPARATE_ACCOUNTS_NO_CROSS_LOCK_CORRUPTION",

    passed,

    expected: {
      failures: 0,
      reserveCount: 10,
      fillCount: 10,
      finalVersion: 20,
    },

    observed: {
      failures: rejected.length,
      summary: s,
      errorMessages:
        rejected
          .slice(0, 5)
          .map(
            (row) =>
              String(
                row.reason?.message ??
                row.reason
              )
          ),
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
    "fill_lock_order_test_setup_v1",
    "fill_lock_order_test_reserve_v1",
    "fill_lock_order_test_fill_v1",
    "fill_lock_order_test_summary_v1",
    "fill_lock_order_test_reset_v1",
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
      "ALPHA_V3_FILL_LOCK_ORDER_APPLY_AND_STRESS_RUNNING",

    productionApply: null,
    stressHarness: null,
    scenarios: [],
    cleanup: null,
    error: null,

    safety: {
      productionOrdersCreated: 0,
      productionPositionsChanged: 0,
      tradingExecuted: false,
    },
  };

  let harnessApplied = false;

  try {
    /*
     * 1) Static verifier.
     */
    const verifier = runNodeScript(
      verifierRel
    );

    const verifierCombined =
      `${verifier.stdout ?? ""}\n${verifier.stderr ?? ""}`;

    const staticVerified =
      verifier.status === 0 &&
      verifierCombined.includes(
        "ALPHA_V3_FILL_LOCK_ORDER_HARDENING_VERIFIED"
      ) &&
      /"failed"\s*:\s*\[\s*\]/.test(
        verifierCombined
      );

    if (!staticVerified) {
      const error = new Error(
        "STATIC_LOCK_ORDER_VERIFY_FAILED"
      );

      error.output = tail(verifierCombined, 40);
      throw error;
    }

    /*
     * 2) Apply the production lock-order migration only.
     */
    const productionApply =
      pushExpected(
        productionMigration
      );

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
      parseMigrationRows(
        migrationListCombined
      );

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
        "PRODUCTION_LOCK_ORDER_MIGRATION_HISTORY_NOT_APPLIED"
      );
    }

    const postProduction =
      assertRemoteUpToDate();

    report.productionApply = {
      staticVerified: true,
      ...productionApply,
      targetHistoryApplied,
      targetHistoryRow: targetRow,
      ...postProduction,
    };

    /*
     * 3) Install isolated stress harness.
     */
    writeExact(
      harnessPath,
      harnessSql,
      harnessMigration
    );

    report.stressHarness =
      pushExpected(
        harnessMigration
      );

    harnessApplied = true;

    /*
     * 4) Concurrency stress.
     */
    report.scenarios.push(
      await sameRowMixedStress()
    );

    report.scenarios.push(
      await sameAccountDifferentRowsStress()
    );

    report.scenarios.push(
      await separateAccountsStress()
    );
  } catch (error) {
    report.error = {
      message:
        String(
          error?.message ??
          error
        ),

      details:
        error?.details ??
        null,

      output:
        error?.output ??
        null,

      stack:
        String(
          error?.stack ??
          ""
        )
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
          pushExpected(
            cleanupMigration
          );

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
              cleanupError?.output ??
              null,
          },
        };
      }
    }
  }

  const productionApplied =
    report.productionApply?.targetHistoryApplied === true &&
    report.productionApply?.remoteDatabaseUpToDate === true;

  const scenariosPassed =
    report.scenarios.length === 3 &&
    report.scenarios.every(
      (row) =>
        row.passed
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
      ? "ALPHA_V3_FILL_LOCK_ORDER_APPLY_AND_STRESS_VERIFIED"
      : "ALPHA_V3_FILL_LOCK_ORDER_APPLY_AND_STRESS_REVIEW";

  report.decision = {
    productionLockOrderApplied:
      productionApplied,

    stressScenariosPassed:
      scenariosPassed,

    deadlockErrorsObserved:
      report.scenarios
        .flatMap(
          (row) =>
            row.observed?.errorMessages ?? []
        )
        .filter(
          (message) =>
            /deadlock/i.test(message)
        ).length,

    cleanupPassed,

    canonicalLockOrderVerified:
      verified,

    nextGate:
      verified
        ? "BEGIN_COMMITTED_RISK_EXPIRY_AND_RECONCILIATION"
        : cleanupPassed
          ? "REVIEW_LOCK_ORDER_STRESS_FAILURE"
          : "CLEANUP_LOCK_ORDER_TEST_HARNESS_BEFORE_CONTINUING",
  };

  report.safety = {
    productionOrdersCreated: 0,
    productionPositionsChanged: 0,
    tradingExecuted: false,
    testSchemaCleaned: cleanupPassed,
  };

  report.outputFile =
    "logs/alpha-v3-fill-lock-order-apply-and-stress.json";

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

        productionLockOrderApplied:
          report.decision
            .productionLockOrderApplied,

        scenarios:
          report.scenarios.map(
            (row) => ({
              name: row.name,
              passed: row.passed,
              expected: row.expected,
              observed: row.observed,
            })
          ),

        deadlockErrorsObserved:
          report.decision
            .deadlockErrorsObserved,

        cleanupPassed:
          report.decision
            .cleanupPassed,

        canonicalLockOrderVerified:
          report.decision
            .canonicalLockOrderVerified,

        productionOrdersCreated: 0,
        productionPositionsChanged: 0,
        tradingExecuted: false,
        testSchemaCleaned:
          report.safety
            .testSchemaCleaned,

        nextGate:
          report.decision
            .nextGate,

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
          "ALPHA_V3_FILL_LOCK_ORDER_APPLY_AND_STRESS_FATAL",

        error:
          String(error?.message ?? error),

        productionOrdersCreated: 0,
        productionPositionsChanged: 0,

        nextGate:
          "INSPECT_LOCK_ORDER_APPLY_AND_TEST_STATE",
      },
      null,
      2
    )
  );

  process.exitCode = 2;
});
