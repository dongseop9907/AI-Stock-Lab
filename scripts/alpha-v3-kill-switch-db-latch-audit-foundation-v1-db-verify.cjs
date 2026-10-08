const fs = require("fs");
const path = require("path");

const root = process.cwd();

function parseEnvFile(file) {
  const env = {};

  if (!fs.existsSync(file)) {
    return env;
  }

  for (
    const rawLine of
      fs.readFileSync(file, "utf8")
        .split(/\r?\n/)
  ) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const index =
      line.indexOf("=");

    if (index <= 0) {
      continue;
    }

    const key =
      line.slice(0, index).trim();

    let value =
      line.slice(index + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

const env = {
  ...parseEnvFile(
    path.resolve(root, ".env.local")
  ),
  ...process.env
};

const url = String(
  env.NEXT_PUBLIC_SUPABASE_URL ||
  env.SUPABASE_URL ||
  ""
).trim().replace(/\/+$/, "");

const key = String(
  env.SUPABASE_SERVICE_ROLE_KEY ||
  env.SUPABASE_SERVICE_KEY ||
  ""
).trim();

if (!url || !key) {
  throw new Error(
    "SUPABASE_SERVICE_ROLE_CONFIG_MISSING"
  );
}

const baselineFile = path.resolve(
  root,
  "logs/alpha-v3-kill-switch-db-foundation-v1-baseline.json"
);

if (!fs.existsSync(baselineFile)) {
  throw new Error(
    "KILL_SWITCH_BASELINE_FILE_MISSING"
  );
}

const baseline = JSON.parse(
  fs.readFileSync(
    baselineFile,
    "utf8"
  )
);

async function parseResponse(response) {
  const text = await response.text();

  try {
    return text
      ? JSON.parse(text)
      : null;
  } catch {
    return { raw: text };
  }
}

async function rpc(name, body = {}) {
  const response = await fetch(
    url +
    "/rest/v1/rpc/" +
    name,
    {
      method: "POST",
      headers: {
        apikey: key,
        authorization:
          "Bearer " + key,
        "content-type":
          "application/json"
      },
      body:
        JSON.stringify(body),
      cache: "no-store"
    }
  );

  return {
    ok: response.ok,
    status: response.status,
    payload:
      await parseResponse(response)
  };
}

async function countEvents() {
  const response = await fetch(
    url +
    "/rest/v1/trading_kill_switch_events" +
    "?select=id",
    {
      method: "GET",
      headers: {
        apikey: key,
        authorization:
          "Bearer " + key,
        prefer: "count=exact",
        range: "0-0"
      },
      cache: "no-store"
    }
  );

  const contentRange =
    response.headers.get(
      "content-range"
    );

  let count = null;

  if (contentRange) {
    const match =
      contentRange.match(/\/(\d+|\*)$/);

    if (
      match &&
      match[1] !== "*"
    ) {
      count = Number(match[1]);
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    count,
    payload:
      await parseResponse(response)
  };
}

async function main() {
  const beforeEventCount =
    await countEvents();

  const status =
    await rpc(
      "get_trading_kill_switch_status_v1"
    );

  const scenarios = [
    {
      name:
        "IDEMPOTENT_FALSE_FALSE",
      body: {
        p_old_state: false,
        p_new_state: false,
        p_reset_authorized: false
      },
      allowed: true,
      reason: "IDEMPOTENT_NOOP"
    },
    {
      name:
        "TRIP_FALSE_TRUE",
      body: {
        p_old_state: false,
        p_new_state: true,
        p_reset_authorized: false
      },
      allowed: true,
      reason: "TRIP_ALLOWED"
    },
    {
      name:
        "DIRECT_RESET_REJECTED",
      body: {
        p_old_state: true,
        p_new_state: false,
        p_reset_authorized: false
      },
      allowed: false,
      reason:
        "RESET_REQUIRES_AUTHORIZED_RPC"
    },
    {
      name:
        "AUTHORIZED_RESET_ALLOWED",
      body: {
        p_old_state: true,
        p_new_state: false,
        p_reset_authorized: true
      },
      allowed: true,
      reason:
        "AUTHORIZED_MANUAL_RESET_ALLOWED"
    },
    {
      name:
        "IDEMPOTENT_TRUE_TRUE",
      body: {
        p_old_state: true,
        p_new_state: true,
        p_reset_authorized: false
      },
      allowed: true,
      reason: "IDEMPOTENT_NOOP"
    }
  ];

  const results = [];

  for (const scenario of scenarios) {
    const result = await rpc(
      "validate_kill_switch_transition_v1",
      scenario.body
    );

    results.push({
      name: scenario.name,
      passed:
        result.ok === true &&
        result.payload?.allowed ===
          scenario.allowed &&
        result.payload?.reason ===
          scenario.reason,
      expected: {
        allowed:
          scenario.allowed,
        reason:
          scenario.reason
      },
      observed: result
    });
  }

  const afterEventCount =
    await countEvents();

  const current =
    status.payload;

  const checks = {
    statusRpcReadable:
      status.ok === true,

    versionCorrect:
      current?.version ===
        "ALPHA_V3_KILL_SWITCH_V1",

    controlIdUnchanged:
      String(current?.controlId) ===
        String(baseline.controlId),

    emergencyStopUnchanged:
      Boolean(current?.emergencyStop) ===
        Boolean(baseline.emergencyStop),

    validatorScenariosPass:
      results.every(
        (item) => item.passed
      ),

    auditTableReadable:
      beforeEventCount.ok === true &&
      afterEventCount.ok === true,

    verifierAddedNoEvents:
      beforeEventCount.count ===
        afterEventCount.count
  };

  const failed =
    Object.entries(checks)
      .filter(([, value]) => !value)
      .map(([key]) => key);

  const report = {
    status:
      failed.length === 0
        ? "ALPHA_V3_KILL_SWITCH_DB_LATCH_AUDIT_FOUNDATION_V1_DB_VERIFIED"
        : "ALPHA_V3_KILL_SWITCH_DB_LATCH_AUDIT_FOUNDATION_V1_DB_REVIEW",

    checks,
    failed,

    baseline,

    currentStatus: current,

    eventCounts: {
      beforeVerify:
        beforeEventCount.count,
      afterVerify:
        afterEventCount.count
    },

    validatorScenarios:
      results,

    behavior: {
      emergencyStopChangedByFoundation:
        Boolean(current?.emergencyStop) !==
          Boolean(baseline.emergencyStop),

      directResetContractRejected:
        results.find(
          (item) =>
            item.name ===
              "DIRECT_RESET_REJECTED"
        )?.passed === true,

      authorizedResetContractAllowed:
        results.find(
          (item) =>
            item.name ===
              "AUTHORIZED_RESET_ALLOWED"
        )?.passed === true,

      productionTripOrResetTestPerformed:
        false
    },

    safety: {
      validatorRpcWrites: 0,
      statusRpcWrites: 0,
      productionEmergencyStopWrites: 0,
      ordersCreated: 0,
      ordersChanged: 0,
      positionsChanged: 0
    },

    nextGate:
      failed.length === 0
        ? "BIND_APPLICATION_KILL_SWITCH_GUARDS_V1"
        : "REVIEW_KILL_SWITCH_DB_FOUNDATION"
  };

  const outputFile = path.resolve(
    root,
    "logs/alpha-v3-kill-switch-db-latch-audit-foundation-v1-db-verify.json"
  );

  fs.writeFileSync(
    outputFile,
    JSON.stringify(
      report,
      null,
      2
    ) + "\n",
    "utf8"
  );

  console.log(
    JSON.stringify(
      report,
      null,
      2
    )
  );

  if (failed.length > 0) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status:
          "ALPHA_V3_KILL_SWITCH_DB_LATCH_AUDIT_FOUNDATION_V1_DB_VERIFY_FATAL",

        error:
          error instanceof Error
            ? error.message
            : String(error),

        safety: {
          productionEmergencyStopWrites: 0,
          ordersCreated: 0,
          positionsChanged: 0
        }
      },
      null,
      2
    )
  );

  process.exitCode = 2;
});
