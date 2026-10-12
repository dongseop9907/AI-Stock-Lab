const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const root = process.cwd();

const migrationVersion =
  "20261009000400";

const migrationRel =
  "supabase/migrations/20261009000400_model_promotion_controlled_apply_v1.sql";

const detailsRel =
  "logs/model-promotion-controlled-apply-rpc-v1-db-preflight.json";

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
  const response =
    await fetch(
      `${url}${pathname}`,
      {
        ...options,
        headers: {
          apikey: key,
          Authorization:
            `Bearer ${key}`,
          Accept:
            "application/json",
          ...(options.headers ?? {}),
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
    headers:
      Object.fromEntries(
        response.headers,
      ),
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
  const result =
    await fetchJson(
      url,
      key,
      "/rest/v1/ai_model_versions?select=id,model_name,model_version,status,promotion_stage,promotion_stage_updated_at,promotion_stage_reason&order=created_at.asc",
    );

  if (
    !result.ok ||
    !Array.isArray(result.body)
  ) {
    throw new Error(
      `MODEL_READ_FAILED:${result.status}:${JSON.stringify(result.body).slice(0, 500)}`,
    );
  }

  return result.body;
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

  const staticChecks = {
    controlledRpc:
      /create\s+or\s+replace\s+function\s+public\.apply_model_promotion_transition_v1/i.test(
        sql,
      ),

    directUpdateGuard:
      sql.includes(
        "MODEL_PROMOTION_DIRECT_STAGE_UPDATE_BLOCKED",
      ),

    manualApprovalGuard:
      sql.includes(
        "MODEL_PROMOTION_MANUAL_APPROVAL_REQUIRED",
      ),

    rowLock:
      /for\s+update/i.test(sql),

    serviceRoleOnly:
      /grant\s+execute[\s\S]*to\s+service_role/i.test(
        sql,
      ) &&
      /revoke\s+all[\s\S]*from\s+authenticated/i.test(
        sql,
      ),

    auditWrites:
      /insert\s+into\s+public\.model_promotion_events/i.test(
        sql,
      ),

    noTradingControlMutation:
      !/(update|insert\s+into|delete\s+from)\s+public\.trading_system_controls/i.test(
        sql,
      ),

    noPaperOrderMutation:
      !/(update|insert\s+into|delete\s+from)\s+public\.paper_order_requests/i.test(
        sql,
      ),

    noPositionMutation:
      !/(update|insert\s+into|delete\s+from)\s+public\.paper_positions/i.test(
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
    normalizeUrl(urlRaw);

  const openApi =
    await fetchOpenApi(
      url,
      key,
    );

  const controlledRpcAlreadyPresent =
    hasPath(
      openApi,
      "rpc/apply_model_promotion_transition_v1",
    ) ||
    hasPath(
      openApi,
      "apply_model_promotion_transition_v1",
    );

  const validatorStillPresent =
    hasPath(
      openApi,
      "rpc/validate_model_promotion_transition_v1",
    ) ||
    hasPath(
      openApi,
      "validate_model_promotion_transition_v1",
    );

  const [
    models,
    controls,
    orders,
    positions,
    events,
  ] =
    await Promise.all([
      readModels(
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

  if (
    controls.real_order_enabled !==
      false
  ) {
    throw new Error(
      "REAL_TRADING_MUST_BE_OFF_BEFORE_PROMOTION_RPC_APPLY",
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
      `SUPABASE_DRY_RUN_FAILED:${dryRun.output.slice(0, 1800)}`,
    );
  }

  const pendingVersions =
    extractMigrationVersions(
      dryRun.output,
    );

  const targetPending =
    dryRun.output.includes(
      migrationVersion,
    );

  const unexpectedPending =
    pendingVersions.filter(
      (version) =>
        version >=
          migrationVersion &&
        version !==
          migrationVersion,
    );

  const candidate =
    models.find(
      (model) =>
        model.id ===
        "3045646b-599b-41cd-9650-43e539fb7a95",
    );

  const checks = {
    migrationStaticOk:
      failedStaticChecks.length ===
      0,

    controlledRpcNotYetPresent:
      controlledRpcAlreadyPresent ===
      false,

    legacyValidatorStillPresent:
      validatorStillPresent ===
      true,

    targetMigrationPending:
      targetPending ===
      true,

    noUnexpectedLaterPendingMigration:
      unexpectedPending.length ===
      0,

    candidateStillCandidate:
      candidate?.promotion_stage ===
      "CANDIDATE",

    recommendationEventExists:
      events >= 1,

    noPaperOrders:
      orders === 0,

    noOpenPaperPositions:
      positions === 0,

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
        ? "MODEL_PROMOTION_CONTROLLED_APPLY_RPC_V1_DB_PREFLIGHT_READY"
        : "MODEL_PROMOTION_CONTROLLED_APPLY_RPC_V1_DB_PREFLIGHT_FAILED",

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
      controlledRpcAlreadyPresent,
      validatorStillPresent,
      expectedPreApplyState:
        controlledRpcAlreadyPresent ===
          false &&
        validatorStillPresent ===
          true,
    },

    pending: {
      targetPending,
      pendingVersions,
      unexpectedPending,
    },

    modelState:
      models.map(
        (model) => ({
          id:
            model.id,
          name:
            model.model_name,
          legacyStatus:
            model.status,
          promotionStage:
            model.promotion_stage,
        }),
      ),

    counts: {
      promotionEvents:
        events,
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
        ? "APPLY_20261009000400_AND_VERIFY_DIRECT_UPDATE_BLOCK_AND_RPC"
        : "STOP_AND_DIAGNOSE_BEFORE_DB_APPLY",

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
    process.exitCode =
      1;
  }
}

main().catch(
  (error) => {
    const result = {
      status:
        "MODEL_PROMOTION_CONTROLLED_APPLY_RPC_V1_DB_PREFLIGHT_FAILED",
      error:
        error instanceof Error
          ? error.message
          : String(error),
      safety: {
        databaseWrites:
          0,
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
        "STOP_AND_DIAGNOSE_BEFORE_DB_APPLY",
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

    process.exitCode =
      1;
  },
);
