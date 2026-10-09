import {
  createSupabaseServerClient,
} from "@/lib/supabase";

export const MODEL_SHADOW_OUTCOME_STORAGE_VERSION =
  "MODEL_SHADOW_OUTCOME_CANONICAL_STORAGE_V1" as const;

export type ShadowOutcomeEvaluationStatus =
  | "PENDING"
  | "PARTIAL"
  | "COMPLETED"
  | "EXPIRED"
  | "INVALID";

export interface ShadowOutcomeEvaluationPatch {
  signalId: string;
  evaluationStatus: ShadowOutcomeEvaluationStatus;

  entryOpenPrice?: number | null;

  return1d?: number | null;
  return3d?: number | null;
  return5d?: number | null;

  maxReturn1d?: number | null;
  maxReturn3d?: number | null;
  maxReturn5d?: number | null;

  minReturn1d?: number | null;
  minReturn3d?: number | null;
  minReturn5d?: number | null;

  evaluated1dAt?: string | null;
  evaluated3dAt?: string | null;
  evaluated5dAt?: string | null;
  evaluatedAt?: string | null;

  expiresAt?: string | null;

  evidence?: Record<string, unknown>;
}

export interface CanonicalShadowOutcomeEvidence {
  modelId: string;
  promotionStage: string;

  shadowStartedAt: string | null;

  counts: {
    total: number;
    pending: number;
    partial: number;
    completed: number;
    expired: number;
    invalid: number;
  };

  completed: {
    withReturn1d: number;
    withReturn3d: number;
    withReturn5d: number;
  };

  safety: {
    postShadowOnly: true;
    historicalSignalsBackfilled: false;
    paperPromotionApplied: false;
  };
}

function assertFiniteOrNull(
  value: number | null | undefined,
  label: string,
) {
  if (
    value !== null &&
    value !== undefined &&
    !Number.isFinite(value)
  ) {
    throw new Error(
      `SHADOW_OUTCOME_NON_FINITE:${label}`,
    );
  }
}

export async function seedCanonicalShadowOutcomeForSignal(
  signalId: string,
): Promise<{
  inserted: boolean;
  outcomeId: string;
}> {
  if (!signalId?.trim()) {
    throw new Error(
      "SHADOW_OUTCOME_SIGNAL_ID_REQUIRED",
    );
  }

  const supabase =
    createSupabaseServerClient();

  const {
    data: signal,
    error: signalError,
  } =
    await supabase
      .from("ai_entry_signals")
      .select(`
        id,
        model_id,
        stock_code,
        observed_at,
        recommended_entry_price,
        recommended_stop_price,
        created_at
      `)
      .eq("id", signalId)
      .single();

  if (
    signalError ||
    !signal
  ) {
    throw new Error(
      `SHADOW_OUTCOME_SIGNAL_LOOKUP_FAILED:${
        signalError?.message ??
        "NOT_FOUND"
      }`,
    );
  }

  const {
    data: model,
    error: modelError,
  } =
    await supabase
      .from("ai_model_versions")
      .select(`
        id,
        promotion_stage,
        promotion_stage_updated_at
      `)
      .eq("id", signal.model_id)
      .single();

  if (
    modelError ||
    !model
  ) {
    throw new Error(
      `SHADOW_OUTCOME_MODEL_LOOKUP_FAILED:${
        modelError?.message ??
        "NOT_FOUND"
      }`,
    );
  }

  if (
    model.promotion_stage !==
      "SHADOW"
  ) {
    throw new Error(
      `SHADOW_OUTCOME_CAPTURE_REQUIRES_SHADOW_STAGE:${model.promotion_stage}`,
    );
  }

  if (
    !model.promotion_stage_updated_at
  ) {
    throw new Error(
      "SHADOW_OUTCOME_PROMOTION_TIMESTAMP_REQUIRED",
    );
  }

  const signalCreatedAt =
    Date.parse(
      signal.created_at,
    );

  const shadowStartedAt =
    Date.parse(
      model.promotion_stage_updated_at,
    );

  if (
    !Number.isFinite(signalCreatedAt) ||
    !Number.isFinite(shadowStartedAt)
  ) {
    throw new Error(
      "SHADOW_OUTCOME_INVALID_CAPTURE_TIMESTAMPS",
    );
  }

  if (
    signalCreatedAt <
      shadowStartedAt
  ) {
    throw new Error(
      "SHADOW_OUTCOME_HISTORICAL_SIGNAL_BACKFILL_BLOCKED",
    );
  }

  const {
    data: existing,
    error: existingError,
  } =
    await supabase
      .from(
        "model_shadow_signal_outcomes",
      )
      .select("id")
      .eq(
        "signal_id",
        signalId,
      )
      .maybeSingle();

  if (existingError) {
    throw new Error(
      `SHADOW_OUTCOME_EXISTING_LOOKUP_FAILED:${existingError.message}`,
    );
  }

  if (existing) {
    return {
      inserted: false,
      outcomeId:
        existing.id,
    };
  }

  const {
    data,
    error,
  } =
    await supabase
      .from(
        "model_shadow_signal_outcomes",
      )
      .insert({
        signal_id:
          signal.id,
        model_id:
          signal.model_id,
        stock_code:
          signal.stock_code,
        signal_observed_at:
          signal.observed_at,
        captured_at:
          signal.created_at,
        promotion_stage_at_capture:
          "SHADOW",
        promotion_stage_updated_at_at_capture:
          model.promotion_stage_updated_at,
        recommended_entry_price:
          signal.recommended_entry_price,
        recommended_stop_price:
          signal.recommended_stop_price,
        evaluation_status:
          "PENDING",
        evidence: {
          source:
            "ai_entry_signals",
          capturedAfterShadowPromotion:
            true,
        },
      })
      .select("id")
      .single();

  if (
    error ||
    !data
  ) {
    throw new Error(
      `SHADOW_OUTCOME_INSERT_FAILED:${
        error?.message ??
        "NO_ROW"
      }`,
    );
  }

  return {
    inserted: true,
    outcomeId:
      data.id,
  };
}

