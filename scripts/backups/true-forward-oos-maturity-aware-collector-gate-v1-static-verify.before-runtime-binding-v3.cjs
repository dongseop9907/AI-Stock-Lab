const fs = require("fs");
const path = require("path");

const gate = path.join(
  process.cwd(),
  "scripts",
  "true-forward-oos-maturity-aware-collector-gate-v1.ts"
);

const collector = path.join(
  process.cwd(),
  "scripts",
  "alpha-v3-true-entry-forward-oos-collector-v1.ts"
);

if (
  !fs.existsSync(gate) ||
  !fs.existsSync(collector)
) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_MATURITY_COLLECTOR_SINGLE_RUN_BINDING_V2_STATIC_FAILED",

    failed: [
      "requiredFilesExist"
    ],
  }, null, 2));

  process.exitCode = 1;
} else {
  const gateSource =
    fs.readFileSync(
      gate,
      "utf8"
    );

  const collectorSource =
    fs.readFileSync(
      collector,
      "utf8"
    );

  const checks = {
    requiredFilesExist:
      true,

    collectorStillHasNoHorizonCli:
      !collectorSource.includes(
        "--horizon"
      ) &&
      !collectorSource.includes(
        "process.argv"
      ),

    gateNoLongerPassesHorizonCli:
      !gateSource.includes(
        '"--horizon"'
      ),

    collectorSpawnStillPresent:
      gateSource.includes(
        "spawn("
      ),

    collectorRunsOnceContract:
      gateSource.includes(
        "collectorRuns:"
      ) &&
      gateSource.includes(
        "await runCollector()"
      ),

    maturedHorizonsTracked:
      gateSource.includes(
        "maturedHorizons"
      ),

    r1r3r5CollectorNative:
      collectorSource.includes(
        "r1:"
      ) &&
      collectorSource.includes(
        "r3:"
      ) &&
      collectorSource.includes(
        "r5:"
      ) &&
      collectorSource.includes(
        "directReturns"
      ),

    noOrderSurface:
      !/createOrder|placeOrder|submitOrder/i.test(
        gateSource
      ),

    realTradingForcedFalse:
      gateSource.includes(
        'REAL_TRADING_ENABLED:\\n                "false"'
      ) &&
      gateSource.includes(
        'ENABLE_REAL_TRADING:\\n                "false"'
      ) &&
      gateSource.includes(
        'ENABLE_LIVE_TRADING:\\n                "false"'
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
        ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_MATURITY_COLLECTOR_SINGLE_RUN_BINDING_V2_STATIC_VERIFIED"
        : "AI_STOCK_LAB_TRUE_FORWARD_OOS_MATURITY_COLLECTOR_SINGLE_RUN_BINDING_V2_STATIC_FAILED",

    checks,

    safety: {
      sourceOnly:
        true,

      collectorExecuted:
        false,

      databaseWrites:
        0,

      ordersCreated:
        0,

      positionsChanged:
        0,

      promotionExecuted:
        false,

      realTradingEnabled:
        false,
    },

    failed,

    nextGate:
      failed.length === 0
        ? "RUN_SINGLE_RUN_COLLECTOR_BINDING_CONTRACT"
        : "REPAIR_SINGLE_RUN_COLLECTOR_BINDING_V2",
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
