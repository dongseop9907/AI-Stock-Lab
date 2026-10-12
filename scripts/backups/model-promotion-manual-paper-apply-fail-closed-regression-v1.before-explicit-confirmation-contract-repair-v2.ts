import fs from "fs";
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
