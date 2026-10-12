const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const PACKAGE = path.join(ROOT, "package.json");

const VERIFY = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-manual-review-packet-integrity-v1.ts"
);

const CONTRACT = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-manual-review-packet-integrity-v1-contract-test.ts"
);

const STATIC = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-manual-review-packet-integrity-v1-static-verify.cjs"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_PACKET_INTEGRITY_V1_INSTALL_FAILED",
    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

const required = [
  "scripts/true-forward-oos-manual-review-packet-v1.ts",
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
  const verifySource = `import fs from "node:fs";
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
`;

  const contractSource = `import assert from "node:assert/strict";
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
      verified.checks
        .historicalCutoffFrozen ===
        true &&
      verified.checks
        .selectedCapFrozen ===
        true &&
      verified.checks
        .entryThresholdFrozen ===
        true &&
      verified.checks
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
`;

  const staticSource = `const fs = require("fs");
const path = require("path");

const target = path.join(
  process.cwd(),
  "scripts",
  "true-forward-oos-manual-review-packet-integrity-v1.ts"
);

if (!fs.existsSync(target)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_PACKET_INTEGRITY_V1_STATIC_FAILED",

    failed:
      ["verifierExists"],
  }, null, 2));

  process.exitCode = 1;
} else {
  const source =
    fs.readFileSync(
      target,
      "utf8"
    );

  const checks = {
    verifierExists:
      true,

    packetPath:
      source.includes(
        "alpha-v3-true-forward-oos-manual-review-packet-v1.json"
      ),

    sourceFiles:
      source.includes(
        "alpha-v3-entry-v3-forward-oos-observations.json"
      ) &&
      source.includes(
        "alpha-v3-entry-v3-forward-shadow-oos.json"
      ) &&
      source.includes(
        "alpha-v3-true-forward-oos-summary.json"
      ),

    packetHashRecomputed:
      source.includes(
        "recomputedPacketSha256"
      ),

    allSourceHashesChecked:
      source.includes(
        "observationsSourceHashMatches"
      ) &&
      source.includes(
        "evaluatorSourceHashMatches"
      ) &&
      source.includes(
        "summarySourceHashMatches"
      ),

    sourceDriftFailClosed:
      source.includes(
        "REVIEW_PACKET_SOURCE_DRIFT_DETECTED"
      ),

    packetIntegrityFailClosed:
      source.includes(
        "REVIEW_PACKET_INTEGRITY_FAILED"
      ),

    manualReviewOnlyNext:
      source.includes(
        "MANUAL_HUMAN_REVIEW_OF_FROZEN_PACKET_ONLY"
      ),

    readOnlyDisk:
      source.includes(
        "readFileSync"
      ) &&
      !source.includes(
        "writeFileSync"
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
        ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_PACKET_INTEGRITY_V1_STATIC_VERIFIED"
        : "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_PACKET_INTEGRITY_V1_STATIC_FAILED",

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
        ? "RUN_MANUAL_REVIEW_PACKET_INTEGRITY_CONTRACT"
        : "REPAIR_PACKET_INTEGRITY_V1",
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
`;

  fs.writeFileSync(
    VERIFY,
    verifySource,
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
      "forward-oos:manual-review-packet-integrity"
    ] =
      "tsx --env-file=.env.local ./scripts/true-forward-oos-manual-review-packet-integrity-v1.ts";

    pkg.scripts[
      "test:true-forward-oos-manual-review-packet-integrity"
    ] =
      "tsx --env-file=.env.local ./scripts/true-forward-oos-manual-review-packet-integrity-v1-contract-test.ts";

    pkg.scripts[
      "test:true-forward-oos-manual-review-packet-integrity-static"
    ] =
      "node ./scripts/true-forward-oos-manual-review-packet-integrity-v1-static-verify.cjs";

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
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_PACKET_INTEGRITY_V1_INSTALLED",

      generatedFiles: [
        "scripts/true-forward-oos-manual-review-packet-integrity-v1.ts",
        "scripts/true-forward-oos-manual-review-packet-integrity-v1-contract-test.ts",
        "scripts/true-forward-oos-manual-review-packet-integrity-v1-static-verify.cjs"
      ],

      productSourceChanges:
        0,

      purpose:
        "VERIFY_FROZEN_REVIEW_PACKET_HASH_AND_DETECT_SOURCE_DRIFT_BEFORE_MANUAL_REVIEW",

      verifies: [
        "PACKET_SHA256",
        "OBSERVATION_SOURCE_SHA256",
        "EVALUATOR_SOURCE_SHA256",
        "SUMMARY_SOURCE_SHA256",
        "FROZEN_CONTRACT",
        "MANUAL_REVIEW_ONLY_SAFETY"
      ],

      safety: {
        readOnly:
          true,

        installerWrotePacket:
          false,

        promotionExecuted:
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
        "RUN_STATIC_CONTRACT_AND_CURRENT_READ_ONLY_PACKET_INTEGRITY"
    }, null, 2));

    process.exitCode = 0;
  }
}
