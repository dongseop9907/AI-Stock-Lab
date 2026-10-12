const fs = require("fs");
const path = require("path");

const root =
  process.cwd();

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

const checks = {
  v3Version:
    scheduler.includes(
      "ALPHA_V3_MARKET_DATA_MAINTENANCE_SCHEDULER_V3_SELF_HEALING"
    ),

  default1640Kst:
    scheduler.includes(
      "DEFAULT_HOUR_KST =\n  16"
    ) &&
    scheduler.includes(
      "DEFAULT_MINUTE_KST =\n  40"
    ) &&
    scheduler.includes(
      '"Asia/Seoul"'
    ),

  initialIntegrityScan:
    scheduler.includes(
      '"INTEGRITY_SCAN"'
    ) &&
    scheduler.includes(
      "repair:" +
        "\n            false"
    ),

  conditionalRepair:
    scheduler.includes(
      '"INTEGRITY_REPAIR"'
    ) &&
    scheduler.includes(
      "repairDecision" +
        "\n      ?.shouldRepair"
    ) &&
    scheduler.includes(
      "repair:" +
        "\n              true"
    ),

  explicitVerification:
    scheduler.includes(
      '"INTEGRITY_VERIFY"'
    ),

  allowlistOnlyMissingStockBar:
    scheduler.includes(
      '"MISSING_STOCK_BAR"'
    ) &&
    scheduler.includes(
      "AUTO_REPAIR_ERROR_ALLOWLIST"
    ),

  rejectsNonRepairable:
    scheduler.includes(
      '"NON_REPAIRABLE_ERROR_PRESENT"'
    ),

  rejectsUnsupportedRepairableType:
    scheduler.includes(
      '"UNSUPPORTED_REPAIRABLE_ERROR_TYPE"'
    ),

  warningsNotAutoRepaired:
    scheduler.includes(
      "warningOnlyAutoRepair:" +
        "\n        false"
    ),

  extremeReturnNotAutoRepaired:
    scheduler.includes(
      "extremeReturnAutoRepair:" +
        "\n        false"
    ),

  qualityGatePresent:
    scheduler.includes(
      "/api/market/regime/v7/quality-gate/capture"
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

  packageSchedulerPreserved:
    pkg.scripts?.[
      "market-data:maintenance:scheduler"
    ] ===
      "tsx --env-file=.env.local scripts/alpha-v3-market-data-maintenance-scheduler.ts",

  packageOncePreserved:
    pkg.scripts?.[
      "market-data:maintenance:once"
    ] ===
      "tsx --env-file=.env.local scripts/alpha-v3-market-data-maintenance-scheduler.ts --once",

  packageTestPreserved:
    pkg.scripts?.[
      "market-data:maintenance:test"
    ] ===
      "tsx scripts/alpha-v3-market-data-maintenance-scheduler-contract-test.ts"
};


/* KRX_CANONICAL_V1_SUPERVISOR_ROUTING_COMPAT */
{
  const routingPackageJson =
    JSON.parse(
      require("node:fs")
        .readFileSync(
          require("node:path")
            .resolve(
              process.cwd(),
              "package.json"
            ),
          "utf8"
        )
    );

  const schedulerCommand =
    String(
      routingPackageJson?.scripts?.[
        "market-data:maintenance:scheduler"
      ] ?? ""
    );

  const schedulerDirectV3 =
    schedulerCommand.includes(
      "alpha-v3-market-data-maintenance-scheduler.ts"
    );

  const schedulerViaSupervisorV4 =
    schedulerCommand.includes(
      "alpha-v3-market-data-maintenance-supervisor-v4"
    );

  /*
   * Supervisor V4 is the hardened recurring entry point.
   * Manual --once remains on Scheduler V3 core.
   */
  checks.packageSchedulerPreserved =
    schedulerDirectV3 ||
    schedulerViaSupervisorV4;
}

const failed =
  Object.entries(
    checks
  )
    .filter(
      ([, value]) =>
        !value
    )
    .map(
      ([name]) =>
        name
    );

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "ALPHA_V3_MARKET_DATA_MAINTENANCE_SCHEDULER_V3_SELF_HEALING_STATIC_VERIFIED"
          : "ALPHA_V3_MARKET_DATA_MAINTENANCE_SCHEDULER_V3_SELF_HEALING_STATIC_REVIEW",

      checks,
      failed,

      policy: {
        dailyWindow:
          "16:40 KST",
        initialIntegrityRepair:
          false,
        autoRepairAllowlist: [
          "MISSING_STOCK_BAR"
        ],
        everyErrorMustBeRepairable:
          true,
        postRepairRescan:
          true,
        warningOnlyAutoRepair:
          false,
        extremeReturnAutoRepair:
          false
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
          : "REVIEW_V3_SELF_HEALING_SOURCE"
    },
    null,
    2
  )
);

if (
  failed.length >
  0
) {
  process.exitCode =
    2;
}
