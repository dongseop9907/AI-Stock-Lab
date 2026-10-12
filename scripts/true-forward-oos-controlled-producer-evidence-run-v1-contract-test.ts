import assert from "node:assert/strict";

import {
  runControlledProducerEvidenceV1,
} from "./true-forward-oos-controlled-producer-evidence-run-v1";

async function main() {
  const report =
    await runControlledProducerEvidenceV1({
      now:
        new Date(
          "2026-10-11T23:50:00.000Z",
        ),

      dryRun:
        true,

      env: {
        FORWARD_OOS_CONTROLLED_NORMAL_PRODUCER_ENABLED:
          "true",

        FORWARD_OOS_CONTROLLED_NORMAL_PRODUCER_CONFIRM:
          "RUN_TRUE_FORWARD_OOS_NORMAL_PRODUCER",

        FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_ONLY:
          "false",

        REAL_TRADING_ENABLED:
          "false",

        ENABLE_REAL_TRADING:
          "false",

        ENABLE_LIVE_TRADING:
          "false",
      },
    });

  const checks = {
    verified:
      report.status ===
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_CONTROLLED_PRODUCER_EVIDENCE_RUN_V1_VERIFIED",

    dryRunMode:
      report.mode ===
      "DRY_RUN",

    controlledRunnerReady:
      report.controlledResult?.status ===
      "CONTROLLED_NORMAL_PRODUCER_READY_DRY_RUN",

    noForwardMutation:
      report.checks
        .dryRunDidNotMutateForwardFile ===
      true,

    zeroSessionDelta:
      report.delta
        .sessionCount ===
      0,

    realTradingDisabled:
      report.safety
        .realTradingEnabled ===
      false,

    noFailures:
      report.failed.length ===
      0,
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
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_CONTROLLED_PRODUCER_EVIDENCE_RUN_V1_CONTRACT_VERIFIED",

        checks,

        safety: {
          normalProducerExecuted:
            false,

          forwardFileMutated:
            false,

          realTradingEnabled:
            false,

          ordersCreated:
            0,

          positionsChanged:
            0,
        },

        failed:
          [],

        nextGate:
          "STATIC_VERIFY_THEN_HOLD_FOR_2026_10_12_CONTROLLED_NORMAL_RUN",
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
            "AI_STOCK_LAB_TRUE_FORWARD_OOS_CONTROLLED_PRODUCER_EVIDENCE_RUN_V1_CONTRACT_FAILED",

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
