import { isKrxTradingDate } from "../lib/trading/krx-trading-calendar";
type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface MarketDataMaintenanceConfig {
  baseUrl: string;
  hourKst: number;
  minuteKst: number;
  pollMs: number;
  automationSecret: string | null;
}

export interface MarketDataMaintenanceState {
  lastAttemptDateKst: string | null;
  running: boolean;
}

export type MarketDataMaintenanceStepName =
  | "EOD_SYNC"
  | "FRESHNESS_CAPTURE"
  | "INTEGRITY_SCAN"
  | "INTEGRITY_REPAIR"
  | "INTEGRITY_VERIFY"
  | "QUALITY_GATE_CAPTURE";

export interface MarketDataMaintenanceStepResult {
  name: MarketDataMaintenanceStepName;
  path: string;
  ok: boolean;
  status: number | null;
  payload: unknown;
  error: string | null;
  durationMs: number;
  requestBody: unknown;
}

export interface IntegrityRepairDecision {
  shouldRepair: boolean;
  reason:
    | "NO_INTEGRITY_PAYLOAD"
    | "NO_ERRORS"
    | "NON_REPAIRABLE_ERROR_PRESENT"
    | "UNSUPPORTED_REPAIRABLE_ERROR_TYPE"
    | "ALL_ERRORS_REPAIRABLE_AND_ALLOWLISTED";

  errorCount: number;
  repairableErrorCount: number;
  unsupportedIssueTypes: string[];
}

export interface MarketDataMaintenanceRunResult {
  version:
    "ALPHA_V3_MARKET_DATA_MAINTENANCE_SCHEDULER_V3_SELF_HEALING";

  runDateKst: string;
  startedAt: string;
  finishedAt: string;

  success: boolean;
  steps: MarketDataMaintenanceStepResult[];

  selfHealing: {
    evaluated: boolean;
    repairAttempted: boolean;
    repairDecision: IntegrityRepairDecision | null;
    verificationPerformed: boolean;
  };

  safety: {
    autoOrder: false;
    productionOrderEndpointCalled: false;
    purpose: "MARKET_DATA_MAINTENANCE_ONLY";
    automaticRepairScope:
      "ALLOWLISTED_REPAIRABLE_INTEGRITY_ERRORS_ONLY";
    warningOnlyAutoRepair: false;
    extremeReturnAutoRepair: false;
  };
}

export const MARKET_DATA_MAINTENANCE_VERSION =
  "ALPHA_V3_MARKET_DATA_MAINTENANCE_SCHEDULER_V3_SELF_HEALING" as const;

const DEFAULT_BASE_URL =
  "http://localhost:3000";

const DEFAULT_HOUR_KST =
  16;

const DEFAULT_MINUTE_KST =
  40;

const DEFAULT_POLL_MS =
  60_000;

const INTEGRITY_WINDOW_CALENDAR_DAYS =
  45;

const AUTO_REPAIR_ERROR_ALLOWLIST =
  new Set([
    "MISSING_STOCK_BAR",
  ]);

function finiteInt(
  value:
    string | undefined,
  fallback:
    number,
  min:
    number,
  max:
    number,
): number {
  const parsed =
    Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const integer =
    Math.trunc(parsed);

  return Math.min(
    max,
    Math.max(
      min,
      integer,
    ),
  );
}

export function normalizeBaseUrl(
  value:
    string,
): string {
  return value
    .trim()
    .replace(/\/+$/, "");
}

export function resolveMarketDataMaintenanceConfig(
  env:
    NodeJS.ProcessEnv =
      process.env,
): MarketDataMaintenanceConfig {
  return {
    baseUrl:
      normalizeBaseUrl(
        env.MARKET_DATA_MAINTENANCE_BASE_URL ??
        env.TRADING_AUTOMATION_BASE_URL ??
        DEFAULT_BASE_URL,
      ),

    hourKst:
      finiteInt(
        env.MARKET_DATA_MAINTENANCE_HOUR_KST,
        DEFAULT_HOUR_KST,
        0,
        23,
      ),

    minuteKst:
      finiteInt(
        env.MARKET_DATA_MAINTENANCE_MINUTE_KST,
        DEFAULT_MINUTE_KST,
        0,
        59,
      ),

    pollMs:
      finiteInt(
        env.MARKET_DATA_MAINTENANCE_POLL_MS,
        DEFAULT_POLL_MS,
        10_000,
        3_600_000,
      ),

    automationSecret:
      String(
        env.TRADING_AUTOMATION_SECRET ??
        "",
      ).trim() || null,
  };
}

