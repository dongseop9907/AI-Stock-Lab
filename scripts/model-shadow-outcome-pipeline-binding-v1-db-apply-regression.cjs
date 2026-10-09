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
  "logs/model-shadow-outcome-pipeline-binding-v1-db-apply-regression.json";

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
        key.endsWith(`/${name}`),
    );
}

async function waitForRpc(
  url,
  key,
  name,
) {
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
        `rpc/${name}`,
      ) ||
      hasPath(
        openApi,
        name,
      );

    last = {
      attempt,
      present,
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

function sameControls(a, b) {
  return (
    a.emergency_stop === b.emergency_stop &&
    a.automation_enabled === b.automation_enabled &&
    a.paper_order_enabled === b.paper_order_enabled &&
    a.real_order_enabled === b.real_order_enabled
  );
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
      "SERVICE_ROLE_ENV_REQUIRED_FOR_00600_APPLY",
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
    beforeCanonical,
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

  if (
    beforeCanonical !==
      0
  ) {
    throw new Error(
      `CANONICAL_TABLE_MUST_BE_EMPTY_BEFORE_TRIGGER_APPLY:${beforeCanonical}`,
    );
  }

  if (
    beforePostShadowSignals !==
      0
  ) {
    throw new Error(
      `POST_SHADOW_SIGNALS_EXPECTED_ZERO_BEFORE_TRIGGER_APPLY:${beforePostShadowSignals}`,
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
      "TARGET_00600_NOT_PENDING",
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
      "TARGET_00600_STILL_PENDING_AFTER_APPLY",
    );
  }

  /*
   * Trigger functions are not always exposed as RPCs through PostgREST because
   * they return trigger. Therefore we verify the migration applied and behavior
   * remained quiescent. No synthetic signal is created in this step.
   */

  const [
    afterModel,
    afterControls,
    afterCanonical,
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

    canonicalStillEmpty:
      afterCanonical ===
        0,

    historicalSignalsUnchanged:
      afterSignals ===
        beforeSignals,

    noPostShadowSignalCreatedByMigration:
      afterPostShadowSignals ===
        beforePostShadowSignals &&
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
        ? "MODEL_SHADOW_OUTCOME_PIPELINE_BINDING_V1_DB_APPLY_AND_QUIESCENT_REGRESSION_VERIFIED"
        : "MODEL_SHADOW_OUTCOME_PIPELINE_BINDING_V1_DB_APPLY_AND_QUIESCENT_REGRESSION_FAILED",

    migration: {
      version:
        migrationVersion,
      file:
        migrationRel,
      sha256:
        sha256(sql),
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

    counts: {
      canonicalRows:
        `${beforeCanonical}->${afterCanonical}`,
      totalSignals:
        `${beforeSignals}->${afterSignals}`,
      postShadowSignals:
        `${beforePostShadowSignals}->${afterPostShadowSignals}`,
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
      syntheticSignalCreated:
        false,
      historicalBackfill:
        false,
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
        "trigger/function schema installation only"
      ],
    },

    nextGate:
      failed.length === 0
        ? "RUN_ISOLATED_POST_SHADOW_SIGNAL_TRIGGER_POSITIVE_PATH_WITH_CLEANUP"
        : "STOP_AND_DIAGNOSE_00600_APPLY",

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
    process.exitCode = 1;
  }
}

main().catch(
  (error) => {
    const result = {
      status:
        "MODEL_SHADOW_OUTCOME_PIPELINE_BINDING_V1_DB_APPLY_AND_QUIESCENT_REGRESSION_FAILED",
      error:
        error instanceof Error
          ? error.message
          : String(error),
      safety: {
        syntheticSignalCreated:
          false,
        realTradingEnabledByScript:
          false,
      },
      nextGate:
        "STOP_AND_DIAGNOSE_00600_APPLY",
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
