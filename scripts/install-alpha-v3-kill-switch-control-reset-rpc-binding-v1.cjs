const fs = require("fs");
const path = require("path");

const root = process.cwd();

const routeRel =
  "app/api/trading/system/control/route.ts";

const staticRel =
  "scripts/alpha-v3-kill-switch-control-reset-rpc-binding-v1-static-verify.cjs";

const negativeTestRel =
  "scripts/alpha-v3-kill-switch-control-reset-rpc-binding-v1-negative-test.cjs";

function read(rel) {
  const file =
    path.resolve(root, rel);

  if (!fs.existsSync(file)) {
    throw new Error(
      `FILE_NOT_FOUND ${rel}`
    );
  }

  return fs.readFileSync(
    file,
    "utf8"
  );
}

function write(rel, text) {
  const file =
    path.resolve(root, rel);

  fs.mkdirSync(
    path.dirname(file),
    { recursive: true }
  );

  fs.writeFileSync(
    file,
    text,
    "utf8"
  );
}

let route =
  read(routeRel);

const beforeRoute =
  route;

/*
 * 1) RESUME_AUTOMATION may enable automation and clear the display
 *    reason, but it must never directly write emergency_stop=false.
 */
const resumeCaseRegex =
  /case\s+"RESUME_AUTOMATION"\s*:\s*\{[\s\S]*?\n\s*break;\s*\n\s*\}/m;

const resumeCaseMatch =
  route.match(
    resumeCaseRegex
  );

if (!resumeCaseMatch) {
  throw new Error(
    "RESUME_AUTOMATION_CASE_NOT_FOUND"
  );
}

let resumeBlock =
  resumeCaseMatch[0];

resumeBlock =
  resumeBlock.replace(
    /\s*updates\.emergency_stop\s*=\s*false\s*;\s*/m,
    "\n"
  );

if (
  !resumeBlock.includes(
    "updates.automation_enabled"
  )
) {
  throw new Error(
    "RESUME_AUTOMATION_ENABLE_ASSIGNMENT_MISSING"
  );
}

route =
  route.replace(
    resumeCaseRegex,
    resumeBlock
  );

/*
 * 2) Insert authorized reset RPC after the Supabase client is created,
 *    but before the ordinary control-row update.
 */
const bindingMarker =
  "ALPHA_V3_KILL_SWITCH_RESET_RPC_BINDING_V1";

if (
  !route.includes(
    bindingMarker
  )
) {
  const clientRegex =
    /const\s+supabase\s*=\s*createSupabaseServerClient\(\)\s*;/m;

  const clientMatch =
    route.match(
      clientRegex
    );

  if (!clientMatch) {
    throw new Error(
      "SUPABASE_CLIENT_ANCHOR_NOT_FOUND"
    );
  }

  const binding = `

    /*
     * ${bindingMarker}
     *
     * emergency_stop=true -> false is never written directly.
     * An explicit manual reason is required and the audited DB RPC
     * is the only authorized reset path.
     */
    if (
      action ===
      "RESUME_AUTOMATION"
    ) {
      const resetReason =
        String(
          reason ?? ""
        ).trim();

      if (!resetReason) {
        return Response.json(
          {
            ok: false,
            error:
              "KILL_SWITCH_RESET_REASON_REQUIRED",
            message:
              "비상정지 해제 사유가 필요합니다.",
          },
          {
            status: 400,
          },
        );
      }

      const {
        error: resetError,
      } = await supabase.rpc(
        "reset_trading_kill_switch_v1",
        {
          p_reason:
            resetReason,

          p_actor:
            "LOCAL_CONTROL_API",

          p_metadata: {
            action:
              "RESUME_AUTOMATION",

            route:
              "/api/trading/system/control",

            requestedAt:
              now,
          },
        },
      );

      if (resetError) {
        return Response.json(
          {
            ok: false,
            error:
              "KILL_SWITCH_RESET_RPC_FAILED",
            message:
              resetError.message,
          },
          {
            status: 409,
          },
        );
      }
    }`;

  route =
    route.replace(
      clientRegex,
      clientMatch[0] +
      binding
    );
}

write(
  routeRel,
  route
);

/*
 * Static verifier.
 */
