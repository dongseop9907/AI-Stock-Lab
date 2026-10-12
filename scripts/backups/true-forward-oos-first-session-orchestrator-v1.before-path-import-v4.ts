import { spawnSync } from "node:child_process";

import {
  isKrxTradingDate,
} from "../lib/trading/krx-trading-calendar";

const TARGET_DATE =
  "2026-10-12";

const KST_WINDOW_START =
  "08:45";

const KST_WINDOW_END =
  "08:59";

const EXECUTE_CONFIRM =
  "RUN_TRUE_FORWARD_OOS_NORMAL_PRODUCER";

const NODE =
  process.execPath;

const TSX_CLI =
  path.join(
    process.cwd(),
    "node_modules",
    "tsx",
    "dist",
    "cli.mjs",
  );

type EnvOverlay =
  Record<
    string,
    string | undefined
  >;

type StepResult = {
  step: string;
  command: string;
  args: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
};

function kstNowParts(
  now = new Date(),
) {
  const formatter =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone:
          "Asia/Seoul",
        year:
          "numeric",
        month:
          "2-digit",
        day:
          "2-digit",
        hour:
          "2-digit",
        minute:
          "2-digit",
        second:
          "2-digit",
        hourCycle:
          "h23",
      },
    );

  const parts =
    formatter.formatToParts(
      now,
    );

  const map =
    Object.fromEntries(
      parts.map(
        part => [
          part.type,
          part.value,
        ],
      ),
    );

  return {
    date:
      `${map.year}-${map.month}-${map.day}`,
    time:
      `${map.hour}:${map.minute}`,
    timestamp:
      `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:${map.second}+09:00`,
  };
}

function run(
  step: string,
  command: string,
  args: string[],
  extraEnv: EnvOverlay = {},
): StepResult {
  const result =
    spawnSync(
      command,
      args,
      {
        cwd:
          process.cwd(),

        env: {
          ...process.env,
          ...extraEnv,
        },

        encoding:
          "utf8",

        shell:
          false,

        windowsHide:
          true,
      },
    );

  const exitCode =
    typeof result.status ===
      "number"
      ? result.status
      : 1;

  return {
    step,
    command,
    args,
    exitCode,

    stdout:
      result.stdout ??
      "",

    stderr:
      (
        result.stderr ??
        ""
      ) +
      (
        result.error
          ? (
              "\n" +
              String(
                result.error.message,
              )
            )
          : ""
      ),
  };
}

function outputStep(
  result: StepResult,
) {
  console.log(
    JSON.stringify(
      {
        step:
          result.step,
        exitCode:
          result.exitCode,
      },
      null,
      2,
    ),
  );

  if (
    result.stdout.trim()
      .length >
    0
  ) {
    console.log(
      result.stdout.trimEnd(),
    );
  }

  if (
    result.stderr.trim()
      .length >
    0
  ) {
    console.error(
      result.stderr.trimEnd(),
    );
  }
}

function executeAllowed(
  now: Date,
) {
  const kst =
    kstNowParts(now);

  const insideWindow =
    kst.date ===
      TARGET_DATE &&
    kst.time >=
      KST_WINDOW_START &&
    kst.time <=
      KST_WINDOW_END;

  const targetTradingDate =
    isKrxTradingDate(
      TARGET_DATE,
    );

  const confirmation =
    process.env
      .FORWARD_OOS_FIRST_SESSION_CONFIRM ??
    "";

  const globalAutomationOff =
    (
      process.env
        .FORWARD_OOS_AUTOMATION_ENABLED ??
      "false"
    )
      .trim()
      .toLowerCase() !==
    "true";

  const tradingFlagsOff =
    (
      process.env
        .REAL_TRADING_ENABLED ??
      "false"
    )
      .trim()
      .toLowerCase() !==
      "true" &&
    (
      process.env
        .ENABLE_REAL_TRADING ??
      "false"
    )
      .trim()
      .toLowerCase() !==
      "true" &&
    (
      process.env
        .ENABLE_LIVE_TRADING ??
      "false"
    )
      .trim()
      .toLowerCase() !==
      "true";

  const exactConfirmation =
    confirmation ===
    EXECUTE_CONFIRM;

  return {
    kst,
    targetTradingDate,
    insideWindow,
    exactConfirmation,
    globalAutomationOff,
    tradingFlagsOff,
    allowed:
      targetTradingDate &&
      insideWindow &&
      exactConfirmation &&
      globalAutomationOff &&
      tradingFlagsOff,
  };
}

