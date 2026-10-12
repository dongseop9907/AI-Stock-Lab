const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = process.cwd();

const migrationRel =
  "supabase/migrations/20261009000300_model_promotion_state_machine_v1.sql";

const detailsRel =
  "logs/model-promotion-state-machine-v1-db-preflight.json";

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

async function fetchJson(url, key, pathname, options = {}) {
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
        Accept: "application/openapi+json, application/json",
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

async function readModels(url, key) {
  const result = await fetchJson(
    url,
    key,
    "/rest/v1/ai_model_versions?select=id,model_name,model_version,purpose,status&order=created_at.asc",
  );

  if (!result.ok || !Array.isArray(result.body)) {
    throw new Error(
      `MODEL_READ_FAILED:${result.status}:${JSON.stringify(result.body).slice(0, 500)}`,
    );
  }

  return result.body;
}

async function readControls(url, key) {
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

function validateMigration(sql) {
  const checks = {
    addsPromotionStage:
      /add\s+column\s+if\s+not\s+exists\s+promotion_stage/i.test(sql),

    preservesLegacyStatus:
      !/set\s+status\s*=/i.test(sql),

    candidateMapsCandidate:
      /status\s*=\s*'CANDIDATE'[\s\S]*?'CANDIDATE'/i.test(sql),

    approvedMapsPaper:
      /status\s*=\s*'APPROVED'[\s\S]*?'PAPER'/i.test(sql),

    rejectedRetiredDisabled:
      /status\s+in\s*\(\s*'REJECTED'\s*,\s*'RETIRED'\s*\)[\s\S]*?'DISABLED'/i.test(sql),

    hasEventAudit:
      /create\s+table\s+if\s+not\s+exists\s+public\.model_promotion_events/i.test(sql),

    hasValidator:
      /validate_model_promotion_transition_v1/i.test(sql),

    hasTransitionTrigger:
      /trg_ai_model_versions_promotion_stage_guard_v1/i.test(sql),

    noOrderMutation:
      !/\b(insert\s+into|update|delete\s+from)\s+public\.(paper_order_requests|paper_positions|trade_orders)\b/i.test(sql),

    noRealTradingEnable:
      !/real_order_enabled\s*=\s*true/i.test(sql),
  };

  const failed = Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);

  return {
    ok: failed.length === 0,
    checks,
    failed,
  };
}

async function main() {
  fs.mkdirSync(path.resolve(root, "logs"), { recursive: true });

  const migrationAbs = path.resolve(root, migrationRel);

  if (!fs.existsSync(migrationAbs)) {
    throw new Error(`MIGRATION_MISSING:${migrationRel}`);
  }

  const sql = fs.readFileSync(migrationAbs, "utf8");
  const migrationStatic = validateMigration(sql);

  if (!migrationStatic.ok) {
    throw new Error(
      `MIGRATION_STATIC_FAILED:${migrationStatic.failed.join(",")}`,
    );
  }

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

  const openApi = await fetchOpenApi(url, key);

  const modelTablePresent = hasPath(openApi, "ai_model_versions");
  const modelColumns = schemaColumns(openApi, "ai_model_versions");

  if (!modelTablePresent) {
    throw new Error("AI_MODEL_VERSIONS_TABLE_MISSING");
  }

  const requiredCurrentColumns = [
    "id",
    "model_name",
    "model_version",
    "purpose",
    "status",
  ];

  const missingCurrentColumns =
    requiredCurrentColumns.filter(
      (column) => !modelColumns.includes(column),
    );

  if (missingCurrentColumns.length > 0) {
    throw new Error(
      `AI_MODEL_VERSIONS_COLUMNS_MISSING:${missingCurrentColumns.join(",")}`,
    );
  }

  const beforePromotionStage =
    modelColumns.includes("promotion_stage");

  const beforePromotionEvents =
    hasPath(openApi, "model_promotion_events");

  const beforeValidator =
    hasPath(openApi, "rpc/validate_model_promotion_transition_v1") ||
    hasPath(openApi, "validate_model_promotion_transition_v1");

  const models = await readModels(url, key);
  const controls = await readControls(url, key);

  const projectedModels = models.map((model) => ({
    id: model.id,
    name: model.model_name,
    version: model.model_version,
    purpose: model.purpose,
    legacyStatus: model.status,
    expectedPromotionStage: expectedStage(model.status),
  }));

  const expectedCounts = projectedModels.reduce(
    (acc, row) => {
      acc[row.expectedPromotionStage] =
        (acc[row.expectedPromotionStage] ?? 0) + 1;
      return acc;
    },
    {},
  );

  const expectedPreApplyState =
    beforePromotionStage === false &&
    beforePromotionEvents === false &&
    beforeValidator === false;

  const ready =
    migrationStatic.ok &&
    expectedPreApplyState &&
    controls.real_order_enabled === false;

  const result = {
    status: ready
      ? "MODEL_PROMOTION_STATE_MACHINE_V1_DB_PREFLIGHT_READY"
      : "MODEL_PROMOTION_STATE_MACHINE_V1_DB_PREFLIGHT_BLOCKED",

    migration: {
      file: migrationRel,
      version: "20261009000300",
      sha256: sha256(sql),
      staticOk: migrationStatic.ok,
      failedStaticChecks: migrationStatic.failed,
    },

    schema: {
      aiModelVersionsPresent: modelTablePresent,
      existingColumns: modelColumns,
      promotionStageAlreadyPresent: beforePromotionStage,
      promotionEventsAlreadyPresent: beforePromotionEvents,
      validatorAlreadyPresent: beforeValidator,
      expectedPreApplyState,
    },

    models: {
      count: projectedModels.length,
      projected: projectedModels,
      expectedStageCounts: expectedCounts,
    },

    controls,

    safety: {
      databaseWrites: 0,
      modelStatusesChanged: 0,
      promotionStagesChanged: 0,
      ordersCreated: 0,
      positionsChanged: 0,
      controlsChanged: false,
      realTradingStillOff:
        controls.real_order_enabled === false,
    },

    nextGate: ready
      ? "APPLY_20261009000300_AND_VERIFY_LEGACY_COMPAT_INITIALIZATION"
      : "STOP_AND_DIAGNOSE_BEFORE_APPLY",

    details: detailsRel,
  };

  fs.writeFileSync(
    path.resolve(root, detailsRel),
    JSON.stringify(
      {
        ...result,
        migrationStaticChecks: migrationStatic.checks,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        status: result.status,
        migration: result.migration,
        schema: {
          promotionStageAlreadyPresent:
            result.schema.promotionStageAlreadyPresent,
          promotionEventsAlreadyPresent:
            result.schema.promotionEventsAlreadyPresent,
          validatorAlreadyPresent:
            result.schema.validatorAlreadyPresent,
          expectedPreApplyState:
            result.schema.expectedPreApplyState,
        },
        models: result.models,
        controls: result.controls,
        safety: result.safety,
        nextGate: result.nextGate,
        details: result.details,
      },
      null,
      2,
    ),
  );

  if (!ready) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status:
          "MODEL_PROMOTION_STATE_MACHINE_V1_DB_PREFLIGHT_FAILED",
        error:
          error instanceof Error ? error.message : String(error),
        safety: {
          databaseWrites: 0,
          modelStatusesChanged: 0,
          promotionStagesChanged: 0,
          ordersCreated: 0,
          positionsChanged: 0,
          controlsChanged: false,
          realTradingChanged: false,
        },
        nextGate: "STOP_AND_DIAGNOSE_BEFORE_APPLY",
      },
      null,
      2,
    ),
  );

  process.exitCode = 1;
});
