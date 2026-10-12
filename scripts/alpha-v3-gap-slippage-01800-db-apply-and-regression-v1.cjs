const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const root = process.cwd();

const TARGET_VERSION = "20261008001800";
const TARGET_FILE =
  "supabase/migrations/20261008001800_gap_slippage_execution_binding_v1.sql";

const cli = path.resolve(
  root,
  "node_modules/.bin/supabase.cmd",
);

const migrationPath = path.resolve(
  root,
  TARGET_FILE,
);

const reportFile = path.resolve(
  root,
  "logs/alpha-v3-gap-slippage-01800-db-apply-and-regression-v1.json",
);

function parseEnvFile(rel) {
  const file = path.resolve(root, rel);

  if (!fs.existsSync(file)) {
    return {};
  }

  const out = {};

  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const idx = line.indexOf("=");

    if (idx < 1) {
      continue;
    }

    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    out[key] = value;
  }

  return out;
}

const env = {
  ...parseEnvFile(".env"),
  ...parseEnvFile(".env.local"),
  ...process.env,
};

const supabaseUrl =
  env.NEXT_PUBLIC_SUPABASE_URL ||
  env.SUPABASE_URL;

const serviceRoleKey =
  env.SUPABASE_SERVICE_ROLE_KEY;

function fail(message, details = null) {
  const report = {
    status:
      "ALPHA_V3_GAP_SLIPPAGE_01800_DB_APPLY_AND_REGRESSION_BLOCKED",
    message,
    details,
    targetVersion: TARGET_VERSION,
    targetFile: TARGET_FILE,
    safety: {
      ordersCreatedByScript: 0,
      ordersExecutedByScript: 0,
      positionsCreatedByScript: 0,
      productionTradingEnabledByScript: false,
      forwardOosChanged: false,
    },
  };

  fs.mkdirSync(
    path.dirname(reportFile),
    { recursive: true },
  );

  fs.writeFileSync(
    reportFile,
    JSON.stringify(report, null, 2) + "\n",
    "utf8",
  );

  console.log(
    JSON.stringify(report, null, 2),
  );

  process.exit(2);
}

if (!fs.existsSync(cli)) {
  fail("LOCAL_SUPABASE_CLI_NOT_FOUND");
}

if (!fs.existsSync(migrationPath)) {
  fail("TARGET_MIGRATION_NOT_FOUND");
}

if (!supabaseUrl || !serviceRoleKey) {
  fail(
    "SUPABASE_URL_OR_SERVICE_ROLE_KEY_MISSING",
    {
      hasSupabaseUrl: Boolean(supabaseUrl),
      hasServiceRoleKey: Boolean(serviceRoleKey),
    },
  );
}

const migrationSql =
  fs.readFileSync(
    migrationPath,
    "utf8",
  );

const sourceChecks = {
  targetFunctionDefined:
    migrationSql.includes(
      "execute_paper_buy_order_with_execution_price_v1",
    ),

  executionPriceColumns:
    migrationSql.includes(
      "execution_price numeric",
    ) &&
    migrationSql.includes(
      "execution_price_observed_at timestamptz",
    ) &&
    migrationSql.includes(
      "execution_risk_snapshot jsonb",
    ),

  advisoryLockRetained:
    migrationSql.includes(
      "pg_advisory_xact_lock",
    ),

  orderLockRetained:
    /for\s+update/i.test(
      migrationSql,
    ),

  killSwitchRetained:
    migrationSql.includes(
      "trading_system_controls",
    ) &&
    migrationSql.includes(
      "emergency_stop",
    ),

  freshnessGuardRetained:
    migrationSql.includes(
      "market_data_freshness_observations",
    ),

  qualityGuardRetained:
    migrationSql.includes(
      "market_data_quality_gate_observations",
    ),

  riskApprovedGuardRetained:
    migrationSql.includes(
      "RISK_APPROVED",
    ),

  executionDriftGuard:
    migrationSql.includes(
      "ADVERSE_ENTRY_DRIFT_EXCEEDED",
    ),

  reservedRiskGuard:
    migrationSql.includes(
      "ACTUAL_TRADE_RISK_EXCEEDS_RESERVED_RISK",
    ),

  staleSnapshotGuard:
    migrationSql.includes(
      "EXECUTION_SNAPSHOT_STALE",
    ),

  actualExecutionPriceUsed:
    migrationSql.includes(
      "p_execution_price",
    ),
};

