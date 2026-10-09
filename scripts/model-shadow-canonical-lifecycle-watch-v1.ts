
import fs from "fs";
import path from "path";

import {
  createSupabaseServerClient,
} from "@/lib/supabase";

import {
  evaluateModelPromotionRecommendation,
} from "@/lib/models/model-promotion-decision-service";

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

function pick(
  row: Record<string, unknown> | null,
  keys: string[],
) {
  if (!row) {
    return null;
  }

  const out:
    Record<string, unknown> = {};

  for (const key of keys) {
    if (
      Object.prototype.hasOwnProperty.call(
        row,
        key,
      )
    ) {
      out[key] =
        row[key];
    }
  }

  return out;
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
        "id,model_name,model_version,purpose,status,promotion_stage,promotion_stage_updated_at"
      )
      .eq(
        "purpose",
        "ENTRY_TIMING",
      )
      .eq(
        "promotion_stage",
        "SHADOW",
      )
      .order(
        "promotion_stage_updated_at",
        {
          ascending:
            false,
        },
      )
      .limit(1)
      .maybeSingle();

  if (
    modelError ||
    !model
  ) {
    throw new Error(
      "ENTRY_TIMING_SHADOW_MODEL_NOT_FOUND:" +
      (
        modelError?.message ??
        "NO_MODEL"
      ),
    );
  }

  if (
    !model.promotion_stage_updated_at
  ) {
    throw new Error(
      "SHADOW_STAGE_TIMESTAMP_MISSING",
    );
  }

  const before = {
    signals:
      await countRows(
        "ai_entry_signals",
      ),

    canonicalRows:
      await countRows(
        "model_shadow_signal_outcomes",
      ),

    orders:
      await countRows(
        "paper_order_requests",
      ),

    positions:
      await countRows(
        "paper_positions",
      ),

    promotionEvents:
      await countRows(
        "model_promotion_events",
      ),

    controls:
      await getControls(),
  };

  const {
    data: signals,
    error: signalError,
  } =
    await supabase
      .from(
        "ai_entry_signals",
      )
      .select("*")
      .eq(
        "model_id",
        model.id,
      )
      .gte(
        "created_at",
        model
          .promotion_stage_updated_at,
      )
      .order(
        "created_at",
        {
          ascending:
            true,
        },
      )
      .limit(20);

  if (signalError) {
    throw new Error(
      "POST_SHADOW_SIGNAL_READ_FAILED:" +
      signalError.message,
    );
  }

  const postShadowSignals =
    signals ?? [];

  const firstSignal =
    postShadowSignals[0] ??
    null;

  let canonical:
    Record<string, unknown> |
    null =
      null;

  if (firstSignal) {
    const {
      data,
      error,
    } =
      await supabase
        .from(
          "model_shadow_signal_outcomes",
        )
        .select("*")
        .eq(
          "signal_id",
          firstSignal.id,
        )
        .maybeSingle();

    if (error) {
      throw new Error(
        "CANONICAL_OUTCOME_READ_FAILED:" +
        error.message,
      );
    }

    canonical =
      (data ??
        null) as
        Record<string, unknown> |
        null;
  }

  const recommendation =
    await evaluateModelPromotionRecommendation(
      model.id,
    );

  const after = {
    signals:
      await countRows(
        "ai_entry_signals",
      ),

    canonicalRows:
      await countRows(
        "model_shadow_signal_outcomes",
      ),

    orders:
      await countRows(
        "paper_order_requests",
      ),

    positions:
      await countRows(
        "paper_positions",
      ),

    promotionEvents:
      await countRows(
        "model_promotion_events",
      ),

    controls:
      await getControls(),
  };

  const controlsUnchanged =
    JSON.stringify(
      before.controls,
    ) ===
    JSON.stringify(
      after.controls,
    );

  const countsUnchanged =
    before.signals ===
      after.signals &&
    before.canonicalRows ===
      after.canonicalRows &&
    before.orders ===
      after.orders &&
    before.positions ===
      after.positions &&
    before.promotionEvents ===
      after.promotionEvents;

  const canonicalStatus =
    canonical &&
    typeof canonical
      .evaluation_status ===
      "string"
      ? canonical
          .evaluation_status
      : null;

  const lifecycle = {
    hasPostShadowSignal:
      Boolean(
        firstSignal,
      ),

    canonicalExists:
      Boolean(
        canonical,
      ),

    evaluationStatus:
      canonicalStatus,

    isPending:
      canonicalStatus ===
      "PENDING",

    isPartial:
      canonicalStatus ===
      "PARTIAL",

    isCompleted:
      canonicalStatus ===
      "COMPLETED",

    canonicalEvidenceReady:
      recommendation
        .evidence
        .canonicalShadowOutcomeEvidenceReady ===
      true,

    promotionDecision:
      recommendation
        .decision,

    promotionReason:
      recommendation
        .reason,
  };

  let status:
    string;

  let nextGate:
    string;

  let exitCode =
    0;

  if (!firstSignal) {
    status =
      "MODEL_SHADOW_CANONICAL_LIFECYCLE_WATCH_V1_WAITING_FOR_SIGNAL";

    nextGate =
      "WAIT_FOR_FIRST_REAL_POST_SHADOW_SIGNAL";
  } else if (!canonical) {
    status =
      "MODEL_SHADOW_CANONICAL_LIFECYCLE_WATCH_V1_CAPTURE_GAP";

    nextGate =
      "INVESTIGATE_REAL_SIGNAL_TO_CANONICAL_CAPTURE_BINDING";

    exitCode =
      1;
  } else if (
    canonicalStatus ===
      "PENDING" ||
    canonicalStatus ===
      "PARTIAL"
  ) {
    status =
      "MODEL_SHADOW_CANONICAL_LIFECYCLE_WATCH_V1_OBSERVING";

    nextGate =
      "WAIT_FOR_CANONICAL_OUTCOME_MATURITY";
  } else if (
    canonicalStatus ===
      "COMPLETED"
  ) {
    status =
      "MODEL_SHADOW_CANONICAL_LIFECYCLE_WATCH_V1_FIRST_OUTCOME_COMPLETED";

    nextGate =
      lifecycle
        .canonicalEvidenceReady
        ? "VERIFY_MANUAL_PAPER_PROMOTION_READY_POSITIVE_PATH"
        : "CONTINUE_COLLECTING_CANONICAL_SHADOW_EVIDENCE";
  } else {
    status =
      "MODEL_SHADOW_CANONICAL_LIFECYCLE_WATCH_V1_REVIEW_REQUIRED";

    nextGate =
      "INSPECT_CANONICAL_OUTCOME_STATUS";

    exitCode =
      1;
  }

  const safetyChecks = {
    currentModelStillShadow:
      model.promotion_stage ===
      "SHADOW",

    probeMadeNoChanges:
      countsUnchanged,

    controlsUnchanged,

    realTradingStillOff:
      after.controls
        ?.real_order_enabled ===
      false,
  };

  const failed =
    Object.entries(
      safetyChecks,
    )
      .filter(
        ([, value]) =>
          !value,
      )
      .map(
        ([key]) =>
          key,
      );

  if (
    failed.length >
    0
  ) {
    status =
      "MODEL_SHADOW_CANONICAL_LIFECYCLE_WATCH_V1_FAILED";

    nextGate =
      "STOP_AND_INSPECT_READ_ONLY_SAFETY_FAILURE";

    exitCode =
      1;
  }

  const report = {
    status,

    model: {
      id:
        model.id,

      name:
        model.model_name,

      version:
        model.model_version,

      purpose:
        model.purpose,

      legacyStatus:
        model.status,

      promotionStage:
        model.promotion_stage,

      shadowStartedAt:
        model
          .promotion_stage_updated_at,
    },

    postShadowSignals: {
      count:
        postShadowSignals.length,

      first:
        firstSignal
          ? pick(
              firstSignal as
                Record<string, unknown>,
              [
                "id",
                "model_id",
                "stock_code",
                "status",
                "observed_at",
                "created_at",
                "recommended_entry_price",
                "recommended_stop_price",
              ],
            )
          : null,
    },

    canonicalOutcome:
      canonical
        ? pick(
            canonical,
            [
              "id",
              "signal_id",
              "model_id",
              "stock_code",
              "signal_observed_at",
              "captured_at",
              "promotion_stage_at_capture",
              "evaluation_status",
              "return_1d",
              "return_3d",
              "return_5d",
              "return1d",
              "return3d",
              "return5d",
              "max_return_1d",
              "max_return_3d",
              "max_return_5d",
              "min_return_1d",
              "min_return_3d",
              "min_return_5d",
              "evaluated_at",
              "updated_at",
            ],
          )
        : null,

    lifecycle,

    recommendation: {
      decision:
        recommendation
          .decision,

      reason:
        recommendation
          .reason,

      canonicalEvidenceReady:
        recommendation
          .evidence
          .canonicalShadowOutcomeEvidenceReady,
    },

    counts: {
      signals:
        String(
          before.signals,
        ) +
        "->" +
        String(
          after.signals,
        ),

      canonicalRows:
        String(
          before.canonicalRows,
        ) +
        "->" +
        String(
          after.canonicalRows,
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

      promotionEvents:
        String(
          before.promotionEvents,
        ) +
        "->" +
        String(
          after.promotionEvents,
        ),
    },

    controls: {
      before:
        before.controls,

      after:
        after.controls,
    },

    checks:
      safetyChecks,

    failed,

    safety: {
      databaseReadsOnly:
        true,

      databaseWrites:
        0,

      syntheticSignalCreated:
        false,

      historicalBackfill:
        false,

      promotionApplyExecuted:
        false,

      ordersCreated:
        after.orders -
        before.orders,

      positionsChanged:
        after.positions -
        before.positions,

      controlsChanged:
        !controlsUnchanged,

      realTradingEnabledByScript:
        false,
    },

    nextGate,
  };

  fs.mkdirSync(
    path.join(
      ROOT,
      "logs",
    ),
    {
      recursive:
        true,
    },
  );

  fs.writeFileSync(
    path.join(
      ROOT,
      "logs",
      "model-shadow-canonical-lifecycle-watch-v1.json",
    ),
    JSON.stringify(
      report,
      null,
      2,
    ),
    "utf8",
  );

  console.log(
    JSON.stringify(
      report,
      null,
      2,
    ),
  );

  process.exitCode =
    exitCode;
}

main().catch(
  (error) => {
    console.error(
      JSON.stringify(
        {
          status:
            "MODEL_SHADOW_CANONICAL_LIFECYCLE_WATCH_V1_FAILED",

          error:
            error instanceof Error
              ? error.message
              : String(error),

          safety: {
            databaseWrites:
              0,

            syntheticSignalCreated:
              false,

            promotionApplyExecuted:
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
        },
        null,
        2,
      ),
    );

    process.exitCode =
      1;
  },
);
