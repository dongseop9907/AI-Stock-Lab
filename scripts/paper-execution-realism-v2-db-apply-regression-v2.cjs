const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const root = process.cwd();

const MIGRATION_VERSION = "20261009000100";
const MIGRATION_FILE =
  "supabase/migrations/20261009000100_paper_execution_realism_v2_buy_partial_fill.sql";

const LOG_FILE =
  "logs/paper-execution-realism-v2-db-apply-regression-v2.json";

function sleep(ms) {
  return new Promise((resolve) =>
    setTimeout(resolve, ms),
  );
}

function envValue(name) {
  const v = process.env[name];
  return v && String(v).trim()
    ? String(v).trim()
    : null;
}

function requireSupabaseEnv() {
  const url =
    envValue("NEXT_PUBLIC_SUPABASE_URL") ??
    envValue("SUPABASE_URL");

  const key =
    envValue("SUPABASE_SERVICE_ROLE_KEY");

  if (!url) {
    throw new Error("SUPABASE_URL_REQUIRED");
  }

  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY_REQUIRED");
  }

  return {
    url: url.replace(/\/+$/, ""),
    key,
  };
}

function migrationBytes() {
  const abs = path.resolve(root, MIGRATION_FILE);

  if (!fs.existsSync(abs)) {
    throw new Error(
      `MIGRATION_MISSING:${MIGRATION_FILE}`,
    );
  }

  return fs.readFileSync(abs);
}

function sha256(buffer) {
  return crypto
    .createHash("sha256")
    .update(buffer)
    .digest("hex");
}

function quoteCmdArg(value) {
  const text =
    String(value);

  if (
    !/[\s"&|<>^]/.test(text)
  ) {
    return text;
  }

  return `"${text.replace(/"/g, '""')}"`;
}

function commandNpx(args) {
  const comspec =
    process.env.ComSpec ||
    process.env.COMSPEC ||
    "cmd.exe";

  const npxPath =
    "C:\\Program Files\\nodejs\\npx.cmd";

  const quoted =
    args
      .map(quoteCmdArg)
      .join(" ");

  /*
   * cmd.exe /s /c has special handling when the command itself
   * starts with a quoted executable path.  The complete command
   * therefore needs one additional outer quote pair:
   *
   *   ""C:\Program Files\nodejs\npx.cmd" supabase ... "
   */
  const command =
    `""${npxPath}" ${quoted}"`;

  return {
    comspec,
    command,
    mode:
      "WINDOWS_CMDEXE_OUTER_QUOTE_PAIR",
  };
}

function runCmd(command, input = null) {
  const comspec =
    process.env.ComSpec ||
    process.env.COMSPEC ||
    "cmd.exe";

  return spawnSync(
    comspec,
    ["/d", "/s", "/c", command],
    {
      cwd: root,
      encoding: "utf8",
      input: input ?? undefined,
      stdio:
        input === null
          ? ["ignore", "pipe", "pipe"]
          : ["pipe", "pipe", "pipe"],
      env: process.env,
      maxBuffer: 20 * 1024 * 1024,
    },
  );
}

function runNpx(args) {
  const { command } =
    commandNpx(args);

  return runCmd(command);
}

function combined(result) {
  return [
    result.stdout ?? "",
    result.stderr ?? "",
  ]
    .filter(Boolean)
    .join("\n");
}

function compactCommandResult(result) {
  return {
    status:
      typeof result.status === "number"
        ? result.status
        : null,
    signal:
      result.signal ?? null,
    stdoutTail:
      String(result.stdout ?? "")
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-30),
    stderrTail:
      String(result.stderr ?? "")
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-30),
  };
}

async function getJson(
  url,
  key,
  extraHeaders = {},
) {
  const res = await fetch(
    url,
    {
      method: "GET",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        ...extraHeaders,
      },
    },
  );

  const text = await res.text();

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

async function readControls(base, key) {
  const url =
    `${base}/rest/v1/trading_system_controls` +
    `?select=control_key,automation_enabled,paper_order_enabled,real_order_enabled,emergency_stop,updated_at` +
    `&control_key=eq.global`;

  const res = await getJson(url, key);

  return {
    ok: res.ok,
    status: res.status,
    row:
      Array.isArray(res.body)
        ? res.body[0] ?? null
        : null,
  };
}

