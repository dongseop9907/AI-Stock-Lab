
import {
  createSupabaseServerClient,
} from "@/lib/supabase";

import {
  evaluateModelPromotionRecommendation,
  recordModelPromotionRecommendation,
} from "@/lib/models/model-promotion-decision-service";

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

async function getShadowModel() {
  const supabase =
    createSupabaseServerClient();

  const {
    data,
    error,
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
    error ||
    !data
  ) {
    throw new Error(
      "ENTRY_TIMING_SHADOW_MODEL_NOT_FOUND:" +
      (
        error?.message ??
        "NO_MODEL"
      ),
    );
  }

  return data;
}

async function getModelById(
  modelId: string,
) {
  const supabase =
    createSupabaseServerClient();

  const {
    data,
    error,
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
        modelId,
      )
      .single();

  if (
    error ||
    !data
  ) {
    throw new Error(
      "MODEL_READ_FAILED:" +
      (
        error?.message ??
        "NO_MODEL"
      ),
    );
  }

  return data;
}

async function main() {
  const supabase =
    createSupabaseServerClient();

  const model =
    await getShadowModel();

  const actor =
    "MODEL_PROMOTION_BLOCKED_RECORD_POSITIVE_PATH_V1_" +
    Date.now();

  let cleanupAttempted =
    false;

  let cleanupDeleted =
    0;

  const before = {
    promotionEvents:
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

    model:
      await getModelById(
        model.id,
      ),
  };

  try {
    const recommendation =
      await evaluateModelPromotionRecommendation(
        model.id,
      );

    if (
      recommendation.decision !==
        "BLOCKED"
    ) {
      throw new Error(
        "EXPECTED_BLOCKED_RECOMMENDATION:" +
        recommendation.decision,
      );
    }

    if (
      recommendation.reason !==
        "SHADOW_PAPER_CANONICAL_OUTCOME_EVIDENCE_NOT_READY"
    ) {
      throw new Error(
        "EXPECTED_CANONICAL_NOT_READY_REASON:" +
        recommendation.reason,
      );
    }

    const recordResult =
      await recordModelPromotionRecommendation(
        recommendation,
        actor,
      );

    const afterInsertCount =
      await countRows(
        "model_promotion_events",
      );

    const {
      data: insertedRows,
      error:
        insertedRowsError,
    } =
      await supabase
        .from(
          "model_promotion_events",
        )
        .select(
          "id,model_id,from_stage,to_stage,decision,actor,reason,created_at"
        )
        .eq(
          "model_id",
          model.id,
        )
        .eq(
          "actor",
          actor,
        )
        .order(
          "created_at",
          {
            ascending:
              false,
          },
        );

    if (insertedRowsError) {
      throw new Error(
        "RECORDED_EVENT_READ_FAILED:" +
        insertedRowsError.message,
      );
    }

    const inserted =
      insertedRows ?? [];

    const insertedEvent =
      inserted[0] ??
      null;

    const afterInsertModel =
      await getModelById(
        model.id,
      );

    const afterInsertOrders =
      await countRows(
        "paper_order_requests",
      );

    const afterInsertPositions =
      await countRows(
        "paper_positions",
      );

    const afterInsertControls =
      await getControls();

    const checksBeforeCleanup = {
      recommendationBlocked:
        recommendation.decision ===
        "BLOCKED",

      recommendationReasonCorrect:
        recommendation.reason ===
        "SHADOW_PAPER_CANONICAL_OUTCOME_EVIDENCE_NOT_READY",

      onePromotionEventAdded:
        afterInsertCount ===
        before.promotionEvents +
          1,

      exactlyOneActorEventFound:
        inserted.length ===
        1,

      recordedEventMatchesModel:
        insertedEvent?.model_id ===
        model.id,

      recordedEventIsBlocked:
        insertedEvent?.decision ===
        "BLOCKED",

      recordedEventReasonCorrect:
        insertedEvent?.reason ===
        "SHADOW_PAPER_CANONICAL_OUTCOME_EVIDENCE_NOT_READY",

      recordedEventActorMatches:
        insertedEvent?.actor ===
        actor,

      modelStageUnchangedAfterRecord:
        afterInsertModel
          .promotion_stage ===
        before.model
          .promotion_stage,

      modelStageTimestampUnchangedAfterRecord:
        afterInsertModel
          .promotion_stage_updated_at ===
        before.model
          .promotion_stage_updated_at,

      noOrdersCreated:
        afterInsertOrders ===
        before.orders,

      noPositionsChanged:
        afterInsertPositions ===
        before.positions,

      controlsUnchanged:
        JSON.stringify(
          afterInsertControls,
        ) ===
        JSON.stringify(
          before.controls,
        ),

      realTradingStillOff:
        afterInsertControls
          ?.real_order_enabled ===
        false,
    };

    const failedBeforeCleanup =
      Object.entries(
        checksBeforeCleanup,
      )
        .filter(
          ([, value]) =>
            !value,
        )
        .map(
          ([key]) =>
            key,
        );

    cleanupAttempted =
      true;

    const {
      data: deletedRows,
      error:
        deleteError,
    } =
      await supabase
        .from(
          "model_promotion_events",
        )
        .delete()
        .eq(
          "model_id",
          model.id,
        )
        .eq(
          "actor",
          actor,
        )
        .select("id");

    if (deleteError) {
      throw new Error(
        "PROMOTION_EVENT_CLEANUP_FAILED:" +
        deleteError.message,
      );
    }

    cleanupDeleted =
      deletedRows?.length ??
      0;

    const final = {
      promotionEvents:
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

      model:
        await getModelById(
          model.id,
        ),
    };

    const {
      data:
        remainingRows,
      error:
        remainingError,
    } =
      await supabase
        .from(
          "model_promotion_events",
        )
        .select("id")
        .eq(
          "model_id",
          model.id,
        )
        .eq(
          "actor",
          actor,
        );

    if (remainingError) {
      throw new Error(
        "CLEANUP_VERIFY_READ_FAILED:" +
        remainingError.message,
      );
    }

    const cleanupChecks = {
      cleanupDeletedExactlyOne:
        cleanupDeleted ===
        1,

      noActorRowsRemain:
        (
          remainingRows?.length ??
          0
        ) ===
        0,

      promotionEventCountRestored:
        final.promotionEvents ===
        before.promotionEvents,

      ordersStillUnchanged:
        final.orders ===
        before.orders,

      positionsStillUnchanged:
        final.positions ===
        before.positions,

      modelStageStillUnchanged:
        final.model
          .promotion_stage ===
        before.model
          .promotion_stage,

      modelStageTimestampStillUnchanged:
        final.model
          .promotion_stage_updated_at ===
        before.model
          .promotion_stage_updated_at,

      controlsStillUnchanged:
        JSON.stringify(
          final.controls,
        ) ===
        JSON.stringify(
          before.controls,
        ),

      realTradingStillOff:
        final.controls
          ?.real_order_enabled ===
        false,
    };

    const failedCleanup =
      Object.entries(
        cleanupChecks,
      )
        .filter(
          ([, value]) =>
            !value,
        )
        .map(
          ([key]) =>
            key,
        );

    const failed = [
      ...failedBeforeCleanup,
      ...failedCleanup,
    ];

    const report = {
      status:
        failed.length ===
        0
          ? "MODEL_PROMOTION_BLOCKED_RECOMMENDATION_RECORD_POSITIVE_PATH_V1_VERIFIED"
          : "MODEL_PROMOTION_BLOCKED_RECOMMENDATION_RECORD_POSITIVE_PATH_V1_FAILED",

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
          before.model
            .promotion_stage,

        promotionStageUpdatedAt:
          before.model
            .promotion_stage_updated_at,
      },

      recommendation: {
        decision:
          recommendation
            .decision,

        reason:
          recommendation
            .reason,

        fromStage:
          recommendation
            .fromStage,

        toStage:
          recommendation
            .toStage,

        requiresManualApproval:
          recommendation
            .requiresManualApproval,
      },

      recording: {
        actor,

        result:
          recordResult,

        insertedEvent,

        eventCount:
          String(
            before.promotionEvents,
          ) +
          "->" +
          String(
            afterInsertCount,
          ) +
          "->" +
          String(
            final.promotionEvents,
          ),
      },

      checksBeforeCleanup,

      cleanup: {
        attempted:
          cleanupAttempted,

        deleted:
          cleanupDeleted,

        checks:
          cleanupChecks,
      },

      failed,

      safety: {
        allowedDatabaseWrites: [
          "model_promotion_events insert of one isolated BLOCKED recommendation",
          "delete same isolated event during cleanup"
        ],

        modelStageChanged:
          final.model
            .promotion_stage !==
          before.model
            .promotion_stage,

        ordersCreated:
          final.orders -
          before.orders,

        positionsChanged:
          final.positions -
          before.positions,

        controlsChanged:
          JSON.stringify(
            final.controls,
          ) !==
          JSON.stringify(
            before.controls,
          ),

        realTradingEnabledByScript:
          false,
      },

      nextGate:
        failed.length ===
        0
          ? "KEEP_SHADOW_WAIT_FOR_REAL_SIGNAL_AND_AUDIT_PAPER_PROMOTION_APPLY_BOUNDARY"
          : "STOP_AND_INSPECT_BLOCKED_RECOMMENDATION_RECORD_OR_CLEANUP_FAILURE",
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
  } catch (error) {
    if (
      !cleanupAttempted
    ) {
      cleanupAttempted =
        true;

      try {
        const {
          data:
            deletedRows,
        } =
          await supabase
            .from(
              "model_promotion_events",
            )
            .delete()
            .eq(
              "model_id",
              model.id,
            )
            .eq(
              "actor",
              actor,
            )
            .select("id");

        cleanupDeleted =
          deletedRows?.length ??
          0;
      } catch {
        // Report original failure below.
      }
    }

    throw error;
  }
}

main().catch(
  (error) => {
    console.error(
      JSON.stringify(
        {
          status:
            "MODEL_PROMOTION_BLOCKED_RECOMMENDATION_RECORD_POSITIVE_PATH_V1_FAILED",

          error:
            error instanceof Error
              ? error.message
              : String(error),

          safety: {
            promotionApply:
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
