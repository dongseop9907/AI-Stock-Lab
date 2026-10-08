const fs = require("fs");
const path = require("path");

const root = process.cwd();

const scheduler =
  fs.readFileSync(
    path.resolve(
      root,
      "scripts/alpha-v3-market-data-maintenance-scheduler.ts"
    ),
    "utf8"
  );

const pkg =
  JSON.parse(
    fs.readFileSync(
      path.resolve(
        root,
        "package.json"
      ),
      "utf8"
    )
  );

const expectedSequence = [
  "/api/market/regime/v7/eod-sync",
  "/api/market/regime/v7/freshness/capture",
  "/api/market/regime/v7/quality-gate/capture"
];

const positions =
  expectedSequence.map(
    (value) =>
      scheduler.indexOf(
        value
      )
  );

const checks = {
  version:
    scheduler.includes(
      "ALPHA_V3_MARKET_DATA_MAINTENANCE_SCHEDULER_V1"
    ),

  sequencePresent:
    positions.every(
      (value) =>
        value >= 0
    ),

  sequenceOrdered:
    positions[0] <
      positions[1] &&
    positions[1] <
      positions[2],

  defaultKstWindow:
    scheduler.includes(
      "DEFAULT_HOUR_KST =\n  16"
    ) &&
    scheduler.includes(
      "DEFAULT_MINUTE_KST =\n  20"
    ),

  kstClock:
    scheduler.includes(
      '"Asia/Seoul"'
    ),

  oncePerDayState:
    scheduler.includes(
      "lastAttemptDateKst"
    ),

  explicitOnceMode:
    scheduler.includes(
      '"--once"'
    ),

  noOrderEndpoints:
    !scheduler.includes(
      "/api/orders/"
    ) &&
    !scheduler.includes(
      "/api/signals/entry/"
    ) &&
    !scheduler.includes(
      "/api/trading/automation/run"
    ),

  autoOrderFalseSafety:
    scheduler.includes(
      "autoOrder:\n        false"
    ),

  packageScheduler:
    pkg.scripts?.[
      "market-data:maintenance:scheduler"
    ] ===
      "tsx --env-file=.env.local scripts/alpha-v3-market-data-maintenance-scheduler.ts",

  packageOnce:
    pkg.scripts?.[
      "market-data:maintenance:once"
    ] ===
      "tsx --env-file=.env.local scripts/alpha-v3-market-data-maintenance-scheduler.ts --once",

  packageTest:
    pkg.scripts?.[
      "market-data:maintenance:test"
    ] ===
      "tsx scripts/alpha-v3-market-data-maintenance-scheduler-contract-test.ts"
};

const failed =
  Object.entries(
    checks
  )
    .filter(
      ([, value]) =>
        !value
    )
    .map(
      ([key]) =>
        key
    );

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "ALPHA_V3_MARKET_DATA_MAINTENANCE_SCHEDULER_V1_STATIC_VERIFIED"
          : "ALPHA_V3_MARKET_DATA_MAINTENANCE_SCHEDULER_V1_STATIC_REVIEW",

      checks,
      failed,

      defaults: {
        timezone:
          "Asia/Seoul",

        dailyWindow:
          "16:20 KST",

        pollMs:
          60000,

        sequence:
          expectedSequence
      },

      safety: {
        databaseReads:
          0,

        databaseWrites:
          0,

        networkCalls:
          0,

        productionOrderEndpointCalled:
          false
      },

      nextGate:
        failed.length === 0
          ? "CONTRACT_TEST_AND_TARGETED_TYPESCRIPT"
          : "REVIEW_MARKET_DATA_MAINTENANCE_SCHEDULER"
    },
    null,
    2
  )
);

if (
  failed.length > 0
) {
  process.exitCode =
    2;
}
