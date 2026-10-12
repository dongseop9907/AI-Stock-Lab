const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const PACKAGE = path.join(ROOT, "package.json");

const RUNNER = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-automation-real-binding-full-regression-v1.cjs"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_REAL_BINDING_FULL_REGRESSION_V1_INSTALL_FAILED",
    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

if (!fs.existsSync(PACKAGE)) {
  fail("PACKAGE_JSON_NOT_FOUND");
} else {
  const runnerSource = `const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = process.cwd();
const pkg = JSON.parse(
  fs.readFileSync(
    path.join(ROOT, "package.json"),
    "utf8"
  )
);

const npmExecPath =
  process.env.npm_execpath;

const SAFE_ENV = {
  ...process.env,
  FORWARD_OOS_AUTOMATION_ENABLED: "false",
  REAL_TRADING_ENABLED: "false",
  ENABLE_REAL_TRADING: "false",
  ENABLE_LIVE_TRADING: "false",
};

function normalizeResult(
  label,
  command,
  result
) {
  return {
    label,
    command,
    exitCode:
      typeof result.status === "number"
        ? result.status
        : 1,
    spawnError:
      result.error
        ? String(
            result.error.message ||
            result.error
          )
        : null,
    stdout:
      result.stdout || "",
    stderr:
      result.stderr || "",
  };
}

function runNodeFile(
  label,
  file
) {
  const command = [
    process.execPath,
    file,
  ];

  const result = spawnSync(
    process.execPath,
    [file],
    {
      cwd: ROOT,
      env: SAFE_ENV,
      encoding: "utf8",
      shell: false,
    }
  );

  return normalizeResult(
    label,
    command,
    result
  );
}

function runTsxFile(
  label,
  file
) {
  const args = [
    "--env-file=.env.local",
    "--import",
    "tsx",
    file,
  ];

  const command = [
    process.execPath,
    ...args,
  ];

  const result = spawnSync(
    process.execPath,
    args,
    {
      cwd: ROOT,
      env: SAFE_ENV,
      encoding: "utf8",
      shell: false,
    }
  );

  return normalizeResult(
    label,
    command,
    result
  );
}

function runNpmScript(
  label,
  script
) {
  if (
    !pkg.scripts ||
    typeof pkg.scripts[script] !== "string"
  ) {
    return {
      label,
      command: ["npm", "run", script],
      exitCode: 1,
      spawnError: "PACKAGE_SCRIPT_MISSING",
      stdout: "",
      stderr: "",
    };
  }

  if (!npmExecPath) {
    return {
      label,
      command: ["npm", "run", script],
      exitCode: 1,
      spawnError: "NPM_EXEC_PATH_NOT_AVAILABLE",
      stdout: "",
      stderr: "",
    };
  }

  const args = [
    npmExecPath,
    "run",
    script,
  ];

  const command = [
    process.execPath,
    ...args,
  ];

  const result = spawnSync(
    process.execPath,
    args,
    {
      cwd: ROOT,
      env: SAFE_ENV,
      encoding: "utf8",
      shell: false,
    }
  );

  return normalizeResult(
    label,
    command,
    result
  );
}

const results = [];

results.push(
  runNpmScript(
    "AUTOMATION_PROBE_STATIC_V3",
    "test:true-forward-oos-automation-producer-probe-test-mode-v3-static"
  )
);

results.push(
  runNpmScript(
    "REAL_BINDING_DEFAULT_RUNSTEP_PROBE",
    "test:true-forward-oos-automation-default-runstep-producer-probe"
  )
);

results.push(
  runNpmScript(
    "PRODUCER_IMPORT_SMOKE",
    "test:true-forward-oos-producer-entrypoint-import-smoke"
  )
);

results.push(
  runNpmScript(
    "FORWARD_OOS_CONTRACT",
    "forward-oos:test"
  )
);

const pipelineStatic =
  path.join(
    ROOT,
    "scripts",
    "alpha-v3-true-forward-oos-pipeline-v1-static-verify.cjs"
  );

if (fs.existsSync(pipelineStatic)) {
  results.push(
    runNodeFile(
      "PIPELINE_STATIC",
      pipelineStatic
    )
  );
} else {
  results.push({
    label: "PIPELINE_STATIC",
    command: [pipelineStatic],
    exitCode: 1,
    spawnError: "PIPELINE_STATIC_FILE_MISSING",
    stdout: "",
    stderr: "",
  });
}

const bindingContract =
  path.join(
    ROOT,
    "scripts",
    "true-forward-oos-automation-binding-v1-contract-test.ts"
  );

if (fs.existsSync(bindingContract)) {
  results.push(
    runTsxFile(
      "AUTOMATION_BINDING_CONTRACT",
      bindingContract
    )
  );
} else {
  results.push({
    label: "AUTOMATION_BINDING_CONTRACT",
    command: [bindingContract],
    exitCode: 0,
    spawnError: null,
    stdout:
      "SKIPPED: true-forward-oos-automation-binding-v1-contract-test.ts not found",
    stderr: "",
  });
}

for (const result of results) {
  console.log("");
  console.log(
    "=== " +
    result.label +
    " ==="
  );

  if (result.stdout) {
    console.log(
      result.stdout.trimEnd()
    );
  }

  if (result.stderr) {
    console.error(
      result.stderr.trimEnd()
    );
  }

  console.log(
    "EXIT CODE =",
    result.exitCode
  );

  if (result.spawnError) {
    console.log(
      "SPAWN ERROR =",
      result.spawnError
    );
  }
}

const failed =
  results
    .filter(
      result =>
        result.exitCode !== 0 ||
        result.spawnError
    )
    .map(
      result =>
        result.label
    );

const report = {
  status:
    failed.length === 0
      ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_REAL_BINDING_FULL_REGRESSION_V1_VERIFIED"
      : "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_REAL_BINDING_FULL_REGRESSION_V1_FAILED",

  results:
    Object.fromEntries(
      results.map(
        result => [
          result.label,
          {
            exitCode:
              result.exitCode,

            spawnError:
              result.spawnError,
          },
        ]
      )
    ),

  safety: {
    realTradingEnabled: false,
    productionPromotionExecuted: false,
    liveOrderExpected: false,
    livePositionMutationExpected: false,
  },

  failed,

  nextGate:
    failed.length === 0
      ? "VERIFY_FORWARD_OOS_AUTOMATION_NORMAL_MODE_REMAINS_DEFAULT_OFF_THEN_KRX_FINAL_AUDIT_V1"
      : "REPAIR_ONLY_FAILED_REGRESSION",
};

console.log("");
console.log(
  JSON.stringify(
    report,
    null,
    2
  )
);

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
`;

  fs.writeFileSync(
    RUNNER,
    runnerSource,
    "utf8"
  );

  let pkg;

  try {
    pkg = JSON.parse(
      fs.readFileSync(
        PACKAGE,
        "utf8"
      )
    );
  } catch (error) {
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

  if (pkg) {
    pkg.scripts ||= {};

    pkg.scripts[
      "test:true-forward-oos-automation-real-binding-full-regression"
    ] =
      "node ./scripts/true-forward-oos-automation-real-binding-full-regression-v1.cjs";

    fs.writeFileSync(
      PACKAGE,
      JSON.stringify(
        pkg,
        null,
        2
      ) + "\n",
      "utf8"
    );

    console.log(JSON.stringify({
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_REAL_BINDING_FULL_REGRESSION_V1_INSTALLED",

      generatedFile:
        "scripts/true-forward-oos-automation-real-binding-full-regression-v1.cjs",

      packageScript:
        "npm run test:true-forward-oos-automation-real-binding-full-regression",

      checks: [
        "AUTOMATION_PROBE_STATIC_V3",
        "REAL_BINDING_DEFAULT_RUNSTEP_PROBE",
        "PRODUCER_IMPORT_SMOKE",
        "FORWARD_OOS_CONTRACT",
        "PIPELINE_STATIC",
        "AUTOMATION_BINDING_CONTRACT_IF_PRESENT"
      ],

      safety: {
        installerExecutedTests: false,
        realTradingEnabled: false,
        ordersCreated: 0,
        positionsChanged: 0
      },

      nextAction:
        "RUN_FULL_REGRESSION"
    }, null, 2));

    process.exitCode = 0;
  }
}
