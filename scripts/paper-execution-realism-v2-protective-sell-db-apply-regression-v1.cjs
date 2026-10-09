const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const root = process.cwd();

const migrationVersion =
  "20261009000200";

const migrationRel =
  "supabase/migrations/20261009000200_paper_execution_realism_v2_protective_sell.sql";

const detailsRel =
  "logs/paper-execution-realism-v2-protective-sell-db-apply-regression-v1.json";

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

function powershellExe() {
  const systemRoot =
    process.env.SystemRoot ||
    process.env.WINDIR ||
    "C:\\Windows";

  const candidate =
    path.join(
      systemRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );

  if (fs.existsSync(candidate)) {
    return candidate;
  }

  return "powershell.exe";
}

function npxCmd() {
  const preferred =
    "C:\\Program Files\\nodejs\\npx.cmd";

  if (fs.existsSync(preferred)) {
    return preferred;
  }

  return "npx.cmd";
}

function psQuote(value) {
  return String(value)
    .replace(/'/g, "''");
}

function runSupabase(args) {
  const npx =
    npxCmd();

  const argText =
    [
      "supabase",
      ...args,
    ]
      .map((x) =>
        `'${psQuote(x)}'`,
      )
      .join(" ");

  const command =
    `& '${psQuote(npx)}' ${argText} 2>&1 | Out-String; ` +
    `$code=$LASTEXITCODE; ` +
    `Write-Output "__SUPABASE_EXIT_CODE__=$code"; ` +
    `exit $code`;

  const result =
    spawnSync(
      powershellExe(),
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        command,
      ],
      {
        cwd: root,
        env: process.env,
        encoding: "utf8",
        windowsHide: true,
        maxBuffer:
          20 * 1024 * 1024,
      },
    );

  const stdout =
    result.stdout ?? "";

  const stderr =
    result.stderr ?? "";

  const combined =
    `${stdout}\n${stderr}`.trim();

  const codeMatch =
    /__SUPABASE_EXIT_CODE__=(-?\d+)/.exec(
      combined,
    );

  const parsedCode =
    codeMatch
      ? Number(codeMatch[1])
      : (
          typeof result.status ===
            "number"
            ? result.status
            : 1
        );

  const cleaned =
    combined
      .replace(
        /__SUPABASE_EXIT_CODE__=-?\d+/g,
        "",
      )
      .trim();

  return {
    code:
      parsedCode,
    output:
      cleaned,
  };
}

function extractMigrationVersions(text) {
  return [
    ...new Set(
      String(text)
        .match(/\b20\d{12}\b/g) ??
      [],
    ),
  ];
}

