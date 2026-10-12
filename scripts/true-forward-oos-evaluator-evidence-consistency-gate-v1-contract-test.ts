// AI_STOCK_LAB_PATCH_EVALUATOR_EVIDENCE_CONSISTENCY_NEVER_TYPES_V1
// Contract-test-only literal narrowing for inferred never keys. Runtime evaluator behavior unchanged.
import assert from "node:assert/strict";

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
        ("evaluatorObservationCountMatches" as never),
      ),

    frozenContractMismatchBlocked:
      badContract.gateStatus ===
      "EVALUATOR_EVIDENCE_INCONSISTENT" &&
      badContract.failed.includes(
        ("historicalCutoffFrozen" as never),
      ) &&
      badContract.failed.includes(
        ("selectedCapFrozen" as never),
      ) &&
      badContract.failed.includes(
        ("entryThresholdFrozen" as never),
      ) &&
      badContract.failed.includes(
        ("retuningDisabled" as never),
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
