const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = process.cwd();

const migrationRel =
  "supabase/migrations/20261009000200_paper_execution_realism_v2_protective_sell.sql";

const detailsRel =
  "logs/paper-execution-realism-v2-protective-sell-db-preflight-v2.json";

function requiredEnv(names) {
  for (const name of names) {
    const value = process.env[name];

    if (
      typeof value === "string" &&
      value.trim()
    ) {
      return value.trim();
    }
  }

  throw new Error(
    `ENV_REQUIRED:${names.join("|")}`,
  );
}

function normalizeUrl(value) {
  return String(value)
    .replace(/\/+$/, "");
}

function sha256(text) {
  return crypto
    .createHash("sha256")
    .update(text)
    .digest("hex");
}

async function fetchOpenApi(url, key) {
  const response =
    await fetch(
      `${url}/rest/v1/`,
      {
        headers: {
          apikey: key,
          Authorization:
            `Bearer ${key}`,
          Accept:
            "application/openapi+json, application/json",
        },
      },
    );

  const text =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `OPENAPI_READ_FAILED:${response.status}:${text.slice(0, 500)}`,
    );
  }

  return JSON.parse(text);
}

function hasPath(openApi, name) {
  const paths =
    openApi?.paths ?? {};

  return Object.keys(paths)
    .some((key) =>
      key === `/${name}` ||
      key.endsWith(`/${name}`),
    );
}

async function countRows(
  url,
  key,
  table,
) {
  const response =
    await fetch(
      `${url}/rest/v1/${table}?select=id&limit=1`,
      {
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

  const text =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `COUNT_FAILED:${table}:${response.status}:${text.slice(0, 500)}`,
    );
  }

  const range =
    response.headers.get(
      "content-range",
    ) ?? "";

  const match =
    /\/(\d+|\*)$/.exec(
      range,
    );

  if (!match) {
    throw new Error(
      `COUNT_RANGE_MISSING:${table}:${range}`,
    );
  }

  return match[1] === "*"
    ? null
    : Number(match[1]);
}

async function getControl(
  url,
  key,
) {
  const response =
    await fetch(
      `${url}/rest/v1/trading_system_controls?control_key=eq.global&select=emergency_stop,paper_order_enabled,real_order_enabled&limit=1`,
      {
        headers: {
          apikey: key,
          Authorization:
            `Bearer ${key}`,
          Accept:
            "application/json",
        },
      },
    );

  const text =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `CONTROL_READ_FAILED:${response.status}:${text.slice(0, 500)}`,
    );
  }

  const body =
    JSON.parse(text);

  if (
    !Array.isArray(body) ||
    !body[0]
  ) {
    throw new Error(
      "CONTROL_ROW_MISSING",
    );
  }

  return body[0];
}

function validateMigration(sql) {
  const checks = {
    hasTargetRpc:
      /execute_paper_protective_sell_v2/i.test(
        sql,
      ),

    hasAuditTable:
      /paper_protective_execution_fills_v2/i.test(
        sql,
      ),

    referencesActualOrderTable:
      /public\.paper_order_requests/i.test(
        sql,
      ),

    referencesRiskDecisions:
      /public\.risk_decisions/i.test(
        sql,
      ),

    referencesPaperPositions:
      /public\.paper_positions/i.test(
        sql,
      ),

    referencesPaperAccounts:
      /public\.paper_accounts/i.test(
        sql,
      ),

    referencesTradeHistory:
      /public\.paper_trade_history/i.test(
        sql,
      ),

    doesNotReferencePaperOrders:
      !/public\.paper_orders\b/i.test(
        sql,
      ),

    hasPartialFill:
      /p_fill_quantity/i.test(
        sql,
      ) &&
      /v_remaining_position_quantity/i.test(
        sql,
      ),

    hasTransactionCosts:
      /p_broker_fee/i.test(
        sql,
      ) &&
      /p_sell_tax/i.test(
        sql,
      ) &&
      /v_total_transaction_cost/i.test(
        sql,
      ),

    hasPositionRowLock:
      /for\s+update/i.test(
        sql,
      ),

    preservesFinalDelete:
      /delete\s+from\s+public\.paper_positions/i.test(
        sql,
      ),

    preservesPartialUpdate:
      /update\s+public\.paper_positions/i.test(
        sql,
      ),

    doesNotBlockProtectiveKillSwitch:
      !/EMERGENCY_STOP_ACTIVE/i.test(
        sql,
      ) &&
      !/PAPER_ORDER_DISABLED/i.test(
        sql,
      ),

    noRealTradingEnable:
      !/real_order_enabled\s*=\s*true/i.test(
        sql,
      ),
  };

  const failed =
    Object.entries(checks)
      .filter(([, ok]) => !ok)
      .map(([name]) => name);

  return {
    checks,
    failed,
    ok:
      failed.length === 0,
  };
}

