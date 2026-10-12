const fs = require("fs");
const path = require("path");
const { spawnSync } = require("node:child_process");
const crypto = require("crypto");

const root = process.cwd();

const cli =
  path.resolve(
    root,
    "node_modules/.bin/supabase.cmd"
  );

const addMigrationName =
  "20261008000200_committed_risk_concurrency_test_harness.sql";

const cleanupMigrationName =
  "20261008000300_committed_risk_concurrency_test_harness_cleanup.sql";

const addMigrationPath =
  path.resolve(
    root,
    "supabase/migrations",
    addMigrationName
  );

const cleanupMigrationPath =
  path.resolve(
    root,
    "supabase/migrations",
    cleanupMigrationName
  );

const reportFile =
  path.resolve(
    root,
    "logs/alpha-v3-isolated-committed-risk-concurrency-harness.json"
  );

const reserveRpc =
  "committed_risk_concurrency_test_reserve_v1";

const summaryRpc =
  "committed_risk_concurrency_test_summary_v1";

const resetRpc =
  "committed_risk_concurrency_test_reset_v1";

function quoteCmdArg(value) {
  const text = String(value);

  if (/^[A-Za-z0-9_./:\\=-]+$/.test(text)) {
    return text;
  }

  return `"${text.replace(/"/g, '""')}"`;
}

