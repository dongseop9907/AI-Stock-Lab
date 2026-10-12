import assert from "node:assert/strict";
import crypto from "node:crypto";

import {
  auditManualReviewDecisionIntegrityV1,
} from "./true-forward-oos-manual-review-decision-integrity-v1";

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
      "synthetic contract",

    packetReference: {
      packetSha256:
        packet.packetSha256,

      observationsSha256:
        packet
          .sourceHashes
          .observationsSha256,

      evaluatorSha256:
        packet
          .sourceHashes
          .evaluatorSha256,

      summarySha256:
        packet
          .sourceHashes
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

function main() {
  const approve =
    fixtures(
      APPROVE_DECISION,
    );

  const reject =
    fixtures(
      REJECT_DECISION,
    );

  const waiting =
    auditManualReviewDecisionIntegrityV1({
      decisionRecord:
        undefined,
    });

  const approveVerified =
    auditManualReviewDecisionIntegrityV1({
      ...approve,
    });

  const rejectVerified =
    auditManualReviewDecisionIntegrityV1({
      ...reject,
    });

  const tamperedDecision = {
    ...approve.decisionRecord,

    note:
      "tampered",
  };

  const tampered =
    auditManualReviewDecisionIntegrityV1({
      ...approve,

      decisionRecord:
        tamperedDecision,
    });

  const changedPacket = {
    ...approve.packet,

    generatedAt:
      "2026-12-16T00:00:00.000Z",
  };

  const drifted =
    auditManualReviewDecisionIntegrityV1({
      ...approve,

      packet:
        changedPacket,
    });

  const checks = {
    waitingSafe:
      waiting.integrityStatus ===
        "WAITING_FOR_MANUAL_REVIEW_DECISION",

    approveIntegrityPasses:
      approveVerified.integrityStatus ===
      "MANUAL_REVIEW_DECISION_INTEGRITY_VERIFIED",

    approveEligibleForPromotionReviewOnly:
      approveVerified.paperPromotionReviewEligible ===
        true &&
      approveVerified.nextGate ===
        "BUILD_SEPARATE_PAPER_PROMOTION_ELIGIBILITY_PREFLIGHT",

    rejectContinuesOos:
      rejectVerified.integrityStatus ===
        "MANUAL_REVIEW_DECISION_INTEGRITY_VERIFIED" &&
      rejectVerified.paperPromotionReviewEligible ===
        false &&
      rejectVerified.continueForwardOos ===
        true,

    decisionTamperBlocked:
      tampered.integrityStatus ===
        "MANUAL_REVIEW_DECISION_INTEGRITY_FAILED" &&
      tampered.failed.includes(
        "decisionHashMatches",
      ),

    packetDriftBlocksDecision:
      drifted.paperPromotionReviewEligible ===
      false,

    noPromotion:
      approveVerified.safety
        .promotionExecuted ===
        false &&
      approveVerified.safety
        .promotionApproved ===
        false,

    readOnly:
      approveVerified.safety
        .readOnly ===
        true,

    noTradingSideEffects:
      approveVerified.safety
        .ordersCreated ===
        0 &&
      approveVerified.safety
        .positionsChanged ===
        0 &&
      approveVerified.safety
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
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_DECISION_INTEGRITY_V1_CONTRACT_VERIFIED",

        checks,

        observations: {
          waiting:
            waiting.integrityStatus,

          approve:
            {
              integrityStatus:
                approveVerified.integrityStatus,

              paperPromotionReviewEligible:
                approveVerified.paperPromotionReviewEligible,
            },

          reject:
            {
              integrityStatus:
                rejectVerified.integrityStatus,

              continueForwardOos:
                rejectVerified.continueForwardOos,
            },

          tampered:
            tampered.failed,

          drifted:
            {
              integrityStatus:
                drifted.integrityStatus,

              failed:
                drifted.failed,
            },
        },

        safety: {
          syntheticOnly:
            true,

          promotionExecuted:
            false,

          promotionApproved:
            false,

          databaseWrites:
            0,

          fileWrites:
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
          "STATIC_VERIFY_THEN_RUN_CURRENT_DECISION_INTEGRITY_EXPECT_WAITING",
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
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_DECISION_INTEGRITY_V1_CONTRACT_FAILED",

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
