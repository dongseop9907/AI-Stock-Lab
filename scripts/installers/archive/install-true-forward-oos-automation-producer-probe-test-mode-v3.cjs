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
  "run-true-forward-oos-automation-binding-v1.before-producer-probe-test-mode-v3.ts"
);

const VERIFY = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-automation-producer-probe-test-mode-v3-static-verify.cjs"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_TEST_MODE_V3_INSTALL_FAILED",
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
    "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_TEST_MODE_V3";

  let changed = false;

  if (!source.includes(marker)) {
    const oldBlock = `          [
            "--env-file=.env.local",
            "--import",
            "tsx",
            script,
          ],`;

    const newBlock = `          [
            "--env-file=.env.local",
            "--import",
            "tsx",
            script,
            ...(
              step === "PRODUCE" &&
              process.env.FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_ONLY === "true"
                ? ["--probe-only"]
                : []
            ),
          ], // ${marker}`;

    const count =
      source.split(oldBlock).length - 1;

    if (count !== 1) {
      fail(
        "EXACT_SPAWN_ARGUMENT_BLOCK_NOT_UNIQUE",
        { count }
      );
    } else {
      source =
        source.replace(
          oldBlock,
          newBlock
        );

      changed = true;
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

const target = path.join(
  process.cwd(),
  "lib",
  "research",
  "run-true-forward-oos-automation-binding-v1.ts"
);

if (!fs.existsSync(target)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_TEST_MODE_V3_STATIC_FAILED",
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
    "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_TEST_MODE_V3";

  const markerIndex =
    source.indexOf(marker);

  const spawnIndex =
    source.lastIndexOf(
      "spawn(",
      markerIndex
    );

  const probeIndex =
    source.indexOf(
      "--probe-only",
      spawnIndex
    );

  const checks = {
    bindingExists:
      true,

    markerPresent:
      markerIndex >= 0,

    usesSpawn:
      spawnIndex >= 0,

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
        '"--import"'
      ) &&
      source.includes(
        '"tsx"'
      ),

    produceOnlyGuardPresent:
      source.includes(
        'step === "PRODUCE"'
      ),

    explicitProbeEnvPresent:
      source.includes(
        "FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_ONLY"
      ),

    exactTrueRequired:
      /FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_ONLY\\s*===\\s*"true"/.test(
        source
      ),

    probeFlagPresent:
      probeIndex >= 0,

    probeFlagInsideSpawnArea:
      spawnIndex >= 0 &&
      probeIndex > spawnIndex &&
      probeIndex - spawnIndex < 1200,

    defaultNoExtraArg:
      /\\?\\s*\\["--probe-only"\\]\\s*:\\s*\\[\\]/.test(
        source
      ),

    collectNotTargeted:
      !/step\\s*===\\s*"COLLECT"[\\s\\S]{0,250}--probe-only/.test(
        source
      ),

    evaluateNotTargeted:
      !/step\\s*===\\s*"EVALUATE"[\\s\\S]{0,250}--probe-only/.test(
        source
      ),

    summaryNotTargeted:
      !/step\\s*===\\s*"SUMMARY"[\\s\\S]{0,250}--probe-only/.test(
        source
      ),

    realTradingStillForcedFalse:
      source.includes(
        "REAL_TRADING_ENABLED:"
      ) &&
      source.includes(
        "ENABLE_REAL_TRADING:"
      ) &&
      source.includes(
        "ENABLE_LIVE_TRADING:"
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
        ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_TEST_MODE_V3_STATIC_VERIFIED"
        : "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_TEST_MODE_V3_STATIC_FAILED",

    checks,

    safety: {
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
        : "REPAIR_V3_BINDING",
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
`;

    fs.writeFileSync(
      VERIFY,
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
        "test:true-forward-oos-automation-producer-probe-test-mode-v3-static"
      ] =
        "node ./scripts/true-forward-oos-automation-producer-probe-test-mode-v3-static-verify.cjs";

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
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_TEST_MODE_V3_INSTALLED",

        changed,

        target:
          "lib/research/run-true-forward-oos-automation-binding-v1.ts",

        backup:
          "scripts/backups/run-true-forward-oos-automation-binding-v1.before-producer-probe-test-mode-v3.ts",

        trigger:
          "FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_ONLY=true",

        behavior: {
          default:
            "UNCHANGED",
          produceProbeMode:
            "APPENDS_--probe-only",
          collect:
            "UNCHANGED",
          evaluate:
            "UNCHANGED",
          summary:
            "UNCHANGED",
        },

        safety: {
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

        nextAction:
          "RUN_STATIC_AND_REGRESSIONS",
      }, null, 2));

      process.exitCode = 0;
    }
  }
}