async function main() {
  const dryRun =
    process.argv.includes(
      "--dry-run",
    );

  const execute =
    process.argv.includes(
      "--execute",
    );

  if (
    dryRun === execute
  ) {
    console.error(
      JSON.stringify(
        {
          status:
            "AI_STOCK_LAB_FORWARD_OOS_FIRST_SESSION_ORCHESTRATOR_V1_USAGE_ERROR",
          reason:
            "Use exactly one of --dry-run or --execute.",
        },
        null,
        2,
      ),
    );

    process.exitCode = 2;
    return;
  }

  const now =
    new Date();

  const guard =
    executeAllowed(
      now,
    );

  const steps:
    StepResult[] = [];

  const readiness =
    run(
      "FIRST_REAL_SESSION_READINESS",
      NODE,
      [
        TSX_CLI,
        "--env-file=.env.local",
        ".\\scripts\\true-forward-oos-first-real-session-readiness-v1.ts",
      ],
    );

  steps.push(
    readiness,
  );

  outputStep(
    readiness,
  );

  if (
    readiness.exitCode !==
    0
  ) {
    console.log(
      JSON.stringify(
        {
          status:
            "AI_STOCK_LAB_FORWARD_OOS_FIRST_SESSION_ORCHESTRATOR_V1_BLOCKED",
          blockedAt:
            readiness.step,
          mode:
            dryRun
              ? "DRY_RUN"
              : "EXECUTE",
          guard,
          safety: {
            normalProducerExecuted:
              false,
            realTradingEnabled:
              false,
          },
        },
        null,
        2,
      ),
    );

    process.exitCode = 1;
    return;
  }

  const evidenceDryRun =
    run(
      "CONTROLLED_EVIDENCE_PREFLIGHT",
      NODE,
      [
        TSX_CLI,
        "--env-file=.env.local",
        ".\\scripts\\true-forward-oos-controlled-producer-evidence-run-v1.ts",
        "--dry-run",
      ],
    );

  steps.push(
    evidenceDryRun,
  );

  outputStep(
    evidenceDryRun,
  );

  if (
    evidenceDryRun.exitCode !==
    0
  ) {
    console.log(
      JSON.stringify(
        {
          status:
            "AI_STOCK_LAB_FORWARD_OOS_FIRST_SESSION_ORCHESTRATOR_V1_BLOCKED",
          blockedAt:
            evidenceDryRun.step,
          mode:
            dryRun
              ? "DRY_RUN"
              : "EXECUTE",
          guard,
          safety: {
            normalProducerExecuted:
              false,
            realTradingEnabled:
              false,
          },
        },
        null,
        2,
      ),
    );

    process.exitCode = 1;
    return;
  }

  if (
    dryRun
  ) {
    const monitor =
      run(
        "DATA_QUALITY_MONITOR",
        NODE,
        [
          TSX_CLI,
          "--env-file=.env.local",
          ".\\scripts\\forward-oos-data-quality-integrity-monitor-v1.ts",
        ],
      );

    steps.push(
      monitor,
    );

    outputStep(
      monitor,
    );

    const dashboard =
      run(
        "DASHBOARD_CONTRACT",
        NODE,
        [
          TSX_CLI,
          "--env-file=.env.local",
          ".\\scripts\\forward-oos-observability-dashboard-v1-contract-test.ts",
        ],
      );

    steps.push(
      dashboard,
    );

    outputStep(
      dashboard,
    );

    const failed =
      steps.filter(
        step =>
          step.exitCode !==
          0,
      );

    console.log(
      JSON.stringify(
        {
          status:
            failed.length === 0
              ? "AI_STOCK_LAB_FORWARD_OOS_FIRST_SESSION_ORCHESTRATOR_V1_DRY_RUN_PASS"
              : "AI_STOCK_LAB_FORWARD_OOS_FIRST_SESSION_ORCHESTRATOR_V1_DRY_RUN_FAILED",

          mode:
            "DRY_RUN",

          guard,

          steps:
            steps.map(
              step => ({
                step:
                  step.step,
                exitCode:
                  step.exitCode,
              }),
            ),

          interpretation: {
            normalProducerExecuted:
              false,

            ledgerProjectWriteExpected:
              false,

            waitBeforeFirstSessionIsNormal:
              true,

            executeWindow:
              `${TARGET_DATE} ${KST_WINDOW_START}-${KST_WINDOW_END} KST`,
          },

          safety: {
            normalProducerExecuted:
              false,
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

          nextGate:
            failed.length === 0
              ? "WAIT_FOR_2026_10_12_0845_KST_EXECUTE_WINDOW"
              : "REPAIR_FIRST_SESSION_ORCHESTRATOR_PREFLIGHT",
        },
        null,
        2,
      ),
    );

    process.exitCode =
      failed.length === 0
        ? 0
        : 1;

    return;
  }

  if (
    !guard.allowed
  ) {
    console.log(
      JSON.stringify(
        {
          status:
            "AI_STOCK_LAB_FORWARD_OOS_FIRST_SESSION_ORCHESTRATOR_V1_EXECUTION_BLOCKED",
          mode:
            "EXECUTE",
          guard,
          required: {
            date:
              TARGET_DATE,
            kstWindow:
              `${KST_WINDOW_START}-${KST_WINDOW_END}`,
            confirmationEnv:
              "FORWARD_OOS_FIRST_SESSION_CONFIRM",
            confirmationValue:
              EXECUTE_CONFIRM,
            globalAutomation:
              "OFF",
            realTrading:
              "OFF",
          },
          safety: {
            normalProducerExecuted:
              false,
            ordersCreated:
              0,
            positionsChanged:
              0,
            promotionExecuted:
              false,
            realTradingEnabled:
              false,
          },
        },
        null,
        2,
      ),
    );

    process.exitCode = 3;
    return;
  }

  const executeEvidence =
    run(
      "CONTROLLED_NORMAL_EVIDENCE_RUN",
      NODE,
      [
        TSX_CLI,
        "--env-file=.env.local",
        ".\\scripts\\true-forward-oos-controlled-producer-evidence-run-v1.ts",
      ],
      {
        FORWARD_OOS_FIRST_SESSION_CONFIRM:
          EXECUTE_CONFIRM,

        REAL_TRADING_ENABLED:
          "false",

        ENABLE_REAL_TRADING:
          "false",

        ENABLE_LIVE_TRADING:
          "false",

        FORWARD_OOS_AUTOMATION_ENABLED:
          "false",
      },
    );

  steps.push(
    executeEvidence,
  );

  outputStep(
    executeEvidence,
  );

  if (
    executeEvidence.exitCode !==
    0
  ) {
    console.log(
      JSON.stringify(
        {
          status:
            "AI_STOCK_LAB_FORWARD_OOS_FIRST_SESSION_ORCHESTRATOR_V1_EXECUTION_FAILED",
          failedAt:
            executeEvidence.step,
          guard,
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
    return;
  }

  const monitor =
    run(
      "POST_CAPTURE_DATA_QUALITY",
      NODE,
      [
        TSX_CLI,
        "--env-file=.env.local",
        ".\\scripts\\forward-oos-data-quality-integrity-monitor-v1.ts",
      ],
    );

  steps.push(
    monitor,
  );

  outputStep(
    monitor,
  );

  const dashboard =
    run(
      "POST_CAPTURE_DASHBOARD",
      NODE,
      [
        TSX_CLI,
        "--env-file=.env.local",
        ".\\scripts\\forward-oos-observability-dashboard-v1-contract-test.ts",
      ],
    );

  steps.push(
    dashboard,
  );

  outputStep(
    dashboard,
  );

  const failed =
    steps.filter(
      step =>
        step.exitCode !==
        0,
    );

  console.log(
    JSON.stringify(
      {
        status:
          failed.length === 0
            ? "AI_STOCK_LAB_FORWARD_OOS_FIRST_SESSION_ORCHESTRATOR_V1_EXECUTE_PASS"
            : "AI_STOCK_LAB_FORWARD_OOS_FIRST_SESSION_ORCHESTRATOR_V1_POST_CAPTURE_BLOCKED",

        mode:
          "EXECUTE",

        guard,

        steps:
          steps.map(
            step => ({
              step:
                step.step,
              exitCode:
                step.exitCode,
            }),
          ),

        safety: {
          maxNormalEvidenceRuns:
            1,
          realTradingForcedOff:
            true,
          promotionExecuted:
            false,
        },

        nextGate:
          failed.length === 0
            ? "VERIFY_FIRST_CONTROLLED_SESSION_LEDGER_AND_BEGIN_1D_MATURITY_WAIT"
            : "REVIEW_POST_CAPTURE_INTEGRITY_BEFORE_ANY_FURTHER_FORWARD_RUN",
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

void main();
