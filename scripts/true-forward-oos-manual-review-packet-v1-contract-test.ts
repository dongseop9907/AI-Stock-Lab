import assert from "node:assert/strict";

import {
  MANUAL_REVIEW_PACKET_WRITE_CONFIRM,
  buildManualForwardOosReviewPacketV1,
} from "./true-forward-oos-manual-review-packet-v1";

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
  };
}

function evaluator() {
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
    },

    outputFile:
      "logs/alpha-v3-entry-v3-forward-shadow-oos.json",
  };
}

function summary() {
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
        true,
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

function baseInput() {
  return {
    now:
      new Date(
        "2026-12-15T07:00:00.000Z",
      ),

    observationsDocument: {
      observations: [
        observation(),
      ],
    },

    evaluatorReport:
      evaluator(),

    summaryReport:
      summary(),
  };
}

function main() {
  const waiting =
    buildManualForwardOosReviewPacketV1({
      observationsDocument:
        undefined,

      evaluatorReport:
        undefined,

      summaryReport:
        undefined,
    });

  const preview =
    buildManualForwardOosReviewPacketV1({
      ...baseInput(),

      write:
        false,
    });

  const wrongConfirm =
    buildManualForwardOosReviewPacketV1({
      ...baseInput(),

      write:
        true,

      confirm:
        "WRONG",
    });

  let writes =
    0;

  let writtenFile =
    "";

  let writtenText =
    "";

  const written =
    buildManualForwardOosReviewPacketV1({
      ...baseInput(),

      write:
        true,

      confirm:
        MANUAL_REVIEW_PACKET_WRITE_CONFIRM,

      writer: (
        file,
        text,
      ) => {
        writes += 1;
        writtenFile =
          file;
        writtenText =
          text;
      },
    });

  const checks = {
    waitingNoPacket:
      waiting.packetStatus ===
        "PACKET_NOT_READY" &&
      waiting.packetWritten ===
        false,

    previewReadyNoWrite:
      preview.packetStatus ===
        "READY_PREVIEW_ONLY" &&
      preview.packetWritten ===
        false,

    previewHasSourceHashes:
      typeof preview.packet
        ?.sourceHashes
        ?.observationsSha256 ===
        "string" &&
      typeof preview.packet
        ?.sourceHashes
        ?.evaluatorSha256 ===
        "string" &&
      typeof preview.packet
        ?.sourceHashes
        ?.summarySha256 ===
        "string",

    previewHasPacketHash:
      typeof preview.packet
        ?.packetSha256 ===
        "string",

    frozenContractPreserved:
      preview.packet
        ?.frozenContract
        ?.historicalCutoff ===
        "2026-10-07" &&
      preview.packet
        ?.frozenContract
        ?.selectedCap ===
        0.01 &&
      preview.packet
        ?.frozenContract
        ?.entryScoreThreshold ===
        0.66 &&
      preview.packet
        ?.frozenContract
        ?.retuningAllowed ===
        false,

    wrongConfirmationBlocked:
      wrongConfirm.packetStatus ===
        "WRITE_BLOCKED_EXACT_CONFIRMATION_REQUIRED" &&
      wrongConfirm.packetWritten ===
        false,

    exactConfirmationWritesOnce:
      written.packetStatus ===
        "PACKET_WRITTEN_FOR_MANUAL_REVIEW" &&
      written.packetWritten ===
        true &&
      writes ===
        1,

    writtenPathCorrect:
      writtenFile.endsWith(
        "alpha-v3-true-forward-oos-manual-review-packet-v1.json",
      ),

    writtenPayloadContainsHash:
      writtenText.includes(
        "packetSha256",
      ),

    noPromotion:
      written.safety
        .promotionExecuted ===
        false &&
      written.safety
        .automaticPromotion ===
        false,

    noTradingSideEffects:
      written.safety
        .ordersCreated ===
        0 &&
      written.safety
        .positionsChanged ===
        0 &&
      written.safety
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
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_PACKET_V1_CONTRACT_VERIFIED",

        checks,

        observations: {
          waiting:
            waiting.packetStatus,

          preview:
            preview.packetStatus,

          wrongConfirm:
            wrongConfirm.packetStatus,

          written:
            written.packetStatus,

          writeCalls:
            writes,
        },

        safety: {
          syntheticOnly:
            true,

          realPacketFileWritten:
            false,

          promotionExecuted:
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
          "STATIC_VERIFY_THEN_RUN_CURRENT_PACKET_PREVIEW",
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
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_PACKET_V1_CONTRACT_FAILED",

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
