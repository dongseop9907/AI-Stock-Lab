const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const DECISION_FILE = path.join(
  ROOT,
  "lib",
  "models",
  "model-promotion-decision-service.ts",
);

const APPLY_SERVICE_FILE = path.join(
  ROOT,
  "lib",
  "models",
  "model-promotion-manual-apply.ts",
);

const APPLY_ROUTE_FILE = path.join(
  ROOT,
  "app",
  "api",
  "models",
  "promotion",
  "apply",
  "route.ts",
);

const REGRESSION_FILE = path.join(
  ROOT,
  "scripts",
  "model-promotion-manual-paper-apply-fail-closed-regression-v1.ts",
);

const BACKUP_DIR = path.join(
  ROOT,
  "scripts",
  "backups",
);

const DECISION_BACKUP = path.join(
  BACKUP_DIR,
  "model-promotion-decision-service.before-manual-paper-apply-v1.ts",
);

function fail(reason, extra = {}) {
  console.error(
    JSON.stringify(
      {
        status:
          "MODEL_PROMOTION_MANUAL_PAPER_APPLY_FAIL_CLOSED_V1_INSTALL_FAILED",
        reason,
        ...extra,
        safety: {
          databaseWrites: 0,
          promotionApplied: false,
          orderCreation: false,
          positionChange: false,
          controlsChange: false,
          realTradingEnable: false,
        },
      },
      null,
      2,
    ),
  );

  process.exit(1);
}

if (!fs.existsSync(DECISION_FILE)) {
  fail(
    "DECISION_SERVICE_NOT_FOUND",
    {
      file:
        "lib/models/model-promotion-decision-service.ts",
    },
  );
}

let ts;

try {
  ts = require("typescript");
} catch (error) {
  fail(
    "TYPESCRIPT_NOT_AVAILABLE",
    {
      error:
        error instanceof Error
          ? error.message
          : String(error),
    },
  );
}

fs.mkdirSync(
  BACKUP_DIR,
  {
    recursive: true,
  },
);

const originalDecision =
  fs.readFileSync(
    DECISION_FILE,
    "utf8",
  );

if (!fs.existsSync(DECISION_BACKUP)) {
  fs.writeFileSync(
    DECISION_BACKUP,
    originalDecision,
    "utf8",
  );
}

let patchedDecision =
  originalDecision;

if (
  !patchedDecision.includes(
    "SHADOW_PAPER_CANONICAL_OUTCOME_EVIDENCE_READY",
  )
) {
  const reasonNeedle =
    '| "SHADOW_PAPER_CANONICAL_OUTCOME_EVIDENCE_NOT_READY"';

  if (
    !patchedDecision.includes(
      reasonNeedle,
    )
  ) {
    fail(
      "NOT_READY_REASON_UNION_MEMBER_NOT_FOUND",
    );
  }

  patchedDecision =
    patchedDecision.replace(
      reasonNeedle,
      '| "SHADOW_PAPER_CANONICAL_OUTCOME_EVIDENCE_READY"\n  ' +
      reasonNeedle,
    );
}

const oldShadowDecisionRegex =
  /decision:\s*"BLOCKED",\s*reason:\s*\(transition\.allowed\)\s*&&\s*!evidence\.canonicalShadowOutcomeEvidenceReady\s*\?\s*"SHADOW_PAPER_CANONICAL_OUTCOME_EVIDENCE_NOT_READY"\s*:\s*"INVALID_TRANSITION",/m;

const newShadowDecisionBlock = `decision:
        transition.allowed &&
        evidence.canonicalShadowOutcomeEvidenceReady
          ? "RECOMMENDED"
          : "BLOCKED",
      reason:
        !transition.allowed
          ? "INVALID_TRANSITION"
          : evidence.canonicalShadowOutcomeEvidenceReady
            ? "SHADOW_PAPER_CANONICAL_OUTCOME_EVIDENCE_READY"
            : "SHADOW_PAPER_CANONICAL_OUTCOME_EVIDENCE_NOT_READY",`;

