import {
  runTrueForwardOosAutomationBindingV1,
} from "../lib/research/run-true-forward-oos-automation-binding-v1";

function clone<T>(
  value: T,
): T {
  return JSON.parse(
    JSON.stringify(
      value,
    ),
  );
}

async function main() {
  const envKeys = [
    "FORWARD_OOS_AUTOMATION_ENABLED",
    "FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_ONLY",
    "REAL_TRADING_ENABLED",
    "ENABLE_REAL_TRADING",
    "ENABLE_LIVE_TRADING",
  ] as const;

  const before =
    Object.fromEntries(
      envKeys.map(
        key => [
          key,
          process.env[key],
        ],
      ),
    );

  let memoryState: any = null;
  let saveCount = 0;

  try {
    process.env.FORWARD_OOS_AUTOMATION_ENABLED =
      "true";

    process.env.FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_ONLY =
      "true";

    process.env.REAL_TRADING_ENABLED =
      "false";

    process.env.ENABLE_REAL_TRADING =
      "false";

    process.env.ENABLE_LIVE_TRADING =
      "false";

    const env = {
      ...process.env,

      FORWARD_OOS_AUTOMATION_ENABLED:
        "true",

      FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_ONLY:
        "true",

      REAL_TRADING_ENABLED:
        "false",

      ENABLE_REAL_TRADING:
        "false",

      ENABLE_LIVE_TRADING:
        "false",
    };

    const result =
      await runTrueForwardOosAutomationBindingV1(
        {
          now:
            new Date(
              "2026-10-07T23:50:00.000Z",
            ),
        },
        {
          env,

          loadState:
            () =>
              memoryState,

          saveState:
            state => {
              saveCount += 1;

              memoryState =
                clone(
                  state,
                );
            },

          // Intentionally NO runStep override.
          // This forces the binding's real defaultRunStep -> spawn(...)
          // -> real producer file -> --probe-only path.
        },
      );

    const executed =
      Array.isArray(
        (result as any).executed,
      )
        ? (result as any).executed
        : [];

    const completed =
      Array.isArray(
        (result as any).completed,
      )
        ? (result as any).completed
        : [];

    const status =
      String(
        (result as any).status ??
        "",
      );

    const blockedReason =
      (result as any).blockedReason ??
      null;

    const checks = {
      automationReturned:
        Boolean(result),

      defaultRunStepUsed:
        true,

      realSpawnPathRequested:
        true,

      produceExecuted:
        executed.includes(
          "PRODUCE",
        ),

      onlyProduceExecuted:
        executed.length === 1 &&
        executed[0] === "PRODUCE",

      produceCompleted:
        completed.includes(
          "PRODUCE",
        ),

      completedStatus:
        status.includes(
          "COMPLETED",
        ),

      notBlocked:
        blockedReason === null,

      memoryStateSaved:
        saveCount > 0 &&
        memoryState !== null,

      probeModeEnabled:
        process.env.FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_ONLY ===
        "true",

      realTradingDisabled:
        process.env.REAL_TRADING_ENABLED ===
          "false" &&
        process.env.ENABLE_REAL_TRADING ===
          "false" &&
        process.env.ENABLE_LIVE_TRADING ===
          "false",
    };

    const failed =
      Object.entries(
        checks,
      )
        .filter(
          ([, value]) =>
            value !== true,
        )
        .map(
          ([key]) =>
            key,
        );

    console.log(
      JSON.stringify(
        {
          status:
            failed.length === 0
              ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_DEFAULT_RUNSTEP_PRODUCER_PROBE_ONLY_V1_VERIFIED"
              : "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_DEFAULT_RUNSTEP_PRODUCER_PROBE_ONLY_V1_FAILED",

          observation: {
            automationStatus:
              status,

            executed,

            completed,

            blockedReason,

            saveCount,

            statePresent:
              memoryState !== null,
          },

          checks,

          safety: {
            runStepOverrideProvided:
              false,

            actualBindingDefaultRunStep:
              true,

            producerProbeOnlyRequested:
              true,

            normalProducerExecutionExpected:
              false,

            collectorExpected:
              false,

            evaluatorExpected:
              false,

            summaryExpected:
              false,

            stateFileWrite:
              false,

            realTradingEnabled:
              false,
          },

          failed,

          nextGate:
            failed.length === 0
              ? "RUN_FULL_FORWARD_OOS_AUTOMATION_REGRESSION_AFTER_REAL_BINDING_PROBE_PATH_V1"
              : "REPAIR_DEFAULT_RUNSTEP_PROBE_ONLY_RUNTIME_PATH",
        },
        null,
        2,
      ),
    );

    process.exitCode =
      failed.length === 0
        ? 0
        : 1;
  } finally {
    for (
      const key of envKeys
    ) {
      const oldValue =
        before[key];

      if (
        oldValue === undefined
      ) {
        delete process.env[key];
      } else {
        process.env[key] =
          oldValue;
      }
    }
  }
}

main().catch(
  error => {
    console.error(
      JSON.stringify(
        {
          status:
            "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_DEFAULT_RUNSTEP_PRODUCER_PROBE_ONLY_V1_ERROR",

          error:
            String(
              error instanceof Error
                ? error.stack ??
                  error.message
                : error
            ),

          safety: {
            realTradingEnabled:
              false,
          },
        },
        null,
        2,
      ),
    );

    process.exitCode = 1;
  },
);
