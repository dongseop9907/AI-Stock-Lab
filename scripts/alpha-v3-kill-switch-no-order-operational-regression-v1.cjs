const fs = require("fs");
const path = require("path");

const root = process.cwd();

function parseEnvFile(file) {
  const env = {};

  if (!fs.existsSync(file)) {
    return env;
  }

  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const index = line.indexOf("=");

    if (index <= 0) {
      continue;
    }

    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();

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

function trimBaseUrl(value) {
  return String(value ?? "")
    .trim()
    .replace(/\/+$/, "");
}

const supabaseUrl = trimBaseUrl(
  env.NEXT_PUBLIC_SUPABASE_URL ||
  env.SUPABASE_URL
);

const serviceRoleKey = String(
  env.SUPABASE_SERVICE_ROLE_KEY ||
  env.SUPABASE_SERVICE_KEY ||
  ""
).trim();

async function parseResponse(response) {
  const text = await response.text();

  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { raw: text };
  }
}

async function fetchWithTimeout(
  url,
  options = {},
  timeoutMs = 180000
) {
  const controller = new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    timeoutMs
  );

  try {
    return await fetch(
      url,
      {
        ...options,
        signal: controller.signal
      }
    );
  } finally {
    clearTimeout(timer);
  }
}

async function reachable(baseUrl) {
  try {
    const response = await fetchWithTimeout(
      baseUrl,
      {
        method: "GET",
        cache: "no-store"
      },
      8000
    );

    return response.status >= 100;
  } catch {
    return false;
  }
}

async function detectBaseUrl() {
  const configured = trimBaseUrl(
    env.AI_STOCK_LAB_BASE_URL
  );

  const candidates = [];

  if (configured) {
    candidates.push(configured);
  }

  for (const port of [
    3000,3001,3002,3003,3004,3005,
    3006,3007,3008,3009,3010
  ]) {
    const url =
      "http://localhost:" + String(port);

    if (!candidates.includes(url)) {
      candidates.push(url);
    }
  }

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    for (const candidate of candidates) {
      if (await reachable(candidate)) {
        return candidate;
      }
    }

    if (attempt < 3) {
      await new Promise(
        (resolve) => setTimeout(resolve, 750)
      );
    }
  }

  return null;
}

async function supabaseGet(
  pathname,
  preferCount = false
) {
  const headers = {
    apikey: serviceRoleKey,
    authorization:
      "Bearer " + serviceRoleKey
  };

  if (preferCount) {
    headers.prefer = "count=exact";
    headers.range = "0-0";
  }

  const response = await fetchWithTimeout(
    supabaseUrl + pathname,
    {
      method: "GET",
      headers,
      cache: "no-store"
    },
    15000
  );

  const payload = await parseResponse(response);

  let count = null;

  if (preferCount) {
    const contentRange =
      response.headers.get("content-range");

    if (contentRange) {
      const match =
        contentRange.match(/\/(\d+|\*)$/);

      if (match && match[1] !== "*") {
        count = Number(match[1]);
      }
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    count,
    payload:
      response.ok ? payload : null,
    error:
      response.ok ? null : payload
  };
}

async function rpc(name, body = {}) {
  const response = await fetchWithTimeout(
    supabaseUrl +
    "/rest/v1/rpc/" +
    name,
    {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        authorization:
          "Bearer " + serviceRoleKey,
        "content-type":
          "application/json"
      },
      body:
        JSON.stringify(body),
      cache: "no-store"
    },
    15000
  );

  return {
    ok: response.ok,
    status: response.status,
    payload:
      await parseResponse(response)
  };
}

async function countTable(
  table,
  query = "select=id"
) {
  return await supabaseGet(
    "/rest/v1/" +
    table +
    "?" +
    query,
    true
  );
}