function extractSqlFunctionForPreservation(
  source,
  functionName,
) {
  const lower =
    source.toLowerCase();

  const name =
    functionName.toLowerCase();

  const candidates =
    [
      `create or replace function public.${name}(`,
      `create function public.${name}(`,
    ]
      .map(
        (needle) =>
          lower.indexOf(
            needle,
          ),
      )
      .filter(
        (index) =>
          index >= 0,
      );

  if (
    candidates.length ===
    0
  ) {
    throw new Error(
      `PRESERVATION_FUNCTION_NOT_FOUND:${functionName}`,
    );
  }

  const start =
    Math.min(
      ...candidates,
    );

  const tail =
    source.slice(
      start,
    );

  const asMatch =
    tail.match(
      /\bas\s+(\$[A-Za-z0-9_]*\$)/i,
    );

  if (
    !asMatch
  ) {
    throw new Error(
      `PRESERVATION_FUNCTION_DOLLAR_QUOTE_NOT_FOUND:${functionName}`,
    );
  }

  const delimiter =
    asMatch[1];

  const opener =
    tail.indexOf(
      delimiter,
      asMatch.index,
    );

  const closer =
    tail.indexOf(
      delimiter,
      opener +
        delimiter.length,
    );

  if (
    opener <
      0 ||
    closer <
      0
  ) {
    throw new Error(
      `PRESERVATION_FUNCTION_BOUNDARY_NOT_FOUND:${functionName}`,
    );
  }

  let end =
    closer +
    delimiter.length;

  while (
    end <
      tail.length &&
    /\\s/.test(
      tail[end],
    )
  ) {
    end +=
      1;
  }

  if (
    tail[end] ===
    ";"
  ) {
    end +=
      1;
  }

  return tail.slice(
    0,
    end,
  );
}

function preservationFunctionCalls(
  text,
) {
  const calls =
    new Set();

  const regex =
    /\b(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi;

  const ignored =
    new Set([
      "if",
      "coalesce",
      "greatest",
      "least",
      "round",
      "floor",
      "ceil",
      "jsonb_build_object",
      "json_build_object",
      "now",
      "clock_timestamp",
      "current_date",
      "current_timestamp",
      "nullif",
      "abs",
      "lower",
      "upper",
      "substring",
      "cast",
      "count",
      "sum",
      "avg",
      "max",
      "min",
      "exists",
      "array",
      "values",
      "execute_paper_buy_order",
      "execute_paper_buy_order_with_execution_price_v1",
    ]);

  for (
    const match of
      text.matchAll(
        regex,
      )
  ) {
    const call =
      match[1]
        .toLowerCase();

    if (
      !ignored.has(
        call,
      )
    ) {
      calls.add(
        call,
      );
    }
  }

  return [
    ...calls,
  ].sort();
}

function preservationCriticalLiterals(
  text,
) {
  return [
    ...new Set(
      [
        ...text.matchAll(
          /'([^']{3,120})'/g,
        ),
      ]
        .map(
          (match) =>
            match[1],
        )
        .filter(
          (value) =>
            /[A-Z_]{3,}|RISK|FRESH|QUALITY|EMERGENCY|STOP|APPROVED|FILLED|FAILED|BLOCK|STALE/i.test(
              value,
            ),
        ),
    ),
  ].sort();
}

const original01700Path =
  path.resolve(
    root,
    "supabase/migrations/20261008001700_data_freshness_db_create_fill_guards_v1.sql",
  );

if (
  !fs.existsSync(
    original01700Path,
  )
) {
  fail(
    "ORIGINAL_01700_MIGRATION_NOT_FOUND_FOR_SEMANTIC_PRESERVATION",
  );
}

const original01700Sql =
  fs.readFileSync(
    original01700Path,
    "utf8",
  );

const originalFillFn =
  extractSqlFunctionForPreservation(
    original01700Sql,
    "execute_paper_buy_order",
  );

const newFillFn =
  extractSqlFunctionForPreservation(
    migrationSql,
    "execute_paper_buy_order_with_execution_price_v1",
  );

const originalHelperCalls =
  preservationFunctionCalls(
    originalFillFn,
  );

