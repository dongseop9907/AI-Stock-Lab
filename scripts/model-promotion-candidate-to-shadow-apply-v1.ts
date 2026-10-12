import {
  evaluateModelPromotionRecommendation,
} from "../lib/models/model-promotion-decision-service";

import {
  applyModelPromotionTransition,
} from "../lib/models/model-promotion-apply";

import {
  assertModelPromotionAllowsPaperRisk,
} from "../lib/models/model-promotion-gate";

import {
  createSupabaseServerClient,
} from "../lib/supabase";

const MODEL_ID =
  "3045646b-599b-41cd-9650-43e539fb7a95";

const ACTOR =
  "MODEL_PROMOTION_CANDIDATE_TO_SHADOW_APPLY_V1";

const REASON =
  "CANDIDATE_TO_SHADOW_AFTER_RECOMMENDATION_AND_CONTROLLED_RPC_VERIFICATION";

function sameControls(a: any, b: any) {
  return (
    a?.emergency_stop === b?.emergency_stop &&
    a?.automation_enabled === b?.automation_enabled &&
    a?.paper_order_enabled === b?.paper_order_enabled &&
    a?.real_order_enabled === b?.real_order_enabled
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
      .select(`
        id,
        model_name,
        model_version,
        purpose,
        status,
        promotion_stage,
        promotion_stage_updated_at,
        promotion_stage_reason
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

async function readLatestAppliedEvent() {
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
      .select(`
        id,
        model_id,
        from_stage,
        to_stage,
        transition_kind,
        decision,
        requires_manual_approval,
        manual_approval_confirmed,
        actor,
        reason,
        evidence,
        created_at
      `)
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
        "APPLIED",
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
      `APPLIED_EVENT_READ_FAILED:${error.message}`,
    );
  }

  return data;
}

async function verifyShadowBlocksPaperRisk() {
  let blocked = false;
  let message = "";

  try {
    await assertModelPromotionAllowsPaperRisk(
      MODEL_ID,
      "POST_CANDIDATE_TO_SHADOW_APPLY_REGRESSION",
    );
  } catch (error) {
    message =
      error instanceof Error
        ? error.message
        : String(error);

    blocked =
      message.startsWith(
        "MODEL_PROMOTION_PAPER_RISK_BLOCKED:SHADOW:",
      );
  }

  return {
    blocked,
    message,
  };
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
      "REAL_TRADING_MUST_BE_OFF",
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

  let appliedNow = false;
  let applyResult: any = null;

  if (
    beforeModel.promotion_stage ===
      "CANDIDATE"
  ) {
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
        "SHADOW" ||
      recommendation.reason !==
        "CANDIDATE_SHADOW_SIGNAL_PIPELINE_READY"
    ) {
      throw new Error(
        `PROMOTION_RECOMMENDATION_NOT_READY:${recommendation.fromStage}->${recommendation.toStage}:${recommendation.decision}:${recommendation.reason}`,
      );
    }

    applyResult =
      await applyModelPromotionTransition({
        modelId:
          MODEL_ID,
        toStage:
          "SHADOW",
        actor:
          ACTOR,
        reason:
          REASON,
        manualApprovalConfirmed:
          false,
        evidence: {
          recommendationVersion:
            recommendation.version,
          recommendationDecision:
            recommendation.decision,
          recommendationReason:
            recommendation.reason,
          entrySignals:
            recommendation
              .evidence
              .entrySignals,
          paperTrades:
            recommendation
              .evidence
              .paperTrades,
          validationTradeCount:
            recommendation
              .evidence
              .validationTradeCount,
          metrics:
            recommendation
              .evidence
              .metrics,
          safety: {
            targetStageIsNonRisk:
              true,
            paperRiskMustRemainBlocked:
              true,
            realTradingMustRemainOff:
              true,
          },
        },
      });

    if (
      applyResult.decision !==
        "APPLIED" ||
      applyResult.applied !==
        true ||
      applyResult.fromStage !==
        "CANDIDATE" ||
      applyResult.toStage !==
        "SHADOW"
    ) {
      throw new Error(
        `CONTROLLED_APPLY_UNEXPECTED_RESULT:${JSON.stringify(applyResult)}`,
      );
    }

    appliedNow = true;
  } else if (
    beforeModel.promotion_stage ===
      "SHADOW"
  ) {
    applyResult =
      await readLatestAppliedEvent();

    if (!applyResult) {
      throw new Error(
        "SHADOW_STAGE_PRESENT_BUT_APPLIED_EVENT_MISSING",
      );
    }
  } else {
    throw new Error(
      `EXPECTED_CANDIDATE_OR_SHADOW:${beforeModel.promotion_stage}`,
    );
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

  const appliedEvent =
    await readLatestAppliedEvent();

  const paperRiskCheck =
    await verifyShadowBlocksPaperRisk();

  const checks = {
    shadowStageApplied:
      afterModel.promotion_stage ===
        "SHADOW",

    legacyStatusPreserved:
      afterModel.status ===
        beforeModel.status &&
      afterModel.status ===
        "CANDIDATE",

    promotionReasonSet:
      afterModel.promotion_stage_reason ===
        REASON,

    promotionTimestampAdvancedOrStableOnRerun:
      appliedNow
        ? (
            afterModel
              .promotion_stage_updated_at !==
              beforeModel
                .promotion_stage_updated_at
          )
        : (
            afterModel
              .promotion_stage_updated_at ===
              beforeModel
                .promotion_stage_updated_at
          ),

    appliedAuditEventExists:
      Boolean(appliedEvent),

    appliedAuditEventCorrect:
      appliedEvent?.decision ===
        "APPLIED" &&
      appliedEvent?.from_stage ===
        "CANDIDATE" &&
      appliedEvent?.to_stage ===
        "SHADOW" &&
      appliedEvent?.actor ===
        ACTOR &&
      appliedEvent
        ?.manual_approval_confirmed ===
        false,

    eventCountCorrect:
      appliedNow
        ? afterEvents ===
            beforeEvents + 1
        : afterEvents ===
            beforeEvents,

    shadowBlocksPaperRisk:
      paperRiskCheck.blocked,

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
        ? "MODEL_PROMOTION_CANDIDATE_TO_SHADOW_APPLY_V1_VERIFIED"
        : "MODEL_PROMOTION_CANDIDATE_TO_SHADOW_APPLY_V1_FAILED",

    model: {
      id:
        MODEL_ID,
      beforeStage:
        beforeModel.promotion_stage,
      afterStage:
        afterModel.promotion_stage,
      legacyStatus:
        afterModel.status,
      appliedNow,
    },

    event: {
      id:
        appliedEvent?.id ?? null,
      decision:
        appliedEvent?.decision ?? null,
      fromStage:
        appliedEvent?.from_stage ?? null,
      toStage:
        appliedEvent?.to_stage ?? null,
      actor:
        appliedEvent?.actor ?? null,
    },

    riskGate: {
      paperRiskBlocked:
        paperRiskCheck.blocked,
      blockMessage:
        paperRiskCheck.message,
    },

    counts: {
      promotionEvents:
        `${beforeEvents}->${afterEvents}`,
      orders:
        `${beforeOrders}->${afterOrders}`,
      positions:
        `${beforePositions}->${afterPositions}`,
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
      promotionApplied:
        appliedNow,
      targetStage:
        "SHADOW",
      paperRiskEnabled:
        !paperRiskCheck.blocked,
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
        ? "BUILD_CANONICAL_SHADOW_OUTCOME_EVIDENCE_ADAPTER_BEFORE_PAPER_PROMOTION"
        : "STOP_AND_DIAGNOSE_CANDIDATE_TO_SHADOW_APPLY",
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
            "MODEL_PROMOTION_CANDIDATE_TO_SHADOW_APPLY_V1_FAILED",
          error:
            error instanceof Error
              ? error.message
              : String(error),
          safety: {
            targetStage:
              "SHADOW",
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
            "STOP_AND_DIAGNOSE_CANDIDATE_TO_SHADOW_APPLY",
        },
        null,
        2,
      ),
    );

    process.exitCode =
      1;
  },
);