async function snapshot() {
  const [
    killSwitch,
    orders,
    approved,
    reservations,
    positions,
    killSwitchEvents,
    invalidOrderTransitions,
    automationRuns
  ] = await Promise.all([
    rpc(
      "get_trading_kill_switch_status_v1"
    ),

    countTable(
      "paper_order_requests"
    ),

    countTable(
      "paper_order_requests",
      "select=id&status=eq.RISK_APPROVED"
    ),

    countTable(
      "paper_order_requests",
      [
        "select=id",
        "reserved_risk_amount=gt.0",
        "reserved_risk_released_at=is.null"
      ].join("&")
    ),

    countTable(
      "paper_positions"
    ),

    countTable(
      "trading_kill_switch_events"
    ),

    countTable(
      "paper_order_state_transition_audit",
      "select=id&allowed=eq.false"
    ),

    countTable(
      "trading_automation_runs"
    )
  ]);

  return {
    killSwitch,
    orders,
    approved,
    reservations,
    positions,
    killSwitchEvents,
    invalidOrderTransitions,
    automationRuns
  };
}

function knownCount(item) {
  return (
    item?.ok === true &&
    Number.isInteger(item?.count)
  );
}

function zeroCount(item) {
  return (
    knownCount(item) &&
    item.count === 0
  );
}

function delta(before, after) {
  if (
    !knownCount(before) ||
    !knownCount(after)
  ) {
    return null;
  }

  return after.count - before.count;
}

