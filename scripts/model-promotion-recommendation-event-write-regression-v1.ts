import {
  evaluateModelPromotionRecommendation,
  recordModelPromotionRecommendation,
} from "../lib/models/model-promotion-decision-service";

import {
  createSupabaseServerClient,
} from "../lib/supabase";

const MODEL_ID =
  "3045646b-599b-41cd-9650-43e539fb7a95";

const ACTOR =
  "MODEL_PROMOTION_EVENT_WRITE_REGRESSION_V1";

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
      .select(
        "id,status,promotion_stage,promotion_stage_updated_at,promotion_stage_reason",
      )
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

async function findExistingRegressionEvent() {
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
      .select(
        "id,model_id,from_stage,to_stage,decision,actor,reason,created_at",
      )
      .eq(
        "model_id",
        MODEL_ID,
      )
      .eq(
        "actor",
        ACTOR,
      )
      .eq(
        "from_stage",
        "CANDIDATE",
      )
      .eq(
        "to_stage",
        "SHADOW",
      )
      .eq(
        "decision",
        "RECOMMENDED",
      )
      .order(
        "created_at",
        {
          ascending: false,
        },
      )
      .limit(1)
      .maybeSingle();

  if (error) {
    throw new Error(
      `EVENT_LOOKUP_FAILED:${error.message}`,
    );
  }

  return data;
}

async function main() {
  const beforeModel =
    await readModel();

  const beforeControls =
    await readControls();

  if (
    beforeControls.real_order_enabled !==
      false
  ) {
    throw new Error(
      "REAL_TRADING_MUST_REMAIN_OFF",
    );
  }

  if (
    beforeModel.promotion_stage !==
      "CANDIDATE"
  ) {
    throw new Error(
      `EXPECTED_CANDIDATE_BEFORE_WRITE:${beforeModel.promotion_stage}`,
    );
  }

  const [
    beforeEvents,
    beforeOrders,
    beforePositions,
  ] =
    await Promise.all([
      countTable(
        "model_promotion_events",
      ),
      countTable(
        "paper_order_requests",
      ),
      countTable(
        "paper_positions",
      ),
    ]);

  const recommendation =
    await evaluateModelPromotionRecommendation(
      MODEL_ID,
    );

  if (
    recommendation.decision !==
      "RECOMMENDED" ||
    recommendation.fromStage !==
      "CANDIDATE" ||
    recommendation.toStage !==
      "SHADOW"
  ) {
    throw new Error(
      `EXPECTED_CANDIDATE_TO_SHADOW_RECOMMENDATION:${recommendation.fromStage}->${recommendation.toStage}:${recommendation.decision}:${recommendation.reason}`,
    );
  }

  let existing =
    await findExistingRegressionEvent();

  let eventId:
    | string
    | null =
    existing?.id ?? null;

  let inserted =
    false;

  if (!existing) {
    const write =
      await recordModelPromotionRecommendation(
        recommendation,
        ACTOR,
      );

    eventId =
      write.eventId;

    inserted =
      true;
  }

  const afterModel =
    await readModel();

  const afterControls =
    await readControls();

  const [
    afterEvents,
    afterOrders,
    afterPositions,
  ] =
    await Promise.all([
      countTable(
        "model_promotion_events",
      ),
      countTable(
        "paper_order_requests",
      ),
      countTable(
        "paper_positions",
      ),
    ]);

  const writtenEvent =
    await findExistingRegressionEvent();

  const checks = {
    eventExists:
      Boolean(writtenEvent),

    eventDecisionRecommended:
      writtenEvent?.decision ===
        "RECOMMENDED",

    eventFromCandidate:
      writtenEvent?.from_stage ===
        "CANDIDATE",

    eventToShadow:
      writtenEvent?.to_stage ===
        "SHADOW",

    actorCorrect:
      writtenEvent?.actor ===
        ACTOR,

    promotionStageUnchanged:
      beforeModel.promotion_stage ===
        afterModel.promotion_stage &&
      afterModel.promotion_stage ===
        "CANDIDATE",

    legacyStatusUnchanged:
      beforeModel.status ===
        afterModel.status,

    promotionTimestampUnchanged:
      beforeModel
        .promotion_stage_updated_at ===
      afterModel
        .promotion_stage_updated_at,

    promotionReasonUnchanged:
      beforeModel
        .promotion_stage_reason ===
      afterModel
        .promotion_stage_reason,

    eventCountCorrect:
      inserted
        ? afterEvents ===
            beforeEvents + 1
        : afterEvents ===
            beforeEvents,

    noOrdersCreated:
      afterOrders ===
        beforeOrders,

    noPositionsChanged:
      afterPositions ===
        beforePositions,

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

  const result = {
    status:
      failed.length === 0
        ? "MODEL_PROMOTION_RECOMMENDATION_EVENT_WRITE_REGRESSION_V1_VERIFIED"
        : "MODEL_PROMOTION_RECOMMENDATION_EVENT_WRITE_REGRESSION_V1_FAILED",

    modelId:
      MODEL_ID,

    recommendation: {
      fromStage:
        recommendation.fromStage,
      toStage:
        recommendation.toStage,
      decision:
        recommendation.decision,
      reason:
        recommendation.reason,
      entrySignals:
        recommendation
          .evidence
          .entrySignals,
      paperTrades:
        recommendation
          .evidence
          .paperTrades,
    },

    event: {
      actor:
        ACTOR,
      eventId,
      inserted,
      existingBeforeRun:
        Boolean(existing),
      beforeCount:
        beforeEvents,
      afterCount:
        afterEvents,
    },

    checks,
    failed,

    model: {
      before: {
        legacyStatus:
          beforeModel.status,
        promotionStage:
          beforeModel.promotion_stage,
        promotionStageUpdatedAt:
          beforeModel
            .promotion_stage_updated_at,
        promotionStageReason:
          beforeModel
            .promotion_stage_reason,
      },

      after: {
        legacyStatus:
          afterModel.status,
        promotionStage:
          afterModel.promotion_stage,
        promotionStageUpdatedAt:
          afterModel
            .promotion_stage_updated_at,
        promotionStageReason:
          afterModel
            .promotion_stage_reason,
      },
    },

    counts: {
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

    safety: {
      promotionStageChanged:
        beforeModel.promotion_stage !==
          afterModel.promotion_stage,
      legacyStatusChanged:
        beforeModel.status !==
          afterModel.status,
      ordersCreated:
        afterOrders -
        beforeOrders,
      positionsChanged:
        afterPositions -
        beforePositions,
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
        ? "BUILD_CONTROLLED_PROMOTION_APPLY_RPC_AND_MANUAL_AUDIT_GUARD"
        : "STOP_AND_DIAGNOSE_EVENT_WRITER",
  };

  console.log(
    JSON.stringify(
      result,
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
            "MODEL_PROMOTION_RECOMMENDATION_EVENT_WRITE_REGRESSION_V1_FAILED",
          error:
            error instanceof Error
              ? error.message
              : String(error),
          safety: {
            promotionStageChanged:
              false,
            ordersCreated:
              0,
            positionsChanged:
              0,
            controlsChanged:
              false,
            realTradingEnabledByScript:
              false,
          },
          nextGate:
            "STOP_AND_DIAGNOSE_EVENT_WRITER",
        },
        null,
        2,
      ),
    );

    process.exitCode =
      1;
  },
);
