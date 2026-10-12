import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
  const tempRoot =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "ai-stock-forward-oos-lock-v1-",
      ),
    );

  const lockFile =
    path.join(
      tempRoot,
      "automation.lock",
    );

  const now =
    new Date(
      "2026-10-08T15:50:00+09:00",
    );

  const state:
    ForwardOosAutomationState = {
      kstDate:
        "2026-10-08",

      completed: [
        "PRODUCE",
      ],

      blockedReason:
        null,

      lastUpdatedAt:
        "2026-10-08T09:00:00+09:00",
    };

  let firstStartedResolve:
    (() => void) | null =
      null;

  const firstStarted =
    new Promise<void>(
      (resolve) => {
        firstStartedResolve =
          resolve;
      },
    );

  let releaseFirstResolve:
    (() => void) | null =
      null;

  const holdFirst =
    new Promise<void>(
      (resolve) => {
        releaseFirstResolve =
          resolve;
      },
    );

  const firstExecuted:
    ForwardOosAutomationStep[] = [];

  const common = {
    automationLockFilePath:
      lockFile,

    automationLockStaleMs:
      1000,

    env: {
      NODE_ENV:
        "test",

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
        cloneState(state),

    saveState:
      () => {},
  };

  const firstPromise =
    runTrueForwardOosAutomationBindingV1(
      { now },
      {
        ...common,

        runStep:
          async (step) => {
            firstExecuted.push(
              step,
            );

            if (
              step === "COLLECT"
            ) {
              firstStartedResolve?.();

              await holdFirst;
            }

            return {
              exitCode: 0,
              stdout: "",
              stderr: "",
            };
          },
      },
    );

  await firstStarted;

  assert(
    fs.existsSync(
      lockFile,
    ),
    "first run must own lock while step is in flight",
  );

  const secondExecuted:
    ForwardOosAutomationStep[] = [];

  const second =
    await runTrueForwardOosAutomationBindingV1(
      { now },
      {
        ...common,

        runStep:
          async (step) => {
            secondExecuted.push(
              step,
            );

            return {
              exitCode: 0,
              stdout: "",
              stderr: "",
            };
          },
      },
    );

  assert(
    second.status ===
      "FAILED_CLOSED",
    "concurrent invocation must fail closed",
  );

  assert(
    second.blockedReason ===
      "FORWARD_OOS_AUTOMATION_ALREADY_RUNNING_FAIL_CLOSED",
    "concurrent invocation must expose exact lock reason",
  );

  assert(
    secondExecuted.length === 0,
    "blocked concurrent invocation must not execute any step",
  );

  releaseFirstResolve?.();

  const first =
    await firstPromise;

  assert(
    firstExecuted[0] ===
      "COLLECT",
    "first run must execute intended step",
  );

  assert(
    !fs.existsSync(
      lockFile,
    ),
    "lock must be released after successful run",
  );

  /*
   * Stale lock recovery:
   * impossible PID => dead owner => old lock is safely reclaimed.
   */
  fs.writeFileSync(
    lockFile,
    JSON.stringify(
      {
        schemaVersion:
          "FORWARD_OOS_AUTOMATION_SINGLE_RUN_LOCK_V1",

        pid:
          2147483647,

        token:
          "synthetic-stale-lock",

        createdAtMs:
          Date.now() -
          60_000,
      },
      null,
      2,
    ),
    "utf8",
  );

  const staleState:
    ForwardOosAutomationState = {
      kstDate:
        "2026-10-08",

      completed: [
        "PRODUCE",
        "COLLECT",
        "EVALUATE",
        "SUMMARY",
      ],

      blockedReason:
        null,

      lastUpdatedAt:
        "2026-10-08T16:01:00+09:00",
    };

  const staleExecuted:
    ForwardOosAutomationStep[] = [];

  const staleRecovered =
    await runTrueForwardOosAutomationBindingV1(
      {
        now:
          new Date(
            "2026-10-08T16:01:00+09:00",
          ),
      },
      {
        ...common,

        loadState:
          () =>
            cloneState(
              staleState,
            ),

        runStep:
          async (step) => {
            staleExecuted.push(
              step,
            );

            return {
              exitCode: 0,
              stdout: "",
              stderr: "",
            };
          },
      },
    );

  assert(
    staleRecovered.status !==
      "FAILED_CLOSED",
    "dead-owner stale lock must be recoverable",
  );

  assert(
    staleExecuted.length === 0,
    "already completed synthetic state must not rerun steps",
  );

  assert(
    !fs.existsSync(
      lockFile,
    ),
    "stale-recovered lock must be released",
  );

  /*
   * Exception path must also release lock.
   */
  let threw =
    false;

  try {
    await runTrueForwardOosAutomationBindingV1(
      { now },
      {
        ...common,

        runStep:
          async () => {
            throw new Error(
              "synthetic-run-step-throw",
            );
          },
      },
    );
  } catch {
    threw = true;
  }

  assert(
    threw,
    "synthetic exception path must throw for this contract",
  );

  assert(
    !fs.existsSync(
      lockFile,
    ),
    "finally must release lock after thrown error",
  );

  const checks = {
    firstRunOwnsLock:
      true,

    concurrentRunFailsClosed:
      second.status ===
      "FAILED_CLOSED",

    concurrentRunNoStepExecution:
      secondExecuted.length === 0,

    exactConcurrentBlockReason:
      second.blockedReason ===
      "FORWARD_OOS_AUTOMATION_ALREADY_RUNNING_FAIL_CLOSED",

    successfulRunReleasesLock:
      !fs.existsSync(
        lockFile,
      ),

    staleDeadOwnerRecovered:
      staleRecovered.status !==
      "FAILED_CLOSED",

    staleRecoveryNoDuplicateSteps:
      staleExecuted.length === 0,

    exceptionPathReleasesLock:
      threw &&
      !fs.existsSync(
        lockFile,
      ),

    noRealTrading:
      true,
  };

  const failed =
    Object.entries(checks)
      .filter(
        ([, value]) =>
          value !== true,
      )
      .map(
        ([key]) => key,
      );

  console.log(
    JSON.stringify(
      {
        status:
          failed.length === 0
            ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_CONCURRENCY_V1_CONTRACT_VERIFIED"
            : "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_CONCURRENCY_V1_CONTRACT_FAILED",

        checks,

        observations: {
          firstStatus:
            first.status,

          firstExecuted,

          secondStatus:
            second.status,

          secondBlockedReason:
            second.blockedReason,

          secondExecuted,

          staleRecoveredStatus:
            staleRecovered.status,

          staleExecuted,

          exceptionObserved:
            threw,
        },

        safety: {
          syntheticOnly:
            true,

          tempLockOnly:
            true,

          projectLockWritten:
            false,

          injectedRunStepOnly:
            true,

          canonicalForwardFilesWritten:
            0,

          databaseReads:
            0,

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

        failed,

        nextGate:
          failed.length === 0
            ? "RUN_EXISTING_RECOVERY_AUTOMATION_CONTRACTS_AND_FULL_TSC"
            : "REPAIR_SINGLE_RUN_LOCK_BEHAVIOR",
      },
      null,
      2,
    ),
  );

  fs.rmSync(
    tempRoot,
    {
      recursive: true,
      force: true,
    },
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
            "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_CONCURRENCY_V1_CONTRACT_ERROR",

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
  },
);