async function tableCount(
  base,
  key,
  table,
) {
  const res = await fetch(
    `${base}/rest/v1/${table}?select=id&limit=1`,
    {
      method: "GET",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        Prefer: "count=exact",
        Range: "0-0",
      },
    },
  );

  const text = await res.text();

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      count: null,
      error: text.slice(0, 300),
    };
  }

  const contentRange =
    res.headers.get("content-range");

  let count = null;

  if (contentRange) {
    const match =
      /\/(\d+|\*)$/.exec(contentRange);

    if (match && match[1] !== "*") {
      count = Number(match[1]);
    }
  }

  return {
    ok: true,
    status: res.status,
    count,
  };
}

async function readOpenApi(base, key) {
  const res = await fetch(
    `${base}/rest/v1/`,
    {
      method: "GET",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: "application/openapi+json",
      },
    },
  );

  const text = await res.text();

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      v1: null,
      v2: null,
    };
  }

  let body;

  try {
    body = JSON.parse(text);
  } catch {
    return {
      ok: false,
      status: res.status,
      v1: null,
      v2: null,
    };
  }

  const paths = body?.paths ?? {};

  return {
    ok: true,
    status: res.status,
    v1:
      Boolean(
        paths[
          "/rpc/execute_paper_buy_order_with_execution_price_v1"
        ],
      ),
    v2:
      Boolean(
        paths[
          "/rpc/execute_paper_buy_order_with_execution_price_v2"
        ],
      ),
  };
}

async function readV2Columns(base, key) {
  const columns = [
    "id",
    "execution_broker_fee",
    "execution_transaction_cost",
    "execution_fill_count",
  ].join(",");

  const res = await getJson(
    `${base}/rest/v1/paper_order_requests?select=${encodeURIComponent(columns)}&limit=0`,
    key,
  );

  return {
    ok: res.ok,
    status: res.status,
    error:
      res.ok
        ? null
        : typeof res.body === "string"
          ? res.body.slice(0, 300)
          : res.body,
  };
}

async function snapshot(base, key) {
  const [
    controls,
    orders,
    positions,
    openapi,
    columns,
  ] =
    await Promise.all([
      readControls(base, key),
      tableCount(
        base,
        key,
        "paper_order_requests",
      ),
      tableCount(
        base,
        key,
        "paper_positions",
      ),
      readOpenApi(base, key),
      readV2Columns(base, key),
    ]);

  return {
    controls,
    orders,
    positions,
    openapi,
    columns,
  };
}

function pendingMigrationFiles(text) {
  const matches =
    [
      ...String(text).matchAll(
        /([0-9]{14}_[A-Za-z0-9_.-]+\.sql)/g,
      ),
    ].map((m) => m[1]);

  return [...new Set(matches)];
}

function pendingMigrationVersions(text) {
  const files =
    pendingMigrationFiles(text);

  if (files.length) {
    return [
      ...new Set(
        files.map((x) =>
          x.slice(0, 14),
        ),
      ),
    ];
  }

  const lines =
    String(text)
      .split(/\r?\n/)
      .filter((line) =>
        /push|migration|apply|would/i.test(line),
      );

  const versions = [];

  for (const line of lines) {
    for (
      const m of line.matchAll(
        /\b(20\d{12})\b/g,
      )
    ) {
      versions.push(m[1]);
    }
  }

  return [...new Set(versions)];
}

function ensureBaseline(before) {
  const control =
    before.controls.row;

  if (
    !before.controls.ok ||
    !control
  ) {
    throw new Error(
      "BASELINE_CONTROL_UNREADABLE",
    );
  }

  if (
    control.emergency_stop !== false
  ) {
    throw new Error(
      "BASELINE_EMERGENCY_STOP_NOT_FALSE",
    );
  }

  if (
    control.real_order_enabled !== false
  ) {
    throw new Error(
      "BASELINE_REAL_TRADING_NOT_FALSE",
    );
  }

  if (
    before.orders.count !== 0 ||
    before.positions.count !== 0
  ) {
    throw new Error(
      "BASELINE_NOT_EMPTY_ABORTING_APPLY",
    );
  }

  if (
    before.openapi.ok &&
    before.openapi.v2 === true
  ) {
    throw new Error(
      "V2_RPC_ALREADY_EXPOSED_ABORTING_REAPPLY",
    );
  }

  if (
    before.openapi.ok &&
    before.openapi.v1 !== true
  ) {
    throw new Error(
      "V1_RPC_NOT_EXPOSED",
    );
  }
}

