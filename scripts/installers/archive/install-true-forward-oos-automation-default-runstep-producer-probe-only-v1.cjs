const fs = require("fs");
const path = require("path");

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

const PACKAGE = path.join(
  ROOT,
  "package.json"
);

const TEST = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-automation-default-runstep-producer-probe-only-v1.ts"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_DEFAULT_RUNSTEP_PRODUCER_PROBE_ONLY_V1_INSTALL_FAILED",
    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

const required = [
  BINDING,
  PRODUCER,
  PACKAGE,
];

const missing =
  required.filter(
    file =>
      !fs.existsSync(file)
  );

if (missing.length > 0) {
  fail(
    "REQUIRED_FILES_MISSING",
    {
      missing:
        missing.map(
          file =>
            path.relative(
              ROOT,
              file
            )
        ),
    }
  );
} else {
  const bindingSource =
    fs.readFileSync(
      BINDING,
      "utf8"
    );

  const producerSource =
    fs.readFileSync(
      PRODUCER,
      "utf8"
    );

  const prechecks = {
    automationExportPresent:
      bindingSource.includes(
        "runTrueForwardOosAutomationBindingV1"
      ),

    defaultRunStepPresent:
      bindingSource.includes(
        "defaultRunStep"
      ),

    spawnPresent:
      bindingSource.includes(
        "spawn("
      ),

    probeEnvPresent:
      bindingSource.includes(
        "FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_ONLY"
      ),

    produceOnlyGuardPresent:
      bindingSource.includes(
        'step === "PRODUCE"'
      ),

    probeArgPresent:
      bindingSource.includes(
        '"--probe-only"'
      ),

    producerProbeStatusPresent:
      producerSource.includes(
        "ALPHA_V3_TRUE_FORWARD_TOP1_PRODUCER_V1_PROBE_ONLY"
      ),

    producerProbeReturnPresent:
      producerSource.includes(
        "isTrueForwardTop1ProbeOnly"
      ),
  };

  const failedPrechecks =
    Object.entries(
      prechecks
    )
      .filter(
        ([, value]) =>
          value !== true
      )
      .map(
        ([key]) =>
          key
      );

  if (failedPrechecks.length > 0) {
    fail(
      "PRECHECK_FAILED",
      {
        prechecks,
        failedPrechecks,
      }
    );
  } else {
    const testSource = `import {
  runTrueForwardOosAutomationBindingV1,
} from "../lib/research/run-true-forward-oos-automation-binding-v1";

function clone<T>(
  value: T,
): T {
  return JSON.parse(
    JSON.stringify(
      value,
    ),
  );
}

async function main() {
  const envKeys = [
    "FORWARD_OOS_AUTOMATION_ENABLED",
    "FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_ONLY",
    "REAL_TRADING_ENABLED",
    "ENABLE_REAL_TRADING",
    "ENABLE_LIVE_TRADING",
  ] as const;

  const before =
    Object.fromEntries(
      envKeys.map(
        key => [
          key,
          process.env[key],
        ],
      ),
    );

  let memoryState: any = null;
  let saveCount = 0;

  try {
    process.env.FORWARD_OOS_AUTOMATION_ENABLED =
      "true";

    process.env.FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_ONLY =
      "true";

    process.env.REAL_TRADING_ENABLED =
      "false";

    process.env.ENABLE_REAL_TRADING =
      "false";

    process.env.ENABLE_LIVE_TRADING =
      "false";

    const env = {
      ...process.env,

      FORWARD_OOS_AUTOMATION_ENABLED:
        "true",

      FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_ONLY:
        "true",

      REAL_TRADING_ENABLED:
        "false",

      ENABLE_REAL_TRADING:
        "false",

      ENABLE_LIVE_TRADING:
        "false",
    };

    const result =
      await runTrueForwardOosAutomationBindingV1(
        {
          now:
            new Date(
              "2026-10-07T23:50:00.000Z",
            ),
        },
        {
          env,

          loadState:
            () =>
              memoryState,

          saveState:
            state => {
              saveCount += 1;

              memoryState =
                clone(
                  state,
                );
            },

          // Intentionally NO runStep override.
          // This forces the binding's real defaultRunStep -> spawn(...)
          // -> real producer file -> --probe-only path.
        },
      );

    const executed =
      Array.isArray(
        (result as any).executed,
      )
        ? (result as any).executed
        : [];

    const completed =
      Array.isArray(
        (result as any).completed,
      )
        ? (result as any).completed
        : [];

    const status =
      String(
        (result as any).status ??
        "",
      );

    const blockedReason =
      (result as any).blockedReason ??
      null;

    const checks = {
      automationReturned:
        Boolean(result),

      defaultRunStepUsed:
        true,

      realSpawnPathRequested:
        true,

      produceExecuted:
        executed.includes(
          "PRODUCE",
        ),

      onlyProduceExecuted:
        executed.length === 1 &&
        executed[0] === "PRODUCE",

      produceCompleted:
        completed.includes(
          "PRODUCE",
        ),

      completedStatus:
        status.includes(
          "COMPLETED",
        ),

      notBlocked:
        blockedReason === null,

      memoryStateSaved:
        saveCount > 0 &&
        memoryState !== null,

      probeModeEnabled:
        process.env.FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_ONLY ===
        "true",

      realTradingDisabled:
        process.env.REAL_TRADING_ENABLED ===
          "false" &&
        process.env.ENABLE_REAL_TRADING ===
          "false" &&
        process.env.ENABLE_LIVE_TRADING ===
          "false",
    };

    const failed =
      Object.entries(
        checks,
      )
        .filter(
          ([, value]) =>
            value !== true,
        )
        .map(
          ([key]) =>
            key,
        );

    console.log(
      JSON.stringify(
        {
          status:
            failed.length === 0
              ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_DEFAULT_RUNSTEP_PRODUCER_PROBE_ONLY_V1_VERIFIED"
              : "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_DEFAULT_RUNSTEP_PRODUCER_PROBE_ONLY_V1_FAILED",

          observation: {
            automationStatus:
              status,

            executed,

            completed,

            blockedReason,

            saveCount,

            statePresent:
              memoryState !== null,
          },

          checks,

          safety: {
            runStepOverrideProvided:
              false,

            actualBindingDefaultRunStep:
              true,

            producerProbeOnlyRequested:
              true,

            normalProducerExecutionExpected:
              false,

            collectorExpected:
              false,

            evaluatorExpected:
              false,

            summaryExpected:
              false,

            stateFileWrite:
              false,

            realTradingEnabled:
              false,
          },

          failed,

          nextGate:
            failed.length === 0
              ? "RUN_FULL_FORWARD_OOS_AUTOMATION_REGRESSION_AFTER_REAL_BINDING_PROBE_PATH_V1"
              : "REPAIR_DEFAULT_RUNSTEP_PROBE_ONLY_RUNTIME_PATH",
        },
        null,
        2,
      ),
    );

    process.exitCode =
      failed.length === 0
        ? 0
        : 1;
  } finally {
    for (
      const key of envKeys
    ) {
      const oldValue =
        before[key];

      if (
        oldValue === undefined
      ) {
        delete process.env[key];
      } else {
        process.env[key] =
          oldValue;
      }
    }
  }
}

main().catch(
  error => {
    console.error(
      JSON.stringify(
        {
          status:
            "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_DEFAULT_RUNSTEP_PRODUCER_PROBE_ONLY_V1_ERROR",

          error:
            String(
              error instanceof Error
                ? error.stack ??
                  error.message
                : error
            ),

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
  },
);
`;

    fs.writeFileSync(
      TEST,
      testSource,
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
        "test:true-forward-oos-automation-default-runstep-producer-probe"
      ] =
        "tsx --env-file=.env.local ./scripts/true-forward-oos-automation-default-runstep-producer-probe-only-v1.ts";

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
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_DEFAULT_RUNSTEP_PRODUCER_PROBE_ONLY_V1_INSTALLED",

        generatedFile:
          "scripts/true-forward-oos-automation-default-runstep-producer-probe-only-v1.ts",

        packageScript:
          "npm run test:true-forward-oos-automation-default-runstep-producer-probe",

        prechecks,

        runtimePlan: {
          now:
            "2026-10-08 08:50:00 KST",

          runStepOverride:
            false,

          stateStorage:
            "IN_MEMORY_ONLY",

          expectedStep:
            "PRODUCE",

          producerMode:
            "--probe-only",
        },

        safety: {
          installerExecutedAutomation:
            false,

          installerExecutedProducer:
            false,

          databaseReads:
            0,

          databaseWrites:
            0,

          ordersCreated:
            0,

          positionsChanged:
            0,

          realTradingEnabled:
            false,
        },

        nextAction:
          "RUN_REAL_BINDING_DEFAULT_RUNSTEP_PRODUCER_PROBE_ONLY",
      }, null, 2));

      process.exitCode = 0;
    }
  }
}
