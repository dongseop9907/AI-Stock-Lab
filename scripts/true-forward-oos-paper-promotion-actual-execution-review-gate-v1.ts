import fs from "node:fs";
import path from "node:path";

import {
  runPaperPromotionFinalAuthorizationGateV1,
  type PaperPromotionFinalAuthorizationGateInput,
} from "./true-forward-oos-paper-promotion-final-authorization-gate-v1";

const ROOT =
  process.cwd();

const ACTUAL_APPLY_SOURCE_FILE =
  path.resolve(
    ROOT,
    "lib/models/model-promotion-manual-apply.ts",
  );

export interface ActualPromotionExecutionReviewGateInput
  extends PaperPromotionFinalAuthorizationGateInput {
  applySourceText?: string;

  finalAuthorizationRunner?: (
    input: PaperPromotionFinalAuthorizationGateInput,
  ) => Promise<any>;
}

export function auditActualPromotionMutationContractV1(
  sourceText: string,
) {
  const source =
    String(
      sourceText ??
      "",
    );

  const eventInsertIndex =
    source.indexOf(
      '.from(\n        "model_promotion_events",',
    );

  const stageUpdateIndex =
    source.indexOf(
      '.from(\n        "ai_model_versions",',
      Math.max(
        0,
        eventInsertIndex + 1,
      ),
    );

  const compensationDeleteIndex =
    source.indexOf(
      ".delete()",
      Math.max(
        0,
        stageUpdateIndex + 1,
      ),
    );

  const checks = {
    applyFunctionExists:
      source.includes(
        "export async function applyManualPaperPromotion("
      ),

    applyCallsPreflightFirst:
      source.includes(
        "const preflight ="
      ) &&
      source.includes(
        "await preflightManualPaperPromotion("
      ) &&
      source.indexOf(
        "await preflightManualPaperPromotion("
      ) <
      source.indexOf(
        '.from(\n        "model_promotion_events",'
      ),

    preflightFailClosed:
      source.includes(
        "!preflight.allowed"
      ) &&
      source.includes(
        "MODEL_PROMOTION_MANUAL_APPLY_BLOCKED:"
      ),

    featureFlagRequired:
      source.includes(
        "ENABLE_MANUAL_MODEL_PROMOTION_APPLY"
      ),

    eventInsertExists:
      eventInsertIndex >=
      0,

    eventInsertedBeforeStageUpdate:
      eventInsertIndex >=
        0 &&
      stageUpdateIndex >
        eventInsertIndex,

    eventModelId:
      source.includes(
        "model_id:\n          input.modelId"
      ),

    eventFromShadow:
      source.includes(
        'from_stage:\n          "SHADOW"'
      ),

    eventToPaper:
      source.includes(
        'to_stage:\n          "PAPER"'
      ),

    eventTransitionKind:
      source.includes(
        "transition_kind:\n          preflight.transitionKind"
      ),

    eventDecision:
      source.includes(
        "decision:\n          recommendation.decision"
      ),

    eventRequiresManualApproval:
      source.includes(
        "requires_manual_approval:\n          true"
      ),

    eventManualApprovalConfirmed:
      source.includes(
        "manual_approval_confirmed:\n          true"
      ),

    eventActor:
      source.includes(
        "actor:\n          input.actor"
      ),

    eventReasonTagged:
      source.includes(
        "MANUAL_APPLY_APPROVED:${"
      ),

    eventEvidenceIncludesManualApply:
      source.includes(
        "manualApply: {"
      ) &&
      source.includes(
        "confirmationPhrase:"
      ) &&
      source.includes(
        "canonicalReady:"
      ),

    stageUpdateExists:
      stageUpdateIndex >=
      0,

    stageSetPaper:
      source.includes(
        'promotion_stage:\n          "PAPER"'
      ),

    stageUpdatedAtSet:
      source.includes(
        "promotion_stage_updated_at:\n          now"
      ),

    stageReasonTagged:
      source.includes(
        "MANUAL_APPLY:${"
      ),

    stageUpdateMatchesModelId:
      source.includes(
        '.eq(\n        "id",\n        input.modelId,'
      ),

    stageUpdateCompareAndSetShadow:
      source.includes(
        '.eq(\n        "promotion_stage",\n        "SHADOW",'
      ),

    stageUpdateReturnsRow:
      source.includes(
        '"id,purpose,status,promotion_stage,promotion_stage_updated_at,promotion_stage_reason"'
      ) &&
      source.includes(
        ".maybeSingle();"
      ),

    updateFailureDetected:
      source.includes(
        "updateError ||"
      ) &&
      source.includes(
        "!updated"
      ),

    compensationDeleteExists:
      compensationDeleteIndex >
      stageUpdateIndex,

    compensationTargetsInsertedEvent:
      source.includes(
        '.delete()\n      .eq(\n        "id",\n        event.id,'
      ),

    compensationBeforeStageUpdateErrorThrow:
      compensationDeleteIndex >=
        0 &&
      source.indexOf(
        "MODEL_PROMOTION_MANUAL_APPLY_STAGE_UPDATE_FAILED:",
        compensationDeleteIndex,
      ) >
        compensationDeleteIndex,

    exactPhraseStillBound:
      source.includes(
        '"PROMOTE_SHADOW_TO_PAPER" as const'
      ),

    entryTimingOnly:
      source.includes(
        'model.purpose !==\n      "ENTRY_TIMING"'
      ),

    canonicalEvidenceFailClosed:
      source.includes(
        '"CANONICAL_OUTCOME_EVIDENCE_NOT_READY"'
      ),

    recommendationMustBeReady:
      source.includes(
        '"SHADOW_PAPER_CANONICAL_OUTCOME_EVIDENCE_READY"'
      ),
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
    contractStatus:
      failed.length ===
      0
        ? "ACTUAL_PROMOTION_MUTATION_CONTRACT_VERIFIED"
        : "ACTUAL_PROMOTION_MUTATION_CONTRACT_DRIFTED",

    checks,
    failed,

    mutationOrder: {
      eventInsertBeforeStageUpdate:
        eventInsertIndex >=
          0 &&
        stageUpdateIndex >
          eventInsertIndex,

      compensationDeleteAfterStageUpdateAttempt:
        compensationDeleteIndex >
        stageUpdateIndex,
    },

    expectedMutationContract: {
      first:
        "INSERT model_promotion_events SHADOW_TO_PAPER",

      second:
        "COMPARE_AND_SET ai_model_versions SHADOW_TO_PAPER",

      onSecondFailure:
        "DELETE_INSERTED_PROMOTION_EVENT_THEN_THROW",

      stageReason:
        "MANUAL_APPLY:<reason>",

      eventReason:
        "MANUAL_APPLY_APPROVED:<reason>",
    },
  };
}