export function createMarketDataMaintenanceState():
  MarketDataMaintenanceState {
  return {
    lastAttemptDateKst:
      null,
    running:
      false,
  };
}

export function getKoreanClock(
  now:
    Date = new Date(),
): {
  date: string;
  hour: number;
  minute: number;
  weekday: number;
} {
  const parts =
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone:
          "Asia/Seoul",
        year:
          "numeric",
        month:
          "2-digit",
        day:
          "2-digit",
        hour:
          "2-digit",
        minute:
          "2-digit",
        weekday:
          "short",
        hourCycle:
          "h23",
      },
    ).formatToParts(
      now,
    );

  const byType =
    new Map(
      parts.map(
        (part) => [
          part.type,
          part.value,
        ],
      ),
    );

  const weekdayMap:
    Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };

  return {
    date:
      `${byType.get("year") ?? "0000"}-${byType.get("month") ?? "00"}-${byType.get("day") ?? "00"}`,

    hour:
      Number(
        byType.get("hour") ??
        0,
      ),

    minute:
      Number(
        byType.get("minute") ??
        0,
      ),

    weekday:
      weekdayMap[
        byType.get("weekday") ??
        ""
      ] ?? -1,
  };
}

export function shouldRunScheduledMaintenance(
  config:
    MarketDataMaintenanceConfig,
  state:
    MarketDataMaintenanceState,
  now:
    Date = new Date(),
): {
  shouldRun: boolean;
  reason: string;
  dateKst: string;
} {
  const clock =
    getKoreanClock(
      now,
    );

  if (
    !isKrxTradingDate(clock.date)
  ) {
    return {
      shouldRun:
        false,
      reason:
        "WEEKEND",
      dateKst:
        clock.date,
    };
  }

  const nowMinutes =
    clock.hour * 60 +
    clock.minute;

  const targetMinutes =
    config.hourKst * 60 +
    config.minuteKst;

  if (
    nowMinutes <
    targetMinutes
  ) {
    return {
      shouldRun:
        false,
      reason:
        "BEFORE_DAILY_WINDOW",
      dateKst:
        clock.date,
    };
  }

  if (
    state.lastAttemptDateKst ===
    clock.date
  ) {
    return {
      shouldRun:
        false,
      reason:
        "ALREADY_ATTEMPTED_TODAY",
      dateKst:
        clock.date,
    };
  }

  if (
    state.running
  ) {
    return {
      shouldRun:
        false,
      reason:
        "RUN_ALREADY_IN_PROGRESS",
      dateKst:
        clock.date,
    };
  }

  return {
    shouldRun:
      true,
    reason:
      "DAILY_WINDOW_READY",
    dateKst:
      clock.date,
  };
}

function asRecord(
  value:
    unknown,
): Record<string, any> | null {
  if (
    typeof value ===
      "object" &&
    value !== null &&
    !Array.isArray(
      value,
    )
  ) {
    return value as
      Record<string, any>;
  }

  return null;
}

function extractIntegritySnapshot(
  payload:
    unknown,
): Record<string, any> | null {
  const root =
    asRecord(
      payload,
    );

  const result =
    asRecord(
      root?.result,
    );

  if (!result) {
    return null;
  }

  return (
    asRecord(
      result.after,
    ) ??
    asRecord(
      result.before,
    )
  );
}

