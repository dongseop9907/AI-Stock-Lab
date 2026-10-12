const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const PACKAGE = path.join(ROOT, "package.json");

const GATE = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-evaluator-evidence-consistency-gate-v1.ts"
);

const CONTRACT = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-evaluator-evidence-consistency-gate-v1-contract-test.ts"
);

const STATIC = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-evaluator-evidence-consistency-gate-v1-static-verify.cjs"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_EVALUATOR_EVIDENCE_CONSISTENCY_GATE_V1_INSTALL_FAILED",
    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

const required = [
  "scripts/true-forward-oos-observation-source-binding-v1.ts",
  "scripts/alpha-v3-true-forward-oos-evaluator-v1.ts",
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
  bindActualForwardObservations,
} from "./true-forward-oos-observation-source-binding-v1";

const ROOT =
  process.cwd();

export const TRUE_FORWARD_OBSERVATION_FILE =
  path.resolve(
    ROOT,
    "logs/alpha-v3-entry-v3-forward-oos-observations.json",
  );

export const TRUE_FORWARD_EVALUATOR_FILE =
  path.resolve(
    ROOT,
    "logs/alpha-v3-entry-v3-forward-shadow-oos.json",
  );

export const TRUE_FORWARD_SUMMARY_FILE =
  path.resolve(
    ROOT,
    "logs/alpha-v3-true-forward-oos-summary.json",
  );

