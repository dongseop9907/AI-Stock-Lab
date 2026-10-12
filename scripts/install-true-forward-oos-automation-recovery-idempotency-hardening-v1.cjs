const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const targetRel = "lib/research/run-true-forward-oos-automation-binding-v1.ts";
const target = path.join(ROOT, targetRel);
const backupDir = path.join(ROOT, "scripts", "backups");

const contractRel =
  "scripts/true-forward-oos-automation-recovery-idempotency-v1-contract-test.ts";
const contractPath = path.join(ROOT, contractRel);

const marker = "AI_STOCK_LAB_FORWARD_OOS_RECOVERY_IDEMPOTENCY_HARDENING_V1";

function out(obj, error = false) {
  (error ? console.error : console.log)(JSON.stringify(obj, null, 2));
}

function functionBlock(source, functionName) {
  const start = source.indexOf(`function ${functionName}(`);
  if (start < 0) return null;

  const braceStart = source.indexOf("{", start);
  if (braceStart < 0) return null;

  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let i = braceStart; i < source.length; i++) {
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

    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }

    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        return {
          start,
          braceStart,
          end: i + 1,
          text: source.slice(start, i + 1),
        };
      }
    }
  }

  return null;
}

if (!fs.existsSync(target)) {
  out({
    status: "AI_STOCK_LAB_FORWARD_OOS_RECOVERY_IDEMPOTENCY_HARDENING_V1_FAILED",
    message: "TARGET_FILE_NOT_FOUND",
    target: targetRel,
  }, true);
  process.exitCode = 1;
  return;
}

let source = fs.readFileSync(target, "utf8");
const alreadyApplied = source.includes(marker);

fs.mkdirSync(backupDir, { recursive: true });

const backup = path.join(
  backupDir,
  "run-true-forward-oos-automation-binding-v1.before-recovery-idempotency-hardening-v1.ts",
);

if (!alreadyApplied && !fs.existsSync(backup)) {
  fs.copyFileSync(target, backup);
}

let interfaceChanged = 0;
let retryGuardChanged = 0;
let atomicSaveChanged = 0;

