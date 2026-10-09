import {
  canCreateLiveRiskForPromotionStage,
  canCreatePaperRiskForPromotionStage,
  isModelPromotionStage,
  type ModelPromotionStage,
} from "@/lib/models/model-promotion-state-machine";

import {
  createSupabaseServerClient,
} from "@/lib/supabase";

export interface ModelPromotionGateRecord {
  id: string;
  status: string;
  promotionStage: ModelPromotionStage;
}

export async function resolveModelPromotionGate(
  modelId: string,
): Promise<ModelPromotionGateRecord> {
  if (!modelId?.trim()) {
    throw new Error(
      "MODEL_PROMOTION_GATE_MODEL_ID_REQUIRED",
    );
  }

  const supabase =
    createSupabaseServerClient();

  const {
    data,
    error,
  } =
    await supabase
      .from("ai_model_versions")
      .select(
        "id,status,promotion_stage",
      )
      .eq("id", modelId)
      .single();

  if (error || !data) {
    throw new Error(
      `MODEL_PROMOTION_GATE_MODEL_LOOKUP_FAILED:${
        error?.message ??
        "MODEL_NOT_FOUND"
      }`,
    );
  }

  if (
    !isModelPromotionStage(
      data.promotion_stage,
    )
  ) {
    throw new Error(
      `MODEL_PROMOTION_STAGE_INVALID:${
        data.promotion_stage ??
        "NULL"
      }`,
    );
  }

  return {
    id:
      data.id,
    status:
      data.status,
    promotionStage:
      data.promotion_stage,
  };
}

export async function assertModelPromotionAllowsPaperRisk(
  modelId: string,
  boundary:
    | "ENTRY_SIGNAL_AUTO_ORDER"
    | "PAPER_ORDER_SERVICE"
    | "PAPER_ORDER_API"
    | string,
): Promise<ModelPromotionGateRecord> {
  const model =
    await resolveModelPromotionGate(
      modelId,
    );

  if (
    !canCreatePaperRiskForPromotionStage(
      model.promotionStage,
    )
  ) {
    throw new Error(
      `MODEL_PROMOTION_PAPER_RISK_BLOCKED:${model.promotionStage}:${boundary}`,
    );
  }

  return model;
}

export async function assertModelPromotionAllowsLiveRisk(
  modelId: string,
  boundary: string,
): Promise<ModelPromotionGateRecord> {
  const model =
    await resolveModelPromotionGate(
      modelId,
    );

  if (
    !canCreateLiveRiskForPromotionStage(
      model.promotionStage,
    )
  ) {
    throw new Error(
      `MODEL_PROMOTION_LIVE_RISK_BLOCKED:${model.promotionStage}:${boundary}`,
    );
  }

  return model;
}