if (
  oldShadowDecisionRegex.test(
    patchedDecision,
  )
) {
  patchedDecision =
    patchedDecision.replace(
      oldShadowDecisionRegex,
      newShadowDecisionBlock,
    );
} else if (
  !patchedDecision.includes(
    '"SHADOW_PAPER_CANONICAL_OUTCOME_EVIDENCE_READY"',
  ) ||
  !patchedDecision.includes(
    'evidence.canonicalShadowOutcomeEvidenceReady'
  ) ||
  !patchedDecision.includes(
    '? "RECOMMENDED"'
  )
) {
  fail(
    "SHADOW_RECOMMENDATION_BLOCK_NOT_PATCHABLE",
  );
}

const parsedDecision =
  ts.createSourceFile(
    DECISION_FILE,
    patchedDecision,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

if (
  parsedDecision.parseDiagnostics &&
  parsedDecision.parseDiagnostics.length >
    0
) {
  fail(
    "PATCHED_DECISION_SERVICE_PARSE_FAILED",
    {
      diagnostics:
        parsedDecision.parseDiagnostics.map(
          (diag) => ({
            message:
              ts.flattenDiagnosticMessageText(
                diag.messageText,
                "\n",
              ),
          }),
        ),
    },
  );
}

const applyServiceSource = `import {
  createSupabaseServerClient,
} from "@/lib/supabase";

import {
  evaluateModelPromotionRecommendation,
} from "@/lib/models/model-promotion-decision-service";

import {
  assertModelPromotionTransition,
  type ModelPromotionStage,
} from "@/lib/models/model-promotion-state-machine";

export const MODEL_PROMOTION_MANUAL_APPLY_VERSION =
  "MODEL_PROMOTION_MANUAL_APPLY_V1" as const;

export interface ManualPaperPromotionApplyInput {
  modelId: string;
  toStage: "PAPER";
  manualApprovalConfirmed: boolean;
  actor: string;
  reason: string;
}

export interface ManualPaperPromotionPreflight {
  version:
    typeof MODEL_PROMOTION_MANUAL_APPLY_VERSION;
  allowed: boolean;
  reason:
    | "READY"
    | "MANUAL_APPROVAL_REQUIRED"
    | "ONLY_SHADOW_TO_PAPER_SUPPORTED"
    | "MODEL_PURPOSE_NOT_ENTRY_TIMING"
    | "CANONICAL_OUTCOME_EVIDENCE_NOT_READY"
    | "PROMOTION_RECOMMENDATION_NOT_READY"
    | "INVALID_TRANSITION";
  modelId: string;
  fromStage: ModelPromotionStage;
  toStage: "PAPER";
  recommendationDecision:
    | "RECOMMENDED"
    | "BLOCKED";
  recommendationReason: string;
  canonicalShadowOutcomeEvidenceReady:
    boolean;
  transitionKind: string;
  featureEnabled: boolean;
}

export async function preflightManualPaperPromotion(
  input: ManualPaperPromotionApplyInput,
): Promise<ManualPaperPromotionPreflight> {
  if (
    !input.modelId ||
    !input.actor.trim() ||
    !input.reason.trim()
  ) {
    throw new Error(
      "MODEL_PROMOTION_MANUAL_APPLY_REQUIRED_FIELDS_MISSING",
    );
  }

  const supabase =
    createSupabaseServerClient();

  const {
    data: model,
    error: modelError,
  } =
    await supabase
      .from("ai_model_versions")
      .select(
        "id,purpose,promotion_stage",
      )
      .eq(
        "id",
        input.modelId,
      )
      .single();

  if (
    modelError ||
    !model
  ) {
    throw new Error(
      \`MODEL_PROMOTION_MANUAL_APPLY_MODEL_LOOKUP_FAILED:\${
        modelError?.message ??
        "NOT_FOUND"
      }\`,
    );
  }

  const fromStage =
    model.promotion_stage as
      ModelPromotionStage;

  const featureEnabled =
    process.env
      .ENABLE_MANUAL_MODEL_PROMOTION_APPLY ===
    "true";

  if (
    input.toStage !==
      "PAPER" ||
    fromStage !==
      "SHADOW"
  ) {
    return {
      version:
        MODEL_PROMOTION_MANUAL_APPLY_VERSION,
      allowed:
        false,
      reason:
        "ONLY_SHADOW_TO_PAPER_SUPPORTED",
      modelId:
        model.id,
      fromStage,
      toStage:
        "PAPER",
      recommendationDecision:
        "BLOCKED",
      recommendationReason:
        "NOT_EVALUATED",
      canonicalShadowOutcomeEvidenceReady:
        false,
      transitionKind:
        "NOT_EVALUATED",
      featureEnabled,
    };
  }

  if (
    model.purpose !==
      "ENTRY_TIMING"
  ) {
    return {
      version:
        MODEL_PROMOTION_MANUAL_APPLY_VERSION,
      allowed:
        false,
      reason:
        "MODEL_PURPOSE_NOT_ENTRY_TIMING",
      modelId:
        model.id,
      fromStage,
      toStage:
        "PAPER",
      recommendationDecision:
        "BLOCKED",
      recommendationReason:
        "NOT_EVALUATED",
      canonicalShadowOutcomeEvidenceReady:
        false,
      transitionKind:
        "NOT_EVALUATED",
      featureEnabled,
    };
  }

  const transition =
    assertModelPromotionTransition(
      fromStage,
      "PAPER",
    );

  const recommendation =
    await evaluateModelPromotionRecommendation(
      model.id,
    );

  const canonicalReady =
    recommendation.evidence
      .canonicalShadowOutcomeEvidenceReady ===
    true;

  if (
    input.manualApprovalConfirmed !==
      true
  ) {
    return {
      version:
        MODEL_PROMOTION_MANUAL_APPLY_VERSION,
      allowed:
        false,
      reason:
        "MANUAL_APPROVAL_REQUIRED",
      modelId:
        model.id,
      fromStage,
      toStage:
        "PAPER",
      recommendationDecision:
        recommendation.decision,
      recommendationReason:
        recommendation.reason,
      canonicalShadowOutcomeEvidenceReady:
        canonicalReady,
      transitionKind:
        transition.kind,
      featureEnabled,
    };
  }

  if (
    !canonicalReady
  ) {
    return {
      version:
        MODEL_PROMOTION_MANUAL_APPLY_VERSION,
      allowed:
        false,
      reason:
        "CANONICAL_OUTCOME_EVIDENCE_NOT_READY",
      modelId:
        model.id,
      fromStage,
      toStage:
        "PAPER",
      recommendationDecision:
        recommendation.decision,
      recommendationReason:
        recommendation.reason,
      canonicalShadowOutcomeEvidenceReady:
        false,
      transitionKind:
        transition.kind,
      featureEnabled,
    };
  }

  if (
    recommendation.decision !==
      "RECOMMENDED" ||
    recommendation.toStage !==
      "PAPER" ||
    recommendation.reason !==
      "SHADOW_PAPER_CANONICAL_OUTCOME_EVIDENCE_READY"
  ) {
    return {
      version:
        MODEL_PROMOTION_MANUAL_APPLY_VERSION,
      allowed:
        false,
      reason:
        "PROMOTION_RECOMMENDATION_NOT_READY",
      modelId:
        model.id,
      fromStage,
      toStage:
        "PAPER",
      recommendationDecision:
        recommendation.decision,
      recommendationReason:
        recommendation.reason,
      canonicalShadowOutcomeEvidenceReady:
        canonicalReady,
      transitionKind:
        transition.kind,
      featureEnabled,
    };
  }

  return {
    version:
      MODEL_PROMOTION_MANUAL_APPLY_VERSION,
    allowed:
      true,
    reason:
      "READY",
    modelId:
      model.id,
    fromStage,
    toStage:
      "PAPER",
    recommendationDecision:
      recommendation.decision,
    recommendationReason:
      recommendation.reason,
    canonicalShadowOutcomeEvidenceReady:
      true,
    transitionKind:
      transition.kind,
    featureEnabled,
  };
}

export async function applyManualPaperPromotion(
  input: ManualPaperPromotionApplyInput,
) {
  const preflight =
    await preflightManualPaperPromotion(
      input,
    );

  if (
    !preflight.allowed
  ) {
    throw new Error(
      \`MODEL_PROMOTION_MANUAL_APPLY_BLOCKED:\${
        preflight.reason
      }\`,
    );
  }

  if (
    !preflight.featureEnabled
  ) {
    throw new Error(
      "MODEL_PROMOTION_MANUAL_APPLY_FEATURE_DISABLED",
    );
  }

  const supabase =
    createSupabaseServerClient();

  const recommendation =
    await evaluateModelPromotionRecommendation(
      input.modelId,
    );

  const {
    data: event,
    error: eventError,
  } =
    await supabase
      .from(
        "model_promotion_events",
      )
      .insert({
        model_id:
          input.modelId,
        from_stage:
          "SHADOW",
        to_stage:
          "PAPER",
        transition_kind:
          preflight.transitionKind,
        decision:
          recommendation.decision,
        requires_manual_approval:
          true,
        manual_approval_confirmed:
          true,
        actor:
          input.actor,
        reason:
          \`MANUAL_APPLY_APPROVED:\${
            input.reason
          }\`,
        evidence: {
          ...recommendation.evidence,
          manualApply: {
            version:
              MODEL_PROMOTION_MANUAL_APPLY_VERSION,
            actor:
              input.actor,
            reason:
              input.reason,
            canonicalReady:
              preflight
                .canonicalShadowOutcomeEvidenceReady,
          },
        },
      })
      .select("id")
      .single();

  if (
    eventError ||
    !event
  ) {
    throw new Error(
      \`MODEL_PROMOTION_MANUAL_APPLY_EVENT_INSERT_FAILED:\${
        eventError?.message ??
        "NO_EVENT"
      }\`,
    );
  }

  const now =
    new Date()
      .toISOString();

  const {
    data: updated,
    error: updateError,
  } =
    await supabase
      .from(
        "ai_model_versions",
      )
      .update({
        promotion_stage:
          "PAPER",
        promotion_stage_updated_at:
          now,
        promotion_stage_reason:
          \`MANUAL_APPLY:\${
            input.reason
          }\`,
      })
      .eq(
        "id",
        input.modelId,
      )
      .eq(
        "promotion_stage",
        "SHADOW",
      )
      .select(
        "id,purpose,status,promotion_stage,promotion_stage_updated_at,promotion_stage_reason",
      )
      .maybeSingle();

  if (
    updateError ||
    !updated
  ) {
    await supabase
      .from(
        "model_promotion_events",
      )
      .delete()
      .eq(
        "id",
        event.id,
      );

    throw new Error(
      \`MODEL_PROMOTION_MANUAL_APPLY_STAGE_UPDATE_FAILED:\${
        updateError?.message ??
        "OPTIMISTIC_STAGE_MISMATCH"
      }\`,
    );
  }

  return {
    version:
      MODEL_PROMOTION_MANUAL_APPLY_VERSION,
    applied:
      true,
    eventId:
      event.id,
    model:
      updated,
    safety: {
      manualApprovalConfirmed:
        true,
      canonicalEvidenceReady:
        true,
      featureEnabled:
        true,
      automationInitiated:
        false,
      realTradingChanged:
        false,
    },
  };
}
`;

const routeSource = `import {
  NextResponse,
} from "next/server";

import {
  applyManualPaperPromotion,
  preflightManualPaperPromotion,
} from "@/lib/models/model-promotion-manual-apply";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

interface ManualPromotionRequest {
  modelId?: unknown;
  toStage?: unknown;
  manualApprovalConfirmed?: unknown;
  actor?: unknown;
  reason?: unknown;
  dryRun?: unknown;
}

export async function POST(
  request: Request,
) {
  try {
    const body =
      (await request
        .json()
        .catch(
          () => ({}),
        )) as
        ManualPromotionRequest;

    const modelId =
      String(
        body.modelId ??
        "",
      )
        .trim();

    const toStage =
      String(
        body.toStage ??
        "",
      )
        .trim();

    const actor =
      String(
        body.actor ??
        "",
      )
        .trim();

    const reason =
      String(
        body.reason ??
        "",
      )
        .trim();

    const manualApprovalConfirmed =
      body
        .manualApprovalConfirmed ===
      true;

    if (
      !modelId ||
      toStage !==
        "PAPER" ||
      !actor ||
      !reason
    ) {
      return NextResponse.json(
        {
          ok:
            false,
          message:
            "MODEL_PROMOTION_MANUAL_APPLY_INVALID_REQUEST",
        },
        {
          status:
            400,
        },
      );
    }

    const input = {
      modelId,
      toStage:
        "PAPER" as const,
      manualApprovalConfirmed,
      actor,
      reason,
    };

    if (
      body.dryRun ===
      true
    ) {
      const preflight =
        await preflightManualPaperPromotion(
          input,
        );

      return NextResponse.json({
        ok:
          true,
        dryRun:
          true,
        preflight,
      });
    }

    if (
      !manualApprovalConfirmed
    ) {
      return NextResponse.json(
        {
          ok:
            false,
          message:
            "MODEL_PROMOTION_MANUAL_APPROVAL_REQUIRED",
        },
        {
          status:
            409,
        },
      );
    }

    const result =
      await applyManualPaperPromotion(
        input,
      );

    return NextResponse.json({
      ok:
        true,
      ...result,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    return NextResponse.json(
      {
        ok:
          false,
        message,
      },
      {
        status:
          message.includes(
            "BLOCKED"
          ) ||
          message.includes(
            "FEATURE_DISABLED"
          )
            ? 409
            : 500,
      },
    );
  }
}
`;

const regressionSource = `import fs from "fs";
import path from "path";

import {
  createSupabaseServerClient,
} from "@/lib/supabase";

import {
  evaluateModelPromotionRecommendation,
} from "@/lib/models/model-promotion-decision-service";

import {
  applyManualPaperPromotion,
  preflightManualPaperPromotion,
} from "@/lib/models/model-promotion-manual-apply";

const ROOT =
  process.cwd();

async function countRows(
  table: string,
): Promise<number> {
  const supabase =
    createSupabaseServerClient();

  const {
    count,
    error,
  } =
    await supabase
      .from(table)
      .select("*", {
        count:
          "exact",
        head:
          true,
      });

  if (error) {
    throw new Error(
      "COUNT_FAILED:" +
      table +
      ":" +
      error.message,
    );
  }

  return count ?? 0;
}

async function getControls() {
  const supabase =
    createSupabaseServerClient();

  const {
    data,
    error,
  } =
    await supabase
      .from(
        "trading_system_controls",
      )
      .select(
        "control_key,emergency_stop,automation_enabled,paper_order_enabled,real_order_enabled"
      )
      .limit(1)
      .maybeSingle();

  if (error) {
    throw new Error(
      "CONTROL_READ_FAILED:" +
      error.message,
    );
  }

  return data;
}

async function main() {
  const supabase =
    createSupabaseServerClient();

  const {
    data: model,
    error: modelError,
  } =
    await supabase
      .from(
        "ai_model_versions",
      )
      .select(
        "id,purpose,status,promotion_stage,promotion_stage_updated_at"
      )
      .eq(
        "purpose",
        "ENTRY_TIMING",
      )
      .eq(
        "promotion_stage",
        "SHADOW",
      )
      .limit(1)
      .maybeSingle();

  if (
    modelError ||
    !model
  ) {
    throw new Error(
      "ENTRY_TIMING_SHADOW_MODEL_NOT_FOUND",
    );
  }

  const before = {
    events:
      await countRows(
        "model_promotion_events",
      ),
    orders:
      await countRows(
        "paper_order_requests",
      ),
    positions:
      await countRows(
        "paper_positions",
      ),
    controls:
      await getControls(),
  };

  const recommendation =
    await evaluateModelPromotionRecommendation(
      model.id,
    );

  const preflight =
    await preflightManualPaperPromotion({
      modelId:
        model.id,
      toStage:
        "PAPER",
      manualApprovalConfirmed:
        true,
      actor:
        "MANUAL_PAPER_APPLY_FAIL_CLOSED_REGRESSION_V1",
      reason:
        "FAIL_CLOSED_REGRESSION_ONLY",
    });

  let applyError:
    string | null =
      null;

  try {
    await applyManualPaperPromotion({
      modelId:
        model.id,
      toStage:
        "PAPER",
      manualApprovalConfirmed:
        true,
      actor:
        "MANUAL_PAPER_APPLY_FAIL_CLOSED_REGRESSION_V1",
      reason:
        "FAIL_CLOSED_REGRESSION_ONLY",
    });
  } catch (error) {
    applyError =
      error instanceof Error
        ? error.message
        : String(error);
  }

  const {
    data: modelAfter,
    error: modelAfterError,
  } =
    await supabase
      .from(
        "ai_model_versions",
      )
      .select(
        "id,promotion_stage,promotion_stage_updated_at"
      )
      .eq(
        "id",
        model.id,
      )
      .single();

  if (
    modelAfterError ||
    !modelAfter
  ) {
    throw new Error(
      "MODEL_AFTER_READ_FAILED",
    );
  }

  const after = {
    events:
      await countRows(
        "model_promotion_events",
      ),
    orders:
      await countRows(
        "paper_order_requests",
      ),
    positions:
      await countRows(
        "paper_positions",
      ),
    controls:
      await getControls(),
  };

  const automationFiles = [
    "app/api/trading/automation/run/route.ts",
    "app/api/trading/automation/cycle/route.ts",
    "app/api/trading/automation/manual/route.ts",
  ];

  const automationReferencesApply =
    automationFiles
      .filter(
        (file) =>
          fs.existsSync(
            path.join(
              ROOT,
              file,
            ),
          ),
      )
      .filter(
        (file) => {
          const text =
            fs.readFileSync(
              path.join(
                ROOT,
                file,
              ),
              "utf8",
            );

          return (
            text.includes(
              "model-promotion-manual-apply"
            ) ||
            text.includes(
              "/api/models/promotion/apply"
            ) ||
            text.includes(
              "applyManualPaperPromotion"
            )
          );
        },
      );

  const decisionSource =
    fs.readFileSync(
      path.join(
        ROOT,
        "lib",
        "models",
        "model-promotion-decision-service.ts",
      ),
      "utf8",
    );

  const checks = {
    currentModelIsShadow:
      model.promotion_stage ===
      "SHADOW",

    canonicalEvidenceCurrentlyNotReady:
      recommendation.evidence
        .canonicalShadowOutcomeEvidenceReady ===
      false,

    recommendationStillBlocked:
      recommendation.decision ===
      "BLOCKED",

    recommendationReasonStillNotReady:
      recommendation.reason ===
      "SHADOW_PAPER_CANONICAL_OUTCOME_EVIDENCE_NOT_READY",

    readyRecommendationBranchImplemented:
      decisionSource.includes(
        "SHADOW_PAPER_CANONICAL_OUTCOME_EVIDENCE_READY"
      ) &&
      decisionSource.includes(
        '? "RECOMMENDED"'
      ),

    preflightBlocked:
      preflight.allowed ===
      false,

    preflightReasonCanonicalNotReady:
      preflight.reason ===
      "CANONICAL_OUTCOME_EVIDENCE_NOT_READY",

    applyCallFailClosed:
      applyError ===
      "MODEL_PROMOTION_MANUAL_APPLY_BLOCKED:CANONICAL_OUTCOME_EVIDENCE_NOT_READY",

    modelStageUnchanged:
      modelAfter
        .promotion_stage ===
      "SHADOW",

    modelStageTimestampUnchanged:
      modelAfter
        .promotion_stage_updated_at ===
      model
        .promotion_stage_updated_at,

    noPromotionEventCreated:
      before.events ===
      after.events,

    noOrdersCreated:
      before.orders ===
      after.orders,

    noPositionsChanged:
      before.positions ===
      after.positions,

    controlsUnchanged:
      JSON.stringify(
        before.controls,
      ) ===
      JSON.stringify(
        after.controls,
      ),

    automationCannotCallManualApply:
      automationReferencesApply.length ===
      0,

    realTradingStillOff:
      after.controls
        ?.real_order_enabled ===
      false,
  };

  const required = [
    "currentModelIsShadow",
    "canonicalEvidenceCurrentlyNotReady",
    "recommendationStillBlocked",
    "recommendationReasonStillNotReady",
    "readyRecommendationBranchImplemented",
    "preflightBlocked",
    "preflightReasonCanonicalNotReady",
    "applyCallFailClosed",
    "modelStageUnchanged",
    "modelStageTimestampUnchanged",
    "noPromotionEventCreated",
    "noOrdersCreated",
    "noPositionsChanged",
    "controlsUnchanged",
    "automationCannotCallManualApply",
    "realTradingStillOff",
  ] as const;

  const failed =
    required.filter(
      (key) =>
        !checks[key],
    );

  const report = {
    status:
      failed.length ===
      0
        ? "MODEL_PROMOTION_MANUAL_PAPER_APPLY_FAIL_CLOSED_REGRESSION_V1_VERIFIED"
        : "MODEL_PROMOTION_MANUAL_PAPER_APPLY_FAIL_CLOSED_REGRESSION_V1_FAILED",

    model: {
      id:
        model.id,
      purpose:
        model.purpose,
      legacyStatus:
        model.status,
      promotionStage:
        model.promotion_stage,
      promotionStageUpdatedAt:
        model
          .promotion_stage_updated_at,
    },

    recommendation: {
      decision:
        recommendation
          .decision,
      reason:
        recommendation
          .reason,
      canonicalReady:
        recommendation
          .evidence
          .canonicalShadowOutcomeEvidenceReady,
    },

    preflight,

    applyAttempt: {
      error:
        applyError,
      expected:
        "MODEL_PROMOTION_MANUAL_APPLY_BLOCKED:CANONICAL_OUTCOME_EVIDENCE_NOT_READY",
    },

    automationReferencesApply,

    counts: {
      promotionEvents:
        String(
          before.events,
        ) +
        "->" +
        String(
          after.events,
        ),
      orders:
        String(
          before.orders,
        ) +
        "->" +
        String(
          after.orders,
        ),
      positions:
        String(
          before.positions,
        ) +
        "->" +
        String(
          after.positions,
        ),
    },

    controls: {
      before:
        before.controls,
      after:
        after.controls,
    },

    checks,

    failed,

    safety: {
      databaseReadsOnlyInCurrentState:
        true,
      promotionApplyAttempted:
        true,
      promotionApplied:
        false,
      promotionEventsCreated:
        after.events -
        before.events,
      ordersCreated:
        after.orders -
        before.orders,
      positionsChanged:
        after.positions -
        before.positions,
      controlsChanged:
        JSON.stringify(
          before.controls,
        ) !==
        JSON.stringify(
          after.controls,
        ),
      realTradingEnabledByScript:
        false,
    },

    nextGate:
      failed.length ===
      0
        ? "KEEP_SHADOW_WAIT_FOR_REAL_CANONICAL_EVIDENCE_AND_VERIFY_MANUAL_APPLY_READY_POSITIVE_PATH_ONLY_AFTER_EVIDENCE_MATURES"
        : "STOP_AND_INSPECT_MANUAL_PAPER_APPLY_FAIL_CLOSED_GAP",
  };

  console.log(
    JSON.stringify(
      report,
      null,
      2,
    ),
  );

  process.exitCode =
    failed.length ===
    0
      ? 0
      : 1;
}

main().catch(
  (error) => {
    console.error(
      JSON.stringify(
        {
          status:
            "MODEL_PROMOTION_MANUAL_PAPER_APPLY_FAIL_CLOSED_REGRESSION_V1_FAILED",
          error:
            error instanceof Error
              ? error.message
              : String(error),
        },
        null,
        2,
      ),
    );

    process.exitCode =
      1;
  },
);
`;

fs.writeFileSync(
  DECISION_FILE,
  patchedDecision,
  "utf8",
);

fs.mkdirSync(
  path.dirname(
    APPLY_SERVICE_FILE,
  ),
  {
    recursive: true,
  },
);

fs.writeFileSync(
  APPLY_SERVICE_FILE,
  applyServiceSource,
  "utf8",
);

fs.mkdirSync(
  path.dirname(
    APPLY_ROUTE_FILE,
  ),
  {
    recursive: true,
  },
);

fs.writeFileSync(
  APPLY_ROUTE_FILE,
  routeSource,
  "utf8",
);

fs.writeFileSync(
  REGRESSION_FILE,
  regressionSource,
  "utf8",
);

for (const [file, kind] of [
  [APPLY_SERVICE_FILE, ts.ScriptKind.TS],
  [APPLY_ROUTE_FILE, ts.ScriptKind.TS],
  [REGRESSION_FILE, ts.ScriptKind.TS],
]) {
  const text =
    fs.readFileSync(
      file,
      "utf8",
    );

  const sf =
    ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      kind,
    );

  if (
    sf.parseDiagnostics &&
    sf.parseDiagnostics.length >
      0
  ) {
    fail(
      "GENERATED_SOURCE_PARSE_FAILED",
      {
        file:
          path.relative(
            ROOT,
            file,
          ),
        diagnostics:
          sf.parseDiagnostics.map(
            (diag) => ({
              message:
                ts.flattenDiagnosticMessageText(
                  diag.messageText,
                  "\n",
                ),
            }),
          ),
      },
    );
  }
}

