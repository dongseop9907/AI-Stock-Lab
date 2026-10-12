const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const PACKAGE = path.join(ROOT, "package.json");

const GATE = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-manual-review-decision-integrity-v1.ts"
);

const CONTRACT = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-manual-review-decision-integrity-v1-contract-test.ts"
);

const STATIC = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-manual-review-decision-integrity-v1-static-verify.cjs"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_DECISION_INTEGRITY_V1_INSTALL_FAILED",
    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

const required = [
  "scripts/true-forward-oos-manual-review-decision-v1.ts",
  "scripts/true-forward-oos-manual-review-packet-integrity-v1.ts",
  "package.json",
];

const missing =
  required.filter(
    rel =>
      !fs.existsSync(
        path.join(ROOT, rel)
      )
  );

if (missing.length > 0) {
  fail(
    "REQUIRED_FILES_MISSING",
    { missing }
  );
} else {
  const gateSource = `import fs from "node:fs";
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
`;

  const contractSource = `import assert from "node:assert/strict";
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
`;

  const staticSource = `const fs = require("fs");
const path = require("path");

const target = path.join(
  process.cwd(),
  "scripts",
  "true-forward-oos-manual-review-decision-integrity-v1.ts"
);

if (!fs.existsSync(target)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_DECISION_INTEGRITY_V1_STATIC_FAILED",

    failed:
      ["gateExists"],
  }, null, 2));

  process.exitCode = 1;
} else {
  const source =
    fs.readFileSync(
      target,
      "utf8"
    );

  const checks = {
    gateExists:
      true,

    packetIntegrityUsed:
      source.includes(
        "auditManualReviewPacketIntegrityV1"
      ),

    decisionPath:
      source.includes(
        "alpha-v3-true-forward-oos-manual-review-decision-v1.json"
      ),

    packetPath:
      source.includes(
        "alpha-v3-true-forward-oos-manual-review-packet-v1.json"
      ),

    decisionHashRecomputed:
      source.includes(
        "recomputedDecisionSha256"
      ),

    packetReferenceChecked:
      source.includes(
        "packetReferenceMatchesCurrent"
      ),

    allSourceReferencesChecked:
      source.includes(
        "observationsReferenceMatchesCurrent"
      ) &&
      source.includes(
        "evaluatorReferenceMatchesCurrent"
      ) &&
      source.includes(
        "summaryReferenceMatchesCurrent"
      ),

    approveReviewOnly:
      source.includes(
        "BUILD_SEPARATE_PAPER_PROMOTION_ELIGIBILITY_PREFLIGHT"
      ),

    rejectContinuesOos:
      source.includes(
        "CONTINUE_TRUE_FORWARD_OOS_COLLECTION_WITHOUT_RETUNING"
      ),

    noPromotionExecution:
      !/applyPromotion|promoteModel|executePromotion/i.test(
        source
      ),

    noOrderSurface:
      !/createOrder|placeOrder|submitOrder/i.test(
        source
      ),

    readOnlyDisk:
      source.includes(
        "readFileSync"
      ) &&
      !source.includes(
        "writeFileSync"
      ),

    noRealTradingEnable:
      !/(REAL_TRADING_ENABLED|ENABLE_REAL_TRADING|ENABLE_LIVE_TRADING)\\s*[:=]\\s*["']true["']/i.test(
        source
      ),
  };

  const failed =
    Object.entries(
      checks
    )
      .filter(
        ([, value]) =>
          value !==
          true
      )
      .map(
        ([key]) =>
          key
      );

  console.log(JSON.stringify({
    status:
      failed.length === 0
        ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_DECISION_INTEGRITY_V1_STATIC_VERIFIED"
        : "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_DECISION_INTEGRITY_V1_STATIC_FAILED",

    checks,

    safety: {
      sourceOnly:
        true,

      decisionWritten:
        false,

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

    failed,

    nextGate:
      failed.length === 0
        ? "RUN_MANUAL_REVIEW_DECISION_INTEGRITY_CONTRACT"
        : "REPAIR_MANUAL_REVIEW_DECISION_INTEGRITY_V1",
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
`;

  fs.writeFileSync(
    GATE,
    gateSource,
    "utf8"
  );

  fs.writeFileSync(
    CONTRACT,
    contractSource,
    "utf8"
  );

  fs.writeFileSync(
    STATIC,
    staticSource,
    "utf8"
  );

  let pkg;

  try {
    pkg =
      JSON.parse(
        fs.readFileSync(
          PACKAGE,
          "utf8"
        )
      );
  } catch (error) {
    fail(
      "PACKAGE_JSON_PARSE_FAILED",
      {
        error:
          String(
            error instanceof Error
              ? error.message
              : error
          ),
      }
    );
  }

  if (pkg) {
    pkg.scripts ||= {};

    pkg.scripts[
      "forward-oos:manual-review-decision-integrity"
    ] =
      "tsx --env-file=.env.local ./scripts/true-forward-oos-manual-review-decision-integrity-v1.ts";

    pkg.scripts[
      "test:true-forward-oos-manual-review-decision-integrity"
    ] =
      "tsx --env-file=.env.local ./scripts/true-forward-oos-manual-review-decision-integrity-v1-contract-test.ts";

    pkg.scripts[
      "test:true-forward-oos-manual-review-decision-integrity-static"
    ] =
      "node ./scripts/true-forward-oos-manual-review-decision-integrity-v1-static-verify.cjs";

    fs.writeFileSync(
      PACKAGE,
      JSON.stringify(
        pkg,
        null,
        2
      ) + "\n",
      "utf8"
    );

    console.log(JSON.stringify({
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_DECISION_INTEGRITY_V1_INSTALLED",

      generatedFiles: [
        "scripts/true-forward-oos-manual-review-decision-integrity-v1.ts",
        "scripts/true-forward-oos-manual-review-decision-integrity-v1-contract-test.ts",
        "scripts/true-forward-oos-manual-review-decision-integrity-v1-static-verify.cjs"
      ],

      productSourceChanges:
        0,

      purpose:
        "VERIFY_MANUAL_REVIEW_DECISION_HASH_AND_PACKET_REFERENCE_BEFORE_PAPER_PROMOTION_REVIEW",

      verifies: [
        "DECISION_RECORD_SHA256",
        "PACKET_REFERENCE_SHA256",
        "OBSERVATION_REFERENCE_SHA256",
        "EVALUATOR_REFERENCE_SHA256",
        "SUMMARY_REFERENCE_SHA256",
        "EXPLICIT_APPROVE_OR_REJECT_DECISION",
        "NO_EXISTING_PROMOTION_APPROVAL",
        "NO_PROMOTION_EXECUTION"
      ],

      safety: {
        readOnly:
          true,

        installerWroteDecision:
          false,

        promotionExecuted:
          false,

        promotionApproved:
          false,

        automaticPromotion:
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
          false
      },

      nextAction:
        "RUN_STATIC_CONTRACT_AND_CURRENT_DECISION_INTEGRITY"
    }, null, 2));

    process.exitCode = 0;
  }
}
