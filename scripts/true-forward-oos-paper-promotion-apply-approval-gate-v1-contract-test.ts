// AI_STOCK_LAB_PATCH_PAPER_PROMOTION_APPROVAL_EXACT_PHRASE_TYPE_V1
// Contract-test-only union narrowing for exactApprovalPhrase. Runtime values and promotion behavior unchanged.
import assert from "node:assert/strict";

import {
  runPaperPromotionApplyApprovalGateV1,
  TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_APPROVAL_PHRASE,
} from "./true-forward-oos-paper-promotion-apply-approval-gate-v1";

function waitingEligibility() {
  return {
    eligibilityStatus:
      "WAITING_FOR_VERIFIED_MANUAL_REVIEW_DECISION",

    eligibleForSeparatePromotionApplyReview:
      false,

    actualPromotionApplyExecuted:
      false,

    safety: {
      applyManualPaperPromotionCalled:
        false,

      realTradingEnabled:
        false,
    },
  };
}

function blockedEligibility() {
  return {
    eligibilityStatus:
      "BLOCKED_EXISTING_MANUAL_PROMOTION_PREFLIGHT",

    eligibleForSeparatePromotionApplyReview:
      false,

    actualPromotionApplyExecuted:
      false,

    safety: {
      applyManualPaperPromotionCalled:
        false,

      realTradingEnabled:
        false,
    },
  };
}

function readyEligibility() {
  return {
    eligibilityStatus:
      "ELIGIBLE_FOR_SEPARATE_PAPER_PROMOTION_APPLY_REVIEW",

    eligibleForSeparatePromotionApplyReview:
      true,

    actualPromotionApplyExecuted:
      false,

    modelId:
      "model-1",

    existingPromotionPreflight: {
      allowed:
        true,

      reason:
        "READY",

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
    },

    safety: {
      applyManualPaperPromotionCalled:
        false,

      realTradingEnabled:
        false,
    },
  };
}

async function main() {
  let eligibilityCalls =
    0;

  const waiting =
    await runPaperPromotionApplyApprovalGateV1({
      eligibilityRunner:
        async () => {
          eligibilityCalls +=
            1;

          return waitingEligibility();
        },
    });

  const notEligible =
    await runPaperPromotionApplyApprovalGateV1({
      eligibilityRunner:
        async () => {
          eligibilityCalls +=
            1;

          return blockedEligibility();
        },
    });

  const featureDisabled =
    await runPaperPromotionApplyApprovalGateV1({
      approvalFeatureEnabled:
        false,

      applyApprovalConfirmed:
        true,

      applyApprovalPhrase:
        TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_APPROVAL_PHRASE,

      eligibilityRunner:
        async () => {
          eligibilityCalls +=
            1;

          return readyEligibility();
        },
    });

  const noApproval =
    await runPaperPromotionApplyApprovalGateV1({
      approvalFeatureEnabled:
        true,

      applyApprovalConfirmed:
        false,

      applyApprovalPhrase:
        TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_APPROVAL_PHRASE,

      eligibilityRunner:
        async () => {
          eligibilityCalls +=
            1;

          return readyEligibility();
        },
    });

  const wrongPhrase =
    await runPaperPromotionApplyApprovalGateV1({
      approvalFeatureEnabled:
        true,

      applyApprovalConfirmed:
        true,

      applyApprovalPhrase:
        "APPROVE",

      eligibilityRunner:
        async () => {
          eligibilityCalls +=
            1;

          return readyEligibility();
        },
    });

  const ready =
    await runPaperPromotionApplyApprovalGateV1({
      approvalFeatureEnabled:
        true,

      applyApprovalConfirmed:
        true,

      applyApprovalPhrase:
        TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_APPROVAL_PHRASE,

      eligibilityRunner:
        async () => {
          eligibilityCalls +=
            1;

          return readyEligibility();
        },
    });

  const checks = {
    waitingSafe:
      waiting.approvalStatus ===
        "WAITING_FOR_PAPER_PROMOTION_ELIGIBILITY" &&
      waiting.readyForPromotionApplyDryRun ===
        false,

    notEligibleBlocked:
      notEligible.approvalStatus ===
        "BLOCKED_PAPER_PROMOTION_NOT_ELIGIBLE",

    featureDisabledBlocked:
      featureDisabled.approvalStatus ===
        "PAPER_PROMOTION_APPLY_APPROVAL_FEATURE_DISABLED",

    explicitApprovalRequired:
      noApproval.approvalStatus ===
        "PAPER_PROMOTION_APPLY_APPROVAL_REQUIRED",

    wrongPhraseBlocked:
      wrongPhrase.approvalStatus ===
        "PAPER_PROMOTION_APPLY_APPROVAL_PHRASE_REQUIRED",

    allConditionsReady:
      ready.approvalStatus ===
        "PAPER_PROMOTION_APPLY_DRY_RUN_APPROVAL_READY" &&
      ready.readyForPromotionApplyDryRun ===
        true,

    exactPhraseBound:
      ((ready as { exactApprovalPhrase?: string }).exactApprovalPhrase) ===
        "APPROVE_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY",

    noPromotionApply:
      ready.promotionApplyExecuted ===
        false &&
      ready.safety
        .applyManualPaperPromotionCalled ===
        false &&
      ready.safety
        .promotionRouteCalled ===
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

    eligibilityCalledOncePerCase:
      eligibilityCalls ===
        6,
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
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_APPROVAL_GATE_V1_CONTRACT_VERIFIED",

        checks,

        observations: {
          waiting:
            waiting.approvalStatus,

          notEligible:
            notEligible.approvalStatus,

          featureDisabled:
            featureDisabled.approvalStatus,

          noApproval:
            noApproval.approvalStatus,

          wrongPhrase:
            wrongPhrase.approvalStatus,

          ready:
            ready.approvalStatus,

          eligibilityCalls,
        },

        safety: {
          syntheticOnly:
            true,

          realEligibilityPreflightCalled:
            false,

          applyManualPaperPromotionCalled:
            false,

          promotionRouteCalled:
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
          "STATIC_VERIFY_THEN_RUN_CURRENT_APPROVAL_GATE_EXPECT_WAITING",
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
            "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_APPROVAL_GATE_V1_CONTRACT_FAILED",

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
