import assert from "node:assert/strict";

import {
  CONTROLLED_NORMAL_PRODUCER_CONFIRM,
  runControlledNormalProducerV1,
} from "./true-forward-oos-controlled-normal-producer-v1";

async function main() {
  const baseEnv = {
    FORWARD_OOS_CONTROLLED_NORMAL_PRODUCER_ENABLED:
      "true",

    FORWARD_OOS_CONTROLLED_NORMAL_PRODUCER_CONFIRM:
      CONTROLLED_NORMAL_PRODUCER_CONFIRM,

    FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_ONLY:
      "false",

    REAL_TRADING_ENABLED:
      "false",

    ENABLE_REAL_TRADING:
      "false",

    ENABLE_LIVE_TRADING:
      "false",
  };

  const disabled =
    await runControlledNormalProducerV1({
      now:
        new Date(
          "2026-10-11T23:50:00.000Z",
        ),

      dryRun:
        true,

      env: {
        ...baseEnv,

        FORWARD_OOS_CONTROLLED_NORMAL_PRODUCER_ENABLED:
          "false",
      },
    });

  const wrongConfirm =
    await runControlledNormalProducerV1({
      now:
        new Date(
          "2026-10-11T23:50:00.000Z",
        ),

      dryRun:
        true,

      env: {
        ...baseEnv,

        FORWARD_OOS_CONTROLLED_NORMAL_PRODUCER_CONFIRM:
          "WRONG",
      },
    });

  const realTradingBlocked =
    await runControlledNormalProducerV1({
      now:
        new Date(
          "2026-10-11T23:50:00.000Z",
        ),

      dryRun:
        true,

      env: {
        ...baseEnv,

        REAL_TRADING_ENABLED:
          "true",
      },
    });

  const probeBlocked =
    await runControlledNormalProducerV1({
      now:
        new Date(
          "2026-10-11T23:50:00.000Z",
        ),

      dryRun:
        true,

      env: {
        ...baseEnv,

        FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_ONLY:
          "true",
      },
    });

  const holiday =
    await runControlledNormalProducerV1({
      now:
        new Date(
          "2026-10-08T23:50:00.000Z",
        ),

      dryRun:
        true,

      env:
        baseEnv,
    });

  const tooEarly =
    await runControlledNormalProducerV1({
      now:
        new Date(
          "2026-10-11T23:40:00.000Z",
        ),

      dryRun:
        true,

      env:
        baseEnv,
    });

  const tooLate =
    await runControlledNormalProducerV1({
      now:
        new Date(
          "2026-10-12T00:01:00.000Z",
        ),

      dryRun:
        true,

      env:
        baseEnv,
    });

  const ready =
    await runControlledNormalProducerV1({
      now:
        new Date(
          "2026-10-11T23:50:00.000Z",
        ),

      dryRun:
        true,

      env:
        baseEnv,
    });

  const checks = {
    disabledByDefaultGate:
      disabled.status ===
      "CONTROLLED_NORMAL_PRODUCER_DISABLED",

    wrongConfirmationBlocked:
      wrongConfirm.reason ===
      "EXACT_CONFIRMATION_REQUIRED",

    realTradingBlocked:
      realTradingBlocked.reason ===
      "REAL_TRADING_MUST_REMAIN_DISABLED",

    probeModeBlocked:
      probeBlocked.reason ===
      "PROBE_MODE_MUST_BE_DISABLED_FOR_NORMAL_PRODUCER",

    hangeulDaySkipped:
      holiday.reason ===
      "NON_KRX_TRADING_DAY",

    tooEarlyBlocked:
      tooEarly.reason ===
      "OUTSIDE_0845_0859_KST_WINDOW",

    tooLateBlocked:
      tooLate.reason ===
      "OUTSIDE_0845_0859_KST_WINDOW",

    oct12ReadyDryRun:
      ready.status ===
      "CONTROLLED_NORMAL_PRODUCER_READY_DRY_RUN",

    dryRunNeverExecutesNormalProducer:
      ready.executed ===
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
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_CONTROLLED_NORMAL_PRODUCER_V1_CONTRACT_VERIFIED",

        checks,

        observations: {
          disabled,
          wrongConfirm,
          realTradingBlocked,
          probeBlocked,
          holiday,
          tooEarly,
          tooLate,
          ready,
        },

        safety: {
          normalProducerExecuted:
            false,

          databaseReadsExpected:
            0,

          databaseWritesExpected:
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
          "STATIC_VERIFY_THEN_PREPARE_2026_10_12_CONTROLLED_NORMAL_PRODUCER_RUN",
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
            "AI_STOCK_LAB_TRUE_FORWARD_OOS_CONTROLLED_NORMAL_PRODUCER_V1_CONTRACT_FAILED",

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
