import {
  strict as assert,
} from "node:assert";

import {
  MARKET_DATA_MAINTENANCE_SUPERVISOR_VERSION,
  runSupervisorTick,
  type PersistentHealthSnapshot,
  type StateStore,
  type SupervisorState,
} from "./alpha-v3-market-data-maintenance-supervisor-v4";

function healthy(
  observedAt: string = "2026-10-08T10:20:00.000Z",
): PersistentHealthSnapshot {
  return {
    ok: true,
    healthy: true,
    reason: "POST_READY_QUALITY_PASS",
    row: {
      id: "quality-1",
      observed_at: observedAt,
      status: "PASS",
      expected_market_date: "2026-10-08",
      freshness_status: "FRESH",
      integrity_status: "CLEAN",
      effective_error_count: 0,
      effective_warning_count: 0,
    },
    error: null,
  };
}

function unhealthy(
  reason: string = "NO_POST_READY_QUALITY_OBSERVATION",
): PersistentHealthSnapshot {
  return {
    ok: true,
    healthy: false,
    reason,
    row: null,
    error: null,
  };
}

function maintenanceResult(success: boolean): any {
  return {
    version:
      "ALPHA_V3_MARKET_DATA_MAINTENANCE_SCHEDULER_V3_SELF_HEALING",
    runDateKst: "2026-10-08",
    startedAt: "2026-10-08T07:40:00.000Z",
    finishedAt: "2026-10-08T07:40:01.000Z",
    success,
    steps: [],
    selfHealing: {
      evaluated: true,
      repairAttempted: false,
      repairDecision: {
        shouldRepair: false,
        reason: "NO_ERRORS",
        errorCount: 0,
        repairableErrorCount: 0,
        unsupportedIssueTypes: [],
      },
      verificationPerformed: false,
    },
    safety: {
      autoOrder: false,
      productionOrderEndpointCalled: false,
      purpose: "MARKET_DATA_MAINTENANCE_ONLY",
      automaticRepairScope:
        "ALLOWLISTED_REPAIRABLE_INTEGRITY_ERRORS_ONLY",
      warningOnlyAutoRepair: false,
      extremeReturnAutoRepair: false,
    },
  };
}

function memoryStore():
  StateStore & {
    current: SupervisorState | null;
  } {
  const holder: {
    current: SupervisorState | null;
  } = {
    current: null,
  };

  return {
    get current() {
      return holder.current;
    },

    set current(value: SupervisorState | null) {
      holder.current = value;
    },

    async load(dateKst: string) {
      if (holder.current?.dateKst === dateKst) {
        return { ...holder.current };
      }

      return {
        version: MARKET_DATA_MAINTENANCE_SUPERVISOR_VERSION,
        dateKst,
        attempts: 0,
        lastAttemptAt: null,
        nextRetryAt: null,
        lastHealthyAt: null,
        lastMaintenanceSuccess: null,
        lastReason: null,
      };
    },

    async save(state: SupervisorState) {
      holder.current = { ...state };
    },
  };
}

