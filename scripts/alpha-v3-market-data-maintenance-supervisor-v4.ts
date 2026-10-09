import { isKrxTradingDate } from "../lib/trading/krx-trading-calendar";
import fs from "node:fs";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

import {
  getKoreanClock,
  resolveMarketDataMaintenanceConfig,
  runMarketDataMaintenanceOnce,
  type MarketDataMaintenanceRunResult,
} from "./alpha-v3-market-data-maintenance-scheduler";

import {
  isKrxTradingDate,
} from "../lib/trading/krx-trading-calendar";


export const MARKET_DATA_MAINTENANCE_SUPERVISOR_VERSION =
  "ALPHA_V3_MARKET_DATA_MAINTENANCE_SUPERVISOR_V4_OPERATIONAL_HARDENING" as const;

const DEFAULT_POLL_MS = 60_000;
const DAILY_HOUR_KST = 16;
const DAILY_MINUTE_KST = 40;
const PERSISTENT_GATE_MIN_HOUR_KST = 16;
const PERSISTENT_GATE_MIN_MINUTE_KST = 30;
const MAX_ATTEMPTS_PER_KST_DATE = 3;
const RETRY_DELAYS_MS = [5 * 60_000, 15 * 60_000] as const;
const DEFAULT_STATE_FILE =
  "logs/alpha-v3-market-data-maintenance-supervisor-v4-state.json";

export interface PersistentHealthSnapshot {
  ok: boolean;
  healthy: boolean;
  reason: string;
  row: {
    id?: string | null;
    observed_at?: string | null;
    status?: string | null;
    expected_market_date?: string | null;
    freshness_status?: string | null;
    integrity_status?: string | null;
    effective_error_count?: number | null;
    effective_warning_count?: number | null;
  } | null;
  error: string | null;
}

export interface SupervisorState {
  version: typeof MARKET_DATA_MAINTENANCE_SUPERVISOR_VERSION;
  dateKst: string;
  attempts: number;
  lastAttemptAt: string | null;
  nextRetryAt: string | null;
  lastHealthyAt: string | null;
  lastMaintenanceSuccess: boolean | null;
  lastReason: string | null;
}

export interface SupervisorTickResult {
  version: typeof MARKET_DATA_MAINTENANCE_SUPERVISOR_VERSION;
  ran: boolean;
  reason: string;
  dateKst: string;
  attempts: number;
  nextRetryAt: string | null;
  persistentHealthBefore: PersistentHealthSnapshot | null;
  persistentHealthAfter: PersistentHealthSnapshot | null;
  maintenance: MarketDataMaintenanceRunResult | null;
  safety: {
    autoOrder: false;
    productionOrderEndpointCalled: false;
    maxAttemptsPerKstDate: number;
    retryDelaysMinutes: number[];
    persistentDedupe: true;
    providerFailurePolicy: "FAIL_CLOSED_RETRY_WITH_BACKOFF";
  };
}

export interface StateStore {
  load(dateKst: string): Promise<SupervisorState>;
  save(state: SupervisorState): Promise<void>;
}

export interface SupervisorDependencies {
  now?: Date;
  readPersistentHealth?: (
    dateKst: string,
  ) => Promise<PersistentHealthSnapshot>;
  runMaintenance?: () => Promise<MarketDataMaintenanceRunResult>;
  stateStore?: StateStore;
}

function initialState(dateKst: string): SupervisorState {
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
}

function normalizeLoadedState(
  value: unknown,
  dateKst: string,
): SupervisorState {
  if (typeof value !== "object" || value === null) {
    return initialState(dateKst);
  }

  const row = value as Partial<SupervisorState>;

  if (
    row.version !== MARKET_DATA_MAINTENANCE_SUPERVISOR_VERSION ||
    row.dateKst !== dateKst
  ) {
    return initialState(dateKst);
  }

  return {
    version: MARKET_DATA_MAINTENANCE_SUPERVISOR_VERSION,
    dateKst,
    attempts: Number.isInteger(row.attempts)
      ? Math.max(0, Number(row.attempts))
      : 0,
    lastAttemptAt:
      typeof row.lastAttemptAt === "string" ? row.lastAttemptAt : null,
    nextRetryAt:
      typeof row.nextRetryAt === "string" ? row.nextRetryAt : null,
    lastHealthyAt:
      typeof row.lastHealthyAt === "string" ? row.lastHealthyAt : null,
    lastMaintenanceSuccess:
      typeof row.lastMaintenanceSuccess === "boolean"
        ? row.lastMaintenanceSuccess
        : null,
    lastReason: typeof row.lastReason === "string" ? row.lastReason : null,
  };
}

