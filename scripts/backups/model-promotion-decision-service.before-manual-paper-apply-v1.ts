import {
  evaluateModelPromotionTransition,
  type ModelPromotionStage,
} from "@/lib/models/model-promotion-state-machine";

import {
  createSupabaseServerClient,
} from "@/lib/supabase";
import {
  getCanonicalShadowOutcomeEvidence,
} from "@/lib/models/model-shadow-outcome-storage";


export const MODEL_PROMOTION_DECISION_SERVICE_VERSION =
  "MODEL_PROMOTION_DECISION_SERVICE_V1" as const;

export type ModelPromotionRecommendationDecision =
  | "RECOMMENDED"
  | "BLOCKED";

export type ModelPromotionRecommendationReason =
  | "CANDIDATE_SHADOW_SIGNAL_PIPELINE_READY"
  | "CANDIDATE_SHADOW_NO_MODEL_LINKED_SIGNALS"
  | "SHADOW_PAPER_CANONICAL_OUTCOME_EVIDENCE_NOT_READY"
  | "NO_SUPPORTED_RECOMMENDATION_FOR_STAGE"
  | "INVALID_TRANSITION";

export interface ModelPromotionEvidenceSnapshot {
  modelId: string;
  modelName: string;
  modelVersion: string;
  legacyStatus: string;
  promotionStage: ModelPromotionStage;
  validationTradeCount: number;
  metrics: Record<string, unknown>;
  metricsSource: string | null;
  metricsCalculatedAt: string | null;

  entrySignals: {
    total: number;
    generated: number;
    orderCreated: number;
    skipped: number;
    failed: number;
  };

  paperTrades: {
    total: number;
  };

  policy: {
    candidateToShadow:
      "NON_RISK_OPERATIONAL_READINESS_ONLY";
    shadowToPaper:
      "FAIL_CLOSED_UNTIL_CANONICAL_SHADOW_OUTCOME_EVIDENCE_EXISTS";
    automaticPromotion:
      false;
  };
  canonicalShadowOutcomeEvidenceReady: boolean;

}

export interface ModelPromotionRecommendation {
  version:
    typeof MODEL_PROMOTION_DECISION_SERVICE_VERSION;

  modelId: string;
  fromStage: ModelPromotionStage;
  toStage: ModelPromotionStage | null;

  decision:
    ModelPromotionRecommendationDecision;

  reason:
    ModelPromotionRecommendationReason;

  requiresManualApproval: boolean;

  evidence:
    ModelPromotionEvidenceSnapshot;

  safety: {
    recommendationOnly: true;
    promotionStageChanged: false;
    realTradingChanged: false;
    createsOrder: false;
    changesPosition: false;
  };
}

interface ModelRow {
  id: string;
  model_name: string;
  model_version: string;
  status: string;
  promotion_stage: string;
  validation_trade_count:
    | number
    | string
    | null;
  metrics:
    | Record<string, unknown>
    | null;
  metrics_source:
    | string
    | null;
  metrics_calculated_at:
    | string
    | null;
}

function toCount(
  value:
    | number
    | string
    | null
    | undefined,
): number {
  const parsed =
    Number(value);

  return Number.isFinite(parsed)
    ? Math.max(
        0,
        Math.trunc(parsed),
      )
    : 0;
}

async function countSignalsByStatus(
  modelId: string,
  status?: string,
): Promise<number> {
  const supabase =
    createSupabaseServerClient();

  let query =
    supabase
      .from("ai_entry_signals")
      .select("*", {
        count: "exact",
        head: true,
      })
      .eq("model_id", modelId);

  if (status) {
    query =
      query.eq(
        "status",
        status,
      );
  }

  const {
    count,
    error,
  } =
    await query;

  if (error) {
    throw new Error(
      `MODEL_PROMOTION_SIGNAL_COUNT_FAILED:${status ?? "ALL"}:${error.message}`,
    );
  }

  return count ?? 0;
}

async function countPaperTrades(
  modelId: string,
): Promise<number> {
  const supabase =
    createSupabaseServerClient();

  const {
    count,
    error,
  } =
    await supabase
      .from("paper_trade_history")
      .select("*", {
        count: "exact",
        head: true,
      })
      .eq("model_id", modelId);

  if (error) {
    throw new Error(
      `MODEL_PROMOTION_PAPER_TRADE_COUNT_FAILED:${error.message}`,
    );
  }

  return count ?? 0;
}