async function main() {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_CONFIG_MISSING"
    );
  }

  const baseUrl =
    await detectBaseUrl();

  if (!baseUrl) {
    throw new Error(
      "NEXT_SERVER_NOT_REACHABLE_3000_TO_3010"
    );
  }

  const before =
    await snapshot();

  const blockers = [];

  if (
    before.killSwitch.ok !== true ||
    before.killSwitch.payload?.version !==
      "ALPHA_V3_KILL_SWITCH_V1"
  ) {
    blockers.push(
      "KILL_SWITCH_STATUS_NOT_VERIFIED"
    );
  }

  if (
    before.killSwitch.payload?.emergencyStop !== false
  ) {
    blockers.push(
      "KILL_SWITCH_ALREADY_LATCHED"
    );
  }

  if (!zeroCount(before.orders)) {
    blockers.push(
      "PAPER_ORDER_TABLE_NOT_EMPTY"
    );
  }

  if (!zeroCount(before.approved)) {
    blockers.push(
      "RISK_APPROVED_ORDER_EXISTS"
    );
  }

  if (!zeroCount(before.reservations)) {
    blockers.push(
      "ACTIVE_RESERVED_RISK_EXISTS"
    );
  }

  if (!zeroCount(before.positions)) {
    blockers.push(
      "PAPER_POSITION_EXISTS"
    );
  }

  if (!zeroCount(before.invalidOrderTransitions)) {
    blockers.push(
      "INVALID_ORDER_TRANSITION_AUDIT_EXISTS"
    );
  }

  if (
    !knownCount(before.killSwitchEvents) ||
    !knownCount(before.automationRuns)
  ) {
    blockers.push(
      "PRE_SNAPSHOT_COUNTS_NOT_VERIFIED"
    );
  }

  if (blockers.length > 0) {
    console.log(
      JSON.stringify(
        {
          status:
            "ALPHA_V3_KILL_SWITCH_NO_ORDER_OPERATIONAL_REGRESSION_BLOCKED",

          baseUrl,
          blockers,
          before,

          safety: {
            operationalCycleRequests: 0,
            databaseWritesFromCycle: 0,
            ordersCreated: 0,
            positionsChanged: 0
          }
        },
        null,
        2
      )
    );

    process.exitCode = 2;
    return;
  }

  const requestBody = {
    triggerType: "MANUAL",
    includeMarketSync: false,
    autoOrder: false,
    maxOrders: 1
  };

  const startedAt =
    new Date().toISOString();

  let operationalResponse;

  try {
    const response =
      await fetchWithTimeout(
        baseUrl +
        "/api/trading/automation/manual",
        {
          method: "POST",
          headers: {
            "content-type":
              "application/json; charset=utf-8",
            origin: baseUrl
          },
          body:
            JSON.stringify(requestBody),
          cache: "no-store"
        },
        180000
      );

    operationalResponse = {
      status: response.status,
      ok: response.ok,
      payload:
        await parseResponse(response)
    };
  } catch (error) {
    operationalResponse = {
      status: null,
      ok: false,
      payload: null,
      error:
        error instanceof Error
          ? error.message
          : String(error)
    };
  }

  const finishedAt =
    new Date().toISOString();

  const after =
    await snapshot();

  const semanticStatus =
    operationalResponse
      ?.payload
      ?.automationRun
      ?.payload
      ?.status ??
    operationalResponse
      ?.payload
      ?.status ??
    null;

  const deltas = {
    orders:
      delta(
        before.orders,
        after.orders
      ),

    approved:
      delta(
        before.approved,
        after.approved
      ),

    reservations:
      delta(
        before.reservations,
        after.reservations
      ),

    positions:
      delta(
        before.positions,
        after.positions
      ),

    killSwitchEvents:
      delta(
        before.killSwitchEvents,
        after.killSwitchEvents
      ),

    invalidOrderTransitions:
      delta(
        before.invalidOrderTransitions,
        after.invalidOrderTransitions
      ),

    automationRuns:
      delta(
        before.automationRuns,
        after.automationRuns
      )
  };

  const checks = {
    responseHttpSuccess:
      operationalResponse.ok === true,

    automationSemanticSuccess:
      semanticStatus === "SUCCESS",

    killSwitchVersionUnchanged:
      after.killSwitch.payload?.version ===
        "ALPHA_V3_KILL_SWITCH_V1",

    emergencyStopRemainsFalse:
      after.killSwitch.payload?.emergencyStop ===
        false,

    noOrdersCreated:
      zeroCount(after.orders) &&
      deltas.orders === 0,

    noApprovedOrdersCreated:
      zeroCount(after.approved) &&
      deltas.approved === 0,

    noActiveReservations:
      zeroCount(after.reservations) &&
      deltas.reservations === 0,

    noPositionsCreated:
      zeroCount(after.positions) &&
      deltas.positions === 0,

    noKillSwitchEventsAdded:
      deltas.killSwitchEvents === 0,

    noInvalidOrderTransitionsAdded:
      deltas.invalidOrderTransitions === 0,

    automationRunRecorded:
      deltas.automationRuns === 1
  };

  const failed =
    Object.entries(checks)
      .filter(([, value]) => !value)
      .map(([key]) => key);

  const passed =
    failed.length === 0;

  const report = {
    status:
      passed
        ? "ALPHA_V3_KILL_SWITCH_NO_ORDER_OPERATIONAL_REGRESSION_VERIFIED"
        : "ALPHA_V3_KILL_SWITCH_NO_ORDER_OPERATIONAL_REGRESSION_REVIEW",

    baseUrl,
    startedAt,
    finishedAt,
    requestBody,
    before,
    operationalResponse,
    after,
    deltas,
    checks,
    failed,

    safety: {
      operationalCycleRequests: 1,
      requestedAutoOrder: false,
      requestedMarketSync: false,
      expectedOrdersCreated: 0,
      expectedPositionsChanged: 0
    },

    nextGate:
      passed
        ? "BIND_DB_CREATE_AND_FILL_KILL_SWITCH_GUARDS_V1"
        : "REVIEW_KILL_SWITCH_OPERATIONAL_REGRESSION"
  };

  const outputFile =
    path.resolve(
      root,
      "logs/alpha-v3-kill-switch-no-order-operational-regression-v1.json"
    );

  fs.mkdirSync(
    path.dirname(outputFile),
    { recursive: true }
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

  if (!passed) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status:
          "ALPHA_V3_KILL_SWITCH_NO_ORDER_OPERATIONAL_REGRESSION_FATAL",

        error:
          error instanceof Error
            ? error.message
            : String(error),

        nextGate:
          "REVIEW_KILL_SWITCH_OPERATIONAL_REGRESSION_FATAL"
      },
      null,
      2
    )
  );

  process.exitCode = 2;
});
