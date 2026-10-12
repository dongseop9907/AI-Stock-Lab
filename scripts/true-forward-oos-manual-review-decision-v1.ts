import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import {
  auditManualReviewPacketIntegrityV1,
} from "./true-forward-oos-manual-review-packet-integrity-v1";

const ROOT =
  process.cwd();

const OUTPUT_FILE =
  path.resolve(
    ROOT,
    "logs/alpha-v3-true-forward-oos-manual-review-decision-v1.json",
  );

export const MANUAL_REVIEW_DECISION_WRITE_CONFIRM =
  "RECORD_TRUE_FORWARD_OOS_MANUAL_REVIEW_DECISION";

export const APPROVE_DECISION =
  "APPROVE_FOR_PAPER_PROMOTION_REVIEW";

export const REJECT_DECISION =
  "REJECT_AND_CONTINUE_FORWARD_OOS";

export type ManualReviewDecision =
  | typeof APPROVE_DECISION
  | typeof REJECT_DECISION;

export interface ManualReviewDecisionInput {
  now?: Date;
  decision?: string;
  note?: string;
  write?: boolean;
  confirm?: string;

  packet?: any;
  observationsDocument?: any;
  evaluatorReport?: any;
  summaryReport?: any;

  writer?: (
    file: string,
    text: string,
  ) => void;
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

function hasOwn(
  input: ManualReviewDecisionInput,
  key:
    | "packet"
    | "observationsDocument"
    | "evaluatorReport"
    | "summaryReport",
) {
  return Object.prototype.hasOwnProperty.call(
    input,
    key,
  );
}

export function buildManualForwardOosReviewDecisionV1(
  input:
    ManualReviewDecisionInput = {},
) {
  const integrity =
    auditManualReviewPacketIntegrityV1({
      ...(hasOwn(
        input,
        "packet",
      )
        ? {
            packet:
              input.packet,
          }
        : {}),

      ...(hasOwn(
        input,
        "observationsDocument",
      )
        ? {
            observationsDocument:
              input.observationsDocument,
          }
        : {}),

      ...(hasOwn(
        input,
        "evaluatorReport",
      )
        ? {
            evaluatorReport:
              input.evaluatorReport,
          }
        : {}),

      ...(hasOwn(
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
    integrity.integrityStatus !==
    "REVIEW_PACKET_INTEGRITY_VERIFIED"
  ) {
    return {
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_DECISION_V1",

      decisionStatus:
        "DECISION_BLOCKED_PACKET_NOT_VERIFIED",

      decisionRecorded:
        false,

      packetIntegrity:
        integrity.integrityStatus,

      failed:
        [],

      safety:
        safety(),

      nextGate:
        "WAIT_FOR_VERIFIED_FROZEN_REVIEW_PACKET",
    };
  }

  const decision =
    input.decision;

  const validDecision =
    decision ===
      APPROVE_DECISION ||
    decision ===
      REJECT_DECISION;

  if (!validDecision) {
    return {
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_DECISION_V1",

      decisionStatus:
        "DECISION_BLOCKED_EXPLICIT_DECISION_REQUIRED",

      decisionRecorded:
        false,

      allowedDecisions: [
        APPROVE_DECISION,
        REJECT_DECISION,
      ],

      failed: [
        "EXPLICIT_DECISION_REQUIRED",
      ],

      safety:
        safety(),

      nextGate:
        "SELECT_EXPLICIT_MANUAL_REVIEW_DECISION",
    };
  }

  const packet =
    input.packet ??
    (
      fs.existsSync(
        path.resolve(
          ROOT,
          "logs/alpha-v3-true-forward-oos-manual-review-packet-v1.json",
        ),
      )
        ? JSON.parse(
            fs.readFileSync(
              path.resolve(
                ROOT,
                "logs/alpha-v3-true-forward-oos-manual-review-packet-v1.json",
              ),
              "utf8",
            ),
          )
        : null
    );

  const recordedAt =
    (
      input.now ??
      new Date()
    ).toISOString();

  const recordCore = {
    version:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_DECISION_V1",

    recordedAt,

    decision,

    note:
      typeof input.note ===
        "string"
        ? input.note
        : "",

    packetReference: {
      packetSha256:
        packet
          ?.packetSha256 ??
        null,

      observationsSha256:
        packet
          ?.sourceHashes
          ?.observationsSha256 ??
        null,

      evaluatorSha256:
        packet
          ?.sourceHashes
          ?.evaluatorSha256 ??
        null,

      summarySha256:
        packet
          ?.sourceHashes
          ?.summarySha256 ??
        null,
    },

    decisionSemantics: {
      promotionApproved:
        false,

      paperPromotionExecuted:
        false,

      automaticPromotion:
        false,

      approvalMeaning:
        decision ===
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

  const record = {
    ...recordCore,

    decisionRecordSha256:
      sha256(
        recordCore,
      ),
  };

  if (
    input.write !==
    true
  ) {
    return {
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_DECISION_V1",

      decisionStatus:
        "DECISION_READY_PREVIEW_ONLY",

      decisionRecorded:
        false,

      record,

      failed:
        [],

      safety:
        safety(),

      nextGate:
        "OPTIONAL_EXPLICIT_DECISION_RECORD_WRITE",
    };
  }

  if (
    input.confirm !==
    MANUAL_REVIEW_DECISION_WRITE_CONFIRM
  ) {
    return {
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_DECISION_V1",

      decisionStatus:
        "DECISION_WRITE_BLOCKED_EXACT_CONFIRMATION_REQUIRED",

      decisionRecorded:
        false,

      record,

      failed: [
        "EXACT_CONFIRMATION_REQUIRED",
      ],

      safety:
        safety(),

      nextGate:
        "RETRY_WITH_EXACT_DECISION_RECORD_CONFIRMATION",
    };
  }

  const writer =
    input.writer ??
    (
      (
        file: string,
        text: string,
      ) => {
        fs.mkdirSync(
          path.dirname(file),
          {
            recursive:
              true,
          },
        );

        fs.writeFileSync(
          file,
          text,
          "utf8",
        );
      }
    );

  writer(
    OUTPUT_FILE,
    stableJson(
      record,
    ) + "\n",
  );

  return {
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_DECISION_V1",

    decisionStatus:
      "MANUAL_REVIEW_DECISION_RECORDED",

    decisionRecorded:
      true,

    outputFile:
      "logs/alpha-v3-true-forward-oos-manual-review-decision-v1.json",

    record,

    failed:
      [],

    safety:
      safety(),

    nextGate:
      decision ===
      APPROVE_DECISION
        ? "SEPARATE_PAPER_PROMOTION_GATE_STILL_REQUIRES_ITS_OWN_APPROVAL"
        : "CONTINUE_TRUE_FORWARD_OOS_COLLECTION_WITHOUT_RETUNING",
  };
}

function safety() {
  return {
    promotionExecuted:
      false,

    promotionApproved:
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

    ordersCreated:
      0,

    positionsChanged:
      0,

    realTradingEnabled:
      false,
  };
}

async function main() {
  const write =
    process.argv.includes(
      "--write",
    );

  const decisionArg =
    process.argv.find(
      arg =>
        arg.startsWith(
          "--decision=",
        ),
    );

  const confirmArg =
    process.argv.find(
      arg =>
        arg.startsWith(
          "--confirm=",
        ),
    );

  const noteArg =
    process.argv.find(
      arg =>
        arg.startsWith(
          "--note=",
        ),
    );

  const result =
    buildManualForwardOosReviewDecisionV1({
      write,

      decision:
        decisionArg
          ?.slice(
            "--decision=".length,
          ),

      confirm:
        confirmArg
          ?.slice(
            "--confirm=".length,
          ),

      note:
        noteArg
          ?.slice(
            "--note=".length,
          ),
    });

  console.log(
    JSON.stringify(
      result,
      null,
      2,
    ),
  );

  process.exitCode =
    result.decisionStatus ===
      "DECISION_WRITE_BLOCKED_EXACT_CONFIRMATION_REQUIRED"
      ? 1
      : 0;
}

if (
  process.argv[1]?.endsWith(
    "true-forward-oos-manual-review-decision-v1.ts",
  )
) {
  main().catch(
    error => {
      console.error(
        JSON.stringify(
          {
            status:
              "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_DECISION_V1_ERROR",

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