function validateMigrationText(sql) {
  const checks = {
    v2Rpc:
      sql.includes(
        "execute_paper_buy_order_with_execution_price_v2",
      ),
    transaction:
      /\bbegin\s*;/i.test(sql) &&
      /\bcommit\s*;/i.test(sql),
    partialFill:
      sql.includes("p_fill_quantity") &&
      sql.includes("v_is_final_fill"),
    killSwitch:
      sql.includes("trading_system_controls") &&
      sql.includes("EMERGENCY_STOP_ACTIVE") &&
      sql.includes("PAPER_ORDER_DISABLED"),
    riskTransfer:
      sql.includes("reserved_risk_amount") &&
      sql.includes("v_actual_trade_risk"),
    noDropTable:
      !/\bdrop\s+table\b/i.test(sql),
    noTruncate:
      !/\btruncate\b/i.test(sql),
    noDelete:
      !/\bdelete\s+from\b/i.test(sql),
    noRealTradingEnable:
      !/real_order_enabled\s*=\s*true/i.test(sql),
  };

  if (
    !Object.values(checks).every(Boolean)
  ) {
    throw new Error(
      `MIGRATION_STATIC_GUARD_FAILED:${JSON.stringify(checks)}`,
    );
  }

  return checks;
}

async function waitForV2Schema(
  base,
  key,
) {
  for (
    let attempt = 1;
    attempt <= 12;
    attempt += 1
  ) {
    const openapi =
      await readOpenApi(base, key);

    const columns =
      await readV2Columns(base, key);

    if (
      openapi.ok &&
      openapi.v2 === true &&
      columns.ok
    ) {
      return {
        attempt,
        openapi,
        columns,
      };
    }

    await sleep(1000);
  }

  return {
    attempt: 12,
    openapi:
      await readOpenApi(base, key),
    columns:
      await readV2Columns(base, key),
  };
}

