import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT =
  process.cwd();

export const REVIEW_PACKET_FILE =
  path.resolve(
    ROOT,
    "logs/alpha-v3-true-forward-oos-manual-review-packet-v1.json",
  );

export const OBSERVATION_FILE =
  path.resolve(
    ROOT,
    "logs/alpha-v3-entry-v3-forward-oos-observations.json",
  );

export const EVALUATOR_FILE =
  path.resolve(
    ROOT,
    "logs/alpha-v3-entry-v3-forward-shadow-oos.json",
  );

export const SUMMARY_FILE =
  path.resolve(
    ROOT,
    "logs/alpha-v3-true-forward-oos-summary.json",
  );

export interface PacketIntegrityInput {
  packet?: any;
  observationsDocument?: any;
  evaluatorReport?: any;
  summaryReport?: any;
}

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

function readJsonIfExists(
  file: string,
) {
  if (
    !fs.existsSync(file)
  ) {
    return {
      exists:
        false,
      value:
        undefined,
    };
  }

  try {
    return {
      exists:
        true,
      value:
        JSON.parse(
          fs.readFileSync(
            file,
            "utf8",
          ),
        ),
    };
  } catch (error) {
    return {
      exists:
        true,
      value:
        null,
      parseError:
        String(
          error instanceof Error
            ? error.message
            : error,
        ),
    };
  }
}

function source(
  input: PacketIntegrityInput,
  key:
    | "packet"
    | "observationsDocument"
    | "evaluatorReport"
    | "summaryReport",
  file: string,
) {
  if (
    Object.prototype.hasOwnProperty.call(
      input,
      key,
    )
  ) {
    return {
      exists:
        input[key] !==
        undefined,

      value:
        input[key],
    };
  }

  return readJsonIfExists(
    file,
  );
}

