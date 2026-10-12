// AI_STOCK_LAB_PATCH_MANUAL_REVIEW_PACKET_CHECKS_TYPE_V2
// Contract-test-only union narrowing for optional checks; runtime production logic unchanged.
import assert from "node:assert/strict";
import crypto from "node:crypto";

import {
  auditManualReviewPacketIntegrityV1,
} from "./true-forward-oos-manual-review-packet-integrity-v1";

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

function sources() {
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

  return {
    observationsDocument,
    evaluatorReport,
    summaryReport,
  };
}

function makePacket(
  src:
    ReturnType<
      typeof sources
    >,
) {
  const core = {
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
          src.observationsDocument,
        ),

      evaluatorSha256:
        sha256(
          src.evaluatorReport,
        ),

      summarySha256:
        sha256(
          src.summaryReport,
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

  return {
    ...core,

    packetSha256:
      sha256(
        core,
      ),
  };
}

function main() {
  const src =
    sources();

  const packet =
    makePacket(
      src,
    );

  const waiting =
    auditManualReviewPacketIntegrityV1({
      packet:
        undefined,

      observationsDocument:
        src.observationsDocument,

      evaluatorReport:
        src.evaluatorReport,

      summaryReport:
        src.summaryReport,
    });

  const verified =
    auditManualReviewPacketIntegrityV1({
      packet,

      ...src,
    });

  const tamperedPacket = {
    ...packet,

    frozenContract: {
      ...packet.frozenContract,

      selectedCap:
        0.02,
    },
  };

  const tampered =
    auditManualReviewPacketIntegrityV1({
      packet:
        tamperedPacket,

      ...src,
    });

  const changedObservations = {
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
  };

  const drift =
    auditManualReviewPacketIntegrityV1({
      packet,

      observationsDocument:
        changedObservations,

      evaluatorReport:
        src.evaluatorReport,

      summaryReport:
        src.summaryReport,
    });

  const checks = {
    waitingSafe:
      waiting.integrityStatus ===
        "WAITING_FOR_REVIEW_PACKET" &&
      waiting.reviewAllowed ===
        false,

    verifiedPass:
      verified.integrityStatus ===
        "REVIEW_PACKET_INTEGRITY_VERIFIED" &&
      verified.reviewAllowed ===
        true,

    packetTamperBlocked:
      tampered.integrityStatus ===
        "REVIEW_PACKET_INTEGRITY_FAILED" &&
      tampered.failed.includes(
        "packetHashMatches",
      ),

    sourceDriftBlocked:
      drift.integrityStatus ===
        "REVIEW_PACKET_SOURCE_DRIFT_DETECTED" &&
      drift.reviewAllowed ===
        false &&
      drift.failed.includes(
        "observationsSourceHashMatches",
      ),

    frozenContractChecked:
      ((verified as { checks?: Record<string, boolean> }).checks ?? {})
        .historicalCutoffFrozen ===
        true &&
      ((verified as { checks?: Record<string, boolean> }).checks ?? {})
        .selectedCapFrozen ===
        true &&
      ((verified as { checks?: Record<string, boolean> }).checks ?? {})
        .entryThresholdFrozen ===
        true &&
      ((verified as { checks?: Record<string, boolean> }).checks ?? {})
        .retuningDisabled ===
        true,

    noPromotion:
      verified.safety
        .promotionExecuted ===
        false &&
      verified.safety
        .automaticPromotion ===
        false,

    readOnly:
      verified.safety
        .readOnly ===
        true,

    noTradingSideEffects:
      verified.safety
        .ordersCreated ===
        0 &&
      verified.safety
        .positionsChanged ===
        0 &&
      verified.safety
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
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_PACKET_INTEGRITY_V1_CONTRACT_VERIFIED",

        checks,

        observations: {
          waiting:
            waiting.integrityStatus,

          verified:
            verified.integrityStatus,

          tampered:
            tampered.failed,

          drift:
            drift.failed,
        },

        safety: {
          syntheticOnly:
            true,

          packetWritten:
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
          "STATIC_VERIFY_THEN_RUN_CURRENT_READ_ONLY_PACKET_INTEGRITY",
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
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_PACKET_INTEGRITY_V1_CONTRACT_FAILED",

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