export function classifyIntegrityRepairDecision(
  payload:
    unknown,
): IntegrityRepairDecision {
  const snapshot =
    extractIntegritySnapshot(
      payload,
    );

  if (!snapshot) {
    return {
      shouldRepair:
        false,
      reason:
        "NO_INTEGRITY_PAYLOAD",
      errorCount:
        0,
      repairableErrorCount:
        0,
      unsupportedIssueTypes:
        [],
    };
  }

  const issues =
    Array.isArray(
      snapshot.issues,
    )
      ? snapshot.issues
      : [];

  const errors =
    issues.filter(
      (issue:
        any) =>
        issue?.severity ===
        "ERROR",
    );

  if (
    errors.length ===
    0
  ) {
    return {
      shouldRepair:
        false,
      reason:
        "NO_ERRORS",
      errorCount:
        0,
      repairableErrorCount:
        0,
      unsupportedIssueTypes:
        [],
    };
  }

  const repairableErrors =
    errors.filter(
      (issue:
        any) =>
        issue?.repairable ===
        true,
    );

  if (
    repairableErrors.length !==
    errors.length
  ) {
    return {
      shouldRepair:
        false,
      reason:
        "NON_REPAIRABLE_ERROR_PRESENT",
      errorCount:
        errors.length,
      repairableErrorCount:
        repairableErrors.length,
      unsupportedIssueTypes:
        [],
    };
  }

  const unsupportedIssueTypes =
    [
      ...new Set(
        repairableErrors
          .map(
            (issue:
              any) =>
              String(
                issue?.issueType ??
                "",
              ),
          )
          .filter(
            (issueType:
              string) =>
              !AUTO_REPAIR_ERROR_ALLOWLIST.has(
                issueType,
              ),
          ),
      ),
    ].sort();

  if (
    unsupportedIssueTypes.length >
    0
  ) {
    return {
      shouldRepair:
        false,
      reason:
        "UNSUPPORTED_REPAIRABLE_ERROR_TYPE",
      errorCount:
        errors.length,
      repairableErrorCount:
        repairableErrors.length,
      unsupportedIssueTypes,
    };
  }

  return {
    shouldRepair:
      true,
    reason:
      "ALL_ERRORS_REPAIRABLE_AND_ALLOWLISTED",
    errorCount:
      errors.length,
    repairableErrorCount:
      repairableErrors.length,
    unsupportedIssueTypes:
      [],
  };
}

async function readResponsePayload(
  response:
    Response,
): Promise<unknown> {
  const text =
    await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(
      text,
    );
  } catch {
    return text;
  }
}

async function executeMaintenanceStep(
  fetchFn:
    FetchLike,
  config:
    MarketDataMaintenanceConfig,
  input: {
    name:
      MarketDataMaintenanceStepName;
    path:
      string;
    body:
      unknown;
  },
): Promise<MarketDataMaintenanceStepResult> {
  const started =
    Date.now();

  try {
    const headers:
      Record<string, string> = {
        "content-type":
          "application/json",

        "x-market-data-maintenance":
          "ALPHA_V3_V3_SELF_HEALING",
      };

    if (
      config.automationSecret
    ) {
      headers[
        "x-automation-secret"
      ] =
        config.automationSecret;
    }

    const response =
      await fetchFn(
        config.baseUrl +
          input.path,
        {
          method:
            "POST",
          headers,
          body:
            JSON.stringify(
              input.body,
            ),
        },
      );

    const payload =
      await readResponsePayload(
        response,
      );

    return {
      name:
        input.name,
      path:
        input.path,
      ok:
        response.ok,
      status:
        response.status,
      payload,
      error:
        response.ok
          ? null
          : `HTTP_${response.status}`,
      durationMs:
        Date.now() -
        started,
      requestBody:
        input.body,
    };
  } catch (error) {
    return {
      name:
        input.name,
      path:
        input.path,
      ok:
        false,
      status:
        null,
      payload:
        null,
      error:
        error instanceof Error
          ? error.message
          : String(error),
      durationMs:
        Date.now() -
        started,
      requestBody:
        input.body,
    };
  }
}