export async function runActualPromotionExecutionReviewGateV1(
  input:
    ActualPromotionExecutionReviewGateInput = {},
) {
  const finalAuthorizationRunner =
    input.finalAuthorizationRunner ??
    runPaperPromotionFinalAuthorizationGateV1;

  const authorization =
    await finalAuthorizationRunner(
      input,
    );

  if (
    authorization.authorizationStatus ===
    "WAITING_FOR_VERIFIED_PROMOTION_APPLY_DRY_RUN"
  ) {
    return {
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_ACTUAL_EXECUTION_REVIEW_GATE_V1",

      reviewStatus:
        "WAITING_FOR_FINAL_PROMOTION_AUTHORIZATION",

      readyForSeparateActualExecutionGate:
        false,

      actualPromotionApplyExecuted:
        false,

      mutationContractInspected:
        false,

      failed:
        [],

      authorizationStatus:
        authorization.authorizationStatus,

      safety:
        safety(),

      nextGate:
        "WAIT_FOR_VERIFIED_PROMOTION_APPLY_DRY_RUN",
    };
  }

  if (
    authorization.authorizationStatus !==
      "PAPER_PROMOTION_FINAL_AUTHORIZATION_READY" ||
    authorization.readyForActualPromotionExecutionReview !==
      true
  ) {
    return {
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_ACTUAL_EXECUTION_REVIEW_GATE_V1",

      reviewStatus:
        "BLOCKED_FINAL_PROMOTION_AUTHORIZATION_NOT_READY",

      readyForSeparateActualExecutionGate:
        false,

      actualPromotionApplyExecuted:
        false,

      mutationContractInspected:
        false,

      failed: [
        "FINAL_PROMOTION_AUTHORIZATION_NOT_READY",
      ],

      authorizationStatus:
        authorization.authorizationStatus,

      safety:
        safety(),

      nextGate:
        "STOP_BEFORE_ANY_ACTUAL_PAPER_PROMOTION",
    };
  }

  const sourceText =
    Object.prototype.hasOwnProperty.call(
      input,
      "applySourceText",
    )
      ? String(
          input.applySourceText ??
          "",
        )
      : fs.readFileSync(
          ACTUAL_APPLY_SOURCE_FILE,
          "utf8",
        );

  const contract =
    auditActualPromotionMutationContractV1(
      sourceText,
    );

  return {
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_ACTUAL_EXECUTION_REVIEW_GATE_V1",

    reviewStatus:
      contract.contractStatus ===
      "ACTUAL_PROMOTION_MUTATION_CONTRACT_VERIFIED"
        ? "ACTUAL_PROMOTION_EXECUTION_REVIEW_READY"
        : "BLOCKED_ACTUAL_PROMOTION_MUTATION_CONTRACT_DRIFT",

    readyForSeparateActualExecutionGate:
      contract.contractStatus ===
      "ACTUAL_PROMOTION_MUTATION_CONTRACT_VERIFIED",

    actualPromotionApplyExecuted:
      false,

    mutationContractInspected:
      true,

    modelId:
      authorization.modelId ??
      null,

    authorizationEvidence: {
      authorizationStatus:
        authorization.authorizationStatus,

      dryRunStatus:
        authorization
          .dryRunEvidence
          ?.dryRunStatus ??
        null,

      dryRunRouteCalled:
        authorization
          .dryRunEvidence
          ?.dryRunRouteCalled ??
        false,
    },

    mutationContract:
      contract,

    failed:
      contract.failed,

    safety:
      safety(),

    nextGate:
      contract.contractStatus ===
      "ACTUAL_PROMOTION_MUTATION_CONTRACT_VERIFIED"
        ? "BUILD_SEPARATE_ACTUAL_PROMOTION_EXECUTION_GATE_WITH_POSTCONDITION_VERIFICATION"
        : "STOP_AND_REVIEW_PROMOTION_MUTATION_CONTRACT_DRIFT",
  };
}

