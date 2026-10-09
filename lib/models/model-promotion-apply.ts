import {
  createSupabaseServerClient,
} from "@/lib/supabase";

import type {
  ModelPromotionStage,
} from "@/lib/models/model-promotion-state-machine";

export const MODEL_PROMOTION_CONTROLLED_APPLY_VERSION =
  "MODEL_PROMOTION_CONTROLLED_APPLY_V1" as const;

export interface ApplyModelPromotionTransitionInput {
  modelId: string;
  toStage: ModelPromotionStage;
  actor: string;
  reason: string;
  manualApprovalConfirmed?: boolean;
  evidence?: Record<string, unknown>;
}

export interface ApplyModelPromotionTransitionResult {
  eventId: string;
  modelId: string;
  fromStage: ModelPromotionStage;
  toStage: ModelPromotionStage;
  decision:
    | "APPLIED"
    | "BLOCKED";
  manualRequired: boolean;
  applied: boolean;
}

export function promotionTransitionRequiresManualApproval(
  fromStage: ModelPromotionStage,
  toStage: ModelPromotionStage,
): boolean {
  return (
    (
      fromStage === "PAPER" &&
      toStage === "LIMITED_LIVE"
    ) ||
    (
      fromStage === "LIMITED_LIVE" &&
      toStage === "PRODUCTION"
    ) ||
    (
      fromStage === "DEGRADED" &&
      toStage === "SHADOW"
    )
  );
}

export async function applyModelPromotionTransition(
  input: ApplyModelPromotionTransitionInput,
): Promise<ApplyModelPromotionTransitionResult> {
  if (!input.modelId?.trim()) {
    throw new Error(
      "MODEL_PROMOTION_MODEL_ID_REQUIRED",
    );
  }

  if (!input.actor?.trim()) {
    throw new Error(
      "MODEL_PROMOTION_ACTOR_REQUIRED",
    );
  }

  if (!input.reason?.trim()) {
    throw new Error(
      "MODEL_PROMOTION_REASON_REQUIRED",
    );
  }

  const supabase =
    createSupabaseServerClient();

  const {
    data,
    error,
  } =
    await supabase.rpc(
      "apply_model_promotion_transition_v1",
      {
        p_model_id:
          input.modelId,
        p_to_stage:
          input.toStage,
        p_actor:
          input.actor,
        p_reason:
          input.reason,
        p_manual_approval_confirmed:
          input.manualApprovalConfirmed ===
          true,
        p_evidence:
          input.evidence ?? {},
      },
    );

  if (error) {
    throw new Error(
      `MODEL_PROMOTION_CONTROLLED_APPLY_RPC_FAILED:${error.message}`,
    );
  }

  const row =
    Array.isArray(data)
      ? data[0]
      : data;

  if (!row) {
    throw new Error(
      "MODEL_PROMOTION_CONTROLLED_APPLY_RPC_NO_RESULT",
    );
  }

  return {
    eventId:
      row.event_id,
    modelId:
      row.model_id,
    fromStage:
      row.from_stage,
    toStage:
      row.to_stage,
    decision:
      row.decision,
    manualRequired:
      row.manual_required ===
      true,
    applied:
      row.applied ===
      true,
  };
}
