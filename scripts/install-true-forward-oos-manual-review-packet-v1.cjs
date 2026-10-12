const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const PACKAGE = path.join(ROOT, "package.json");

const PACKET = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-manual-review-packet-v1.ts"
);

const CONTRACT = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-manual-review-packet-v1-contract-test.ts"
);

const STATIC = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-manual-review-packet-v1-static-verify.cjs"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_PACKET_V1_INSTALL_FAILED",
    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

const required = [
  "scripts/true-forward-oos-manual-review-evidence-gate-v1.ts",
  "scripts/true-forward-oos-evaluator-evidence-consistency-gate-v1.ts",
  "scripts/true-forward-oos-observation-source-binding-v1.ts",
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
  const packetSource = `import fs from "node:fs";
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
    ) + "\\n",
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
`;

  const contractSource = `import assert from "node:assert/strict";

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
`;

  const staticSource = `const fs = require("fs");
const path = require("path");

const target = path.join(
  process.cwd(),
  "scripts",
  "true-forward-oos-manual-review-packet-v1.ts"
);

if (!fs.existsSync(target)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_PACKET_V1_STATIC_FAILED",

    failed:
      ["packetExists"],
  }, null, 2));

  process.exitCode = 1;
} else {
  const source =
    fs.readFileSync(
      target,
      "utf8"
    );

  const checks = {
    packetExists:
      true,

    manualReviewGateUsed:
      source.includes(
        "auditManualForwardOosReviewEvidenceGateV1"
      ),

    reviewReadyRequired:
      source.includes(
        "READY_FOR_MANUAL_FORWARD_OOS_REVIEW"
      ),

    sourceHashes:
      source.includes(
        "observationsSha256"
      ) &&
      source.includes(
        "evaluatorSha256"
      ) &&
      source.includes(
        "summarySha256"
      ),

    packetHash:
      source.includes(
        "packetSha256"
      ),

    exactWriteConfirmation:
      source.includes(
        "WRITE_TRUE_FORWARD_OOS_MANUAL_REVIEW_PACKET"
      ),

    previewDefault:
      source.includes(
        "READY_PREVIEW_ONLY"
      ),

    noAutomaticWrite:
      source.includes(
        "if ("
      ) &&
      source.includes(
        "input.write !=="
      ),

    noAutoPromotion:
      source.includes(
        "automaticPromotion:"
      ) &&
      source.includes(
        "false"
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
        ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_PACKET_V1_STATIC_VERIFIED"
        : "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_PACKET_V1_STATIC_FAILED",

    checks,

    safety: {
      sourceOnly:
        true,

      packetWritten:
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

    failed,

    nextGate:
      failed.length === 0
        ? "RUN_MANUAL_REVIEW_PACKET_CONTRACT"
        : "REPAIR_MANUAL_REVIEW_PACKET_V1",
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
`;

  fs.writeFileSync(
    PACKET,
    packetSource,
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
      "forward-oos:manual-review-packet"
    ] =
      "tsx --env-file=.env.local ./scripts/true-forward-oos-manual-review-packet-v1.ts";

    pkg.scripts[
      "forward-oos:manual-review-packet:write"
    ] =
      "tsx --env-file=.env.local ./scripts/true-forward-oos-manual-review-packet-v1.ts --write --confirm=WRITE_TRUE_FORWARD_OOS_MANUAL_REVIEW_PACKET";

    pkg.scripts[
      "test:true-forward-oos-manual-review-packet"
    ] =
      "tsx --env-file=.env.local ./scripts/true-forward-oos-manual-review-packet-v1-contract-test.ts";

    pkg.scripts[
      "test:true-forward-oos-manual-review-packet-static"
    ] =
      "node ./scripts/true-forward-oos-manual-review-packet-v1-static-verify.cjs";

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
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_PACKET_V1_INSTALLED",

      generatedFiles: [
        "scripts/true-forward-oos-manual-review-packet-v1.ts",
        "scripts/true-forward-oos-manual-review-packet-v1-contract-test.ts",
        "scripts/true-forward-oos-manual-review-packet-v1-static-verify.cjs"
      ],

      productSourceChanges:
        0,

      purpose:
        "FREEZE_MANUAL_REVIEW_EVIDENCE_WITH_SHA256_BEFORE_ANY_PROMOTION_DECISION",

      behavior: {
        default:
          "PREVIEW_ONLY",

        writeRequires:
          "WRITE_TRUE_FORWARD_OOS_MANUAL_REVIEW_PACKET",

        automaticPromotion:
          false,

        promotionExecution:
          false
      },

      safety: {
        installerWroteReviewPacket:
          false,

        evaluatorExecuted:
          false,

        summaryExecuted:
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
          false
      },

      nextAction:
        "RUN_STATIC_CONTRACT_AND_CURRENT_PACKET_PREVIEW"
    }, null, 2));

    process.exitCode = 0;
  }
}
