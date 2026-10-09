const fs = require("fs");
const path = require("path");

const root = process.cwd();

const verifierRel =
  "scripts/alpha-v3-market-data-maintenance-scheduler-v3-static-verify.cjs";

const verifierPath =
  path.resolve(
    root,
    verifierRel,
  );

if (!fs.existsSync(verifierPath)) {
  throw new Error(
    "SCHEDULER_V3_STATIC_VERIFIER_NOT_FOUND",
  );
}

let source =
  fs.readFileSync(
    verifierPath,
    "utf8",
  );

const marker =
  "/* KRX_CANONICAL_V1_SUPERVISOR_ROUTING_COMPAT */";

const start =
  source.indexOf(marker);

if (start < 0) {
  throw new Error(
    "SUPERVISOR_ROUTING_COMPAT_MARKER_NOT_FOUND",
  );
}

const failedAnchors = [
  "const failed =",
  "let failed =",
  "var failed =",
];

let end = -1;

for (const anchor of failedAnchors) {
  const index =
    source.indexOf(
      anchor,
      start,
    );

  if (
    index >= 0 &&
    (
      end < 0 ||
      index < end
    )
  ) {
    end = index;
  }
}

if (end < 0) {
  throw new Error(
    "FAILED_CALCULATION_ANCHOR_NOT_FOUND",
  );
}

const replacement = `/* KRX_CANONICAL_V1_SUPERVISOR_ROUTING_COMPAT */
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

`;

const before =
  source;

source =
  source.slice(0, start) +
  replacement +
  source.slice(end);

const backupDir =
  path.resolve(
    root,
    "logs",
    "krx-calendar-v1-backups",
  );

fs.mkdirSync(
  backupDir,
  { recursive: true },
);

fs.writeFileSync(
  path.resolve(
    backupDir,
    "alpha-v3-market-data-maintenance-scheduler-v3-static-verify.pre-routing-v2.bak",
  ),
  before,
  "utf8",
);

fs.writeFileSync(
  verifierPath,
  source,
  "utf8",
);

const final =
  fs.readFileSync(
    verifierPath,
    "utf8",
  );

const checks = {
  markerPresent:
    final.includes(marker),

  stalePackageJsonReferenceRemoved:
    !final
      .slice(
        final.indexOf(marker),
        final.indexOf("const failed =", final.indexOf(marker)) >= 0
          ? final.indexOf("const failed =", final.indexOf(marker))
          : undefined,
      )
      .includes("packageJson?.scripts"),

  selfContainedPackageReadPresent:
    final.includes(
      'require("node:fs")',
    ) &&
    final.includes(
      'require("node:path")',
    ) &&
    final.includes(
      '"package.json"',
    ),

  supervisorV4Accepted:
    final.includes(
      "alpha-v3-market-data-maintenance-supervisor-v4",
    ),

  directV3StillAccepted:
    final.includes(
      "alpha-v3-market-data-maintenance-scheduler.ts",
    ),

  productionSourceUntouched:
    true,

  packageJsonUntouched:
    true,
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
          ? "MAINTENANCE_SCHEDULER_V3_STATIC_VERIFIER_SUPERVISOR_ROUTING_V2_FIXED"
          : "MAINTENANCE_SCHEDULER_V3_STATIC_VERIFIER_SUPERVISOR_ROUTING_V2_REVIEW",

      modifiedFile:
        verifierRel,

      checks,
      failed,

      behavior: {
        productionSchedulerCodeChanged:
          false,

        packageJsonChanged:
          false,

        verifierNowSelfContained:
          true,

        acceptedRecurringRoutes: [
          "DIRECT_SCHEDULER_V3",
          "HARDENED_SUPERVISOR_V4"
        ]
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
        forwardOosStateChanged: false
      },

      nextGate:
        failed.length === 0
          ? "RERUN_STATIC_CONTRACT_FINAL_KRX_REGRESSION"
          : "REVIEW_VERIFIER_PATCH"
    },
    null,
    2,
  ),
);

if (failed.length > 0) {
  process.exitCode = 2;
}
