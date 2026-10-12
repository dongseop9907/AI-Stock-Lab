import {
  runPaperPromotionApplyDryRunOnlyGateV1,
  type PaperPromotionApplyDryRunOnlyGateInput,
} from "./true-forward-oos-paper-promotion-apply-dry-run-only-gate-v1";

export const TRUE_FORWARD_OOS_PAPER_PROMOTION_FINAL_AUTHORIZATION_PHRASE =
  "AUTHORIZE_TRUE_FORWARD_OOS_PAPER_PROMOTION_FINAL_APPLY" as const;

export interface PaperPromotionFinalAuthorizationGateInput
  extends PaperPromotionApplyDryRunOnlyGateInput {
  finalAuthorizationFeatureEnabled?: boolean;
  finalAuthorizationConfirmed?: boolean;
  finalAuthorizationPhrase?: string;

  dryRunGateRunner?: (
    input: PaperPromotionApplyDryRunOnlyGateInput,
  ) => Promise<any>;
}

export async function runPaperPromotionFinalAuthorizationGateV1(
  input:
    PaperPromotionFinalAuthorizationGateInput = {},
) {
  const dryRunGateRunner =
    input.dryRunGateRunner ??
    runPaperPromotionApplyDryRunOnlyGateV1;

  const dryRun =
    await dryRunGateRunner(
      input,
    );

  if (
    dryRun.dryRunStatus ===
    "WAITING_FOR_PAPER_PROMOTION_APPLY_APPROVAL"
  ) {
    return {
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_FINAL_AUTHORIZATION_GATE_V1",

      authorizationStatus:
        "WAITING_FOR_VERIFIED_PROMOTION_APPLY_DRY_RUN",

      readyForActualPromotionExecutionReview:
        false,

      actualPromotionApplyExecuted:
        false,

      failed:
        [],

      dryRunStatus:
        dryRun.dryRunStatus,

      safety:
        safety(),

      nextGate:
        "WAIT_FOR_VERIFIED_PAPER_PROMOTION_APPLY_DRY_RUN",
    };
  }

  if (
    dryRun.dryRunStatus !==
      "PAPER_PROMOTION_APPLY_DRY_RUN_VERIFIED"
  ) {
    return {
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_FINAL_AUTHORIZATION_GATE_V1",

      authorizationStatus:
        "BLOCKED_PROMOTION_APPLY_DRY_RUN_NOT_VERIFIED",

      readyForActualPromotionExecutionReview:
        false,

      actualPromotionApplyExecuted:
        false,

      failed: [
        "PROMOTION_APPLY_DRY_RUN_NOT_VERIFIED",
      ],

      dryRunStatus:
        dryRun.dryRunStatus,

      safety:
        safety(),

      nextGate:
        "STOP_BEFORE_ANY_ACTUAL_PAPER_PROMOTION",
    };
  }

  const featureEnabled =
    input.finalAuthorizationFeatureEnabled ??
    (
      process.env
        .ENABLE_TRUE_FORWARD_OOS_PAPER_PROMOTION_FINAL_AUTHORIZATION ===
      "true"
    );

  if (
    featureEnabled !==
    true
  ) {
    return blocked(
      "PAPER_PROMOTION_FINAL_AUTHORIZATION_FEATURE_DISABLED",
      "ENABLE_TRUE_FORWARD_OOS_PAPER_PROMOTION_FINAL_AUTHORIZATION=true",
      dryRun,
    );
  }

  if (
    input.finalAuthorizationConfirmed !==
    true
  ) {
    return blocked(
      "PAPER_PROMOTION_FINAL_AUTHORIZATION_REQUIRED",
      "SET_finalAuthorizationConfirmed=true",
      dryRun,
    );
  }

  if (
    input.finalAuthorizationPhrase !==
    TRUE_FORWARD_OOS_PAPER_PROMOTION_FINAL_AUTHORIZATION_PHRASE
  ) {
    return blocked(
      "PAPER_PROMOTION_FINAL_AUTHORIZATION_PHRASE_REQUIRED",
      TRUE_FORWARD_OOS_PAPER_PROMOTION_FINAL_AUTHORIZATION_PHRASE,
      dryRun,
    );
  }

  const checks = {
    dryRunVerified:
      dryRun.dryRunStatus ===
      "PAPER_PROMOTION_APPLY_DRY_RUN_VERIFIED",

    dryRunRouteWasCalled:
      dryRun.dryRunRouteCalled ===
      true,

    dryRunDidNotApply:
      dryRun.promotionApplyExecuted ===
      false,

    dryRunRequestForcedTrue:
      dryRun.requestContract
        ?.dryRun ===
      true,

    dryRunTargetPaper:
      dryRun.requestContract
        ?.toStage ===
      "PAPER",

    dryRunExistingPhraseCorrect:
      dryRun.requestContract
        ?.confirmationPhrase ===
      "PROMOTE_SHADOW_TO_PAPER",

    dryRunPreflightAllowed:
      dryRun.routeResult
        ?.preflight
        ?.allowed ===
      true,

    dryRunPreflightReasonReady:
      dryRun.routeResult
        ?.preflight
        ?.reason ===
      "READY",

    dryRunCanonicalEvidenceReady:
      dryRun.routeResult
        ?.preflight
        ?.canonicalShadowOutcomeEvidenceReady ===
      true,

    finalFeatureEnabled:
      featureEnabled ===
      true,

    finalAuthorizationConfirmed:
      input.finalAuthorizationConfirmed ===
      true,

    finalAuthorizationPhraseMatched:
      input.finalAuthorizationPhrase ===
      TRUE_FORWARD_OOS_PAPER_PROMOTION_FINAL_AUTHORIZATION_PHRASE,

    actualPromotionStillNotExecuted:
      true,
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
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_FINAL_AUTHORIZATION_GATE_V1",

    authorizationStatus:
      failed.length ===
      0
        ? "PAPER_PROMOTION_FINAL_AUTHORIZATION_READY"
        : "PAPER_PROMOTION_FINAL_AUTHORIZATION_FAILED",

    readyForActualPromotionExecutionReview:
      failed.length ===
      0,

    actualPromotionApplyExecuted:
      false,

    exactFinalAuthorizationPhrase:
      TRUE_FORWARD_OOS_PAPER_PROMOTION_FINAL_AUTHORIZATION_PHRASE,

    modelId:
      dryRun.modelId ??
      null,

    dryRunEvidence: {
      dryRunStatus:
        dryRun.dryRunStatus,

      dryRunRouteCalled:
        dryRun.dryRunRouteCalled ??
        false,

      requestContract:
        dryRun.requestContract ??
        null,

      routeResult:
        dryRun.routeResult ??
        null,
    },

    checks,
    failed,

    safety:
      safety(),

    nextGate:
      failed.length ===
      0
        ? "READY_FOR_SEPARATE_ACTUAL_PAPER_PROMOTION_EXECUTION_REVIEW_ONLY"
        : "STOP_BEFORE_ANY_ACTUAL_PAPER_PROMOTION",
  };
}

