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

const fileEnv =
  parseEnvFile(
    path.resolve(
      root,
      ".env.local"
    )
  );

const env = {
  ...fileEnv,
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
  timeoutMs = 8000
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

async function reachable(baseUrl) {
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

    if (attempt < 3) {
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

function getSupabaseConfig() {
  const url =
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

  return {
    url,
    serviceRoleKey
  };
}

async function supabaseCount(
  supabase,
  table,
  query
) {
  if (
    !supabase.url ||
    !supabase.serviceRoleKey
  ) {
    return {
      ok: false,
      skipped: true,
      reason:
        "SUPABASE_SERVICE_ROLE_CONFIG_MISSING",
      count: null,
      status: null,
      error: null
    };
  }

  const url =
    supabase.url +
    "/rest/v1/" +
    table +
    "?" +
    query;

  try {
    const response =
      await fetchWithTimeout(
        url,
        {
          method:
            "GET",

          headers: {
            apikey:
              supabase.serviceRoleKey,

            authorization:
              "Bearer " +
              supabase.serviceRoleKey,

            prefer:
              "count=exact",

            range:
              "0-0"
          },

          cache:
            "no-store"
        },
        8000
      );

    const contentRange =
      response.headers.get(
        "content-range"
      );

    let count =
      null;

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

    const payload =
      await parseResponse(
        response
      );

    return {
      ok:
        response.ok,
      skipped:
        false,
      status:
        response.status,
      count,
      contentRange,
      error:
        response.ok
          ? null
          : payload
    };
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      status: null,
      count: null,
      error:
        error instanceof Error
          ? error.message
          : String(error)
    };
  }
}

async function main() {
  const baseUrl =
    await detectBaseUrl();

  const secretConfigured =
    Boolean(
      String(
        env.TRADING_AUTOMATION_SECRET ??
        ""
      ).trim()
    );

  let control = {
    ok: false,
    status: null,
    payload: null,
    error: null
  };

  if (baseUrl) {
    try {
      const response =
        await fetchWithTimeout(
          baseUrl +
          "/api/trading/system/control",
          {
            method:
              "GET",
            cache:
              "no-store"
          },
          8000
        );

      const payload =
        await parseResponse(
          response
        );

      control = {
        ok:
          response.ok,
        status:
          response.status,
        payload,
        error:
          response.ok
            ? null
            : payload
      };
    } catch (error) {
      control = {
        ok: false,
        status: null,
        payload: null,
        error:
          error instanceof Error
            ? error.message
            : String(error)
      };
    }
  }

  const supabase =
    getSupabaseConfig();

  /*
   * Read-only count checks.
   * select=id limits transferred fields.
   */
  const approvedBuyOrders =
    await supabaseCount(
      supabase,
      "paper_order_requests",
      [
        "select=id",
        "side=eq.BUY",
        "status=eq.RISK_APPROVED"
      ].join("&")
    );

  const activeBuyReservations =
    await supabaseCount(
      supabase,
      "paper_order_requests",
      [
        "select=id",
        "side=eq.BUY",
        "reserved_risk_amount=gt.0",
        "reserved_risk_released_at=is.null"
      ].join("&")
    );

  const controlPayload =
    control.payload &&
    typeof control.payload ===
      "object"
      ? control.payload
      : {};

  const controlSource =
    controlPayload.control &&
    typeof controlPayload.control ===
      "object"
      ? controlPayload.control
      : controlPayload;

  const extractedControl = {
    automationEnabled:
      controlSource.automationEnabled ??
      controlSource.automation_enabled ??
      null,

    paperOrderEnabled:
      controlSource.paperOrderEnabled ??
      controlSource.paper_order_enabled ??
      null,

    realOrderEnabled:
      controlSource.realOrderEnabled ??
      controlSource.real_order_enabled ??
      null,

    emergencyStop:
      controlSource.emergencyStop ??
      controlSource.emergency_stop ??
      null,

    maxOrdersPerCycle:
      controlSource.maxOrdersPerCycle ??
      controlSource.max_orders_per_cycle ??
      null
  };

  const blockers = [];
  const warnings = [];

  if (!baseUrl) {
    blockers.push(
      "NEXT_SERVER_NOT_REACHABLE"
    );
  }

  if (!secretConfigured) {
    blockers.push(
      "TRADING_AUTOMATION_SECRET_NOT_CONFIGURED"
    );
  }

  if (!control.ok) {
    blockers.push(
      "SYSTEM_CONTROL_NOT_READABLE"
    );
  }

  if (
    approvedBuyOrders.ok &&
    approvedBuyOrders.count !== 0
  ) {
    blockers.push(
      "EXISTING_RISK_APPROVED_BUY_ORDERS"
    );
  }

  if (
    activeBuyReservations.ok &&
    activeBuyReservations.count !== 0
  ) {
    blockers.push(
      "EXISTING_ACTIVE_BUY_RESERVATIONS"
    );
  }

  if (
    !approvedBuyOrders.ok
  ) {
    blockers.push(
      "RISK_APPROVED_BUY_COUNT_NOT_VERIFIED"
    );
  }

  if (
    !activeBuyReservations.ok
  ) {
    blockers.push(
      "ACTIVE_BUY_RESERVATION_COUNT_NOT_VERIFIED"
    );
  }

  if (
    extractedControl.realOrderEnabled ===
      true
  ) {
    blockers.push(
      "REAL_ORDER_ENABLED"
    );
  }

  if (
    extractedControl.emergencyStop ===
      true
  ) {
    warnings.push(
      "EMERGENCY_STOP_ENABLED"
    );
  }

  if (
    extractedControl.automationEnabled ===
      false
  ) {
    warnings.push(
      "AUTOMATION_DISABLED_BY_CONTROL"
    );
  }

  if (
    extractedControl.paperOrderEnabled ===
      false
  ) {
    warnings.push(
      "PAPER_ORDER_DISABLED_BY_CONTROL"
    );
  }

  const safeForNoOrderOneShot =
    blockers.length ===
      0;

  const safeForAutoOrderOneShot =
    blockers.length ===
      0 &&
    extractedControl.paperOrderEnabled ===
      true &&
    extractedControl.emergencyStop !==
      true &&
    extractedControl.realOrderEnabled !==
      true;

  const report = {
    status:
      safeForNoOrderOneShot
        ? "ALPHA_V3_FINAL_OPERATIONAL_ONE_SHOT_READINESS_VERIFIED"
        : "ALPHA_V3_FINAL_OPERATIONAL_ONE_SHOT_READINESS_BLOCKED",

    baseUrl,

    checks: {
      nextServerReachable:
        Boolean(baseUrl),

      tradingAutomationSecretConfigured:
        secretConfigured,

      systemControlReadable:
        control.ok,

      riskApprovedBuyCountVerified:
        approvedBuyOrders.ok,

      riskApprovedBuyCount:
        approvedBuyOrders.count,

      activeBuyReservationCountVerified:
        activeBuyReservations.ok,

      activeBuyReservationCount:
        activeBuyReservations.count,

      realOrderDisabled:
        extractedControl.realOrderEnabled !==
          true
    },

    systemControl:
      extractedControl,

    rawControlStatus:
      control.status,

    supabaseReads: {
      approvedBuyOrders,
      activeBuyReservations
    },

    blockers,
    warnings,

    decision: {
      safeForNoOrderOneShot,
      safeForAutoOrderOneShot,

      recommendedFirstOperationalMode:
        safeForNoOrderOneShot
          ? {
              triggerType:
                "MANUAL",

              includeMarketSync:
                false,

              autoOrder:
                false,

              maxOrders:
                1
            }
          : null
    },

    safety: {
      databaseReads:
        2,

      databaseWrites:
        0,

      operationalCycleRequests:
        0,

      ordersCreated:
        0,

      ordersChanged:
        0,

      positionsChanged:
        0
    },

    nextGate:
      safeForNoOrderOneShot
        ? "RUN_CONTROLLED_NO_ORDER_OPERATIONAL_ONE_SHOT"
        : "RESOLVE_READINESS_BLOCKERS"
  };

  const outputFile =
    path.resolve(
      root,
      "logs/alpha-v3-final-operational-one-shot-readiness.json"
    );

  fs.mkdirSync(
    path.dirname(
      outputFile
    ),
    {
      recursive: true
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

  if (!safeForNoOrderOneShot) {
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
            "ALPHA_V3_FINAL_OPERATIONAL_ONE_SHOT_READINESS_FATAL",

          error:
            error instanceof Error
              ? error.message
              : String(error),

          safety: {
            databaseWrites:
              0,
            operationalCycleRequests:
              0,
            ordersCreated:
              0,
            positionsChanged:
              0
          },

          nextGate:
            "REVIEW_READINESS_FATAL"
        },
        null,
        2
      )
    );

    process.exitCode =
      2;
  }
);
