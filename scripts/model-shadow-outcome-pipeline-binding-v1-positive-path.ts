import {
  createSupabaseServerClient,
} from "../lib/supabase";

import {
  syncCanonicalShadowOutcomeFromEntrySignalsV1,
} from "../lib/models/model-shadow-outcome-pipeline-binding";

const MODEL_ID =
  "3045646b-599b-41cd-9650-43e539fb7a95";

const STOCK_CODE =
  "005930";

const TEST_MARKER =
  "MODEL_SHADOW_OUTCOME_PIPELINE_BINDING_V1_POSITIVE_PATH";

async function countTable(
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
        count: "exact",
        head: true,
      });

  if (error) {
    throw new Error(
      `COUNT_FAILED:${table}:${error.message}`,
    );
  }

  return count ?? 0;
}

async function readModel() {
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
        purpose,
        status,
        promotion_stage,
        promotion_stage_updated_at
      `)
      .eq("id", MODEL_ID)
      .single();

  if (
    error ||
    !data
  ) {
    throw new Error(
      `MODEL_READ_FAILED:${
        error?.message ??
        "NOT_FOUND"
      }`,
    );
  }

  return data;
}

async function readControls() {
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
        "emergency_stop,automation_enabled,paper_order_enabled,real_order_enabled",
      )
      .eq(
        "control_key",
        "global",
      )
      .single();

  if (
    error ||
    !data
  ) {
    throw new Error(
      `CONTROL_READ_FAILED:${
        error?.message ??
        "NOT_FOUND"
      }`,
    );
  }

  return data;
}

function sameControls(
  a: any,
  b: any,
) {
  return (
    a?.emergency_stop ===
      b?.emergency_stop &&
    a?.automation_enabled ===
      b?.automation_enabled &&
    a?.paper_order_enabled ===
      b?.paper_order_enabled &&
    a?.real_order_enabled ===
      b?.real_order_enabled
  );
}

async function readCanonical(
  signalId: string,
) {
  const supabase =
    createSupabaseServerClient();

  const {
    data,
    error,
  } =
    await supabase
      .from(
        "model_shadow_signal_outcomes",
      )
      .select(`
        id,
        signal_id,
        model_id,
        stock_code,
        promotion_stage_at_capture,
        promotion_stage_updated_at_at_capture,
        evaluation_status,
        entry_open_price,
        return_1d,
        return_3d,
        return_5d,
        max_return_1d,
        max_return_3d,
        max_return_5d,
        min_return_1d,
        min_return_3d,
        min_return_5d,
        evaluated_1d_at,
        evaluated_3d_at,
        evaluated_5d_at,
        evaluated_at,
        evidence,
        source_version
      `)
      .eq(
        "signal_id",
        signalId,
      )
      .maybeSingle();

  if (error) {
    throw new Error(
      `CANONICAL_READ_FAILED:${error.message}`,
    );
  }

  return data;
}

async function deleteSignal(
  signalId: string,
) {
  const supabase =
    createSupabaseServerClient();

  const {
    error,
  } =
    await supabase
      .from(
        "ai_entry_signals",
      )
      .delete()
      .eq(
        "id",
        signalId,
      );

  if (error) {
    throw new Error(
      `TEST_SIGNAL_CLEANUP_FAILED:${error.message}`,
    );
  }
}

async function main() {
  const model =
    await readModel();

  if (
    model.promotion_stage !==
      "SHADOW"
  ) {
    throw new Error(
      `MODEL_NOT_SHADOW:${model.promotion_stage}`,
    );
  }

  if (
    model.purpose !==
      "ENTRY_TIMING"
  ) {
    throw new Error(
      `MODEL_PURPOSE_NOT_ENTRY_TIMING:${model.purpose}`,
    );
  }

  const beforeControls =
    await readControls();

  if (
    beforeControls.real_order_enabled !==
      false
  ) {
    throw new Error(
      "REAL_TRADING_MUST_BE_OFF",
    );
  }

  const [
    beforeSignals,
    beforeCanonical,
    beforeOrders,
    beforePositions,
    beforeEvents,
  ] =
    await Promise.all([
      countTable(
        "ai_entry_signals",
      ),
      countTable(
        "model_shadow_signal_outcomes",
      ),
      countTable(
        "paper_order_requests",
      ),
      countTable(
        "paper_positions",
      ),
      countTable(
        "model_promotion_events",
      ),
    ]);

  const supabase =
    createSupabaseServerClient();

  let signalId:
    | string
    | null = null;

  let cleanupError:
    | string
    | null = null;

  let canonicalAfterInsert:
    any = null;

  let canonicalAfterSync:
    any = null;

  let syncResult:
    any = null;

  try {
    const now =
      new Date();

    const {
      data: insertedSignal,
      error: insertError,
    } =
      await supabase
        .from(
          "ai_entry_signals",
        )
        .insert({
          model_id:
            MODEL_ID,
          stock_code:
            STOCK_CODE,
          observed_at:
            now.toISOString(),
          status:
            "SKIPPED",
          score:
            0,
          recommended_entry_price:
            100000,
          recommended_stop_price:
            97000,
          recommended_quantity:
            1,
          features: {
            testMarker:
              TEST_MARKER,
            synthetic:
              true,
            canonicalBindingPositivePath:
              true,
          },
          reasons: [
            "ISOLATED_SHADOW_CANONICAL_BINDING_TEST_NO_ORDER",
          ],
          order_id:
            null,
          error_message:
            null,
        })
        .select(
          "id,model_id,stock_code,status,created_at",
        )
        .single();

    if (
      insertError ||
      !insertedSignal
    ) {
      throw new Error(
        `TEST_SIGNAL_INSERT_FAILED:${
          insertError?.message ??
          "NO_ROW"
        }`,
      );
    }

    signalId =
      insertedSignal.id;

    if (
      insertedSignal.status !==
        "SKIPPED"
    ) {
      throw new Error(
        `TEST_SIGNAL_STATUS_UNEXPECTED:${insertedSignal.status}`,
      );
    }

    canonicalAfterInsert =
      await readCanonical(
        signalId,
      );

    if (!canonicalAfterInsert) {
      throw new Error(
        "TRIGGER_DID_NOT_CREATE_CANONICAL_ROW",
      );
    }

    if (
      canonicalAfterInsert
        .evaluation_status !==
        "PENDING"
    ) {
      throw new Error(
        `CANONICAL_INITIAL_STATUS_UNEXPECTED:${canonicalAfterInsert.evaluation_status}`,
      );
    }

    if (
      canonicalAfterInsert
        .promotion_stage_at_capture !==
        "SHADOW"
    ) {
      throw new Error(
        `CANONICAL_CAPTURE_STAGE_UNEXPECTED:${canonicalAfterInsert.promotion_stage_at_capture}`,
      );
    }

    const evaluationTimestamp =
      new Date(
        now.getTime() +
        1000,
      ).toISOString();

    const {
      error: updateError,
    } =
      await supabase
        .from(
          "ai_entry_signals",
        )
        .update({
          features: {
            testMarker:
              TEST_MARKER,
            synthetic:
              true,
            shadowEvaluation: {
              evaluation_status:
                "COMPLETED",
              entry_open_price:
                100000,
              return_1d:
                0.01,
              return_3d:
                0.02,
              return_5d:
                0.03,
              max_return_1d:
                0.015,
              max_return_3d:
                0.025,
              max_return_5d:
                0.04,
              min_return_1d:
                -0.005,
              min_return_3d:
                -0.01,
              min_return_5d:
                -0.015,
              evaluated_1d_at:
                evaluationTimestamp,
              evaluated_3d_at:
                evaluationTimestamp,
              evaluated_5d_at:
                evaluationTimestamp,
              evaluated_at:
                evaluationTimestamp,
            },
          },
        })
        .eq(
          "id",
          signalId,
        );

    if (updateError) {
      throw new Error(
        `TEST_SIGNAL_EVIDENCE_UPDATE_FAILED:${updateError.message}`,
      );
    }

    syncResult =
      await syncCanonicalShadowOutcomeFromEntrySignalsV1({
        modelId:
          MODEL_ID,
        limit:
          50,
      });

    canonicalAfterSync =
      await readCanonical(
        signalId,
      );

    if (!canonicalAfterSync) {
      throw new Error(
        "CANONICAL_ROW_MISSING_AFTER_SYNC",
      );
    }

    const syncChecks = {
      completed:
        canonicalAfterSync
          .evaluation_status ===
          "COMPLETED",

      entryOpenPrice:
        Number(
          canonicalAfterSync
            .entry_open_price,
        ) ===
        100000,

      return1d:
        Number(
          canonicalAfterSync
            .return_1d,
        ) ===
        0.01,

      return3d:
        Number(
          canonicalAfterSync
            .return_3d,
        ) ===
        0.02,

      return5d:
        Number(
          canonicalAfterSync
            .return_5d,
        ) ===
        0.03,

      maxReturn5d:
        Number(
          canonicalAfterSync
            .max_return_5d,
        ) ===
        0.04,

      minReturn5d:
        Number(
          canonicalAfterSync
            .min_return_5d,
        ) ===
        -0.015,

      noRecalculationEvidence:
        canonicalAfterSync
          .evidence
          ?.noOutcomeRecalculation ===
        true,
    };

    const failedSyncChecks =
      Object.entries(
        syncChecks,
      )
        .filter(
          ([, ok]) => !ok,
        )
        .map(
          ([name]) => name,
        );

    if (
      failedSyncChecks.length >
        0
    ) {
      throw new Error(
        `CANONICAL_SYNC_VALUE_MISMATCH:${failedSyncChecks.join(",")}`,
      );
    }
  } finally {
    if (signalId) {
      try {
        await deleteSignal(
          signalId,
        );
      } catch (error) {
        cleanupError =
          error instanceof Error
            ? error.message
            : String(error);
      }
    }
  }

  if (cleanupError) {
    throw new Error(
      cleanupError,
    );
  }

  const [
    afterSignals,
    afterCanonical,
    afterOrders,
    afterPositions,
    afterEvents,
  ] =
    await Promise.all([
      countTable(
        "ai_entry_signals",
      ),
      countTable(
        "model_shadow_signal_outcomes",
      ),
      countTable(
        "paper_order_requests",
      ),
      countTable(
        "paper_positions",
      ),
      countTable(
        "model_promotion_events",
      ),
    ]);

  const afterControls =
    await readControls();

  const afterModel =
    await readModel();

  const checks = {
    triggerCreatedCanonicalRow:
      Boolean(
        canonicalAfterInsert,
      ),

    initialCanonicalStatusPending:
      canonicalAfterInsert
        ?.evaluation_status ===
        "PENDING",

    captureStageShadow:
      canonicalAfterInsert
        ?.promotion_stage_at_capture ===
        "SHADOW",

    sidecarUpdatedCanonical:
      canonicalAfterSync
        ?.evaluation_status ===
        "COMPLETED",

    sidecarMirrored1d3d5d:
      Number(
        canonicalAfterSync
          ?.return_1d,
      ) ===
        0.01 &&
      Number(
        canonicalAfterSync
          ?.return_3d,
      ) ===
        0.02 &&
      Number(
        canonicalAfterSync
          ?.return_5d,
      ) ===
        0.03,

    syncReportedUpdate:
      (
        syncResult?.updated ??
        0
      ) >=
        1,

    cleanupRestoredSignalCount:
      afterSignals ===
        beforeSignals,

    cleanupRestoredCanonicalCount:
      afterCanonical ===
        beforeCanonical,

    noOrdersCreated:
      afterOrders ===
        beforeOrders,

    noPositionsChanged:
      afterPositions ===
        beforePositions,

    promotionEventsUnchanged:
      afterEvents ===
        beforeEvents,

    modelStillShadow:
      afterModel.promotion_stage ===
        "SHADOW",

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

  console.log(
    JSON.stringify(
      {
        status:
          failed.length === 0
            ? "MODEL_SHADOW_OUTCOME_PIPELINE_BINDING_V1_POSITIVE_PATH_VERIFIED"
            : "MODEL_SHADOW_OUTCOME_PIPELINE_BINDING_V1_POSITIVE_PATH_FAILED",

        syntheticSignal: {
          created:
            true,
          status:
            "SKIPPED",
          deleted:
            true,
          modelPurpose:
            model.purpose,
        },

        capture: {
          canonicalCreated:
            Boolean(
              canonicalAfterInsert,
            ),
          initialStatus:
            canonicalAfterInsert
              ?.evaluation_status ??
            null,
          captureStage:
            canonicalAfterInsert
              ?.promotion_stage_at_capture ??
            null,
        },

        evaluationSync: {
          syncResult,
          finalStatus:
            canonicalAfterSync
              ?.evaluation_status ??
            null,
          return1d:
            canonicalAfterSync
              ?.return_1d ??
            null,
          return3d:
            canonicalAfterSync
              ?.return_3d ??
            null,
          return5d:
            canonicalAfterSync
              ?.return_5d ??
            null,
          noOutcomeRecalculation:
            canonicalAfterSync
              ?.evidence
              ?.noOutcomeRecalculation ===
            true,
        },

        counts: {
          signals:
            `${beforeSignals}->${afterSignals}`,
          canonicalRows:
            `${beforeCanonical}->${afterCanonical}`,
          orders:
            `${beforeOrders}->${afterOrders}`,
          positions:
            `${beforePositions}->${afterPositions}`,
          promotionEvents:
            `${beforeEvents}->${afterEvents}`,
        },

        controls: {
          before:
            beforeControls,
          after:
            afterControls,
        },

        checks,
        failed,

        safety: {
          syntheticSignalWasRiskCapable:
            false,
          syntheticSignalStatus:
            "SKIPPED",
          syntheticSignalDeleted:
            true,
          syntheticCanonicalRowDeletedByCascade:
            afterCanonical ===
              beforeCanonical,
          ordersCreated:
            afterOrders -
            beforeOrders,
          positionsChanged:
            afterPositions -
            beforePositions,
          promotionStageChanged:
            afterModel.promotion_stage !==
            "SHADOW",
          controlsChanged:
            !sameControls(
              beforeControls,
              afterControls,
            ),
          realTradingEnabledByScript:
            false,
        },

        nextGate:
          failed.length === 0
            ? "VERIFY_REAL_EVALUATOR_PERSISTENCE_SHAPE_OR_KEEP_CANONICAL_PENDING_UNTIL_FIRST_REAL_POST_SHADOW_SIGNAL"
            : "STOP_AND_DIAGNOSE_SHADOW_PIPELINE_POSITIVE_PATH",
      },
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
    console.error(
      JSON.stringify(
        {
          status:
            "MODEL_SHADOW_OUTCOME_PIPELINE_BINDING_V1_POSITIVE_PATH_FAILED",
          error:
            error instanceof Error
              ? error.message
              : String(error),
          safety: {
            realTradingEnabledByScript:
              false,
          },
          nextGate:
            "STOP_AND_DIAGNOSE_SHADOW_PIPELINE_POSITIVE_PATH",
        },
        null,
        2,
      ),
    );

    process.exitCode =
      1;
  },
);
