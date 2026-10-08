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
      fs.readFileSync(
        file,
        "utf8"
      ).split(/\r?\n/)
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
        value.slice(1, -1);
    }

    env[key] = value;
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

const supabaseUrl =
  String(
    env.NEXT_PUBLIC_SUPABASE_URL ||
    env.SUPABASE_URL ||
    ""
  )
    .trim()
    .replace(/\/+$/, "");

const serviceRoleKey =
  String(
    env.SUPABASE_SERVICE_ROLE_KEY ||
    env.SUPABASE_SERVICE_KEY ||
    ""
  ).trim();

async function jsonResponse(response) {
  const text =
    await response.text();

  try {
    return text
      ? JSON.parse(text)
      : null;
  } catch {
    return {
      raw: text
    };
  }
}

async function dbGet(pathname) {
  const response =
    await fetch(
      supabaseUrl +
      pathname,
      {
        method:
          "GET",

        headers: {
          apikey:
            serviceRoleKey,

          authorization:
            "Bearer " +
            serviceRoleKey,
        },

        cache:
          "no-store",
      },
    );

  return {
    ok:
      response.ok,

    status:
      response.status,

    payload:
      await jsonResponse(
        response
      ),
  };
}

async function countTable(table) {
  const response =
    await fetch(
      supabaseUrl +
      "/rest/v1/" +
      table +
      "?select=id",
      {
        method:
          "GET",

        headers: {
          apikey:
            serviceRoleKey,

          authorization:
            "Bearer " +
            serviceRoleKey,

          prefer:
            "count=exact",

          range:
            "0-0",
        },

        cache:
          "no-store",
      },
    );

  const range =
    response.headers.get(
      "content-range"
    );

  const match =
    range?.match(
      /\/(\d+|\*)$/
    );

  return {
    ok:
      response.ok,

    count:
      match &&
      match[1] !== "*"
        ? Number(match[1])
        : null,
  };
}

async function findBaseUrl() {
  for (
    let port = 3000;
    port <= 3010;
    port += 1
  ) {
    const url =
      "http://localhost:" +
      String(port);

    try {
      const response =
        await fetch(
          url,
          {
            method:
              "GET",

            cache:
              "no-store",

            signal:
              AbortSignal.timeout(
                1500
              ),
          },
        );

      if (
        response.status >= 100
      ) {
        return url;
      }
    } catch {
    }
  }

  return null;
}

async function snapshot() {
  const [
    control,
    events,
    orders,
    positions
  ] =
    await Promise.all([
      dbGet(
        "/rest/v1/trading_system_controls?select=control_key,automation_enabled,paper_order_enabled,real_order_enabled,emergency_stop,emergency_reason,updated_by,updated_at&control_key=eq.global&limit=1"
      ),

      countTable(
        "trading_kill_switch_events"
      ),

      countTable(
        "paper_order_requests"
      ),

      countTable(
        "paper_positions"
      )
    ]);

  return {
    control:
      Array.isArray(
        control.payload
      )
        ? control.payload[0]
        : null,

    events:
      events.count,

    orders:
      orders.count,

    positions:
      positions.count
  };
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
    await findBaseUrl();

  if (!baseUrl) {
    throw new Error(
      "NEXT_SERVER_NOT_REACHABLE_3000_TO_3010"
    );
  }

  const before =
    await snapshot();

  if (
    before.control?.emergency_stop !==
      false
  ) {
    console.log(
      JSON.stringify(
        {
          status:
            "ALPHA_V3_KILL_SWITCH_CONTROL_RESET_RPC_BINDING_V1_NEGATIVE_TEST_BLOCKED",

          reason:
            "EXPECTED_EMERGENCY_STOP_FALSE_BASELINE",

          before,

          databaseWritesFromTest:
            0
        },
        null,
        2
      )
    );

    process.exitCode = 2;
    return;
  }

  const response =
    await fetch(
      baseUrl +
      "/api/trading/system/control",
      {
        method:
          "POST",

        headers: {
          "content-type":
            "application/json",

          origin:
            baseUrl,
        },

        body:
          JSON.stringify(
            {
              action:
                "RESUME_AUTOMATION"
            }
          ),

        cache:
          "no-store",
      },
    );

  const payload =
    await jsonResponse(
      response
    );

  const after =
    await snapshot();

  const checks = {
    rejectedBeforeReset:
      response.status === 400,

    explicitReasonError:
      payload?.error ===
        "KILL_SWITCH_RESET_REASON_REQUIRED",

    emergencyStopUnchanged:
      after.control?.emergency_stop ===
        before.control?.emergency_stop,

    controlUpdatedAtUnchanged:
      after.control?.updated_at ===
        before.control?.updated_at,

    killSwitchEventsUnchanged:
      after.events ===
        before.events,

    ordersUnchanged:
      after.orders ===
        before.orders,

    positionsUnchanged:
      after.positions ===
        before.positions
  };

  const failed =
    Object.entries(checks)
      .filter(([, value]) => !value)
      .map(([key]) => key);

  console.log(
    JSON.stringify(
      {
        status:
          failed.length === 0
            ? "ALPHA_V3_KILL_SWITCH_CONTROL_RESET_RPC_BINDING_V1_NEGATIVE_TEST_VERIFIED"
            : "ALPHA_V3_KILL_SWITCH_CONTROL_RESET_RPC_BINDING_V1_NEGATIVE_TEST_REVIEW",

        baseUrl,
        response: {
          status:
            response.status,

          payload
        },

        checks,
        failed,

        safety: {
          emergencyStopWrites:
            0,

          expectedResetRpcCalls:
            0,

          ordersChanged:
            after.orders -
            before.orders,

          positionsChanged:
            after.positions -
            before.positions,

          killSwitchEventsChanged:
            after.events -
            before.events
        },

        nextGate:
          failed.length === 0
            ? "PREACTIVATION_KILL_SWITCH_END_TO_END_GUARD_V1"
            : "REVIEW_CONTROL_RESET_RPC_BINDING"
      },
      null,
      2
    )
  );

  if (failed.length > 0) {
    process.exitCode = 2;
  }
}

main().catch(
  (error) => {
    console.error(
      JSON.stringify(
        {
          status:
            "ALPHA_V3_KILL_SWITCH_CONTROL_RESET_RPC_BINDING_V1_NEGATIVE_TEST_FATAL",

          error:
            error instanceof Error
              ? error.message
              : String(error)
        },
        null,
        2
      )
    );

    process.exitCode = 2;
  }
);
