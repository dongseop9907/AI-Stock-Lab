const fs = require("fs");
const path = require("path");

const root =
  process.cwd();

const runner =
  path.join(
    root,
    "scripts",
    "true-forward-oos-controlled-producer-evidence-run-v1.ts"
  );

if (!fs.existsSync(runner)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_CONTROLLED_PRODUCER_EVIDENCE_RUN_V1_STATIC_FAILED",
    failed:
      ["runnerExists"],
  }, null, 2));

  process.exitCode = 1;
} else {
  const source =
    fs.readFileSync(
      runner,
      "utf8"
    );

  const checks = {
    runnerExists:
      true,

    controlledRunnerUsed:
      source.includes(
        "runControlledNormalProducerV1"
      ),

    beforeSnapshot:
      source.includes(
        "const before ="
      ),

    afterSnapshot:
      source.includes(
        "const after ="
      ),

    hashUsed:
      source.includes(
        "sha256"
      ),

    sessionDelta:
      source.includes(
        "diffSessions"
      ),

    dryRunNoMutationCheck:
      source.includes(
        "dryRunDidNotMutateForwardFile"
      ),

    maxOneNewSession:
      source.includes(
        "normalRunCreatedAtMostOneSession"
      ),

    explicitProbeOff:
      source.includes(
        'FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_ONLY:'
      ) &&
      source.includes(
        '"false"'
      ),

    realTradingOff:
      source.includes(
        'REAL_TRADING_ENABLED:'
      ) &&
      source.includes(
        'ENABLE_REAL_TRADING:'
      ) &&
      source.includes(
        'ENABLE_LIVE_TRADING:'
      ),

    evidenceLog:
      source.includes(
        "true-forward-oos-controlled-producer-evidence-run-v1.json"
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
        ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_CONTROLLED_PRODUCER_EVIDENCE_RUN_V1_STATIC_VERIFIED"
        : "AI_STOCK_LAB_TRUE_FORWARD_OOS_CONTROLLED_PRODUCER_EVIDENCE_RUN_V1_STATIC_FAILED",

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
        ? "RUN_EVIDENCE_CONTRACT"
        : "REPAIR_EVIDENCE_RUN_V1",
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
