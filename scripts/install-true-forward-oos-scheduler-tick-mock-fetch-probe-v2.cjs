const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const SCRIPTS =
  path.join(
    ROOT,
    "scripts"
  );

const PACKAGE =
  path.join(
    ROOT,
    "package.json"
  );

const BACKUPS =
  path.join(
    SCRIPTS,
    "backups"
  );

const TARGET =
  path.join(
    SCRIPTS,
    "true-forward-oos-scheduler-tick-mock-fetch-probe-v2.cjs"
  );

function fail(
  reason,
  extra = {}
) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_SCHEDULER_TICK_MOCK_FETCH_PROBE_V2_INSTALL_FAILED",
        reason,
        ...extra,
      },
      null,
      2
    )
  );

  process.exitCode = 1;
}

const required = [
  "scripts/alpha-v3-automation-cycle-scheduler.ts",
  "scripts/alpha-v3-automation-cycle-scheduler-contract-test.ts",
  "package.json",
];

const missing =
  required.filter(
    (rel) =>
      !fs.existsSync(
        path.join(
          ROOT,
          rel
        )
      )
  );

if (
  missing.length > 0
) {
  fail(
    "REQUIRED_FILES_MISSING",
    {
      missing,
    }
  );
} else {
  fs.mkdirSync(
    BACKUPS,
    {
      recursive: true,
    }
  );

  const packageBackup =
    path.join(
      BACKUPS,
      "package.before-true-forward-oos-scheduler-tick-mock-fetch-probe-v2.json"
    );

  if (
    !fs.existsSync(
      packageBackup
    )
  ) {
    fs.copyFileSync(
      PACKAGE,
      packageBackup
    );
  }

  fs.writeFileSync(
    TARGET,
    "const fs = require(\"fs\");\nconst path = require(\"path\");\nconst { spawnSync } = require(\"child_process\");\n\nconst ROOT = process.cwd();\n\nconst schedulerRel =\n  \"scripts/alpha-v3-automation-cycle-scheduler.ts\";\n\nconst contractRel =\n  \"scripts/alpha-v3-automation-cycle-scheduler-contract-test.ts\";\n\nconst packageRel =\n  \"package.json\";\n\nconst schedulerPath =\n  path.join(ROOT, schedulerRel);\n\nconst contractPath =\n  path.join(ROOT, contractRel);\n\nconst packagePath =\n  path.join(ROOT, packageRel);\n\nconst checks = {\n  schedulerExists:\n    fs.existsSync(schedulerPath),\n\n  schedulerContractExists:\n    fs.existsSync(contractPath),\n\n  packageExists:\n    fs.existsSync(packagePath),\n};\n\nlet schedulerSource = \"\";\nlet contractSource = \"\";\nlet pkg = {};\n\nif (checks.schedulerExists) {\n  schedulerSource =\n    fs.readFileSync(\n      schedulerPath,\n      \"utf8\"\n    );\n}\n\nif (checks.schedulerContractExists) {\n  contractSource =\n    fs.readFileSync(\n      contractPath,\n      \"utf8\"\n    );\n}\n\nif (checks.packageExists) {\n  try {\n    pkg =\n      JSON.parse(\n        fs.readFileSync(\n          packagePath,\n          \"utf8\"\n        )\n      );\n  } catch {\n    pkg = {};\n  }\n}\n\nchecks.schedulerBindingPresent =\n  schedulerSource.includes(\n    \"ALPHA_V3_TRUE_FORWARD_OOS_AUTOMATION_BINDING_V1_CALL\"\n  );\n\nchecks.schedulerImportsForwardOosBinding =\n  schedulerSource.includes(\n    \"runTrueForwardOosAutomationBindingV1\"\n  );\n\nchecks.contractHasMockFetchSurface =\n  /fetch|mock/i.test(\n    contractSource\n  );\n\nchecks.schedulerTestScriptExists =\n  Boolean(\n    pkg &&\n    pkg.scripts &&\n    pkg.scripts[\n      \"automation:scheduler:test\"\n    ]\n  );\n\nconst npmExecPath =\n  process.env.npm_execpath || \"\";\n\nchecks.npmExecPathAvailable =\n  Boolean(\n    npmExecPath &&\n    fs.existsSync(\n      npmExecPath\n    )\n  );\n\nconst preflightFailed =\n  Object.entries(checks)\n    .filter(([, value]) => value !== true)\n    .map(([key]) => key);\n\nlet schedulerTest = {\n  executed: false,\n  exitCode: null,\n  spawnError: null,\n  stdoutTail: [],\n  stderrTail: [],\n};\n\nif (preflightFailed.length === 0) {\n  const result =\n    spawnSync(\n      process.execPath,\n      [\n        npmExecPath,\n        \"run\",\n        \"automation:scheduler:test\",\n      ],\n      {\n        cwd: ROOT,\n        encoding: \"utf8\",\n        shell: false,\n        maxBuffer:\n          16 * 1024 * 1024,\n        env: {\n          ...process.env,\n\n          FORWARD_OOS_AUTOMATION_ENABLED:\n            \"false\",\n\n          REAL_TRADING_ENABLED:\n            \"false\",\n\n          ENABLE_REAL_TRADING:\n            \"false\",\n\n          ENABLE_LIVE_TRADING:\n            \"false\",\n        },\n      }\n    );\n\n  schedulerTest = {\n    executed: true,\n\n    exitCode:\n      typeof result.status ===\n      \"number\"\n        ? result.status\n        : 1,\n\n    spawnError:\n      result.error\n        ? String(\n            result.error.message ||\n            result.error\n          )\n        : null,\n\n    stdoutTail:\n      String(\n        result.stdout || \"\"\n      )\n        .trim()\n        .split(/\\r?\\n/)\n        .filter(Boolean)\n        .slice(-30),\n\n    stderrTail:\n      String(\n        result.stderr || \"\"\n      )\n        .trim()\n        .split(/\\r?\\n/)\n        .filter(Boolean)\n        .slice(-30),\n  };\n}\n\nconst finalChecks = {\n  ...checks,\n\n  schedulerContractPassed:\n    schedulerTest.executed === true &&\n    schedulerTest.spawnError === null &&\n    schedulerTest.exitCode === 0,\n};\n\nconst failed =\n  Object.entries(finalChecks)\n    .filter(([, value]) => value !== true)\n    .map(([key]) => key);\n\nconst report = {\n  status:\n    failed.length === 0\n      ? \"AI_STOCK_LAB_TRUE_FORWARD_OOS_SCHEDULER_TICK_MOCK_FETCH_PROBE_V2_VERIFIED\"\n      : \"AI_STOCK_LAB_TRUE_FORWARD_OOS_SCHEDULER_TICK_MOCK_FETCH_PROBE_V2_FAILED\",\n\n  checks:\n    finalChecks,\n\n  npmRuntime: {\n    nodeExecPath:\n      process.execPath,\n    npmExecPath,\n  },\n\n  schedulerTest,\n\n  safety: {\n    forwardOosAutomationEnabled:\n      false,\n\n    realTradingForcedOff:\n      true,\n\n    schedulerContractTestSubprocessExecuted:\n      schedulerTest.executed,\n\n    forwardOosRuntimeSubprocessExecuted:\n      false,\n\n    productionSchedulerLoopStarted:\n      false,\n\n    realApiCallsExpected:\n      false,\n\n    databaseWritesExpected:\n      false,\n\n    ordersCreatedExpected:\n      false,\n\n    positionsChangedExpected:\n      false,\n\n    promotionApplied:\n      false,\n  },\n\n  failed,\n\n  nextGate:\n    failed.length === 0\n      ? \"VERIFY_FORWARD_OOS_KRX_CALENDAR_AND_HOLIDAY_GUARDS_V1\"\n      : \"INSPECT_REAL_SCHEDULER_CONTRACT_FAILURE_FROM_CAPTURED_OUTPUT\",\n};\n\nfs.mkdirSync(\n  path.join(\n    ROOT,\n    \"logs\"\n  ),\n  {\n    recursive: true\n  }\n);\n\nfs.writeFileSync(\n  path.join(\n    ROOT,\n    \"logs\",\n    \"true-forward-oos-scheduler-tick-mock-fetch-probe-v2.json\"\n  ),\n  JSON.stringify(\n    report,\n    null,\n    2\n  ),\n  \"utf8\"\n);\n\n/* compact console only */\nconsole.log(JSON.stringify({\n  status:\n    report.status,\n\n  checks: {\n    schedulerExists:\n      report.checks.schedulerExists,\n    schedulerContractExists:\n      report.checks.schedulerContractExists,\n    schedulerBindingPresent:\n      report.checks.schedulerBindingPresent,\n    schedulerTestScriptExists:\n      report.checks.schedulerTestScriptExists,\n    npmExecPathAvailable:\n      report.checks.npmExecPathAvailable,\n    schedulerContractPassed:\n      report.checks.schedulerContractPassed,\n  },\n\n  schedulerTest: {\n    exitCode:\n      report.schedulerTest.exitCode,\n    spawnError:\n      report.schedulerTest.spawnError,\n    stdoutTail:\n      report.schedulerTest.stdoutTail.slice(-10),\n    stderrTail:\n      report.schedulerTest.stderrTail.slice(-10),\n  },\n\n  failed:\n    report.failed,\n\n  nextGate:\n    report.nextGate,\n}, null, 2));\n\nprocess.exitCode =\n  failed.length === 0\n    ? 0\n    : 1;\n",
    "utf8"
  );

  let pkg;

  try {
    pkg =
      JSON.parse(
        fs.readFileSync(
          PACKAGE,
          "utf8"
        )
      );
  } catch (
    error
  ) {
    fail(
      "PACKAGE_JSON_PARSE_FAILED",
      {
        error:
          String(
            error instanceof Error
              ? error.message
              : error
          ),
      }
    );
  }

  if (
    pkg
  ) {
    if (
      !pkg.scripts ||
      typeof pkg.scripts !==
        "object"
    ) {
      pkg.scripts = {};
    }

    pkg.scripts[
      "test:true-forward-oos-scheduler-tick-mock-fetch-v2"
    ] =
      "node ./scripts/true-forward-oos-scheduler-tick-mock-fetch-probe-v2.cjs";

    fs.writeFileSync(
      PACKAGE,
      JSON.stringify(
        pkg,
        null,
        2
      ) + "\n",
      "utf8"
    );

    console.log(
      JSON.stringify(
        {
          status:
            "AI_STOCK_LAB_TRUE_FORWARD_OOS_SCHEDULER_TICK_MOCK_FETCH_PROBE_V2_INSTALLED",

          generatedFile:
            "scripts/true-forward-oos-scheduler-tick-mock-fetch-probe-v2.cjs",

          packageScript:
            "npm run test:true-forward-oos-scheduler-tick-mock-fetch-v2",

          executionStrategy:
            "NODE_PLUS_NPM_EXECPATH_NO_SHELL",

          safety: {
            productSourceChanges:
              0,

            forwardOosAutomationEnabled:
              false,

            realTradingForcedOff:
              true,

            productionSchedulerLoopStarted:
              false,

            forwardOosRuntimeSubprocessExecuted:
              false,
          },

          nextAction:
            "RUN_V2_AND_CAPTURE_REAL_SCHEDULER_CONTRACT_RESULT",
        },
        null,
        2
      )
    );
  }
}
