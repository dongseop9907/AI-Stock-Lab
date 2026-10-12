const fs = require("fs");
const path = require("path");

const root = process.cwd();

const supervisor = fs.readFileSync(
  path.resolve(
    root,
    "scripts/alpha-v3-market-data-maintenance-supervisor-v4.ts"
  ),
  "utf8"
);

const pkg = JSON.parse(
  fs.readFileSync(
    path.resolve(root, "package.json"),
    "utf8"
  )
);

const checks = {
  v4Version:
    supervisor.includes(
      "ALPHA_V3_MARKET_DATA_MAINTENANCE_SUPERVISOR_V4_OPERATIONAL_HARDENING"
    ),

  persistentQualityRead:
    supervisor.includes(
      "market_data_quality_gate_observations"
    ) &&
    supervisor.includes("observed_at") &&
    supervisor.includes("freshness_status") &&
    supervisor.includes("integrity_status"),

  requiresCleanProductionEvidence:
    supervisor.includes('data.status === "PASS"') &&
    supervisor.includes(
      'data.freshness_status === "FRESH"'
    ) &&
    supervisor.includes(
      'data.integrity_status === "CLEAN"'
    ),

  persistentDedupeReason:
    supervisor.includes(
      "PERSISTENT_QUALITY_PASS_ALREADY_HEALTHY"
    ),

  atomicStateFile:
    supervisor.includes('`${absolute}.tmp`') &&
    supervisor.includes("fs.renameSync"),

  maxThreeAttempts:
    supervisor.includes(
      "MAX_ATTEMPTS_PER_KST_DATE = 3"
    ),

  fiveThenFifteenMinuteBackoff:
    supervisor.includes("5 * 60_000") &&
    supervisor.includes("15 * 60_000"),

  healthReadFailClosed:
    supervisor.includes(
      "PERSISTENT_HEALTH_READ_FAILED"
    ) &&
    supervisor.includes(
      "PERSISTENT_HEALTH_READ_FATAL"
    ),

  semanticHealthAfterRun:
    supervisor.includes(
      "maintenance.success &&"
    ) &&
    supervisor.includes(
      "persistentHealthAfter.healthy"
    ),

  importsV3Core:
    supervisor.includes(
      'from "./alpha-v3-market-data-maintenance-scheduler"'
    ) &&
    supervisor.includes(
      "runMarketDataMaintenanceOnce"
    ),

  noOrderEndpoints:
    !supervisor.includes("/api/orders/") &&
    !supervisor.includes("/api/signals/entry/") &&
    !supervisor.includes("/api/trading/automation/"),

  schedulerPackageUsesSupervisor:
    pkg.scripts?.["market-data:maintenance:scheduler"] ===
      "tsx --env-file=.env.local scripts/alpha-v3-market-data-maintenance-supervisor-v4.ts",

  manualOnceStillUsesV3Core:
    pkg.scripts?.["market-data:maintenance:once"] ===
      "tsx --env-file=.env.local scripts/alpha-v3-market-data-maintenance-scheduler.ts --once",

  supervisorOnceExists:
    pkg.scripts?.[
      "market-data:maintenance:supervisor:once"
    ] ===
      "tsx --env-file=.env.local scripts/alpha-v3-market-data-maintenance-supervisor-v4.ts --once-supervisor",

  supervisorTestExists:
    pkg.scripts?.[
      "market-data:maintenance:supervisor:test"
    ] ===
      "tsx scripts/alpha-v3-market-data-maintenance-supervisor-v4-contract-test.ts"
};

const failed = Object.entries(checks)
  .filter(([, value]) => !value)
  .map(([name]) => name);

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "ALPHA_V3_MARKET_DATA_MAINTENANCE_SUPERVISOR_V4_STATIC_VERIFIED"
          : "ALPHA_V3_MARKET_DATA_MAINTENANCE_SUPERVISOR_V4_STATIC_REVIEW",
      checks,
      failed,
      policy: {
        persistentDedupe: true,
        healthyEvidence:
          "POST_16_30_PASS_FRESH_CLEAN_ZERO_ERROR_ZERO_WARNING",
        maxAttemptsPerDate: 3,
        retryMinutes: [5, 15],
        statePersistence:
          "ATOMIC_LOCAL_FILE_PLUS_DB_SUCCESS_EVIDENCE",
        schedulerActivationChanged: false
      },
      safety: {
        databaseWrites: 0,
        networkCalls: 0,
        productionOrderEndpointCalled: false
      },
      nextGate:
        failed.length === 0
          ? "CONTRACT_TYPESCRIPT_PERSISTENT_DEDUPE_LIVE_SMOKE"
          : "REVIEW_SUPERVISOR_V4_SOURCE"
    },
    null,
    2
  )
);

if (failed.length > 0) {
  process.exitCode = 2;
}
