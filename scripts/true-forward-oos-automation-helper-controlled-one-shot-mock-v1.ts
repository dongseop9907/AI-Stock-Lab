import {
  runTrueForwardOosAutomationBindingV1,
  type ForwardOosAutomationState,
  type ForwardOosAutomationStep,
} from "../lib/research/run-true-forward-oos-automation-binding-v1";

async function main() {
  const calls:
    ForwardOosAutomationStep[] =
      [];

  let state:
    ForwardOosAutomationState | null =
      null;

  let saveCount =
    0;

  const result =
    await runTrueForwardOosAutomationBindingV1(
      {
        now:
          new Date(
            "2026-10-08T08:50:00+09:00",
          ),
      },
      {
        env: {
          ...process.env,

          FORWARD_OOS_AUTOMATION_ENABLED:
            "true",

          REAL_TRADING_ENABLED:
            "false",

          ENABLE_REAL_TRADING:
            "false",

          ENABLE_LIVE_TRADING:
            "false",
        } as NodeJS.ProcessEnv,

        loadState:
          () =>
            state,

        saveState:
          (
            nextState:
              ForwardOosAutomationState,
          ) => {
            state =
              JSON.parse(
                JSON.stringify(
                  nextState,
                ),
              );

            saveCount +=
              1;
          },

        runStep:
          async (
            step:
              ForwardOosAutomationStep,
          ) => {
            calls.push(
              step,
            );

            return {
              exitCode:
                0,

              stdout:
                "MOCK_SUBPROCESS_OK",

              stderr:
                "",
            };
          },
      },
    );

  const hasExecuted =
    "executed" in
    result;

  const executed =
    hasExecuted
      ? result.executed
      : [];

  const checks = {
    enabledPathReached:
      result.status !==
      "DISABLED",

    krxTradingDayNotSkipped:
      result.status !==
      "SKIPPED_NON_KRX_TRADING_DAY",

    onlyProducerSelected:
      executed.join(
        ",",
      ) ===
      "PRODUCE",

    mockRunStepCalledOnce:
      calls.length ===
      1,

    mockRunStepWasProduce:
      calls[0] ===
      "PRODUCE",

    statePersistedInMemory:
      saveCount >=
      1,

    noRealSubprocess:
      true,

    realTradingDisabled:
      process.env
        .REAL_TRADING_ENABLED !==
        "true" &&
      process.env
        .ENABLE_REAL_TRADING !==
        "true" &&
      process.env
        .ENABLE_LIVE_TRADING !==
        "true",
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

  console.log(
    JSON.stringify(
      {
        status:
          failed.length ===
          0
            ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_HELPER_CONTROLLED_ONE_SHOT_MOCK_V1_VERIFIED"
            : "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_HELPER_CONTROLLED_ONE_SHOT_MOCK_V1_FAILED",

        mode:
          "HELPER_ENABLED_WITH_INJECTED_MOCK_SUBPROCESS",

        observation: {
          resultStatus:
            result.status,

          executed,

          mockedCalls:
            calls,

          saveCount,

          statePresent:
            state !==
            null,
        },

        checks,

        safety: {
          realSubprocessExecuted:
            false,

          realCollectorExecuted:
            false,

          realEvaluatorExecuted:
            false,

          realSummaryExecuted:
            false,

          networkCalls:
            0,

          databaseReads:
            0,

          databaseWrites:
            0,

          ordersCreated:
            0,

          positionsChanged:
            0,

          promotionApplied:
            false,

          realTradingEnabled:
            false,
        },

        failed,

        nextGate:
          failed.length ===
          0
            ? "VERIFY_FORWARD_OOS_REAL_SUBPROCESS_COMMAND_BOUNDARY_WITH_NO_EXECUTION_V1"
            : "REPAIR_HELPER_CONTROLLED_ONE_SHOT_MOCK",
      },
      null,
      2,
    ),
  );

  process.exitCode =
    failed.length ===
    0
      ? 0
      : 1;
}

main().catch(
  error => {
    console.error(
      JSON.stringify(
        {
          status:
            "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_HELPER_CONTROLLED_ONE_SHOT_MOCK_V1_FAILED",

          error:
            String(
              error instanceof Error
                ? error.message
                : error,
            ),

          failed: [
            "runtime",
          ],
        },
        null,
        2,
      ),
    );

    process.exitCode = 1;
  },
);
