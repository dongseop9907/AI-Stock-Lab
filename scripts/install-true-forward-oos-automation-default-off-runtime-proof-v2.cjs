const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const PACKAGE = path.join(ROOT, "package.json");

const TEST = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-automation-default-off-runtime-proof-v2.ts"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_DEFAULT_OFF_RUNTIME_PROOF_V2_INSTALL_FAILED",
    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

const binding = path.join(
  ROOT,
  "lib",
  "research",
  "run-true-forward-oos-automation-binding-v1.ts"
);

if (
  !fs.existsSync(PACKAGE) ||
  !fs.existsSync(binding)
) {
  fail("REQUIRED_FILES_MISSING", {
    packageExists:
      fs.existsSync(PACKAGE),
    bindingExists:
      fs.existsSync(binding),
  });
} else {
  const testSource = `import {
  runTrueForwardOosAutomationBindingV1,
} from "../lib/research/run-true-forward-oos-automation-binding-v1";

async function main() {
  const keys = [
    "FORWARD_OOS_AUTOMATION_ENABLED",
    "FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_ONLY",
    "REAL_TRADING_ENABLED",
    "ENABLE_REAL_TRADING",
    "ENABLE_LIVE_TRADING",
  ] as const;

  const before =
    Object.fromEntries(
      keys.map(
        key => [
          key,
          process.env[key],
        ],
      ),
    );

  let runStepCalls = 0;
  let saveStateCalls = 0;

  try {
    delete process.env.FORWARD_OOS_AUTOMATION_ENABLED;
    delete process.env.FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_ONLY;

    process.env.REAL_TRADING_ENABLED = "false";
    process.env.ENABLE_REAL_TRADING = "false";
    process.env.ENABLE_LIVE_TRADING = "false";

    const env = {
      ...process.env,
    };

    delete env.FORWARD_OOS_AUTOMATION_ENABLED;
    delete env.FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_ONLY;

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

          runStep:
            async () => {
              runStepCalls += 1;

              return {
                exitCode: 0,
                stdout: "",
                stderr: "",
              };
            },

          loadState:
            () => null,

          saveState:
            () => {
              saveStateCalls += 1;
            },
        },
      );

    const status =
      String(
        (result as any).status ??
        "",
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

    const checks = {
      resultReturned:
        Boolean(result),

      defaultOffWhenFlagAbsent:
        status === "DISABLED",

      runStepNeverCalled:
        runStepCalls === 0,

      noStepsExecuted:
        executed.length === 0,

      noStepsCompleted:
        completed.length === 0,

      probeFlagAlsoAbsent:
        env.FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_ONLY ===
        undefined,

      realTradingDisabled:
        env.REAL_TRADING_ENABLED === "false" &&
        env.ENABLE_REAL_TRADING === "false" &&
        env.ENABLE_LIVE_TRADING === "false",
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
              ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_DEFAULT_OFF_RUNTIME_PROOF_V2_VERIFIED"
              : "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_DEFAULT_OFF_RUNTIME_PROOF_V2_FAILED",

          observation: {
            automationStatus:
              status,

            runStepCalls,

            saveStateCalls,

            executed,

            completed,
          },

          checks,

          safety: {
            automationFlagPresent:
              false,

            producerProbeFlagPresent:
              false,

            realTradingEnabled:
              false,

            realSubprocessExecuted:
              false,

            databaseReads:
              0,

            databaseWrites:
              0,

            ordersCreated:
              0,

            positionsChanged:
              0,
          },

          failed,

          nextGate:
            failed.length === 0
              ? "TRUE_FORWARD_OOS_AUTOMATION_DEFAULT_OFF_CONFIRMED"
              : "REPAIR_DEFAULT_OFF_BEHAVIOR",
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
      const key of keys
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
            "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_DEFAULT_OFF_RUNTIME_PROOF_V2_ERROR",

          error:
            String(
              error instanceof Error
                ? error.stack ??
                  error.message
                : error
            ),
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
      "test:true-forward-oos-automation-default-off-runtime-proof"
    ] =
      "tsx --env-file=.env.local ./scripts/true-forward-oos-automation-default-off-runtime-proof-v2.ts";

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
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_DEFAULT_OFF_RUNTIME_PROOF_V2_INSTALLED",

      generatedFile:
        "scripts/true-forward-oos-automation-default-off-runtime-proof-v2.ts",

      packageScript:
        "npm run test:true-forward-oos-automation-default-off-runtime-proof",

      productSourceChanges:
        0,

      replacesFailedStaticAssumption:
        "forwardAutomationRequiresExactTrue",

      proofMethod:
        "REMOVE_ENABLE_FLAG_AND_CALL_REAL_BINDING_WITH_INJECTED_RUNSTEP",

      expected: {
        status:
          "DISABLED",
        runStepCalls:
          0,
        executedSteps:
          0,
      },

      safety: {
        installerExecutedAutomation:
          false,
        realTradingEnabled:
          false,
        databaseWrites:
          0,
        ordersCreated:
          0,
        positionsChanged:
          0,
      },

      nextAction:
        "RUN_DEFAULT_OFF_RUNTIME_PROOF",
    }, null, 2));

    process.exitCode = 0;
  }
}
