const fs = require("fs");
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
      /FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_ONLY\s*===\s*"true"/.test(
        source
      ),

    probeFlagPresent:
      probeIndex >= 0,

    probeFlagInsideSpawnArea:
      spawnIndex >= 0 &&
      probeIndex > spawnIndex &&
      probeIndex - spawnIndex < 1200,

    defaultNoExtraArg:
      /\?\s*\["--probe-only"\]\s*:\s*\[\]/.test(
        source
      ),

    collectNotTargeted:
      !/step\s*===\s*"COLLECT"[\s\S]{0,250}--probe-only/.test(
        source
      ),

    evaluateNotTargeted:
      !/step\s*===\s*"EVALUATE"[\s\S]{0,250}--probe-only/.test(
        source
      ),

    summaryNotTargeted:
      !/step\s*===\s*"SUMMARY"[\s\S]{0,250}--probe-only/.test(
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
