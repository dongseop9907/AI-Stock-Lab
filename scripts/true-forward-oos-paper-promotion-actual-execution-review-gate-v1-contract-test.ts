import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  auditActualPromotionMutationContractV1,
  runActualPromotionExecutionReviewGateV1,
} from "./true-forward-oos-paper-promotion-actual-execution-review-gate-v1";

const ROOT =
  process.cwd();

const ACTUAL_SOURCE =
  fs.readFileSync(
    path.resolve(
      ROOT,
      "lib/models/model-promotion-manual-apply.ts",
    ),
    "utf8",
  );

function waitingAuthorization() {
  return {
    authorizationStatus:
      "WAITING_FOR_VERIFIED_PROMOTION_APPLY_DRY_RUN",

    readyForActualPromotionExecutionReview:
      false,

    actualPromotionApplyExecuted:
      false,
  };
}

function blockedAuthorization() {
  return {
    authorizationStatus:
      "PAPER_PROMOTION_FINAL_AUTHORIZATION_REQUIRED",

    readyForActualPromotionExecutionReview:
      false,

    actualPromotionApplyExecuted:
      false,
  };
}

function readyAuthorization() {
  return {
    authorizationStatus:
      "PAPER_PROMOTION_FINAL_AUTHORIZATION_READY",

    readyForActualPromotionExecutionReview:
      true,

    actualPromotionApplyExecuted:
      false,

    modelId:
      "model-1",

    dryRunEvidence: {
      dryRunStatus:
        "PAPER_PROMOTION_APPLY_DRY_RUN_VERIFIED",

      dryRunRouteCalled:
        true,
    },
  };
}

async function main() {
  const direct =
    auditActualPromotionMutationContractV1(
      ACTUAL_SOURCE,
    );

  const driftedSource =
    ACTUAL_SOURCE.replace(
      '.eq(\n        "promotion_stage",\n        "SHADOW",',
      '.eq(\n        "promotion_stage",\n        "PAPER",',
    );

  const drifted =
    auditActualPromotionMutationContractV1(
      driftedSource,
    );

  const waiting =
    await runActualPromotionExecutionReviewGateV1({
      finalAuthorizationRunner:
        async () =>
          waitingAuthorization(),
    });

  const blocked =
    await runActualPromotionExecutionReviewGateV1({
      finalAuthorizationRunner:
        async () =>
          blockedAuthorization(),
    });

  const ready =
    await runActualPromotionExecutionReviewGateV1({
      applySourceText:
        ACTUAL_SOURCE,

      finalAuthorizationRunner:
        async () =>
          readyAuthorization(),
    });

  const readyButDrifted =
    await runActualPromotionExecutionReviewGateV1({
      applySourceText:
        driftedSource,

      finalAuthorizationRunner:
        async () =>
          readyAuthorization(),
    });

  const checks = {
    actualSourceContractVerified:
      direct.contractStatus ===
        "ACTUAL_PROMOTION_MUTATION_CONTRACT_VERIFIED",

    eventBeforeStageUpdate:
      direct.checks
        .eventInsertedBeforeStageUpdate ===
        true,

    compareAndSetShadow:
      direct.checks
        .stageUpdateCompareAndSetShadow ===
        true,

    compensationDeleteVerified:
      direct.checks
        .compensationDeleteExists ===
        true &&
      direct.checks
        .compensationTargetsInsertedEvent ===
        true &&
      direct.checks
        .compensationBeforeStageUpdateErrorThrow ===
        true,

    waitingSkipsSourceInspection:
      waiting.reviewStatus ===
        "WAITING_FOR_FINAL_PROMOTION_AUTHORIZATION" &&
      waiting.mutationContractInspected ===
        false,

    blockedAuthorizationStops:
      blocked.reviewStatus ===
        "BLOCKED_FINAL_PROMOTION_AUTHORIZATION_NOT_READY",

    readyReviewPasses:
      ready.reviewStatus ===
        "ACTUAL_PROMOTION_EXECUTION_REVIEW_READY" &&
      ready.readyForSeparateActualExecutionGate ===
        true,

    contractDriftBlocks:
      drifted.contractStatus ===
        "ACTUAL_PROMOTION_MUTATION_CONTRACT_DRIFTED" &&
      drifted.failed.includes(
        "stageUpdateCompareAndSetShadow",
      ),

    readyButDriftedBlocks:
      readyButDrifted.reviewStatus ===
        "BLOCKED_ACTUAL_PROMOTION_MUTATION_CONTRACT_DRIFT" &&
      readyButDrifted.readyForSeparateActualExecutionGate ===
        false,

    stillNoActualPromotion:
      ready.actualPromotionApplyExecuted ===
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
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_ACTUAL_EXECUTION_REVIEW_GATE_V1_CONTRACT_VERIFIED",

        checks,

        observations: {
          direct:
            direct.contractStatus,

          waiting:
            waiting.reviewStatus,

          blocked:
            blocked.reviewStatus,

          ready:
            ready.reviewStatus,

          drifted:
            drifted.failed,

          readyButDrifted:
            readyButDrifted.reviewStatus,
        },

        safety: {
          syntheticAuthorizationOnly:
            true,

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
          "STATIC_VERIFY_THEN_RUN_CURRENT_EXECUTION_REVIEW_EXPECT_WAITING",
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
            "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_ACTUAL_EXECUTION_REVIEW_GATE_V1_CONTRACT_FAILED",

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