export function createFileStateStore(
  stateFile:
    string =
      process.env.MARKET_DATA_MAINTENANCE_STATE_FILE?.trim() ||
      DEFAULT_STATE_FILE,
): StateStore {
  const absolute = path.resolve(process.cwd(), stateFile);

  return {
    async load(dateKst: string) {
      try {
        const text = fs.readFileSync(absolute, "utf8");
        return normalizeLoadedState(JSON.parse(text), dateKst);
      } catch (error) {
        const code =
          typeof error === "object" && error !== null && "code" in error
            ? String((error as { code?: unknown }).code)
            : "";

        if (code !== "ENOENT") {
          console.error(
            JSON.stringify({
              status:
                "MARKET_DATA_MAINTENANCE_SUPERVISOR_STATE_LOAD_WARNING",
              error:
                error instanceof Error ? error.message : String(error),
            }),
          );
        }

        return initialState(dateKst);
      }
    },

    async save(state: SupervisorState) {
      fs.mkdirSync(path.dirname(absolute), { recursive: true });

      const temp = `${absolute}.tmp`;

      fs.writeFileSync(
        temp,
        JSON.stringify(state, null, 2) + "\n",
        "utf8",
      );

      fs.renameSync(temp, absolute);
    },
  };
}

function requireEnv(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();

    if (value) {
      return value;
    }
  }

  throw new Error(`MISSING_ENV:${names.join("|")}`);
}

