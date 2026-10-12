import assert from "node:assert/strict";
import crypto from "node:crypto";

import {
  APPROVE_DECISION,
  REJECT_DECISION,
  MANUAL_REVIEW_DECISION_WRITE_CONFIRM,
  buildManualForwardOosReviewDecisionV1,
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

function buildSources() {
  const observationsDocument = {
    observations: [
      {
        sourceTradingDate:
          "2026-10-08",

        targetSessionDate:
          "2026-10-12",

        stockCode:
          "005930",

        correctedEntry: {
          qualified:
            true,

          directReturns: {
            r1: 0.01,
            r3: 0.02,
            r5: 0.03,
          },
        },

        selectedPolicy: {
          filled:
            true,

          returns: {
            r1: 0.008,
            r3: 0.018,
            r5: 0.025,
          },
        },
      },
    ],
  };

  const evaluatorReport = {
    status:
      "ALPHA_V3_TRUE_FORWARD_OOS_EVALUATED",

    contract: {
      historicalCutoff:
        "2026-10-07",

      selectedCap:
        0.01,

      entryScoreThreshold:
        0.66,

      retuningAllowed:
        false,
    },
  };

  const summaryReport = {
    contract: {
      historicalTargetCutoff:
        "2026-10-07",

      selectedCap:
        0.01,

      entryScoreThreshold:
        0.66,
    },

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
      observations: 1,
      qualifiedObservations: 1,
      filledObservations: 1,
    },

    evaluatorDecision: {
      enoughSample: true,
      fillPassed: true,
      pairedPassed: true,
      forwardOosGatePassed: true,
      nextUse:
        "READY_FOR_MANUAL_FORWARD_OOS_REVIEW",
    },

    summaryDecision: {
      trueForwardReady: true,
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

  return {
    observationsDocument,
    evaluatorReport,
    summaryReport,
    packet,
  };
}

function main() {
  const src =
    buildSources();

  const noDecision =
    buildManualForwardOosReviewDecisionV1({
      ...src,
    });

  const approvePreview =
    buildManualForwardOosReviewDecisionV1({
      ...src,

      decision:
        APPROVE_DECISION,

      write:
        false,

      now:
        new Date(
          "2026-12-15T08:00:00.000Z",
        ),
    });

  const rejectPreview =
    buildManualForwardOosReviewDecisionV1({
      ...src,

      decision:
        REJECT_DECISION,

      write:
        false,
    });

  const wrongConfirm =
    buildManualForwardOosReviewDecisionV1({
      ...src,

      decision:
        APPROVE_DECISION,

      write:
        true,

      confirm:
        "WRONG",
    });

  let writes = 0;

  const recorded =
    buildManualForwardOosReviewDecisionV1({
      ...src,

      decision:
        APPROVE_DECISION,

      write:
        true,

      confirm:
        MANUAL_REVIEW_DECISION_WRITE_CONFIRM,

      writer:
        () => {
          writes += 1;
        },
    });

  const drifted =
    buildManualForwardOosReviewDecisionV1({
      ...src,

      observationsDocument: {
        observations: [
          ...src
            .observationsDocument
            .observations,

          {
            sourceTradingDate:
              "2026-10-12",

            targetSessionDate:
              "2026-10-13",

            stockCode:
              "000660",
          },
        ],
      },

      decision:
        APPROVE_DECISION,
    });

  const checks = {
    explicitDecisionRequired:
      noDecision.decisionStatus ===
      "DECISION_BLOCKED_EXPLICIT_DECISION_REQUIRED",

    approveIsPreviewOnly:
      approvePreview.decisionStatus ===
        "DECISION_READY_PREVIEW_ONLY" &&
      approvePreview.decisionRecorded ===
        false,

    approvalDoesNotApprovePromotion:
      approvePreview.record
        ?.decisionSemantics
        ?.promotionApproved ===
        false &&
      approvePreview.record
        ?.decisionSemantics
        ?.paperPromotionExecuted ===
        false,

    rejectContinuesCollection:
      rejectPreview.record
        ?.decision ===
        REJECT_DECISION,

    wrongConfirmationBlocked:
      wrongConfirm.decisionStatus ===
      "DECISION_WRITE_BLOCKED_EXACT_CONFIRMATION_REQUIRED",

    exactConfirmationWritesOnce:
      recorded.decisionStatus ===
        "MANUAL_REVIEW_DECISION_RECORDED" &&
      recorded.decisionRecorded ===
        true &&
      writes ===
        1,

    approvalNextGateStillSeparate:
      recorded.nextGate ===
      "SEPARATE_PAPER_PROMOTION_GATE_STILL_REQUIRES_ITS_OWN_APPROVAL",

    sourceDriftBlocksDecision:
      drifted.decisionStatus ===
      "DECISION_BLOCKED_PACKET_NOT_VERIFIED",

    noPromotion:
      recorded.safety
        .promotionExecuted ===
        false &&
      recorded.safety
        .promotionApproved ===
        false,

    noTradingSideEffects:
      recorded.safety
        .ordersCreated ===
        0 &&
      recorded.safety
        .positionsChanged ===
        0 &&
      recorded.safety
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
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_DECISION_V1_CONTRACT_VERIFIED",

        checks,

        observations: {
          noDecision:
            noDecision.decisionStatus,

          approvePreview:
            approvePreview.decisionStatus,

          rejectPreview:
            rejectPreview.decisionStatus,

          wrongConfirm:
            wrongConfirm.decisionStatus,

          recorded:
            recorded.decisionStatus,

          drifted:
            drifted.decisionStatus,

          writeCalls:
            writes,
        },

        safety: {
          syntheticOnly:
            true,

          realDecisionFileWritten:
            false,

          promotionExecuted:
            false,

          promotionApproved:
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
          "STATIC_VERIFY_THEN_RUN_CURRENT_DECISION_PREVIEW_EXPECT_BLOCKED_OR_WAITING",
      },
      null,
      2,
    ),
  );
}

try {
  main();
} catch (error) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_DECISION_V1_CONTRACT_FAILED",

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
}
