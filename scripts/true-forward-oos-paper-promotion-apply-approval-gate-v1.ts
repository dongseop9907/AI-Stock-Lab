import {
  runPaperPromotionEligibilityPreflightV1,
  type PaperPromotionEligibilityPreflightInput,
} from "./true-forward-oos-paper-promotion-eligibility-preflight-v1";

export const TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_APPROVAL_PHRASE =
  "APPROVE_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY" as const;

export interface PaperPromotionApplyApprovalGateInput
  extends PaperPromotionEligibilityPreflightInput {
  applyApprovalConfirmed?: boolean;
  applyApprovalPhrase?: string;
  approvalFeatureEnabled?: boolean;

  eligibilityRunner?: (
    input: PaperPromotionEligibilityPreflightInput,
  ) => Promise<any>;
}

export async function runPaperPromotionApplyApprovalGateV1(
  input:
    PaperPromotionApplyApprovalGateInput = {},
) {
  const eligibilityRunner =
    input.eligibilityRunner ??
    runPaperPromotionEligibilityPreflightV1;

  const eligibility =
    await eligibilityRunner(
      input,
    );

  if (
    eligibility.eligibilityStatus ===
    "WAITING_FOR_VERIFIED_MANUAL_REVIEW_DECISION"
  ) {
    return {
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_APPROVAL_GATE_V1",

      approvalStatus:
        "WAITING_FOR_PAPER_PROMOTION_ELIGIBILITY",

      readyForPromotionApplyDryRun:
        false,

      promotionApplyExecuted:
        false,

      failed:
        [],

      eligibility: {
        eligibilityStatus:
          eligibility.eligibilityStatus,

        eligibleForSeparatePromotionApplyReview:
          eligibility
            .eligibleForSeparatePromotionApplyReview ??
          false,
      },

      safety:
        safety(),

      nextGate:
        "WAIT_FOR_VERIFIED_MANUAL_REVIEW_DECISION",
    };
  }

  if (
    eligibility.eligibilityStatus !==
      "ELIGIBLE_FOR_SEPARATE_PAPER_PROMOTION_APPLY_REVIEW" ||
    eligibility.eligibleForSeparatePromotionApplyReview !==
      true
  ) {
    return {
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_APPROVAL_GATE_V1",

      approvalStatus:
        "BLOCKED_PAPER_PROMOTION_NOT_ELIGIBLE",

      readyForPromotionApplyDryRun:
        false,

      promotionApplyExecuted:
        false,

      failed: [
        "PAPER_PROMOTION_ELIGIBILITY_NOT_READY",
      ],

      eligibility: {
        eligibilityStatus:
          eligibility.eligibilityStatus,

        eligibleForSeparatePromotionApplyReview:
          eligibility
            .eligibleForSeparatePromotionApplyReview ??
          false,
      },

      safety:
        safety(),

      nextGate:
        "KEEP_SHADOW_AND_WAIT_OR_REPAIR_ELIGIBILITY",
    };
  }

  const featureEnabled =
    input.approvalFeatureEnabled ??
    (
      process.env
        .ENABLE_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_APPROVAL ===
      "true"
    );

  if (
    featureEnabled !==
    true
  ) {
    return blocked(
      "PAPER_PROMOTION_APPLY_APPROVAL_FEATURE_DISABLED",
      "ENABLE_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_APPROVAL=true",
      eligibility,
    );
  }

  if (
    input.applyApprovalConfirmed !==
    true
  ) {
    return blocked(
      "PAPER_PROMOTION_APPLY_APPROVAL_REQUIRED",
      "SET_applyApprovalConfirmed=true",
      eligibility,
    );
  }

  if (
    input.applyApprovalPhrase !==
    TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_APPROVAL_PHRASE
  ) {
    return blocked(
      "PAPER_PROMOTION_APPLY_APPROVAL_PHRASE_REQUIRED",
      TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_APPROVAL_PHRASE,
      eligibility,
    );
  }

  const checks = {
    eligibilityPassed:
      eligibility.eligibilityStatus ===
        "ELIGIBLE_FOR_SEPARATE_PAPER_PROMOTION_APPLY_REVIEW" &&
      eligibility.eligibleForSeparatePromotionApplyReview ===
        true,

    approvalFeatureEnabled:
      featureEnabled ===
        true,

    explicitApplyApprovalConfirmed:
      input.applyApprovalConfirmed ===
        true,

    exactApplyApprovalPhraseMatched:
      input.applyApprovalPhrase ===
        TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_APPROVAL_PHRASE,

    noPromotionApplyExecuted:
      eligibility.actualPromotionApplyExecuted ===
        false &&
      eligibility.safety
        ?.applyManualPaperPromotionCalled ===
        false,

    realTradingStillDisabled:
      eligibility.safety
        ?.realTradingEnabled ===
        false,
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
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_APPROVAL_GATE_V1",

    approvalStatus:
      failed.length ===
      0
        ? "PAPER_PROMOTION_APPLY_DRY_RUN_APPROVAL_READY"
        : "PAPER_PROMOTION_APPLY_APPROVAL_FAILED",

    readyForPromotionApplyDryRun:
      failed.length ===
      0,

    promotionApplyExecuted:
      false,

    exactApprovalPhrase:
      TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_APPROVAL_PHRASE,

    eligibility: {
      eligibilityStatus:
        eligibility.eligibilityStatus,

      eligibleForSeparatePromotionApplyReview:
        eligibility
          .eligibleForSeparatePromotionApplyReview,

      modelId:
        eligibility.modelId ??
        null,

      existingPromotionPreflight:
        eligibility.existingPromotionPreflight ??
        null,
    },

    checks,
    failed,

    safety:
      safety(),

    nextGate:
      failed.length ===
      0
        ? "BUILD_PROMOTION_APPLY_DRY_RUN_ONLY_GATE"
        : "STOP_AND_INSPECT_PAPER_PROMOTION_APPLY_APPROVAL_GATE",
  };
}

function blocked(
  approvalStatus:
    string,
  required:
    string,
  eligibility:
    any,
) {
  return {
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_APPROVAL_GATE_V1",

    approvalStatus,

    readyForPromotionApplyDryRun:
      false,

    promotionApplyExecuted:
      false,

    required,

    eligibility: {
      eligibilityStatus:
        eligibility.eligibilityStatus,

      eligibleForSeparatePromotionApplyReview:
        eligibility
          .eligibleForSeparatePromotionApplyReview ??
        false,

      modelId:
        eligibility.modelId ??
        null,
    },

    failed:
      [],

    safety:
      safety(),

    nextGate:
      "WAIT_FOR_EXPLICIT_PAPER_PROMOTION_APPLY_APPROVAL",
  };
}

function safety() {
  return {
    readOnly:
      true,

    approvalRecordWritten:
      false,

    promotionApplyExecuted:
      false,

    applyManualPaperPromotionCalled:
      false,

    promotionRouteCalled:
      false,

    modelStageChanged:
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
    await runPaperPromotionApplyApprovalGateV1();

  console.log(
    JSON.stringify(
      result,
      null,
      2,
    ),
  );

  process.exitCode =
    result.approvalStatus ===
      "PAPER_PROMOTION_APPLY_APPROVAL_FAILED"
      ? 1
      : 0;
}

if (
  process.argv[1]?.endsWith(
    "true-forward-oos-paper-promotion-apply-approval-gate-v1.ts",
  )
) {
  main().catch(
    error => {
      console.error(
        JSON.stringify(
          {
            status:
              "AI_STOCK_LAB_TRUE_FORWARD_OOS_PAPER_PROMOTION_APPLY_APPROVAL_GATE_V1_ERROR",

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
