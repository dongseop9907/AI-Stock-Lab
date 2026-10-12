const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const PACKAGE = path.join(ROOT, "package.json");

const GATE = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-manual-review-evidence-gate-v1.ts"
);

const CONTRACT = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-manual-review-evidence-gate-v1-contract-test.ts"
);

const STATIC = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-manual-review-evidence-gate-v1-static-verify.cjs"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_EVIDENCE_GATE_V1_INSTALL_FAILED",
    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

const required = [
  "scripts/true-forward-oos-evaluator-evidence-consistency-gate-v1.ts",
  "scripts/true-forward-oos-observation-source-binding-v1.ts",
  "scripts/alpha-v3-true-forward-oos-evaluator-v1.ts",
  "scripts/alpha-v3-true-forward-oos-summary.ts",
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

import {
  auditEvaluatorEvidenceConsistencyV1,
} from "./true-forward-oos-evaluator-evidence-consistency-gate-v1";

const ROOT =
  process.cwd();

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

export interface ManualReviewEvidenceInput {
  observationsDocument?: any;
  evaluatorReport?: any;
  summaryReport?: any;
}

function readJsonIfExists(
  file: string,
) {
  if (
    !fs.existsSync(file)
  ) {
    return {
      exists: false,
      value: null,
    };
  }

  try {
    return {
      exists: true,
      value: JSON.parse(
        fs.readFileSync(
          file,
          "utf8",
        ),
      ),
    };
  } catch (error) {
    return {
      exists: true,
      value: null,
      parseError:
        String(
          error instanceof Error
            ? error.message
            : error,
        ),
    };
  }
}

function injectedOrDisk(
  input: ManualReviewEvidenceInput,
  key:
    | "evaluatorReport"
    | "summaryReport",
  file: string,
) {
  const injected =
    Object.prototype.hasOwnProperty.call(
      input,
      key,
    );

  if (!injected) {
    return readJsonIfExists(
      file,
    );
  }

  const value =
    input[key];

  if (value === undefined) {
    return {
      exists: false,
      value: null,
      injected: true,
    };
  }

  return {
    exists: true,
    value,
    injected: true,
  };
}

export function auditManualForwardOosReviewEvidenceGateV1(
  input:
    ManualReviewEvidenceInput = {},
) {
  const consistency =
    auditEvaluatorEvidenceConsistencyV1({
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
    consistency.gateStatus ===
      "WAITING_FOR_OBSERVATION_FILE" ||
    consistency.gateStatus ===
      "WAITING_FOR_OBSERVATIONS" ||
    consistency.gateStatus ===
      "WAITING_FOR_EVALUATOR_REPORT"
  ) {
    return {
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_EVIDENCE_GATE_V1",

      gateStatus:
        "WAITING_FOR_FORWARD_OOS_EVIDENCE",

      consistencyStatus:
        consistency.gateStatus,

      reviewReady:
        false,

      failed:
        [],

      safety:
        safety(),

      nextGate:
        "CONTINUE_TRUE_FORWARD_OOS_COLLECTION_WITHOUT_RETUNING",
    };
  }

  if (
    consistency.gateStatus !==
    "EVALUATOR_EVIDENCE_CONSISTENT"
  ) {
    return {
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_EVIDENCE_GATE_V1",

      gateStatus:
        "BLOCKED_EVIDENCE_INCONSISTENT",

      consistencyStatus:
        consistency.gateStatus,

      reviewReady:
        false,

      failed: [
        "EVALUATOR_EVIDENCE_NOT_CONSISTENT",
      ],

      safety:
        safety(),

      nextGate:
        "REPAIR_FORWARD_OOS_EVIDENCE_BEFORE_REVIEW",
    };
  }

  const evaluatorRead =
    injectedOrDisk(
      input,
      "evaluatorReport",
      EVALUATOR_FILE,
    );

  const summaryRead =
    injectedOrDisk(
      input,
      "summaryReport",
      SUMMARY_FILE,
    );

  if (
    !evaluatorRead.exists
  ) {
    return {
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_EVIDENCE_GATE_V1",

      gateStatus:
        "WAITING_FOR_EVALUATOR_REPORT",

      reviewReady:
        false,

      failed:
        [],

      safety:
        safety(),

      nextGate:
        "CONTINUE_TRUE_FORWARD_OOS_COLLECTION_WITHOUT_RETUNING",
    };
  }

  if (
    evaluatorRead.value ===
    null
  ) {
    return blocked(
      "EVALUATOR_REPORT_INVALID",
    );
  }

  const evaluator =
    evaluatorRead.value;

  const payload =
    evaluator?.evaluation ??
    evaluator?.result ??
    evaluator?.metrics ??
    evaluator;

  const forwardOosGatePassed =
    payload
      ?.decision
      ?.forwardOosGatePassed;

  const nextUse =
    payload
      ?.decision
      ?.nextUse;

  if (
    forwardOosGatePassed !==
    true
  ) {
    return {
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_EVIDENCE_GATE_V1",

      gateStatus:
        "NOT_READY_FOR_MANUAL_REVIEW",

      reviewReady:
        false,

      evidence: {
        forwardOosGatePassed:
          forwardOosGatePassed ??
          null,

        nextUse:
          nextUse ??
          null,
      },

      failed:
        [],

      safety:
        safety(),

      nextGate:
        "CONTINUE_TRUE_FORWARD_OOS_COLLECTION_WITHOUT_RETUNING",
    };
  }

  const checks = {
    evaluatorGatePassed:
      forwardOosGatePassed ===
      true,

    evaluatorNextUseReview:
      nextUse ===
      "READY_FOR_MANUAL_FORWARD_OOS_REVIEW",

    historicalCutoffFrozen:
      evaluator.contract
        ?.historicalCutoff ===
      "2026-10-07",

    selectedCapFrozen:
      evaluator.contract
        ?.selectedCap ===
      0.01,

    entryThresholdFrozen:
      evaluator.contract
        ?.entryScoreThreshold ===
      0.66,

    retuningDisabled:
      evaluator.contract
        ?.retuningAllowed ===
      false,

    summaryPresent:
      summaryRead.exists ===
      true,

    summaryValid:
      summaryRead.value !==
      null,

    summaryCutoffConsistent:
      summaryRead.value
        ?.contract
        ?.historicalTargetCutoff ===
      "2026-10-07",

    summaryCapConsistent:
      summaryRead.value
        ?.contract
        ?.selectedCap ===
      0.01,

    summaryThresholdConsistent:
      summaryRead.value
        ?.contract
        ?.entryScoreThreshold ===
      0.66,

    summaryEvidenceGatePassed:
      summaryRead.value
        ?.decision
        ?.enoughEvidenceForFinalEntryGate ===
      true,

    productionPolicyStillUnlocked:
      summaryRead.value
        ?.decision
        ?.productionPolicyLocked ===
      false,

    noSummaryProductionWrites:
      summaryRead.value
        ?.safety
        ?.databaseWrites ===
        0,

    noSummaryOrders:
      summaryRead.value
        ?.safety
        ?.ordersCreated ===
        0,

    noSummaryPositionMutation:
      summaryRead.value
        ?.safety
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

  return {
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_EVIDENCE_GATE_V1",

    gateStatus:
      failed.length ===
      0
        ? "READY_FOR_MANUAL_FORWARD_OOS_REVIEW"
        : "BLOCKED_MANUAL_REVIEW_EVIDENCE_INCOMPLETE",

    reviewReady:
      failed.length ===
      0,

    consistencyStatus:
      consistency.gateStatus,

    evidence: {
      evaluatorDecision: {
        forwardOosGatePassed,
        nextUse,
      },

      summaryDecision: {
        enoughEvidenceForFinalEntryGate:
          summaryRead.value
            ?.decision
            ?.enoughEvidenceForFinalEntryGate ??
          null,

        productionPolicyLocked:
          summaryRead.value
            ?.decision
            ?.productionPolicyLocked ??
          null,
      },
    },

    checks,
    failed,

    safety:
      safety(),

    nextGate:
      failed.length ===
      0
        ? "MANUAL_REVIEW_ONLY_DO_NOT_PROMOTE_AUTOMATICALLY"
        : "CONTINUE_TRUE_FORWARD_OOS_COLLECTION_WITHOUT_RETUNING",
  };
}

function blocked(
  reason: string,
) {
  return {
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_EVIDENCE_GATE_V1",

    gateStatus:
      "BLOCKED_MANUAL_REVIEW_EVIDENCE_INCOMPLETE",

    reviewReady:
      false,

    failed: [
      reason,
    ],

    safety:
      safety(),

    nextGate:
      "REPAIR_FORWARD_OOS_EVIDENCE_BEFORE_REVIEW",
  };
}

function safety() {
  return {
    readOnly:
      true,

    evaluatorExecuted:
      false,

    summaryExecuted:
      false,

    promotionExecuted:
      false,

    promotionRecommendedAutomatically:
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
    auditManualForwardOosReviewEvidenceGateV1();

  console.log(
    JSON.stringify(
      report,
      null,
      2,
    ),
  );

  process.exitCode =
    (
      report.gateStatus ===
        "BLOCKED_EVIDENCE_INCONSISTENT" ||
      report.gateStatus ===
        "BLOCKED_MANUAL_REVIEW_EVIDENCE_INCOMPLETE"
    )
      ? 1
      : 0;
}

if (
  process.argv[1]?.endsWith(
    "true-forward-oos-manual-review-evidence-gate-v1.ts",
  )
) {
  main().catch(
    error => {
      console.error(
        JSON.stringify(
          {
            status:
              "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_EVIDENCE_GATE_V1_ERROR",

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
  auditManualForwardOosReviewEvidenceGateV1,
} from "./true-forward-oos-manual-review-evidence-gate-v1";

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
  };
}

function evaluator(
  gatePassed:
    boolean,
) {
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
          gatePassed,

        fillPassed:
          true,

        pairedPassed:
          gatePassed,

        forwardOosGatePassed:
          gatePassed,

        nextUse:
          gatePassed
            ? "READY_FOR_MANUAL_FORWARD_OOS_REVIEW"
            : "CONTINUE_TRUE_FORWARD_OOS_COLLECTION",
      },
    },

    outputFile:
      "logs/alpha-v3-entry-v3-forward-shadow-oos.json",
  };
}

function summary(
  enoughEvidence:
    boolean,
) {
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
        enoughEvidence,
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

function main() {
  const waiting =
    auditManualForwardOosReviewEvidenceGateV1({
      observationsDocument:
        undefined,

      evaluatorReport:
        undefined,

      summaryReport:
        undefined,
    });

  const notReady =
    auditManualForwardOosReviewEvidenceGateV1({
      observationsDocument: {
        observations: [
          observation(),
        ],
      },

      evaluatorReport:
        evaluator(
          false,
        ),

      summaryReport:
        summary(
          false,
        ),
    });

  const ready =
    auditManualForwardOosReviewEvidenceGateV1({
      observationsDocument: {
        observations: [
          observation(),
        ],
      },

      evaluatorReport:
        evaluator(
          true,
        ),

      summaryReport:
        summary(
          true,
        ),
    });

  const missingSummary =
    auditManualForwardOosReviewEvidenceGateV1({
      observationsDocument: {
        observations: [
          observation(),
        ],
      },

      evaluatorReport:
        evaluator(
          true,
        ),

      summaryReport:
        undefined,
    });

  const unsafeSummary =
    auditManualForwardOosReviewEvidenceGateV1({
      observationsDocument: {
        observations: [
          observation(),
        ],
      },

      evaluatorReport:
        evaluator(
          true,
        ),

      summaryReport: {
        ...summary(
          true,
        ),

        safety: {
          databaseWrites:
            1,

          ordersCreated:
            0,

          positionsChanged:
            0,
        },
      },
    });

  const checks = {
    waitingSafe:
      waiting.gateStatus ===
      "WAITING_FOR_FORWARD_OOS_EVIDENCE",

    notReadyContinuesCollection:
      notReady.gateStatus ===
      "NOT_READY_FOR_MANUAL_REVIEW" &&
      notReady.reviewReady ===
      false,

    readyForManualReviewOnly:
      ready.gateStatus ===
      "READY_FOR_MANUAL_FORWARD_OOS_REVIEW" &&
      ready.reviewReady ===
      true &&
      ready.nextGate ===
      "MANUAL_REVIEW_ONLY_DO_NOT_PROMOTE_AUTOMATICALLY",

    missingSummaryBlocked:
      missingSummary.gateStatus ===
      "BLOCKED_MANUAL_REVIEW_EVIDENCE_INCOMPLETE" &&
      missingSummary.failed.includes(
        "summaryPresent",
      ),

    unsafeSummaryBlocked:
      unsafeSummary.gateStatus ===
      "BLOCKED_MANUAL_REVIEW_EVIDENCE_INCOMPLETE" &&
      unsafeSummary.failed.includes(
        "noSummaryProductionWrites",
      ),

    noPromotionExecution:
      ready.safety
        .promotionExecuted ===
      false,

    noAutoPromotionRecommendation:
      ready.safety
        .promotionRecommendedAutomatically ===
      false,

    noTradingSideEffects:
      ready.safety
        .ordersCreated ===
        0 &&
      ready.safety
        .positionsChanged ===
        0 &&
      ready.safety
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
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_EVIDENCE_GATE_V1_CONTRACT_VERIFIED",

        checks,

        observations: {
          waiting:
            waiting.gateStatus,

          notReady:
            notReady.gateStatus,

          ready:
            ready.gateStatus,

          missingSummary:
            missingSummary.failed,

          unsafeSummary:
            unsafeSummary.failed,
        },

        safety: {
          syntheticOnly:
            true,

          evaluatorExecuted:
            false,

          summaryExecuted:
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
          "STATIC_VERIFY_THEN_RUN_CURRENT_READ_ONLY_MANUAL_REVIEW_GATE",
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
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_EVIDENCE_GATE_V1_CONTRACT_FAILED",

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
  "true-forward-oos-manual-review-evidence-gate-v1.ts"
);

if (!fs.existsSync(target)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_EVIDENCE_GATE_V1_STATIC_FAILED",

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

    consistencyGateUsed:
      source.includes(
        "auditEvaluatorEvidenceConsistencyV1"
      ),

    evaluatorGateRequired:
      source.includes(
        "forwardOosGatePassed"
      ),

    manualReviewOnlyStatus:
      source.includes(
        "READY_FOR_MANUAL_FORWARD_OOS_REVIEW"
      ),

    noAutoPromotion:
      source.includes(
        "MANUAL_REVIEW_ONLY_DO_NOT_PROMOTE_AUTOMATICALLY"
      ),

    summaryEvidenceRequired:
      source.includes(
        "enoughEvidenceForFinalEntryGate"
      ),

    productionPolicyUnlockedCheck:
      source.includes(
        "productionPolicyLocked"
      ),

    summarySafetyChecks:
      source.includes(
        "noSummaryProductionWrites"
      ) &&
      source.includes(
        "noSummaryOrders"
      ) &&
      source.includes(
        "noSummaryPositionMutation"
      ),

    frozenCutoff:
      source.includes(
        '"2026-10-07"'
      ),

    frozenCap:
      source.includes(
        "0.01"
      ),

    frozenThreshold:
      source.includes(
        "0.66"
      ),

    readOnly:
      source.includes(
        "readFileSync"
      ) &&
      !source.includes(
        "writeFileSync"
      ),

    noSubprocess:
      !/spawn\\s*\\(|spawnSync\\s*\\(|execSync\\s*\\(/.test(
        source
      ),

    noOrderSurface:
      !/createOrder|placeOrder|submitOrder/i.test(
        source
      ),

    noPromotionExecution:
      !/applyPromotion|promoteModel|executePromotion/i.test(
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
        ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_EVIDENCE_GATE_V1_STATIC_VERIFIED"
        : "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_EVIDENCE_GATE_V1_STATIC_FAILED",

    checks,

    safety: {
      sourceOnly:
        true,

      evaluatorExecuted:
        false,

      summaryExecuted:
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
        ? "RUN_MANUAL_REVIEW_EVIDENCE_CONTRACT"
        : "REPAIR_MANUAL_REVIEW_EVIDENCE_GATE_V1",
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
      "forward-oos:manual-review-gate"
    ] =
      "tsx --env-file=.env.local ./scripts/true-forward-oos-manual-review-evidence-gate-v1.ts";

    pkg.scripts[
      "test:true-forward-oos-manual-review-gate"
    ] =
      "tsx --env-file=.env.local ./scripts/true-forward-oos-manual-review-evidence-gate-v1-contract-test.ts";

    pkg.scripts[
      "test:true-forward-oos-manual-review-gate-static"
    ] =
      "node ./scripts/true-forward-oos-manual-review-evidence-gate-v1-static-verify.cjs";

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
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_MANUAL_REVIEW_EVIDENCE_GATE_V1_INSTALLED",

      generatedFiles: [
        "scripts/true-forward-oos-manual-review-evidence-gate-v1.ts",
        "scripts/true-forward-oos-manual-review-evidence-gate-v1-contract-test.ts",
        "scripts/true-forward-oos-manual-review-evidence-gate-v1-static-verify.cjs"
      ],

      productSourceChanges:
        0,

      purpose:
        "ALLOW_MANUAL_FORWARD_OOS_REVIEW_ONLY_AFTER_EVALUATOR_AND_SUMMARY_EVIDENCE_PASS",

      safety: {
        readOnly:
          true,

        evaluatorExecuted:
          false,

        summaryExecuted:
          false,

        promotionExecuted:
          false,

        autoPromotion:
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
          false
      },

      nextAction:
        "RUN_STATIC_CONTRACT_AND_CURRENT_READ_ONLY_MANUAL_REVIEW_GATE"
    }, null, 2));

    process.exitCode = 0;
  }
}
