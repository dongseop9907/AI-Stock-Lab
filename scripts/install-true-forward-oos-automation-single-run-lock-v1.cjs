const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const targetRel =
  "lib/research/run-true-forward-oos-automation-binding-v1.ts";

const target = path.join(ROOT, targetRel);

const backupDir =
  path.join(ROOT, "scripts", "backups");

const contractRel =
  "scripts/true-forward-oos-automation-concurrency-v1-contract-test.ts";

const contractPath =
  path.join(ROOT, contractRel);

const marker =
  "AI_STOCK_LAB_FORWARD_OOS_AUTOMATION_SINGLE_RUN_LOCK_V1";

function out(obj, error = false) {
  (error ? console.error : console.log)(
    JSON.stringify(obj, null, 2),
  );
}

function functionBlock(
  source,
  functionName,
) {
  const needle =
    `export async function ${functionName}(`;

  const start =
    source.indexOf(needle);

  if (start < 0) {
    return null;
  }

  const braceStart =
    source.indexOf("{", start);

  if (braceStart < 0) {
    return null;
  }

  let depth = 0;
  let quote = null;
  let escaped = false;

  for (
    let i = braceStart;
    i < source.length;
    i++
  ) {
    const ch = source[i];

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (ch === "\\") {
        escaped = true;
        continue;
      }

      if (ch === quote) {
        quote = null;
      }

      continue;
    }

    if (
      ch === '"' ||
      ch === "'" ||
      ch === "`"
    ) {
      quote = ch;
      continue;
    }

    if (ch === "{") {
      depth++;
    }

    if (ch === "}") {
      depth--;

      if (depth === 0) {
        return {
          start,
          braceStart,
          end: i + 1,
          text:
            source.slice(
              start,
              i + 1,
            ),
        };
      }
    }
  }

  return null;
}

if (!fs.existsSync(target)) {
  out({
    status:
      "AI_STOCK_LAB_FORWARD_OOS_AUTOMATION_SINGLE_RUN_LOCK_V1_FAILED",
    message:
      "TARGET_FILE_NOT_FOUND",
    target: targetRel,
  }, true);

  process.exitCode = 1;
  return;
}

let source =
  fs.readFileSync(
    target,
    "utf8",
  );

const alreadyApplied =
  source.includes(marker);

fs.mkdirSync(
  backupDir,
  { recursive: true },
);

const backup =
  path.join(
    backupDir,
    "run-true-forward-oos-automation-binding-v1.before-single-run-lock-v1.ts",
  );

if (
  !alreadyApplied &&
  !fs.existsSync(backup)
) {
  fs.copyFileSync(
    target,
    backup,
  );
}

let depsChanged = 0;
let helperInserted = 0;
let wrapperCallChanged = 0;

