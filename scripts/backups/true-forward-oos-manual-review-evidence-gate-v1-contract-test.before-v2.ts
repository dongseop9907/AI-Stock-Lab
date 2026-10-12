import assert from "node:assert/strict";

import {
  auditManualForwardOosReviewEvidenceGateV1,
} from "./true-forward-oos-manual-review-evidence-gate-v1";

function observation() {
  return {
    sourceTradingDate:
      "2026-10-08",

    targetSessionDate:
      "2026-10-12",

    stockCode:
      "005930",

    correctedEntry: {
      qualified:
        true,

      observedAt:
        "2026-10-12T00:01:00.000Z",

      directReturns: {
        r1:
          0.01,

        r3:
          0.02,

        r5:
          0.03,
      },
    },

    selectedPolicy: {
      filled:
        true,

      returns: {
        r1:
          0.008,

        r3:
          0.018,

        r5:
          0.025,
      },
    },
  };
}

function evaluator(
  gatePassed:
    boolean,
) {
  return {
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

    evaluation: {
      counts: {
        observations:
          1,

        qualifiedObservations:
          1,

        filledObservations:
          1,
      },

      decision: {
        enoughSample:
          gatePassed,

        fillPassed:
          true,

        pairedPassed:
          gatePassed,

        forwardOosGatePassed:
          gatePassed,

        nextUse:
          gatePassed
            ? "READY_FOR_MANUAL_FORWARD_OOS_REVIEW"
            : "CONTINUE_TRUE_FORWARD_OOS_COLLECTION",
      },
    },

    outputFile:
      "logs/alpha-v3-entry-v3-forward-shadow-oos.json",
  };
}

function summary(
  enoughEvidence:
    boolean,
) {
  return {
    contract: {
      historicalTargetCutoff:
        "2026-10-07",

      selectedCap:
        0.01,

      entryScoreThreshold:
        0.66,
    },

    decision: {
      trueForwardReady:
        true,

      productionPolicyLocked:
        false,

      enoughEvidenceForFinalEntryGate:
        enoughEvidence,
    },

    safety: {
      databaseWrites:
        0,

      ordersCreated:
        0,

      positionsChanged:
        0,
    },
  };
}

function main() {
  const waiting =
    auditManualForwardOosReviewEvidenceGateV1({
      observationsDocument:
        undefined,

      evaluatorReport:
        undefined,

      summaryReport:
        undefined,
    });

  const notReady =
    auditManualForwardOosReviewEvidenceGateV1({
      observationsDocument: {
        observations: [
          observation(),
        ],
      },

      evaluatorReport:
        evaluator(
          false,
        ),

      summaryReport:
        summary(
          false,
        ),
    });

  const ready =
    auditManualForwardOosReviewEvidenceGateV1({
      observationsDocument: {
        observations: [
          observation(),
        ],
      },

      evaluatorReport:
        evaluator(
          true,
        ),

      summaryReport:
        summary(
          true,
        ),
    });

  const missingSummary =
    auditManualForwardOosReviewEvidenceGateV1({
      observationsDocument: {
        observations: [
          observation(),
        ],
      },

      evaluatorReport:
        evaluator(
          true,
        ),

      summaryReport:
        undefined,
    });

  const unsafeSummary =
    auditManualForwardOosReviewEvidenceGateV1({
      observationsDocument: {
        observations: [
          observation(),
        ],
      },

      evaluatorReport:
        evaluator(
          true,
        ),

      summaryReport: {
        ...summary(
          true,
        ),

        safety: {
          databaseWrites:
            1,

          ordersCreated:
            0,

          positionsChanged:
            0,
        },
      },
    });

  const checks = {
    waitingSafe:
      waiting.gateStatus ===
      "WAITING_FOR_FORWARD_OOS_EVIDENCE",

    notReadyContinuesCollection:
      notReady.gateStatus ===
      "NOT_READY_FOR_MANUAL_REVIEW" &&
      notReady.reviewReady ===
      false,

    readyForManualReviewOnly:
      ready.gateStatus ===
      "READY_FOR_MANUAL_FORWARD_OOS_REVIEW" &&
      ready.reviewReady ===
      true &&
      ready.nextGate ===
      "MANUAL_REVIEW_ONLY_DO_NOT_PROMOTE_AUTOMATICALLY",

    missingSummaryBlocked:
      missingSummary.gateStatus ===
      "BLOCKED_MANUAL_REVIEW_EVIDENCE_INCOMPLETE" &&
      missingSummary.failed.includes(
        "summaryPresent",
      ),

    unsafeSummaryBlocked:
      unsafeSummary.gateStatus ===
      "BLOCKED_MANUAL_REVIEW_EVIDENCE_INCOMPLETE" &&
      unsafeSummary.failed.includes(
        "noSummaryProductionWrites",
      ),

    noPromotionExecution:
      ready.safety
        .promotionExecuted ===
      false,

    noAutoPromotionRecommendation:
      ready.safety
        .promotionRecommendedAutomatically ===
      false,

    noTradingSideEffects:
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
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_EVIDENCE_GATE_V1_CONTRACT_VERIFIED",

        checks,

        observations: {
          waiting:
            waiting.gateStatus,

          notReady:
            notReady.gateStatus,

          ready:
            ready.gateStatus,

          missingSummary:
            missingSummary.failed,

          unsafeSummary:
            unsafeSummary.failed,
        },

        safety: {
          syntheticOnly:
            true,

          evaluatorExecuted:
            false,

          summaryExecuted:
            false,

          promotionExecuted:
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
          "STATIC_VERIFY_THEN_RUN_CURRENT_READ_ONLY_MANUAL_REVIEW_GATE",
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
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_EVIDENCE_GATE_V1_CONTRACT_FAILED",

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