export async function runMarketDataMaintenanceOnce(
  config:
    MarketDataMaintenanceConfig =
      resolveMarketDataMaintenanceConfig(),
  dependencies:
    {
      fetchFn?:
        FetchLike;
      now?:
        Date;
    } = {},
): Promise<MarketDataMaintenanceRunResult> {
  const fetchFn =
    dependencies.fetchFn ??
    fetch;

  const now =
    dependencies.now ??
    new Date();

  const startedAt =
    now.toISOString();

  const runDateKst =
    getKoreanClock(
      now,
    ).date;

  const steps:
    MarketDataMaintenanceStepResult[] =
      [];

  steps.push(
    await executeMaintenanceStep(
      fetchFn,
      config,
      {
        name:
          "EOD_SYNC",
        path:
          "/api/market/regime/v7/eod-sync",
        body:
          {},
      },
    ),
  );

  steps.push(
    await executeMaintenanceStep(
      fetchFn,
      config,
      {
        name:
          "FRESHNESS_CAPTURE",
        path:
          "/api/market/regime/v7/freshness/capture",
        body:
          {},
      },
    ),
  );

  const initialIntegrity =
    await executeMaintenanceStep(
      fetchFn,
      config,
      {
        name:
          "INTEGRITY_SCAN",
        path:
          "/api/market/regime/v7/integrity",
        body: {
          windowCalendarDays:
            INTEGRITY_WINDOW_CALENDAR_DAYS,
          repair:
            false,
        },
      },
    );

  steps.push(
    initialIntegrity,
  );

  const repairDecision =
    initialIntegrity.ok
      ? classifyIntegrityRepairDecision(
          initialIntegrity.payload,
        )
      : null;

  let repairAttempted =
    false;

  let verificationPerformed =
    false;

  if (
    repairDecision
      ?.shouldRepair ===
    true
  ) {
    repairAttempted =
      true;

    steps.push(
      await executeMaintenanceStep(
        fetchFn,
        config,
        {
          name:
            "INTEGRITY_REPAIR",
          path:
            "/api/market/regime/v7/integrity",
          body: {
            windowCalendarDays:
              INTEGRITY_WINDOW_CALENDAR_DAYS,
            repair:
              true,
          },
        },
      ),
    );

    verificationPerformed =
      true;

    steps.push(
      await executeMaintenanceStep(
        fetchFn,
        config,
        {
          name:
            "INTEGRITY_VERIFY",
          path:
            "/api/market/regime/v7/integrity",
          body: {
            windowCalendarDays:
              INTEGRITY_WINDOW_CALENDAR_DAYS,
            repair:
              false,
          },
        },
      ),
    );
  }

  steps.push(
    await executeMaintenanceStep(
      fetchFn,
      config,
      {
        name:
          "QUALITY_GATE_CAPTURE",
        path:
          "/api/market/regime/v7/quality-gate/capture",
        body:
          {},
      },
    ),
  );

  const finishedAt =
    new Date().toISOString();

  return {
    version:
      MARKET_DATA_MAINTENANCE_VERSION,

    runDateKst,

    startedAt,

    finishedAt,

    success:
      steps.every(
        (step) =>
          step.ok,
      ),

    steps,

    selfHealing: {
      evaluated:
        initialIntegrity.ok,

      repairAttempted,

      repairDecision,

      verificationPerformed,
    },

    safety: {
      autoOrder:
        false,

      productionOrderEndpointCalled:
        false,

      purpose:
        "MARKET_DATA_MAINTENANCE_ONLY",

      automaticRepairScope:
        "ALLOWLISTED_REPAIRABLE_INTEGRITY_ERRORS_ONLY",

      warningOnlyAutoRepair:
        false,

      extremeReturnAutoRepair:
        false,
    },
  };
}