if (!alreadyApplied) {
  /*
   * Dependency surface:
   * - production defaults stay internal
   * - test can point lock at temp directory
   */
  if (
    !/automationLockFilePath\?\s*:\s*string\s*;/.test(source)
  ) {
    const anchor =
      /(\s+retryFailedState\?\s*:\s*boolean\s*;)/;

    if (!anchor.test(source)) {
      out({
        status:
          "AI_STOCK_LAB_FORWARD_OOS_AUTOMATION_SINGLE_RUN_LOCK_V1_FAILED",
        message:
          "RETRY_DEPENDENCY_ANCHOR_NOT_FOUND",
        target: targetRel,
      }, true);

      process.exitCode = 1;
      return;
    }

    source =
      source.replace(
        anchor,
        `$1
  automationLockFilePath?: string;
  automationLockStaleMs?: number;`,
      );

    depsChanged = 1;
  }

  const wrapper =
    functionBlock(
      source,
      "runTrueForwardOosAutomationBindingV1",
    );

  if (!wrapper) {
    out({
      status:
        "AI_STOCK_LAB_FORWARD_OOS_AUTOMATION_SINGLE_RUN_LOCK_V1_FAILED",
      message:
        "PUBLIC_WRAPPER_NOT_FOUND",
      target: targetRel,
    }, true);

    process.exitCode = 1;
    return;
  }

  const coreReturnNeedle =
    "return runTrueForwardOosAutomationBindingV1Core(";

  const callCount =
    wrapper.text
      .split(coreReturnNeedle)
      .length - 1;

  if (callCount < 1) {
    out({
      status:
        "AI_STOCK_LAB_FORWARD_OOS_AUTOMATION_SINGLE_RUN_LOCK_V1_FAILED",
      message:
        "CORE_RETURN_CALL_NOT_FOUND_IN_PUBLIC_WRAPPER",
      coreReturnCallCount:
        callCount,
    }, true);

    process.exitCode = 1;
    return;
  }

  /*
   * Insert helper immediately before public wrapper.
   * The helper owns the lock across the whole core run, including
   * state load, step execution, completion persistence and return.
   */
  const helper = String.raw`
/* ${marker} */
const FORWARD_OOS_AUTOMATION_LOCK_FILE_V1 =
  path.join(
    process.cwd(),
    "logs",
    "true-forward-oos-automation-binding-v1.lock",
  );

const FORWARD_OOS_AUTOMATION_LOCK_MALFORMED_STALE_MS_V1 =
  5 * 60 * 1000;

interface ForwardOosAutomationLockHandleV1 {
  acquired: boolean;
  file: string;
  token: string | null;
  recoveredStaleLock: boolean;
  blockedReason: string | null;
}

function isForwardOosAutomationPidAliveV1(
  pid: number,
): boolean {
  if (
    !Number.isInteger(pid) ||
    pid <= 0
  ) {
    return false;
  }

  try {
    process.kill(
      pid,
      0,
    );

    return true;
  } catch {
    return false;
  }
}

function readForwardOosAutomationLockV1(
  file: string,
): {
  pid: number | null;
  token: string | null;
  createdAtMs: number | null;
} {
  try {
    const parsed =
      JSON.parse(
        fs.readFileSync(
          file,
          "utf8",
        ),
      ) as {
        pid?: unknown;
        token?: unknown;
        createdAtMs?: unknown;
      };

    return {
      pid:
        typeof parsed.pid === "number"
          ? parsed.pid
          : null,

      token:
        typeof parsed.token === "string"
          ? parsed.token
          : null,

      createdAtMs:
        typeof parsed.createdAtMs === "number"
          ? parsed.createdAtMs
          : null,
    };
  } catch {
    return {
      pid: null,
      token: null,
      createdAtMs: null,
    };
  }
}

function acquireForwardOosAutomationSingleRunLockV1(
  deps: ForwardOosAutomationDependencies,
): ForwardOosAutomationLockHandleV1 {
  const file =
    deps.automationLockFilePath ??
    FORWARD_OOS_AUTOMATION_LOCK_FILE_V1;

  const malformedStaleMs =
    Number.isFinite(
      deps.automationLockStaleMs,
    ) &&
    Number(
      deps.automationLockStaleMs,
    ) >= 1000
      ? Number(
          deps.automationLockStaleMs,
        )
      : FORWARD_OOS_AUTOMATION_LOCK_MALFORMED_STALE_MS_V1;

  fs.mkdirSync(
    path.dirname(file),
    { recursive: true },
  );

  const token =
    [
      process.pid,
      Date.now(),
      Math.random()
        .toString(36)
        .slice(2),
    ].join("-");

  const attemptAcquire =
    (
      recoveredStaleLock: boolean,
    ): ForwardOosAutomationLockHandleV1 => {
      let fd:
        number | null =
          null;

      try {
        fd =
          fs.openSync(
            file,
            "wx",
          );

        fs.writeFileSync(
          fd,
          JSON.stringify(
            {
              schemaVersion:
                "FORWARD_OOS_AUTOMATION_SINGLE_RUN_LOCK_V1",
              pid:
                process.pid,
              token,
              createdAtMs:
                Date.now(),
              createdAt:
                new Date().toISOString(),
            },
            null,
            2,
          ),
          "utf8",
        );

        return {
          acquired: true,
          file,
          token,
          recoveredStaleLock,
          blockedReason: null,
        };
      } catch (error) {
        const code =
          error &&
          typeof error === "object" &&
          "code" in error
            ? String(
                (
                  error as {
                    code?: unknown;
                  }
                ).code ??
                "",
              )
            : "";

        if (code !== "EEXIST") {
          return {
            acquired: false,
            file,
            token: null,
            recoveredStaleLock,
            blockedReason:
              "FORWARD_OOS_AUTOMATION_LOCK_ACQUIRE_FAILED_FAIL_CLOSED",
          };
        }

        return {
          acquired: false,
          file,
          token: null,
          recoveredStaleLock,
          blockedReason:
            "FORWARD_OOS_AUTOMATION_ALREADY_RUNNING_FAIL_CLOSED",
        };
      } finally {
        if (fd !== null) {
          fs.closeSync(fd);
        }
      }
    };

  const first =
    attemptAcquire(
      false,
    );

  if (
    first.acquired ||
    first.blockedReason !==
      "FORWARD_OOS_AUTOMATION_ALREADY_RUNNING_FAIL_CLOSED"
  ) {
    return first;
  }

  let recoverable =
    false;

  try {
    const existing =
      readForwardOosAutomationLockV1(
        file,
      );

    if (
      existing.pid !== null
    ) {
      recoverable =
        !isForwardOosAutomationPidAliveV1(
          existing.pid,
        );
    } else {
      const stat =
        fs.statSync(file);

      const ageMs =
        Math.max(
          0,
          Date.now() -
            stat.mtimeMs,
        );

      recoverable =
        ageMs >=
        malformedStaleMs;
    }
  } catch {
    recoverable = false;
  }

  if (!recoverable) {
    return first;
  }

  try {
    fs.rmSync(
      file,
      { force: true },
    );
  } catch {
    return first;
  }

  return attemptAcquire(
    true,
  );
}

function releaseForwardOosAutomationSingleRunLockV1(
  handle: ForwardOosAutomationLockHandleV1,
) {
  if (
    !handle.acquired ||
    !handle.token
  ) {
    return;
  }

  try {
    const current =
      readForwardOosAutomationLockV1(
        handle.file,
      );

    if (
      current.token ===
      handle.token
    ) {
      fs.rmSync(
        handle.file,
        { force: true },
      );
    }
  } catch {
    // Cleanup is best effort. Ownership token prevents deleting
    // a replacement lock created by another process.
  }
}

async function runTrueForwardOosAutomationBindingV1WithSingleRunLock(
  input:
    Parameters<
      typeof runTrueForwardOosAutomationBindingV1Core
    >[0],
  deps:
    ForwardOosAutomationDependencies = {},
): Promise<ForwardOosAutomationResult> {
  const lock =
    acquireForwardOosAutomationSingleRunLockV1(
      deps,
    );

  if (!lock.acquired) {
    const disabled =
      await runTrueForwardOosAutomationBindingV1Core(
        input,
        {
          ...deps,

          env: {
            ...(deps.env ?? process.env),

            FORWARD_OOS_AUTOMATION_ENABLED:
              "false",
          },
        },
      );

    return {
      ...disabled,

      status:
        "FAILED_CLOSED",

      blockedReason:
        lock.blockedReason ??
        "FORWARD_OOS_AUTOMATION_LOCK_ACQUIRE_FAILED_FAIL_CLOSED",
    };
  }

  try {
    return await runTrueForwardOosAutomationBindingV1Core(
      input,
      deps,
    );
  } finally {
    releaseForwardOosAutomationSingleRunLockV1(
      lock,
    );
  }
}

`;

  source =
    source.slice(
      0,
      wrapper.start,
    ) +
    helper +
    source.slice(
      wrapper.start,
    );

  helperInserted = 1;

  /*
   * Re-find wrapper after helper insertion, then replace only the
   * final core dispatch. The earlier core dispatch is preserved for
   * the wrapper's disabled path, so disabled remains side-effect-free.
   */
  const wrapperAfterHelper =
    functionBlock(
      source,
      "runTrueForwardOosAutomationBindingV1",
    );

  if (!wrapperAfterHelper) {
    out({
      status:
        "AI_STOCK_LAB_FORWARD_OOS_AUTOMATION_SINGLE_RUN_LOCK_V1_FAILED",
      message:
        "PUBLIC_WRAPPER_NOT_FOUND_AFTER_HELPER_INSERT",
    }, true);

    process.exitCode = 1;
    return;
  }

  const lastCallIndex =
    wrapperAfterHelper.text
      .lastIndexOf(
        coreReturnNeedle,
      );

  if (lastCallIndex < 0) {
    out({
      status:
        "AI_STOCK_LAB_FORWARD_OOS_AUTOMATION_SINGLE_RUN_LOCK_V1_FAILED",
      message:
        "FINAL_CORE_DISPATCH_NOT_FOUND",
    }, true);

    process.exitCode = 1;
    return;
  }

  const changedWrapper =
    wrapperAfterHelper.text.slice(
      0,
      lastCallIndex,
    ) +
    "return runTrueForwardOosAutomationBindingV1WithSingleRunLock(" +
    wrapperAfterHelper.text.slice(
      lastCallIndex +
        coreReturnNeedle.length,
    );

  source =
    source.slice(
      0,
      wrapperAfterHelper.start,
    ) +
    changedWrapper +
    source.slice(
      wrapperAfterHelper.end,
    );

  wrapperCallChanged = 1;

  fs.writeFileSync(
    target,
    source,
    "utf8",
  );
}

