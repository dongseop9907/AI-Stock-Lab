// AI_STOCK_LAB_PATCH_PAPER_PROMOTION_ELIGIBILITY_READY_CHECKS_TYPE_V1
// Contract-test-only optional checks narrowing. Runtime values and promotion behavior unchanged.
import assert from "node:assert/strict";
import crypto from "node:crypto";

import {
  runPaperPromotionEligibilityPreflightV1,
} from "./true-forward-oos-paper-promotion-eligibility-preflight-v1";

import {
  APPROVE_DECISION,
  REJECT_DECISION,
} from "./true-forward-oos-manual-review-decision-v1";

function stableJson(
  value: unknown,
) {
  return JSON.stringify(
    value,
    null,
    2,
  );
}

function sha256(
  value: unknown,
) {
  return crypto
    .createHash("sha256")
    .update(
      stableJson(value),
    )
    .digest("hex");
}

function fixtures(
  decisionValue:
    string,
) {
  const observationsDocument = {
    observations: [
      {
        sourceTradingDate:
          "2026-10-08",

        targetSessionDate:
          "2026-10-12",

        stockCode:
          "005930",
      },
    ],
  };

  const evaluatorReport = {
    status:
      "ALPHA_V3_TRUE_FORWARD_OOS_EVALUATED",
  };

  const summaryReport = {
    decision: {
      enoughEvidenceForFinalEntryGate:
        true,

      productionPolicyLocked:
        false,
    },
  };

  const packetCore = {
    version:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_PACKET_V1",

    generatedAt:
      "2026-12-15T07:00:00.000Z",

    reviewGate: {
      gateStatus:
        "READY_FOR_MANUAL_FORWARD_OOS_REVIEW",

      reviewReady:
        true,
    },

    frozenContract: {
      historicalCutoff:
        "2026-10-07",

      selectedCap:
        0.01,

      entryScoreThreshold:
        0.66,

      retuningAllowed:
        false,
    },

    counts: {
      observations:
        1,

      qualifiedObservations:
        1,

      filledObservations:
        1,
    },

    evaluatorDecision: {
      enoughSample:
        true,

      fillPassed:
        true,

      pairedPassed:
        true,

      forwardOosGatePassed:
        true,

      nextUse:
        "READY_FOR_MANUAL_FORWARD_OOS_REVIEW",
    },

    summaryDecision: {
      trueForwardReady:
        true,

      enoughEvidenceForFinalEntryGate:
        true,

      productionPolicyLocked:
        false,
    },

    sourceHashes: {
      observationsSha256:
        sha256(
          observationsDocument,
        ),

      evaluatorSha256:
        sha256(
          evaluatorReport,
        ),

      summarySha256:
        sha256(
          summaryReport,
        ),
    },

    safety: {
      manualReviewOnly:
        true,

      promotionExecuted:
        false,

      automaticPromotion:
        false,

      realTradingEnabled:
        false,

      ordersCreated:
        0,

      positionsChanged:
        0,
    },
  };

  const packet = {
    ...packetCore,

    packetSha256:
      sha256(
        packetCore,
      ),
  };

  const decisionCore = {
    version:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_DECISION_V1",

    recordedAt:
      "2026-12-15T08:00:00.000Z",

    decision:
      decisionValue,

    note:
      "contract",

    packetReference: {
      packetSha256:
        packet.packetSha256,

      observationsSha256:
        packet.sourceHashes
          .observationsSha256,

      evaluatorSha256:
        packet.sourceHashes
          .evaluatorSha256,

      summarySha256:
        packet.sourceHashes
          .summarySha256,
    },

    decisionSemantics: {
      promotionApproved:
        false,

      paperPromotionExecuted:
        false,

      automaticPromotion:
        false,

      approvalMeaning:
        decisionValue ===
        APPROVE_DECISION
          ? "ALLOW_SEPARATE_PAPER_PROMOTION_REVIEW_GATE_ONLY"
          : "CONTINUE_FORWARD_OOS_COLLECTION_WITHOUT_RETUNING",
    },

    safety: {
      packetIntegrityVerified:
        true,

      promotionExecuted:
        false,

      automaticPromotion:
        false,

      realTradingEnabled:
        false,

      ordersCreated:
        0,

      positionsChanged:
        0,
    },
  };

  const decisionRecord = {
    ...decisionCore,

    decisionRecordSha256:
      sha256(
        decisionCore,
      ),
  };

  return {
    observationsDocument,
    evaluatorReport,
    summaryReport,
    packet,
    decisionRecord,
  };
}

