const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = process.cwd();

const schedulerRel =
  "scripts/alpha-v3-automation-cycle-scheduler.ts";

const contractRel =
  "scripts/alpha-v3-automation-cycle-scheduler-contract-test.ts";

const packageRel =
  "package.json";

const schedulerPath =
  path.join(ROOT, schedulerRel);

const contractPath =
  path.join(ROOT, contractRel);

const packagePath =
  path.join(ROOT, packageRel);

const checks = {
  schedulerExists:
    fs.existsSync(schedulerPath),

  schedulerContractExists:
    fs.existsSync(contractPath),

  packageExists:
    fs.existsSync(packagePath),
};

let schedulerSource = "";
let contractSource = "";
let pkg = {};

if (checks.schedulerExists) {
  schedulerSource =
    fs.readFileSync(
      schedulerPath,
      "utf8"
    );
}

if (checks.schedulerContractExists) {
  contractSource =
    fs.readFileSync(
      contractPath,
      "utf8"
    );
}

if (checks.packageExists) {
  try {
    pkg =
      JSON.parse(
        fs.readFileSync(
          packagePath,
          "utf8"
        )
      );
  } catch {
    pkg = {};
  }
}

checks.schedulerBindingPresent =
  schedulerSource.includes(
    "ALPHA_V3_TRUE_FORWARD_OOS_AUTOMATION_BINDING_V1_CALL"
  );

checks.schedulerImportsForwardOosBinding =
  schedulerSource.includes(
    "runTrueForwardOosAutomationBindingV1"
  );

checks.contractHasMockFetchSurface =
  /fetch|mock/i.test(
    contractSource
  );

checks.schedulerTestScriptExists =
  Boolean(
    pkg &&
    pkg.scripts &&
    pkg.scripts[
      "automation:scheduler:test"
    ]
  );

const npmExecPath =
  process.env.npm_execpath || "";

checks.npmExecPathAvailable =
  Boolean(
    npmExecPath &&
    fs.existsSync(
      npmExecPath
    )
  );

const preflightFailed =
  Object.entries(checks)
    .filter(([, value]) => value !== true)
    .map(([key]) => key);

let schedulerTest = {
  executed: false,
  exitCode: null,
  spawnError: null,
  stdoutTail: [],
  stderrTail: [],
};

if (preflightFailed.length === 0) {
  const result =
    spawnSync(
      process.execPath,
      [
        npmExecPath,
        "run",
        "automation:scheduler:test",
      ],
      {
        cwd: ROOT,
        encoding: "utf8",
        shell: false,
        maxBuffer:
          16 * 1024 * 1024,
        env: {
          ...process.env,

          FORWARD_OOS_AUTOMATION_ENABLED:
            "false",

          REAL_TRADING_ENABLED:
            "false",

          ENABLE_REAL_TRADING:
            "false",

          ENABLE_LIVE_TRADING:
            "false",
        },
      }
    );

  schedulerTest = {
    executed: true,

    exitCode:
      typeof result.status ===
      "number"
        ? result.status
        : 1,

    spawnError:
      result.error
        ? String(
            result.error.message ||
            result.error
          )
        : null,

    stdoutTail:
      String(
        result.stdout || ""
      )
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-30),

    stderrTail:
      String(
        result.stderr || ""
      )
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-30),
  };
}

const finalChecks = {
  ...checks,

  schedulerContractPassed:
    schedulerTest.executed === true &&
    schedulerTest.spawnError === null &&
    schedulerTest.exitCode === 0,
};

const failed =
  Object.entries(finalChecks)
    .filter(([, value]) => value !== true)
    .map(([key]) => key);

const report = {
  status:
    failed.length === 0
      ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_SCHEDULER_TICK_MOCK_FETCH_PROBE_V2_VERIFIED"
      : "AI_STOCK_LAB_TRUE_FORWARD_OOS_SCHEDULER_TICK_MOCK_FETCH_PROBE_V2_FAILED",

  checks:
    finalChecks,

  npmRuntime: {
    nodeExecPath:
      process.execPath,
    npmExecPath,
  },

  schedulerTest,

  safety: {
    forwardOosAutomationEnabled:
      false,

    realTradingForcedOff:
      true,

    schedulerContractTestSubprocessExecuted:
      schedulerTest.executed,

    forwardOosRuntimeSubprocessExecuted:
      false,

    productionSchedulerLoopStarted:
      false,

    realApiCallsExpected:
      false,

    databaseWritesExpected:
      false,

    ordersCreatedExpected:
      false,

    positionsChangedExpected:
      false,

    promotionApplied:
      false,
  },

  failed,

  nextGate:
    failed.length === 0
      ? "VERIFY_FORWARD_OOS_KRX_CALENDAR_AND_HOLIDAY_GUARDS_V1"
      : "INSPECT_REAL_SCHEDULER_CONTRACT_FAILURE_FROM_CAPTURED_OUTPUT",
};

fs.mkdirSync(
  path.join(
    ROOT,
    "logs"
  ),
  {
    recursive: true
  }
);

fs.writeFileSync(
  path.join(
    ROOT,
    "logs",
    "true-forward-oos-scheduler-tick-mock-fetch-probe-v2.json"
  ),
  JSON.stringify(
    report,
    null,
    2
  ),
  "utf8"
);

/* compact console only */
console.log(JSON.stringify({
  status:
    report.status,

  checks: {
    schedulerExists:
      report.checks.schedulerExists,
    schedulerContractExists:
      report.checks.schedulerContractExists,
    schedulerBindingPresent:
      report.checks.schedulerBindingPresent,
    schedulerTestScriptExists:
      report.checks.schedulerTestScriptExists,
    npmExecPathAvailable:
      report.checks.npmExecPathAvailable,
    schedulerContractPassed:
      report.checks.schedulerContractPassed,
  },

  schedulerTest: {
    exitCode:
      report.schedulerTest.exitCode,
    spawnError:
      report.schedulerTest.spawnError,
    stdoutTail:
      report.schedulerTest.stdoutTail.slice(-10),
    stderrTail:
      report.schedulerTest.stderrTail.slice(-10),
  },

  failed:
    report.failed,

  nextGate:
    report.nextGate,
}, null, 2));

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
