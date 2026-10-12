const fs = require("fs");
const path = require("path");

const root = process.cwd();

const verifierRel =
  "scripts/alpha-v3-market-data-maintenance-scheduler-v3-static-verify.cjs";

const verifierPath =
  path.resolve(root, verifierRel);

const packagePath =
  path.resolve(root, "package.json");

if (!fs.existsSync(verifierPath)) {
  throw new Error(
    "SCHEDULER_V3_STATIC_VERIFIER_NOT_FOUND",
  );
}

if (!fs.existsSync(packagePath)) {
  throw new Error(
    "PACKAGE_JSON_NOT_FOUND",
  );
}

const before =
  fs.readFileSync(
    verifierPath,
    "utf8",
  );

const packageJson =
  JSON.parse(
    fs.readFileSync(
      packagePath,
      "utf8",
    ),
  );

const scripts =
  packageJson.scripts ?? {};

const schedulerScript =
  String(
    scripts[
      "market-data:maintenance:scheduler"
    ] ?? "",
  );

const onceScript =
  String(
    scripts[
      "market-data:maintenance:once"
    ] ?? "",
  );

const testScript =
  String(
    scripts[
      "market-data:maintenance:test"
    ] ?? "",
  );

const currentRouting = {
  schedulerScript,
  onceScript,
  testScript,

  schedulerUsesSupervisorV4:
    schedulerScript.includes(
      "alpha-v3-market-data-maintenance-supervisor-v4",
    ),

  schedulerUsesV3CoreDirectly:
    schedulerScript.includes(
      "alpha-v3-market-data-maintenance-scheduler.ts",
    ),

  onceUsesV3Core:
    onceScript.includes(
      "alpha-v3-market-data-maintenance-scheduler.ts",
    ) &&
    onceScript.includes(
      "--once",
    ),

  testUsesContract:
    testScript.includes(
      "alpha-v3-market-data-maintenance-scheduler-contract-test.ts",
    ),
};

if (
  !currentRouting.schedulerUsesSupervisorV4 &&
  !currentRouting.schedulerUsesV3CoreDirectly
) {
  throw new Error(
    "UNEXPECTED_SCHEDULER_PACKAGE_ROUTING",
  );
}

if (!currentRouting.onceUsesV3Core) {
  throw new Error(
    "UNEXPECTED_MAINTENANCE_ONCE_ROUTING",
  );
}

if (!currentRouting.testUsesContract) {
  throw new Error(
    "UNEXPECTED_MAINTENANCE_TEST_ROUTING",
  );
}

/*
 * Preserve the existing verifier and only normalize the one stale
 * packageSchedulerPreserved check after `checks` is created and before
 * `failed` is calculated.
 *
 * This avoids weakening all of the V3 self-healing policy checks.
 */
const patchMarker =
  "/* KRX_CANONICAL_V1_SUPERVISOR_ROUTING_COMPAT */";

if (!before.includes(patchMarker)) {
  const failedNeedles = [
    "const failed =",
    "let failed =",
    "var failed =",
  ];

  let failedIndex = -1;

  for (const needle of failedNeedles) {
    const index =
      before.indexOf(needle);

    if (index >= 0) {
      failedIndex = index;
      break;
    }
  }

  if (failedIndex < 0) {
    throw new Error(
      "STATIC_VERIFIER_FAILED_CALCULATION_ANCHOR_NOT_FOUND",
    );
  }

  const compatibilityPatch = `
${patchMarker}
{
  const schedulerCommand =
    String(
      packageJson?.scripts?.[
        "market-data:maintenance:scheduler"
      ] ?? "",
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
   * Supervisor V4 became the hardened recurring entry point.
   * Manual --once intentionally remains bound to the V3 core.
   * Both direct-V3 and supervisor-V4 scheduler routing preserve
   * the Scheduler V3 self-healing implementation.
   */
  checks.packageSchedulerPreserved =
    schedulerDirectV3 ||
    schedulerViaSupervisorV4;
}

`;

  const after =
    before.slice(
      0,
      failedIndex,
    ) +
    compatibilityPatch +
    before.slice(
      failedIndex,
    );

  const backupDir =
    path.resolve(
      root,
      "logs",
      "krx-calendar-v1-backups",
    );

  fs.mkdirSync(
    backupDir,
    {
      recursive: true,
    },
  );

  fs.writeFileSync(
    path.resolve(
      backupDir,
      "alpha-v3-market-data-maintenance-scheduler-v3-static-verify.pre-supervisor-routing-compat.bak",
    ),
    before,
    "utf8",
  );

  fs.writeFileSync(
    verifierPath,
    after,
    "utf8",
  );
}

const finalSource =
  fs.readFileSync(
    verifierPath,
    "utf8",
  );

const checks = {
  verifierPatchPresent:
    finalSource.includes(
      patchMarker,
    ),

  productionSchedulerSourceUntouched:
    true,

  packageJsonUntouched:
    true,

  schedulerRouteRecognized:
    currentRouting.schedulerUsesSupervisorV4 ||
    currentRouting.schedulerUsesV3CoreDirectly,

  onceStillUsesV3Core:
    currentRouting.onceUsesV3Core,

  testStillUsesContract:
    currentRouting.testUsesContract,
};

const failed =
  Object.entries(checks)
    .filter(
      ([, ok]) =>
        !ok,
    )
    .map(
      ([name]) =>
        name,
    );

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "MAINTENANCE_SCHEDULER_V3_STATIC_VERIFIER_SUPERVISOR_ROUTING_V1_FIXED"
          : "MAINTENANCE_SCHEDULER_V3_STATIC_VERIFIER_SUPERVISOR_ROUTING_V1_REVIEW",

      modifiedFile:
        verifierRel,

      currentRouting,

      checks,
      failed,

      behavior: {
        productionSchedulerCodeChanged:
          false,

        packageJsonChanged:
          false,

        verifierPolicy:
          "ACCEPT_DIRECT_V3_OR_HARDENED_SUPERVISOR_V4_RECURRING_ENTRY",

        manualOncePolicy:
          "V3_CORE_PRESERVED",

        contractTestPolicy:
          "PRESERVED",
      },

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        networkCalls: 0,
        maintenanceExecuted: false,
        schedulerStarted: false,
        ordersCreated: 0,
        positionsChanged: 0,
        realTradingChanged: false,
        forwardOosStateChanged: false,
      },

      nextGate:
        failed.length === 0
          ? "RERUN_SCHEDULER_V3_STATIC_AND_FINAL_KRX_CALENDAR_REGRESSION"
          : "REVIEW_STATIC_VERIFIER_PATCH",
    },
    null,
    2,
  ),
);

if (failed.length > 0) {
  process.exitCode = 2;
}
