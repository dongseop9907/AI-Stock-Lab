const fs = require("fs");
const path = require("path");

const root = process.cwd();

const migrationRel =
  "supabase/migrations/20261009000100_paper_execution_realism_v2_buy_partial_fill.sql";

function envValue(name) {
  const v = process.env[name];
  return v && String(v).trim()
    ? String(v).trim()
    : null;
}

function requireEnv() {
  const url =
    envValue("NEXT_PUBLIC_SUPABASE_URL") ??
    envValue("SUPABASE_URL");

  const key =
    envValue("SUPABASE_SERVICE_ROLE_KEY");

  if (!url) {
    throw new Error(
      "SUPABASE_URL_REQUIRED",
    );
  }

  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY_REQUIRED",
    );
  }

  return {
    url: url.replace(/\/+$/, ""),
    key,
  };
}

function readMigration() {
  const abs =
    path.resolve(
      root,
      migrationRel,
    );

  if (!fs.existsSync(abs)) {
    throw new Error(
      `MIGRATION_MISSING:${migrationRel}`,
    );
  }

  return fs.readFileSync(
    abs,
    "utf8",
  );
}

function migrationChecks(sql) {
  const lower =
    sql.toLowerCase();

  return {
    v2Rpc:
      lower.includes(
        "execute_paper_buy_order_with_execution_price_v2",
      ),

    fillQuantity:
      lower.includes(
        "p_fill_quantity",
      ),

    partialFill:
      lower.includes(
        "v_is_final_fill",
      ) &&
      lower.includes(
        "filled_quantity",
      ) &&
      lower.includes(
        "risk_approved",
      ),

    reservedRiskTransfer:
      lower.includes(
        "reserved_risk_amount",
      ) &&
      lower.includes(
        "v_actual_trade_risk",
      ),

    advisoryLock:
      lower.includes(
        "pg_advisory_xact_lock",
      ),

    killSwitch:
      lower.includes(
        "trading_system_controls",
      ) &&
      lower.includes(
        "emergency_stop",
      ) &&
      lower.includes(
        "paper_order_enabled",
      ) &&
      lower.includes(
        "emergency_stop_active",
      ) &&
      lower.includes(
        "paper_order_disabled",
      ),

    freshnessGuard:
      /freshness|quality_gate|data_quality/i.test(
        sql,
      ),

    brokerFee:
      lower.includes(
        "execution_broker_fee",
      ) &&
      lower.includes(
        "p_broker_fee",
      ),

    transactionCost:
      lower.includes(
        "execution_transaction_cost",
      ),

    noDropTable:
      !/\bdrop\s+table\b/i.test(
        sql,
      ),

    noTruncate:
      !/\btruncate\b/i.test(
        sql,
      ),

    noDelete:
      !/\bdelete\s+from\b/i.test(
        sql,
      ),

    noRealTradingEnable:
      !/real_order_enabled\s*=\s*true/i.test(
        sql,
      ),

    noSchedulerEnable:
      !/automation_enabled\s*=\s*true/i.test(
        sql,
      ),
  };
}

async function getJson(
  url,
  key,
  extraHeaders = {},
) {
  const res =
    await fetch(
      url,
      {
        method: "GET",
        headers: {
          apikey: key,
          Authorization:
            `Bearer ${key}`,
          Accept:
            "application/json",
          ...extraHeaders,
        },
      },
    );

  const text =
    await res.text();

  let body = null;

  try {
    body =
      text
        ? JSON.parse(text)
        : null;
  } catch {
    body = text;
  }

  return {
    ok: res.ok,
    status: res.status,
    body,
    headers:
      Object.fromEntries(
        res.headers.entries(),
      ),
  };
}

async function tableCount(
  base,
  key,
  table,
) {
  const url =
    `${base}/rest/v1/${table}` +
    `?select=id&limit=1`;

  const res =
    await fetch(
      url,
      {
        method: "GET",
        headers: {
          apikey: key,
          Authorization:
            `Bearer ${key}`,
          Accept:
            "application/json",
          Prefer:
            "count=exact",
          Range:
            "0-0",
        },
      },
    );

  const contentRange =
    res.headers.get(
      "content-range",
    );

  const text =
    await res.text();

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      count: null,
      error:
        text.slice(0, 300),
    };
  }

  let count = null;

  if (contentRange) {
    const m =
      /\/(\d+|\*)$/.exec(
        contentRange,
      );

    if (
      m &&
      m[1] !== "*"
    ) {
      count =
        Number(m[1]);
    }
  }

  return {
    ok: true,
    status: res.status,
    count,
  };
}

async function readControls(
  base,
  key,
) {
  const url =
    `${base}/rest/v1/trading_system_controls` +
    `?select=control_key,automation_enabled,paper_order_enabled,real_order_enabled,emergency_stop,updated_at` +
    `&control_key=eq.global`;

  const res =
    await getJson(
      url,
      key,
    );

  const row =
    Array.isArray(res.body)
      ? res.body[0] ?? null
      : null;

  return {
    ok: res.ok,
    status: res.status,
    row,
  };
}