const contract = String.raw`import fs from "node:fs";
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
`;

fs.writeFileSync(
  contractPath,
  contract,
  "utf8",
);

const after =
  fs.readFileSync(
    target,
    "utf8",
  );

const verify = {
  marker:
    after.includes(marker),

  lockPathDependency:
    /automationLockFilePath\?\s*:\s*string\s*;/.test(after),

  staleDependency:
    /automationLockStaleMs\?\s*:\s*number\s*;/.test(after),

  exclusiveCreate:
    /openSync\s*\(\s*file\s*,\s*"wx"/.test(after),

  pidLiveness:
    /process\.kill\s*\(\s*pid\s*,\s*0/.test(after),

  staleRecovery:
    /recoveredStaleLock/.test(after) &&
    /fs\.rmSync\s*\(\s*file/.test(after),

  ownershipToken:
    /current\.token\s*===\s*handle\.token/.test(after),

  finallyRelease:
    /finally\s*\{[\s\S]{0,300}releaseForwardOosAutomationSingleRunLockV1/.test(after),

  failClosedCollision:
    after.includes(
      "FORWARD_OOS_AUTOMATION_ALREADY_RUNNING_FAIL_CLOSED",
    ),

  normalCoreUsesLock:
    /return runTrueForwardOosAutomationBindingV1WithSingleRunLock\s*\(/.test(after),

  contractCreated:
    fs.existsSync(
      contractPath,
    ),
};

const failed =
  Object.entries(verify)
    .filter(
      ([, value]) =>
        value !== true,
    )
    .map(
      ([key]) => key,
    );

if (failed.length > 0) {
  out({
    status:
      "AI_STOCK_LAB_FORWARD_OOS_AUTOMATION_SINGLE_RUN_LOCK_V1_FAILED",

    message:
      "POST_PATCH_VERIFICATION_FAILED",

    verify,
    failed,

    backup:
      path
        .relative(
          ROOT,
          backup,
        )
        .replace(
          /\\/g,
          "/",
        ),
  }, true);

  process.exitCode = 1;
  return;
}

out({
  status:
    alreadyApplied
      ? "AI_STOCK_LAB_FORWARD_OOS_AUTOMATION_SINGLE_RUN_LOCK_V1_ALREADY_APPLIED"
      : "AI_STOCK_LAB_FORWARD_OOS_AUTOMATION_SINGLE_RUN_LOCK_V1_INSTALLED",

  target:
    targetRel,

  backup:
    path
      .relative(
        ROOT,
        backup,
      )
      .replace(
        /\\/g,
        "/",
      ),

  generatedContract:
    contractRel,

  changes: {
    lockDependencies:
      alreadyApplied
        ? "PRESENT"
        : depsChanged === 1,

    singleRunLockHelper:
      alreadyApplied
        ? "PRESENT"
        : helperInserted === 1,

    normalWrapperDispatchProtected:
      alreadyApplied
        ? "PRESENT"
        : wrapperCallChanged === 1,
  },

  behavior: {
    crossProcessLock:
      "EXCLUSIVE_CREATE_WX",

    lockScope:
      "FULL_NORMAL_CORE_RUN",

    concurrentInvocation:
      "FAIL_CLOSED_NO_SUBPROCESS",

    staleLockRecovery:
      "DEAD_PID_OR_OLD_MALFORMED_LOCK_ONLY",

    ownerProtection:
      "TOKEN_MATCH_REQUIRED_FOR_RELEASE",

    cleanup:
      "FINALLY",

    disabledPath:
      "PRESERVED_WITHOUT_NORMAL_LOCK_DISPATCH",

    realTrading:
      "UNCHANGED_OFF",
  },

  safety: {
    installerRuntimeAutomationExecuted:
      false,

    canonicalForwardFilesWritten:
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

  nextAction:
    "RUN_CONCURRENCY_RECOVERY_EXISTING_CONTRACTS_AND_FULL_TSC",
});
