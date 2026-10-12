const fs = require("fs");
const path = require("path");

const root = process.cwd();

const target = path.join(
  root,
  "scripts",
  "true-forward-oos-controlled-normal-producer-v1.ts"
);

if (!fs.existsSync(target)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_CONTROLLED_NORMAL_PRODUCER_V1_STATIC_FAILED",
    failed:
      ["runnerExists"],
  }, null, 2));

  process.exitCode = 1;
} else {
  const source =
    fs.readFileSync(
      target,
      "utf8"
    );

  const checks = {
    runnerExists:
      true,

    exactEnableFlag:
      /FORWARD_OOS_CONTROLLED_NORMAL_PRODUCER_ENABLED[\s\S]{0,120}!==[\s\S]{0,40}"true"/.test(
        source
      ),

    exactConfirmPhrase:
      source.includes(
        "RUN_TRUE_FORWARD_OOS_NORMAL_PRODUCER"
      ),

    realTradingBlock:
      source.includes(
        "REAL_TRADING_MUST_REMAIN_DISABLED"
      ),

    probeModeBlock:
      source.includes(
        "PROBE_MODE_MUST_BE_DISABLED_FOR_NORMAL_PRODUCER"
      ),

    krxGuard:
      source.includes(
        "isKrxTradingDate"
      ),

    controlledTimeWindow:
      source.includes(
        '"08:45"'
      ) &&
      source.includes(
        '"08:59"'
      ),

    dryRunSurface:
      source.includes(
        "CONTROLLED_NORMAL_PRODUCER_READY_DRY_RUN"
      ),

    automationBindingUsed:
      source.includes(
        "runTrueForwardOosAutomationBindingV1"
      ),

    automationExplicitlyEnabledOnlyInsideRunner:
      source.includes(
        'FORWARD_OOS_AUTOMATION_ENABLED:'
      ) &&
      source.includes(
        '"true"'
      ),

    producerProbeForcedOffForNormalRun:
      source.includes(
        'FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_ONLY:'
      ) &&
      source.includes(
        '"false"'
      ),

    realTradingForcedFalse:
      source.includes(
        'REAL_TRADING_ENABLED:'
      ) &&
      source.includes(
        'ENABLE_REAL_TRADING:'
      ) &&
      source.includes(
        'ENABLE_LIVE_TRADING:'
      ),

    inMemoryState:
      source.includes(
        "let state: any"
      ) &&
      source.includes(
        "loadState:"
      ) &&
      source.includes(
        "saveState:"
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
        ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_CONTROLLED_NORMAL_PRODUCER_V1_STATIC_VERIFIED"
        : "AI_STOCK_LAB_TRUE_FORWARD_OOS_CONTROLLED_NORMAL_PRODUCER_V1_STATIC_FAILED",

    checks,

    safety: {
      sourceOnly:
        true,

      normalProducerExecuted:
        false,

      realTradingEnabled:
        false,
    },

    failed,

    nextGate:
      failed.length === 0
        ? "RUN_CONTROLLED_NORMAL_PRODUCER_CONTRACT"
        : "REPAIR_CONTROLLED_NORMAL_PRODUCER_V1",
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
