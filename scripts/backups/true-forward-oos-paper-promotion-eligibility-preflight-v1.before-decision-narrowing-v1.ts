import {
  auditManualReviewDecisionIntegrityV1,
} from "./true-forward-oos-manual-review-decision-integrity-v1";

import {
  MANUAL_PAPER_PROMOTION_CONFIRMATION_PHRASE,
  preflightManualPaperPromotion,
} from "../lib/models/model-promotion-manual-apply";

export interface PaperPromotionEligibilityPreflightInput {
  modelId?: string;
  actor?: string;
  reason?: string;

  decisionRecord?: any;
  packet?: any;
  observationsDocument?: any;
  evaluatorReport?: any;
  summaryReport?: any;

  promotionPreflight?: (
    input: {
      modelId: string;
      toStage: "PAPER";
      manualApprovalConfirmed: boolean;
      confirmationPhrase: string;
      actor: string;
      reason: string;
    },
  ) => Promise<any>;
}

function hasOwn(
  input: PaperPromotionEligibilityPreflightInput,
  key:
    | "decisionRecord"
    | "packet"
    | "observationsDocument"
    | "evaluatorReport"
    | "summaryReport",
) {
  return Object.prototype.hasOwnProperty.call(
    input,
    key,
  );
}

export async function runPaperPromotionEligibilityPreflightV1(
  input:
    PaperPromotionEligibilityPreflightInput = {},
) {
  const decisionIntegrity =
    auditManualReviewDecisionIntegrityV1({
      ...(hasOwn(
        input,
        "decisionRecord",
      )
        ? {
            decisionRecord:
              input.decisionRecord,
          }
        : {}),

      ...(hasOwn(
        input,
        "packet",
      )
        ? {
            packet:
              input.packet,
          }
        : {}),

      ...(hasOwn(
        input,
        "observationsDocument",
      )
        ? {
            observationsDocument:
              input.observationsDocument,
          }
        : {}),

      ...(hasOwn(
        input,
        "evaluatorReport",
      )
        ? {
            evaluatorReport:
              input.evaluatorReport,
          }
        : {}),

      ...(hasOwn(
        input,
        "summaryReport",
      )
        ? {
            summaryReport:
              input.summaryReport,
          }
        : {}),
    });

  if (
    decisionIntegrity.integrityStatus ===
    "WAITING_FOR_MANUAL_REVIEW_DECISION"
  ) {
    return {
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_ELIGIBILITY_PREFLIGHT_V1",

      eligibilityStatus:
        "WAITING_FOR_VERIFIED_MANUAL_REVIEW_DECISION",

      eligibleForSeparatePromotionApplyReview:
        false,

      actualPromotionApplyExecuted:
        false,

      promotionPreflightCalled:
        false,

      failed:
        [],

      safety:
        safety(),

      nextGate:
        "WAIT_FOR_VERIFIED_APPROVE_DECISION",
    };
  }

  if (
    decisionIntegrity.integrityStatus !==
      "MANUAL_REVIEW_DECISION_INTEGRITY_VERIFIED" ||
    decisionIntegrity.paperPromotionReviewEligible !==
      true
  ) {
    return {
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_ELIGIBILITY_PREFLIGHT_V1",

      eligibilityStatus:
        "BLOCKED_MANUAL_REVIEW_DECISION_NOT_APPROVED",

      eligibleForSeparatePromotionApplyReview:
        false,

      actualPromotionApplyExecuted:
        false,

      promotionPreflightCalled:
        false,

      decisionIntegrity: {
        integrityStatus:
          decisionIntegrity.integrityStatus,

        decision:
          decisionIntegrity.decision ??
          null,

        paperPromotionReviewEligible:
          decisionIntegrity.paperPromotionReviewEligible ??
          false,
      },

      failed:
        [],

      safety:
        safety(),

      nextGate:
        "CONTINUE_TRUE_FORWARD_OOS_OR_REPAIR_DECISION",
    };
  }

  const modelId =
    (
      input.modelId ??
      process.env
        .TRUE_FORWARD_OOS_PAPER_PROMOTION_MODEL_ID ??
      ""
    ).trim();

  if (!modelId) {
    return {
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_ELIGIBILITY_PREFLIGHT_V1",

      eligibilityStatus:
        "BLOCKED_MODEL_ID_REQUIRED",

      eligibleForSeparatePromotionApplyReview:
        false,

      actualPromotionApplyExecuted:
        false,

      promotionPreflightCalled:
        false,

      failed: [
        "MODEL_ID_REQUIRED",
      ],

      safety:
        safety(),

      nextGate:
        "PROVIDE_EXPLICIT_ENTRY_TIMING_SHADOW_MODEL_ID",
    };
  }

  const actor =
    (
      input.actor ??
      "TRUE_FORWARD_OOS_PAPER_PROMOTION_ELIGIBILITY_PREFLIGHT_V1"
    ).trim();

  const reason =
    (
      input.reason ??
      "VERIFIED_TRUE_FORWARD_OOS_MANUAL_REVIEW_DECISION"
    ).trim();

  if (
    !actor ||
    !reason
  ) {
    return {
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_ELIGIBILITY_PREFLIGHT_V1",

      eligibilityStatus:
        "BLOCKED_ACTOR_OR_REASON_REQUIRED",

      eligibleForSeparatePromotionApplyReview:
        false,

      actualPromotionApplyExecuted:
        false,

      promotionPreflightCalled:
        false,

      failed: [
        "ACTOR_OR_REASON_REQUIRED",
      ],

      safety:
        safety(),

      nextGate:
        "PROVIDE_ACTOR_AND_REASON",
    };
  }

  const preflightFn =
    input.promotionPreflight ??
    preflightManualPaperPromotion;

  const promotionPreflight =
    await preflightFn({
      modelId,
      toStage:
        "PAPER",

      manualApprovalConfirmed:
        true,

      confirmationPhrase:
        MANUAL_PAPER_PROMOTION_CONFIRMATION_PHRASE,

      actor,
      reason,
    });

  const checks = {
    exactConfirmationPhrase:
      MANUAL_PAPER_PROMOTION_CONFIRMATION_PHRASE ===
      "PROMOTE_SHADOW_TO_PAPER",

    modelIdMatches:
      promotionPreflight
        ?.modelId ===
        modelId,

    fromStageShadow:
      promotionPreflight
        ?.fromStage ===
        "SHADOW",

    toStagePaper:
      promotionPreflight
        ?.toStage ===
        "PAPER",

    recommendationRecommended:
      promotionPreflight
        ?.recommendationDecision ===
        "RECOMMENDED",

    recommendationReasonCanonicalReady:
      promotionPreflight
        ?.recommendationReason ===
        "SHADOW_PAPER_CANONICAL_OUTCOME_EVIDENCE_READY",

    canonicalEvidenceReady:
      promotionPreflight
        ?.canonicalShadowOutcomeEvidenceReady ===
        true,

    transitionAllowed:
      promotionPreflight
        ?.transitionKind ===
        "ALLOWED" ||
      promotionPreflight
        ?.transitionKind ===
        "SHADOW_TO_PAPER",

    manualPreflightAllowed:
      promotionPreflight
        ?.allowed ===
        true,

    manualPreflightReasonReady:
      promotionPreflight
        ?.reason ===
        "READY",
  };

  const failed =
    Object.entries(
      checks,
    )
      .filter(
        ([, value]) =>
          value !==
          true,
      )
      .map(
        ([key]) =>
          key,
      );

  return {
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_ELIGIBILITY_PREFLIGHT_V1",

    eligibilityStatus:
      failed.length ===
      0
        ? "ELIGIBLE_FOR_SEPARATE_PAPER_PROMOTION_APPLY_REVIEW"
        : "BLOCKED_EXISTING_MANUAL_PROMOTION_PREFLIGHT",

    eligibleForSeparatePromotionApplyReview:
      failed.length ===
      0,

    actualPromotionApplyExecuted:
      false,

    promotionPreflightCalled:
      true,

    modelId,

    existingPromotionPreflight: {
      allowed:
        promotionPreflight
          ?.allowed ??
        null,

      reason:
        promotionPreflight
          ?.reason ??
        null,

      fromStage:
        promotionPreflight
          ?.fromStage ??
        null,

      toStage:
        promotionPreflight
          ?.toStage ??
        null,

      recommendationDecision:
        promotionPreflight
          ?.recommendationDecision ??
        null,

      recommendationReason:
        promotionPreflight
          ?.recommendationReason ??
        null,

      canonicalShadowOutcomeEvidenceReady:
        promotionPreflight
          ?.canonicalShadowOutcomeEvidenceReady ??
        null,

      transitionKind:
        promotionPreflight
          ?.transitionKind ??
        null,

      featureEnabled:
        promotionPreflight
          ?.featureEnabled ??
        null,
    },

    checks,
    failed,

    safety:
      safety(),

    nextGate:
      failed.length ===
      0
        ? "BUILD_SEPARATE_EXPLICIT_PAPER_PROMOTION_APPLY_APPROVAL_GATE"
        : "KEEP_SHADOW_AND_REPAIR_OR_WAIT_FOR_EXISTING_PROMOTION_PREFLIGHT",
  };
}