const newHelperCalls =
  preservationFunctionCalls(
    newFillFn,
  );

const missingHelperCalls =
  originalHelperCalls.filter(
    (name) =>
      !newHelperCalls.includes(
        name,
      ),
  );

const originalCriticalLiterals =
  preservationCriticalLiterals(
    originalFillFn,
  );

const newCriticalLiterals =
  preservationCriticalLiterals(
    newFillFn,
  );

const missingCriticalLiterals =
  originalCriticalLiterals.filter(
    (value) =>
      !newCriticalLiterals.includes(
        value,
      ),
  );

const semanticPreservation = {
  originalHelperCallsPreserved:
    missingHelperCalls.length ===
      0,

  originalCriticalLiteralsPreserved:
    missingCriticalLiterals.length ===
      0,

  advisoryLockPreserved:
    !originalFillFn.includes(
      "pg_advisory_xact_lock",
    ) ||
    newFillFn.includes(
      "pg_advisory_xact_lock",
    ),

  rowLockPreserved:
    !/for\s+update/i.test(
      originalFillFn,
    ) ||
    /for\s+update/i.test(
      newFillFn,
    ),

  riskApprovedPreserved:
    !originalFillFn.includes(
      "RISK_APPROVED",
    ) ||
    newFillFn.includes(
      "RISK_APPROVED",
    ),

  freshnessMarkerPreserved:
    !(
      /market_data_freshness_observations|DATA_FRESHNESS/i.test(
        originalFillFn,
      )
    ) ||
    /market_data_freshness_observations|DATA_FRESHNESS/i.test(
      newFillFn,
    ),

  qualityMarkerPreserved:
    !(
      /market_data_quality_gate_observations|DATA_QUALITY/i.test(
        originalFillFn,
      )
    ) ||
    /market_data_quality_gate_observations|DATA_QUALITY/i.test(
      newFillFn,
    ),

  killSwitchMarkerPreserved:
    !(
      /trading_system_controls|emergency_stop/i.test(
        originalFillFn,
      )
    ) ||
    /trading_system_controls|emergency_stop/i.test(
      newFillFn,
    ),
};

const semanticPreservationFailed =
  Object.entries(
    semanticPreservation,
  )
    .filter(
      ([, value]) =>
        !value,
    )
    .map(
      ([name]) =>
        name,
    );

/*
 * Direct table-name checks are diagnostic only.
 * Mandatory gates are:
 * - all non-brittle V1 source checks
 * - exact semantic preservation versus 01700
 */
const mandatorySourceChecks = {
  targetFunctionDefined:
    sourceChecks.targetFunctionDefined,

  executionPriceColumns:
    sourceChecks.executionPriceColumns,

  advisoryLockRetained:
    sourceChecks.advisoryLockRetained,

  orderLockRetained:
    sourceChecks.orderLockRetained,

  riskApprovedGuardRetained:
    sourceChecks.riskApprovedGuardRetained,

  executionDriftGuard:
    sourceChecks.executionDriftGuard,

  reservedRiskGuard:
    sourceChecks.reservedRiskGuard,

  staleSnapshotGuard:
    sourceChecks.staleSnapshotGuard,

  actualExecutionPriceUsed:
    sourceChecks.actualExecutionPriceUsed,
};

const failedSourceChecks =
  Object.entries(
    mandatorySourceChecks,
  )
    .filter(
      ([, value]) =>
        !value,
    )
    .map(
      ([name]) =>
        name,
    );

if (
  failedSourceChecks.length >
    0 ||
  semanticPreservationFailed.length >
    0
) {
  fail(
    "TARGET_MIGRATION_SOURCE_GUARD_REVIEW_REQUIRED",
    {
      sourceChecks,
      mandatorySourceChecks,
      failedSourceChecks,
      semanticPreservation,
      semanticPreservationFailed,
      preservationDetails: {
        originalHelperCalls,
        newHelperCalls,
        missingHelperCalls,
        missingCriticalLiterals,
      },
    },
  );
}

const migrationSha256 =
  crypto
    .createHash("sha256")
    .update(migrationSql)
    .digest("hex");