async function fetchJson(
  url,
  key,
  pathname,
) {
  const response =
    await fetch(
      `${url}${pathname}`,
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

async function fetchOpenApi(
  url,
  key,
) {
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

function hasPath(
  openApi,
  name,
) {
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
      `${url}/rest/v1/${table}?select=*&limit=1`,
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
  const result =
    await fetchJson(
      url,
      key,
      "/rest/v1/trading_system_controls?control_key=eq.global&select=emergency_stop,paper_order_enabled,real_order_enabled&limit=1",
    );

  if (
    !result.ok ||
    !Array.isArray(result.body) ||
    !result.body[0]
  ) {
    throw new Error(
      `CONTROL_READ_FAILED:${result.status}:${JSON.stringify(result.body).slice(0, 500)}`,
    );
  }

  return result.body[0];
}

function controlsEqual(a, b) {
  return (
    a.emergency_stop ===
      b.emergency_stop &&
    a.paper_order_enabled ===
      b.paper_order_enabled &&
    a.real_order_enabled ===
      b.real_order_enabled
  );
}

async function waitForPostgrestSchema(
  url,
  key,
) {
  let last = null;

  for (
    let attempt = 1;
    attempt <= 8;
    attempt += 1
  ) {
    const openApi =
      await fetchOpenApi(
        url,
        key,
      );

    const v2Rpc =
      hasPath(
        openApi,
        "rpc/execute_paper_protective_sell_v2",
      ) ||
      hasPath(
        openApi,
        "execute_paper_protective_sell_v2",
      );

    const auditTable =
      hasPath(
        openApi,
        "paper_protective_execution_fills_v2",
      );

    last = {
      attempt,
      openApi,
      v2Rpc,
      auditTable,
    };

    if (
      v2Rpc &&
      auditTable
    ) {
      return last;
    }

    await new Promise(
      (resolve) =>
        setTimeout(
          resolve,
          750,
        ),
    );
  }

  return last;
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

  if (!fs.existsSync(migrationAbs)) {
    throw new Error(
      `MIGRATION_MISSING:${migrationRel}`,
    );
  }

  const sql =
    fs.readFileSync(
      migrationAbs,
      "utf8",
    );

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

  const beforeControl =
    await getControl(
      url,
      key,
    );

  const beforeOrders =
    await countRows(
      url,
      key,
      "paper_order_requests",
    );

  const beforePositions =
    await countRows(
      url,
      key,
      "paper_positions",
    );

  const beforeOpenApi =
    await fetchOpenApi(
      url,
      key,
    );

  const beforeV2Rpc =
    hasPath(
      beforeOpenApi,
      "rpc/execute_paper_protective_sell_v2",
    ) ||
    hasPath(
      beforeOpenApi,
      "execute_paper_protective_sell_v2",
    );

  const beforeAuditTable =
    hasPath(
      beforeOpenApi,
      "paper_protective_execution_fills_v2",
    );

  if (
    beforeControl
      .real_order_enabled !==
      false
  ) {
    throw new Error(
      "REAL_TRADING_MUST_BE_OFF_BEFORE_APPLY",
    );
  }

  if (
    beforeV2Rpc ||
    beforeAuditTable
  ) {
    throw new Error(
      "EXPECTED_PRE_APPLY_SCHEMA_STATE_NOT_FOUND",
    );
  }

  const dryRun =
    runSupabase([
      "db",
      "push",
      "--linked",
      "--dry-run",
    ]);

  if (
    dryRun.code !==
      0
  ) {
    throw new Error(
      `SUPABASE_DRY_RUN_FAILED:${dryRun.output.slice(0, 1500)}`,
    );
  }

  const dryRunVersions =
    extractMigrationVersions(
      dryRun.output,
    );

  const targetPending =
    dryRunVersions.includes(
      migrationVersion,
    ) ||
    dryRun.output.includes(
      migrationVersion,
    );

  const newerOrSamePending =
    dryRunVersions
      .filter(
        (version) =>
          version >=
          migrationVersion,
      );

  const unexpectedPending =
    newerOrSamePending
      .filter(
        (version) =>
          version !==
          migrationVersion,
      );

  if (!targetPending) {
    throw new Error(
      "TARGET_MIGRATION_NOT_PENDING_IN_DRY_RUN",
    );
  }

  if (
    unexpectedPending.length >
    0
  ) {
    throw new Error(
      `UNEXPECTED_PENDING_MIGRATIONS:${unexpectedPending.join(",")}`,
    );
  }

  const apply =
    runSupabase([
      "db",
      "push",
      "--linked",
      "--yes",
    ]);

  if (
    apply.code !==
      0
  ) {
    throw new Error(
      `SUPABASE_APPLY_FAILED:${apply.output.slice(0, 2000)}`,
    );
  }

  const postDryRun =
    runSupabase([
      "db",
      "push",
      "--linked",
      "--dry-run",
    ]);

  if (
    postDryRun.code !==
      0
  ) {
    throw new Error(
      `POST_APPLY_DRY_RUN_FAILED:${postDryRun.output.slice(0, 1500)}`,
    );
  }

  const targetStillPending =
    postDryRun.output.includes(
      migrationVersion,
    );

  if (targetStillPending) {
    throw new Error(
      "TARGET_MIGRATION_STILL_PENDING_AFTER_APPLY",
    );
  }

  const schemaWait =
    await waitForPostgrestSchema(
      url,
      key,
    );

  const afterControl =
    await getControl(
      url,
      key,
    );

  const afterOrders =
    await countRows(
      url,
      key,
      "paper_order_requests",
    );

  const afterPositions =
    await countRows(
      url,
      key,
      "paper_positions",
    );

  const auditRows =
    schemaWait?.auditTable
      ? await countRows(
          url,
          key,
          "paper_protective_execution_fills_v2",
        )
      : null;

  const checks = {
    migrationApplied:
      targetStillPending ===
      false,

    v2RpcExposed:
      schemaWait?.v2Rpc ===
      true,

    auditTableExposed:
      schemaWait
        ?.auditTable ===
      true,

    auditTableStartsEmpty:
      auditRows ===
      0,

    noOrdersCreated:
      beforeOrders ===
      afterOrders,

    noPositionsCreated:
      beforePositions ===
      afterPositions,

    controlsUnchanged:
      controlsEqual(
        beforeControl,
        afterControl,
      ),

    realTradingStillOff:
      afterControl
        .real_order_enabled ===
      false,
  };

  const failed =
    Object.entries(checks)
      .filter(([, ok]) => !ok)
      .map(([name]) => name);

  const result = {
    status:
      failed.length ===
        0
        ? "PAPER_EXECUTION_REALISM_V2_PROTECTIVE_SELL_DB_APPLY_AND_REGRESSION_V1_VERIFIED"
        : "PAPER_EXECUTION_REALISM_V2_PROTECTIVE_SELL_DB_APPLY_AND_REGRESSION_V1_FAILED",

    migration: {
      version:
        migrationVersion,
      file:
        migrationRel,
      sha256:
        sha256(sql),
    },

    dryRunPending: {
      target:
        targetPending,
      versions:
        dryRunVersions,
      unexpected:
        unexpectedPending,
    },

    checks,
    failed,

    counts: {
      beforeOrders,
      afterOrders,
      beforePositions,
      afterPositions,
      auditRows,
    },

    controls: {
      before:
        beforeControl,
      after:
        afterControl,
    },

    schema: {
      refreshAttempts:
        schemaWait
          ?.attempt ??
        null,
      v2RpcExposed:
        schemaWait
          ?.v2Rpc ??
        false,
      auditTableExposed:
        schemaWait
          ?.auditTable ??
        false,
    },

    safety: {
      ordersCreated:
        afterOrders -
        beforeOrders,
      positionsCreated:
        afterPositions -
        beforePositions,
      realTradingEnabledByScript:
        false,
      controlsChanged:
        !controlsEqual(
          beforeControl,
          afterControl,
        ),
    },

    nextGate:
      failed.length ===
        0
        ? "RUN_POST_DB_PROTECTIVE_SELL_NO_POSITION_SMOKE"
        : "STOP_AND_DIAGNOSE_BEFORE_ANY_EXECUTION_TEST",

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
        raw: {
          dryRun:
            dryRun.output,
          apply:
            apply.output,
          postDryRun:
            postDryRun.output,
        },
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
    failed.length >
    0
  ) {
    process.exitCode =
      1;
  }
}

main().catch(
  (error) => {
    const result = {
      status:
        "PAPER_EXECUTION_REALISM_V2_PROTECTIVE_SELL_DB_APPLY_AND_REGRESSION_V1_FAILED",
      error:
        error instanceof Error
          ? error.message
          : String(error),
      safety: {
        realTradingEnabledByScript:
          false,
      },
      nextGate:
        "STOP_AND_DIAGNOSE_BEFORE_ANY_EXECUTION_TEST",
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
