const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const root = process.cwd();

const migrationVersion =
  "20261009000300";

const migrationRel =
  "supabase/migrations/20261009000300_model_promotion_state_machine_v1.sql";

const detailsRel =
  "logs/model-promotion-state-machine-v1-db-apply-regression.json";

function requiredEnv(names) {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  throw new Error(`ENV_REQUIRED:${names.join("|")}`);
}

function normalizeUrl(value) {
  return String(value).replace(/\/+$/, "");
}

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
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
  const npx = npxCmd();

  const argText = [
    "supabase",
    ...args,
  ]
    .map((x) => `'${psQuote(x)}'`)
    .join(" ");

  const command =
    `& '${psQuote(npx)}' ${argText} 2>&1 | Out-String; ` +
    `$code=$LASTEXITCODE; ` +
    `Write-Output "__SUPABASE_EXIT_CODE__=$code"; ` +
    `exit $code`;

  const result = spawnSync(
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
      maxBuffer: 20 * 1024 * 1024,
    },
  );

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const combined = `${stdout}\n${stderr}`.trim();

  const codeMatch =
    /__SUPABASE_EXIT_CODE__=(-?\d+)/.exec(combined);

  const code = codeMatch
    ? Number(codeMatch[1])
    : (
        typeof result.status === "number"
          ? result.status
          : 1
      );

  const output = combined
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

function extractMigrationVersions(text) {
  return [
    ...new Set(
      String(text).match(/\b20\d{12}\b/g) ?? [],
    ),
  ];
}

async function fetchJson(
  url,
  key,
  pathname,
  options = {},
) {
  const response = await fetch(
    `${url}${pathname}`,
    {
      ...options,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        ...(options.headers ?? {}),
      },
    },
  );

  const text = await response.text();

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
    headers: Object.fromEntries(response.headers),
  };
}

async function fetchOpenApi(url, key) {
  const response = await fetch(
    `${url}/rest/v1/`,
    {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept:
          "application/openapi+json, application/json",
      },
    },
  );

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `OPENAPI_READ_FAILED:${response.status}:${text.slice(0, 500)}`,
    );
  }

  return JSON.parse(text);
}

function hasPath(openApi, name) {
  const paths = openApi?.paths ?? {};

  return Object.keys(paths).some(
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

  const direct = schemas[name];

  if (direct?.properties) {
    return Object.keys(direct.properties);
  }

  for (const [schemaName, schema] of Object.entries(schemas)) {
    if (
      schemaName.toLowerCase().endsWith(name.toLowerCase()) &&
      schema?.properties
    ) {
      return Object.keys(schema.properties);
    }
  }

  return [];
}

async function countRows(url, key, table) {
  const response = await fetch(
    `${url}/rest/v1/${table}?select=*&limit=1`,
    {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        Prefer: "count=exact",
        Range: "0-0",
      },
    },
  );

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `COUNT_FAILED:${table}:${response.status}:${text.slice(0, 500)}`,
    );
  }

  const range =
    response.headers.get("content-range") ?? "";

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

async function readModels(url, key) {
  const result = await fetchJson(
    url,
    key,
    "/rest/v1/ai_model_versions?select=id,model_name,model_version,purpose,status,promotion_stage,promotion_stage_updated_at,promotion_stage_reason&order=created_at.asc",
  );

  if (!result.ok || !Array.isArray(result.body)) {
    throw new Error(
      `MODEL_READ_FAILED:${result.status}:${JSON.stringify(result.body).slice(0, 500)}`,
    );
  }

  return result.body;
}

async function readModelsLegacy(url, key) {
  const result = await fetchJson(
    url,
    key,
    "/rest/v1/ai_model_versions?select=id,model_name,model_version,purpose,status&order=created_at.asc",
  );

  if (!result.ok || !Array.isArray(result.body)) {
    throw new Error(
      `MODEL_LEGACY_READ_FAILED:${result.status}:${JSON.stringify(result.body).slice(0, 500)}`,
    );
  }

  return result.body;
}

async function readControl(url, key) {
  const result = await fetchJson(
    url,
    key,
    "/rest/v1/trading_system_controls?control_key=eq.global&select=emergency_stop,automation_enabled,paper_order_enabled,real_order_enabled&limit=1",
  );

  if (!result.ok || !Array.isArray(result.body) || !result.body[0]) {
    throw new Error(
      `CONTROL_READ_FAILED:${result.status}:${JSON.stringify(result.body).slice(0, 500)}`,
    );
  }

  return result.body[0];
}

