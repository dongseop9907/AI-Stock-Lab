
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

  const baselineFile =
    path.resolve(
      root,
      "logs/alpha-v3-kill-switch-db-create-fill-guards-v1-baseline.json"
    );

  if (!fs.existsSync(baselineFile)) {
    throw new Error(
      "BASELINE_FILE_MISSING"
    );
  }

  const baseline =
    JSON.parse(
      fs.readFileSync(
        baselineFile,
        "utf8"
      )
    );

  const [
    allowed,
    emergencyBlocked,
    paperDisabledBlocked,
    nullEmergencyBlocked,
    nullPaperBlocked,
    liveGuard,
    control,
    orders,
    positions,
    events
  ] =
    await Promise.all([
      rpc(
        "validate_paper_buy_new_risk_control_v1",
        {
          p_emergency_stop:
            false,

          p_paper_order_enabled:
            true
        }
      ),

      rpc(
        "validate_paper_buy_new_risk_control_v1",
        {
          p_emergency_stop:
            true,

          p_paper_order_enabled:
            true
        }
      ),

      rpc(
        "validate_paper_buy_new_risk_control_v1",
        {
          p_emergency_stop:
            false,

          p_paper_order_enabled:
            false
        }
      ),

      rpc(
        "validate_paper_buy_new_risk_control_v1",
        {
          p_emergency_stop:
            null,

          p_paper_order_enabled:
            true
        }
      ),

      rpc(
        "validate_paper_buy_new_risk_control_v1",
        {
          p_emergency_stop:
            false,

          p_paper_order_enabled:
            null
        }
      ),

      rpc(
        "assert_paper_buy_new_risk_allowed_v1",
        {}
      ),

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
    validatorAllowedScenario:
      allowed.ok === true &&
      allowed.payload?.allowed ===
        true &&
      allowed.payload?.reason ===
        "PAPER_BUY_NEW_RISK_ALLOWED",

    validatorEmergencyBlocked:
      emergencyBlocked.ok === true &&
      emergencyBlocked.payload?.allowed ===
        false &&
      emergencyBlocked.payload?.reason ===
        "EMERGENCY_STOP_ACTIVE",

    validatorPaperDisabledBlocked:
      paperDisabledBlocked.ok === true &&
      paperDisabledBlocked.payload?.allowed ===
        false &&
      paperDisabledBlocked.payload?.reason ===
        "PAPER_ORDER_DISABLED",

    validatorNullEmergencyFailClosed:
      nullEmergencyBlocked.ok === true &&
      nullEmergencyBlocked.payload?.allowed ===
        false,

    validatorNullPaperFailClosed:
      nullPaperBlocked.ok === true &&
      nullPaperBlocked.payload?.allowed ===
        false,

    liveGuardReadableAndAllowsCurrentControl:
      liveGuard.ok === true,

    controlUnchanged:
      row?.control_key ===
        baseline.control?.control_key &&
      row?.emergency_stop ===
        baseline.control?.emergency_stop &&
      row?.paper_order_enabled ===
        baseline.control?.paper_order_enabled,

    ordersUnchanged:
      orders.ok === true &&
      orders.count ===
        baseline.orders,

    positionsUnchanged:
      positions.ok === true &&
      positions.count ===
        baseline.positions,

    killSwitchEventsUnchanged:
      events.ok === true &&
      events.count ===
        baseline.killSwitchEvents
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
            ? "ALPHA_V3_KILL_SWITCH_DB_CREATE_FILL_GUARDS_V1_DB_VERIFIED"
            : "ALPHA_V3_KILL_SWITCH_DB_CREATE_FILL_GUARDS_V1_DB_REVIEW",

        checks,
        failed,

        validator: {
          allowed:
            allowed.payload,

          emergencyBlocked:
            emergencyBlocked.payload,

          paperDisabledBlocked:
            paperDisabledBlocked.payload,

          nullEmergencyBlocked:
            nullEmergencyBlocked.payload,

          nullPaperBlocked:
            nullPaperBlocked.payload
        },

        liveGuard: {
          ok:
            liveGuard.ok,

          status:
            liveGuard.status
        },

        safety: {
          productionEmergencyStopWrites: 0,
          productionOrderCreates: 0,
          productionFillCalls: 0,
          ordersChanged:
            orders.count -
            baseline.orders,

          positionsChanged:
            positions.count -
            baseline.positions,

          killSwitchEventsChanged:
            events.count -
            baseline.killSwitchEvents
        },

        nextGate:
          failed.length === 0
            ? "BIND_CONTROL_RESET_RPC_V1"
            : "REVIEW_DB_CREATE_FILL_GUARDS"
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
            "ALPHA_V3_KILL_SWITCH_DB_CREATE_FILL_GUARDS_V1_DB_FATAL",

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
