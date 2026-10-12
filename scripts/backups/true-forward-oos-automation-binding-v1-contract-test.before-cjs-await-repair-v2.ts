import {
  runTrueForwardOosAutomationBindingV1,
  type ForwardOosAutomationState,
  type ForwardOosAutomationStep,
} from "../lib/research/run-true-forward-oos-automation-binding-v1";

function assert(
  condition: unknown,
  message: string,
) {
  if (!condition) {
    throw new Error(message);
  }
}

function kst(
  date: string,
  time: string,
) {
  return new Date(
    `${date}T${time}+09:00`,
  );
}

const date =
  "2026-10-09";

const memory:
  {
    state:
      ForwardOosAutomationState | null;
  } = {
    state: null,
  };

const calls:
  ForwardOosAutomationStep[] =
    [];

const deps = {
  env: {
    FORWARD_OOS_AUTOMATION_ENABLED:
      "true",
  } as NodeJS.ProcessEnv,

  loadState:
    () =>
      memory.state,

  saveState:
    (
      state:
        ForwardOosAutomationState,
    ) => {
      memory.state =
        JSON.parse(
          JSON.stringify(
            state,
          ),
        );
    },

  runStep:
    async (
      step:
        ForwardOosAutomationStep,
    ) => {
      calls.push(step);

      return {
        exitCode: 0,
        stdout: "",
        stderr: "",
      };
    },
};

const disabled =
  await runTrueForwardOosAutomationBindingV1(
    {
      now: kst(
        date,
        "08:50:00",
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

assert(
  disabled.status ===
    "DISABLED",
  "disabled must not run",
);

assert(
  calls.length === 0,
  "disabled spawned subprocess",
);

const produced =
  await runTrueForwardOosAutomationBindingV1(
    {
      now: kst(
        date,
        "08:50:00",
      ),
    },
    deps,
  );

assert(
  produced.executed.join(
    ",",
  ) === "PRODUCE",
  "producer not isolated",
);

const collectedAndEvaluated =
  await runTrueForwardOosAutomationBindingV1(
    {
      now: kst(
        date,
        "15:50:00",
      ),
    },
    deps,
  );

assert(
  collectedAndEvaluated.executed.join(
    ",",
  ) ===
    "COLLECT,EVALUATE",
  "collect/evaluate order invalid",
);

const summarized =
  await runTrueForwardOosAutomationBindingV1(
    {
      now: kst(
        date,
        "16:00:00",
      ),
    },
    deps,
  );

assert(
  summarized.executed.join(
    ",",
  ) === "SUMMARY",
  "summary not executed",
);

const duplicate =
  await runTrueForwardOosAutomationBindingV1(
    {
      now: kst(
        date,
        "16:01:00",
      ),
    },
    deps,
  );

assert(
  duplicate.executed.length === 0,
  "duplicate step executed",
);

const missedState:
  {
    state:
      ForwardOosAutomationState | null;
  } = {
    state: null,
  };

const missed =
  await runTrueForwardOosAutomationBindingV1(
    {
      now: kst(
        "2026-10-10",
        "09:01:00",
      ),
    },
    {
      ...deps,
      loadState:
        () =>
          missedState.state,
      saveState:
        (
          state:
            ForwardOosAutomationState,
        ) => {
          missedState.state =
            state;
        },
    },
  );

assert(
  missed.status ===
    "FAILED_CLOSED",
  "missed producer window not blocked",
);

assert(
  missed.blockedReason ===
    "FORWARD_OOS_PRODUCER_WINDOW_MISSED_FAIL_CLOSED",
  "wrong missed window reason",
);

const failedCalls:
  ForwardOosAutomationStep[] =
    [];

let failedState:
  ForwardOosAutomationState | null =
    null;

const failedProduce =
  await runTrueForwardOosAutomationBindingV1(
    {
      now: kst(
        "2026-10-11",
        "08:50:00",
      ),
    },
    {
      env: {
        FORWARD_OOS_AUTOMATION_ENABLED:
          "true",
      },
      loadState:
        () =>
          failedState,
      saveState:
        (
          state:
            ForwardOosAutomationState,
        ) => {
          failedState =
            state;
        },
      runStep:
        async (
          step:
            ForwardOosAutomationStep,
        ) => {
          failedCalls.push(
            step,
          );

          return {
            exitCode: 9,
            stdout: "",
            stderr: "",
          };
        },
    },
  );

assert(
  failedProduce.status ===
    "FAILED_CLOSED",
  "failed subprocess did not fail closed",
);

assert(
  failedCalls.join(",") ===
    "PRODUCE",
  "steps continued after failure",
);

console.log(JSON.stringify({
  status:
    "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_BINDING_V1_CONTRACT_VERIFIED",
  checks: {
    disabledNoExecution:
      true,
    producerBeforeOpen:
      true,
    collectThenEvaluate:
      true,
    summaryAfterEvaluation:
      true,
    duplicateSuppressed:
      true,
    missedProducerWindowFailClosed:
      true,
    subprocessFailureFailClosed:
      true,
  },
  safety: {
    realSubprocessExecuted:
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
  failed: [],
  nextGate:
    "STATIC_VERIFY_SCHEDULER_BINDING",
}, null, 2));
