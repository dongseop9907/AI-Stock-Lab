
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
      line.slice(0, index).trim();

    let value =
      line.slice(index + 1).trim();

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

async function parseResponse(response) {
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

async function get(pathname, count = false) {
  const headers = {
    apikey:
      serviceRoleKey,

    authorization:
      "Bearer " +
      serviceRoleKey
  };

  if (count) {
    headers.prefer =
      "count=exact";

    headers.range =
      "0-0";
  }

  const response =
    await fetch(
      supabaseUrl + pathname,
      {
        method:
          "GET",

        headers,

        cache:
          "no-store"
      }
    );

  const payload =
    await parseResponse(
      response
    );

  let exactCount = null;

  if (count) {
    const contentRange =
      response.headers.get(
        "content-range"
      );

    const match =
      contentRange?.match(
        /\/(\d+|\*)$/
      );

    if (
      match &&
      match[1] !== "*"
    ) {
      exactCount =
        Number(match[1]);
    }
  }

  return {
    ok:
      response.ok,

    status:
      response.status,

    payload,
    count:
      exactCount
  };
}

async function rpc(name, body) {
  const response =
    await fetch(
      supabaseUrl +
      "/rest/v1/rpc/" +
      name,
      {
        method:
          "POST",

        headers: {
          apikey:
            serviceRoleKey,

          authorization:
            "Bearer " +
            serviceRoleKey,

          "content-type":
            "application/json"
        },

        body:
          JSON.stringify(
            body ?? {}
          ),

        cache:
          "no-store"
      }
    );

  return {
    ok:
      response.ok,

    status:
      response.status,

    payload:
      await parseResponse(
        response
      )
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

  const [
    control,
    orders,
    positions,
    events
  ] =
    await Promise.all([
      get(
        "/rest/v1/trading_system_controls?select=control_key,emergency_stop,paper_order_enabled&control_key=eq.global&limit=1"
      ),

      get(
        "/rest/v1/paper_order_requests?select=id",
        true
      ),

      get(
        "/rest/v1/paper_positions?select=id",
        true
      ),

      get(
        "/rest/v1/trading_kill_switch_events?select=id",
        true
      )
    ]);

  const row =
    Array.isArray(
      control.payload
    )
      ? control.payload[0]
      : null;

  const checks = {
    controlReadable:
      control.ok === true,

    globalControlExists:
      row?.control_key ===
        "global",

    emergencyStopFalse:
      row?.emergency_stop ===
        false,

    paperOrderEnabledTrue:
      row?.paper_order_enabled ===
        true,

    ordersZero:
      orders.ok === true &&
      orders.count === 0,

    positionsZero:
      positions.ok === true &&
      positions.count === 0,

    killSwitchEventsReadable:
      events.ok === true
  };

  const failed =
    Object.entries(checks)
      .filter(([, value]) => !value)
      .map(([key]) => key);

  const baseline = {
    capturedAt:
      new Date().toISOString(),

    control:
      row,

    orders:
      orders.count,

    positions:
      positions.count,

    killSwitchEvents:
      events.count
  };

  const baselineFile =
    path.resolve(
      root,
      "logs/alpha-v3-kill-switch-db-create-fill-guards-v1-baseline.json"
    );

  fs.mkdirSync(
    path.dirname(
      baselineFile
    ),
    {
      recursive: true
    }
  );

  fs.writeFileSync(
    baselineFile,
    JSON.stringify(
      baseline,
      null,
      2
    ) + "\n",
    "utf8"
  );

  console.log(
    JSON.stringify(
      {
        status:
          failed.length === 0
            ? "ALPHA_V3_KILL_SWITCH_DB_CREATE_FILL_GUARDS_V1_BASELINE_CAPTURED"
            : "ALPHA_V3_KILL_SWITCH_DB_CREATE_FILL_GUARDS_V1_PREFLIGHT_BLOCKED",

        checks,
        failed,
        baseline,

        safety: {
          databaseWrites: 0,
          ordersCreated: 0,
          positionsChanged: 0
        },

        nextGate:
          failed.length === 0
            ? "APPLY_01600_MIGRATION"
            : "REVIEW_DB_GUARD_PREFLIGHT"
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
            "ALPHA_V3_KILL_SWITCH_DB_CREATE_FILL_GUARDS_V1_PREFLIGHT_FATAL",

          error:
            error instanceof Error
              ? error.message
              : String(error),

          databaseWrites:
            0
        },
        null,
        2
      )
    );

    process.exitCode = 2;
  }
);