async function main() {
  let preflightCalls =
    0;

  const mockReadyPreflight =
    async (
      input: any,
    ) => {
      preflightCalls +=
        1;

      return {
        allowed:
          true,

        reason:
          "READY",

        modelId:
          input.modelId,

        fromStage:
          "SHADOW",

        toStage:
          "PAPER",

        recommendationDecision:
          "RECOMMENDED",

        recommendationReason:
          "SHADOW_PAPER_CANONICAL_OUTCOME_EVIDENCE_READY",

        canonicalShadowOutcomeEvidenceReady:
          true,

        transitionKind:
          "SHADOW_TO_PAPER",

        featureEnabled:
          false,
      };
    };

  const waiting =
    await runPaperPromotionEligibilityPreflightV1({
      decisionRecord:
        undefined,

      promotionPreflight:
        mockReadyPreflight,
    });

  const rejectFixtures =
    fixtures(
      REJECT_DECISION,
    );

  const rejected =
    await runPaperPromotionEligibilityPreflightV1({
      ...rejectFixtures,

      modelId:
        "model-1",

      promotionPreflight:
        mockReadyPreflight,
    });

  const approveFixtures =
    fixtures(
      APPROVE_DECISION,
    );

  const noModel =
    await runPaperPromotionEligibilityPreflightV1({
      ...approveFixtures,

      promotionPreflight:
        mockReadyPreflight,
    });

  const ready =
    await runPaperPromotionEligibilityPreflightV1({
      ...approveFixtures,

      modelId:
        "model-1",

      promotionPreflight:
        mockReadyPreflight,
    });

  const blockedExisting =
    await runPaperPromotionEligibilityPreflightV1({
      ...approveFixtures,

      modelId:
        "model-1",

      promotionPreflight:
        async (
          input: any,
        ) => {
          return {
            allowed:
              false,

            reason:
              "CANONICAL_OUTCOME_EVIDENCE_NOT_READY",

            modelId:
              input.modelId,

            fromStage:
              "SHADOW",

            toStage:
              "PAPER",

            recommendationDecision:
              "BLOCKED",

            recommendationReason:
              "SHADOW_PAPER_CANONICAL_OUTCOME_EVIDENCE_NOT_READY",

            canonicalShadowOutcomeEvidenceReady:
              false,

            transitionKind:
              "SHADOW_TO_PAPER",

            featureEnabled:
              false,
          };
        },
    });

  const checks = {
    waitingSkipsExistingPreflight:
      waiting.eligibilityStatus ===
        "WAITING_FOR_VERIFIED_MANUAL_REVIEW_DECISION" &&
      waiting.promotionPreflightCalled ===
        false,

    rejectDecisionSkipsExistingPreflight:
      rejected.eligibilityStatus ===
        "BLOCKED_MANUAL_REVIEW_DECISION_NOT_APPROVED" &&
      rejected.promotionPreflightCalled ===
        false,

    modelIdRequiredAfterApproval:
      noModel.eligibilityStatus ===
        "BLOCKED_MODEL_ID_REQUIRED" &&
      noModel.promotionPreflightCalled ===
        false,

    eligibleWhenAllExistingChecksReady:
      ready.eligibilityStatus ===
        "ELIGIBLE_FOR_SEPARATE_PAPER_PROMOTION_APPLY_REVIEW" &&
      ready.eligibleForSeparatePromotionApplyReview ===
        true,

    existingCanonicalNotReadyBlocks:
      blockedExisting.eligibilityStatus ===
        "BLOCKED_EXISTING_MANUAL_PROMOTION_PREFLIGHT" &&
      blockedExisting.eligibleForSeparatePromotionApplyReview ===
        false,

    exactPhraseBound:
      ((ready as { checks?: Record<string, boolean> }).checks ?? {}).exactConfirmationPhrase ===
        true,

    noActualApply:
      ready.actualPromotionApplyExecuted ===
        false &&
      ready.safety
        .applyManualPaperPromotionCalled ===
        false,

    noTradingSideEffects:
      ready.safety
        .databaseWrites ===
        0 &&
      ready.safety
        .ordersCreated ===
        0 &&
      ready.safety
        .positionsChanged ===
        0 &&
      ready.safety
        .realTradingEnabled ===
        false,
  };

  for (
    const [
      key,
      value,
    ] of Object.entries(
      checks,
    )
  ) {
    assert.equal(
      value,
      true,
      key,
    );
  }

  console.log(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_ELIGIBILITY_PREFLIGHT_V1_CONTRACT_VERIFIED",

        checks,

        observations: {
          waiting:
            waiting.eligibilityStatus,

          rejected:
            rejected.eligibilityStatus,

          noModel:
            noModel.eligibilityStatus,

          ready:
            ready.eligibilityStatus,

          blockedExisting:
            {
              eligibilityStatus:
                blockedExisting.eligibilityStatus,

              existingReason:
                blockedExisting
                  .existingPromotionPreflight
                  ?.reason ??
                null,
            },

          promotionPreflightCalls:
            preflightCalls,
        },

        safety: {
          syntheticOnly:
            true,

          realPromotionPreflightCalled:
            false,

          applyManualPaperPromotionCalled:
            false,

          promotionExecuted:
            false,

          databaseWrites:
            0,

          ordersCreated:
            0,

          positionsChanged:
            0,

          realTradingEnabled:
            false,
        },

        failed:
          [],

        nextGate:
          "STATIC_VERIFY_THEN_RUN_CURRENT_ELIGIBILITY_PREFLIGHT_EXPECT_WAITING",
      },
      null,
      2,
    ),
  );
}

main().catch(
  error => {
    console.error(
      JSON.stringify(
        {
          status:
            "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_ELIGIBILITY_PREFLIGHT_V1_CONTRACT_FAILED",

          error:
            String(
              error instanceof Error
                ? error.stack ??
                  error.message
                : error
            ),
        },
        null,
        2,
      ),
    );

    process.exitCode = 1;
  },
);
