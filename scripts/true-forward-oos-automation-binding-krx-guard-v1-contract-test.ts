import {
  runTrueForwardOosAutomationBindingV1,
} from "../lib/research/run-true-forward-oos-automation-binding-v1";

async function main() {
  const executed: string[] = [];

  const deps = {
    env: {
      FORWARD_OOS_AUTOMATION_ENABLED:
        "true",
    },

    runStep:
      async (step: unknown) => {
        executed.push(
          String(step),
        );

        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
        };
      },

    loadState:
      () => null,

    saveState:
      () => {},
  };

  const weekend =
    await runTrueForwardOosAutomationBindingV1(
      {
        now:
          new Date(
            "2026-10-10T08:50:00+09:00",
          ),
      },
      deps,
    );

  const weekendExecuted =
    [...executed];

  executed.length = 0;

  const hangeulDay =
    await runTrueForwardOosAutomationBindingV1(
      {
        now:
          new Date(
            "2026-10-09T08:50:00+09:00",
          ),
      },
      deps,
    );

  const hangeulExecuted =
    [...executed];

  executed.length = 0;

  const disabledOnHoliday =
    await runTrueForwardOosAutomationBindingV1(
      {
        now:
          new Date(
            "2026-10-09T08:50:00+09:00",
          ),
      },
      {
        ...deps,
        env: {
          FORWARD_OOS_AUTOMATION_ENABLED:
            "false",
        },
      },
    );

  const disabledExecuted =
    [...executed];

  const checks = {
    weekendSkipped:
      weekend.status ===
      "SKIPPED_NON_KRX_TRADING_DAY",

    weekendNoSubprocess:
      weekendExecuted.length === 0,

    verifiedHolidaySkipped:
      hangeulDay.status ===
      "SKIPPED_NON_KRX_TRADING_DAY",

    verifiedHolidayNoSubprocess:
      hangeulExecuted.length === 0,

    disabledStillReturnsDisabled:
      disabledOnHoliday.status ===
      "DISABLED",

    disabledNoSubprocess:
      disabledExecuted.length === 0,
  };

  const failed =
    Object.entries(checks)
      .filter(([, value]) =>
        value !== true
      )
      .map(([key]) => key);

  console.log(
    JSON.stringify(
      {
        status:
          failed.length === 0
            ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_BINDING_KRX_GUARD_V1_CONTRACT_VERIFIED"
            : "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_BINDING_KRX_GUARD_V1_CONTRACT_FAILED",

        checks,

        observations: {
          weekendStatus:
            weekend.status,

          hangeulDayStatus:
            hangeulDay.status,

          disabledStatus:
            disabledOnHoliday.status,

          subprocessStepsExecuted:
            {
              weekend:
                weekendExecuted,

              hangeulDay:
                hangeulExecuted,

              disabled:
                disabledExecuted,
            },
        },

        safety: {
          realSubprocessExecuted:
            false,

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
          failed.length === 0
            ? "RERUN_BINDING_TYPECHECK_AND_SCHEDULER_REGRESSION"
            : "REPAIR_CANONICAL_KRX_BINDING_GUARD",
      },
      null,
      2,
    ),
  );

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}

main().catch(
  (error) => {
    console.error(
      JSON.stringify(
        {
          status:
            "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_BINDING_KRX_GUARD_V1_CONTRACT_FAILED",

          error:
            String(
              error instanceof Error
                ? error.message
                : error,
            ),

          failed: [
            "contractRuntime",
          ],
        },
        null,
        2,
      ),
    );

    process.exitCode = 1;
  },
);
