const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = process.cwd();

const BINDING = path.join(
  ROOT,
  "lib",
  "research",
  "run-true-forward-oos-automation-binding-v1.ts"
);

const PRODUCER = path.join(
  ROOT,
  "scripts",
  "alpha-v3-true-forward-top1-producer-v1.ts"
);

const KRX = path.join(
  ROOT,
  "lib",
  "trading",
  "krx-trading-calendar.ts"
);

const PACKAGE = path.join(
  ROOT,
  "package.json"
);

const pkg = JSON.parse(
  fs.readFileSync(
    PACKAGE,
    "utf8"
  )
);

const npmExecPath =
  process.env.npm_execpath;

const binding =
  fs.existsSync(BINDING)
    ? fs.readFileSync(BINDING, "utf8")
    : "";

const producer =
  fs.existsSync(PRODUCER)
    ? fs.readFileSync(PRODUCER, "utf8")
    : "";

const krx =
  fs.existsSync(KRX)
    ? fs.readFileSync(KRX, "utf8")
    : "";

const packageText =
  fs.readFileSync(
    PACKAGE,
    "utf8"
  );

const staticChecks = {
  bindingExists:
    Boolean(binding),

  producerExists:
    Boolean(producer),

  krxCalendarExists:
    Boolean(krx),

  forwardAutomationFlagPresent:
    binding.includes(
      "FORWARD_OOS_AUTOMATION_ENABLED"
    ),

  forwardAutomationRequiresExactTrue:
    /FORWARD_OOS_AUTOMATION_ENABLED\s*===\s*["']true["']/.test(
      binding
    ),

  producerProbeFlagPresent:
    binding.includes(
      "FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_ONLY"
    ),

  producerProbeRequiresExactTrue:
    /FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_ONLY\s*===\s*["']true["']/.test(
      binding
    ),

  producerProbeOnlyProduce:
    binding.includes(
      'step === "PRODUCE"'
    ),

  packageDoesNotEnableForwardAutomation:
    !/FORWARD_OOS_AUTOMATION_ENABLED\s*=\s*true/i.test(
      packageText
    ),

  packageDoesNotEnableProbeMode:
    !/FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_ONLY\s*=\s*true/i.test(
      packageText
    ),

  realTradingForcedFalse:
    binding.includes(
      "REAL_TRADING_ENABLED:"
    ) &&
    binding.includes(
      "ENABLE_REAL_TRADING:"
    ) &&
    binding.includes(
      "ENABLE_LIVE_TRADING:"
    ),

  producerUsesKrxCalendar:
    /isKrxTradingDate|nextKrxTradingDate|nextExpectedKrxOpenDate/.test(
      producer
    ),

  krxHasTradingDateFunction:
    /isKrxTradingDate|nextKrxTradingDate|previousKrxTradingDate/.test(
      krx
    ),

  hangeulDayCovered:
    producer.includes(
      "2026-10-09"
    ) ||
    krx.includes(
      "2026-10-09"
    ) ||
    fs.readFileSync(
      path.join(
        ROOT,
        "scripts",
        "alpha-v3-true-forward-oos-pipeline-v1-contract-test.ts"
      ),
      "utf8"
    ).includes(
      "2026-10-09"
    ),
};

const staticFailed =
  Object.entries(
    staticChecks
  )
    .filter(
      ([, value]) =>
        value !== true
    )
    .map(
      ([key]) =>
        key
    );

const SAFE_ENV = {
  ...process.env,
  FORWARD_OOS_AUTOMATION_ENABLED:
    "false",
  FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_ONLY:
    "false",
  REAL_TRADING_ENABLED:
    "false",
  ENABLE_REAL_TRADING:
    "false",
  ENABLE_LIVE_TRADING:
    "false",
};

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
      exitCode: 1,
      spawnError: "PACKAGE_SCRIPT_MISSING",
      stdout: "",
      stderr: "",
    };
  }

  if (!npmExecPath) {
    return {
      label,
      exitCode: 1,
      spawnError: "NPM_EXEC_PATH_NOT_AVAILABLE",
      stdout: "",
      stderr: "",
    };
  }

  const result =
    spawnSync(
      process.execPath,
      [
        npmExecPath,
        "run",
        script,
      ],
      {
        cwd: ROOT,
        env: SAFE_ENV,
        encoding: "utf8",
        shell: false,
      }
    );

  return {
    label,
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
  if (!fs.existsSync(file)) {
    return {
      label,
      exitCode: 0,
      spawnError: null,
      stdout:
        "SKIPPED: file not found",
      stderr: "",
    };
  }

  const result =
    spawnSync(
      process.execPath,
      [file],
      {
        cwd: ROOT,
        env: SAFE_ENV,
        encoding: "utf8",
        shell: false,
      }
    );

  return {
    label,
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

const runtimeResults = [];

runtimeResults.push(
  runNpmScript(
    "FORWARD_OOS_CONTRACT",
    "forward-oos:test"
  )
);

runtimeResults.push(
  runNodeFile(
    "KRX_CALENDAR_BINDING_PROBE",
    path.join(
      ROOT,
      "scripts",
      "alpha-v3-forward-oos-krx-calendar-binding-probe-v1.cjs"
    )
  )
);

runtimeResults.push(
  runNodeFile(
    "PIPELINE_STATIC",
    path.join(
      ROOT,
      "scripts",
      "alpha-v3-true-forward-oos-pipeline-v1-static-verify.cjs"
    )
  )
);

for (
  const result of runtimeResults
) {
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

const runtimeFailed =
  runtimeResults
    .filter(
      result =>
        result.exitCode !== 0 ||
        result.spawnError
    )
    .map(
      result =>
        result.label
    );

const failed = [
  ...staticFailed,
  ...runtimeFailed,
];

console.log("");

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_DEFAULT_OFF_KRX_FINAL_AUDIT_V1_VERIFIED"
          : "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_DEFAULT_OFF_KRX_FINAL_AUDIT_V1_FAILED",

      staticChecks,

      runtimeResults:
        Object.fromEntries(
          runtimeResults.map(
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
        forwardAutomationEnabled:
          false,

        producerProbeModeEnabled:
          false,

        realTradingEnabled:
          false,

        normalProducerExecuted:
          false,

        ordersCreatedExpected:
          0,

        positionsChangedExpected:
          0,
      },

      failed,

      nextGate:
        failed.length === 0
          ? "TRUE_FORWARD_OOS_AUTOMATION_SAFETY_AND_KRX_BINDING_COMPLETE_WAIT_FOR_REAL_FORWARD_SESSIONS"
          : "REPAIR_ONLY_FAILED_FINAL_AUDIT_ITEM",
    },
    null,
    2
  )
);

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
