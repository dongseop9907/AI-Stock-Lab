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
  fs.mkdirSync(
    path.dirname(STATE_FILE),
    {
      recursive: true,
    },
  );

  fs.writeFileSync(
    STATE_FILE,
    JSON.stringify(
      state,
      null,
      2,
    ),
    "utf8",
  );
}

function defaultRunStep(
  step: ForwardOosAutomationStep,
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
          ],
          {
            cwd: process.cwd(),
            env: {
              ...process.env,
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

export async function runTrueForwardOosAutomationBindingV1(
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
    defaultRunStep;

  const state =
    loadState(kstDate) ??
    newState(
      kstDate,
      nowKst,
    );

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