function safety() {
  return {
    readOnly:
      true,

    decisionWritten:
      false,

    packetWritten:
      false,

    promotionPreflightReadOnly:
      true,

    actualPromotionApplyExecuted:
      false,

    applyManualPaperPromotionCalled:
      false,

    promotionStageChanged:
      false,

    promotionEventWritten:
      false,

    databaseWrites:
      0,

    ordersCreated:
      0,

    positionsChanged:
      0,

    controlsChanged:
      false,

    realTradingEnabled:
      false,
  };
}

async function main() {
  const result =
    await runPaperPromotionEligibilityPreflightV1();

  console.log(
    JSON.stringify(
      result,
      null,
      2,
    ),
  );

  process.exitCode =
    result.eligibilityStatus.startsWith(
      "BLOCKED_",
    )
      ? 1
      : 0;
}

if (
  process.argv[1]?.endsWith(
    "true-forward-oos-paper-promotion-eligibility-preflight-v1.ts",
  )
) {
  main().catch(
    error => {
      console.error(
        JSON.stringify(
          {
            status:
              "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_ELIGIBILITY_PREFLIGHT_V1_ERROR",

            error:
              String(
                error instanceof Error
                  ? error.stack ??
                    error.message
                  : error
              ),

            safety:
              safety(),
          },
          null,
          2,
        ),
      );

      process.exitCode = 1;
    },
  );
}