function safety() {
  return {
    readOnlyReviewGate:
      true,

    sourceReadOnly:
      true,

    actualPromotionApplyExecuted:
      false,

    applyManualPaperPromotionCalled:
      false,

    promotionRouteCalledByThisGate:
      false,

    databaseReadsByThisGate:
      0,

    databaseWritesByThisGate:
      0,

    modelStageChangedByThisGate:
      false,

    promotionEventWrittenByThisGate:
      false,

    ordersCreatedByThisGate:
      0,

    positionsChangedByThisGate:
      0,

    controlsChangedByThisGate:
      false,

    realTradingEnabledByThisGate:
      false,
  };
}

async function main() {
  const result =
    await runActualPromotionExecutionReviewGateV1();

  console.log(
    JSON.stringify(
      result,
      null,
      2,
    ),
  );

  process.exitCode =
    result.reviewStatus.startsWith(
      "BLOCKED_",
    )
      ? 1
      : 0;
}

if (
  process.argv[1]?.endsWith(
    "true-forward-oos-paper-promotion-actual-execution-review-gate-v1.ts",
  )
) {
  main().catch(
    error => {
      console.error(
        JSON.stringify(
          {
            status:
              "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_ACTUAL_EXECUTION_REVIEW_GATE_V1_ERROR",

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
