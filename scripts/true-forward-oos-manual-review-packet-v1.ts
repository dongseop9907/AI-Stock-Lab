import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import {
  auditManualForwardOosReviewEvidenceGateV1,
} from "./true-forward-oos-manual-review-evidence-gate-v1";

const ROOT =
  process.cwd();

const OBSERVATION_FILE =
  path.resolve(
    ROOT,
    "logs/alpha-v3-entry-v3-forward-oos-observations.json",
  );

const EVALUATOR_FILE =
  path.resolve(
    ROOT,
    "logs/alpha-v3-entry-v3-forward-shadow-oos.json",
  );

const SUMMARY_FILE =
  path.resolve(
    ROOT,
    "logs/alpha-v3-true-forward-oos-summary.json",
  );

const OUTPUT_FILE =
  path.resolve(
    ROOT,
    "logs/alpha-v3-true-forward-oos-manual-review-packet-v1.json",
  );

export const MANUAL_REVIEW_PACKET_WRITE_CONFIRM =
  "WRITE_TRUE_FORWARD_OOS_MANUAL_REVIEW_PACKET";

export interface ManualReviewPacketInput {
  now?: Date;
  observationsDocument?: any;
  evaluatorReport?: any;
  summaryReport?: any;
  write?: boolean;
  confirm?: string;
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

function readJson(
  file: string,
) {
  if (
    !fs.existsSync(file)
  ) {
    return undefined;
  }

  return JSON.parse(
    fs.readFileSync(
      file,
      "utf8",
    ),
  );
}

function hasOwn(
  input: ManualReviewPacketInput,
  key:
    | "observationsDocument"
    | "evaluatorReport"
    | "summaryReport",
) {
  return Object.prototype.hasOwnProperty.call(
    input,
    key,
  );
}

function resolveSource(
  input: ManualReviewPacketInput,
  key:
    | "observationsDocument"
    | "evaluatorReport"
    | "summaryReport",
  file: string,
) {
  if (
    hasOwn(
      input,
      key,
    )
  ) {
    return input[key];
  }

  return readJson(
    file,
  );
}

export function buildManualForwardOosReviewPacketV1(
  input:
    ManualReviewPacketInput = {},
) {
  const observationsDocument =
    resolveSource(
      input,
      "observationsDocument",
      OBSERVATION_FILE,
    );

  const evaluatorReport =
    resolveSource(
      input,
      "evaluatorReport",
      EVALUATOR_FILE,
    );

  const summaryReport =
    resolveSource(
      input,
      "summaryReport",
      SUMMARY_FILE,
    );

  const gate =
    auditManualForwardOosReviewEvidenceGateV1({
      observationsDocument,
      evaluatorReport,
      summaryReport,
    });

  if (
    gate.gateStatus !==
    "READY_FOR_MANUAL_FORWARD_OOS_REVIEW"
  ) {
    return {
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_PACKET_V1",

      packetStatus:
        "PACKET_NOT_READY",

      reviewGateStatus:
        gate.gateStatus,

      reviewReady:
        false,

      packetWritten:
        false,

      failed:
        [],

      safety:
        safety(),

      nextGate:
        "CONTINUE_TRUE_FORWARD_OOS_COLLECTION_WITHOUT_RETUNING",
    };
  }

  const observations =
    Array.isArray(
      observationsDocument
        ?.observations,
    )
      ? observationsDocument
          .observations
      : [];

  const evaluation =
    evaluatorReport
      ?.evaluation ??
    evaluatorReport
      ?.result ??
    evaluatorReport
      ?.metrics ??
    evaluatorReport;

  const generatedAt =
    (
      input.now ??
      new Date()
    ).toISOString();

  const packetCore = {
    version:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_PACKET_V1",

    generatedAt,

    reviewGate: {
      gateStatus:
        gate.gateStatus,

      reviewReady:
        gate.reviewReady,
    },

    frozenContract: {
      historicalCutoff:
        evaluatorReport
          ?.contract
          ?.historicalCutoff ??
        null,

      selectedCap:
        evaluatorReport
          ?.contract
          ?.selectedCap ??
        null,

      entryScoreThreshold:
        evaluatorReport
          ?.contract
          ?.entryScoreThreshold ??
        null,

      retuningAllowed:
        evaluatorReport
          ?.contract
          ?.retuningAllowed ??
        null,
    },

    counts: {
      observations:
        observations.length,

      qualifiedObservations:
        evaluation
          ?.counts
          ?.qualifiedObservations ??
        null,

      filledObservations:
        evaluation
          ?.counts
          ?.filledObservations ??
        null,
    },

    evaluatorDecision: {
      enoughSample:
        evaluation
          ?.decision
          ?.enoughSample ??
        null,

      fillPassed:
        evaluation
          ?.decision
          ?.fillPassed ??
        null,

      pairedPassed:
        evaluation
          ?.decision
          ?.pairedPassed ??
        null,

      forwardOosGatePassed:
        evaluation
          ?.decision
          ?.forwardOosGatePassed ??
        null,

      nextUse:
        evaluation
          ?.decision
          ?.nextUse ??
        null,
    },

    summaryDecision: {
      trueForwardReady:
        summaryReport
          ?.decision
          ?.trueForwardReady ??
        null,

      enoughEvidenceForFinalEntryGate:
        summaryReport
          ?.decision
          ?.enoughEvidenceForFinalEntryGate ??
        null,

      productionPolicyLocked:
        summaryReport
          ?.decision
          ?.productionPolicyLocked ??
        null,
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

  if (
    input.write !==
    true
  ) {
    return {
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_PACKET_V1",

      packetStatus:
        "READY_PREVIEW_ONLY",

      reviewGateStatus:
        gate.gateStatus,

      reviewReady:
        true,

      packetWritten:
        false,

      packet,

      failed:
        [],

      safety:
        safety(),

      nextGate:
        "OPTIONAL_EXPLICIT_PACKET_WRITE_THEN_MANUAL_REVIEW",
    };
  }

  if (
    input.confirm !==
    MANUAL_REVIEW_PACKET_WRITE_CONFIRM
  ) {
    return {
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_PACKET_V1",

      packetStatus:
        "WRITE_BLOCKED_EXACT_CONFIRMATION_REQUIRED",

      reviewGateStatus:
        gate.gateStatus,

      reviewReady:
        true,

      packetWritten:
        false,

      packet,

      failed: [
        "EXACT_CONFIRMATION_REQUIRED",
      ],

      safety:
        safety(),

      nextGate:
        "RETRY_WITH_EXACT_PACKET_WRITE_CONFIRMATION",
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
      packet,
    ) + "\n",
  );

  return {
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_PACKET_V1",

    packetStatus:
      "PACKET_WRITTEN_FOR_MANUAL_REVIEW",

    reviewGateStatus:
      gate.gateStatus,

    reviewReady:
      true,

    packetWritten:
      true,

    outputFile:
      "logs/alpha-v3-true-forward-oos-manual-review-packet-v1.json",

    packet,

    failed:
      [],

    safety:
      safety(),

    nextGate:
      "MANUAL_HUMAN_REVIEW_ONLY_DO_NOT_PROMOTE_AUTOMATICALLY",
  };
}

function safety() {
  return {
    evaluatorExecuted:
      false,

    summaryExecuted:
      false,

    promotionExecuted:
      false,

    automaticPromotion:
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

  const confirmArg =
    process.argv.find(
      arg =>
        arg.startsWith(
          "--confirm=",
        ),
    );

  const confirm =
    confirmArg
      ?.slice(
        "--confirm=".length,
      );

  const result =
    buildManualForwardOosReviewPacketV1({
      write,
      confirm,
    });

  console.log(
    JSON.stringify(
      result,
      null,
      2,
    ),
  );

  process.exitCode =
    result.packetStatus ===
      "WRITE_BLOCKED_EXACT_CONFIRMATION_REQUIRED"
      ? 1
      : 0;
}

if (
  process.argv[1]?.endsWith(
    "true-forward-oos-manual-review-packet-v1.ts",
  )
) {
  main().catch(
    error => {
      console.error(
        JSON.stringify(
          {
            status:
              "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_PACKET_V1_ERROR",

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
