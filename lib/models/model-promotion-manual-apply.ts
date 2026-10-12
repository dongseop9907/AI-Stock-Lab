import {
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

export const MANUAL_PAPER_PROMOTION_CONFIRMATION_PHRASE =
  "PROMOTE_SHADOW_TO_PAPER" as const;

export interface ManualPaperPromotionApplyInput {
  modelId: string;
  toStage: "PAPER";
  manualApprovalConfirmed: boolean;
  confirmationPhrase: string;
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
    | "EXPLICIT_CONFIRMATION_REQUIRED"
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
      `MODEL_PROMOTION_MANUAL_APPLY_MODEL_LOOKUP_FAILED:${
        modelError?.message ??
        "NOT_FOUND"
      }`,
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
    input.confirmationPhrase !==
      MANUAL_PAPER_PROMOTION_CONFIRMATION_PHRASE
  ) {
    return {
      version:
        MODEL_PROMOTION_MANUAL_APPLY_VERSION,
      allowed:
        false,
      reason:
        "EXPLICIT_CONFIRMATION_REQUIRED",
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
      `MODEL_PROMOTION_MANUAL_APPLY_BLOCKED:${
        preflight.reason
      }`,
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
          `MANUAL_APPLY_APPROVED:${
            input.reason
          }`,
        evidence: {
          ...recommendation.evidence,
          manualApply: {
            version:
              MODEL_PROMOTION_MANUAL_APPLY_VERSION,
            actor:
              input.actor,
            reason:
              input.reason,
            confirmationPhrase:
              input.confirmationPhrase,
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
      `MODEL_PROMOTION_MANUAL_APPLY_EVENT_INSERT_FAILED:${
        eventError?.message ??
        "NO_EVENT"
      }`,
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
          `MANUAL_APPLY:${
            input.reason
          }`,
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
      `MODEL_PROMOTION_MANUAL_APPLY_STAGE_UPDATE_FAILED:${
        updateError?.message ??
        "OPTIMISTIC_STAGE_MISMATCH"
      }`,
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
      explicitConfirmationMatched:
        input.confirmationPhrase ===
        MANUAL_PAPER_PROMOTION_CONFIRMATION_PHRASE,
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