function sameControl(a, b) {
  return (
    a.emergency_stop === b.emergency_stop &&
    a.automation_enabled === b.automation_enabled &&
    a.paper_order_enabled === b.paper_order_enabled &&
    a.real_order_enabled === b.real_order_enabled
  );
}

function expectedStage(status) {
  switch (status) {
    case "CANDIDATE":
      return "CANDIDATE";

    case "APPROVED":
      return "PAPER";

    case "REJECTED":
    case "RETIRED":
      return "DISABLED";

    default:
      return "EXPERIMENTAL";
  }
}

async function waitForSchema(url, key) {
  let last = null;

  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const openApi = await fetchOpenApi(url, key);

    const columns =
      schemaColumns(openApi, "ai_model_versions");

    const promotionStagePresent =
      columns.includes("promotion_stage");

    const eventTablePresent =
      hasPath(openApi, "model_promotion_events");

    const validatorPresent =
      hasPath(
        openApi,
        "rpc/validate_model_promotion_transition_v1",
      ) ||
      hasPath(
        openApi,
        "validate_model_promotion_transition_v1",
      );

    last = {
      attempt,
      openApi,
      columns,
      promotionStagePresent,
      eventTablePresent,
      validatorPresent,
    };

    if (
      promotionStagePresent &&
      eventTablePresent &&
      validatorPresent
    ) {
      return last;
    }

    await new Promise(
      (resolve) => setTimeout(resolve, 750),
    );
  }

  return last;
}