async function main() {
  fs.mkdirSync(
    path.resolve(
      root,
      "logs",
    ),
    {
      recursive: true,
    },
  );

  const migrationAbs =
    path.resolve(
      root,
      migrationRel,
    );

  if (
    !fs.existsSync(
      migrationAbs,
    )
  ) {
    throw new Error(
      `MIGRATION_MISSING:${migrationRel}`,
    );
  }

  const sql =
    fs.readFileSync(
      migrationAbs,
      "utf8",
    );

  const migrationStatic =
    validateMigration(
      sql,
    );

  if (!migrationStatic.ok) {
    throw new Error(
      `MIGRATION_STATIC_FAILED:${migrationStatic.failed.join(",")}`,
    );
  }

  const url =
    normalizeUrl(
      requiredEnv([
        "NEXT_PUBLIC_SUPABASE_URL",
        "SUPABASE_URL",
      ]),
    );

  const key =
    requiredEnv([
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_SERVICE_KEY",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "SUPABASE_ANON_KEY",
    ]);

  const openApi =
    await fetchOpenApi(
      url,
      key,
    );

  const requiredRelations = [
    "paper_order_requests",
    "risk_decisions",
    "paper_positions",
    "paper_accounts",
    "paper_trade_history",
  ];

  const relationPresence =
    Object.fromEntries(
      requiredRelations.map(
        (name) => [
          name,
          hasPath(
            openApi,
            name,
          ),
        ],
      ),
    );

  const missingRequiredRelations =
    requiredRelations.filter(
      (name) =>
        relationPresence[name] !==
        true,
    );

  const control =
    await getControl(
      url,
      key,
    );

  const paperOrderRequests =
    await countRows(
      url,
      key,
      "paper_order_requests",
    );

  const paperPositions =
    await countRows(
      url,
      key,
      "paper_positions",
    );

  const v1RpcExposed =
    hasPath(
      openApi,
      "rpc/execute_paper_stop_loss",
    ) ||
    hasPath(
      openApi,
      "execute_paper_stop_loss",
    );

  const v2RpcExposed =
    hasPath(
      openApi,
      "rpc/execute_paper_protective_sell_v2",
    ) ||
    hasPath(
      openApi,
      "execute_paper_protective_sell_v2",
    );

  const v2AuditTableExposed =
    hasPath(
      openApi,
      "paper_protective_execution_fills_v2",
    );

  const expectedPreApplyState =
    v1RpcExposed ===
      true &&
    v2RpcExposed ===
      false &&
    v2AuditTableExposed ===
      false;

  const ready =
    migrationStatic.ok &&
    missingRequiredRelations.length ===
      0 &&
    expectedPreApplyState &&
    control.real_order_enabled ===
      false;

  const result = {
    status:
      ready
        ? "PAPER_EXECUTION_REALISM_V2_PROTECTIVE_SELL_DB_PREFLIGHT_V2_READY"
        : "PAPER_EXECUTION_REALISM_V2_PROTECTIVE_SELL_DB_PREFLIGHT_V2_BLOCKED",

    migration: {
      file:
        migrationRel,
      version:
        "20261009000200",
      sha256:
        sha256(sql),
      staticOk:
        migrationStatic.ok,
      failedStaticChecks:
        migrationStatic.failed,
    },

    schema: {
      relationPresence,
      missingRequiredRelations,
    },

    control,

    counts: {
      paperOrderRequests,
      paperPositions,
    },

    rpcExposure: {
      v1StopLossRpcExposed:
        v1RpcExposed,
      v2ProtectiveSellRpcExposed:
        v2RpcExposed,
      v2AuditTableExposed,
      expectedPreApplyState,
    },

    safety: {
      realTradingStillOff:
        control.real_order_enabled ===
        false,
      createsOrders:
        false,
      createsPositions:
        false,
      changesControls:
        false,
      databaseWrites:
        0,
    },

    nextGate:
      ready
        ? "APPLY_20261009000200_WITH_NO_POSITION_REGRESSION"
        : "STOP_AND_DIAGNOSE_BEFORE_APPLY",

    details:
      detailsRel,
  };

  fs.writeFileSync(
    path.resolve(
      root,
      detailsRel,
    ),
    JSON.stringify(
      {
        ...result,
        migrationStaticChecks:
          migrationStatic.checks,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  console.log(
    JSON.stringify(
      result,
      null,
      2,
    ),
  );

  if (!ready) {
    process.exitCode = 1;
  }
}

main().catch(
  (error) => {
    console.error(
      JSON.stringify(
        {
          status:
            "PAPER_EXECUTION_REALISM_V2_PROTECTIVE_SELL_DB_PREFLIGHT_V2_FAILED",
          error:
            error instanceof Error
              ? error.message
              : String(error),
          safety: {
            databaseWrites:
              0,
            ordersCreated:
              0,
            positionsChanged:
              0,
            controlsChanged:
              false,
          },
          nextGate:
            "STOP_AND_DIAGNOSE_BEFORE_APPLY",
        },
        null,
        2,
      ),
    );

    process.exitCode = 1;
  },
);
