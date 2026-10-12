const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const TARGET = path.join(
  ROOT,
  "lib",
  "research",
  "run-true-forward-oos-automation-binding-v1.ts"
);

const PACKAGE = path.join(
  ROOT,
  "package.json"
);

const BACKUP = path.join(
  ROOT,
  "scripts",
  "backups",
  "run-true-forward-oos-automation-binding-v1.before-producer-probe-test-mode-v1.ts"
);

const STATIC_VERIFY = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-automation-producer-probe-test-mode-v1-static-verify.cjs"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_TEST_MODE_V1_INSTALL_FAILED",
    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

if (
  !fs.existsSync(TARGET) ||
  !fs.existsSync(PACKAGE)
) {
  fail("REQUIRED_FILES_MISSING", {
    bindingExists:
      fs.existsSync(TARGET),
    packageExists:
      fs.existsSync(PACKAGE),
  });
} else {
  let source =
    fs.readFileSync(
      TARGET,
      "utf8"
    );

  fs.mkdirSync(
    path.dirname(BACKUP),
    { recursive: true }
  );

  if (!fs.existsSync(BACKUP)) {
    fs.copyFileSync(
      TARGET,
      BACKUP
    );
  }

  const marker =
    "FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_ONLY";

  let changed = false;

  if (!source.includes(marker)) {
    const spawnRegex =
      /spawnSync\s*\(\s*process\.execPath\s*,\s*\[([\s\S]*?)\]\s*,\s*\{/m;

    const match =
      spawnRegex.exec(source);

    if (!match) {
      fail(
        "DEFAULT_RUNSTEP_SPAWN_ARGUMENT_ARRAY_NOT_FOUND"
      );
    } else {
      const fullMatch =
        match[0];

      const argsBody =
        match[1];

      const spawnIndex =
        match.index;

      const contextStart =
        Math.max(
          0,
          source.lastIndexOf(
            "\n",
            Math.max(
              0,
              spawnIndex - 2500
            )
          )
        );

      const localContext =
        source.slice(
          contextStart,
          spawnIndex +
            fullMatch.length
        );

      const requiredArgs = [
        "--env-file=.env.local",
        "--import",
        "tsx",
      ];

      const missingArgs =
        requiredArgs.filter(
          item =>
            !argsBody.includes(item)
        );

      if (missingArgs.length > 0) {
        fail(
          "EXPECTED_SUBPROCESS_ARGUMENTS_MISSING",
          { missingArgs }
        );
      } else if (
        !/\bstep\b/.test(localContext)
      ) {
        fail(
          "STEP_VARIABLE_NOT_CONFIRMED_IN_DEFAULT_RUNSTEP_SCOPE"
        );
      } else {
        const injection = `

        /*
         * AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_TEST_MODE_V1
         * Default OFF. Only PRODUCE receives --probe-only when explicitly enabled.
         */
        ...(
          step === "PRODUCE" &&
          process.env.FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_ONLY === "true"
            ? ["--probe-only"]
            : []
        ),`;

        const replacement =
          fullMatch.replace(
            /\]\s*,\s*\{$/,
            injection +
              "\n      ],\n      {"
          );

        if (replacement === fullMatch) {
          fail(
            "SPAWN_ARGUMENT_INSERTION_FAILED"
          );
        } else {
          source =
            source.slice(
              0,
              match.index
            ) +
            replacement +
            source.slice(
              match.index +
                fullMatch.length
            );

          changed = true;
        }
      }
    }
  }

  if (process.exitCode !== 1) {
    fs.writeFileSync(
      TARGET,
      source,
      "utf8"
    );

    const verifier = `const fs = require("fs");
const path = require("path");

const root = process.cwd();
const target = path.join(
  root,
  "lib",
  "research",
  "run-true-forward-oos-automation-binding-v1.ts"
);

if (!fs.existsSync(target)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_TEST_MODE_V1_STATIC_FAILED",
    failed: ["bindingExists"],
  }, null, 2));

  process.exitCode = 1;
} else {
  const source =
    fs.readFileSync(
      target,
      "utf8"
    );

  const marker =
    source.indexOf(
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_TEST_MODE_V1"
    );

  const spawn =
    source.indexOf(
      "spawnSync(",
      Math.max(
        0,
        marker - 2500
      )
    );

  const probeFlag =
    source.indexOf(
      "--probe-only",
      Math.max(
        0,
        spawn
      )
    );

  const envFlag =
    source.indexOf(
      "FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_ONLY",
      Math.max(
        0,
        spawn
      )
    );

  const produceOnly =
    source.indexOf(
      'step === "PRODUCE"',
      Math.max(
        0,
        spawn
      )
    );

  const checks = {
    bindingExists:
      true,

    markerPresent:
      marker >= 0,

    spawnSyncPresent:
      spawn >= 0,

    processExecPathPresent:
      source.includes(
        "process.execPath"
      ),

    envFilePresent:
      source.includes(
        "--env-file=.env.local"
      ),

    tsxLoaderPresent:
      source.includes(
        "--import"
      ) &&
      source.includes(
        '"tsx"'
      ),

    explicitProbeEnvPresent:
      envFlag >= 0,

    probeFlagPresent:
      probeFlag >= 0,

    produceOnlyGuardPresent:
      produceOnly >= 0,

    probeBindingAfterSpawnSurface:
      probeFlag > spawn &&
      envFlag > spawn &&
      produceOnly > spawn,

    defaultOffUnlessExactTrue:
      /FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_ONLY\\s*===\\s*"true"/.test(
        source
      ),

    collectorNotExplicitlyProbed:
      !/step\\s*===\\s*"COLLECT"[\\s\\S]{0,250}--probe-only/.test(
        source
      ),

    evaluatorNotExplicitlyProbed:
      !/step\\s*===\\s*"EVALUATE"[\\s\\S]{0,250}--probe-only/.test(
        source
      ),

    summaryNotExplicitlyProbed:
      !/step\\s*===\\s*"SUMMARY"[\\s\\S]{0,250}--probe-only/.test(
        source
      ),

    realTradingEnableNotAdded:
      !/PRODUCER_PROBE_TEST_MODE_V1[\\s\\S]{0,900}(REAL_TRADING_ENABLED|ENABLE_REAL_TRADING|ENABLE_LIVE_TRADING)\\s*[:=]\\s*["']true["']/i.test(
        source
      ),
  };

  const failed =
    Object.entries(checks)
      .filter(
        ([, value]) =>
          value !== true
      )
      .map(
        ([key]) =>
          key
      );

  console.log(JSON.stringify({
    status:
      failed.length === 0
        ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_TEST_MODE_V1_STATIC_VERIFIED"
        : "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_TEST_MODE_V1_STATIC_FAILED",

    checks,

    safety: {
      sourceOnly:
        true,
      automationExecuted:
        false,
      producerExecuted:
        false,
      subprocessExecuted:
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

    failed,

    nextGate:
      failed.length === 0
        ? "VERIFY_AUTOMATION_DEFAULT_RUNSTEP_REACHES_REAL_PRODUCER_PROBE_ONLY_BOUNDARY_V1"
        : "REPAIR_AUTOMATION_PRODUCER_PROBE_TEST_MODE_BINDING",
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
`;

    fs.writeFileSync(
      STATIC_VERIFY,
      verifier,
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
        "test:true-forward-oos-automation-producer-probe-test-mode-static"
      ] =
        "node ./scripts/true-forward-oos-automation-producer-probe-test-mode-v1-static-verify.cjs";

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
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_TEST_MODE_V1_INSTALLED",

        changed,

        target:
          "lib/research/run-true-forward-oos-automation-binding-v1.ts",

        backup:
          "scripts/backups/run-true-forward-oos-automation-binding-v1.before-producer-probe-test-mode-v1.ts",

        mode:
          "EXPLICIT_PRODUCE_ONLY_PROBE_TEST_MODE",

        trigger:
          "FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_ONLY=true",

        behavior: {
          default:
            "UNCHANGED",
          produceWhenEnabled:
            "APPENDS_--probe-only",
          collect:
            "UNCHANGED",
          evaluate:
            "UNCHANGED",
          summary:
            "UNCHANGED",
        },

        safety: {
          installerExecutedAutomation:
            false,
          installerExecutedProducer:
            false,
          subprocessExecution:
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
          "RUN_STATIC_EXISTING_BINDING_CONTRACT_AND_PRODUCER_PROBE_REGRESSION",
      }, null, 2));

      process.exitCode = 0;
    }
  }
}
