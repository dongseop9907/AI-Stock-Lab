const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const root = process.cwd();

const migrationVersion =
  "20261009000500";

const migrationRel =
  "supabase/migrations/20261009000500_model_shadow_outcome_canonical_storage_v1.sql";

const detailsRel =
  "logs/model-shadow-outcome-canonical-storage-v1-db-apply-regression.json";

const modelId =
  "3045646b-599b-41cd-9650-43e539fb7a95";

function firstEnv(names) {
  for (const name of names) {
    const value = process.env[name];

    if (
      typeof value === "string" &&
      value.trim()
    ) {
      return value.trim();
    }
  }

  return null;
}

function normalizeUrl(value) {
  return String(value).replace(/\/+$/, "");
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

  return fs.existsSync(candidate)
    ? candidate
    : "powershell.exe";
}

function npxCmd() {
  const preferred =
    "C:\\Program Files\\nodejs\\npx.cmd";

  return fs.existsSync(preferred)
    ? preferred
    : "npx.cmd";
}

function psQuote(value) {
  return String(value).replace(/'/g, "''");
}

function runSupabase(args) {
  const argText = [
    "supabase",
    ...args,
  ]
    .map(
      (value) =>
        `'${psQuote(value)}'`,
    )
    .join(" ");

  const command =
    `& '${psQuote(npxCmd())}' ${argText} 2>&1 | Out-String; ` +
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

  const combined =
    `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();

  const codeMatch =
    /__SUPABASE_EXIT_CODE__=(-?\d+)/.exec(
      combined,
    );

  const code =
    codeMatch
      ? Number(codeMatch[1])
      : (
          typeof result.status === "number"
            ? result.status
            : 1
        );

  const output =
    combined
      .replace(
        /__SUPABASE_EXIT_CODE__=-?\d+/g,
        "",
      )
      .trim();

  return {
    code,
    output,
  };
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
    .some(
      (key) =>
        key === `/${name}` ||
        key.endsWith(`/${name}`),
    );
}

function schemaColumns(openApi, name) {
  const schemas =
    openApi?.definitions ??
    openApi?.components?.schemas ??
    {};

  const direct =
    schemas[name];

  if (direct?.properties) {
    return Object.keys(
      direct.properties,
    );
  }

  for (
    const [schemaName, schema]
    of Object.entries(schemas)
  ) {
    if (
      schemaName
        .toLowerCase()
        .endsWith(
          name.toLowerCase(),
        ) &&
      schema?.properties
    ) {
      return Object.keys(
        schema.properties,
      );
    }
  }

  return [];
}

async function waitForTable(url, key) {
  let last = null;

  for (
    let attempt = 1;
    attempt <= 12;
    attempt += 1
  ) {
    const openApi =
      await fetchOpenApi(
        url,
        key,
      );

    const present =
      hasPath(
        openApi,
        "model_shadow_signal_outcomes",
      );

    const columns =
      present
        ? schemaColumns(
            openApi,
            "model_shadow_signal_outcomes",
          )
        : [];

    last = {
      attempt,
      present,
      columns,
    };

    if (present) {
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
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    body,
  };
}

async function countRows(
  url,
  key,
  table,
  query = "",
) {
  const suffix =
    query
      ? `&${query}`
      : "";

  const response =
    await fetch(
      `${url}/rest/v1/${table}?select=*&limit=1${suffix}`,
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
    /\/(\d+|\*)$/.exec(range);

  if (!match) {
    throw new Error(
      `COUNT_RANGE_MISSING:${table}:${range}`,
    );
  }

  return match[1] === "*"
    ? null
    : Number(match[1]);
}

async function readModel(url, key) {
  const result =
    await fetchJson(
      url,
      key,
      `/rest/v1/ai_model_versions?id=eq.${encodeURIComponent(modelId)}&select=id,model_name,model_version,status,promotion_stage,promotion_stage_updated_at,promotion_stage_reason&limit=1`,
    );

  if (
    !result.ok ||
    !Array.isArray(result.body) ||
    !result.body[0]
  ) {
    throw new Error(
      `MODEL_READ_FAILED:${result.status}:${JSON.stringify(result.body).slice(0, 500)}`,
    );
  }

  return result.body[0];
}

async function readControls(url, key) {
  const result =
    await fetchJson(
      url,
      key,
      "/rest/v1/trading_system_controls?control_key=eq.global&select=emergency_stop,automation_enabled,paper_order_enabled,real_order_enabled&limit=1",
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

function sameControls(a, b) {
  return (
    a.emergency_stop ===
      b.emergency_stop &&
    a.automation_enabled ===
      b.automation_enabled &&
    a.paper_order_enabled ===
      b.paper_order_enabled &&
    a.real_order_enabled ===
      b.real_order_enabled
  );
}

async function main() {
  fs.mkdirSync(
    path.resolve(root, "logs"),
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

  const urlRaw =
    firstEnv([
      "NEXT_PUBLIC_SUPABASE_URL",
      "SUPABASE_URL",
    ]);

  const key =
    firstEnv([
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_SERVICE_KEY",
    ]);

  if (!urlRaw || !key) {
    throw new Error(
      "SERVICE_ROLE_ENV_REQUIRED_FOR_SHADOW_STORAGE_APPLY",
    );
  }

  const url =
    normalizeUrl(
      urlRaw,
    );

  const beforeModel =
    await readModel(
      url,
      key,
    );

  const beforeControls =
    await readControls(
      url,
      key,
    );

  if (
    beforeModel.promotion_stage !==
      "SHADOW"
  ) {
    throw new Error(
      `MODEL_MUST_REMAIN_SHADOW:${beforeModel.promotion_stage}`,
    );
  }

  if (
    beforeControls.real_order_enabled !==
      false
  ) {
    throw new Error(
      "REAL_TRADING_MUST_BE_OFF",
    );
  }

  const [
    beforeSignals,
    beforePostShadowSignals,
    beforeEvents,
    beforeOrders,
    beforePositions,
  ] =
    await Promise.all([
      countRows(
        url,
        key,
        "ai_entry_signals",
        `model_id=eq.${encodeURIComponent(modelId)}`,
      ),

      countRows(
        url,
        key,
        "ai_entry_signals",
        `model_id=eq.${encodeURIComponent(modelId)}&created_at=gte.${encodeURIComponent(beforeModel.promotion_stage_updated_at)}`,
      ),

      countRows(
        url,
        key,
        "model_promotion_events",
      ),

      countRows(
        url,
        key,
        "paper_order_requests",
      ),

      countRows(
        url,
        key,
        "paper_positions",
      ),
    ]);

  const preOpenApi =
    await fetchOpenApi(
      url,
      key,
    );

  if (
    hasPath(
      preOpenApi,
      "model_shadow_signal_outcomes",
    )
  ) {
    throw new Error(
      "CANONICAL_TABLE_ALREADY_PRESENT_BEFORE_TARGET_APPLY",
    );
  }

  const dryRun =
    runSupabase([
      "db",
      "push",
      "--linked",
      "--dry-run",
    ]);

  if (dryRun.code !== 0) {
    throw new Error(
      `SUPABASE_DRY_RUN_FAILED:${dryRun.output.slice(0, 1800)}`,
    );
  }

  if (
    !dryRun.output.includes(
      migrationVersion,
    )
  ) {
    throw new Error(
      "TARGET_MIGRATION_NOT_PENDING",
    );
  }

  const apply =
    runSupabase([
      "db",
      "push",
      "--linked",
      "--yes",
    ]);

  if (apply.code !== 0) {
    throw new Error(
      `SUPABASE_APPLY_FAILED:${apply.output.slice(0, 2200)}`,
    );
  }

  const postDryRun =
    runSupabase([
      "db",
      "push",
      "--linked",
      "--dry-run",
    ]);

  if (postDryRun.code !== 0) {
    throw new Error(
      `POST_APPLY_DRY_RUN_FAILED:${postDryRun.output.slice(0, 1800)}`,
    );
  }

  if (
    postDryRun.output.includes(
      migrationVersion,
    )
  ) {
    throw new Error(
      "TARGET_MIGRATION_STILL_PENDING_AFTER_APPLY",
    );
  }

  const tableWait =
    await waitForTable(
      url,
      key,
    );

  if (
    tableWait?.present !==
      true
  ) {
    throw new Error(
      "CANONICAL_TABLE_NOT_EXPOSED_AFTER_APPLY",
    );
  }

  const requiredColumns = [
    "id",
    "signal_id",
    "model_id",
    "stock_code",
    "captured_at",
    "promotion_stage_at_capture",
    "promotion_stage_updated_at_at_capture",
    "evaluation_status",
    "entry_open_price",
    "return_1d",
    "return_3d",
    "return_5d",
    "max_return_1d",
    "max_return_3d",
    "max_return_5d",
    "min_return_1d",
    "min_return_3d",
    "min_return_5d",
    "evaluated_at",
    "evidence",
    "source_version",
    "created_at",
    "updated_at",
  ];

  const missingColumns =
    requiredColumns.filter(
      (column) =>
        !tableWait.columns.includes(
          column,
        ),
    );

  const canonicalCount =
    await countRows(
      url,
      key,
      "model_shadow_signal_outcomes",
    );

  const [
    afterModel,
    afterControls,
    afterSignals,
    afterPostShadowSignals,
    afterEvents,
    afterOrders,
    afterPositions,
  ] =
    await Promise.all([
      readModel(
        url,
        key,
      ),
      readControls(
        url,
        key,
      ),

      countRows(
        url,
        key,
        "ai_entry_signals",
        `model_id=eq.${encodeURIComponent(modelId)}`,
      ),

      countRows(
        url,
        key,
        "ai_entry_signals",
        `model_id=eq.${encodeURIComponent(modelId)}&created_at=gte.${encodeURIComponent(beforeModel.promotion_stage_updated_at)}`,
      ),

      countRows(
        url,
        key,
        "model_promotion_events",
      ),

      countRows(
        url,
        key,
        "paper_order_requests",
      ),

      countRows(
        url,
        key,
        "paper_positions",
      ),
    ]);

  const checks = {
    migrationApplied:
      true,

    canonicalTableExposed:
      tableWait.present ===
        true,

    canonicalColumnsComplete:
      missingColumns.length ===
        0,

    canonicalTableStartsEmpty:
      canonicalCount ===
        0,

    historicalSignalsNotBackfilled:
      canonicalCount ===
        0 &&
      beforeSignals ===
        afterSignals,

    postShadowSignalsStillZero:
      beforePostShadowSignals ===
        0 &&
      afterPostShadowSignals ===
        0,

    modelStillShadow:
      afterModel.promotion_stage ===
        "SHADOW",

    legacyStatusUnchanged:
      afterModel.status ===
        beforeModel.status,

    promotionMetadataUnchanged:
      afterModel.promotion_stage_updated_at ===
        beforeModel.promotion_stage_updated_at &&
      afterModel.promotion_stage_reason ===
        beforeModel.promotion_stage_reason,

    promotionEventsUnchanged:
      afterEvents ===
        beforeEvents,

    noOrdersCreated:
      afterOrders ===
        beforeOrders,

    noPositionsChanged:
      afterPositions ===
        beforePositions,

    controlsUnchanged:
      sameControls(
        beforeControls,
        afterControls,
      ),

    realTradingStillOff:
      afterControls.real_order_enabled ===
        false,
  };

  const failed =
    Object.entries(checks)
      .filter(
        ([, ok]) => !ok,
      )
      .map(
        ([name]) => name,
      );

  const result = {
    status:
      failed.length === 0
        ? "MODEL_SHADOW_OUTCOME_CANONICAL_STORAGE_V1_DB_APPLY_AND_REGRESSION_VERIFIED"
        : "MODEL_SHADOW_OUTCOME_CANONICAL_STORAGE_V1_DB_APPLY_AND_REGRESSION_FAILED",

    migration: {
      version:
        migrationVersion,
      file:
        migrationRel,
      sha256:
        sha256(sql),
    },

    canonicalStorage: {
      table:
        "model_shadow_signal_outcomes",
      rowCount:
        canonicalCount,
      requiredColumnCount:
        requiredColumns.length,
      missingColumns,
    },

    model: {
      beforeStage:
        beforeModel.promotion_stage,
      afterStage:
        afterModel.promotion_stage,
      shadowStartedAt:
        afterModel.promotion_stage_updated_at,
      legacyStatus:
        afterModel.status,
    },

    signals: {
      total:
        `${beforeSignals}->${afterSignals}`,
      postShadow:
        `${beforePostShadowSignals}->${afterPostShadowSignals}`,
      historicalBackfillRows:
        canonicalCount,
    },

    counts: {
      promotionEvents:
        `${beforeEvents}->${afterEvents}`,
      orders:
        `${beforeOrders}->${afterOrders}`,
      positions:
        `${beforePositions}->${afterPositions}`,
    },

    controls: {
      before:
        beforeControls,
      after:
        afterControls,
    },

    checks,
    failed,

    safety: {
      historicalBackfill:
        canonicalCount !== 0,
      promotionStageChanged:
        beforeModel.promotion_stage !==
          afterModel.promotion_stage,
      ordersCreated:
        afterOrders -
        beforeOrders,
      positionsChanged:
        afterPositions -
        beforePositions,
      controlsChanged:
        !sameControls(
          beforeControls,
          afterControls,
        ),
      realTradingEnabledByScript:
        false,
      allowedDatabaseWrites: [
        "supabase migration metadata",
        "canonical table/schema creation only"
      ],
    },

    nextGate:
      failed.length === 0
        ? "BIND_POST_SHADOW_CAPTURE_AND_EVALUATION_TO_CANONICAL_STORAGE"
        : "STOP_AND_DIAGNOSE_SHADOW_STORAGE_DB_APPLY",

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
          exposedColumns:
            tableWait.columns,
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
        "MODEL_SHADOW_OUTCOME_CANONICAL_STORAGE_V1_DB_APPLY_AND_REGRESSION_FAILED",
      error:
        error instanceof Error
          ? error.message
          : String(error),
      safety: {
        realTradingEnabledByScript:
          false,
      },
      nextGate:
        "STOP_AND_DIAGNOSE_SHADOW_STORAGE_DB_APPLY",
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
          recursive: true,
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

    process.exitCode = 1;
  },
);
