const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const TARGET =
  path.join(
    ROOT,
    "scripts",
    "alpha-v3-true-forward-top1-producer-v1.ts"
  );

if (!fs.existsSync(TARGET)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_PROBE_ONLY_V1_STATIC_FAILED",
    failed: [
      "producerExists",
    ],
  }, null, 2));

  process.exitCode = 1;
} else {
  const source =
    fs.readFileSync(
      TARGET,
      "utf8"
    );

  const mainIndex =
    source.indexOf(
      "async function main() {"
    );

  const probeFnIndex =
    source.indexOf(
      "export function isTrueForwardTop1ProbeOnly("
    );

  const probeBranchIndex =
    source.indexOf(
      "if (isTrueForwardTop1ProbeOnly())",
      Math.max(
        0,
        mainIndex
      )
    );

  const runtimeCallIndex =
    source.indexOf(
      "runTrueForwardTop1Producer(",
      Math.max(
        0,
        mainIndex
      )
    );

  const firstReturnAfterProbe =
    source.indexOf(
      "return;",
      Math.max(
        0,
        probeBranchIndex
      )
    );

  const checks = {
    producerExists:
      true,

    probeFunctionExported:
      probeFnIndex >= 0,

    probeFunctionUsesProcessArgv:
      /isTrueForwardTop1ProbeOnly[\s\S]{0,700}process\.argv/.test(
        source
      ),

    probeOnlyFlagPresent:
      source.includes(
        "--probe-only"
      ),

    mainFound:
      mainIndex >= 0,

    probeBranchInsideMain:
      mainIndex >= 0 &&
      probeBranchIndex >
        mainIndex,

    probeReturnPresent:
      firstReturnAfterProbe >
      probeBranchIndex,

    producerRuntimeCallFound:
      runtimeCallIndex >= 0,

    probeBeforeProducerRuntime:
      probeBranchIndex >= 0 &&
      runtimeCallIndex >= 0 &&
      probeBranchIndex <
        runtimeCallIndex,

    returnBeforeProducerRuntime:
      firstReturnAfterProbe >= 0 &&
      runtimeCallIndex >= 0 &&
      firstReturnAfterProbe <
        runtimeCallIndex,

    importSafeGuardStillPresent:
      source.includes(
        "export function isTrueForwardTop1DirectExecution("
      ) &&
      source.includes(
        "if (isTrueForwardTop1DirectExecution())"
      ),

    noTradingEnableSurfaceAdded:
      !/PROBE_ONLY_V1[\s\S]{0,1200}(REAL_TRADING_ENABLED\s*=\s*["']true["']|ENABLE_REAL_TRADING\s*=\s*["']true["']|ENABLE_LIVE_TRADING\s*=\s*["']true["'])/i.test(
        source
      ),
  };

  const failed =
    Object.entries(
      checks
    )
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
        ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_PROBE_ONLY_V1_STATIC_VERIFIED"
        : "AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_PROBE_ONLY_V1_STATIC_FAILED",

    checks,

    failed,

    nextGate:
      failed.length === 0
        ? "RUN_REAL_PRODUCER_SUBPROCESS_WITH_PROBE_ONLY"
        : "REPAIR_PROBE_ONLY_EARLY_RETURN_BOUNDARY",
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
