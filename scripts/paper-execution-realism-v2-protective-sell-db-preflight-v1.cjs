const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = process.cwd();

const migrationRel =
  "supabase/migrations/20261009000200_paper_execution_realism_v2_protective_sell.sql";

const detailsRel =
  "logs/paper-execution-realism-v2-protective-sell-db-preflight-v1.json";

function requiredEnv(names) {
  for (const name of names) {
    const value =
      process.env[name];

    if (
      typeof value ===
        "string" &&
      value.trim()
    ) {
      return value.trim();
    }
  }

  throw new Error(
    `ENV_REQUIRED:${names.join("|")}`,
  );
}

function optionalEnv(names) {
  for (const name of names) {
    const value =
      process.env[name];

    if (
      typeof value ===
        "string" &&
      value.trim()
    ) {
      return value.trim();
    }
  }

  return null;
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

async function restJson(
  url,
  key,
  pathname,
) {
  const response =
    await fetch(
      `${url}${pathname}`,
      {
        headers: {
          apikey:
            key,
          Authorization:
            `Bearer ${key}`,
          Accept:
            "application/json",
        },
      },
    );

  const text =
    await response.text();

  let body = null;

  if (text) {
    try {
      body =
        JSON.parse(text);
    } catch {
      body =
        text;
    }
  }

  return {
    ok:
      response.ok,
    status:
      response.status,
    body,
    headers:
      Object.fromEntries(
        response.headers,
      ),
  };
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
          apikey:
            key,
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
  const result =
    await restJson(
      url,
      key,
      "/rest/v1/trading_system_controls?control_key=eq.global&select=emergency_stop,paper_order_enabled,real_order_enabled&limit=1",
    );

  if (
    !result.ok ||
    !Array.isArray(
      result.body,
    ) ||
    !result.body[0]
  ) {
    throw new Error(
      `CONTROL_READ_FAILED:${result.status}:${JSON.stringify(result.body).slice(0, 500)}`,
    );
  }

  return result.body[0];
}

async function getOpenApi(
  url,
  key,
) {
  const response =
    await fetch(
      `${url}/rest/v1/`,
      {
        headers: {
          apikey:
            key,
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
    return {
      ok:
        false,
      status:
        response.status,
      text,
      json:
        null,
    };
  }

  let json = null;

  try {
    json =
      JSON.parse(text);
  } catch {
    json =
      null;
  }

  return {
    ok:
      true,
    status:
      response.status,
    text,
    json,
  };
}

function openApiHasPath(
  openApi,
  fragment,
) {
  if (
    openApi?.json?.paths &&
    typeof openApi.json.paths ===
      "object"
  ) {
    return Object.keys(
      openApi.json.paths,
    ).some((key) =>
      key.includes(
        fragment,
      ),
    );
  }

  return (
    openApi?.text
      ?.includes(fragment) ??
    false
  );
}

function validateMigration(
  sql,
) {
  const checks = {
    hasTargetRpc:
      /execute_paper_protective_sell_v2/i.test(
        sql,
      ),

    hasAuditTable:
      /paper_protective_execution_fills_v2/i.test(
        sql,
      ),

    hasPartialFillQuantity:
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

    adjustsRealizedPnl:
      /v_realized_pnl\s*:=\s*v_realized_pnl\s*-\s*v_total_transaction_cost/i.test(
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
    Object.entries(
      checks,
    )
      .filter(
        ([, ok]) =>
          !ok,
      )
      .map(
        ([name]) =>
          name,
      );

  return {
    checks,
    failed,
    ok:
      failed.length ===
      0,
  };
}

async function main() {
  fs.mkdirSync(
    path.resolve(
      root,
      "logs",
    ),
    {
      recursive:
        true,
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

  if (
    !migrationStatic.ok
  ) {
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

  const control =
    await getControl(
      url,
      key,
    );

  const paperOrders =
    await countRows(
      url,
      key,
      "paper_orders",
    );

  const paperPositions =
    await countRows(
      url,
      key,
      "paper_positions",
    );

  const openApi =
    await getOpenApi(
      url,
      key,
    );

  const v1RpcExposed =
    openApiHasPath(
      openApi,
      "execute_paper_stop_loss",
    );

  const v2RpcExposed =
    openApiHasPath(
      openApi,
      "execute_paper_protective_sell_v2",
    );

  const v2AuditTableExposed =
    openApiHasPath(
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

  const safeControl =
    control
      .real_order_enabled ===
        false;

  const noLiveRisk =
    control
      .emergency_stop ===
        false ||
    control
      .emergency_stop ===
        true;

  const result = {
    status:
      migrationStatic.ok &&
      expectedPreApplyState &&
      safeControl &&
      noLiveRisk
        ? "PAPER_EXECUTION_REALISM_V2_PROTECTIVE_SELL_DB_PREFLIGHT_V1_READY"
        : "PAPER_EXECUTION_REALISM_V2_PROTECTIVE_SELL_DB_PREFLIGHT_V1_BLOCKED",

    migration: {
      file:
        migrationRel,
      version:
        "20261009000200",
      sha256:
        sha256(
          sql,
        ),
      staticOk:
        migrationStatic.ok,
      failedStaticChecks:
        migrationStatic.failed,
    },

    control,

    counts: {
      paperOrders,
      paperPositions,
    },

    rpcExposure: {
      openApiReadable:
        openApi.ok,
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
      migrationStatic.ok &&
      expectedPreApplyState &&
      safeControl
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

  if (
    result.status.endsWith(
      "_BLOCKED",
    )
  ) {
    process.exitCode =
      1;
  }
}

main().catch(
  (error) => {
    const result = {
      status:
        "PAPER_EXECUTION_REALISM_V2_PROTECTIVE_SELL_DB_PREFLIGHT_V1_FAILED",
      error:
        error instanceof Error
          ? error.message
          : String(error),
      migration:
        migrationRel,
      safety: {
        databaseWrites:
          0,
        createsOrders:
          false,
        createsPositions:
          false,
        changesControls:
          false,
      },
      nextGate:
        "STOP_AND_DIAGNOSE_BEFORE_APPLY",
      details:
        detailsRel,
    };

    try {
      fs.mkdirSync(
        path.resolve(
          root,
          "logs",
        ),
        {
          recursive:
            true,
        },
      );

      fs.writeFileSync(
        path.resolve(
          root,
          detailsRel,
        ),
        JSON.stringify(
          result,
          null,
          2,
        ) + "\n",
        "utf8",
      );
    } catch {}

    console.error(
      JSON.stringify(
        result,
        null,
        2,
      ),
    );

    process.exitCode =
      1;
  },
);