async function main() {
  const checks: Record<string, boolean> = {};

  let runs = 0;

  const restartDedupe = await runSupervisorTick({
    now: new Date("2026-10-08T11:00:00.000Z"),
    stateStore: memoryStore(),
    readPersistentHealth: async () => healthy(),
    runMaintenance: async () => {
      runs += 1;
      return maintenanceResult(true);
    },
  });

  checks.restartPersistentDedupe =
    restartDedupe.ran === false &&
    restartDedupe.reason ===
      "PERSISTENT_QUALITY_PASS_ALREADY_HEALTHY" &&
    runs === 0;

  const retryStore = memoryStore();
  let maintenanceCalls = 0;

  const firstFailure = await runSupervisorTick({
    now: new Date("2026-10-08T08:00:00.000Z"),
    stateStore: retryStore,
    readPersistentHealth: async () => unhealthy(),
    runMaintenance: async () => {
      maintenanceCalls += 1;
      return maintenanceResult(false);
    },
  });

  checks.firstFailureBackoff5 =
    firstFailure.ran === true &&
    firstFailure.attempts === 1 &&
    firstFailure.reason === "MAINTENANCE_PARTIAL_FAILURE" &&
    firstFailure.nextRetryAt ===
      "2026-10-08T08:05:00.000Z";

  const duringBackoff = await runSupervisorTick({
    now: new Date("2026-10-08T08:03:00.000Z"),
    stateStore: retryStore,
    readPersistentHealth: async () => unhealthy(),
    runMaintenance: async () => {
      maintenanceCalls += 1;
      return maintenanceResult(true);
    },
  });

  checks.backoffSuppressesDuplicate =
    duringBackoff.ran === false &&
    duringBackoff.reason === "RETRY_BACKOFF_ACTIVE" &&
    maintenanceCalls === 1;

  const secondFailure = await runSupervisorTick({
    now: new Date("2026-10-08T08:05:00.000Z"),
    stateStore: retryStore,
    readPersistentHealth: async () => unhealthy(),
    runMaintenance: async () => {
      maintenanceCalls += 1;
      return maintenanceResult(true);
    },
  });

  checks.semanticFailureBackoff15 =
    secondFailure.ran === true &&
    secondFailure.attempts === 2 &&
    secondFailure.reason ===
      "SEMANTIC_QUALITY_NOT_PRODUCTION_CLEAN" &&
    secondFailure.nextRetryAt ===
      "2026-10-08T08:20:00.000Z";

  let postHealthy = false;

  const success = await runSupervisorTick({
    now: new Date("2026-10-08T08:20:00.000Z"),
    stateStore: retryStore,
    readPersistentHealth: async () =>
      postHealthy
        ? healthy("2026-10-08T08:20:01.000Z")
        : unhealthy(),
    runMaintenance: async () => {
      maintenanceCalls += 1;
      postHealthy = true;
      return maintenanceResult(true);
    },
  });

  checks.thirdAttemptCanRecover =
    success.ran === true &&
    success.attempts === 3 &&
    success.reason === "MAINTENANCE_HEALTHY_COMPLETE" &&
    success.nextRetryAt === null;

  const afterSuccess = await runSupervisorTick({
    now: new Date("2026-10-08T08:30:00.000Z"),
    stateStore: memoryStore(),
    readPersistentHealth: async () =>
      healthy("2026-10-08T08:20:01.000Z"),
    runMaintenance: async () => {
      maintenanceCalls += 1;
      return maintenanceResult(true);
    },
  });

  checks.dbEvidenceSurvivesProcessRestart =
    afterSuccess.ran === false &&
    afterSuccess.reason ===
      "PERSISTENT_QUALITY_PASS_ALREADY_HEALTHY";

  const readFailure = await runSupervisorTick({
    now: new Date("2026-10-08T09:00:00.000Z"),
    stateStore: memoryStore(),
    readPersistentHealth: async () => ({
      ok: false,
      healthy: false,
      reason: "PERSISTENT_HEALTH_READ_FAILED",
      row: null,
      error: "simulated database outage",
    }),
    runMaintenance: async () => {
      throw new Error("MUST_NOT_RUN");
    },
  });

  checks.healthReadFailureFailsClosed =
    readFailure.ran === false &&
    readFailure.reason === "PERSISTENT_HEALTH_READ_FAILED";

  const beforeWindow = await runSupervisorTick({
    now: new Date("2026-10-08T07:39:00.000Z"),
    stateStore: memoryStore(),
    readPersistentHealth: async () => unhealthy(),
    runMaintenance: async () => maintenanceResult(true),
  });

  checks.before1640Skipped =
    beforeWindow.ran === false &&
    beforeWindow.reason === "BEFORE_DAILY_WINDOW";

  assert.equal(restartDedupe.safety.autoOrder, false);
  assert.equal(
    restartDedupe.safety.productionOrderEndpointCalled,
    false,
  );

  const failed = Object.entries(checks)
    .filter(([, value]) => !value)
    .map(([name]) => name);

  console.log(
    JSON.stringify(
      {
        status:
          failed.length === 0
            ? "ALPHA_V3_MARKET_DATA_MAINTENANCE_SUPERVISOR_V4_CONTRACT_VERIFIED"
            : "ALPHA_V3_MARKET_DATA_MAINTENANCE_SUPERVISOR_V4_CONTRACT_REVIEW",
        checks,
        failed,
        policy: {
          persistentDedupe:
            "DB_QUALITY_EVIDENCE_AFTER_16_30_KST",
          localState:
            "ATOMIC_FILE_FOR_ATTEMPTS_AND_BACKOFF",
          maxAttemptsPerKstDate: 3,
          retryDelaysMinutes: [5, 15],
          healthReadFailure:
            "FAIL_CLOSED_NO_MAINTENANCE_CALL",
          semanticPassRequired:
            "HTTP_SUCCESS_PLUS_PERSISTENT_QUALITY_PASS",
        },
        safety: {
          realNetworkCalls: 0,
          databaseWrites: 0,
          ordersCreated: 0,
          positionsChanged: 0,
        },
        nextGate:
          failed.length === 0
            ? "STATIC_TYPESCRIPT_THEN_PERSISTENT_DEDUPE_LIVE_SMOKE"
            : "REVIEW_SUPERVISOR_V4",
      },
      null,
      2,
    ),
  );

  if (failed.length > 0) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status:
          "ALPHA_V3_MARKET_DATA_MAINTENANCE_SUPERVISOR_V4_CONTRACT_FATAL",
        error:
          error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );

  process.exitCode = 2;
});