function runCli(args, timeout = 240000) {
  if (!fs.existsSync(cli)) {
    throw new Error(
      "LOCAL_SUPABASE_CLI_NOT_FOUND"
    );
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
  const lines =
    String(text ?? "")
      .replace(/\x1b\[[0-9;]*m/g, "")
      .split(/\r?\n/);

  const files = [];

  let inWouldPush =
    false;

  for (const raw of lines) {
    const line =
      raw.trim();

    if (
      /Would push these migrations:/i.test(
        line
      )
    ) {
      inWouldPush =
        true;
      continue;
    }

    if (
      /Remote database is up to date/i.test(
        line
      )
    ) {
      inWouldPush =
        false;
      continue;
    }

    if (!inWouldPush) {
      continue;
    }

    const match =
      line.match(
        /([0-9]{3,14}_[A-Za-z0-9_.-]+\.sql)\s*$/
      );

    if (match) {
      files.push(
        match[1]
      );
    }
  }

  return [
    ...new Set(files),
  ].sort();
}

function parseEnvFile(rel) {
  const file =
    path.resolve(root, rel);

  const result = {};

  if (!fs.existsSync(file)) {
    return result;
  }

  for (
    const raw
    of fs
      .readFileSync(file, "utf8")
      .split(/\r?\n/)
  ) {
    const line =
      raw.trim();

    if (
      !line ||
      line.startsWith("#") ||
      !line.includes("=")
    ) {
      continue;
    }

    const idx =
      line.indexOf("=");

    const key =
      line.slice(0, idx).trim();

    let value =
      line.slice(idx + 1).trim();

    if (
      (value.startsWith('"') &&
        value.endsWith('"')) ||
      (value.startsWith("'") &&
        value.endsWith("'"))
    ) {
      value =
        value.slice(1, -1);
    }

    result[key] =
      value;
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

if (
  !supabaseUrl ||
  !serviceRoleKey
) {
  throw new Error(
    "SUPABASE_URL_OR_SERVICE_ROLE_KEY_MISSING"
  );
}

function randomUuid() {
  return crypto.randomUUID();
}

async function rpc(name, body) {
  const response =
    await fetch(
      `${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/${name}`,
      {
        method: "POST",
        headers: {
          apikey:
            serviceRoleKey,

          Authorization:
            `Bearer ${serviceRoleKey}`,

          "Content-Type":
            "application/json",
        },
        body:
          JSON.stringify(body),
      }
    );

  const text =
    await response.text();

  let parsed =
    null;

  try {
    parsed =
      text
        ? JSON.parse(text)
        : null;
  } catch {
    parsed =
      text;
  }

  if (!response.ok) {
    const error =
      new Error(
        `RPC_FAILED:${name}:${response.status}`
      );

    error.details = parsed;

    throw error;
  }

  return parsed;
}

async function resetRun(runId) {
  return rpc(
    resetRpc,
    {
      p_run_id:
        runId,
    }
  );
}

async function summary(
  runId,
  accountKey
) {
  return rpc(
    summaryRpc,
    {
      p_run_id:
        runId,

      p_account_key:
        accountKey,
    }
  );
}

async function reserve({
  runId,
  accountKey,
  requestId,
  equity,
  proposedRisk,
  rate = 0.02,
  holdMs = 35,
}) {
  const started =
    Date.now();

  const result =
    await rpc(
      reserveRpc,
      {
        p_run_id:
          runId,

        p_account_key:
          accountKey,

        p_request_id:
          requestId,

        p_equity:
          equity,

        p_proposed_risk:
          proposedRisk,

        p_budget_rate:
          rate,

        p_hold_ms:
          holdMs,
      }
    );

  return {
    ...result,
    clientDurationMs:
      Date.now() - started,
  };
}

const addMigration = String.raw`
create schema if not exists ai_stock_lab_test;
revoke all on schema ai_stock_lab_test from public;
revoke all on schema ai_stock_lab_test from anon;
revoke all on schema ai_stock_lab_test from authenticated;

create table if not exists ai_stock_lab_test.committed_risk_reservations (
  run_id uuid not null,
  account_key uuid not null,
  request_id uuid not null,
  proposed_risk numeric not null,
  reserved_risk numeric not null default 0,
  approved boolean not null,
  committed_before numeric not null,
  committed_after numeric not null,
  budget numeric not null,
  created_at timestamptz not null default now(),
  primary key (run_id, request_id)
);

create index if not exists committed_risk_test_run_account_idx
on ai_stock_lab_test.committed_risk_reservations(run_id, account_key);

create or replace function public.committed_risk_concurrency_test_reserve_v1(
  p_run_id uuid,
  p_account_key uuid,
  p_request_id uuid,
  p_equity numeric,
  p_proposed_risk numeric,
  p_budget_rate numeric default 0.02,
  p_hold_ms integer default 35
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, ai_stock_lab_test, pg_temp
as $$
declare
  v_existing ai_stock_lab_test.committed_risk_reservations%rowtype;
  v_budget numeric;
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
  into v_existing
  from ai_stock_lab_test.committed_risk_reservations
  where run_id = p_run_id
    and request_id = p_request_id
  limit 1;

  if found then
    return pg_catalog.jsonb_build_object(
      'idempotent', true,
      'approved', v_existing.approved,
      'requestId', v_existing.request_id,
      'proposedRisk', v_existing.proposed_risk,
      'reservedRisk', v_existing.reserved_risk,
      'committedRiskBefore', v_existing.committed_before,
      'committedRiskAfter', v_existing.committed_after,
      'budget', v_existing.budget
    );
  end if;

  if p_hold_ms > 0 then
    perform pg_catalog.pg_sleep(
      p_hold_ms::numeric / 1000.0
    );
  end if;

  v_budget :=
    p_equity * p_budget_rate;

  select coalesce(sum(reserved_risk), 0)
  into v_before
  from ai_stock_lab_test.committed_risk_reservations
  where run_id = p_run_id
    and account_key = p_account_key
    and approved = true;

  v_approved :=
    v_before + p_proposed_risk <= v_budget;

  v_after :=
    v_before +
    case
      when v_approved
        then p_proposed_risk
      else 0
    end;

  insert into ai_stock_lab_test.committed_risk_reservations (
    run_id,
    account_key,
    request_id,
    proposed_risk,
    reserved_risk,
    approved,
    committed_before,
    committed_after,
    budget
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
    v_before,
    v_after,
    v_budget
  );

  return pg_catalog.jsonb_build_object(
    'idempotent', false,
    'approved', v_approved,
    'requestId', p_request_id,
    'proposedRisk', p_proposed_risk,
    'reservedRisk',
      case
        when v_approved
          then p_proposed_risk
        else 0
      end,
    'committedRiskBefore', v_before,
    'committedRiskAfter', v_after,
    'budget', v_budget
  );
end;
$$;

create or replace function public.committed_risk_concurrency_test_summary_v1(
  p_run_id uuid,
  p_account_key uuid
)
returns jsonb
language sql
security definer
set search_path = pg_catalog, ai_stock_lab_test, pg_temp
as $$
  select pg_catalog.jsonb_build_object(
    'rowCount', count(*),
    'approvedCount',
      count(*) filter (where approved),
    'rejectedCount',
      count(*) filter (where not approved),
    'reservedRisk',
      coalesce(sum(reserved_risk), 0),
    'maxCommittedAfter',
      coalesce(max(committed_after), 0),
    'budget',
      coalesce(max(budget), 0)
  )
  from ai_stock_lab_test.committed_risk_reservations
  where run_id = p_run_id
    and account_key = p_account_key;
$$;

create or replace function public.committed_risk_concurrency_test_reset_v1(
  p_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, ai_stock_lab_test, pg_temp
as $$
declare
  v_deleted integer;
begin
  delete from ai_stock_lab_test.committed_risk_reservations
  where run_id = p_run_id;

  get diagnostics v_deleted = row_count;

  return pg_catalog.jsonb_build_object(
    'deleted', v_deleted
  );
end;
$$;

revoke all on function public.committed_risk_concurrency_test_reserve_v1(
  uuid, uuid, uuid, numeric, numeric, numeric, integer
) from public;
revoke all on function public.committed_risk_concurrency_test_reserve_v1(
  uuid, uuid, uuid, numeric, numeric, numeric, integer
) from anon;
revoke all on function public.committed_risk_concurrency_test_reserve_v1(
  uuid, uuid, uuid, numeric, numeric, numeric, integer
) from authenticated;
grant execute on function public.committed_risk_concurrency_test_reserve_v1(
  uuid, uuid, uuid, numeric, numeric, numeric, integer
) to service_role;

revoke all on function public.committed_risk_concurrency_test_summary_v1(
  uuid, uuid
) from public;
revoke all on function public.committed_risk_concurrency_test_summary_v1(
  uuid, uuid
) from anon;
revoke all on function public.committed_risk_concurrency_test_summary_v1(
  uuid, uuid
) from authenticated;
grant execute on function public.committed_risk_concurrency_test_summary_v1(
  uuid, uuid
) to service_role;

revoke all on function public.committed_risk_concurrency_test_reset_v1(
  uuid
) from public;
revoke all on function public.committed_risk_concurrency_test_reset_v1(
  uuid
) from anon;
revoke all on function public.committed_risk_concurrency_test_reset_v1(
  uuid
) from authenticated;
grant execute on function public.committed_risk_concurrency_test_reset_v1(
  uuid
) to service_role;
`.trim() + "\n";

const cleanupMigration = String.raw`
drop function if exists public.committed_risk_concurrency_test_reset_v1(uuid);
drop function if exists public.committed_risk_concurrency_test_summary_v1(uuid, uuid);
drop function if exists public.committed_risk_concurrency_test_reserve_v1(
  uuid, uuid, uuid, numeric, numeric, numeric, integer
);

drop schema if exists ai_stock_lab_test cascade;
`.trim() + "\n";

function writeAddMigration() {
  if (
    fs.existsSync(addMigrationPath)
  ) {
    const current =
      fs.readFileSync(
        addMigrationPath,
        "utf8"
      );

    if (current !== addMigration) {
      throw new Error(
        `ADD_MIGRATION_ALREADY_EXISTS_WITH_DIFFERENT_CONTENT:${addMigrationName}`
      );
    }

    return;
  }

  fs.writeFileSync(
    addMigrationPath,
    addMigration,
    "utf8"
  );
}

function writeCleanupMigration() {
  if (
    fs.existsSync(cleanupMigrationPath)
  ) {
    const current =
      fs.readFileSync(
        cleanupMigrationPath,
        "utf8"
      );

    if (current !== cleanupMigration) {
      throw new Error(
        `CLEANUP_MIGRATION_ALREADY_EXISTS_WITH_DIFFERENT_CONTENT:${cleanupMigrationName}`
      );
    }

    return;
  }

  fs.writeFileSync(
    cleanupMigrationPath,
    cleanupMigration,
    "utf8"
  );
}

function assertNoProductionTableReferences() {
  const forbidden = [
    "paper_order_requests",
    "paper_positions",
    "paper_accounts",
    "risk_decisions",
    "paper_trade_history",
  ];

  const bad =
    forbidden.filter(
      (name) =>
        new RegExp(
          `\\b${name}\\b`,
          "i"
        ).test(
          addMigration
        )
    );

  if (bad.length > 0) {
    throw new Error(
      `HARNESS_REFERENCES_PRODUCTION_TABLES:${bad.join(",")}`
    );
  }
}

function requireOnlyPending(
  expectedFile
) {
  const result =
    runCli(
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

  const pending =
    extractPendingSqlFiles(
      combined
    );

  if (
    result.status !== 0 ||
    pending.length !== 1 ||
    pending[0] !== expectedFile
  ) {
    const error =
      new Error(
        `UNEXPECTED_PENDING_MIGRATIONS:${JSON.stringify(pending)}`
      );

    error.output =
      tail(combined, 40);

    throw error;
  }

  return {
    pending,
    outputTail:
      tail(combined, 25),
  };
}

function pushExpected(
  expectedFile
) {
  const dry =
    requireOnlyPending(
      expectedFile
    );

  const push =
    runCli(
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

  if (
    push.status !== 0
  ) {
    const error =
      new Error(
        `DB_PUSH_FAILED:${expectedFile}`
      );

    error.output =
      tail(combined, 40);

    throw error;
  }

  return {
    dryRun:
      dry,
    pushOutputTail:
      tail(combined, 30),
  };
}

async function runScenarioOversubscription() {
  const runId =
    randomUuid();

  const accountKey =
    randomUuid();

  const equity =
    10_000_000;

  const proposedRisk =
    60_000;

  const requestIds =
    Array.from(
      { length: 20 },
      () => randomUuid()
    );

  const calls =
    await Promise.all(
      requestIds.map(
        (requestId) =>
          reserve({
            runId,
            accountKey,
            requestId,
            equity,
            proposedRisk,
            holdMs: 35,
          })
      )
    );

  const s =
    await summary(
      runId,
      accountKey
    );

  const approved =
    calls.filter(
      (row) =>
        row.approved === true
    );

  const passed =
    approved.length === 3 &&
    Number(s.approvedCount) === 3 &&
    Number(s.reservedRisk) ===
      180_000 &&
    Number(s.maxCommittedAfter) <=
      200_000 &&
    Number(s.budget) ===
      200_000;

  await resetRun(runId);

  return {
    name:
      "OVERSUBSCRIPTION_BLOCK",

    passed,

    expected: {
      concurrentRequests:
        20,

      proposedRiskEach:
        proposedRisk,

      budget:
        200_000,

      approvedCount:
        3,

      reservedRisk:
        180_000,
    },

    observed: {
      approvedCount:
        approved.length,

      rejectedCount:
        calls.length -
        approved.length,

      summary:
        s,

      maxClientDurationMs:
        Math.max(
          ...calls.map(
            (row) =>
              row.clientDurationMs
          )
        ),
    },
  };
}

async function runScenarioExactBoundary() {
  const runId =
    randomUuid();

  const accountKey =
    randomUuid();

  const equity =
    10_000_000;

  const proposedRisk =
    50_000;

  const calls =
    await Promise.all(
      Array.from(
        { length: 5 },
        () =>
          reserve({
            runId,
            accountKey,
            requestId:
              randomUuid(),
            equity,
            proposedRisk,
            holdMs: 35,
          })
      )
    );

  const s =
    await summary(
      runId,
      accountKey
    );

  const approved =
    calls.filter(
      (row) =>
        row.approved === true
    );

  const passed =
    approved.length === 4 &&
    Number(s.approvedCount) === 4 &&
    Number(s.reservedRisk) ===
      200_000 &&
    Number(s.maxCommittedAfter) ===
      200_000 &&
    Number(s.budget) ===
      200_000;

  await resetRun(runId);

  return {
    name:
      "EXACT_BUDGET_BOUNDARY",

    passed,

    expected: {
      concurrentRequests:
        5,

      proposedRiskEach:
        proposedRisk,

      approvedCount:
        4,

      reservedRisk:
        200_000,
    },

    observed: {
      approvedCount:
        approved.length,

      rejectedCount:
        calls.length -
        approved.length,

      summary:
        s,
    },
  };
}

async function runScenarioIdempotency() {
  const runId =
    randomUuid();

  const accountKey =
    randomUuid();

  const requestId =
    randomUuid();

  const calls =
    await Promise.all(
      Array.from(
        { length: 10 },
        () =>
          reserve({
            runId,
            accountKey,
            requestId,
            equity:
              10_000_000,

            proposedRisk:
              70_000,

            holdMs:
              35,
          })
      )
    );

  const s =
    await summary(
      runId,
      accountKey
    );

  const requestIds =
    [
      ...new Set(
        calls.map(
          (row) =>
            row.requestId
        )
      ),
    ];

  const nonIdempotentCount =
    calls.filter(
      (row) =>
        row.idempotent === false
    ).length;

  const passed =
    requestIds.length === 1 &&
    nonIdempotentCount === 1 &&
    Number(s.rowCount) === 1 &&
    Number(s.approvedCount) === 1 &&
    Number(s.reservedRisk) ===
      70_000;

  await resetRun(runId);

  return {
    name:
      "CONCURRENT_RETRY_IDEMPOTENCY",

    passed,

    expected: {
      calls:
        10,

      physicalRows:
        1,

      reservedRisk:
        70_000,

      nonIdempotentResponses:
        1,
    },

    observed: {
      uniqueRequestIds:
        requestIds.length,

      nonIdempotentCount,

      summary:
        s,
    },
  };
}

async function runScenarioAccountIsolation() {
  const runId =
    randomUuid();

  const accountA =
    randomUuid();

  const accountB =
    randomUuid();

  const tasks = [];

  for (
    const accountKey
    of [
      accountA,
      accountB,
    ]
  ) {
    for (
      let i = 0;
      i < 4;
      i += 1
    ) {
      tasks.push(
        reserve({
          runId,
          accountKey,
          requestId:
            randomUuid(),

          equity:
            10_000_000,

          proposedRisk:
            60_000,

          holdMs:
            35,
        })
      );
    }
  }

  const calls =
    await Promise.all(
      tasks
    );

  const a =
    await summary(
      runId,
      accountA
    );

  const b =
    await summary(
      runId,
      accountB
    );

  const passed =
    Number(a.approvedCount) === 3 &&
    Number(a.reservedRisk) ===
      180_000 &&
    Number(b.approvedCount) === 3 &&
    Number(b.reservedRisk) ===
      180_000;

  await resetRun(runId);

  return {
    name:
      "ACCOUNT_SCOPED_LOCK_ISOLATION",

    passed,

    expected: {
      eachAccountApproved:
        3,

      eachAccountReservedRisk:
        180_000,
    },

    observed: {
      accountA:
        a,

      accountB:
        b,

      totalCalls:
        calls.length,
    },
  };
}

async function verifyFunctionsAbsentAfterCleanup() {
  const types =
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

  const text =
    String(
      types.stdout ?? ""
    );

  return {
    genTypesExitCode:
      types.status,

    reserveRpcAbsent:
      !text.includes(
        reserveRpc
      ),

    summaryRpcAbsent:
      !text.includes(
        summaryRpc
      ),

    resetRpcAbsent:
      !text.includes(
        resetRpc
      ),

    passed:
      types.status === 0 &&
      !text.includes(
        reserveRpc
      ) &&
      !text.includes(
        summaryRpc
      ) &&
      !text.includes(
        resetRpc
      ),
  };
}

async function main() {
  const report = {
    status:
      "ALPHA_V3_ISOLATED_COMMITTED_RISK_CONCURRENCY_HARNESS_RUNNING",

    harness: {
      addMigration:
        addMigrationName,

      cleanupMigration:
        cleanupMigrationName,

      productionTablesReferenced:
        false,
    },

    apply:
      null,

    scenarios:
      [],

    cleanup:
      null,

    safety: {
      productionOrdersCreated:
        0,

      productionPositionsChanged:
        0,

      productionOrderTablesReferencedByHarness:
        false,
    },
  };

  let harnessApplied =
    false;

  let cleanupAttempted =
    false;

  let testError =
    null;

  try {
    assertNoProductionTableReferences();

    const baselineDry =
      runCli(
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

    writeAddMigration();

    report.apply =
      pushExpected(
        addMigrationName
      );

    harnessApplied =
      true;

    report.scenarios.push(
      await runScenarioOversubscription()
    );

    report.scenarios.push(
      await runScenarioExactBoundary()
    );

    report.scenarios.push(
      await runScenarioIdempotency()
    );

    report.scenarios.push(
      await runScenarioAccountIsolation()
    );
  } catch (error) {
    testError = {
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
      cleanupAttempted =
        true;

      try {
        writeCleanupMigration();

        const cleanupPush =
          pushExpected(
            cleanupMigrationName
          );

        const absence =
          await verifyFunctionsAbsentAfterCleanup();

        const finalDry =
          runCli(
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
          passed:
            false,

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
      (row) =>
        row.passed
    );

  const cleanupPassed =
    harnessApplied
      ? report.cleanup?.passed ===
        true
      : !cleanupAttempted;

  const verified =
    !testError &&
    allScenariosPassed &&
    cleanupPassed;

  report.status =
    verified
      ? "ALPHA_V3_ISOLATED_COMMITTED_RISK_CONCURRENCY_HARNESS_VERIFIED"
      : "ALPHA_V3_ISOLATED_COMMITTED_RISK_CONCURRENCY_HARNESS_REVIEW";

  report.testError =
    testError;

  report.decision = {
    allScenariosPassed,

    cleanupPassed,

    atomicReservationConcurrencyVerified:
      verified,

    productionTablesTouchedByHarness:
      false,

    nextGate:
      verified
        ? "HARDEN_FILL_TRANSITION_WITH_SHARED_ACCOUNT_LOCK"
        : cleanupPassed
          ? "REVIEW_CONCURRENCY_TEST_FAILURE"
          : "CLEANUP_TEST_HARNESS_BEFORE_CONTINUING",
  };

  report.safety = {
    productionOrdersCreated:
      0,

    productionPositionsChanged:
      0,

    productionOrderTablesReferencedByHarness:
      false,

    testSchemaCleaned:
      cleanupPassed,
  };

  report.outputFile =
    "logs/alpha-v3-isolated-committed-risk-concurrency-harness.json";

  fs.mkdirSync(
    path.dirname(
      reportFile
    ),
    {
      recursive: true,
    }
  );

  fs.writeFileSync(
    reportFile,
    JSON.stringify(
      report,
      null,
      2
    ) + "\n",
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
              name:
                row.name,

              passed:
                row.passed,

              expected:
                row.expected,

              observed:
                row.observed,
            })
          ),

        testError:
          report.testError,

        cleanupPassed:
          report.decision.cleanupPassed,

        atomicReservationConcurrencyVerified:
          report.decision
            .atomicReservationConcurrencyVerified,

        productionOrdersCreated:
          0,

        productionPositionsChanged:
          0,

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
    process.exitCode =
      2;
  }
}

main().catch(
  (error) => {
    console.error(
      JSON.stringify(
        {
          status:
            "ALPHA_V3_ISOLATED_COMMITTED_RISK_CONCURRENCY_HARNESS_FATAL",

          error:
            String(
              error?.message ??
              error
            ),

          databaseWritesMayHaveOccurred:
            true,

          nextGate:
            "INSPECT_TEST_HARNESS_STATE_BEFORE_CONTINUING",
        },
        null,
        2
      )
    );

    process.exitCode =
      2;
  }
);
