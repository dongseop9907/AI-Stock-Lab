import assert from "node:assert/strict";

import {
  runMaturityAwareCollectorGateV1,
  type CollectorHorizon,
} from "./true-forward-oos-maturity-aware-collector-gate-v1";

async function main() {
  const calls:
    CollectorHorizon[] =
    [];

  const runCollector =
    async (
      horizon:
        CollectorHorizon,
    ) => {
      calls.push(
        horizon,
      );

      return {
        exitCode:
          0,
      };
    };

  const waiting =
    await runMaturityAwareCollectorGateV1({
      auditInput: {
        now:
          new Date(
            "2026-10-12T00:00:00.000Z",
          ),

        sessions:
          [],
      },

      runCollector,
    });

  const notMature =
    await runMaturityAwareCollectorGateV1({
      auditInput: {
        now:
          new Date(
            "2026-10-12T00:00:00.000Z",
          ),

        sessions: [
          {
            sourceTradingDate:
              "2026-10-08",

            targetSessionDate:
              "2026-10-12",

            capturedAt:
              "2026-10-08T23:50:00.000Z",

            candidateCount:
              1,
          },
        ],
      },

      runCollector,
    });

  const oneDay =
    await runMaturityAwareCollectorGateV1({
      auditInput: {
        now:
          new Date(
            "2026-10-13T00:00:00.000Z",
          ),

        sessions: [
          {
            sourceTradingDate:
              "2026-10-08",

            targetSessionDate:
              "2026-10-12",

            capturedAt:
              "2026-10-08T23:50:00.000Z",

            candidateCount:
              1,
          },
        ],
      },

      runCollector,
    });

  const allMature =
    await runMaturityAwareCollectorGateV1({
      auditInput: {
        now:
          new Date(
            "2026-10-17T00:00:00.000Z",
          ),

        sessions: [
          {
            sourceTradingDate:
              "2026-10-08",

            targetSessionDate:
              "2026-10-12",

            capturedAt:
              "2026-10-08T23:50:00.000Z",

            candidateCount:
              1,
          },
        ],
      },

      runCollector,
    });

  const failClosed =
    await runMaturityAwareCollectorGateV1({
      auditInput: {
        now:
          new Date(
            "2026-10-13T00:00:00.000Z",
          ),

        sessions: [
          {
            sourceTradingDate:
              "2026-10-08",

            targetSessionDate:
              "2026-10-12",

            capturedAt:
              "2026-10-08T23:50:00.000Z",

            candidateCount:
              1,
          },
        ],
      },

      runCollector:
        async () => ({
          exitCode:
            1,

          stderr:
            "synthetic failure",
        }),
    });

  const checks = {
    waitingNoExecution:
      waiting.status ===
        "WAITING_FOR_FORWARD_SESSION" &&
      waiting.executed.length ===
        0,

    notMatureNoExecution:
      notMature.status ===
        "WAITING_FOR_MATURITY" &&
      notMature.executed.length ===
        0,

    oneDayExecutesOnly1D:
      oneDay.status ===
        "MATURE_OUTCOME_COLLECTION_COMPLETED" &&
      oneDay.executed.length ===
        1 &&
      oneDay.executed[0] ===
        "1D",

    allMatureExecutesAll:
      allMature.status ===
        "MATURE_OUTCOME_COLLECTION_COMPLETED" &&
      allMature.executed.join(
        ",",
      ) ===
        "1D,3D,5D",

    failClosedStops:
      failClosed.status ===
      "COLLECTOR_FAILED_FAIL_CLOSED",

    noRealTrading:
      waiting.safety
        .realTradingEnabled ===
        false &&
      oneDay.safety
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
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_MATURITY_AWARE_COLLECTOR_GATE_V1_CONTRACT_VERIFIED",

        checks,

        calls,

        safety: {
          syntheticCollectorOnly:
            true,

          realCollectorExecuted:
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
            "AI_STOCK_LAB_TRUE_FORWARD_OOS_MATURITY_AWARE_COLLECTOR_GATE_V1_CONTRACT_FAILED",

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