function quoteCmdArg(value) {
  const s = String(value);

  if (!/[ \t"&|<>^]/.test(s)) {
    return s;
  }

  return `"${s.replace(/"/g, '""')}"`;
}

function runCli(args, timeout = 240000) {
  const comspec =
    process.env.ComSpec ||
    "C:\\Windows\\System32\\cmd.exe";

  const command =
    [
      quoteCmdArg(cli),
      ...args.map(quoteCmdArg),
    ].join(" ");

  const result =
    spawnSync(
      comspec,
      [
        "/d",
        "/s",
        "/c",
        command,
      ],
      {
        cwd: root,
        encoding: "utf8",
        timeout,
        env: process.env,
      },
    );

  return {
    status:
      result.status,
    signal:
      result.signal,
    error:
      result.error
        ? String(result.error.message || result.error)
        : null,
    stdout:
      result.stdout || "",
    stderr:
      result.stderr || "",
    combined:
      `${result.stdout || ""}\n${result.stderr || ""}`.trim(),
  };
}

function parseMigrationList(text) {
  const rows = [];

  for (const raw of text.split(/\r?\n/)) {
    const line =
      raw.replace(/│/g, "|");

    const parts =
      line.split("|");

    if (parts.length < 2) {
      continue;
    }

    const localMatch =
      parts[0].match(/\b(\d{14})\b/);

    const remoteMatch =
      parts[1].match(/\b(\d{14})\b/);

    if (!localMatch && !remoteMatch) {
      continue;
    }

    rows.push({
      local:
        localMatch?.[1] ?? null,
      remote:
        remoteMatch?.[1] ?? null,
    });
  }

  return rows;
}

function migrationState(rows) {
  const localOnly =
    rows
      .filter(
        (row) =>
          row.local &&
          !row.remote,
      )
      .map(
        (row) =>
          row.local,
      );

  const remoteOnly =
    rows
      .filter(
        (row) =>
          !row.local &&
          row.remote,
      )
      .map(
        (row) =>
          row.remote,
      );

  const targetRows =
    rows.filter(
      (row) =>
        row.local === TARGET_VERSION ||
        row.remote === TARGET_VERSION,
    );

  const targetApplied =
    targetRows.some(
      (row) =>
        row.local === TARGET_VERSION &&
        row.remote === TARGET_VERSION,
    );

  const targetPending =
    targetRows.some(
      (row) =>
        row.local === TARGET_VERSION &&
        !row.remote,
    );

  return {
    localOnly,
    remoteOnly,
    targetApplied,
    targetPending,
  };
}

async function restRequest(
  pathname,
  init = {},
) {
  const url =
    `${supabaseUrl.replace(/\/$/, "")}/rest/v1/${pathname}`;

  const response =
    await fetch(
      url,
      {
        ...init,
        headers: {
          apikey:
            serviceRoleKey,
          Authorization:
            `Bearer ${serviceRoleKey}`,
          ...(init.headers || {}),
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
    contentRange:
      response.headers.get(
        "content-range",
      ),
  };
}

async function readSafetySnapshot() {
  const [
    approvedOrders,
    positions,
    reservedOrders,
    systemControl,
    freshness,
    quality,
  ] =
    await Promise.all([
      restRequest(
        "paper_order_requests?select=id,status&status=eq.RISK_APPROVED&limit=5",
        {
          method:
            "GET",
        },
      ),

      restRequest(
        "paper_positions?select=id,stock_code&limit=5",
        {
          method:
            "GET",
        },
      ),

      restRequest(
        "paper_order_requests?select=id,status,reserved_risk_amount,reserved_risk_released_at&reserved_risk_amount=gt.0&reserved_risk_released_at=is.null&limit=5",
        {
          method:
            "GET",
        },
      ),

      restRequest(
        "trading_system_controls?select=emergency_stop,automation_enabled,paper_order_enabled,real_order_enabled&limit=1",
        {
          method:
            "GET",
        },
      ),

      restRequest(
        "market_data_freshness_observations?select=status,expected_market_date,observed_at&order=observed_at.desc&limit=1",
        {
          method:
            "GET",
        },
      ),

      restRequest(
        "market_data_quality_gate_observations?select=status,observed_at&order=observed_at.desc&limit=1",
        {
          method:
            "GET",
        },
      ),
    ]);

  const requiredReads = {
    approvedOrders:
      approvedOrders.ok,
    positions:
      positions.ok,
    reservedOrders:
      reservedOrders.ok,
    systemControl:
      systemControl.ok,
    freshness:
      freshness.ok,
    quality:
      quality.ok,
  };

  const failedReads =
    Object.entries(requiredReads)
      .filter(([, value]) => !value)
      .map(([name]) => name);

  if (failedReads.length > 0) {
    fail(
      "PRE_APPLY_DB_SAFETY_READ_FAILED",
      {
        failedReads,
        statuses: {
          approvedOrders:
            approvedOrders.status,
          positions:
            positions.status,
          reservedOrders:
            reservedOrders.status,
          systemControl:
            systemControl.status,
          freshness:
            freshness.status,
          quality:
            quality.status,
        },
      },
    );
  }

  return {
    riskApprovedOrders:
      Array.isArray(approvedOrders.body)
        ? approvedOrders.body
        : [],

    positions:
      Array.isArray(positions.body)
        ? positions.body
        : [],

    activeReservedRiskOrders:
      Array.isArray(reservedOrders.body)
        ? reservedOrders.body
        : [],

    systemControl:
      Array.isArray(systemControl.body)
        ? systemControl.body[0] ?? null
        : null,

    freshness:
      Array.isArray(freshness.body)
        ? freshness.body[0] ?? null
        : null,

    quality:
      Array.isArray(quality.body)
        ? quality.body[0] ?? null
        : null,
  };
}

async function verifyNewColumns() {
  const result =
    await restRequest(
      [
        "paper_order_requests",
        "?select=",
        [
          "id",
          "execution_price",
          "execution_price_observed_at",
          "execution_price_source",
          "execution_rejection_reason",
          "execution_risk_snapshot",
        ].join(","),
        "&limit=1",
      ].join(""),
      {
        method:
          "GET",
      },
    );

  return {
    verified:
      result.ok,
    status:
      result.status,
    errorCode:
      result.ok
        ? null
        : (
            typeof result.body === "object" &&
            result.body
          )
          ? result.body.code ?? null
          : null,
  };
}

async function verifyNewRpcExists() {
  const fakeUuid =
    "00000000-0000-0000-0000-000000000000";

  let last = null;

  for (
    let attempt = 1;
    attempt <= 6;
    attempt += 1
  ) {
    const response =
      await restRequest(
        "rpc/execute_paper_buy_order_with_execution_price_v1",
        {
          method:
            "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body:
            JSON.stringify({
              p_order_id:
                fakeUuid,

              p_execution_price:
                1,

              p_execution_observed_at:
                new Date().toISOString(),
            }),
        },
      );

    const code =
      (
        typeof response.body === "object" &&
        response.body
      )
        ? response.body.code ?? null
        : null;

    last = {
      httpStatus:
        response.status,
      code,
      functionMissing:
        code === "PGRST202" ||
        response.status === 404,
    };

    if (!last.functionMissing) {
      return {
        exists:
          true,
        ...last,
      };
    }

    await new Promise(
      (resolve) =>
        setTimeout(
          resolve,
          1000,
        ),
    );
  }

  return {
    exists:
      false,
    ...last,
  };
}

async function main() {
  const before =
    await readSafetySnapshot();

  if (
    before.riskApprovedOrders.length > 0 ||
    before.positions.length > 0 ||
    before.activeReservedRiskOrders.length > 0
  ) {
    fail(
      "NO_ORDER_PRECONDITION_FAILED",
      {
        riskApprovedOrders:
          before.riskApprovedOrders.length,
        positions:
          before.positions.length,
        activeReservedRiskOrders:
          before.activeReservedRiskOrders.length,
      },
    );
  }

  const listBefore =
    runCli([
      "migration",
      "list",
      "--linked",
    ]);

  if (listBefore.status !== 0) {
    fail(
      "SUPABASE_MIGRATION_LIST_FAILED",
      {
        status:
          listBefore.status,
        output:
          listBefore.combined.slice(
            -4000,
          ),
      },
    );
  }

  const rowsBefore =
    parseMigrationList(
      listBefore.combined,
    );

  const stateBefore =
    migrationState(
      rowsBefore,
    );

  if (
    stateBefore.remoteOnly.length > 0
  ) {
    fail(
      "REMOTE_ONLY_MIGRATION_HISTORY_DIVERGENCE",
      stateBefore,
    );
  }

  const otherPending =
    stateBefore.localOnly.filter(
      (version) =>
        version !== TARGET_VERSION,
    );

  if (otherPending.length > 0) {
    fail(
      "OTHER_PENDING_MIGRATIONS_PRESENT",
      {
        targetVersion:
          TARGET_VERSION,
        otherPending,
      },
    );
  }

  let dryRun = null;
  let push = null;
  let appliedNow = false;

  if (!stateBefore.targetApplied) {
    if (!stateBefore.targetPending) {
      fail(
        "TARGET_MIGRATION_NOT_VISIBLE_AS_SINGLE_PENDING_MIGRATION",
        stateBefore,
      );
    }

    dryRun =
      runCli([
        "db",
        "push",
        "--linked",
        "--dry-run",
      ]);

    if (dryRun.status !== 0) {
      fail(
        "SUPABASE_DB_PUSH_DRY_RUN_FAILED",
        {
          status:
            dryRun.status,
          output:
            dryRun.combined.slice(
              -4000,
            ),
        },
      );
    }

    const dryText =
      dryRun.combined;

    if (!dryText.includes(TARGET_VERSION)) {
      fail(
        "DRY_RUN_DOES_NOT_INCLUDE_TARGET_MIGRATION",
        {
          output:
            dryText.slice(
              -4000,
            ),
        },
      );
    }

    const dryVersions =
      [
        ...new Set(
          (
            dryText.match(
              /\b\d{14}\b/g,
            ) ??
            []
          ),
        ),
      ];

    const suspiciousDryVersions =
      dryVersions.filter(
        (version) =>
          version !== TARGET_VERSION,
      );

    if (suspiciousDryVersions.length > 0) {
      fail(
        "DRY_RUN_CONTAINS_OTHER_MIGRATION_VERSIONS",
        {
          targetVersion:
            TARGET_VERSION,
          suspiciousDryVersions,
        },
      );
    }

    /*
     * REAL DB WRITE:
     * only reached after no-order, migration-history and dry-run gates.
     */
    push =
      runCli([
        "db",
        "push",
        "--linked",
        "--yes",
      ]);

    if (push.status !== 0) {
      fail(
        "SUPABASE_DB_PUSH_FAILED",
        {
          status:
            push.status,
          output:
            push.combined.slice(
              -5000,
            ),
        },
      );
    }

    appliedNow =
      true;
  }

  const listAfter =
    runCli([
      "migration",
      "list",
      "--linked",
    ]);

  if (listAfter.status !== 0) {
    fail(
      "POST_APPLY_MIGRATION_LIST_FAILED",
      {
        status:
          listAfter.status,
        output:
          listAfter.combined.slice(
            -4000,
          ),
      },
    );
  }

  const rowsAfter =
    parseMigrationList(
      listAfter.combined,
    );

  const stateAfter =
    migrationState(
      rowsAfter,
    );

  if (!stateAfter.targetApplied) {
    fail(
      "TARGET_MIGRATION_NOT_APPLIED_AFTER_PUSH",
      stateAfter,
    );
  }

  if (stateAfter.localOnly.length > 0) {
    fail(
      "PENDING_MIGRATIONS_REMAIN_AFTER_PUSH",
      stateAfter,
    );
  }

  const [
    columns,
    rpc,
    after,
  ] =
    await Promise.all([
      verifyNewColumns(),
      verifyNewRpcExists(),
      readSafetySnapshot(),
    ]);

  if (!columns.verified) {
    fail(
      "EXECUTION_AUDIT_COLUMNS_NOT_VERIFIED",
      columns,
    );
  }

  if (!rpc.exists) {
    fail(
      "NEW_EXECUTION_PRICE_RPC_NOT_VISIBLE",
      rpc,
    );
  }

  const noOrderRegression = {
    riskApprovedOrders:
      after.riskApprovedOrders.length === 0,

    positions:
      after.positions.length === 0,

    activeReservedRiskOrders:
      after.activeReservedRiskOrders.length === 0,
  };

  const failedNoOrder =
    Object.entries(
      noOrderRegression,
    )
      .filter(([, value]) => !value)
      .map(([name]) => name);

  if (failedNoOrder.length > 0) {
    fail(
      "POST_APPLY_NO_ORDER_REGRESSION_FAILED",
      {
        noOrderRegression,
        failedNoOrder,
      },
    );
  }

  const controlUnchanged =
    JSON.stringify(
      before.systemControl,
    ) ===
    JSON.stringify(
      after.systemControl,
    );

  const report = {
    status:
      "ALPHA_V3_GAP_SLIPPAGE_01800_DB_APPLY_AND_REGRESSION_VERIFIED",

    target: {
      version:
        TARGET_VERSION,

      file:
        TARGET_FILE,

      sha256:
        migrationSha256,

      appliedNow,

      alreadyAppliedBefore:
        stateBefore.targetApplied,
    },

    preflight: {
      sourceChecks,

      semanticPreservation: {
        checks:
          semanticPreservation,

        originalHelperCallCount:
          originalHelperCalls.length,

        newHelperCallCount:
          newHelperCalls.length,

        missingHelperCalls,

        missingCriticalLiterals,

        directMarkerDiagnostics: {
          killSwitchRetained:
            sourceChecks.killSwitchRetained,

          freshnessGuardRetained:
            sourceChecks.freshnessGuardRetained,

          qualityGuardRetained:
            sourceChecks.qualityGuardRetained,
        },
      },

      migrationHistory: {
        localOnly:
          stateBefore.localOnly,

        remoteOnly:
          stateBefore.remoteOnly,

        targetPending:
          stateBefore.targetPending,

        targetApplied:
          stateBefore.targetApplied,
      },

      noOrder: {
        riskApprovedOrders:
          0,

        positions:
          0,

        activeReservedRiskOrders:
          0,
      },
    },

    apply: {
      dryRunPassed:
        stateBefore.targetApplied
          ? null
          : dryRun?.status === 0,

      dbPushPassed:
        stateBefore.targetApplied
          ? null
          : push?.status === 0,

      pendingAfter:
        stateAfter.localOnly,
    },

    verification: {
      migrationApplied:
        stateAfter.targetApplied,

      executionAuditColumns:
        columns.verified,

      executionPriceRpc:
        rpc.exists,

      rpcProbeWasNoRealOrder:
        true,

      killSwitchAndSystemControlRecordUnchanged:
        controlUnchanged,

      freshnessReadable:
        Boolean(
          after.freshness,
        ),

      qualityGateReadable:
        Boolean(
          after.quality,
        ),

      noOrderRegression,

      sourceRetainedKillSwitchGuard:
        sourceChecks.killSwitchRetained,

      sourceRetainedFreshnessGuard:
        sourceChecks.freshnessGuardRetained,

      sourceRetainedQualityGuard:
        sourceChecks.qualityGuardRetained,

      sourceRetainedAdvisoryLock:
        sourceChecks.advisoryLockRetained,

      sourceRetainedOrderLock:
        sourceChecks.orderLockRetained,
    },

    currentState: {
      systemControl:
        after.systemControl,

      freshness:
        after.freshness,

      quality:
        after.quality,
    },

    safety: {
      ordersCreatedByScript:
        0,

      ordersExecutedByScript:
        0,

      positionsCreatedByScript:
        0,

      fakeRpcOrderId:
        "NONEXISTENT_UUID_ONLY",

      realTradingEnabledByScript:
        false,

      schedulerChanged:
        false,

      forwardOosChanged:
        false,
    },

    nextGate:
      "GAP_SLIPPAGE_EXECUTION_BINDING_V1_DB_BOUND_THEN_TYPESCRIPT_AND_NO_ORDER_EXECUTOR_SMOKE",
  };

  fs.mkdirSync(
    path.dirname(reportFile),
    {
      recursive:
        true,
    },
  );

  fs.writeFileSync(
    reportFile,
    JSON.stringify(
      report,
      null,
      2,
    ) +
    "\n",
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        status:
          report.status,

        target:
          report.target,

        verification:
          report.verification,

        currentState:
          report.currentState,

        safety:
          report.safety,

        fullLogFile:
          "logs/alpha-v3-gap-slippage-01800-db-apply-and-regression-v1.json",

        nextGate:
          report.nextGate,
      },
      null,
      2,
    ),
  );
}

main().catch(
  (error) => {
    fail(
      "UNEXPECTED_APPLY_OR_VERIFY_ERROR",
      {
        message:
          error instanceof Error
            ? error.message
            : String(error),
      },
    );
  },
);