function blocked(
  authorizationStatus:
    string,
  required:
    string,
  dryRun:
    any,
) {
  return {
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_FINAL_AUTHORIZATION_GATE_V1",

    authorizationStatus,

    readyForActualPromotionExecutionReview:
      false,

    actualPromotionApplyExecuted:
      false,

    required,

    dryRunStatus:
      dryRun.dryRunStatus,

    modelId:
      dryRun.modelId ??
      null,

    failed:
      [],

    safety:
      safety(),

    nextGate:
      "WAIT_FOR_EXPLICIT_FINAL_PAPER_PROMOTION_AUTHORIZATION",
  };
}

function safety() {
  return {
    readOnlyAuthorizationGate:
      true,

    authorizationRecordWritten:
      false,

    actualPromotionApplyExecuted:
      false,

    applyManualPaperPromotionCalled:
      false,

    promotionRouteCalledByThisGate:
      false,

    modelStageChangedByThisGate:
      false,

    promotionEventWrittenByThisGate:
      false,

    databaseWritesByThisGate:
      0,

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
    await runPaperPromotionFinalAuthorizationGateV1();

  console.log(
    JSON.stringify(
      result,
      null,
      2,
    ),
  );

  process.exitCode =
    result.authorizationStatus ===
      "PAPER_PROMOTION_FINAL_AUTHORIZATION_FAILED" ||
    result.authorizationStatus.startsWith(
      "BLOCKED_",
    )
      ? 1
      : 0;
}

if (
  process.argv[1]?.endsWith(
    "true-forward-oos-paper-promotion-final-authorization-gate-v1.ts",
  )
) {
  main().catch(
    error => {
      console.error(
        JSON.stringify(
          {
            status:
              "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_FINAL_AUTHORIZATION_GATE_V1_ERROR",

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