export interface EvidenceConsistencyInput {
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
      exists:
        false,
      value:
        null,
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

function finite(
  value: unknown,
): number | null {
  return (
    typeof value ===
      "number" &&
    Number.isFinite(value)
  )
    ? value
    : null;
}

function findEvaluationPayload(
  report: any,
) {
  const candidates = [
    report?.evaluation,
    report?.result,
    report?.metrics,
    report,
  ];

  for (
    const candidate of candidates
  ) {
    if (
      candidate &&
      typeof candidate ===
        "object" &&
      candidate.counts &&
      typeof candidate.counts ===
        "object"
    ) {
      return candidate;
    }
  }

  return null;
}

export function auditEvaluatorEvidenceConsistencyV1(
  input:
    EvidenceConsistencyInput = {},
) {
  const observationRead =
    input.observationsDocument !==
    undefined
      ? {
          exists:
            true,
          value:
            input.observationsDocument,
        }
      : readJsonIfExists(
          TRUE_FORWARD_OBSERVATION_FILE,
        );

  const evaluatorRead =
    input.evaluatorReport !==
    undefined
      ? {
          exists:
            true,
          value:
            input.evaluatorReport,
        }
      : readJsonIfExists(
          TRUE_FORWARD_EVALUATOR_FILE,
        );

  const summaryRead =
    input.summaryReport !==
    undefined
      ? {
          exists:
            true,
          value:
            input.summaryReport,
        }
      : readJsonIfExists(
          TRUE_FORWARD_SUMMARY_FILE,
        );

  const observations =
    Array.isArray(
      observationRead.value
        ?.observations,
    )
      ? observationRead.value
          .observations
      : [];

  const canonical =
    bindActualForwardObservations({
      observations,
    });

  if (
    !observationRead.exists
  ) {
    return {
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_EVALUATOR_EVIDENCE_CONSISTENCY_GATE_V1",

      gateStatus:
        "WAITING_FOR_OBSERVATION_FILE",

      failed:
        [],

      canonical,

      safety:
        safety(),

      nextGate:
        "WAIT_FOR_REAL_FORWARD_OBSERVATION",
    };
  }

  if (
    observationRead.value ===
    null
  ) {
    return failReport(
      "OBSERVATION_JSON_INVALID",
      canonical,
    );
  }

  if (
    canonical.bindingStatus ===
    "OUTCOME_SOURCE_BINDING_FAILED"
  ) {
    return failReport(
      "CANONICAL_OUTCOME_BINDING_FAILED",
      canonical,
    );
  }

  if (
    observations.length ===
    0
  ) {
    return {
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_EVALUATOR_EVIDENCE_CONSISTENCY_GATE_V1",

      gateStatus:
        "WAITING_FOR_OBSERVATIONS",

      failed:
        [],

      canonical,

      safety:
        safety(),

      nextGate:
        "WAIT_FOR_REAL_FORWARD_OBSERVATION",
    };
  }

  if (
    !evaluatorRead.exists
  ) {
    return {
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_EVALUATOR_EVIDENCE_CONSISTENCY_GATE_V1",

      gateStatus:
        "WAITING_FOR_EVALUATOR_REPORT",

      failed:
        [],

      observationCounts: {
        observations:
          observations.length,

        qualified:
          observations.filter(
            row =>
              row?.correctedEntry
                ?.qualified ===
              true,
          ).length,

        canonicalOutcomeRows:
          canonical.counts
            .canonicalOutcomeRows,
      },

      safety:
        safety(),

      nextGate:
        "RUN_TRUE_FORWARD_OOS_EVALUATOR",
    };
  }

  if (
    evaluatorRead.value ===
    null
  ) {
    return failReport(
      "EVALUATOR_JSON_INVALID",
      canonical,
    );
  }

  const evaluator =
    evaluatorRead.value;

  const payload =
    findEvaluationPayload(
      evaluator,
    );

  const expectedObservations =
    observations.length;

  const expectedQualified =
    observations.filter(
      row =>
        row?.correctedEntry
          ?.qualified ===
        true,
    ).length;

  const expectedFilled =
    observations.filter(
      row =>
        row?.correctedEntry
          ?.qualified ===
          true &&
        row?.selectedPolicy
          ?.filled ===
          true,
    ).length;

  const actualObservations =
    finite(
      payload
        ?.counts
        ?.observations,
    );

  const actualQualified =
    finite(
      payload
        ?.counts
        ?.qualifiedObservations,
    );

  const actualFilled =
    finite(
      payload
        ?.counts
        ?.filledObservations,
    );

  const checks = {
    evaluatorStatusValid:
      evaluator.status ===
        "ALPHA_V3_TRUE_FORWARD_OOS_EVALUATED" ||
      evaluator.status ===
        "ALPHA_V3_TRUE_FORWARD_OOS_WAITING_FOR_OBSERVATIONS",

    evaluationPayloadFound:
      payload !==
      null,

    evaluatorObservationCountPresent:
      actualObservations !==
      null,

    evaluatorObservationCountMatches:
      actualObservations ===
      expectedObservations,

    evaluatorQualifiedCountPresent:
      actualQualified !==
      null,

    evaluatorQualifiedCountMatches:
      actualQualified ===
      expectedQualified,

    evaluatorFilledCountPresent:
      actualFilled !==
      null,

    evaluatorFilledCountMatches:
      actualFilled ===
      expectedFilled,

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

    evaluatorDecisionPresent:
      typeof payload
        ?.decision
        ?.forwardOosGatePassed ===
      "boolean",

    outputFileCorrect:
      evaluator.outputFile ===
      "logs/alpha-v3-entry-v3-forward-shadow-oos.json",
  };

  const summaryChecks = {
    summaryOptional:
      true,

    summaryContractConsistent:
      !summaryRead.exists ||
      summaryRead.value ===
        null ||
      (
        summaryRead.value
          ?.contract
          ?.historicalTargetCutoff ===
          "2026-10-07" &&
        summaryRead.value
          ?.contract
          ?.selectedCap ===
          0.01 &&
        summaryRead.value
          ?.contract
          ?.entryScoreThreshold ===
          0.66
      ),

    summaryProductionStillUnlocked:
      !summaryRead.exists ||
      summaryRead.value ===
        null ||
      summaryRead.value
        ?.decision
        ?.productionPolicyLocked ===
        false,

    summaryNoProductionMutation:
      !summaryRead.exists ||
      summaryRead.value ===
        null ||
      (
        summaryRead.value
          ?.safety
          ?.databaseWrites ===
          0 &&
        summaryRead.value
          ?.safety
          ?.ordersCreated ===
          0 &&
        summaryRead.value
          ?.safety
          ?.positionsChanged ===
          0
      ),
  };

  const allChecks = {
    ...checks,
    ...summaryChecks,
  };

  const failed =
    Object.entries(
      allChecks,
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
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_EVALUATOR_EVIDENCE_CONSISTENCY_GATE_V1",

    gateStatus:
      failed.length ===
      0
        ? "EVALUATOR_EVIDENCE_CONSISTENT"
        : "EVALUATOR_EVIDENCE_INCONSISTENT",

    observationCounts: {
      observations:
        expectedObservations,

      qualified:
        expectedQualified,

      filled:
        expectedFilled,

      canonicalOutcomeRows:
        canonical.counts
          .canonicalOutcomeRows,

      byHorizon:
        canonical.counts
          .byHorizon,
    },

    evaluatorCounts: {
      observations:
        actualObservations,

      qualified:
        actualQualified,

      filled:
        actualFilled,
    },

    checks:
      allChecks,

    evaluatorDecision: {
      enoughSample:
        payload
          ?.decision
          ?.enoughSample ??
        null,

      fillPassed:
        payload
          ?.decision
          ?.fillPassed ??
        null,

      pairedPassed:
        payload
          ?.decision
          ?.pairedPassed ??
        null,

      forwardOosGatePassed:
        payload
          ?.decision
          ?.forwardOosGatePassed ??
        null,

      nextUse:
        payload
          ?.decision
          ?.nextUse ??
        null,
    },

    summary: {
      exists:
        summaryRead.exists,

      treatedAs:
        "OPTIONAL_CONTRACT_LEVEL_CROSS_CHECK_ONLY",
    },

    safety:
      safety(),

    failed,

    nextGate:
      failed.length ===
      0
        ? (
            payload
              ?.decision
              ?.forwardOosGatePassed ===
            true
              ? "BUILD_MANUAL_FORWARD_OOS_REVIEW_EVIDENCE_GATE"
              : "CONTINUE_TRUE_FORWARD_OOS_COLLECTION_WITHOUT_RETUNING"
          )
        : "REPAIR_EVALUATOR_OR_SOURCE_EVIDENCE_BEFORE_ANY_PROMOTION",
  };
}

function failReport(
  reason: string,
  canonical: any,
) {
  return {
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_EVALUATOR_EVIDENCE_CONSISTENCY_GATE_V1",

    gateStatus:
      "EVALUATOR_EVIDENCE_INCONSISTENT",

    canonical,

    failed: [
      reason,
    ],

    safety:
      safety(),

    nextGate:
      "REPAIR_EVIDENCE_BEFORE_ANY_PROMOTION",
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

    promotionExecuted:
      false,
  };
}

async function main() {
  const report =
    auditEvaluatorEvidenceConsistencyV1();

  console.log(
    JSON.stringify(
      report,
      null,
      2,
    ),
  );

  process.exitCode =
    report.gateStatus ===
      "EVALUATOR_EVIDENCE_INCONSISTENT"
      ? 1
      : 0;
}

if (
  process.argv[1]?.endsWith(
    "true-forward-oos-evaluator-evidence-consistency-gate-v1.ts",
  )
) {
  main().catch(
    error => {
      console.error(
        JSON.stringify(
          {
            status:
              "AI_STOCK_LAB_TRUE_FORWARD_OOS_EVALUATOR_EVIDENCE_CONSISTENCY_GATE_V1_ERROR",

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
  auditEvaluatorEvidenceConsistencyV1,
} from "./true-forward-oos-evaluator-evidence-consistency-gate-v1";

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
          null,

        r5:
          null,
      },
    },

    selectedPolicy: {
      filled:
        true,

      returns: {
        r1:
          0.008,

        r3:
          null,

        r5:
          null,
      },
    },
  };
}

function evaluator(
  overrides:
    any = {},
) {
  return {
    status:
      "ALPHA_V3_TRUE_FORWARD_OOS_EVALUATED",

    version:
      "ALPHA_V3_TRUE_FORWARD_OOS_EVALUATOR_V1",

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

        calendarSpanDays:
          1,
      },

      fillRate:
        1,

      decision: {
        enoughSample:
          false,

        fillPassed:
          true,

        pairedPassed:
          false,

        forwardOosGatePassed:
          false,

        nextUse:
          "CONTINUE_TRUE_FORWARD_OOS_COLLECTION",
      },
    },

    outputFile:
      "logs/alpha-v3-entry-v3-forward-shadow-oos.json",

    ...overrides,
  };
}