export function auditManualReviewPacketIntegrityV1(
  input:
    PacketIntegrityInput = {},
) {
  const packetRead =
    source(
      input,
      "packet",
      REVIEW_PACKET_FILE,
    );

  if (
    !packetRead.exists
  ) {
    return {
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_PACKET_INTEGRITY_V1",

      integrityStatus:
        "WAITING_FOR_REVIEW_PACKET",

      reviewAllowed:
        false,

      failed:
        [],

      safety:
        safety(),

      nextGate:
        "WAIT_FOR_EXPLICIT_MANUAL_REVIEW_PACKET_WRITE",
    };
  }

  if (
    !packetRead.value ||
    typeof packetRead.value !==
      "object"
  ) {
    return blocked(
      "PACKET_JSON_INVALID",
    );
  }

  const observationsRead =
    source(
      input,
      "observationsDocument",
      OBSERVATION_FILE,
    );

  const evaluatorRead =
    source(
      input,
      "evaluatorReport",
      EVALUATOR_FILE,
    );

  const summaryRead =
    source(
      input,
      "summaryReport",
      SUMMARY_FILE,
    );

  const packet =
    packetRead.value;

  const packetCore = {
    version:
      packet.version,

    generatedAt:
      packet.generatedAt,

    reviewGate:
      packet.reviewGate,

    frozenContract:
      packet.frozenContract,

    counts:
      packet.counts,

    evaluatorDecision:
      packet.evaluatorDecision,

    summaryDecision:
      packet.summaryDecision,

    sourceHashes:
      packet.sourceHashes,

    safety:
      packet.safety,
  };

  const recomputedPacketSha256 =
    sha256(
      packetCore,
    );

  const currentHashes = {
    observationsSha256:
      observationsRead.exists
        ? sha256(
            observationsRead.value,
          )
        : null,

    evaluatorSha256:
      evaluatorRead.exists
        ? sha256(
            evaluatorRead.value,
          )
        : null,

    summarySha256:
      summaryRead.exists
        ? sha256(
            summaryRead.value,
          )
        : null,
  };

  const checks = {
    packetVersionCorrect:
      packet.version ===
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_PACKET_V1",

    packetHashPresent:
      typeof packet.packetSha256 ===
      "string" &&
      packet.packetSha256.length >
        0,

    packetHashMatches:
      packet.packetSha256 ===
      recomputedPacketSha256,

    observationsPresent:
      observationsRead.exists ===
      true,

    evaluatorPresent:
      evaluatorRead.exists ===
      true,

    summaryPresent:
      summaryRead.exists ===
      true,

    observationsSourceHashMatches:
      observationsRead.exists &&
      packet.sourceHashes
        ?.observationsSha256 ===
      currentHashes
        .observationsSha256,

    evaluatorSourceHashMatches:
      evaluatorRead.exists &&
      packet.sourceHashes
        ?.evaluatorSha256 ===
      currentHashes
        .evaluatorSha256,

    summarySourceHashMatches:
      summaryRead.exists &&
      packet.sourceHashes
        ?.summarySha256 ===
      currentHashes
        .summarySha256,

    reviewGateFrozenReady:
      packet.reviewGate
        ?.gateStatus ===
      "READY_FOR_MANUAL_FORWARD_OOS_REVIEW" &&
      packet.reviewGate
        ?.reviewReady ===
      true,

    historicalCutoffFrozen:
      packet.frozenContract
        ?.historicalCutoff ===
      "2026-10-07",

    selectedCapFrozen:
      packet.frozenContract
        ?.selectedCap ===
      0.01,

    entryThresholdFrozen:
      packet.frozenContract
        ?.entryScoreThreshold ===
      0.66,

    retuningDisabled:
      packet.frozenContract
        ?.retuningAllowed ===
      false,

    forwardGatePassed:
      packet.evaluatorDecision
        ?.forwardOosGatePassed ===
      true,

    summaryEvidencePassed:
      packet.summaryDecision
        ?.enoughEvidenceForFinalEntryGate ===
      true,

    productionPolicyStillUnlocked:
      packet.summaryDecision
        ?.productionPolicyLocked ===
      false,

    packetManualReviewOnly:
      packet.safety
        ?.manualReviewOnly ===
      true,

    packetNoPromotion:
      packet.safety
        ?.promotionExecuted ===
      false &&
      packet.safety
        ?.automaticPromotion ===
      false,

    packetNoRealTrading:
      packet.safety
        ?.realTradingEnabled ===
      false,

    packetNoOrders:
      packet.safety
        ?.ordersCreated ===
      0,

    packetNoPositionMutation:
      packet.safety
        ?.positionsChanged ===
      0,
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

  const driftDetected =
    failed.some(
      key =>
        key ===
          "observationsSourceHashMatches" ||
        key ===
          "evaluatorSourceHashMatches" ||
        key ===
          "summarySourceHashMatches",
    );

  return {
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_PACKET_INTEGRITY_V1",

    integrityStatus:
      failed.length ===
      0
        ? "REVIEW_PACKET_INTEGRITY_VERIFIED"
        : (
            driftDetected
              ? "REVIEW_PACKET_SOURCE_DRIFT_DETECTED"
              : "REVIEW_PACKET_INTEGRITY_FAILED"
          ),

    reviewAllowed:
      failed.length ===
      0,

    hashes: {
      packetStored:
        packet.packetSha256 ??
        null,

      packetRecomputed:
        recomputedPacketSha256,

      storedSources:
        packet.sourceHashes ??
        null,

      currentSources:
        currentHashes,
    },

    checks,
    failed,

    safety:
      safety(),

    nextGate:
      failed.length ===
      0
        ? "MANUAL_HUMAN_REVIEW_OF_FROZEN_PACKET_ONLY"
        : (
            driftDetected
              ? "INVALIDATE_PACKET_AND_REBUILD_AFTER_FRESH_REVIEW_GATE"
              : "REPAIR_PACKET_INTEGRITY_BEFORE_MANUAL_REVIEW"
          ),
  };
}

function blocked(
  reason: string,
) {
  return {
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_PACKET_INTEGRITY_V1",

    integrityStatus:
      "REVIEW_PACKET_INTEGRITY_FAILED",

    reviewAllowed:
      false,

    failed: [
      reason,
    ],

    safety:
      safety(),

    nextGate:
      "REPAIR_PACKET_INTEGRITY_BEFORE_MANUAL_REVIEW",
  };
}

function safety() {
  return {
    readOnly:
      true,

    packetWritten:
      false,

    promotionExecuted:
      false,

    automaticPromotion:
      false,

    evaluatorExecuted:
      false,

    summaryExecuted:
      false,

    databaseReads:
      0,

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
  };
}

async function main() {
  const report =
    auditManualReviewPacketIntegrityV1();

  console.log(
    JSON.stringify(
      report,
      null,
      2,
    ),
  );

  process.exitCode =
    report.integrityStatus ===
      "REVIEW_PACKET_INTEGRITY_FAILED" ||
    report.integrityStatus ===
      "REVIEW_PACKET_SOURCE_DRIFT_DETECTED"
      ? 1
      : 0;
}

if (
  process.argv[1]?.endsWith(
    "true-forward-oos-manual-review-packet-integrity-v1.ts",
  )
) {
  main().catch(
    error => {
      console.error(
        JSON.stringify(
          {
            status:
              "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_PACKET_INTEGRITY_V1_ERROR",

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
}