function createSupabase() {
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY"),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}

function kstDateTimeIso(
  dateKst: string,
  hour: number,
  minute: number,
): string {
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");

  return new Date(
    `${dateKst}T${hh}:${mm}:00+09:00`,
  ).toISOString();
}

export async function readPersistentHealthyGate(
  dateKst: string,
): Promise<PersistentHealthSnapshot> {
  try {
    const supabase = createSupabase();

    const lowerBound = kstDateTimeIso(
      dateKst,
      PERSISTENT_GATE_MIN_HOUR_KST,
      PERSISTENT_GATE_MIN_MINUTE_KST,
    );

    const { data, error } = await supabase
      .from("market_data_quality_gate_observations")
      .select(
        [
          "id",
          "observed_at",
          "status",
          "expected_market_date",
          "freshness_status",
          "integrity_status",
          "effective_error_count",
          "effective_warning_count",
        ].join(","),
      )
      .gte("observed_at", lowerBound)
      .order("observed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return {
        ok: false,
        healthy: false,
        reason: "PERSISTENT_HEALTH_READ_FAILED",
        row: null,
        error: error.message,
      };
    }

    if (!data) {
      return {
        ok: true,
        healthy: false,
        reason: "NO_POST_READY_QUALITY_OBSERVATION",
        row: null,
        error: null,
      };
    }

    const healthy =
      data.status === "PASS" &&
      data.freshness_status === "FRESH" &&
      data.integrity_status === "CLEAN" &&
      Number(data.effective_error_count ?? 0) === 0 &&
      Number(data.effective_warning_count ?? 0) === 0;

    return {
      ok: true,
      healthy,
      reason: healthy
        ? "POST_READY_QUALITY_PASS"
        : "POST_READY_QUALITY_NOT_PRODUCTION_CLEAN",
      row: data,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      healthy: false,
      reason: "PERSISTENT_HEALTH_READ_FATAL",
      row: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function isWeekend(now: Date): boolean {
  const clock = getKoreanClock(now);

  return !isKrxTradingDate(clock.date);
}

function afterDailyWindow(now: Date): boolean {
  const clock = getKoreanClock(now);

  return (
    clock.hour * 60 + clock.minute >=
    DAILY_HOUR_KST * 60 + DAILY_MINUTE_KST
  );
}

function retryDelayForAttempt(attempts: number): number | null {
  const index = attempts - 1;

  if (index < 0 || index >= RETRY_DELAYS_MS.length) {
    return null;
  }

  return RETRY_DELAYS_MS[index];
}

function buildTickResult(input: {
  ran: boolean;
  reason: string;
  dateKst: string;
  state: SupervisorState;
  before: PersistentHealthSnapshot | null;
  after: PersistentHealthSnapshot | null;
  maintenance: MarketDataMaintenanceRunResult | null;
}): SupervisorTickResult {
  return {
    version: MARKET_DATA_MAINTENANCE_SUPERVISOR_VERSION,
    ran: input.ran,
    reason: input.reason,
    dateKst: input.dateKst,
    attempts: input.state.attempts,
    nextRetryAt: input.state.nextRetryAt,
    persistentHealthBefore: input.before,
    persistentHealthAfter: input.after,
    maintenance: input.maintenance,
    safety: {
      autoOrder: false,
      productionOrderEndpointCalled: false,
      maxAttemptsPerKstDate: MAX_ATTEMPTS_PER_KST_DATE,
      retryDelaysMinutes: RETRY_DELAYS_MS.map((value) => value / 60_000),
      persistentDedupe: true,
      providerFailurePolicy: "FAIL_CLOSED_RETRY_WITH_BACKOFF",
    },
  };
}

export async function runSupervisorTick(
  dependencies: SupervisorDependencies = {},
): Promise<SupervisorTickResult> {
  const now = dependencies.now ?? new Date();
  const clock = getKoreanClock(now);
  const dateKst = clock.date;

  const stateStore =
    dependencies.stateStore ?? createFileStateStore();

  const readHealth =
    dependencies.readPersistentHealth ?? readPersistentHealthyGate;

  const runMaintenance =
    dependencies.runMaintenance ??
    (async () =>
      runMarketDataMaintenanceOnce(
        resolveMarketDataMaintenanceConfig(),
        { now },
      ));

  const state = await stateStore.load(dateKst);

  if (isWeekend(now)) {
    state.lastReason = "WEEKEND";
    await stateStore.save(state);

    return buildTickResult({
      ran: false,
      reason: "WEEKEND",
      dateKst,
      state,
      before: null,
      after: null,
      maintenance: null,
    });
  }

  if (!afterDailyWindow(now)) {
    state.lastReason = "BEFORE_DAILY_WINDOW";
    await stateStore.save(state);

    return buildTickResult({
      ran: false,
      reason: "BEFORE_DAILY_WINDOW",
      dateKst,
      state,
      before: null,
      after: null,
      maintenance: null,
    });
  }

  const persistentHealthBefore = await readHealth(dateKst);

  if (!persistentHealthBefore.ok) {
    state.lastReason = persistentHealthBefore.reason;
    await stateStore.save(state);

    return buildTickResult({
      ran: false,
      reason: persistentHealthBefore.reason,
      dateKst,
      state,
      before: persistentHealthBefore,
      after: null,
      maintenance: null,
    });
  }

  if (persistentHealthBefore.healthy) {
    state.lastHealthyAt =
      persistentHealthBefore.row?.observed_at ?? now.toISOString();
    state.nextRetryAt = null;
    state.lastReason = "PERSISTENT_QUALITY_PASS_ALREADY_HEALTHY";

    await stateStore.save(state);

    return buildTickResult({
      ran: false,
      reason: "PERSISTENT_QUALITY_PASS_ALREADY_HEALTHY",
      dateKst,
      state,
      before: persistentHealthBefore,
      after: persistentHealthBefore,
      maintenance: null,
    });
  }

  if (state.attempts >= MAX_ATTEMPTS_PER_KST_DATE) {
    state.lastReason = "MAX_ATTEMPTS_REACHED";
    await stateStore.save(state);

    return buildTickResult({
      ran: false,
      reason: "MAX_ATTEMPTS_REACHED",
      dateKst,
      state,
      before: persistentHealthBefore,
      after: null,
      maintenance: null,
    });
  }

  if (
    state.nextRetryAt &&
    Date.parse(state.nextRetryAt) > now.getTime()
  ) {
    state.lastReason = "RETRY_BACKOFF_ACTIVE";
    await stateStore.save(state);

    return buildTickResult({
      ran: false,
      reason: "RETRY_BACKOFF_ACTIVE",
      dateKst,
      state,
      before: persistentHealthBefore,
      after: null,
      maintenance: null,
    });
  }

  state.attempts += 1;
  state.lastAttemptAt = now.toISOString();
  state.nextRetryAt = null;
  state.lastReason = "MAINTENANCE_RUNNING";

  await stateStore.save(state);

  let maintenance: MarketDataMaintenanceRunResult;

  try {
    maintenance = await runMaintenance();
  } catch (error) {
    const delay = retryDelayForAttempt(state.attempts);

    state.lastMaintenanceSuccess = false;
    state.nextRetryAt =
      delay === null
        ? null
        : new Date(now.getTime() + delay).toISOString();
    state.lastReason = "MAINTENANCE_FATAL";

    await stateStore.save(state);

    return buildTickResult({
      ran: true,
      reason: "MAINTENANCE_FATAL",
      dateKst,
      state,
      before: persistentHealthBefore,
      after: {
        ok: false,
        healthy: false,
        reason: "POST_MAINTENANCE_HEALTH_NOT_READ",
        row: null,
        error:
          error instanceof Error ? error.message : String(error),
      },
      maintenance: null,
    });
  }

  const persistentHealthAfter = await readHealth(dateKst);

  const healthyAfter =
    maintenance.success &&
    persistentHealthAfter.ok &&
    persistentHealthAfter.healthy;

  state.lastMaintenanceSuccess = healthyAfter;

  if (healthyAfter) {
    state.lastHealthyAt =
      persistentHealthAfter.row?.observed_at ??
      new Date().toISOString();
    state.nextRetryAt = null;
    state.lastReason = "MAINTENANCE_HEALTHY_COMPLETE";
  } else {
    const delay = retryDelayForAttempt(state.attempts);

    state.nextRetryAt =
      delay === null
        ? null
        : new Date(now.getTime() + delay).toISOString();

    state.lastReason = maintenance.success
      ? "SEMANTIC_QUALITY_NOT_PRODUCTION_CLEAN"
      : "MAINTENANCE_PARTIAL_FAILURE";
  }

  await stateStore.save(state);

  return buildTickResult({
    ran: true,
    reason: state.lastReason ?? "UNKNOWN",
    dateKst,
    state,
    before: persistentHealthBefore,
    after: persistentHealthAfter,
    maintenance,
  });
}

function logJson(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}

export async function startSupervisor() {
  const pollMs = Math.max(
    10_000,
    Number(
      process.env.MARKET_DATA_MAINTENANCE_POLL_MS ??
      DEFAULT_POLL_MS,
    ) || DEFAULT_POLL_MS,
  );

  logJson({
    status:
      "ALPHA_V3_MARKET_DATA_MAINTENANCE_SUPERVISOR_V4_STARTED",
    policy: {
      dailyWindow: "16:40 KST",
      persistentSuccessEvidence:
        "POST_16_30_QUALITY_PASS_FRESH_CLEAN_ZERO_ERRORS_ZERO_WARNINGS",
      maxAttemptsPerKstDate: MAX_ATTEMPTS_PER_KST_DATE,
      retryDelaysMinutes: RETRY_DELAYS_MS.map(
        (value) => value / 60_000,
      ),
      stateFile:
        process.env.MARKET_DATA_MAINTENANCE_STATE_FILE?.trim() ||
        DEFAULT_STATE_FILE,
    },
    safety: {
      autoOrder: false,
      productionOrderEndpointCalled: false,
      activationChanged: false,
    },
  });

  const tick = async () => {
    const result = await runSupervisorTick();

    if (
      result.ran ||
      ![
        "BEFORE_DAILY_WINDOW",
        "PERSISTENT_QUALITY_PASS_ALREADY_HEALTHY",
        "RETRY_BACKOFF_ACTIVE",
      ].includes(result.reason)
    ) {
      logJson({
        status:
          "ALPHA_V3_MARKET_DATA_MAINTENANCE_SUPERVISOR_V4_TICK",
        result,
      });
    }
  };

  await tick();

  setInterval(() => {
    tick().catch((error) => {
      logJson({
        status:
          "ALPHA_V3_MARKET_DATA_MAINTENANCE_SUPERVISOR_V4_TICK_FATAL",
        error:
          error instanceof Error ? error.message : String(error),
      });
    });
  }, pollMs);
}

export async function runSupervisorOnce() {
  const result = await runSupervisorTick();

  logJson({
    status:
      result.reason ===
      "PERSISTENT_QUALITY_PASS_ALREADY_HEALTHY"
        ? "ALPHA_V3_MARKET_DATA_MAINTENANCE_SUPERVISOR_V4_PERSISTENT_DEDUPE_VERIFIED"
        : result.ran
          ? "ALPHA_V3_MARKET_DATA_MAINTENANCE_SUPERVISOR_V4_ONCE_RAN"
          : "ALPHA_V3_MARKET_DATA_MAINTENANCE_SUPERVISOR_V4_ONCE_SKIPPED",
    result,
  });

  if (
    result.reason === "PERSISTENT_HEALTH_READ_FAILED" ||
    result.reason === "PERSISTENT_HEALTH_READ_FATAL"
  ) {
    process.exitCode = 2;
  }
}

if (require.main === module) {
  (
    process.argv.includes("--once-supervisor")
      ? runSupervisorOnce()
      : startSupervisor()
  ).catch((error) => {
    logJson({
      status:
        "ALPHA_V3_MARKET_DATA_MAINTENANCE_SUPERVISOR_V4_FATAL",
      error:
        error instanceof Error ? error.message : String(error),
    });

    process.exitCode = 2;
  });
}
