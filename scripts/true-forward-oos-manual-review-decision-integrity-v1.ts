import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import {
  auditManualReviewPacketIntegrityV1,
} from "./true-forward-oos-manual-review-packet-integrity-v1";

import {
  APPROVE_DECISION,
  REJECT_DECISION,
} from "./true-forward-oos-manual-review-decision-v1";

const ROOT =
  process.cwd();

export const REVIEW_PACKET_FILE =
  path.resolve(
    ROOT,
    "logs/alpha-v3-true-forward-oos-manual-review-packet-v1.json",
  );

export const REVIEW_DECISION_FILE =
  path.resolve(
    ROOT,
    "logs/alpha-v3-true-forward-oos-manual-review-decision-v1.json",
  );

export interface DecisionIntegrityInput {
  decisionRecord?: any;
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

function resolveSource(
  input: DecisionIntegrityInput,
  key:
    | "decisionRecord"
    | "packet"
    | "observationsDocument"
    | "evaluatorReport"
    | "summaryReport",
  file?: string,
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

  if (!file) {
    return {
      exists:
        false,
      value:
        undefined,
    };
  }

  return readJsonIfExists(
    file,
  );
}

export function auditManualReviewDecisionIntegrityV1(
  input:
    DecisionIntegrityInput = {},
) {
  const decisionRead =
    resolveSource(
      input,
      "decisionRecord",
      REVIEW_DECISION_FILE,
    );

  if (
    !decisionRead.exists
  ) {
    return {
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_DECISION_INTEGRITY_V1",

      integrityStatus:
        "WAITING_FOR_MANUAL_REVIEW_DECISION",

      paperPromotionReviewEligible:
        false,

      failed:
        [],

      safety:
        safety(),

      nextGate:
        "WAIT_FOR_RECORDED_MANUAL_REVIEW_DECISION",
    };
  }

  if (
    !decisionRead.value ||
    typeof decisionRead.value !==
      "object"
  ) {
    return blocked(
      "DECISION_RECORD_INVALID",
    );
  }

  const packetRead =
    resolveSource(
      input,
      "packet",
      REVIEW_PACKET_FILE,
    );

  const packetIntegrity =
    auditManualReviewPacketIntegrityV1({
      ...(Object.prototype.hasOwnProperty.call(
        input,
        "packet",
      )
        ? {
            packet:
              input.packet,
          }
        : {}),

      ...(Object.prototype.hasOwnProperty.call(
        input,
        "observationsDocument",
      )
        ? {
            observationsDocument:
              input.observationsDocument,
          }
        : {}),

      ...(Object.prototype.hasOwnProperty.call(
        input,
        "evaluatorReport",
      )
        ? {
            evaluatorReport:
              input.evaluatorReport,
          }
        : {}),

      ...(Object.prototype.hasOwnProperty.call(
        input,
        "summaryReport",
      )
        ? {
            summaryReport:
              input.summaryReport,
          }
        : {}),
    });

  if (
    packetIntegrity.integrityStatus !==
    "REVIEW_PACKET_INTEGRITY_VERIFIED"
  ) {
    return {
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_DECISION_INTEGRITY_V1",

      integrityStatus:
        "DECISION_BLOCKED_PACKET_NOT_VERIFIED",

      packetIntegrityStatus:
        packetIntegrity.integrityStatus,

      paperPromotionReviewEligible:
        false,

      failed: [
        "PACKET_INTEGRITY_NOT_VERIFIED",
      ],

      safety:
        safety(),

      nextGate:
        "REPAIR_OR_REBUILD_REVIEW_PACKET_BEFORE_DECISION_USE",
    };
  }

  const decision =
    decisionRead.value;

  const decisionCore = {
    version:
      decision.version,

    recordedAt:
      decision.recordedAt,

    decision:
      decision.decision,

    note:
      decision.note,

    packetReference:
      decision.packetReference,

    decisionSemantics:
      decision.decisionSemantics,

    safety:
      decision.safety,
  };

  const recomputedDecisionSha256 =
    sha256(
      decisionCore,
    );

  const packet =
    packetRead.exists
      ? packetRead.value
      : (
          fs.existsSync(
            REVIEW_PACKET_FILE,
          )
            ? JSON.parse(
                fs.readFileSync(
                  REVIEW_PACKET_FILE,
                  "utf8",
                ),
              )
            : null
        );

  const allowedDecision =
    decision.decision ===
      APPROVE_DECISION ||
    decision.decision ===
      REJECT_DECISION;

  const checks = {
    decisionVersionCorrect:
      decision.version ===
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_DECISION_V1",

    decisionHashPresent:
      typeof decision
        .decisionRecordSha256 ===
        "string" &&
      decision
        .decisionRecordSha256
        .length >
        0,

    decisionHashMatches:
      decision
        .decisionRecordSha256 ===
      recomputedDecisionSha256,

    decisionAllowed:
      allowedDecision,

    packetReferencePresent:
      typeof decision
        .packetReference
        ?.packetSha256 ===
        "string",

    packetReferenceMatchesCurrent:
      decision
        .packetReference
        ?.packetSha256 ===
      packet
        ?.packetSha256,

    observationsReferenceMatchesCurrent:
      decision
        .packetReference
        ?.observationsSha256 ===
      packet
        ?.sourceHashes
        ?.observationsSha256,

    evaluatorReferenceMatchesCurrent:
      decision
        .packetReference
        ?.evaluatorSha256 ===
      packet
        ?.sourceHashes
        ?.evaluatorSha256,

    summaryReferenceMatchesCurrent:
      decision
        .packetReference
        ?.summarySha256 ===
      packet
        ?.sourceHashes
        ?.summarySha256,

    promotionNotAlreadyApproved:
      decision
        .decisionSemantics
        ?.promotionApproved ===
      false,

    paperPromotionNotExecuted:
      decision
        .decisionSemantics
        ?.paperPromotionExecuted ===
      false,

    automaticPromotionDisabled:
      decision
        .decisionSemantics
        ?.automaticPromotion ===
      false,

    safetyPromotionNotExecuted:
      decision
        .safety
        ?.promotionExecuted ===
      false,

    safetyAutomaticPromotionDisabled:
      decision
        .safety
        ?.automaticPromotion ===
      false,

    safetyRealTradingDisabled:
      decision
        .safety
        ?.realTradingEnabled ===
      false,

    safetyOrdersZero:
      decision
        .safety
        ?.ordersCreated ===
      0,

    safetyPositionsZero:
      decision
        .safety
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

  const decisionIsApprove =
    decision.decision ===
    APPROVE_DECISION;

  const decisionIsReject =
    decision.decision ===
    REJECT_DECISION;

  return {
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_DECISION_INTEGRITY_V1",

    integrityStatus:
      failed.length ===
      0
        ? "MANUAL_REVIEW_DECISION_INTEGRITY_VERIFIED"
        : "MANUAL_REVIEW_DECISION_INTEGRITY_FAILED",

    decision:
      decision.decision,

    paperPromotionReviewEligible:
      failed.length ===
        0 &&
      decisionIsApprove,

    continueForwardOos:
      failed.length ===
        0 &&
      decisionIsReject,

    hashes: {
      storedDecisionSha256:
        decision
          .decisionRecordSha256 ??
        null,

      recomputedDecisionSha256,

      referencedPacketSha256:
        decision
          .packetReference
          ?.packetSha256 ??
        null,

      currentPacketSha256:
        packet
          ?.packetSha256 ??
        null,
    },

    checks,
    failed,

    safety:
      safety(),

    nextGate:
      failed.length >
      0
        ? "REPAIR_DECISION_RECORD_BEFORE_ANY_PAPER_PROMOTION_REVIEW"
        : (
            decisionIsApprove
              ? "BUILD_SEPARATE_PAPER_PROMOTION_ELIGIBILITY_PREFLIGHT"
              : "CONTINUE_TRUE_FORWARD_OOS_COLLECTION_WITHOUT_RETUNING"
          ),
  };
}

function blocked(
  reason: string,
) {
  return {
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_DECISION_INTEGRITY_V1",

    integrityStatus:
      "MANUAL_REVIEW_DECISION_INTEGRITY_FAILED",

    paperPromotionReviewEligible:
      false,

    failed: [
      reason,
    ],

    safety:
      safety(),

    nextGate:
      "REPAIR_DECISION_RECORD_BEFORE_ANY_PAPER_PROMOTION_REVIEW",
  };
}

function safety() {
  return {
    readOnly:
      true,

    decisionWritten:
      false,

    packetWritten:
      false,

    promotionExecuted:
      false,

    promotionApproved:
      false,

    automaticPromotion:
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
    auditManualReviewDecisionIntegrityV1();

  console.log(
    JSON.stringify(
      report,
      null,
      2,
    ),
  );

  process.exitCode =
    report.integrityStatus ===
      "MANUAL_REVIEW_DECISION_INTEGRITY_FAILED" ||
    report.integrityStatus ===
      "DECISION_BLOCKED_PACKET_NOT_VERIFIED"
      ? 1
      : 0;
}

if (
  process.argv[1]?.endsWith(
    "true-forward-oos-manual-review-decision-integrity-v1.ts",
  )
) {
  main().catch(
    error => {
      console.error(
        JSON.stringify(
          {
            status:
              "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_DECISION_INTEGRITY_V1_ERROR",

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