async function main() {
  fs.mkdirSync(
    path.resolve(root, "logs"),
    { recursive: true },
  );

  const migrationAbs =
    path.resolve(root, migrationRel);

  if (!fs.existsSync(migrationAbs)) {
    throw new Error(
      `MIGRATION_MISSING:${migrationRel}`,
    );
  }

  const sql =
    fs.readFileSync(migrationAbs, "utf8");

  const url = normalizeUrl(
    requiredEnv([
      "NEXT_PUBLIC_SUPABASE_URL",
      "SUPABASE_URL",
    ]),
  );

  const key = requiredEnv([
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SERVICE_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_ANON_KEY",
  ]);

  const beforeControl =
    await readControl(url, key);

  if (beforeControl.real_order_enabled !== false) {
    throw new Error(
      "REAL_TRADING_MUST_BE_OFF_BEFORE_APPLY",
    );
  }

  const beforeModels =
    await readModelsLegacy(url, key);

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
    await fetchOpenApi(url, key);

  const beforeColumns =
    schemaColumns(
      beforeOpenApi,
      "ai_model_versions",
    );

  if (
    beforeColumns.includes("promotion_stage") ||
    hasPath(beforeOpenApi, "model_promotion_events")
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

  if (dryRun.code !== 0) {
    throw new Error(
      `SUPABASE_DRY_RUN_FAILED:${dryRun.output.slice(0, 1600)}`,
    );
  }

  const dryRunVersions =
    extractMigrationVersions(dryRun.output);

  const targetPending =
    dryRun.output.includes(migrationVersion);

  const unexpectedPending =
    dryRunVersions.filter(
      (version) =>
        version >= migrationVersion &&
        version !== migrationVersion,
    );

  if (!targetPending) {
    throw new Error(
      "TARGET_MIGRATION_NOT_PENDING_IN_DRY_RUN",
    );
  }

  if (unexpectedPending.length > 0) {
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
      `POST_APPLY_DRY_RUN_FAILED:${postDryRun.output.slice(0, 1600)}`,
    );
  }

  const targetStillPending =
    postDryRun.output.includes(migrationVersion);

  if (targetStillPending) {
    throw new Error(
      "TARGET_MIGRATION_STILL_PENDING_AFTER_APPLY",
    );
  }

  const schemaWait =
    await waitForSchema(url, key);

  const afterModels =
    await readModels(url, key);

  const afterControl =
    await readControl(url, key);

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

  const eventRows =
    schemaWait?.eventTablePresent
      ? await countRows(
          url,
          key,
          "model_promotion_events",
        )
      : null;

  const beforeById =
    new Map(
      beforeModels.map(
        (model) => [
          model.id,
          model,
        ],
      ),
    );

  const modelChecks =
    afterModels.map(
      (model) => {
        const before =
          beforeById.get(model.id);

        return {
          id: model.id,
          name: model.model_name,
          legacyStatusBefore:
            before?.status ?? null,
          legacyStatusAfter:
            model.status,
          legacyStatusPreserved:
            before?.status === model.status,
          expectedPromotionStage:
            expectedStage(model.status),
          actualPromotionStage:
            model.promotion_stage,
          promotionStageCorrect:
            model.promotion_stage ===
            expectedStage(model.status),
          initializationReason:
            model.promotion_stage_reason,
          hasPromotionTimestamp:
            Boolean(
              model.promotion_stage_updated_at,
            ),
        };
      },
    );

  const checks = {
    migrationApplied:
      targetStillPending === false,

    promotionStageColumnExposed:
      schemaWait?.promotionStagePresent === true,

    promotionEventTableExposed:
      schemaWait?.eventTablePresent === true,

    validatorRpcExposed:
      schemaWait?.validatorPresent === true,

    eventTableStartsEmpty:
      eventRows === 0,

    allLegacyStatusesPreserved:
      modelChecks.every(
        (model) =>
          model.legacyStatusPreserved,
      ),

    allPromotionStagesCorrect:
      modelChecks.every(
        (model) =>
          model.promotionStageCorrect,
      ),

    allPromotionStagesTimestamped:
      modelChecks.every(
        (model) =>
          model.hasPromotionTimestamp,
      ),

    noOrdersCreated:
      beforeOrders === afterOrders,

    noPositionsCreated:
      beforePositions === afterPositions,

    controlsUnchanged:
      sameControl(
        beforeControl,
        afterControl,
      ),

    realTradingStillOff:
      afterControl.real_order_enabled === false,
  };

  const failed =
    Object.entries(checks)
      .filter(([, ok]) => !ok)
      .map(([name]) => name);

  const result = {
    status:
      failed.length === 0
        ? "MODEL_PROMOTION_STATE_MACHINE_V1_DB_APPLY_AND_REGRESSION_VERIFIED"
        : "MODEL_PROMOTION_STATE_MACHINE_V1_DB_APPLY_AND_REGRESSION_FAILED",

    migration: {
      version: migrationVersion,
      file: migrationRel,
      sha256: sha256(sql),
    },

    checks,
    failed,

    models: modelChecks,

    counts: {
      orders:
        `${beforeOrders}->${afterOrders}`,
      positions:
        `${beforePositions}->${afterPositions}`,
      promotionEvents:
        eventRows,
    },

    controls: {
      before: beforeControl,
      after: afterControl,
    },

    schema: {
      refreshAttempts:
        schemaWait?.attempt ?? null,
      promotionStageColumnExposed:
        schemaWait?.promotionStagePresent ?? false,
      promotionEventTableExposed:
        schemaWait?.eventTablePresent ?? false,
      validatorRpcExposed:
        schemaWait?.validatorPresent ?? false,
    },

    safety: {
      ordersCreated:
        afterOrders - beforeOrders,
      positionsCreated:
        afterPositions - beforePositions,
      controlsChanged:
        !sameControl(
          beforeControl,
          afterControl,
        ),
      realTradingEnabledByScript:
        false,
      legacyStatusRowsChanged:
        modelChecks.filter(
          (model) =>
            !model.legacyStatusPreserved,
        ).length,
    },

    nextGate:
      failed.length === 0
        ? "BUILD_PROMOTION_DECISION_SERVICE_AND_STAGE_GATES"
        : "STOP_AND_DIAGNOSE_BEFORE_PROMOTION_WRITER_BINDING",

    details: detailsRel,
  };

  fs.writeFileSync(
    path.resolve(root, detailsRel),
    JSON.stringify(
      {
        ...result,
        raw: {
          dryRun: dryRun.output,
          apply: apply.output,
          postDryRun: postDryRun.output,
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

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const result = {
    status:
      "MODEL_PROMOTION_STATE_MACHINE_V1_DB_APPLY_AND_REGRESSION_FAILED",
    error:
      error instanceof Error
        ? error.message
        : String(error),
    safety: {
      realTradingEnabledByScript: false,
    },
    nextGate:
      "STOP_AND_DIAGNOSE_BEFORE_PROMOTION_WRITER_BINDING",
    details: detailsRel,
  };

  try {
    fs.mkdirSync(
      path.resolve(root, "logs"),
      { recursive: true },
    );

    fs.writeFileSync(
      path.resolve(root, detailsRel),
      JSON.stringify(result, null, 2) + "\n",
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
});