if (!alreadyApplied) {
  // 1) Add explicit opt-in retry dependency.
  if (!/retryFailedState\?\s*:\s*boolean\s*;/.test(source)) {
    const envPattern = /(\s+env\?\s*:\s*NodeJS\.ProcessEnv\s*;)/;

    if (!envPattern.test(source)) {
      out({
        status: "AI_STOCK_LAB_FORWARD_OOS_RECOVERY_IDEMPOTENCY_HARDENING_V1_FAILED",
        message: "DEPENDENCY_INTERFACE_ENV_ANCHOR_NOT_FOUND",
        target: targetRel,
      }, true);
      process.exitCode = 1;
      return;
    }

    source = source.replace(
      envPattern,
      `$1\n  retryFailedState?: boolean;`,
    );
    interfaceChanged = 1;
  }

  // 2) Add narrowly-scoped explicit recovery just before the existing
  //    state.blockedReason fail-closed return.
  if (!source.includes("AI_STOCK_LAB_RETRYABLE_FORWARD_OOS_FAILED_EXIT_V1")) {
    const blockedPattern =
      /(\n\s*)if\s*\(\s*state\.blockedReason\s*\)\s*\{/;

    const blockedMatch = source.match(blockedPattern);

    if (!blockedMatch) {
      out({
        status: "AI_STOCK_LAB_FORWARD_OOS_RECOVERY_IDEMPOTENCY_HARDENING_V1_FAILED",
        message: "BLOCKED_REASON_GUARD_NOT_FOUND",
        target: targetRel,
      }, true);
      process.exitCode = 1;
      return;
    }

    const indent = blockedMatch[1];

    const retryCode =
`${indent}// AI_STOCK_LAB_RETRYABLE_FORWARD_OOS_FAILED_EXIT_V1
${indent}const retryableFailedExit =
${indent}  typeof state.blockedReason === "string" &&
${indent}  /^FORWARD_OOS_(PRODUCE|COLLECT|EVALUATE|SUMMARY)_FAILED_EXIT_\\d+$/.test(
${indent}    state.blockedReason,
${indent}  );

${indent}if (
${indent}  state.blockedReason &&
${indent}  deps.retryFailedState === true &&
${indent}  retryableFailedExit
${indent}) {
${indent}  state.blockedReason = null;
${indent}}`;

    source = source.replace(
      blockedPattern,
      `${retryCode}${blockedMatch[0]}`,
    );
    retryGuardChanged = 1;
  }

  // 3) Replace only the default state writer with same-directory temp+rename.
  if (!source.includes("AI_STOCK_LAB_ATOMIC_FORWARD_OOS_STATE_WRITE_V1")) {
    const block = functionBlock(source, "defaultSaveState");

    if (!block) {
      out({
        status: "AI_STOCK_LAB_FORWARD_OOS_RECOVERY_IDEMPOTENCY_HARDENING_V1_FAILED",
        message: "DEFAULT_SAVE_STATE_FUNCTION_NOT_FOUND",
        target: targetRel,
      }, true);
      process.exitCode = 1;
      return;
    }

    const header = source.slice(block.start, block.braceStart + 1);

    const atomicFunction =
`${header}
  // AI_STOCK_LAB_ATOMIC_FORWARD_OOS_STATE_WRITE_V1
  fs.mkdirSync(
    path.dirname(STATE_FILE),
    { recursive: true },
  );

  const tempFile =
    \`\${STATE_FILE}.\${process.pid}.\${Date.now()}.tmp\`;

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
}`;

    source =
      source.slice(0, block.start) +
      atomicFunction +
      source.slice(block.end);

    atomicSaveChanged = 1;
  }

  source =
    `// ${marker}\n` +
    `// Explicit opt-in recovery for retryable subprocess failures + atomic automation state writes.\n` +
    source;

  fs.writeFileSync(target, source, "utf8");
}

const contract = String.raw`import {
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
`;

fs.writeFileSync(
  contractPath,
  contract,
  "utf8",
);

const after = fs.readFileSync(target, "utf8");

const checks = {
  marker:
    after.includes(marker),

  explicitRetryDependency:
    /retryFailedState\?\s*:\s*boolean\s*;/.test(after),

  retryableFailedExitGuard:
    after.includes("AI_STOCK_LAB_RETRYABLE_FORWARD_OOS_FAILED_EXIT_V1") &&
    /FAILED_EXIT_/.test(after),

  nonRetryableBlockersPreserved:
    /if\s*\(\s*state\.blockedReason\s*\)/.test(after),

  atomicStateWrite:
    after.includes("AI_STOCK_LAB_ATOMIC_FORWARD_OOS_STATE_WRITE_V1") &&
    /writeFileSync\s*\(\s*tempFile/.test(after) &&
    /renameSync\s*\(\s*tempFile\s*,\s*STATE_FILE/.test(after),

  tempCleanup:
    /rmSync\s*\(\s*tempFile/.test(after),

  contractCreated:
    fs.existsSync(contractPath),
};

const failed =
  Object.entries(checks)
    .filter(([, value]) => value !== true)
    .map(([key]) => key);

if (failed.length > 0) {
  out({
    status:
      "AI_STOCK_LAB_FORWARD_OOS_RECOVERY_IDEMPOTENCY_HARDENING_V1_FAILED",
    message: "POST_PATCH_VERIFICATION_FAILED",
    target: targetRel,
    checks,
    failed,
    backup:
      path.relative(ROOT, backup).replace(/\\/g, "/"),
  }, true);
  process.exitCode = 1;
  return;
}

out({
  status:
    alreadyApplied
      ? "AI_STOCK_LAB_FORWARD_OOS_RECOVERY_IDEMPOTENCY_HARDENING_V1_ALREADY_APPLIED"
      : "AI_STOCK_LAB_FORWARD_OOS_RECOVERY_IDEMPOTENCY_HARDENING_V1_INSTALLED",

  target: targetRel,

  backup:
    path.relative(ROOT, backup).replace(/\\/g, "/"),

  generatedContract:
    contractRel,

  changes: {
    explicitRetryFlag:
      alreadyApplied ? "PRESENT" : interfaceChanged === 1,
    retryableFailureGuard:
      alreadyApplied ? "PRESENT" : retryGuardChanged === 1,
    atomicStateWrite:
      alreadyApplied ? "PRESENT" : atomicSaveChanged === 1,
  },

  behavior: {
    defaultAfterFailure:
      "FAIL_CLOSED",
    explicitRetryRequired:
      true,
    retryableOnly:
      "FORWARD_OOS_(PRODUCE|COLLECT|EVALUATE|SUMMARY)_FAILED_EXIT_n",
    completedSteps:
      "NOT_REEXECUTED",
    nonRetryableSafetyBlockers:
      "NOT_BYPASSED",
    stateWrite:
      "TEMP_FILE_THEN_RENAME",
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
    "RUN_RECOVERY_IDEMPOTENCY_CONTRACT_EXISTING_CONTRACT_AND_TSC",
}, false);
