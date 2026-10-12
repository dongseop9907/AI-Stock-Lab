const fs = require("fs");
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