async function main() {
  const {
    url,
    key,
  } = requireSupabaseEnv();

  const bytes =
    migrationBytes();

  const sql =
    bytes.toString("utf8");

  const digest =
    sha256(bytes);

  const staticChecks =
    validateMigrationText(sql);

  const before =
    await snapshot(url, key);

  ensureBaseline(before);

  /*
   * First ask the exact CLI used by the project what it would apply.
   * Do not continue if any migration other than 20261009000100 is pending.
   */
  const dryRun =
    runNpx([
      "supabase",
      "db",
      "push",
      "--linked",
      "--dry-run",
    ]);

  const dryText =
    combined(dryRun);

  if (dryRun.status !== 0) {
    throw new Error(
      `SUPABASE_DB_PUSH_DRY_RUN_FAILED:${dryRun.status}:${dryText.slice(-1200)}`,
    );
  }

  const pendingVersions =
    pendingMigrationVersions(dryText);

  if (
    !pendingVersions.includes(
      MIGRATION_VERSION,
    )
  ) {
    throw new Error(
      `TARGET_MIGRATION_NOT_PENDING:${JSON.stringify(pendingVersions)}`,
    );
  }

  const unexpectedPending =
    pendingVersions.filter(
      (version) =>
        version !==
        MIGRATION_VERSION,
    );

  if (unexpectedPending.length) {
    throw new Error(
      `UNEXPECTED_PENDING_MIGRATIONS:${JSON.stringify(unexpectedPending)}`,
    );
  }

  /*
   * Determine whether this CLI exposes --yes.
   * If not, feed a single 'y' to the normal interactive prompt.
   */
  const help =
    runNpx([
      "supabase",
      "db",
      "push",
      "--help",
    ]);

  const helpText =
    combined(help);

  let applyResult;
  let applyMode;

  if (
    /--yes\b/i.test(helpText)
  ) {
    applyMode =
      "SUPABASE_DB_PUSH_LINKED_YES";

    applyResult =
      runNpx([
        "supabase",
        "db",
        "push",
        "--linked",
        "--yes",
      ]);
  } else {
    applyMode =
      "SUPABASE_DB_PUSH_LINKED_STDIN_CONFIRM";

    const { command } =
      commandNpx([
        "supabase",
        "db",
        "push",
        "--linked",
      ]);

    applyResult =
      runCmd(
        command,
        "y\r\n",
      );
  }

  const applyText =
    combined(applyResult);

  if (
    applyResult.status !== 0
  ) {
    throw new Error(
      `SUPABASE_DB_PUSH_FAILED:${applyResult.status}:${applyText.slice(-1600)}`,
    );
  }

  const schema =
    await waitForV2Schema(
      url,
      key,
    );

  const after =
    await snapshot(url, key);

  const afterControl =
    after.controls.row;

  const checks = {
    migrationApplied:
      schema.openapi?.v2 ===
        true,

    v2ColumnsReadable:
      schema.columns?.ok ===
        true,

    v1StillExposed:
      after.openapi.ok
        ? after.openapi.v1 ===
          true
        : false,

    noOrdersCreated:
      before.orders.count === 0 &&
      after.orders.count === 0,

    noPositionsCreated:
      before.positions.count === 0 &&
      after.positions.count === 0,

    emergencyStopUnchangedOff:
      before.controls.row
        ?.emergency_stop ===
        false &&
      afterControl
        ?.emergency_stop ===
        false,

    realTradingStillOff:
      before.controls.row
        ?.real_order_enabled ===
        false &&
      afterControl
        ?.real_order_enabled ===
        false,

    paperOrderFlagUnchanged:
      before.controls.row
        ?.paper_order_enabled ===
      afterControl
        ?.paper_order_enabled,
  };

  const verified =
    Object.values(checks)
      .every(Boolean);

  const output = {
    status:
      verified
        ? "PAPER_EXECUTION_REALISM_V2_DB_APPLY_AND_REGRESSION_V2_VERIFIED"
        : "PAPER_EXECUTION_REALISM_V2_DB_APPLY_AND_REGRESSION_V2_FAILED",

    migration: {
      version:
        MIGRATION_VERSION,
      file:
        MIGRATION_FILE,
      sha256:
        digest,
      staticChecks,
    },

    dryRun: {
      pendingVersions,
      invocationMode:
        commandNpx([
          "supabase",
          "db",
          "push",
          "--linked",
          "--dry-run",
        ]).mode,
      command:
        compactCommandResult(
          dryRun,
        ),
    },

    apply: {
      mode:
        applyMode,
      command:
        compactCommandResult(
          applyResult,
        ),
    },

    schemaRefresh: schema,

    before: {
      control:
        before.controls.row,
      orders:
        before.orders.count,
      positions:
        before.positions.count,
      rpc:
        before.openapi,
    },

    after: {
      control:
        after.controls.row,
      orders:
        after.orders.count,
      positions:
        after.positions.count,
      rpc:
        after.openapi,
      columns:
        after.columns,
    },

    checks,

    safety: {
      ordersCreatedByScript: 0,
      positionsCreatedByScript: 0,
      realTradingEnabledByScript: false,
      schedulerEnabledByScript: false,
      testOrderInserted: false,
    },

    nextGate:
      verified
        ? "RUN_POST_DB_NO_ORDER_TYPESCRIPT_REGRESSION"
        : "STOP_AND_DIAGNOSE_DB_APPLY_REGRESSION",

    details:
      LOG_FILE,
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
      LOG_FILE,
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

        migration: {
          version:
            MIGRATION_VERSION,
          sha256:
            digest,
        },

        dryRunPending:
          pendingVersions,

        applyMode,

        checks,

        counts: {
          beforeOrders:
            before.orders.count,
          afterOrders:
            after.orders.count,
          beforePositions:
            before.positions.count,
          afterPositions:
            after.positions.count,
        },

        controls: {
          emergency_stop:
            afterControl
              ?.emergency_stop,
          paper_order_enabled:
            afterControl
              ?.paper_order_enabled,
          real_order_enabled:
            afterControl
              ?.real_order_enabled,
        },

        rpc: {
          v1:
            after.openapi.v1,
          v2:
            after.openapi.v2,
        },

        nextGate:
          output.nextGate,

        details:
          LOG_FILE,
      },
      null,
      2,
    ),
  );

  if (!verified) {
    process.exitCode = 2;
  }
}

main().catch(
  async (error) => {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    const failure = {
      status:
        "PAPER_EXECUTION_REALISM_V2_DB_APPLY_AND_REGRESSION_V2_BLOCKED",
      error:
        message,
      migration:
        MIGRATION_FILE,
      safety: {
        noTestOrderIntent: true,
        realTradingEnableIntent: false,
        schedulerEnableIntent: false,
      },
      nextGate:
        "STOP_AND_DIAGNOSE_BEFORE_RETRY",
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
        LOG_FILE,
      ),
      JSON.stringify(
        failure,
        null,
        2,
      ) + "\n",
      "utf8",
    );

    console.error(
      JSON.stringify(
        failure,
        null,
        2,
      ),
    );

    process.exitCode = 1;
  },
);
