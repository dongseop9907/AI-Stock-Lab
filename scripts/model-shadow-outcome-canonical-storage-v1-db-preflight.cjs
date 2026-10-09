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
  "logs/model-shadow-outcome-canonical-storage-v1-db-preflight.json";

const modelId =
  "3045646b-599b-41cd-9650-43e539fb7a95";

function firstEnv(names) {
  for (const name of names) {
    const value =
      process.env[name];

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
  return String(value)
    .replace(/'/g, "''");
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
    .some(
      (key) =>
        key === `/${name}` ||
        key.endsWith(
          `/${name}`,
        ),
    );
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
      body = text;
    }
  }

  return {
    ok: response.ok,
    status:
      response.status,
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

async function readModel(
  url,
  key,
) {
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

async function readControls(
  url,
  key,
) {
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

function localLaterMigrationFiles() {
  const dir =
    path.resolve(
      root,
      "supabase/migrations",
    );

  return fs.readdirSync(dir)
    .filter(
      (name) =>
        /^\d{14}_.+\.sql$/.test(
          name,
        ),
    )
    .filter(
      (name) =>
        name.slice(0, 14) >
        migrationVersion,
    )
    .sort();
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

  const staticChecks = {
    canonicalTableCreate:
      /create\s+table\s+if\s+not\s+exists\s+public\.model_shadow_signal_outcomes/i.test(
        sql,
      ),

    noHistoricalBackfill:
      !/insert\s+into\s+public\.model_shadow_signal_outcomes[\s\S]{0,1500}select[\s\S]{0,1500}from\s+public\.ai_entry_signals/i.test(
        sql,
      ),

    stageLockedToShadow:
      sql.includes(
        "promotion_stage_at_capture = 'SHADOW'",
      ),

    uniqueSignalId:
      /signal_id\s+uuid\s+not\s+null\s+unique/i.test(
        sql,
      ),

    hasReturnHorizons:
      [
        "return_1d",
        "return_3d",
        "return_5d",
      ].every(
        (column) =>
          sql.includes(column),
      ),

    noPromotionMutation:
      !/(update|insert\s+into|delete\s+from)\s+public\.ai_model_versions/i.test(
        sql,
      ),

    noOrderMutation:
      !/(update|insert\s+into|delete\s+from)\s+public\.paper_order_requests/i.test(
        sql,
      ),

    noPositionMutation:
      !/(update|insert\s+into|delete\s+from)\s+public\.paper_positions/i.test(
        sql,
      ),

    noControlMutation:
      !/(update|insert\s+into|delete\s+from)\s+public\.trading_system_controls/i.test(
        sql,
      ),

    noRealTradingEnable:
      !/real_order_enabled\s*=\s*true/i.test(
        sql,
      ),
  };

  const failedStaticChecks =
    Object.entries(
      staticChecks,
    )
      .filter(
        ([, ok]) => !ok,
      )
      .map(
        ([name]) => name,
      );

  if (
    failedStaticChecks.length >
      0
  ) {
    throw new Error(
      `MIGRATION_STATIC_CHECK_FAILED:${failedStaticChecks.join(",")}`,
    );
  }

  const urlRaw =
    firstEnv([
      "NEXT_PUBLIC_SUPABASE_URL",
      "SUPABASE_URL",
    ]);

  const key =
    firstEnv([
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_SERVICE_KEY",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "SUPABASE_ANON_KEY",
    ]);

  if (!urlRaw || !key) {
    throw new Error(
      "SUPABASE_ENV_MISSING",
    );
  }

  const url =
    normalizeUrl(
      urlRaw,
    );

  const openApi =
    await fetchOpenApi(
      url,
      key,
    );

  const canonicalTableAlreadyPresent =
    hasPath(
      openApi,
      "model_shadow_signal_outcomes",
    );

  const model =
    await readModel(
      url,
      key,
    );

  const controls =
    await readControls(
      url,
      key,
    );

  if (
    controls.real_order_enabled !==
      false
  ) {
    throw new Error(
      "REAL_TRADING_MUST_BE_OFF_BEFORE_SHADOW_STORAGE_APPLY",
    );
  }

  if (
    model.promotion_stage !==
      "SHADOW"
  ) {
    throw new Error(
      `MODEL_MUST_BE_SHADOW_BEFORE_STORAGE_APPLY:${model.promotion_stage}`,
    );
  }

  const shadowStartedAt =
    model.promotion_stage_updated_at;

  if (!shadowStartedAt) {
    throw new Error(
      "SHADOW_PROMOTION_TIMESTAMP_MISSING",
    );
  }

  const [
    allSignals,
    postShadowSignals,
    orders,
    positions,
    promotionEvents,
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
        `model_id=eq.${encodeURIComponent(modelId)}&created_at=gte.${encodeURIComponent(shadowStartedAt)}`,
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

      countRows(
        url,
        key,
        "model_promotion_events",
      ),
    ]);

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
      `SUPABASE_DRY_RUN_FAILED:${dryRun.output.slice(0, 1800)}`,
    );
  }

  const targetPending =
    dryRun.output.includes(
      migrationVersion,
    );

  const laterLocalMigrations =
    localLaterMigrationFiles();

  const laterPendingMigrations =
    laterLocalMigrations.filter(
      (name) =>
        dryRun.output.includes(
          name.slice(0, 14),
        ),
    );

  const checks = {
    migrationStaticOk:
      failedStaticChecks.length ===
      0,

    canonicalTableNotYetPresent:
      canonicalTableAlreadyPresent ===
      false,

    targetMigrationPending:
      targetPending ===
      true,

    noLaterPendingMigration:
      laterPendingMigrations.length ===
      0,

    modelCurrentlyShadow:
      model.promotion_stage ===
      "SHADOW",

    shadowPromotionTimestampPresent:
      Boolean(
        shadowStartedAt,
      ),

    historicalSignalsExist:
      (allSignals ?? 0) >
      0,

    historicalSignalsNotBackfilledByMigration:
      staticChecks.noHistoricalBackfill ===
      true,

    noPaperOrders:
      orders ===
      0,

    noOpenPaperPositions:
      positions ===
      0,

    promotionAuditExists:
      (promotionEvents ?? 0) >=
      1,

    realTradingStillOff:
      controls.real_order_enabled ===
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
        ? "MODEL_SHADOW_OUTCOME_CANONICAL_STORAGE_V1_DB_PREFLIGHT_READY"
        : "MODEL_SHADOW_OUTCOME_CANONICAL_STORAGE_V1_DB_PREFLIGHT_FAILED",

    migration: {
      version:
        migrationVersion,
      file:
        migrationRel,
      sha256:
        sha256(sql),
      staticChecks,
      failedStaticChecks,
    },

    schema: {
      canonicalTableAlreadyPresent,
      expectedPreApplyState:
        canonicalTableAlreadyPresent ===
        false,
    },

    model: {
      id:
        model.id,
      name:
        model.model_name,
      promotionStage:
        model.promotion_stage,
      shadowStartedAt:
        shadowStartedAt,
      legacyStatus:
        model.status,
    },

    signals: {
      totalModelLinked:
        allSignals,
      createdAtOrAfterShadowPromotion:
        postShadowSignals,
      historicalSignalsWillBeBackfilled:
        false,
    },

    pending: {
      targetPending,
      laterPendingMigrations,
    },

    counts: {
      promotionEvents,
      paperOrders:
        orders,
      paperPositions:
        positions,
    },

    controls,

    checks,
    failed,

    safety: {
      databaseWrites:
        0,
      historicalBackfill:
        false,
      promotionStageChanged:
        false,
      ordersCreated:
        0,
      positionsChanged:
        0,
      controlsChanged:
        false,
      realTradingChanged:
        false,
    },

    nextGate:
      failed.length === 0
        ? "APPLY_20261009000500_AND_VERIFY_EMPTY_CANONICAL_TABLE"
        : "STOP_AND_DIAGNOSE_BEFORE_SHADOW_STORAGE_DB_APPLY",

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
        rawDryRun:
          dryRun.output,
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
    process.exitCode = 1;
  }
}

main().catch(
  (error) => {
    const result = {
      status:
        "MODEL_SHADOW_OUTCOME_CANONICAL_STORAGE_V1_DB_PREFLIGHT_FAILED",
      error:
        error instanceof Error
          ? error.message
          : String(error),
      safety: {
        databaseWrites:
          0,
        historicalBackfill:
          false,
        promotionStageChanged:
          false,
        ordersCreated:
          0,
        positionsChanged:
          0,
        controlsChanged:
          false,
        realTradingChanged:
          false,
      },
      nextGate:
        "STOP_AND_DIAGNOSE_BEFORE_SHADOW_STORAGE_DB_APPLY",
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