async function readOpenApi(
  base,
  key,
) {
  const res =
    await fetch(
      `${base}/rest/v1/`,
      {
        method: "GET",
        headers: {
          apikey: key,
          Authorization:
            `Bearer ${key}`,
          Accept:
            "application/openapi+json",
        },
      },
    );

  const text =
    await res.text();

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      v1RpcExposed: null,
      v2RpcExposed: null,
      error:
        text.slice(0, 300),
    };
  }

  let body;

  try {
    body =
      JSON.parse(text);
  } catch {
    return {
      ok: false,
      status: res.status,
      v1RpcExposed: null,
      v2RpcExposed: null,
      error:
        "OPENAPI_JSON_PARSE_FAILED",
    };
  }

  const paths =
    body?.paths ?? {};

  return {
    ok: true,
    status: res.status,

    v1RpcExposed:
      Boolean(
        paths[
          "/rpc/execute_paper_buy_order_with_execution_price_v1"
        ],
      ),

    v2RpcExposed:
      Boolean(
        paths[
          "/rpc/execute_paper_buy_order_with_execution_price_v2"
        ],
      ),
  };
}

async function main() {
  const {
    url,
    key,
  } =
    requireEnv();

  const sql =
    readMigration();

  const checks =
    migrationChecks(
      sql,
    );

  const [
    controls,
    orders,
    positions,
    openapi,
  ] =
    await Promise.all([
      readControls(
        url,
        key,
      ),

      tableCount(
        url,
        key,
        "paper_order_requests",
      ),

      tableCount(
        url,
        key,
        "paper_positions",
      ),

      readOpenApi(
        url,
        key,
      ),
    ]);

  const control =
    controls.row;

  const safeControlState =
    Boolean(
      controls.ok &&
      control &&
      control.emergency_stop ===
        false &&
      control.real_order_enabled ===
        false,
    );

  const staticOk =
    Object.values(
      checks,
    ).every(Boolean);

  const dbReadable =
    controls.ok &&
    orders.ok &&
    positions.ok;

  const expectedPreApplyRpcState =
    openapi.ok
      ? (
          openapi.v1RpcExposed ===
            true &&
          openapi.v2RpcExposed ===
            false
        )
      : null;

  const ready =
    staticOk &&
    dbReadable &&
    safeControlState &&
    (
      expectedPreApplyRpcState ===
        true ||
      expectedPreApplyRpcState ===
        null
    );

  const output = {
    status:
      ready
        ? "PAPER_EXECUTION_REALISM_V2_DB_PREFLIGHT_V1_READY"
        : "PAPER_EXECUTION_REALISM_V2_DB_PREFLIGHT_V1_BLOCKED",

    migration: {
      file:
        migrationRel,
      checks,
    },

    database: {
      controls:
        controls.ok
          ? control
          : {
              readFailed: true,
              status:
                controls.status,
            },

      paperOrderCount:
        orders.count,

      paperPositionCount:
        positions.count,

      rpcExposure: {
        openApiReadable:
          openapi.ok,

        v1RpcExposed:
          openapi.v1RpcExposed,

        v2RpcExposed:
          openapi.v2RpcExposed,

        expectedPreApplyState:
          expectedPreApplyRpcState,
      },
    },

    gates: {
      migrationStaticOk:
        staticOk,

      databaseReadable:
        dbReadable,

      emergencyStopOff:
        control?.emergency_stop ===
          false,

      realTradingOff:
        control?.real_order_enabled ===
          false,

      v2NotAlreadyApplied:
        openapi.v2RpcExposed ===
          false
          ? true
          : openapi.ok
            ? false
            : null,
    },

    safety: {
      databaseReadsOnly: true,
      databaseWrites: 0,
      ordersCreated: 0,
      ordersChanged: 0,
      positionsChanged: 0,
      migrationApplied: false,
      realTradingChanged: false,
    },

    nextGate:
      ready
        ? "APPLY_20261009000100_WITH_NO_ORDER_REGRESSION"
        : "FIX_PREFLIGHT_BLOCKER_BEFORE_DB_APPLY",

    details:
      "logs/paper-execution-realism-v2-db-preflight-v1.json",
  };

  fs.mkdirSync(
    path.resolve(
      root,
      "logs",
    ),
    {
      recursive: true,
    },
  );

  fs.writeFileSync(
    path.resolve(
      root,
      output.details,
    ),
    JSON.stringify(
      output,
      null,
      2,
    ) + "\n",
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        status:
          output.status,

        migrationStaticOk:
          output.gates
            .migrationStaticOk,

        control: control
          ? {
              emergency_stop:
                control.emergency_stop,
              paper_order_enabled:
                control.paper_order_enabled,
              real_order_enabled:
                control.real_order_enabled,
            }
          : null,

        counts: {
          paperOrders:
            orders.count,
          paperPositions:
            positions.count,
        },

        rpcExposure:
          output.database
            .rpcExposure,

        nextGate:
          output.nextGate,

        details:
          output.details,
      },
      null,
      2,
    ),
  );

  if (!ready) {
    process.exitCode = 2;
  }
}

main().catch(
  (error) => {
    console.error(
      JSON.stringify(
        {
          status:
            "PAPER_EXECUTION_REALISM_V2_DB_PREFLIGHT_V1_ERROR",
          error:
            error instanceof Error
              ? error.message
              : String(error),
        },
        null,
        2,
      ),
    );

    process.exitCode = 1;
  },
);
