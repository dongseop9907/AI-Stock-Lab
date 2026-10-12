const fs = require("fs");
const path = require("path");

const root =
  process.cwd();

function parseEnvFile(file) {
  const env = {};

  if (!fs.existsSync(file)) {
    return env;
  }

  const text =
    fs.readFileSync(
      file,
      "utf8"
    );

  for (
    const rawLine of
      text.split(/\r?\n/)
  ) {
    const line =
      rawLine.trim();

    if (
      !line ||
      line.startsWith("#")
    ) {
      continue;
    }

    const index =
      line.indexOf("=");

    if (index <= 0) {
      continue;
    }

    const key =
      line
        .slice(0, index)
        .trim();

    let value =
      line
        .slice(index + 1)
        .trim();

    if (
      (
        value.startsWith('"') &&
        value.endsWith('"')
      ) ||
      (
        value.startsWith("'") &&
        value.endsWith("'")
      )
    ) {
      value =
        value.slice(
          1,
          -1
        );
    }

    env[key] =
      value;
  }

  return env;
}

const env = {
  ...parseEnvFile(
    path.resolve(
      root,
      ".env.local"
    )
  ),
  ...process.env
};

function trimBaseUrl(value) {
  return String(
    value ?? ""
  )
    .trim()
    .replace(/\/+$/, "");
}

async function fetchWithTimeout(
  url,
  options = {},
  timeoutMs = 180000
) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      timeoutMs
    );

  try {
    return await fetch(
      url,
      {
        ...options,
        signal:
          controller.signal
      }
    );
  } finally {
    clearTimeout(timer);
  }
}

async function parseResponse(
  response
) {
  const text =
    await response.text();

  try {
    return text
      ? JSON.parse(text)
      : null;
  } catch {
    return {
      raw:
        text
    };
  }
}

async function reachable(
  baseUrl
) {
  try {
    const response =
      await fetchWithTimeout(
        baseUrl,
        {
          method:
            "GET",
          cache:
            "no-store"
        },
        8000
      );

    return response.status >=
      100;
  } catch {
    return false;
  }
}

async function detectBaseUrl() {
  const configured =
    trimBaseUrl(
      env.AI_STOCK_LAB_BASE_URL
    );

  const candidates = [];

  if (configured) {
    candidates.push(
      configured
    );
  }

  for (
    const port of
      [3000,3001,3002,3003,3004,3005,3006,3007,3008,3009,3010]
  ) {
    const url =
      "http://localhost:" +
      String(port);

    if (
      !candidates.includes(
        url
      )
    ) {
      candidates.push(
        url
      );
    }
  }

  for (
    let attempt = 1;
    attempt <= 3;
    attempt += 1
  ) {
    for (
      const candidate of
        candidates
    ) {
      if (
        await reachable(
          candidate
        )
      ) {
        return candidate;
      }
    }

    if (
      attempt < 3
    ) {
      await new Promise(
        (resolve) =>
          setTimeout(
            resolve,
            750
          )
      );
    }
  }

  return null;
}

const supabaseUrl =
  trimBaseUrl(
    env.NEXT_PUBLIC_SUPABASE_URL ||
    env.SUPABASE_URL
  );

const serviceRoleKey =
  String(
    env.SUPABASE_SERVICE_ROLE_KEY ||
    env.SUPABASE_SERVICE_KEY ||
    ""
  ).trim();

