// AI_STOCK_LAB_PATCH_FINAL_AUTHORIZATION_CONTRACT_TYPES_V1
// Contract-test-only union narrowing. Runtime promotion behavior is unchanged.
import assert from "node:assert/strict";

import {
  runPaperPromotionFinalAuthorizationGateV1,
  TRUE_FORWARD_OOS_PAPER_PROMOTION_FINAL_AUTHORIZATION_PHRASE,
} from "./true-forward-oos-paper-promotion-final-authorization-gate-v1";

function waitingDryRun() {
  return {
    dryRunStatus:
      "WAITING_FOR_PAPER_PROMOTION_APPLY_APPROVAL",

    dryRunRouteCalled:
      false,

    promotionApplyExecuted:
      false,
  };
}

function failedDryRun() {
  return {
    dryRunStatus:
      "PAPER_PROMOTION_APPLY_DRY_RUN_FAILED",

    dryRunRouteCalled:
      true,

    promotionApplyExecuted:
      false,

    failed: [
      "dryRunEcho",
    ],
  };
}

function verifiedDryRun() {
  return {
    dryRunStatus:
      "PAPER_PROMOTION_APPLY_DRY_RUN_VERIFIED",

    dryRunRouteCalled:
      true,

    promotionApplyExecuted:
      false,

    modelId:
      "model-1",

    requestContract: {
      toStage:
        "PAPER",

      manualApprovalConfirmed:
        true,

      confirmationPhrase:
        "PROMOTE_SHADOW_TO_PAPER",

      dryRun:
        true,
    },

    routeResult: {
      httpStatus:
        200,

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
          "model-1",

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
  };
}

async function main() {
  let dryRunCalls =
    0;

  const waiting =
    await runPaperPromotionFinalAuthorizationGateV1({
      dryRunGateRunner:
        async () => {
          dryRunCalls +=
            1;

          return waitingDryRun();
        },
    });

  const badDryRun =
    await runPaperPromotionFinalAuthorizationGateV1({
      dryRunGateRunner:
        async () => {
          dryRunCalls +=
            1;

          return failedDryRun();
        },
    });

  const featureDisabled =
    await runPaperPromotionFinalAuthorizationGateV1({
      finalAuthorizationFeatureEnabled:
        false,

      finalAuthorizationConfirmed:
        true,

      finalAuthorizationPhrase:
        TRUE_FORWARD_OOS_PAPER_PROMOTION_FINAL_AUTHORIZATION_PHRASE,

      dryRunGateRunner:
        async () => {
          dryRunCalls +=
            1;

          return verifiedDryRun();
        },
    });

  const noAuthorization =
    await runPaperPromotionFinalAuthorizationGateV1({
      finalAuthorizationFeatureEnabled:
        true,

      finalAuthorizationConfirmed:
        false,

      finalAuthorizationPhrase:
        TRUE_FORWARD_OOS_PAPER_PROMOTION_FINAL_AUTHORIZATION_PHRASE,

      dryRunGateRunner:
        async () => {
          dryRunCalls +=
            1;

          return verifiedDryRun();
        },
    });

  const wrongPhrase =
    await runPaperPromotionFinalAuthorizationGateV1({
      finalAuthorizationFeatureEnabled:
        true,

      finalAuthorizationConfirmed:
        true,

      finalAuthorizationPhrase:
        "AUTHORIZE",

      dryRunGateRunner:
        async () => {
          dryRunCalls +=
            1;

          return verifiedDryRun();
        },
    });

  const ready =
    await runPaperPromotionFinalAuthorizationGateV1({
      finalAuthorizationFeatureEnabled:
        true,

      finalAuthorizationConfirmed:
        true,

      finalAuthorizationPhrase:
        TRUE_FORWARD_OOS_PAPER_PROMOTION_FINAL_AUTHORIZATION_PHRASE,

      dryRunGateRunner:
        async () => {
          dryRunCalls +=
            1;

          return verifiedDryRun();
        },
    });

  const checks = {
    waitingSafe:
      waiting.authorizationStatus ===
        "WAITING_FOR_VERIFIED_PROMOTION_APPLY_DRY_RUN" &&
      waiting.readyForActualPromotionExecutionReview ===
        false,

    failedDryRunBlocked:
      badDryRun.authorizationStatus ===
        "BLOCKED_PROMOTION_APPLY_DRY_RUN_NOT_VERIFIED",

    featureDisabledBlocked:
      featureDisabled.authorizationStatus ===
        "PAPER_PROMOTION_FINAL_AUTHORIZATION_FEATURE_DISABLED",

    explicitFinalAuthorizationRequired:
      noAuthorization.authorizationStatus ===
        "PAPER_PROMOTION_FINAL_AUTHORIZATION_REQUIRED",

    wrongPhraseBlocked:
      wrongPhrase.authorizationStatus ===
        "PAPER_PROMOTION_FINAL_AUTHORIZATION_PHRASE_REQUIRED",

    allConditionsReady:
      ready.authorizationStatus ===
        "PAPER_PROMOTION_FINAL_AUTHORIZATION_READY" &&
      ready.readyForActualPromotionExecutionReview ===
        true,

    exactFinalPhraseBound:
      ((ready as { exactFinalAuthorizationPhrase?: string }).exactFinalAuthorizationPhrase) ===
        "AUTHORIZE_TRUE_FORWARD_OOS_PAPER_PROMOTION_FINAL_APPLY",

    verifiedDryRunEvidenceRequired:
      (((ready as { checks?: Record<string, boolean> }).checks ?? {}).dryRunVerified) ===
        true &&
      (((ready as { checks?: Record<string, boolean> }).checks ?? {}).dryRunRequestForcedTrue) ===
        true &&
      (((ready as { checks?: Record<string, boolean> }).checks ?? {}).dryRunPreflightAllowed) ===
        true &&
      (((ready as { checks?: Record<string, boolean> }).checks ?? {}).dryRunCanonicalEvidenceReady) ===
        true,

    stillNoActualPromotion:
      ready.actualPromotionApplyExecuted ===
        false &&
      ready.safety
        .actualPromotionApplyExecuted ===
        false &&
      ready.safety
        .applyManualPaperPromotionCalled ===
        false,

    noTradingSideEffects:
      ready.safety
        .databaseWritesByThisGate ===
        0 &&
      ready.safety
        .ordersCreatedByThisGate ===
        0 &&
      ready.safety
        .positionsChangedByThisGate ===
        0 &&
      ready.safety
        .realTradingEnabledByThisGate ===
        false,

    dryRunCalledOncePerCase:
      dryRunCalls ===
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
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_FINAL_AUTHORIZATION_GATE_V1_CONTRACT_VERIFIED",

        checks,

        observations: {
          waiting:
            waiting.authorizationStatus,

          badDryRun:
            badDryRun.authorizationStatus,

          featureDisabled:
            featureDisabled.authorizationStatus,

          noAuthorization:
            noAuthorization.authorizationStatus,

          wrongPhrase:
            wrongPhrase.authorizationStatus,

          ready:
            ready.authorizationStatus,

          dryRunCalls,
        },

        safety: {
          syntheticOnly:
            true,

          actualDryRunRouteCalled:
            false,

          actualPromotionApplyExecuted:
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
          "STATIC_VERIFY_THEN_RUN_CURRENT_FINAL_AUTHORIZATION_EXPECT_WAITING",
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
            "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_FINAL_AUTHORIZATION_GATE_V1_CONTRACT_FAILED",

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
