import assert from "node:assert/strict";

import {
  runPaperPromotionApplyDryRunOnlyGateV1,
} from "./true-forward-oos-paper-promotion-apply-dry-run-only-gate-v1";

function waitingApproval() {
  return {
    approvalStatus:
      "WAITING_FOR_PAPER_PROMOTION_ELIGIBILITY",

    readyForPromotionApplyDryRun:
      false,

    promotionApplyExecuted:
      false,

    safety: {
      applyManualPaperPromotionCalled:
        false,

      realTradingEnabled:
        false,
    },
  };
}

function blockedApproval() {
  return {
    approvalStatus:
      "PAPER_PROMOTION_APPLY_APPROVAL_REQUIRED",

    readyForPromotionApplyDryRun:
      false,

    promotionApplyExecuted:
      false,

    safety: {
      applyManualPaperPromotionCalled:
        false,

      realTradingEnabled:
        false,
    },
  };
}

function readyApproval() {
  return {
    approvalStatus:
      "PAPER_PROMOTION_APPLY_DRY_RUN_APPROVAL_READY",

    readyForPromotionApplyDryRun:
      true,

    promotionApplyExecuted:
      false,

    eligibility: {
      modelId:
        "model-1",

      eligibilityStatus:
        "ELIGIBLE_FOR_SEPARATE_PAPER_PROMOTION_APPLY_REVIEW",

      eligibleForSeparatePromotionApplyReview:
        true,
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
  let routeCalls =
    0;

  let capturedBody:
    any =
    null;

  const mockReadyRoute =
    async (
      body:
        Record<string, unknown>,
    ) => {
      routeCalls +=
        1;

      capturedBody =
        body;

      return {
        status:
          200,

        payload: {
          ok:
            true,

          dryRun:
            true,

          applied:
            false,

          preflight: {
            allowed:
              true,

            reason:
              "READY",

            modelId:
              body.modelId,

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
        },
      };
    };

  const waiting =
    await runPaperPromotionApplyDryRunOnlyGateV1({
      eligibilityRunner:
        async () => ({
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
        }),

      routeCaller:
        mockReadyRoute,
    });

  const blocked =
    await runPaperPromotionApplyDryRunOnlyGateV1({
      eligibilityRunner:
        async () => ({
          eligibilityStatus:
            "BLOCKED_MANUAL_REVIEW_DECISION_NOT_APPROVED",

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
        }),

      routeCaller:
        mockReadyRoute,
    });

  const ready =
    await runPaperPromotionApplyDryRunOnlyGateV1({
      modelId:
        "model-1",

      approvalFeatureEnabled:
        true,

      applyApprovalConfirmed:
        true,

      applyApprovalPhrase:
        "APPROVE_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY",

      eligibilityRunner:
        async () => ({
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
          },

          safety: {
            applyManualPaperPromotionCalled:
              false,

            realTradingEnabled:
              false,
          },
        }),

      routeCaller:
        mockReadyRoute,
    });

  const badRoute =
    await runPaperPromotionApplyDryRunOnlyGateV1({
      modelId:
        "model-1",

      approvalFeatureEnabled:
        true,

      applyApprovalConfirmed:
        true,

      applyApprovalPhrase:
        "APPROVE_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY",

      eligibilityRunner:
        async () => ({
          eligibilityStatus:
            "ELIGIBLE_FOR_SEPARATE_PAPER_PROMOTION_APPLY_REVIEW",

          eligibleForSeparatePromotionApplyReview:
            true,

          actualPromotionApplyExecuted:
            false,

          modelId:
            "model-1",

          safety: {
            applyManualPaperPromotionCalled:
              false,

            realTradingEnabled:
              false,
          },
        }),

      routeCaller:
        async (
          body:
            Record<string, unknown>,
        ) => ({
          status:
            200,

          payload: {
            dryRun:
              false,

            applied:
              true,

            preflight: {
              allowed:
                true,

              reason:
                "READY",

              modelId:
                body.modelId,

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
            },
          },
        }),
    });

  const checks = {
    waitingSkipsRoute:
      waiting.dryRunStatus ===
        "WAITING_FOR_PAPER_PROMOTION_APPLY_APPROVAL" &&
      waiting.dryRunRouteCalled ===
        false,

    blockedSkipsRoute:
      blocked.dryRunStatus ===
        "BLOCKED_PAPER_PROMOTION_APPLY_APPROVAL_NOT_READY" &&
      blocked.dryRunRouteCalled ===
        false,

    readyDryRunPasses:
      ready.dryRunStatus ===
        "PAPER_PROMOTION_APPLY_DRY_RUN_VERIFIED" &&
      ready.dryRunRouteCalled ===
        true,

    dryRunForcedTrue:
      capturedBody
        ?.dryRun ===
        true,

    existingExactPhraseForced:
      capturedBody
        ?.confirmationPhrase ===
        "PROMOTE_SHADOW_TO_PAPER",

    paperTargetForced:
      capturedBody
        ?.toStage ===
        "PAPER",

    manualApprovalForced:
      capturedBody
        ?.manualApprovalConfirmed ===
        true,

    badRouteBlocked:
      badRoute.dryRunStatus ===
        "PAPER_PROMOTION_APPLY_DRY_RUN_FAILED" &&
      badRoute.failed.includes(
        "dryRunEcho",
      ) &&
      badRoute.failed.includes(
        "routeDidNotReportApplied",
      ),

    noPromotionApplyReported:
      ready.promotionApplyExecuted ===
        false,

    noTradingSideEffectsByGate:
      ready.safety
        .databaseWritesByGate ===
        0 &&
      ready.safety
        .ordersCreatedByGate ===
        0 &&
      ready.safety
        .positionsChangedByGate ===
        0 &&
      ready.safety
        .realTradingEnabledByGate ===
        false,

    routeCalledOnlyForApprovedCases:
      routeCalls ===
        1,
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
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_DRY_RUN_ONLY_GATE_V1_CONTRACT_VERIFIED",

        checks,

        observations: {
          waiting:
            waiting.dryRunStatus,

          blocked:
            blocked.dryRunStatus,

          ready:
            ready.dryRunStatus,

          badRoute:
            {
              dryRunStatus:
                badRoute.dryRunStatus,

              failed:
                badRoute.failed,
            },

          routeCalls,

          capturedRequest: {
            dryRun:
              capturedBody
                ?.dryRun ??
              null,

            toStage:
              capturedBody
                ?.toStage ??
              null,

            manualApprovalConfirmed:
              capturedBody
                ?.manualApprovalConfirmed ??
              null,

            confirmationPhrase:
              capturedBody
                ?.confirmationPhrase ??
              null,
          },
        },

        safety: {
          syntheticOnly:
            true,

          actualPromotionRouteCalled:
            false,

          promotionApplied:
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
          "STATIC_VERIFY_THEN_RUN_CURRENT_DRY_RUN_GATE_EXPECT_WAITING",
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
            "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_DRY_RUN_ONLY_GATE_V1_CONTRACT_FAILED",

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