export async function updateCanonicalShadowOutcomeEvaluation(
  patch: ShadowOutcomeEvaluationPatch,
): Promise<void> {
  if (!patch.signalId?.trim()) {
    throw new Error(
      "SHADOW_OUTCOME_SIGNAL_ID_REQUIRED",
    );
  }

  assertFiniteOrNull(
    patch.entryOpenPrice,
    "entryOpenPrice",
  );

  assertFiniteOrNull(
    patch.return1d,
    "return1d",
  );
  assertFiniteOrNull(
    patch.return3d,
    "return3d",
  );
  assertFiniteOrNull(
    patch.return5d,
    "return5d",
  );

  assertFiniteOrNull(
    patch.maxReturn1d,
    "maxReturn1d",
  );
  assertFiniteOrNull(
    patch.maxReturn3d,
    "maxReturn3d",
  );
  assertFiniteOrNull(
    patch.maxReturn5d,
    "maxReturn5d",
  );

  assertFiniteOrNull(
    patch.minReturn1d,
    "minReturn1d",
  );
  assertFiniteOrNull(
    patch.minReturn3d,
    "minReturn3d",
  );
  assertFiniteOrNull(
    patch.minReturn5d,
    "minReturn5d",
  );

  const update: Record<string, unknown> = {
    evaluation_status:
      patch.evaluationStatus,
  };

  const optionalMap: Array<
    [
      keyof ShadowOutcomeEvaluationPatch,
      string
    ]
  > = [
    [
      "entryOpenPrice",
      "entry_open_price",
    ],
    [
      "return1d",
      "return_1d",
    ],
    [
      "return3d",
      "return_3d",
    ],
    [
      "return5d",
      "return_5d",
    ],
    [
      "maxReturn1d",
      "max_return_1d",
    ],
    [
      "maxReturn3d",
      "max_return_3d",
    ],
    [
      "maxReturn5d",
      "max_return_5d",
    ],
    [
      "minReturn1d",
      "min_return_1d",
    ],
    [
      "minReturn3d",
      "min_return_3d",
    ],
    [
      "minReturn5d",
      "min_return_5d",
    ],
    [
      "evaluated1dAt",
      "evaluated_1d_at",
    ],
    [
      "evaluated3dAt",
      "evaluated_3d_at",
    ],
    [
      "evaluated5dAt",
      "evaluated_5d_at",
    ],
    [
      "evaluatedAt",
      "evaluated_at",
    ],
    [
      "expiresAt",
      "expires_at",
    ],
  ];

  for (
    const [
      inputKey,
      dbKey,
    ] of optionalMap
  ) {
    if (
      Object.prototype
        .hasOwnProperty
        .call(
          patch,
          inputKey,
        )
    ) {
      update[dbKey] =
        patch[inputKey];
    }
  }

  if (patch.evidence) {
    update.evidence =
      patch.evidence;
  }

  const supabase =
    createSupabaseServerClient();

  const {
    error,
  } =
    await supabase
      .from(
        "model_shadow_signal_outcomes",
      )
      .update(update)
      .eq(
        "signal_id",
        patch.signalId,
      );

  if (error) {
    throw new Error(
      `SHADOW_OUTCOME_UPDATE_FAILED:${error.message}`,
    );
  }
}

