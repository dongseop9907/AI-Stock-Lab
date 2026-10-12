// AI_STOCK_LAB_FORWARD_OOS_RECOVERY_IDEMPOTENCY_HARDENING_V1
// Explicit opt-in recovery for retryable subprocess failures + atomic automation state writes.
import { isKrxTradingDate } from "../trading/krx-trading-calendar";
import {
  spawn,
} from "node:child_process";

import fs from "node:fs";
import path from "node:path";

export type ForwardOosAutomationStep =
  | "PRODUCE"
  | "COLLECT"
  | "EVALUATE"
  | "SUMMARY";

export interface ForwardOosAutomationState {
  kstDate: string;
  completed: ForwardOosAutomationStep[];
  blockedReason: string | null;
  lastUpdatedAt: string;
}

export interface ForwardOosAutomationResult {
  status:
    | "DISABLED"
    | "WAITING"
    | "COMPLETED_DUE_STEPS"
    | "FAILED_CLOSED";
  kstDate: string;
  nowKst: string;
  executed: ForwardOosAutomationStep[];
  completed: ForwardOosAutomationStep[];
  blockedReason: string | null;
}

export interface ForwardOosAutomationDependencies {
  runStep?: (
    step: ForwardOosAutomationStep,
  ) => Promise<{
    exitCode: number;
    stdout?: string;
    stderr?: string;
  }>;
  loadState?: (
    kstDate: string,
  ) => ForwardOosAutomationState | null;
  saveState?: (
    state: ForwardOosAutomationState,
  ) => void;
  env?: NodeJS.ProcessEnv;
  retryFailedState?: boolean;
  automationLockFilePath?: string;
  automationLockStaleMs?: number;
}

const KST_TIME_ZONE =
  "Asia/Seoul";

const STATE_FILE =
  path.join(
    process.cwd(),
    "logs",
    "true-forward-oos-automation-binding-v1-state.json",
  );

const STEP_SCRIPT: Record<
  ForwardOosAutomationStep,
  string
> = {
  PRODUCE:
    "scripts/alpha-v3-true-forward-top1-producer-v1.ts",
  COLLECT:
    "scripts/alpha-v3-true-entry-forward-oos-collector-v1.ts",
  EVALUATE:
    "scripts/alpha-v3-true-forward-oos-evaluator-v1.ts",
  SUMMARY:
    "scripts/alpha-v3-true-forward-oos-summary.ts",
};

const DEFAULT_TIME: Record<
  ForwardOosAutomationStep,
  string
> = {
  PRODUCE: "08:50",
  COLLECT: "15:40",
  EVALUATE: "15:50",
  SUMMARY: "16:00",
};

function parseBoolean(
  value: string | undefined,
) {
  return (
    value?.trim().toLowerCase() === "true"
  );
}

function parseMinuteOfDay(
  value: string,
) {
  const match =
    /^([01]\d|2[0-3]):([0-5]\d)$/.exec(
      value.trim(),
    );

  if (!match) {
    throw new Error(
      `INVALID_KST_TIME:${value}`,
    );
  }

  return (
    Number(match[1]) * 60 +
    Number(match[2])
  );
}

function kstParts(
  now: Date,
) {
  const formatter =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone: KST_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      },
    );

  const parts =
    Object.fromEntries(
      formatter
        .formatToParts(now)
        .filter(
          (part) =>
            part.type !== "literal",
        )
        .map(
          (part) => [
            part.type,
            part.value,
          ],
        ),
    );

  const kstDate =
    `${parts.year}-${parts.month}-${parts.day}`;

  const minuteOfDay =
    Number(parts.hour) * 60 +
    Number(parts.minute);

  const nowKst =
    `${kstDate}T${parts.hour}:${parts.minute}:${parts.second}+09:00`;

  return {
    kstDate,
    minuteOfDay,
    nowKst,
  };
}