export async function runMarketDataMaintenanceSchedulerTick(
  config:
    MarketDataMaintenanceConfig,
  state:
    MarketDataMaintenanceState,
  dependencies:
    {
      fetchFn?:
        FetchLike;
      now?:
        Date;
    } = {},
): Promise<{
  ran: boolean;
  reason: string;
  result:
    MarketDataMaintenanceRunResult | null;
}> {
  const now =
    dependencies.now ??
    new Date();

  const decision =
    shouldRunScheduledMaintenance(
      config,
      state,
      now,
    );

  if (!decision.shouldRun) {
    return {
      ran:
        false,
      reason:
        decision.reason,
      result:
        null,
    };
  }

  state.running =
    true;

  state.lastAttemptDateKst =
    decision.dateKst;

  try {
    const result =
      await runMarketDataMaintenanceOnce(
        config,
        {
          ...dependencies,
          now,
        },
      );

    return {
      ran:
        true,

      reason:
        result.success
          ? "DAILY_MAINTENANCE_COMPLETE"
          : "DAILY_MAINTENANCE_PARTIAL_FAILURE",

      result,
    };
  } finally {
    state.running =
      false;
  }
}

function logJson(
  value:
    unknown,
) {
  console.log(
    JSON.stringify(
      value,
      null,
      2,
    ),
  );
}

export async function startMarketDataMaintenanceScheduler() {
  const config =
    resolveMarketDataMaintenanceConfig();

  const state =
    createMarketDataMaintenanceState();

  logJson({
    status:
      "ALPHA_V3_MARKET_DATA_MAINTENANCE_SCHEDULER_V3_SELF_HEALING_STARTED",

    config: {
      baseUrl:
        config.baseUrl,

      hourKst:
        config.hourKst,

      minuteKst:
        config.minuteKst,

      pollMs:
        config.pollMs,

      automationSecretConfigured:
        Boolean(
          config.automationSecret,
        ),
    },

    policy: {
      integrityWindowCalendarDays:
        INTEGRITY_WINDOW_CALENDAR_DAYS,

      autoRepairErrorAllowlist: [
        ...AUTO_REPAIR_ERROR_ALLOWLIST,
      ],

      warningsAutoRepaired:
        false,

      extremeReturnsAutoRepaired:
        false,
    },

    safety: {
      autoOrder:
        false,

      productionOrderEndpointCalled:
        false,
    },
  });

  const tick =
    async () => {
      const outcome =
        await runMarketDataMaintenanceSchedulerTick(
          config,
          state,
        );

      if (
        outcome.ran
      ) {
        logJson({
          status:
            outcome.result
              ?.success
              ? "ALPHA_V3_MARKET_DATA_MAINTENANCE_DAILY_RUN_V3_COMPLETE"
              : "ALPHA_V3_MARKET_DATA_MAINTENANCE_DAILY_RUN_V3_PARTIAL_FAILURE",

          reason:
            outcome.reason,

          result:
            outcome.result,
        });
      }
    };

  await tick();

  setInterval(
    () => {
      tick().catch(
        (error) => {
          logJson({
            status:
              "ALPHA_V3_MARKET_DATA_MAINTENANCE_SCHEDULER_V3_TICK_FATAL",

            error:
              error instanceof Error
                ? error.message
                : String(error),
          });
        },
      );
    },
    config.pollMs,
  );
}

export async function runOnceFromCli() {
  const result =
    await runMarketDataMaintenanceOnce(
      resolveMarketDataMaintenanceConfig(),
    );

  logJson({
    status:
      result.success
        ? "ALPHA_V3_MARKET_DATA_MAINTENANCE_ONCE_V3_COMPLETE"
        : "ALPHA_V3_MARKET_DATA_MAINTENANCE_ONCE_V3_PARTIAL_FAILURE",

    result,
  });

  if (!result.success) {
    process.exitCode =
      2;
  }
}

if (
  require.main ===
  module
) {
  (
    process.argv.includes(
      "--once",
    )
      ? runOnceFromCli()
      : startMarketDataMaintenanceScheduler()
  ).catch(
    (error) => {
      logJson({
        status:
          "ALPHA_V3_MARKET_DATA_MAINTENANCE_SCHEDULER_V3_FATAL",

        error:
          error instanceof Error
            ? error.message
            : String(error),

        safety: {
          autoOrder:
            false,

          productionOrderEndpointCalled:
            false,
        },
      });

      process.exitCode =
        2;
    },
  );
}