console.log(
  JSON.stringify(
    {
      status:
        "MODEL_PROMOTION_MANUAL_PAPER_APPLY_FAIL_CLOSED_V1_INSTALLED",

      modifiedFiles: [
        "lib/models/model-promotion-decision-service.ts",
      ],

      generatedFiles: [
        "lib/models/model-promotion-manual-apply.ts",
        "app/api/models/promotion/apply/route.ts",
        "scripts/model-promotion-manual-paper-apply-fail-closed-regression-v1.ts",
      ],

      backup:
        "scripts/backups/model-promotion-decision-service.before-manual-paper-apply-v1.ts",

      behavior: {
        shadowToPaperRecommendation:
          "RECOMMENDED_ONLY_WHEN_CANONICAL_EVIDENCE_READY",
        manualApply:
          "EXPLICIT_MANUAL_APPROVAL_PLUS_CANONICAL_READY_PLUS_FEATURE_FLAG",
        automationBinding:
          "NONE",
        defaultFeatureFlag:
          "DISABLED_UNLESS_ENABLE_MANUAL_MODEL_PROMOTION_APPLY=true",
      },

      safety: {
        installerDatabaseWrites:
          0,
        promotionApplied:
          false,
        orderCreation:
          false,
        positionChange:
          false,
        controlsChange:
          false,
        realTradingEnable:
          false,
      },

      nextAction:
        "RUN_MANUAL_PAPER_APPLY_FAIL_CLOSED_REGRESSION",
    },
    null,
    2,
  ),
);