function defaultLoadState(
  kstDate: string,
): ForwardOosAutomationState | null {
  if (!fs.existsSync(STATE_FILE)) {
    return null;
  }

  try {
    const parsed =
      JSON.parse(
        fs.readFileSync(
          STATE_FILE,
          "utf8",
        ),
      ) as ForwardOosAutomationState;

    if (
      parsed.kstDate !==
      kstDate
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function defaultSaveState(
  state: ForwardOosAutomationState,
) {
  // AI_STOCK_LAB_ATOMIC_FORWARD_OOS_STATE_WRITE_V1
  fs.mkdirSync(
    path.dirname(STATE_FILE),
    { recursive: true },
  );

  const tempFile =
    `${STATE_FILE}.${process.pid}.${Date.now()}.tmp`;

  try {
    fs.writeFileSync(
      tempFile,
      JSON.stringify(state, null, 2),
      "utf8",
    );

    fs.renameSync(
      tempFile,
      STATE_FILE,
    );
  } finally {
    if (fs.existsSync(tempFile)) {
      fs.rmSync(
        tempFile,
        { force: true },
      );
    }
  }
}

function defaultRunStep(
  step: ForwardOosAutomationStep,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const script =
    STEP_SCRIPT[step];

  return new Promise(
    (resolve) => {
      const child =
        spawn(
          process.execPath,
          [
            "--env-file=.env.local",
            "--import",
            "tsx",
            script,
            ...(
              step === "PRODUCE" &&
              env.FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_ONLY === "true"
                ? ["--probe-only"]
                : []
            ),
          ], // AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_TEST_MODE_V3
          {
            cwd: process.cwd(),
            env: {
              ...env,
              REAL_TRADING_ENABLED:
                "false",
              ENABLE_REAL_TRADING:
                "false",
              ENABLE_LIVE_TRADING:
                "false",
            },
            stdio: [
              "ignore",
              "pipe",
              "pipe",
            ],
            shell: false,
          },
        );

      let stdout = "";
      let stderr = "";

      child.stdout?.on(
        "data",
        (chunk) => {
          stdout +=
            String(chunk);
        },
      );

      child.stderr?.on(
        "data",
        (chunk) => {
          stderr +=
            String(chunk);
        },
      );

      child.on(
        "error",
        (error) => {
          resolve({
            exitCode: 1,
            stdout,
            stderr:
              `${stderr}\n${String(error.message || error)}`.trim(),
          });
        },
      );

      child.on(
        "close",
        (code) => {
          resolve({
            exitCode:
              typeof code === "number"
                ? code
                : 1,
            stdout,
            stderr,
          });
        },
      );
    },
  );
}

function newState(
  kstDate: string,
  nowKst: string,
): ForwardOosAutomationState {
  return {
    kstDate,
    completed: [],
    blockedReason: null,
    lastUpdatedAt:
      nowKst,
  };
}

function envTime(
  env: NodeJS.ProcessEnv,
  step: ForwardOosAutomationStep,
) {
  const key =
    `FORWARD_OOS_AUTOMATION_${step}_KST`;

  return (
    env[key] ??
    DEFAULT_TIME[step]
  );
}

async function runTrueForwardOosAutomationBindingV1Core(
  input: {
    now?: Date;
  } = {},
  deps: ForwardOosAutomationDependencies = {},
): Promise<ForwardOosAutomationResult> {
  const env =
    deps.env ??
    process.env;

  const now =
    input.now ??
    new Date();

  const {
    kstDate,
    minuteOfDay,
    nowKst,
  } = kstParts(now);

  if (
    !parseBoolean(
      env
        .FORWARD_OOS_AUTOMATION_ENABLED,
    )
  ) {
    return {
      status: "DISABLED",
      kstDate,
      nowKst,
      executed: [],
      completed: [],
      blockedReason: null,
    };
  }

  const loadState =
    deps.loadState ??
    defaultLoadState;

  const saveState =
    deps.saveState ??
    defaultSaveState;

  const runStep =
    deps.runStep ??
    (
      (step) =>
        defaultRunStep(
          step,
          env,
        )
    );

  const state =
    loadState(kstDate) ??
    newState(
      kstDate,
      nowKst,
    );

  // AI_STOCK_LAB_RETRYABLE_FORWARD_OOS_FAILED_EXIT_V1


  const retryableFailedExit =


    typeof state.blockedReason === "string" &&


    /^FORWARD_OOS_(PRODUCE|COLLECT|EVALUATE|SUMMARY)_FAILED_EXIT_\d+$/.test(


      state.blockedReason,


    );



  if (


    state.blockedReason &&


    deps.retryFailedState === true &&


    retryableFailedExit


  ) {


    state.blockedReason = null;


  }

  if (
    state.blockedReason
  ) {
    return {
      status:
        "FAILED_CLOSED",
      kstDate,
      nowKst,
      executed: [],
      completed:
        [...state.completed],
      blockedReason:
        state.blockedReason,
    };
  }

  const produceMinute =
    parseMinuteOfDay(
      envTime(
        env,
        "PRODUCE",
      ),
    );

  const collectMinute =
    parseMinuteOfDay(
      envTime(
        env,
        "COLLECT",
      ),
    );

  const evaluateMinute =
    parseMinuteOfDay(
      envTime(
        env,
        "EVALUATE",
      ),
    );

  const summaryMinute =
    parseMinuteOfDay(
      envTime(
        env,
        "SUMMARY",
      ),
    );

  const marketOpenMinute =
    9 * 60;

  const completed =
    new Set(
      state.completed,
    );

  const executed:
    ForwardOosAutomationStep[] =
      [];

  const persist = (
    blockedReason:
      string | null = null,
  ) => {
    const next:
      ForwardOosAutomationState = {
        kstDate,
        completed:
          [...completed],
        blockedReason,
        lastUpdatedAt:
          nowKst,
      };

    saveState(next);

    return next;
  };

  const execute =
    async (
      step:
        ForwardOosAutomationStep,
    ) => {
      const result =
        await runStep(step);

      executed.push(step);

      if (
        result.exitCode !== 0
      ) {
        const reason =
          `FORWARD_OOS_${step}_FAILED_EXIT_${result.exitCode}`;

        persist(reason);

        return {
          ok: false,
          reason,
        };
      }

      completed.add(step);
      persist(null);

      return {
        ok: true,
        reason: null,
      };
    };

  if (
    !completed.has(
      "PRODUCE",
    )
  ) {
    if (
      minuteOfDay >=
      marketOpenMinute
    ) {
      const reason =
        "FORWARD_OOS_PRODUCER_WINDOW_MISSED_FAIL_CLOSED";

      persist(reason);

      return {
        status:
          "FAILED_CLOSED",
        kstDate,
        nowKst,
        executed,
        completed:
          [...completed],
        blockedReason:
          reason,
      };
    }

    if (
      minuteOfDay >=
      produceMinute
    ) {
      const result =
        await execute(
          "PRODUCE",
        );

      if (!result.ok) {
        return {
          status:
            "FAILED_CLOSED",
          kstDate,
          nowKst,
          executed,
          completed:
            [...completed],
          blockedReason:
            result.reason,
        };
      }
    }
  }

  if (
    completed.has(
      "PRODUCE",
    ) &&
    !completed.has(
      "COLLECT",
    ) &&
    minuteOfDay >=
      collectMinute
  ) {
    const result =
      await execute(
        "COLLECT",
      );

    if (!result.ok) {
      return {
        status:
          "FAILED_CLOSED",
        kstDate,
        nowKst,
        executed,
        completed:
          [...completed],
        blockedReason:
          result.reason,
      };
    }
  }

  if (
    completed.has(
      "COLLECT",
    ) &&
    !completed.has(
      "EVALUATE",
    ) &&
    minuteOfDay >=
      evaluateMinute
  ) {
    const result =
      await execute(
        "EVALUATE",
      );

    if (!result.ok) {
      return {
        status:
          "FAILED_CLOSED",
        kstDate,
        nowKst,
        executed,
        completed:
          [...completed],
        blockedReason:
          result.reason,
      };
    }
  }

  if (
    completed.has(
      "EVALUATE",
    ) &&
    !completed.has(
      "SUMMARY",
    ) &&
    minuteOfDay >=
      summaryMinute
  ) {
    const result =
      await execute(
        "SUMMARY",
      );

    if (!result.ok) {
      return {
        status:
          "FAILED_CLOSED",
        kstDate,
        nowKst,
        executed,
        completed:
          [...completed],
        blockedReason:
          result.reason,
      };
    }
  }

  persist(null);

  return {
    status:
      executed.length > 0
        ? "COMPLETED_DUE_STEPS"
        : "WAITING",
    kstDate,
    nowKst,
    executed,
    completed:
      [...completed],
    blockedReason: null,
  };
}


/* ALPHA_V3_TRUE_FORWARD_OOS_AUTOMATION_BINDING_KRX_GUARD_V1 */
function resolveKstDateKeyForForwardOosAutomationV1(
  now: Date,
): string {
  const parts =
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone:
          "Asia/Seoul",

        year:
          "numeric",

        month:
          "2-digit",

        day:
          "2-digit",
      },
    ).formatToParts(
      now,
    );

  const byType =
    new Map(
      parts.map(
        part => [
          part.type,
          part.value,
        ],
      ),
    );

  const year =
    byType.get(
      "year",
    );

  const month =
    byType.get(
      "month",
    );

  const day =
    byType.get(
      "day",
    );

  if (
    !year ||
    !month ||
    !day
  ) {
    throw new Error(
      "FORWARD_OOS_KST_DATE_RESOLUTION_FAILED",
    );
  }

  return `${year}-${month}-${day}`;
}


/* AI_STOCK_LAB_FORWARD_OOS_AUTOMATION_SINGLE_RUN_LOCK_V1 */
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

export async function runTrueForwardOosAutomationBindingV1(
  ...args:
    Parameters<
      typeof runTrueForwardOosAutomationBindingV1Core
    >
) {
  const options =
    args[0] as
      | {
          now?: Date;
        }
      | undefined;

  const dependencies =
    args[1] as
      | {
          env?:
            Record<
              string,
              string | undefined
            >;
        }
      | undefined;

  const env =
    dependencies?.env ??
    process.env;

  const enabled =
    String(
      env[
        "FORWARD_OOS_AUTOMATION_ENABLED"
      ] ??
      "",
    )
      .trim()
      .toLowerCase() ===
    "true";

  if (
    !enabled
  ) {
    return runTrueForwardOosAutomationBindingV1Core(
      ...args
    );
  }

  const now =
    options?.now ??
    new Date();

  const kstDate =
    resolveKstDateKeyForForwardOosAutomationV1(
      now,
    );

  const tradingDay =
    isKrxTradingDate(
      kstDate,
      [],
    );

  if (
    !tradingDay
  ) {
    return {
      status:
        "SKIPPED_NON_KRX_TRADING_DAY" as const,

      dateKst:
        kstDate,

      reason:
        "CANONICAL_KRX_CALENDAR_CLOSED",

      executedSteps:
        [] as const,
    };
  }

  return runTrueForwardOosAutomationBindingV1WithSingleRunLock(
    ...args
  );
}