async function readModel(
  modelId: string,
): Promise<ModelRow> {
  const supabase =
    createSupabaseServerClient();

  const {
    data,
    error,
  } =
    await supabase
      .from("ai_model_versions")
      .select(`
        id,
        model_name,
        model_version,
        status,
        promotion_stage,
        validation_trade_count,
        metrics,
        metrics_source,
        metrics_calculated_at
      `)
      .eq("id", modelId)
      .single();

  if (
    error ||
    !data
  ) {
    throw new Error(
      `MODEL_PROMOTION_MODEL_READ_FAILED:${
        error?.message ??
        "MODEL_NOT_FOUND"
      }`,
    );
  }

  return data as ModelRow;
}

function assertStage(
  value: string,
): asserts value is ModelPromotionStage {
  const allowed:
    readonly string[] = [
      "EXPERIMENTAL",
      "CANDIDATE",
      "SHADOW",
      "PAPER",
      "LIMITED_LIVE",
      "PRODUCTION",
      "DEGRADED",
      "DISABLED",
    ];

  if (
    !allowed.includes(
      value,
    )
  ) {
    throw new Error(
      `MODEL_PROMOTION_STAGE_INVALID:${value}`,
    );
  }
}

export async function collectModelPromotionEvidence(
  modelId: string,
): Promise<ModelPromotionEvidenceSnapshot> {

  /* MODEL_PROMOTION_CANONICAL_EVIDENCE_READER_BINDING_V1 */
  const canonicalShadowOutcomeEvidence =
    await getCanonicalShadowOutcomeEvidence(
      modelId,
    );

  const canonicalShadowOutcomeEvidenceReady =
    canonicalShadowOutcomeEvidence.counts.total > 0 &&
    canonicalShadowOutcomeEvidence.counts.completed > 0 &&
    canonicalShadowOutcomeEvidence.completed.withReturn1d > 0 &&
    canonicalShadowOutcomeEvidence.completed.withReturn3d > 0 &&
    canonicalShadowOutcomeEvidence.completed.withReturn5d > 0;

  if (
    !modelId?.trim()
  ) {
    throw new Error(
      "MODEL_PROMOTION_MODEL_ID_REQUIRED",
    );
  }

  const model =
    await readModel(
      modelId,
    );

  assertStage(
    model.promotion_stage,
  );

  const [
    total,
    generated,
    orderCreated,
    skipped,
    failed,
    paperTrades,
  ] =
    await Promise.all([
      countSignalsByStatus(
        modelId,
      ),
      countSignalsByStatus(
        modelId,
        "GENERATED",
      ),
      countSignalsByStatus(
        modelId,
        "ORDER_CREATED",
      ),
      countSignalsByStatus(
        modelId,
        "SKIPPED",
      ),
      countSignalsByStatus(
        modelId,
        "FAILED",
      ),
      countPaperTrades(
        modelId,
      ),
    ]);

  return {
    modelId:
      model.id,
    modelName:
      model.model_name,
    modelVersion:
      model.model_version,
    legacyStatus:
      model.status,
    promotionStage:
      model.promotion_stage,
    validationTradeCount:
      toCount(
        model.validation_trade_count,
      ),
    metrics:
      model.metrics ?? {},
    metricsSource:
      model.metrics_source,
    metricsCalculatedAt:
      model.metrics_calculated_at,

    entrySignals: {
      total,
      generated,
      orderCreated,
      skipped,
      failed,
    },

    paperTrades: {
      total:
        paperTrades,
    },

    policy: {
      candidateToShadow:
        "NON_RISK_OPERATIONAL_READINESS_ONLY",
      shadowToPaper:
        "FAIL_CLOSED_UNTIL_CANONICAL_SHADOW_OUTCOME_EVIDENCE_EXISTS",
      automaticPromotion:
        false,
    },
    canonicalShadowOutcomeEvidenceReady,

  };
}

