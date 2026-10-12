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
  "logs/model-promotion-controlled-apply-rpc-v1-db-apply-regression.json";

const candidateId =
  "3045646b-599b-41cd-9650-43e539fb7a95";

const paperModelId =
  "4ad531c1-021e-4787-9e32-ec91600ba740";

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

async function waitForRpc(url, key) {
  let last = null;

  for (
    let attempt = 1;
    attempt <= 10;
    attempt += 1
  ) {
    const openApi =
      await fetchOpenApi(
        url,
        key,
      );

    const controlledRpcPresent =
      hasPath(
        openApi,
        "rpc/apply_model_promotion_transition_v1",
      ) ||
      hasPath(
        openApi,
        "apply_model_promotion_transition_v1",
      );

    last = {
      attempt,
      controlledRpcPresent,
    };

    if (controlledRpcPresent) {
      return last;
    }

    await new Promise(
      (resolve) =>
        setTimeout(
          resolve,
          800,
        ),
    );
  }

  return last;
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

async function readModel(
  url,
  key,
  modelId,
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
      `MODEL_READ_FAILED:${modelId}:${result.status}:${JSON.stringify(result.body).slice(0, 500)}`,
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

async function attemptDirectStageUpdate(
  url,
  key,
) {
  return await fetchJson(
    url,
    key,
    `/rest/v1/ai_model_versions?id=eq.${encodeURIComponent(candidateId)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type":
          "application/json",
        Prefer:
          "return=representation",
      },
      body:
        JSON.stringify({
          promotion_stage:
            "SHADOW",
          promotion_stage_reason:
            "DIRECT_UPDATE_SHOULD_BE_BLOCKED",
        }),
    },
  );
}

async function callManualApprovalBlockedRpc(
  url,
  key,
) {
  return await fetchJson(
    url,
    key,
    "/rest/v1/rpc/apply_model_promotion_transition_v1",
    {
      method: "POST",
      headers: {
        "Content-Type":
          "application/json",
      },
      body:
        JSON.stringify({
          p_model_id:
            paperModelId,
          p_to_stage:
            "LIMITED_LIVE",
          p_actor:
            "MODEL_PROMOTION_CONTROLLED_APPLY_RPC_V1_REGRESSION",
          p_reason:
            "VERIFY_MANUAL_APPROVAL_GUARD_ONLY",
          p_manual_approval_confirmed:
            false,
          p_evidence: {
            test:
              "MANUAL_APPROVAL_BLOCK_ONLY",
            mustNotChangeStage:
              true,
          },
        }),
    },
  );
}

async function readEvent(
  url,
  key,
  eventId,
) {
  const result =
    await fetchJson(
      url,
      key,
      `/rest/v1/model_promotion_events?id=eq.${encodeURIComponent(eventId)}&select=id,model_id,from_stage,to_stage,transition_kind,decision,requires_manual_approval,manual_approval_confirmed,actor,reason,created_at&limit=1`,
    );

  if (
    !result.ok ||
    !Array.isArray(result.body) ||
    !result.body[0]
  ) {
    throw new Error(
      `EVENT_READ_FAILED:${eventId}:${result.status}:${JSON.stringify(result.body).slice(0, 500)}`,
    );
  }

  return result.body[0];
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
      "SERVICE_ROLE_ENV_REQUIRED_FOR_CONTROLLED_APPLY_REGRESSION",
    );
  }

  const url =
    normalizeUrl(
      urlRaw,
    );

  const beforeControls =
    await readControls(
      url,
      key,
    );

  if (
    beforeControls.real_order_enabled !==
      false
  ) {
    throw new Error(
      "REAL_TRADING_MUST_BE_OFF_BEFORE_DB_APPLY",
    );
  }

  const [
    beforeCandidate,
    beforePaperModel,
    beforeEvents,
    beforeOrders,
    beforePositions,
  ] =
    await Promise.all([
      readModel(
        url,
        key,
        candidateId,
      ),
      readModel(
        url,
        key,
        paperModelId,
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
    beforeCandidate.promotion_stage !==
      "CANDIDATE"
  ) {
    throw new Error(
      `EXPECTED_CANDIDATE_BEFORE_APPLY:${beforeCandidate.promotion_stage}`,
    );
  }

  if (
    beforePaperModel.promotion_stage !==
      "PAPER"
  ) {
    throw new Error(
      `EXPECTED_PAPER_MODEL_BEFORE_APPLY:${beforePaperModel.promotion_stage}`,
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
      "TARGET_MIGRATION_NOT_PENDING_IN_DRY_RUN",
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

  const rpcWait =
    await waitForRpc(
      url,
      key,
    );

  if (
    rpcWait?.controlledRpcPresent !==
      true
  ) {
    throw new Error(
      "CONTROLLED_RPC_NOT_EXPOSED_AFTER_APPLY",
    );
  }

  /*
   * Safety test 1:
   * direct UPDATE must fail and must not change candidate stage.
   */
  const directUpdate =
    await attemptDirectStageUpdate(
      url,
      key,
    );

  const directUpdateBlocked =
    directUpdate.ok ===
      false &&
    JSON.stringify(
      directUpdate.body,
    ).includes(
      "MODEL_PROMOTION_DIRECT_STAGE_UPDATE_BLOCKED",
    );

  if (!directUpdateBlocked) {
    throw new Error(
      `DIRECT_UPDATE_WAS_NOT_BLOCKED:${directUpdate.status}:${JSON.stringify(directUpdate.body).slice(0, 700)}`,
    );
  }

  const afterDirectCandidate =
    await readModel(
      url,
      key,
      candidateId,
    );

  if (
    afterDirectCandidate.promotion_stage !==
      "CANDIDATE"
  ) {
    throw new Error(
      `DIRECT_UPDATE_CHANGED_CANDIDATE_STAGE:${afterDirectCandidate.promotion_stage}`,
    );
  }

  if (
    afterDirectCandidate.promotion_stage_updated_at !==
      beforeCandidate.promotion_stage_updated_at ||
    afterDirectCandidate.promotion_stage_reason !==
      beforeCandidate.promotion_stage_reason
  ) {
    throw new Error(
      "DIRECT_UPDATE_CHANGED_CANDIDATE_PROMOTION_METADATA",
    );
  }

  /*
   * Safety test 2:
   * PAPER -> LIMITED_LIVE without manual approval must return BLOCKED,
   * write one audit event, and keep stage PAPER.
   */
  const manualBlockRpc =
    await callManualApprovalBlockedRpc(
      url,
      key,
    );

  if (
    !manualBlockRpc.ok ||
    !Array.isArray(
      manualBlockRpc.body,
    ) ||
    !manualBlockRpc.body[0]
  ) {
    throw new Error(
      `MANUAL_BLOCK_RPC_FAILED:${manualBlockRpc.status}:${JSON.stringify(manualBlockRpc.body).slice(0, 700)}`,
    );
  }

  const rpcRow =
    manualBlockRpc.body[0];

  const manualBlockCorrect =
    rpcRow.decision ===
      "BLOCKED" &&
    rpcRow.manual_required ===
      true &&
    rpcRow.applied ===
      false &&
    rpcRow.from_stage ===
      "PAPER" &&
    rpcRow.to_stage ===
      "LIMITED_LIVE";

  if (!manualBlockCorrect) {
    throw new Error(
      `MANUAL_BLOCK_RPC_UNEXPECTED_RESULT:${JSON.stringify(rpcRow)}`,
    );
  }

  const blockedEvent =
    await readEvent(
      url,
      key,
      rpcRow.event_id,
    );

  const [
    afterCandidate,
    afterPaperModel,
    afterControls,
    afterEvents,
    afterOrders,
    afterPositions,
  ] =
    await Promise.all([
      readModel(
        url,
        key,
        candidateId,
      ),
      readModel(
        url,
        key,
        paperModelId,
      ),
      readControls(
        url,
        key,
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

    controlledRpcExposed:
      rpcWait.controlledRpcPresent ===
      true,

    directUpdateBlocked:
      directUpdateBlocked,

    candidateStageUnchanged:
      afterCandidate.promotion_stage ===
        "CANDIDATE",

    candidateLegacyStatusUnchanged:
      afterCandidate.status ===
        beforeCandidate.status,

    candidatePromotionMetadataUnchanged:
      afterCandidate.promotion_stage_updated_at ===
        beforeCandidate.promotion_stage_updated_at &&
      afterCandidate.promotion_stage_reason ===
        beforeCandidate.promotion_stage_reason,

    manualApprovalGuardReturnedBlocked:
      manualBlockCorrect,

    blockedEventExists:
      blockedEvent.id ===
        rpcRow.event_id,

    blockedEventCorrect:
      blockedEvent.decision ===
        "BLOCKED" &&
      blockedEvent.from_stage ===
        "PAPER" &&
      blockedEvent.to_stage ===
        "LIMITED_LIVE" &&
      blockedEvent.requires_manual_approval ===
        true &&
      blockedEvent.manual_approval_confirmed ===
        false,

    paperModelStageUnchanged:
      afterPaperModel.promotion_stage ===
        "PAPER",

    paperModelLegacyStatusUnchanged:
      afterPaperModel.status ===
        beforePaperModel.status,

    eventCountIncreasedByOne:
      afterEvents ===
        beforeEvents + 1,

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
        ? "MODEL_PROMOTION_CONTROLLED_APPLY_RPC_V1_DB_APPLY_AND_REGRESSION_VERIFIED"
        : "MODEL_PROMOTION_CONTROLLED_APPLY_RPC_V1_DB_APPLY_AND_REGRESSION_FAILED",

    migration: {
      version:
        migrationVersion,
      file:
        migrationRel,
      sha256:
        sha256(sql),
    },

    checks,
    failed,

    directUpdateTest: {
      httpStatus:
        directUpdate.status,
      blocked:
        directUpdateBlocked,
      candidateStageAfter:
        afterDirectCandidate.promotion_stage,
    },

    manualApprovalGuardTest: {
      modelId:
        paperModelId,
      attemptedTransition:
        "PAPER->LIMITED_LIVE",
      manualApprovalConfirmed:
        false,
      rpcDecision:
        rpcRow.decision,
      applied:
        rpcRow.applied,
      eventId:
        rpcRow.event_id,
      paperStageAfter:
        afterPaperModel.promotion_stage,
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

    safety: {
      candidatePromotionStageChanged:
        beforeCandidate.promotion_stage !==
          afterCandidate.promotion_stage,
      paperPromotionStageChanged:
        beforePaperModel.promotion_stage !==
          afterPaperModel.promotion_stage,
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
        "one BLOCKED model_promotion_events audit row"
      ],
    },

    nextGate:
      failed.length === 0
        ? "CONTROLLED_RPC_READY_FOR_EXPLICIT_CANDIDATE_TO_SHADOW_APPLY"
        : "STOP_AND_DIAGNOSE_CONTROLLED_APPLY_DB_BINDING",

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
          directUpdateBody:
            directUpdate.body,
          manualBlockRpcBody:
            manualBlockRpc.body,
          blockedEvent,
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
        "MODEL_PROMOTION_CONTROLLED_APPLY_RPC_V1_DB_APPLY_AND_REGRESSION_FAILED",
      error:
        error instanceof Error
          ? error.message
          : String(error),
      safety: {
        realTradingEnabledByScript:
          false,
      },
      nextGate:
        "STOP_AND_DIAGNOSE_CONTROLLED_APPLY_DB_BINDING",
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