async function countByStatus(
  modelId: string,
  status?: ShadowOutcomeEvaluationStatus,
): Promise<number> {
  const supabase =
    createSupabaseServerClient();

  let query =
    supabase
      .from(
        "model_shadow_signal_outcomes",
      )
      .select("*", {
        count: "exact",
        head: true,
      })
      .eq(
        "model_id",
        modelId,
      )
      .eq(
        "promotion_stage_at_capture",
        "SHADOW",
      );

  if (status) {
    query =
      query.eq(
        "evaluation_status",
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
      `SHADOW_OUTCOME_COUNT_FAILED:${
        status ??
        "ALL"
      }:${error.message}`,
    );
  }

  return count ?? 0;
}

async function countCompletedWithColumn(
  modelId: string,
  column:
    | "return_1d"
    | "return_3d"
    | "return_5d",
): Promise<number> {
  const supabase =
    createSupabaseServerClient();

  const {
    count,
    error,
  } =
    await supabase
      .from(
        "model_shadow_signal_outcomes",
      )
      .select("*", {
        count: "exact",
        head: true,
      })
      .eq(
        "model_id",
        modelId,
      )
      .eq(
        "promotion_stage_at_capture",
        "SHADOW",
      )
      .eq(
        "evaluation_status",
        "COMPLETED",
      )
      .not(
        column,
        "is",
        null,
      );

  if (error) {
    throw new Error(
      `SHADOW_OUTCOME_COMPLETED_COUNT_FAILED:${column}:${error.message}`,
    );
  }

  return count ?? 0;
}

export async function getCanonicalShadowOutcomeEvidence(
  modelId: string,
): Promise<CanonicalShadowOutcomeEvidence> {
  const supabase =
    createSupabaseServerClient();

  const {
    data: model,
    error: modelError,
  } =
    await supabase
      .from("ai_model_versions")
      .select(`
        id,
        promotion_stage,
        promotion_stage_updated_at
      `)
      .eq("id", modelId)
      .single();

  if (
    modelError ||
    !model
  ) {
    throw new Error(
      `SHADOW_OUTCOME_MODEL_LOOKUP_FAILED:${
        modelError?.message ??
        "NOT_FOUND"
      }`,
    );
  }

  const [
    total,
    pending,
    partial,
    completed,
    expired,
    invalid,
    withReturn1d,
    withReturn3d,
    withReturn5d,
  ] =
    await Promise.all([
      countByStatus(
        modelId,
      ),
      countByStatus(
        modelId,
        "PENDING",
      ),
      countByStatus(
        modelId,
        "PARTIAL",
      ),
      countByStatus(
        modelId,
        "COMPLETED",
      ),
      countByStatus(
        modelId,
        "EXPIRED",
      ),
      countByStatus(
        modelId,
        "INVALID",
      ),
      countCompletedWithColumn(
        modelId,
        "return_1d",
      ),
      countCompletedWithColumn(
        modelId,
        "return_3d",
      ),
      countCompletedWithColumn(
        modelId,
        "return_5d",
      ),
    ]);

  return {
    modelId,
    promotionStage:
      model.promotion_stage,
    shadowStartedAt:
      model.promotion_stage_updated_at,

    counts: {
      total,
      pending,
      partial,
      completed,
      expired,
      invalid,
    },

    completed: {
      withReturn1d,
      withReturn3d,
      withReturn5d,
    },

    safety: {
      postShadowOnly:
        true,
      historicalSignalsBackfilled:
        false,
      paperPromotionApplied:
        false,
    },
  };
}