const staticVerify = `const fs = require("fs");
const path = require("path");

const root = process.cwd();

const rel =
  "${routeRel}";

const text =
  fs.readFileSync(
    path.resolve(root, rel),
    "utf8"
  );

const resumeMatch =
  text.match(
    /case\\s+"RESUME_AUTOMATION"\\s*:\\s*\\{[\\s\\S]*?\\n\\s*break;\\s*\\n\\s*\\}/m
  );

const resumeBlock =
  resumeMatch?.[0] ?? "";

const checks = {
  bindingMarkerPresent:
    text.includes(
      "${bindingMarker}"
    ),

  resetRpcPresent:
    text.includes(
      '"reset_trading_kill_switch_v1"'
    ),

  explicitReasonRequired:
    text.includes(
      "KILL_SWITCH_RESET_REASON_REQUIRED"
    ),

  resetActorPresent:
    text.includes(
      'p_actor:' 
    ) &&
    text.includes(
      '"LOCAL_CONTROL_API"'
    ),

  resetMetadataPresent:
    text.includes(
      'route:' 
    ) &&
    text.includes(
      '"/api/trading/system/control"'
    ),

  resumeCaseFound:
    Boolean(
      resumeMatch
    ),

  resumeCaseNoDirectEmergencyFalse:
    !/updates\\.emergency_stop\\s*=\\s*false\\s*;/m.test(
      resumeBlock
    ),

  emergencyTripStillPresent:
    /case\\s+"EMERGENCY_STOP"[\\s\\S]*?updates\\.emergency_stop\\s*=\\s*true\\s*;/m.test(
      text
    ),

  ordinaryUpdateStillTargetsGlobal:
    /\\.eq\\(\\s*"control_key"\\s*,\\s*"global"\\s*\\)/m.test(
      text
    )
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
          ? "ALPHA_V3_KILL_SWITCH_CONTROL_RESET_RPC_BINDING_V1_STATIC_VERIFIED"
          : "ALPHA_V3_KILL_SWITCH_CONTROL_RESET_RPC_BINDING_V1_STATIC_REVIEW",

      checks,
      failed,

      semantics: {
        directReset:
          "FORBIDDEN",

        authorizedResetRpc:
          "reset_trading_kill_switch_v1",

        resetReason:
          "REQUIRED",

        actor:
          "LOCAL_CONTROL_API",

        paperOrderAutoEnableOnResume:
          false
      },

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        networkCalls: 0,
        emergencyStopChanged: false
      },

      nextGate:
        failed.length === 0
          ? "TYPECHECK_AND_NEGATIVE_NO_WRITE_ROUTE_TEST"
          : "REVIEW_CONTROL_RESET_BINDING"
    },
    null,
    2
  )
);

if (failed.length > 0) {
  process.exitCode = 2;
}
`;

write(
  staticRel,
  staticVerify
);

/*
 * Negative operational test:
 * - sends RESUME_AUTOMATION without reason
 * - must return 400 before reset RPC or control update
 * - snapshots DB state before/after
 * - never trips or resets the kill switch
 */
const negativeTest = `const fs = require("fs");
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
      ).split(/\\r?\\n/)
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
    .replace(/\\/+$/, "");

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
      /\\/(\\d+|\\*)$/
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
`;

write(
  negativeTestRel,
  negativeTest
);

const checks = {
  routeChanged:
    route !== beforeRoute,

  directEmergencyFalseRemovedFromResume:
    !/case\s+"RESUME_AUTOMATION"\s*:\s*\{[\s\S]*?updates\.emergency_stop\s*=\s*false\s*;/m.test(
      route
    ),

  resetRpcInserted:
    route.includes(
      '"reset_trading_kill_switch_v1"'
    ),

  reasonRequired:
    route.includes(
      "KILL_SWITCH_RESET_REASON_REQUIRED"
    ),

  actorBound:
    route.includes(
      '"LOCAL_CONTROL_API"'
    ),

  negativeTestGenerated:
    fs.existsSync(
      path.resolve(
        root,
        negativeTestRel
      )
    )
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
          ? "ALPHA_V3_KILL_SWITCH_CONTROL_RESET_RPC_BINDING_V1_INSTALLED"
          : "ALPHA_V3_KILL_SWITCH_CONTROL_RESET_RPC_BINDING_V1_REVIEW",

      patchedProductionFile:
        routeRel,

      generatedFiles: [
        staticRel,
        negativeTestRel
      ],

      checks,
      failed,

      behavior: {
        directEmergencyReset:
          false,

        resetRpc:
          "reset_trading_kill_switch_v1",

        explicitReasonRequired:
          true,

        auditActor:
          "LOCAL_CONTROL_API",

        resumeEnablesPaperOrders:
          false
      },

      safety: {
        installerDatabaseReads:
          0,

        installerDatabaseWrites:
          0,

        emergencyStopChanged:
          false,

        ordersChanged:
          0,

        positionsChanged:
          0
      },

      nextAction:
        failed.length === 0
          ? "STATIC_VERIFY_TYPECHECK_AND_NEGATIVE_NO_WRITE_TEST"
          : "REVIEW_CONTROL_RESET_BINDING_INSTALL"
    },
    null,
    2
  )
);

if (failed.length > 0) {
  process.exitCode = 2;
}
