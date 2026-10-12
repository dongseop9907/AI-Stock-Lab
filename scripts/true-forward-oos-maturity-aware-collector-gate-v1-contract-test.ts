import assert from "node:assert/strict";

import {
  runMaturityAwareCollectorGateV1,
} from "./true-forward-oos-maturity-aware-collector-gate-v1";

function audit(
  ready: {
    "1D": boolean;
    "3D": boolean;
    "5D": boolean;
  },
) {
  return {
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_POST_CAPTURE_MATURITY_AUDIT_V1",

    integrityStatus:
      "VERIFIED",

    invalidSessions:
      [],

    maturityReady:
      ready,
  };
}

async function main() {
  let auditFailureCollectorCalls =
    0;

  const auditFailure =
    await runMaturityAwareCollectorGateV1({
      auditMaturity:
        async () => {
          throw new Error(
            "synthetic audit failure",
          );
        },

      runCollector:
        async () => {
          auditFailureCollectorCalls +=
            1;

          return {
            ok:
              true,

            exitCode:
              0,
          };
        },
    });

  let waitingCalls =
    0;

  const waiting =
    await runMaturityAwareCollectorGateV1({
      auditMaturity:
        async () => ({
          status:
            "WAITING_FOR_FORWARD_SESSION",

          integrityStatus:
            "WAITING",

          invalidSessions:
            [],

          maturityReady: {
            "1D": false,
            "3D": false,
            "5D": false,
          },
        }),

      runCollector:
        async () => {
          waitingCalls +=
            1;

          return {
            ok:
              true,

            exitCode:
              0,
          };
        },
    });

  let notMatureCalls =
    0;

  const notMature =
    await runMaturityAwareCollectorGateV1({
      auditMaturity:
        async () =>
          audit({
            "1D": false,
            "3D": false,
            "5D": false,
          }),

      runCollector:
        async () => {
          notMatureCalls +=
            1;

          return {
            ok:
              true,

            exitCode:
              0,
          };
        },
    });

  let oneDayCalls =
    0;

  const oneDay =
    await runMaturityAwareCollectorGateV1({
      auditMaturity:
        async () =>
          audit({
            "1D": true,
            "3D": false,
            "5D": false,
          }),

      runCollector:
        async () => {
          oneDayCalls +=
            1;

          return {
            ok:
              true,

            exitCode:
              0,
          };
        },
    });

  let allMatureCalls =
    0;

  const allMature =
    await runMaturityAwareCollectorGateV1({
      auditMaturity:
        async () =>
          audit({
            "1D": true,
            "3D": true,
            "5D": true,
          }),

      runCollector:
        async () => {
          allMatureCalls +=
            1;

          return {
            ok:
              true,

            exitCode:
              0,
          };
        },
    });

  let failureCalls =
    0;

  const collectorFailure =
    await runMaturityAwareCollectorGateV1({
      auditMaturity:
        async () =>
          audit({
            "1D": true,
            "3D": true,
            "5D": false,
          }),

      runCollector:
        async () => {
          failureCalls +=
            1;

          return {
            ok:
              false,

            exitCode:
              1,

            stderr:
              "synthetic failure",
          };
        },
    });

  let integrityCalls =
    0;

  const integrityFailure =
    await runMaturityAwareCollectorGateV1({
      auditMaturity:
        async () => ({
          status:
            "AI_STOCK_LAB_TRUE_FORWARD_OOS_POST_CAPTURE_MATURITY_AUDIT_V1",

          integrityStatus:
            "FAILED",

          invalidSessions: [
            {
              reason:
                "synthetic",
            },
          ],

          maturityReady: {
            "1D": true,
            "3D": true,
            "5D": true,
          },
        }),

      runCollector:
        async () => {
          integrityCalls +=
            1;

          return {
            ok:
              true,

            exitCode:
              0,
          };
        },
    });


  let actualShapeCollectorCalls =
    0;

  const actualAuditShapeWaiting =
    await runMaturityAwareCollectorGateV1({
      auditMaturity:
        async () => ({
          status:
            "AI_STOCK_LAB_TRUE_FORWARD_OOS_POST_CAPTURE_MATURITY_AUDIT_V1",

          auditStatus:
            "WAITING_FOR_FORWARD_SESSION",

          sourceFile:
            null,

          counts: {
            sessions:
              0,

            valid:
              0,

            invalid:
              0,

            maturityReady: {
              "1D": 0,
              "3D": 0,
              "5D": 0,
            },
          },

          sessions:
            [],
        }),

      runCollector:
        async () => {
          actualShapeCollectorCalls +=
            1;

          return {
            ok:
              true,

            exitCode:
              0,
          };
        },
    });

  const checks = {
    actualAuditShapeWaitingRecognized:
      actualAuditShapeWaiting.gateStatus ===
        "WAITING_FOR_FORWARD_SESSION" &&
      actualShapeCollectorCalls ===
        0 &&
      actualAuditShapeWaiting.collectorRuns ===
        0,


    auditFailureFailsClosed:
      auditFailure.gateStatus ===
        "MATURITY_AUDIT_FAILED_CLOSED" &&
      auditFailureCollectorCalls ===
        0 &&
      auditFailure.collectorRuns ===
        0,

    waitingNoExecution:
      waiting.gateStatus ===
        "WAITING_FOR_FORWARD_SESSION" &&
      waitingCalls ===
        0 &&
      waiting.collectorRuns ===
        0,

    notMatureNoExecution:
      notMature.gateStatus ===
        "WAITING_FOR_MATURITY" &&
      notMatureCalls ===
        0 &&
      notMature.collectorRuns ===
        0,

    oneDayRunsCollectorExactlyOnce:
      oneDay.gateStatus ===
        "MATURE_OUTCOME_COLLECTION_COMPLETED" &&
      oneDayCalls ===
        1 &&
      oneDay.collectorRuns ===
        1,

    oneDayTracksMaturedHorizon:
      JSON.stringify(
        oneDay.maturedHorizons
      ) ===
      JSON.stringify([
        "1D",
      ]),

    allMatureStillRunsCollectorExactlyOnce:
      allMature.gateStatus ===
        "MATURE_OUTCOME_COLLECTION_COMPLETED" &&
      allMatureCalls ===
        1 &&
      allMature.collectorRuns ===
        1,

    allMatureTracksAllHorizons:
      JSON.stringify(
        allMature.maturedHorizons
      ) ===
      JSON.stringify([
        "1D",
        "3D",
        "5D",
      ]),

    collectorFailureFailsClosedAfterOneCall:
      collectorFailure.gateStatus ===
        "COLLECTOR_FAILED_CLOSED" &&
      failureCalls ===
        1 &&
      collectorFailure.collectorRuns ===
        1,

    integrityFailureSkipsCollector:
      integrityFailure.gateStatus ===
        "BLOCKED_SESSION_INTEGRITY_FAILURE" &&
      integrityCalls ===
        0,

    noCliHorizonArgumentSemantics:
      oneDay.safety
        .collectorCliHorizonArgumentUsed ===
        false &&
      allMature.safety
        .collectorSingleRunBinding ===
        true,

    auditUsesSubprocessInProductionPath:
      allMature.safety
        .maturityAuditBinding ===
        "READ_ONLY_SUBPROCESS" &&
      allMature.safety
        .maturityAuditInternalHelperImport ===
        false,

    noTradingSideEffects:
      allMature.safety
        .ordersCreated ===
        0 &&
      allMature.safety
        .positionsChanged ===
        0 &&
      allMature.safety
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
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_MATURITY_AWARE_COLLECTOR_GATE_V1_AUDIT_SUBPROCESS_CONTRACT_VERIFIED",

        checks,

        observations: {
          auditFailure:
            auditFailure.gateStatus,

          waiting:
            waiting.gateStatus,

          notMature:
            notMature.gateStatus,

          oneDay: {
            gateStatus:
              oneDay.gateStatus,

            maturedHorizons:
              oneDay.maturedHorizons,

            collectorRuns:
              oneDay.collectorRuns,
          },

          allMature: {
            gateStatus:
              allMature.gateStatus,

            maturedHorizons:
              allMature.maturedHorizons,

            collectorRuns:
              allMature.collectorRuns,
          },

          collectorFailure:
            collectorFailure.gateStatus,

          integrityFailure:
            integrityFailure.gateStatus,
        },

        safety: {
          syntheticOnly:
            true,

          realMaturityAuditExecuted:
            false,

          realCollectorExecuted:
            false,

          databaseWrites:
            0,

          ordersCreated:
            0,

          positionsChanged:
            0,

          promotionExecuted:
            false,

          realTradingEnabled:
            false,
        },

        failed:
          [],

        nextGate:
          "STATIC_VERIFY_THEN_RUN_CURRENT_GATE_EXPECT_WAITING",
      },
      null,
      2,
    ),
  );
}

main().catch(
  error => {
    console.error(
      JSON.stringify(
        {
          status:
            "AI_STOCK_LAB_TRUE_FORWARD_OOS_MATURITY_AWARE_COLLECTOR_GATE_V1_AUDIT_SUBPROCESS_CONTRACT_FAILED",

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