async function supabaseGet(
  pathname,
  preferCount = false
) {
  const headers = {
    apikey:
      serviceRoleKey,

    authorization:
      "Bearer " +
      serviceRoleKey
  };

  if (preferCount) {
    headers.prefer =
      "count=exact";

    headers.range =
      "0-0";
  }

  const response =
    await fetchWithTimeout(
      supabaseUrl +
      pathname,
      {
        method:
          "GET",

        headers,

        cache:
          "no-store"
      },
      15000
    );

  const payload =
    await parseResponse(
      response
    );

  let count =
    null;

  if (preferCount) {
    const contentRange =
      response.headers.get(
        "content-range"
      );

    if (contentRange) {
      const match =
        contentRange.match(
          /\/(\d+|\*)$/
        );

      if (
        match &&
        match[1] !== "*"
      ) {
        count =
          Number(
            match[1]
          );
      }
    }
  }

  return {
    ok:
      response.ok,

    status:
      response.status,

    count,

    payload:
      response.ok
        ? payload
        : null,

    error:
      response.ok
        ? null
        : payload
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

async function readConfig() {
  const result =
    await supabaseGet(
      "/rest/v1/paper_order_state_machine_config" +
      "?select=id,mode,version,updated_at" +
      "&id=eq.1" +
      "&limit=1"
    );

  const row =
    result.ok &&
    Array.isArray(
      result.payload
    )
      ? result.payload[0] ??
        null
      : null;

  return {
    ...result,
    row
  };
}

async function snapshot() {
  const [
    config,
    totalOrders,
    approvedOrders,
    activeReservations,
    positions,
    auditRows,
    invalidAuditRows,
    automationRuns
  ] =
    await Promise.all([
      readConfig(),

      countTable(
        "paper_order_requests"
      ),

      countTable(
        "paper_order_requests",
        [
          "select=id",
          "status=eq.RISK_APPROVED"
        ].join("&")
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
        "paper_order_state_transition_audit"
      ),

      countTable(
        "paper_order_state_transition_audit",
        [
          "select=id",
          "allowed=eq.false"
        ].join("&")
      ),

      countTable(
        "trading_automation_runs"
      )
    ]);

  return {
    config,
    totalOrders,
    approvedOrders,
    activeReservations,
    positions,
    auditRows,
    invalidAuditRows,
    automationRuns
  };
}

function knownCount(
  item
) {
  return (
    item?.ok ===
      true &&
    Number.isInteger(
      item?.count
    )
  );
}

function zeroCount(
  item
) {
  return (
    knownCount(
      item
    ) &&
    item.count ===
      0
  );
}

function delta(
  before,
  after
) {
  if (
    !knownCount(
      before
    ) ||
    !knownCount(
      after
    )
  ) {
    return null;
  }

  return (
    after.count -
    before.count
  );
}

async function main() {
  if (
    !supabaseUrl ||
    !serviceRoleKey
  ) {
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
    before.config.row?.mode !==
      "AUDIT"
  ) {
    blockers.push(
      "ORDER_STATE_MACHINE_NOT_IN_AUDIT_MODE"
    );
  }

  if (
    before.config.row?.version !==
      "ALPHA_V3_ORDER_STATE_MACHINE_V1"
  ) {
    blockers.push(
      "ORDER_STATE_MACHINE_VERSION_MISMATCH"
    );
  }

  if (
    !zeroCount(
      before.totalOrders
    )
  ) {
    blockers.push(
      "PAPER_ORDER_TABLE_NOT_EMPTY"
    );
  }

  if (
    !zeroCount(
      before.approvedOrders
    )
  ) {
    blockers.push(
      "RISK_APPROVED_ORDER_EXISTS"
    );
  }

  if (
    !zeroCount(
      before.activeReservations
    )
  ) {
    blockers.push(
      "ACTIVE_RESERVED_RISK_EXISTS"
    );
  }

  if (
    !zeroCount(
      before.positions
    )
  ) {
    blockers.push(
      "PAPER_POSITION_EXISTS"
    );
  }

  if (
    !knownCount(
      before.auditRows
    ) ||
    !knownCount(
      before.invalidAuditRows
    ) ||
    !knownCount(
      before.automationRuns
    )
  ) {
    blockers.push(
      "PRE_SNAPSHOT_COUNT_NOT_VERIFIED"
    );
  }

  if (
    blockers.length >
      0
  ) {
    const report = {
      status:
        "ALPHA_V3_ORDER_STATE_AUDIT_OPERATIONAL_COMPATIBILITY_BLOCKED",

      baseUrl,
      before,
      blockers,

      safety: {
        operationalCycleRequests:
          0,

        databaseWritesFromCycle:
          0,

        ordersCreated:
          0,

        ordersChanged:
          0,

        positionsChanged:
          0
      },

      nextGate:
        "RESOLVE_AUDIT_COMPATIBILITY_BLOCKERS"
    };

    console.log(
      JSON.stringify(
        report,
        null,
        2
      )
    );

    process.exitCode =
      2;

    return;
  }

  const requestBody = {
    triggerType:
      "MANUAL",

    includeMarketSync:
      false,

    autoOrder:
      false,

    maxOrders:
      1
  };

  const startedAt =
    new Date()
      .toISOString();

  let operationalResponse;

  try {
    const response =
      await fetchWithTimeout(
        baseUrl +
        "/api/trading/automation/manual",
        {
          method:
            "POST",

          headers: {
            "content-type":
              "application/json; charset=utf-8",

            origin:
              baseUrl
          },

          body:
            JSON.stringify(
              requestBody
            ),

          cache:
            "no-store"
        },
        180000
      );

    operationalResponse = {
      status:
        response.status,

      ok:
        response.ok,

      payload:
        await parseResponse(
          response
        )
    };
  } catch (error) {
    operationalResponse = {
      status:
        null,

      ok:
        false,

      payload:
        null,

      error:
        error instanceof Error
          ? error.message
          : String(error)
    };
  }

  const finishedAt =
    new Date()
      .toISOString();

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
    totalOrders:
      delta(
        before.totalOrders,
        after.totalOrders
      ),

    approvedOrders:
      delta(
        before.approvedOrders,
        after.approvedOrders
      ),

    activeReservations:
      delta(
        before.activeReservations,
        after.activeReservations
      ),

    positions:
      delta(
        before.positions,
        after.positions
      ),

    auditRows:
      delta(
        before.auditRows,
        after.auditRows
      ),

    invalidAuditRows:
      delta(
        before.invalidAuditRows,
        after.invalidAuditRows
      ),

    automationRuns:
      delta(
        before.automationRuns,
        after.automationRuns
      )
  };

  const checks = {
    responseHttpSuccess:
      operationalResponse.ok ===
        true,

    automationSemanticSuccess:
      semanticStatus ===
        "SUCCESS",

    auditModeUnchanged:
      after.config.row?.mode ===
        "AUDIT",

    stateMachineVersionUnchanged:
      after.config.row?.version ===
        "ALPHA_V3_ORDER_STATE_MACHINE_V1",

    noOrdersCreated:
      zeroCount(
        after.totalOrders
      ) &&
      deltas.totalOrders ===
        0,

    noApprovedOrdersCreated:
      zeroCount(
        after.approvedOrders
      ) &&
      deltas.approvedOrders ===
        0,

    noActiveReservations:
      zeroCount(
        after.activeReservations
      ) &&
      deltas.activeReservations ===
        0,

    noPositionsCreated:
      zeroCount(
        after.positions
      ) &&
      deltas.positions ===
        0,

    noOrderTransitionAuditRowsAdded:
      deltas.auditRows ===
        0,

    noInvalidTransitionAuditRowsAdded:
      deltas.invalidAuditRows ===
        0,

    automationRunRecorded:
      deltas.automationRuns ===
        1
  };

  const failed =
    Object.entries(
      checks
    )
      .filter(
        ([, value]) =>
          !value
      )
      .map(
        ([key]) =>
          key
      );

  const passed =
    failed.length ===
      0;

  const report = {
    status:
      passed
        ? "ALPHA_V3_ORDER_STATE_AUDIT_OPERATIONAL_COMPATIBILITY_VERIFIED"
        : "ALPHA_V3_ORDER_STATE_AUDIT_OPERATIONAL_COMPATIBILITY_REVIEW",

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

    interpretation: {
      auditMode:
        "AUDIT",

      invalidTransitionBlocking:
        false,

      expectedOrderTransitionAuditRows:
        0,

      reason:
        "This compatibility run intentionally uses autoOrder=false with zero paper orders and zero paper positions. Therefore the order-state trigger should remain installed but should not observe any order-state writes."
    },

    safety: {
      operationalCycleRequests:
        1,

      requestedAutoOrder:
        false,

      requestedMarketSync:
        false,

      expectedOrdersCreated:
        0,

      expectedPositionsChanged:
        0,

      strictModeActivation:
        false
    },

    nextGate:
      passed
        ? "BUILD_STRICT_MODE_PREACTIVATION_GUARD_V1"
        : "REVIEW_AUDIT_MODE_OPERATIONAL_COMPATIBILITY"
  };

  const outputFile =
    path.resolve(
      root,
      "logs/alpha-v3-order-state-audit-operational-compatibility-v1.json"
    );

  fs.mkdirSync(
    path.dirname(
      outputFile
    ),
    {
      recursive:
        true
    }
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
            "ALPHA_V3_ORDER_STATE_AUDIT_OPERATIONAL_COMPATIBILITY_FATAL",

          error:
            error instanceof Error
              ? error.message
              : String(error),

          caution:
            "If the failure occurred during the operational request, inspect the generated log and current DB state before retrying.",

          nextGate:
            "REVIEW_AUDIT_MODE_OPERATIONAL_COMPATIBILITY_FATAL"
        },
        null,
        2
      )
    );

    process.exitCode =
      2;
  }
);
