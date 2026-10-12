const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const PACKAGE = path.join(ROOT, "package.json");

const DECISION = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-manual-review-decision-v1.ts"
);

const CONTRACT = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-manual-review-decision-v1-contract-test.ts"
);

const STATIC = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-manual-review-decision-v1-static-verify.cjs"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_DECISION_V1_INSTALL_FAILED",
    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

const required = [
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
  const decisionSource = `import fs from "node:fs";
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
    ) + "\\n",
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
`;

  const contractSource = `import assert from "node:assert/strict";
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
`;

  const staticSource = `const fs = require("fs");
const path = require("path");

const target = path.join(
  process.cwd(),
  "scripts",
  "true-forward-oos-manual-review-decision-v1.ts"
);

if (!fs.existsSync(target)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_DECISION_V1_STATIC_FAILED",

    failed:
      ["decisionExists"],
  }, null, 2));

  process.exitCode = 1;
} else {
  const source =
    fs.readFileSync(
      target,
      "utf8"
    );

  const checks = {
    decisionExists:
      true,

    packetIntegrityRequired:
      source.includes(
        "auditManualReviewPacketIntegrityV1"
      ) &&
      source.includes(
        "REVIEW_PACKET_INTEGRITY_VERIFIED"
      ),

    explicitApproveDecision:
      source.includes(
        "APPROVE_FOR_PAPER_PROMOTION_REVIEW"
      ),

    explicitRejectDecision:
      source.includes(
        "REJECT_AND_CONTINUE_FORWARD_OOS"
      ),

    exactWriteConfirmation:
      source.includes(
        "RECORD_TRUE_FORWARD_OOS_MANUAL_REVIEW_DECISION"
      ),

    approvalNotPromotion:
      source.includes(
        "promotionApproved:"
      ) &&
      source.includes(
        "false"
      ) &&
      source.includes(
        "paperPromotionExecuted:"
      ),

    separatePromotionGate:
      source.includes(
        "SEPARATE_PAPER_PROMOTION_GATE_STILL_REQUIRES_ITS_OWN_APPROVAL"
      ),

    decisionHash:
      source.includes(
        "decisionRecordSha256"
      ),

    noAutoPromotion:
      source.includes(
        "automaticPromotion:"
      ),

    noPromotionExecution:
      !/applyPromotion|promoteModel|executePromotion/i.test(
        source
      ),

    noOrderSurface:
      !/createOrder|placeOrder|submitOrder/i.test(
        source
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
          value !== true
      )
      .map(
        ([key]) =>
          key
      );

  console.log(JSON.stringify({
    status:
      failed.length === 0
        ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_DECISION_V1_STATIC_VERIFIED"
        : "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_DECISION_V1_STATIC_FAILED",

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
        ? "RUN_MANUAL_REVIEW_DECISION_CONTRACT"
        : "REPAIR_MANUAL_REVIEW_DECISION_V1",
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
`;

  fs.writeFileSync(
    DECISION,
    decisionSource,
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
      "forward-oos:manual-review-decision"
    ] =
      "tsx --env-file=.env.local ./scripts/true-forward-oos-manual-review-decision-v1.ts";

    pkg.scripts[
      "test:true-forward-oos-manual-review-decision"
    ] =
      "tsx --env-file=.env.local ./scripts/true-forward-oos-manual-review-decision-v1-contract-test.ts";

    pkg.scripts[
      "test:true-forward-oos-manual-review-decision-static"
    ] =
      "node ./scripts/true-forward-oos-manual-review-decision-v1-static-verify.cjs";

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
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_DECISION_V1_INSTALLED",

      generatedFiles: [
        "scripts/true-forward-oos-manual-review-decision-v1.ts",
        "scripts/true-forward-oos-manual-review-decision-v1-contract-test.ts",
        "scripts/true-forward-oos-manual-review-decision-v1-static-verify.cjs"
      ],

      productSourceChanges:
        0,

      purpose:
        "RECORD_EXPLICIT_HUMAN_REVIEW_DECISION_WITHOUT_EXECUTING_PROMOTION",

      allowedDecisions: [
        "APPROVE_FOR_PAPER_PROMOTION_REVIEW",
        "REJECT_AND_CONTINUE_FORWARD_OOS"
      ],

      behavior: {
        default:
          "PREVIEW_ONLY",

        writeRequires:
          "RECORD_TRUE_FORWARD_OOS_MANUAL_REVIEW_DECISION",

        packetIntegrityRequired:
          true,

        promotionApprovalGranted:
          false,

        promotionExecution:
          false,

        automaticPromotion:
          false
      },

      safety: {
        installerWroteDecision:
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
          false
      },

      nextAction:
        "RUN_STATIC_CONTRACT_AND_CURRENT_DECISION_PREVIEW"
    }, null, 2));

    process.exitCode = 0;
  }
}
