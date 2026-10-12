const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const root = process.cwd();

const migrationVersion =
  "20261009000600";

const migrationRel =
  "supabase/migrations/20261009000600_model_shadow_outcome_pipeline_binding_v1.sql";

const detailsRel =
  "logs/model-shadow-outcome-pipeline-binding-v1-db-preflight.json";

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
      `/rest/v1/ai_model_versions?id=eq.${encodeURIComponent(modelId)}&select=id,model_name,status,promotion_stage,promotion_stage_updated_at,promotion_stage_reason&limit=1`,
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

function laterLocalMigrationFiles() {
  const dir =
    path.resolve(
      root,
      "supabase/migrations",
    );

  if (!fs.existsSync(dir)) {
    return [];
  }

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

  const routeRel =
    "app/api/signals/shadow/evaluate/route.ts";

  const helperRel =
    "lib/models/model-shadow-outcome-pipeline-binding.ts";

  const route =
    fs.readFileSync(
      path.resolve(
        root,
        routeRel,
      ),
      "utf8",
    );

  const helper =
    fs.readFileSync(
      path.resolve(
        root,
        helperRel,
      ),
      "utf8",
    );

  const staticChecks = {
    captureFunction:
      /create\s+or\s+replace\s+function\s+public\.capture_model_shadow_signal_outcome_v1/i.test(
        sql,
      ),

    afterInsertTrigger:
      /after\s+insert\s+on\s+public\.ai_entry_signals/i.test(
        sql,
      ),

    shadowOnly:
      sql.includes(
        "v_stage is distinct from 'SHADOW'",
      ),

    postPromotionGuard:
      sql.includes(
        "new.created_at < v_stage_updated_at",
      ),

    noHistoricalBackfill:
      !/insert\s+into\s+public\.model_shadow_signal_outcomes[\s\S]{0,1600}select[\s\S]{0,1600}from\s+public\.ai_entry_signals/i.test(
        sql,
      ),

    routeBindingPresent:
      route.includes(
        "MODEL_SHADOW_OUTCOME_PIPELINE_BINDING_V1_ROUTE_BIND",
      ) &&
      route.includes(
        "syncCanonicalShadowOutcomeFromEntrySignalsV1",
      ),

    sidecarNoRecalculation:
      helper.includes(
        "noOutcomeRecalculation:",
      ) &&
      !helper.includes(
        '"market_snapshots"',
      ),

    noOrderMutation:
      !/(update|insert\s+into|delete\s+from)\s+public\.paper_order_requests/i.test(
        sql,
      ) &&
      !/\.from\(\s*["']paper_order_requests["']\s*\)[\s\S]{0,500}?\.(insert|update|delete)\s*\(/.test(
        helper,
      ),

    noPositionMutation:
      !/(update|insert\s+into|delete\s+from)\s+public\.paper_positions/i.test(
        sql,
      ) &&
      !/\.from\(\s*["']paper_positions["']\s*\)[\s\S]{0,500}?\.(insert|update|delete)\s*\(/.test(
        helper,
      ),

    noPromotionMutation:
      !/(update|insert\s+into|delete\s+from)\s+public\.ai_model_versions/i.test(
        sql,
      ) &&
      !/\.from\(\s*["']ai_model_versions["']\s*\)[\s\S]{0,600}?\.update\s*\(/.test(
        helper,
      ),

    noRealTradingEnable:
      !/real_order_enabled\s*=\s*true/i.test(
        sql +
        "\n" +
        helper +
        "\n" +
        route,
      ),
  };

  const failedStatic =
    Object.entries(
      staticChecks,
    )
      .filter(
        ([, ok]) => !ok,
      )
      .map(
        ([name]) => name,
      );

  if (failedStatic.length > 0) {
    throw new Error(
      `STATIC_PREFLIGHT_FAILED:${failedStatic.join(",")}`,
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
    model.promotion_stage !==
      "SHADOW"
  ) {
    throw new Error(
      `MODEL_MUST_REMAIN_SHADOW:${model.promotion_stage}`,
    );
  }

  if (
    controls.real_order_enabled !==
      false
  ) {
    throw new Error(
      "REAL_TRADING_MUST_BE_OFF",
    );
  }

  const [
    canonicalRows,
    totalSignals,
    postShadowSignals,
    orders,
    positions,
    promotionEvents,
  ] =
    await Promise.all([
      countRows(
        url,
        key,
        "model_shadow_signal_outcomes",
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
        `model_id=eq.${encodeURIComponent(modelId)}&created_at=gte.${encodeURIComponent(model.promotion_stage_updated_at)}`,
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

  const laterPending =
    laterLocalMigrationFiles()
      .filter(
        (name) =>
          dryRun.output.includes(
            name.slice(0, 14),
          ),
      );

  const checks = {
    staticChecksPassed:
      failedStatic.length ===
      0,

    targetMigrationPending:
      targetPending ===
      true,

    noLaterPendingMigration:
      laterPending.length ===
      0,

    modelStillShadow:
      model.promotion_stage ===
      "SHADOW",

    canonicalTableStillEmpty:
      canonicalRows ===
      0,

    noPostShadowSignalsYet:
      postShadowSignals ===
      0,

    historicalSignalsRemain173OrMore:
      (totalSignals ?? 0) >=
      173,

    noPaperOrders:
      orders ===
      0,

    noOpenPaperPositions:
      positions ===
      0,

    promotionAuditPresent:
      (promotionEvents ?? 0) >=
      3,

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
        ? "MODEL_SHADOW_OUTCOME_PIPELINE_BINDING_V1_DB_PREFLIGHT_READY"
        : "MODEL_SHADOW_OUTCOME_PIPELINE_BINDING_V1_DB_PREFLIGHT_FAILED",

    migration: {
      version:
        migrationVersion,
      file:
        migrationRel,
      sha256:
        sha256(sql),
    },

    staticChecks,
    model: {
      id:
        model.id,
      stage:
        model.promotion_stage,
      shadowStartedAt:
        model.promotion_stage_updated_at,
      legacyStatus:
        model.status,
    },

    counts: {
      canonicalRows,
      totalSignals,
      postShadowSignals,
      promotionEvents,
      paperOrders:
        orders,
      paperPositions:
        positions,
    },

    pending: {
      targetPending,
      laterPending,
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
        ? "APPLY_20261009000600_AND_VERIFY_TRIGGER_INSTALL_WITHOUT_NEW_SIGNAL"
        : "STOP_AND_DIAGNOSE_BEFORE_00600_APPLY",

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
        "MODEL_SHADOW_OUTCOME_PIPELINE_BINDING_V1_DB_PREFLIGHT_FAILED",
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
        "STOP_AND_DIAGNOSE_BEFORE_00600_APPLY",
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
