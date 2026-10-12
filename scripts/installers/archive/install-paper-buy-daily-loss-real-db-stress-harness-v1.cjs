const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const MIG_DIR = path.join(ROOT, "supabase", "migrations");
const SCRIPT_DIR = path.join(ROOT, "scripts");

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status: "AI_STOCK_LAB_DAILY_LOSS_REAL_DB_STRESS_HARNESS_V1_INSTALL_FAILED",
    reason,
    ...extra,
  }, null, 2));
  process.exitCode = 1;
}

if (!fs.existsSync(MIG_DIR)) {
  fail("MIGRATION_DIRECTORY_NOT_FOUND");
} else {
  const sqlFiles = fs.readdirSync(MIG_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  const dailyLossMigration = sqlFiles
    .filter((name) => name.endsWith("_paper_buy_db_daily_loss_defense_v1.sql"))
    .pop();

  if (!dailyLossMigration) {
    fail("DAILY_LOSS_DEFENSE_MIGRATION_NOT_FOUND");
  } else {
    const source = fs.readFileSync(
      path.join(MIG_DIR, dailyLossMigration),
      "utf8",
    );

    if (!/create or replace function public\.assert_paper_buy_daily_loss_allowed_v1\s*\(/i.test(source)) {
      fail("DAILY_LOSS_GUARD_HELPER_NOT_FOUND", { dailyLossMigration });
      return;
    }

    let maxStamp = 20261011002100;
    for (const name of sqlFiles) {
      if (!/^\d{14}_/.test(name)) continue;
      const stamp = Number(name.slice(0, 14));
      if (Number.isFinite(stamp) && stamp > maxStamp) maxStamp = stamp;
    }

    const stamp = Math.max(20261011002200, maxStamp + 100);
    const migrationName =
      String(stamp) + "_paper_buy_daily_loss_real_db_stress_harness_v1.sql";
    const migrationRel = path.join("supabase", "migrations", migrationName);
    const migrationFull = path.join(ROOT, migrationRel);

    const migrationSql = `-- AI Stock Lab
-- PAPER BUY Daily Loss Real DB Stress Harness V1
--
-- Service-role-only, synthetic-account-only test surface.
-- Calls the production daily-loss guard directly.
-- No broker/external API calls and no production trading function changes.

begin;

create or replace function public.run_paper_buy_daily_loss_stress_v1(
  p_account_id uuid,
  p_equity numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account_name text;
  v_daily_realized_pnl numeric;
begin
  select
    a.account_name,
    a.daily_realized_pnl
  into
    v_account_name,
    v_daily_realized_pnl
  from public.paper_accounts a
  where a.id = p_account_id;

  if not found then
    raise exception 'STRESS_ACCOUNT_NOT_FOUND';
  end if;

  if
    v_account_name is null or
    v_account_name not like 'AI_STOCK_LAB_STRESS_%'
  then
    raise exception 'STRESS_ACCOUNT_PREFIX_REQUIRED';
  end if;

  perform public.assert_paper_buy_daily_loss_allowed_v1(
    p_account_id,
    p_equity
  );

  return jsonb_build_object(
    'status',
      'DAILY_LOSS_GUARD_ALLOWED',
    'accountId',
      p_account_id,
    'equity',
      p_equity,
    'dailyRealizedPnl',
      v_daily_realized_pnl,
    'maxDailyLossRate',
      0.02,
    'maxDailyLossAmount',
      p_equity * 0.02
  );
end;
$$;

revoke all on function
  public.run_paper_buy_daily_loss_stress_v1(
    uuid,
    numeric
  )
from public, anon, authenticated;

grant execute on function
  public.run_paper_buy_daily_loss_stress_v1(
    uuid,
    numeric
  )
to service_role;

comment on function
  public.run_paper_buy_daily_loss_stress_v1(
    uuid,
    numeric
  )
is
  'Service-role-only synthetic runtime probe for the production 2% PAPER BUY daily-loss guard.';

commit;
`;

    if (fs.existsSync(migrationFull)) {
      const existing = fs.readFileSync(migrationFull, "utf8");
      if (existing !== migrationSql) {
        fail("TARGET_MIGRATION_EXISTS_WITH_DIFFERENT_CONTENT", {
          target: migrationRel.replace(/\\/g, "/"),
        });
        return;
      }
    } else {
      fs.writeFileSync(migrationFull, migrationSql, "utf8");
    }

    fs.mkdirSync(SCRIPT_DIR, { recursive: true });

    const verifierRel =
      "scripts/paper-buy-daily-loss-real-db-stress-harness-v1-verify.cjs";
    const verifierFull = path.join(ROOT, verifierRel);

    const verifierSource = String.raw`const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const MIG_DIR = path.join(ROOT, "supabase", "migrations");

const files = fs.existsSync(MIG_DIR)
  ? fs.readdirSync(MIG_DIR)
      .filter((name) =>
        name.endsWith("_paper_buy_daily_loss_real_db_stress_harness_v1.sql"))
      .sort()
  : [];

const target = files.length ? files[files.length - 1] : null;
const source = target
  ? fs.readFileSync(path.join(MIG_DIR, target), "utf8")
  : "";

const checks = {
  migrationFound: Boolean(target),

  stressRpcPresent:
    /create or replace function public\.run_paper_buy_daily_loss_stress_v1\s*\(/i
      .test(source),

  callsProductionGuard:
    /perform public\.assert_paper_buy_daily_loss_allowed_v1\s*\(/i
      .test(source),

  syntheticAccountPrefixRequired:
    /AI_STOCK_LAB_STRESS_%/.test(source) &&
    /STRESS_ACCOUNT_PREFIX_REQUIRED/.test(source),

  serviceRoleGranted:
    /grant execute on function[\s\S]*?to service_role;/i.test(source),

  publicRevoked:
    /revoke all on function[\s\S]*?from public, anon, authenticated;/i.test(source),

  productionFunctionsNotReplaced:
    !/create or replace function public\.assert_paper_buy_daily_loss_allowed_v1\s*\(/i
      .test(source) &&
    !/create or replace function public\.create_paper_buy_order_with_committed_risk_v3\s*\(/i
      .test(source),

  noTradingWrites:
    !/insert into public\.paper_order_requests/i.test(source) &&
    !/insert into public\.paper_positions/i.test(source) &&
    !/update public\.paper_order_requests/i.test(source),

  transactionWrapped:
    /\bbegin\s*;/i.test(source) &&
    /\bcommit\s*;/i.test(source),

  noRealTradingEnable:
    !/REAL_TRADING_ENABLED\s*=\s*true/i.test(source),
};

const failed = Object.entries(checks)
  .filter(([, ok]) => ok !== true)
  .map(([name]) => name);

console.log(JSON.stringify({
  status: failed.length === 0
    ? "AI_STOCK_LAB_DAILY_LOSS_REAL_DB_STRESS_HARNESS_V1_VERIFIED"
    : "AI_STOCK_LAB_DAILY_LOSS_REAL_DB_STRESS_HARNESS_V1_VERIFY_FAILED",

  migration: target
    ? "supabase/migrations/" + target
    : null,

  checks,
  failed,

  runtimePlan: {
    equity: 100000,
    belowBoundary: {
      dailyRealizedPnl: -1999,
      expected: "ALLOWED",
    },
    exactBoundary: {
      dailyRealizedPnl: -2000,
      expected: "DAILY_LOSS_LIMIT_REACHED",
    },
    beyondBoundary: {
      dailyRealizedPnl: -2500,
      expected: "DAILY_LOSS_LIMIT_REACHED",
    },
  },

  safety: {
    sourceOnly: true,
    databaseReads: 0,
    databaseWrites: 0,
    migrationApplied: false,
    syntheticAccountOnly: true,
    serviceRoleOnly: true,
    realBrokerApiInvoked: false,
    realTradingEnabled: false,
  },

  nextGate: failed.length === 0
    ? "SUPABASE_DB_PUSH_DRY_RUN_FOR_DAILY_LOSS_RUNTIME_STRESS"
    : "REPAIR_SOURCE_BEFORE_DB_APPLY",
}, null, 2));

process.exitCode = failed.length === 0 ? 0 : 1;
`;

    fs.writeFileSync(verifierFull, verifierSource, "utf8");

    const runnerRel =
      "scripts/paper-buy-daily-loss-real-db-stress-v1.cjs";
    const runnerFull = path.join(ROOT, runnerRel);

    const runnerSource = String.raw`const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function loadEnv(file) {
  if (!fs.existsSync(file)) return;

  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const idx = line.indexOf("=");
    if (idx <= 0) continue;

    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();

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

const BASE = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!BASE || !KEY) {
  console.error(JSON.stringify({
    status: "AI_STOCK_LAB_DAILY_LOSS_REAL_DB_STRESS_V1_FAILED",
    error: "SUPABASE_ENV_MISSING",
  }, null, 2));
  process.exitCode = 1;
  return;
}

const headers = {
  apikey: KEY,
  Authorization: "Bearer " + KEY,
  "Content-Type": "application/json",
};

async function req(method, pathname, body = null, prefer = null) {
  const res = await fetch(BASE + pathname, {
    method,
    headers: {
      ...headers,
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === null ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  let parsed = null;

  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  return {
    ok: res.ok,
    status: res.status,
    body: parsed,
  };
}

function enc(v) {
  return encodeURIComponent(v);
}

function errorMessage(result) {
  if (!result) return "";

  if (result.body && typeof result.body === "object") {
    return String(
      result.body.message ||
      result.body.details ||
      "",
    );
  }

  return String(result.body || "");
}

async function insertAccount(label, dailyRealizedPnl) {
  const result = await req(
    "POST",
    "/rest/v1/paper_accounts",
    {
      account_name:
        "AI_STOCK_LAB_STRESS_DAILY_LOSS_" +
        label +
        "_" +
        crypto.randomUUID(),

      initial_equity: 100000,
      initial_cash: 100000,
      cash_balance: 100000,
      realized_pnl: dailyRealizedPnl,
      daily_realized_pnl: dailyRealizedPnl,
      trading_mode: "PAPER",
    },
    "return=representation",
  );

  if (
    !result.ok ||
    !Array.isArray(result.body) ||
    !result.body[0]
  ) {
    throw new Error(
      "ACCOUNT_INSERT_FAILED:" +
      JSON.stringify(result),
    );
  }

  return result.body[0];
}

async function runGuard(accountId) {
  return req(
    "POST",
    "/rest/v1/rpc/run_paper_buy_daily_loss_stress_v1",
    {
      p_account_id: accountId,
      p_equity: 100000,
    },
  );
}

async function deleteAccount(accountId) {
  return req(
    "DELETE",
    "/rest/v1/paper_accounts?id=eq." +
      enc(accountId),
    null,
    "return=minimal",
  );
}

(async () => {
  const accounts = [];
  const cleanupErrors = [];
  let output = null;

  try {
    const below = await insertAccount("BELOW", -1999);
    accounts.push(below.id);

    const exact = await insertAccount("EXACT", -2000);
    accounts.push(exact.id);

    const beyond = await insertAccount("BEYOND", -2500);
    accounts.push(beyond.id);

    const belowResult = await runGuard(below.id);
    const exactResult = await runGuard(exact.id);
    const beyondResult = await runGuard(beyond.id);

    const checks = {
      belowTwoPercentAllowed:
        belowResult.ok &&
        belowResult.body &&
        belowResult.body.status ===
          "DAILY_LOSS_GUARD_ALLOWED",

      exactTwoPercentBlocked:
        !exactResult.ok &&
        errorMessage(exactResult)
          .includes("DAILY_LOSS_LIMIT_REACHED"),

      beyondTwoPercentBlocked:
        !beyondResult.ok &&
        errorMessage(beyondResult)
          .includes("DAILY_LOSS_LIMIT_REACHED"),

      exactBoundaryUsesInclusiveBlock:
        !exactResult.ok,
    };

    const failed = Object.entries(checks)
      .filter(([, ok]) => ok !== true)
      .map(([name]) => name);

    output = {
      status: failed.length === 0
        ? "AI_STOCK_LAB_DAILY_LOSS_REAL_DB_STRESS_V1_PASS"
        : "AI_STOCK_LAB_DAILY_LOSS_REAL_DB_STRESS_V1_REVIEW",

      classification: failed.length === 0
        ? "DAILY_LOSS_2_PERCENT_BOUNDARY_FAIL_CLOSED_PROVEN"
        : "DAILY_LOSS_RUNTIME_REVIEW_REQUIRED",

      policy: {
        equity: 100000,
        maxDailyLossRate: 0.02,
        maxDailyLossAmount: 2000,
        blockCondition:
          "daily_realized_pnl <= -2000",
      },

      scenarios: {
        belowBoundary: {
          dailyRealizedPnl: -1999,
          expected: "ALLOWED",
          response: belowResult,
        },

        exactBoundary: {
          dailyRealizedPnl: -2000,
          expected: "DAILY_LOSS_LIMIT_REACHED",
          response: exactResult,
        },

        beyondBoundary: {
          dailyRealizedPnl: -2500,
          expected: "DAILY_LOSS_LIMIT_REACHED",
          response: beyondResult,
        },
      },

      checks,
      failed,

      safety: {
        syntheticDedicatedPaperAccounts: true,
        productionDailyLossGuardInvoked: true,
        ordersCreated: 0,
        positionsCreated: 0,
        realBrokerApiInvoked: false,
        realOrdersSent: false,
        realTradingEnabled: false,
      },

      nextGate: failed.length === 0
        ? "FINAL_KILL_SWITCH_REVERIFY_AND_CLOSE_RISK_STRESS"
        : "REVIEW_DAILY_LOSS_RUNTIME_FAILURE",
    };
  } catch (error) {
    output = {
      status:
        "AI_STOCK_LAB_DAILY_LOSS_REAL_DB_STRESS_V1_FAILED",

      error:
        error instanceof Error
          ? error.message
          : String(error),

      nextGate:
        "REVIEW_FAILURE_AFTER_CLEANUP",
    };
  } finally {
    for (const accountId of accounts.reverse()) {
      const r = await deleteAccount(accountId);

      if (!r.ok) {
        cleanupErrors.push({
          accountId,
          status: r.status,
          body: r.body,
        });
      }
    }

    output.cleanup = {
      attemptedAccounts: accounts.length,
      errors: cleanupErrors,
      noCleanupErrors: cleanupErrors.length === 0,
    };

    if (cleanupErrors.length > 0) {
      output.status =
        "AI_STOCK_LAB_DAILY_LOSS_REAL_DB_STRESS_V1_CLEANUP_REVIEW";
      output.nextGate =
        "STOP_AND_REPAIR_SYNTHETIC_FIXTURE_CLEANUP";
    }

    console.log(JSON.stringify(output, null, 2));

    const pass =
      output.status ===
        "AI_STOCK_LAB_DAILY_LOSS_REAL_DB_STRESS_V1_PASS" &&
      cleanupErrors.length === 0;

    process.exitCode = pass ? 0 : 1;
  }
})();
`;

    fs.writeFileSync(runnerFull, runnerSource, "utf8");

    console.log(JSON.stringify({
      status:
        "AI_STOCK_LAB_DAILY_LOSS_REAL_DB_STRESS_HARNESS_V1_INSTALLED",

      sourceDailyLossMigration:
        "supabase/migrations/" + dailyLossMigration,

      generatedMigration:
        migrationRel.replace(/\\/g, "/"),

      generatedVerifier:
        verifierRel,

      generatedStressRunner:
        runnerRel,

      stressPlan: {
        belowBoundary:
          "-1.999% daily loss must be allowed",

        exactBoundary:
          "-2.000% daily loss must fail closed",

        beyondBoundary:
          "-2.500% daily loss must fail closed",
      },

      safety: {
        syntheticDedicatedPaperAccounts: true,
        testRpcServiceRoleOnly: true,
        productionTradingFunctionsModified: false,
        historicalMigrationsModified: false,
        databaseWrites: 0,
        migrationApplied: false,
        realBrokerApiInvoked: false,
        realTradingEnabled: false,
      },

      nextAction:
        "VERIFY_SOURCE_AND_SUPABASE_DB_PUSH_DRY_RUN",
    }, null, 2));
  }
}