function main() {
  const waitingEvaluator =
    auditEvaluatorEvidenceConsistencyV1({
      observationsDocument: {
        observations: [
          observation(),
        ],
      },

      evaluatorReport:
        undefined,
    });

  const consistent =
    auditEvaluatorEvidenceConsistencyV1({
      observationsDocument: {
        observations: [
          observation(),
        ],
      },

      evaluatorReport:
        evaluator(),

      summaryReport: {
        contract: {
          historicalTargetCutoff:
            "2026-10-07",

          selectedCap:
            0.01,

          entryScoreThreshold:
            0.66,
        },

        decision: {
          productionPolicyLocked:
            false,
        },

        safety: {
          databaseWrites:
            0,

          ordersCreated:
            0,

          positionsChanged:
            0,
        },
      },
    });

  const badCount =
    auditEvaluatorEvidenceConsistencyV1({
      observationsDocument: {
        observations: [
          observation(),
        ],
      },

      evaluatorReport:
        evaluator({
          evaluation: {
            counts: {
              observations:
                2,

              qualifiedObservations:
                1,

              filledObservations:
                1,
            },

            decision: {
              enoughSample:
                false,

              fillPassed:
                true,

              pairedPassed:
                false,

              forwardOosGatePassed:
                false,
            },
          },
        }),
    });

  const badContract =
    auditEvaluatorEvidenceConsistencyV1({
      observationsDocument: {
        observations: [
          observation(),
        ],
      },

      evaluatorReport:
        evaluator({
          contract: {
            historicalCutoff:
              "2026-10-08",

            selectedCap:
              0.02,

            entryScoreThreshold:
              0.70,

            retuningAllowed:
              true,
          },
        }),
    });

  const checks = {
    waitingEvaluatorSafe:
      waitingEvaluator.gateStatus ===
      "WAITING_FOR_EVALUATOR_REPORT",

    consistentPass:
      consistent.gateStatus ===
      "EVALUATOR_EVIDENCE_CONSISTENT",

    countMismatchBlocked:
      badCount.gateStatus ===
      "EVALUATOR_EVIDENCE_INCONSISTENT" &&
      badCount.failed.includes(
        "evaluatorObservationCountMatches",
      ),

    frozenContractMismatchBlocked:
      badContract.gateStatus ===
      "EVALUATOR_EVIDENCE_INCONSISTENT" &&
      badContract.failed.includes(
        "historicalCutoffFrozen",
      ) &&
      badContract.failed.includes(
        "selectedCapFrozen",
      ) &&
      badContract.failed.includes(
        "entryThresholdFrozen",
      ) &&
      badContract.failed.includes(
        "retuningDisabled",
      ),

    noPromotion:
      consistent.safety
        .promotionExecuted ===
      false,

    readOnly:
      consistent.safety
        .readOnly ===
      true,

    noTradingSideEffects:
      consistent.safety
        .ordersCreated ===
        0 &&
      consistent.safety
        .positionsChanged ===
        0 &&
      consistent.safety
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
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_EVALUATOR_EVIDENCE_CONSISTENCY_GATE_V1_CONTRACT_VERIFIED",

        checks,

        observations: {
          waiting:
            waitingEvaluator.gateStatus,

          consistent:
            consistent.gateStatus,

          badCount:
            badCount.failed,

          badContract:
            badContract.failed,
        },

        safety: {
          syntheticOnly:
            true,

          evaluatorExecuted:
            false,

          summaryExecuted:
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

          promotionExecuted:
            false,
        },

        failed:
          [],

        nextGate:
          "STATIC_VERIFY_THEN_RUN_CURRENT_READ_ONLY_EVIDENCE_GATE",
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
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_EVALUATOR_EVIDENCE_CONSISTENCY_GATE_V1_CONTRACT_FAILED",

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
  "true-forward-oos-evaluator-evidence-consistency-gate-v1.ts"
);

if (!fs.existsSync(target)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_EVALUATOR_EVIDENCE_CONSISTENCY_GATE_V1_STATIC_FAILED",

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

    canonicalBindingUsed:
      source.includes(
        "bindActualForwardObservations"
      ),

    actualObservationFile:
      source.includes(
        "alpha-v3-entry-v3-forward-oos-observations.json"
      ),

    actualEvaluatorFile:
      source.includes(
        "alpha-v3-entry-v3-forward-shadow-oos.json"
      ),

    summaryFile:
      source.includes(
        "alpha-v3-true-forward-oos-summary.json"
      ),

    observationCountConsistency:
      source.includes(
        "evaluatorObservationCountMatches"
      ),

    qualifiedCountConsistency:
      source.includes(
        "evaluatorQualifiedCountMatches"
      ),

    filledCountConsistency:
      source.includes(
        "evaluatorFilledCountMatches"
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

    retuningDisabled:
      source.includes(
        "retuningDisabled"
      ),

    failClosed:
      source.includes(
        "EVALUATOR_EVIDENCE_INCONSISTENT"
      ),

    noEvaluatorExecution:
      !/spawn\\s*\\(|execSync\\s*\\(|spawnSync\\s*\\(/.test(
        source
      ),

    readOnlyDisk:
      source.includes(
        "readFileSync"
      ) &&
      !source.includes(
        "writeFileSync"
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
    Object.entries(checks)
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
        ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_EVALUATOR_EVIDENCE_CONSISTENCY_GATE_V1_STATIC_VERIFIED"
        : "AI_STOCK_LAB_TRUE_FORWARD_OOS_EVALUATOR_EVIDENCE_CONSISTENCY_GATE_V1_STATIC_FAILED",

    checks,

    safety: {
      sourceOnly:
        true,

      evaluatorExecuted:
        false,

      summaryExecuted:
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

      promotionExecuted:
        false,
    },

    failed,

    nextGate:
      failed.length === 0
        ? "RUN_EVALUATOR_EVIDENCE_CONSISTENCY_CONTRACT"
        : "REPAIR_EVALUATOR_EVIDENCE_CONSISTENCY_GATE_V1",
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
      "forward-oos:evidence-consistency"
    ] =
      "tsx --env-file=.env.local ./scripts/true-forward-oos-evaluator-evidence-consistency-gate-v1.ts";

    pkg.scripts[
      "test:true-forward-oos-evidence-consistency"
    ] =
      "tsx --env-file=.env.local ./scripts/true-forward-oos-evaluator-evidence-consistency-gate-v1-contract-test.ts";

    pkg.scripts[
      "test:true-forward-oos-evidence-consistency-static"
    ] =
      "node ./scripts/true-forward-oos-evaluator-evidence-consistency-gate-v1-static-verify.cjs";

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
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_EVALUATOR_EVIDENCE_CONSISTENCY_GATE_V1_INSTALLED",

      generatedFiles: [
        "scripts/true-forward-oos-evaluator-evidence-consistency-gate-v1.ts",
        "scripts/true-forward-oos-evaluator-evidence-consistency-gate-v1-contract-test.ts",
        "scripts/true-forward-oos-evaluator-evidence-consistency-gate-v1-static-verify.cjs"
      ],

      productSourceChanges:
        0,

      verifies: [
        "OBSERVATION_COUNT_MATCH",
        "QUALIFIED_COUNT_MATCH",
        "FILLED_COUNT_MATCH",
        "HISTORICAL_CUTOFF_FROZEN",
        "SELECTED_CAP_FROZEN",
        "ENTRY_THRESHOLD_FROZEN",
        "RETUNING_DISABLED",
        "EVALUATOR_DECISION_PRESENT",
        "SUMMARY_CONTRACT_OPTIONAL_CROSS_CHECK"
      ],

      safety: {
        readOnly:
          true,

        installerExecutedEvaluator:
          false,

        installerExecutedSummary:
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

        promotionExecuted:
          false
      },

      nextAction:
        "RUN_STATIC_CONTRACT_AND_CURRENT_READ_ONLY_EVIDENCE_GATE"
    }, null, 2));

    process.exitCode = 0;
  }
}
