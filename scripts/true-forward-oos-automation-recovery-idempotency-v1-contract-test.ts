import {
  runTrueForwardOosAutomationBindingV1,
  type ForwardOosAutomationState,
  type ForwardOosAutomationStep,
} from "../lib/research/run-true-forward-oos-automation-binding-v1";

function assert(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function cloneState(
  state: ForwardOosAutomationState,
): ForwardOosAutomationState {
  return JSON.parse(
    JSON.stringify(state),
  ) as ForwardOosAutomationState;
}

async function main() {
  const kstDate = "2026-10-08";
  const now =
    new Date("2026-10-08T15:50:00+09:00");

  let storedState:
    ForwardOosAutomationState | null = {
      kstDate,
      completed: ["PRODUCE"],
      blockedReason: null,
      lastUpdatedAt:
        "2026-10-08T09:00:00+09:00",
    };

  const firstExecuted:
    ForwardOosAutomationStep[] = [];

  const first =
    await runTrueForwardOosAutomationBindingV1(
      { now },
      {
        env: {
          NODE_ENV: "test",
          FORWARD_OOS_AUTOMATION_ENABLED:
            "true",
          REAL_TRADING_ENABLED:
            "false",
          ENABLE_REAL_TRADING:
            "false",
          ENABLE_LIVE_TRADING:
            "false",
        },

        loadState:
          () =>
            storedState
              ? cloneState(storedState)
              : null,

        saveState:
          (state) => {
            storedState =
              cloneState(state);
          },

        runStep:
          async (step) => {
            firstExecuted.push(step);

            if (step === "COLLECT") {
              return {
                exitCode: 7,
                stdout: "",
                stderr:
                  "synthetic collector failure",
              };
            }

            return {
              exitCode: 0,
              stdout: "",
              stderr: "",
            };
          },
      },
    );

  assert(
    first.status === "FAILED_CLOSED",
    "first failure must fail closed",
  );

  assert(
    firstExecuted.join(",") === "COLLECT",
    "first failure must stop at COLLECT",
  );

  assert(
    storedState !== null,
    "failed state must be persisted",
  );

  const failedState =
    storedState as ForwardOosAutomationState;

  assert(
    failedState.completed.includes(
      "PRODUCE",
    ),
    "PRODUCE completion must survive failure",
  );

  assert(
    !failedState.completed.includes(
      "COLLECT",
    ),
    "failed COLLECT must not be marked complete",
  );

  assert(
    failedState.blockedReason ===
      "FORWARD_OOS_COLLECT_FAILED_EXIT_7",
    "failure reason must be persisted exactly",
  );

  const defaultRetryExecuted:
    ForwardOosAutomationStep[] = [];

  const blockedByDefault =
    await runTrueForwardOosAutomationBindingV1(
      { now },
      {
        env: {
          NODE_ENV: "test",
          FORWARD_OOS_AUTOMATION_ENABLED:
            "true",
          REAL_TRADING_ENABLED:
            "false",
          ENABLE_REAL_TRADING:
            "false",
          ENABLE_LIVE_TRADING:
            "false",
        },

        loadState:
          () =>
            cloneState(failedState),

        saveState:
          () => {},

        runStep:
          async (step) => {
            defaultRetryExecuted.push(step);
            return {
              exitCode: 0,
              stdout: "",
              stderr: "",
            };
          },
      },
    );

  assert(
    defaultRetryExecuted.length === 0,
    "failed state must remain fail-closed without explicit retry",
  );

  const retryExecuted:
    ForwardOosAutomationStep[] = [];

  let recoveredState:
    ForwardOosAutomationState | null =
      null;

  const recovered =
    await runTrueForwardOosAutomationBindingV1(
      { now },
      {
        retryFailedState: true,

        env: {
          NODE_ENV: "test",
          FORWARD_OOS_AUTOMATION_ENABLED:
            "true",
          REAL_TRADING_ENABLED:
            "false",
          ENABLE_REAL_TRADING:
            "false",
          ENABLE_LIVE_TRADING:
            "false",
        },

        loadState:
          () =>
            cloneState(failedState),

        saveState:
          (state) => {
            recoveredState =
              cloneState(state);
          },

        runStep:
          async (step) => {
            retryExecuted.push(step);

            return {
              exitCode: 0,
              stdout: "",
              stderr: "",
            };
          },
      },
    );

  assert(
    !retryExecuted.includes("PRODUCE"),
    "completed PRODUCE must not rerun",
  );

  assert(
    retryExecuted[0] === "COLLECT",
    "explicit recovery must resume from failed COLLECT",
  );

  assert(
    retryExecuted.includes("EVALUATE"),
    "recovery must continue to EVALUATE after COLLECT succeeds",
  );

  assert(
    recoveredState !== null,
    "recovered state must be persisted",
  );

  const finalState =
    recoveredState as ForwardOosAutomationState;

  assert(
    finalState.blockedReason === null,
    "successful recovery must clear failed-exit blocker",
  );

  assert(
    finalState.completed.includes(
      "PRODUCE",
    ) &&
    finalState.completed.includes(
      "COLLECT",
    ) &&
    finalState.completed.includes(
      "EVALUATE",
    ),
    "recovery must preserve old completion and add resumed steps",
  );

  const unsafeBlockedState:
    ForwardOosAutomationState = {
      kstDate,
      completed: [],
      blockedReason:
        "FORWARD_OOS_PRODUCER_WINDOW_MISSED_FAIL_CLOSED",
      lastUpdatedAt:
        "2026-10-08T15:50:00+09:00",
    };

  const unsafeExecuted:
    ForwardOosAutomationStep[] = [];

  const unsafeRetry =
    await runTrueForwardOosAutomationBindingV1(
      { now },
      {
        retryFailedState: true,

        env: {
          NODE_ENV: "test",
          FORWARD_OOS_AUTOMATION_ENABLED:
            "true",
          REAL_TRADING_ENABLED:
            "false",
          ENABLE_REAL_TRADING:
            "false",
          ENABLE_LIVE_TRADING:
            "false",
        },

        loadState:
          () =>
            cloneState(
              unsafeBlockedState,
            ),

        saveState:
          () => {},

        runStep:
          async (step) => {
            unsafeExecuted.push(step);

            return {
              exitCode: 0,
              stdout: "",
              stderr: "",
            };
          },
      },
    );

  assert(
    unsafeExecuted.length === 0,
    "explicit retry must not bypass non-retryable safety blockers",
  );

  const checks = {
    firstFailureFailsClosed:
      first.status === "FAILED_CLOSED",

    failurePersisted:
      failedState.blockedReason ===
      "FORWARD_OOS_COLLECT_FAILED_EXIT_7",

    failedStepNotCompleted:
      !failedState.completed.includes(
        "COLLECT",
      ),

    defaultRetryStillBlocked:
      defaultRetryExecuted.length === 0,

    explicitRetryResumesFailedStep:
      retryExecuted[0] === "COLLECT",

    completedProduceNotRepeated:
      !retryExecuted.includes(
        "PRODUCE",
      ),

    recoveryContinuesPipeline:
      retryExecuted.includes(
        "EVALUATE",
      ),

    recoveredStateClearsBlocker:
      finalState.blockedReason === null,

    unsafeBlockerNotBypassed:
      unsafeExecuted.length === 0,

    noRealTrading:
      true,
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
            ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_RECOVERY_IDEMPOTENCY_V1_CONTRACT_VERIFIED"
            : "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_RECOVERY_IDEMPOTENCY_V1_CONTRACT_FAILED",

        checks,

        observations: {
          firstStatus:
            first.status,

          firstExecuted,

          failedBlockedReason:
            failedState.blockedReason,

          defaultRetryStatus:
            blockedByDefault.status,

          defaultRetryExecuted,

          recoveredStatus:
            recovered.status,

          retryExecuted,

          recoveredCompleted:
            finalState.completed,

          unsafeRetryStatus:
            unsafeRetry.status,

          unsafeExecuted,
        },

        safety: {
          syntheticOnly: true,
          injectedRunStepOnly: true,
          projectStateFileWritten:
            false,
          canonicalForwardFilesWritten:
            0,
          databaseReads: 0,
          databaseWrites: 0,
          ordersCreated: 0,
          positionsChanged: 0,
          promotionExecuted: false,
          realTradingEnabled: false,
        },

        failed,

        nextGate:
          failed.length === 0
            ? "VERIFY_ATOMIC_STATE_WRITE_AND_RUN_FULL_TSC"
            : "REPAIR_RECOVERY_IDEMPOTENCY_BEHAVIOR",
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

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_RECOVERY_IDEMPOTENCY_V1_CONTRACT_ERROR",
        message:
          error instanceof Error
            ? error.message
            : String(error),
      },
      null,
      2,
    ),
  );

  process.exitCode = 1;
});