export async function evaluateModelPromotionRecommendation(
  modelId: string,
): Promise<ModelPromotionRecommendation> {
  const evidence =
    await collectModelPromotionEvidence(
      modelId,
    );

  const fromStage =
    evidence.promotionStage;

  if (
    fromStage ===
      "CANDIDATE"
  ) {
    const toStage:
      ModelPromotionStage =
      "SHADOW";

    const transition =
      evaluateModelPromotionTransition(
        fromStage,
        toStage,
      );

    if (
      !transition.allowed
    ) {
      return {
        version:
          MODEL_PROMOTION_DECISION_SERVICE_VERSION,
        modelId,
        fromStage,
        toStage,
        decision:
          "BLOCKED",
        reason:
          "INVALID_TRANSITION",
        requiresManualApproval:
          transition.requiresManualApproval,
        evidence,
        safety: {
          recommendationOnly:
            true,
          promotionStageChanged:
            false,
          realTradingChanged:
            false,
          createsOrder:
            false,
          changesPosition:
            false,
        },
      };
    }

    const ready =
      evidence
        .entrySignals
        .total >
      0;

    return {
      version:
        MODEL_PROMOTION_DECISION_SERVICE_VERSION,
      modelId,
      fromStage,
      toStage,
      decision:
        ready
          ? "RECOMMENDED"
          : "BLOCKED",
      reason:
        ready
          ? "CANDIDATE_SHADOW_SIGNAL_PIPELINE_READY"
          : "CANDIDATE_SHADOW_NO_MODEL_LINKED_SIGNALS",
      requiresManualApproval:
        transition.requiresManualApproval,
      evidence,
      safety: {
        recommendationOnly:
          true,
        promotionStageChanged:
          false,
        realTradingChanged:
          false,
        createsOrder:
          false,
        changesPosition:
          false,
      },
    };
  }

  if (
    fromStage ===
      "SHADOW"
  ) {
    const toStage:
      ModelPromotionStage =
      "PAPER";

    const transition =
      evaluateModelPromotionTransition(
        fromStage,
        toStage,
      );

    return {
      version:
        MODEL_PROMOTION_DECISION_SERVICE_VERSION,
      modelId,
      fromStage,
      toStage,
      decision:
        "BLOCKED",
      reason:
        (transition.allowed) && !evidence.canonicalShadowOutcomeEvidenceReady
          ? "SHADOW_PAPER_CANONICAL_OUTCOME_EVIDENCE_NOT_READY"
          : "INVALID_TRANSITION",
      requiresManualApproval:
        transition.requiresManualApproval,
      evidence,
      safety: {
        recommendationOnly:
          true,
        promotionStageChanged:
          false,
        realTradingChanged:
          false,
        createsOrder:
          false,
        changesPosition:
          false,
      },
    };
  }

  return {
    version:
      MODEL_PROMOTION_DECISION_SERVICE_VERSION,
    modelId,
    fromStage,
    toStage:
      null,
    decision:
      "BLOCKED",
    reason:
      "NO_SUPPORTED_RECOMMENDATION_FOR_STAGE",
    requiresManualApproval:
      false,
    evidence,
    safety: {
      recommendationOnly:
        true,
      promotionStageChanged:
        false,
      realTradingChanged:
        false,
      createsOrder:
        false,
      changesPosition:
        false,
    },
  };
}

export async function recordModelPromotionRecommendation(
  recommendation:
    ModelPromotionRecommendation,
  actor = "MODEL_PROMOTION_DECISION_SERVICE_V1",
): Promise<{
  eventId: string;
  decision:
    ModelPromotionRecommendationDecision;
}> {
  if (
    recommendation.toStage ===
      null
  ) {
    throw new Error(
      "MODEL_PROMOTION_EVENT_TARGET_STAGE_REQUIRED",
    );
  }

  const transition =
    evaluateModelPromotionTransition(
      recommendation.fromStage,
      recommendation.toStage,
    );

  if (
    !transition.allowed
  ) {
    throw new Error(
      `MODEL_PROMOTION_EVENT_INVALID_TRANSITION:${recommendation.fromStage}->${recommendation.toStage}`,
    );
  }

  const supabase =
    createSupabaseServerClient();

  const {
    data,
    error,
  } =
    await supabase
      .from(
        "model_promotion_events",
      )
      .insert({
        model_id:
          recommendation.modelId,
        from_stage:
          recommendation.fromStage,
        to_stage:
          recommendation.toStage,
        transition_kind:
          transition.kind,
        decision:
          recommendation.decision,
        requires_manual_approval:
          transition.requiresManualApproval,
        manual_approval_confirmed:
          false,
        actor,
        reason:
          recommendation.reason,
        evidence:
          recommendation.evidence,
      })
      .select(
        "id,decision",
      )
      .single();

  if (
    error ||
    !data
  ) {
    throw new Error(
      `MODEL_PROMOTION_EVENT_WRITE_FAILED:${
        error?.message ??
        "NO_EVENT_ROW"
      }`,
    );
  }

  /*
   * Intentionally DO NOT update ai_model_versions.promotion_stage.
   * Event recording is recommendation/audit only.
   */
  return {
    eventId:
      data.id,
    decision:
      data.decision as
        ModelPromotionRecommendationDecision,
  };
}
