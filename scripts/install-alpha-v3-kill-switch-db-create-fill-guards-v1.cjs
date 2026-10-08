const fs = require("fs");
const path = require("path");

const root = process.cwd();

const createSourceRel =
  "supabase/migrations/20261008000100_committed_risk_reservation_v3.sql";

const fillSourceRel =
  "supabase/migrations/20261008000700_execute_paper_buy_order_lock_order_v2.sql";

const migrationRel =
  "supabase/migrations/20261008001600_kill_switch_db_create_fill_guards_v1.sql";

const staticRel =
  "scripts/alpha-v3-kill-switch-db-create-fill-guards-v1-static-verify.cjs";

const preflightRel =
  "scripts/alpha-v3-kill-switch-db-create-fill-guards-v1-preflight.cjs";

const dbVerifyRel =
  "scripts/alpha-v3-kill-switch-db-create-fill-guards-v1-db-verify.cjs";

function read(rel) {
  const file = path.resolve(root, rel);

  if (!fs.existsSync(file)) {
    throw new Error(`FILE_NOT_FOUND ${rel}`);
  }

  return fs.readFileSync(file, "utf8");
}

function write(rel, text) {
  const file = path.resolve(root, rel);

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

function extractFunctionDefinition(
  sql,
  functionName
) {
  const startRegex =
    new RegExp(
      String.raw`create\s+(?:or\s+replace\s+)?function\s+public\.${functionName}\s*\(`,
      "i"
    );

  const match =
    startRegex.exec(sql);

  if (!match) {
    throw new Error(
      `FUNCTION_DEFINITION_NOT_FOUND ${functionName}`
    );
  }

  const start = match.index;

  const afterStart =
    sql.slice(start);

  const asMatch =
    /\bas\s+(\$[A-Za-z0-9_]*\$)/i.exec(
      afterStart
    );

  if (!asMatch) {
    throw new Error(
      `FUNCTION_DOLLAR_QUOTE_NOT_FOUND ${functionName}`
    );
  }

  const delimiter =
    asMatch[1];

  const bodyOpen =
    start +
    asMatch.index +
    asMatch[0].length;

  const bodyClose =
    sql.indexOf(
      delimiter,
      bodyOpen
    );

  if (bodyClose < 0) {
    throw new Error(
      `FUNCTION_DOLLAR_QUOTE_CLOSE_NOT_FOUND ${functionName}`
    );
  }

  const semicolon =
    sql.indexOf(
      ";",
      bodyClose + delimiter.length
    );

  if (semicolon < 0) {
    throw new Error(
      `FUNCTION_TERMINATOR_NOT_FOUND ${functionName}`
    );
  }

  return sql
    .slice(
      start,
      semicolon + 1
    )
    .trim();
}

function injectGuard(
  definition,
  functionName
) {
  if (
    definition.includes(
      "assert_paper_buy_new_risk_allowed_v1"
    )
  ) {
    return definition;
  }

  const asMatch =
    /\bas\s+(\$[A-Za-z0-9_]*\$)/i.exec(
      definition
    );

  if (!asMatch) {
    throw new Error(
      `INJECT_DOLLAR_QUOTE_NOT_FOUND ${functionName}`
    );
  }

  const delimiter =
    asMatch[1];

  const bodyStart =
    asMatch.index +
    asMatch[0].length;

  const bodyEnd =
    definition.indexOf(
      delimiter,
      bodyStart
    );

  if (bodyEnd < 0) {
    throw new Error(
      `INJECT_BODY_END_NOT_FOUND ${functionName}`
    );
  }

  const body =
    definition.slice(
      bodyStart,
      bodyEnd
    );

  const beginMatch =
    /\bbegin\b/i.exec(body);

  if (!beginMatch) {
    throw new Error(
      `FUNCTION_BEGIN_NOT_FOUND ${functionName}`
    );
  }

  const insertAt =
    bodyStart +
    beginMatch.index +
    beginMatch[0].length;

  return (
    definition.slice(0, insertAt) +
    "\n  perform public.assert_paper_buy_new_risk_allowed_v1();" +
    "\n" +
    definition.slice(insertAt)
  );
}

const createSource =
  read(createSourceRel);

const fillSource =
  read(fillSourceRel);

const createDefinition =
  injectGuard(
    extractFunctionDefinition(
      createSource,
      "create_paper_buy_order_with_committed_risk_v3"
    ),
    "create_paper_buy_order_with_committed_risk_v3"
  );

const fillDefinition =
  injectGuard(
    extractFunctionDefinition(
      fillSource,
      "execute_paper_buy_order"
    ),
    "execute_paper_buy_order"
  );

const migration = `begin;

create or replace function
  public.validate_paper_buy_new_risk_control_v1(
    p_emergency_stop boolean,
    p_paper_order_enabled boolean
  )
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'version',
      'ALPHA_V3_KILL_SWITCH_V1',

    'allowed',
      (
        coalesce(
          p_emergency_stop,
          true
        ) = false
        and
        coalesce(
          p_paper_order_enabled,
          false
        ) = true
      ),

    'reason',
      case
        when p_emergency_stop is null
          then 'CONTROL_STATE_NULL_FAIL_CLOSED'

        when p_paper_order_enabled is null
          then 'CONTROL_STATE_NULL_FAIL_CLOSED'

        when p_emergency_stop = true
          then 'EMERGENCY_STOP_ACTIVE'

        when p_paper_order_enabled = false
          then 'PAPER_ORDER_DISABLED'

        else 'PAPER_BUY_NEW_RISK_ALLOWED'
      end,

    'emergencyStop',
      p_emergency_stop,

    'paperOrderEnabled',
      p_paper_order_enabled
  );
$$;

create or replace function
  public.assert_paper_buy_new_risk_allowed_v1()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_control
    public.trading_system_controls%rowtype;

  v_decision jsonb;
begin
  /*
   * Canonical lock order:
   * CONTROL ROW FIRST, then create/fill RPCs acquire their
   * existing account/order/position locks.
   *
   * FOR SHARE keeps the control state stable for the rest
   * of this transaction. A concurrent emergency trip/update
   * must wait, giving us a clean linearization point.
   */
  select *
  into v_control
  from public.trading_system_controls
  where control_key = 'global'
  for share;

  if not found then
    raise exception
      using
        errcode = '23514',
        message =
          'KILL_SWITCH_NEW_RISK_BLOCKED:CONTROL_ROW_MISSING';
  end if;

  v_decision :=
    public.validate_paper_buy_new_risk_control_v1(
      v_control.emergency_stop,
      v_control.paper_order_enabled
    );

  if
    coalesce(
      (v_decision ->> 'allowed')::boolean,
      false
    ) = false
  then
    raise exception
      using
        errcode = '23514',
        message =
          'KILL_SWITCH_NEW_RISK_BLOCKED:' ||
          coalesce(
            v_decision ->> 'reason',
            'UNKNOWN_FAIL_CLOSED'
          );
  end if;
end;
$$;

${createDefinition}

${fillDefinition}

revoke all
on function
  public.validate_paper_buy_new_risk_control_v1(
    boolean,
    boolean
  )
from public, anon, authenticated;

revoke all
on function
  public.assert_paper_buy_new_risk_allowed_v1()
from public, anon, authenticated;

grant execute
on function
  public.validate_paper_buy_new_risk_control_v1(
    boolean,
    boolean
  )
to service_role;

grant execute
on function
  public.assert_paper_buy_new_risk_allowed_v1()
to service_role;

notify pgrst, 'reload schema';

commit;
`;

write(
  migrationRel,
  migration
);

const staticVerify = `const fs = require("fs");
const path = require("path");

const root = process.cwd();

const migrationRel =
  "${migrationRel}";

const text =
  fs.readFileSync(
    path.resolve(root, migrationRel),
    "utf8"
  );

const createSource =
  fs.readFileSync(
    path.resolve(root, "${createSourceRel}"),
    "utf8"
  );

const fillSource =
  fs.readFileSync(
    path.resolve(root, "${fillSourceRel}"),
    "utf8"
  );

function count(haystack, needle) {
  return haystack
    .split(needle)
    .length - 1;
}

const checks = {
  migrationVersion01600:
    path.basename(
      migrationRel
    ).startsWith(
      "20261008001600_"
    ),

  pureValidatorPresent:
    text.includes(
      "validate_paper_buy_new_risk_control_v1"
    ),

  dbGuardPresent:
    text.includes(
      "assert_paper_buy_new_risk_allowed_v1"
    ),

  canonicalGlobalControlRow:
    text.includes(
      "control_key = 'global'"
    ),

  controlLockedForShare:
    /from\\s+public\\.trading_system_controls[\\s\\S]*?where\\s+control_key\\s*=\\s*'global'[\\s\\S]*?for\\s+share;/im.test(
      text
    ),

  emergencyStopChecked:
    text.includes(
      "v_control.emergency_stop"
    ),

  paperOrderEnabledChecked:
    text.includes(
      "v_control.paper_order_enabled"
    ),

  failClosedMissingControl:
    text.includes(
      "KILL_SWITCH_NEW_RISK_BLOCKED:CONTROL_ROW_MISSING"
    ),

  createRpcRedefined:
    text.includes(
      "create_paper_buy_order_with_committed_risk_v3"
    ),

  fillRpcRedefined:
    text.includes(
      "execute_paper_buy_order"
    ),

  createRpcGuarded:
    /create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.create_paper_buy_order_with_committed_risk_v3[\\s\\S]*?perform\\s+public\\.assert_paper_buy_new_risk_allowed_v1\\(\\);/im.test(
      text
    ),

  fillRpcGuarded:
    /create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.execute_paper_buy_order[\\s\\S]*?perform\\s+public\\.assert_paper_buy_new_risk_allowed_v1\\(\\);/im.test(
      text
    ),

  exactlyTwoProductionGuardCalls:
    count(
      text,
      "perform public.assert_paper_buy_new_risk_allowed_v1();"
    ) === 2,

  stopLossNotRedefined:
    !/create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.execute_paper_stop_loss\\s*\\(/im.test(
      text
    ),

  createSourceUnmodified:
    !createSource.includes(
      "assert_paper_buy_new_risk_allowed_v1"
    ),

  fillSourceUnmodified:
    !fillSource.includes(
      "assert_paper_buy_new_risk_allowed_v1"
    ),

  serviceRoleOnly:
    text.includes(
      "from public, anon, authenticated"
    ) &&
    text.includes(
      "to service_role"
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
          ? "ALPHA_V3_KILL_SWITCH_DB_CREATE_FILL_GUARDS_V1_STATIC_VERIFIED"
          : "ALPHA_V3_KILL_SWITCH_DB_CREATE_FILL_GUARDS_V1_STATIC_REVIEW",

      checks,
      failed,

      protectedRpc: {
        create:
          "create_paper_buy_order_with_committed_risk_v3",

        fill:
          "execute_paper_buy_order"
      },

      intentionallyUngated: [
        "execute_paper_stop_loss",
        "risk_release",
        "expiry",
        "reconciliation"
      ],

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        ordersCreated: 0,
        positionsChanged: 0
      },

      nextGate:
        failed.length === 0
          ? "PREFLIGHT_AND_DB_PUSH"
          : "REVIEW_DB_GUARD_MIGRATION"
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

const commonNodeHelpers = `
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
        .split(/\\r?\\n/)
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
    .replace(/\\/+$/, "");

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
        /\\/(\\d+|\\*)$/
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
`;

const preflight = `${commonNodeHelpers}

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
    ) + "\\n",
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
`;

write(
  preflightRel,
  preflight
);

const dbVerify = `${commonNodeHelpers}

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
`;

write(
  dbVerifyRel,
  dbVerify
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_KILL_SWITCH_DB_CREATE_FILL_GUARDS_V1_INSTALLED",

      generatedFiles: [
        migrationRel,
        staticRel,
        preflightRel,
        dbVerifyRel
      ],

      protectedRpc: {
        create: {
          name:
            "create_paper_buy_order_with_committed_risk_v3",

          source:
            createSourceRel
        },

        fill: {
          name:
            "execute_paper_buy_order",

          source:
            fillSourceRel
        }
      },

      semantics: {
        emergencyStopTrue:
          "BLOCK_NEW_RISK",

        paperOrderEnabledFalse:
          "BLOCK_NEW_RISK",

        controlMissingOrNull:
          "FAIL_CLOSED",

        protectiveStopLoss:
          "UNCHANGED_ALLOWED",

        maintenanceRiskRelease:
          "UNCHANGED_ALLOWED",

        concurrentTrip:
          "CONTROL_ROW_FOR_SHARE_LINEARIZATION"
      },

      migrationVersion:
        "20261008001600",

      safety: {
        installerDatabaseWrites:
          0,

        productionOrdersCreated:
          0,

        productionPositionsChanged:
          0
      },

      nextAction:
        "STATIC_VERIFY_PREFLIGHT_DB_PUSH_AND_DB_VERIFY"
    },
    null,
    2
  )
);
