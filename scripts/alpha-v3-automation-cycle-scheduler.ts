import { runTrueForwardOosAutomationBindingV1 } from "../lib/research/run-true-forward-oos-automation-binding-v1";
export const AUTOMATION_SCHEDULER_CADENCE_MS =
  60_000;

export interface AutomationSchedulerConfig {
  baseUrl: string;
  secret: string;
  triggerType: string;
  cadenceMs: number;
}

export interface AutomationSchedulerEvent {
  type:
    | "START"
    | "SUCCESS"
    | "FAILURE"
    | "SKIPPED_OVERLAP"
    | "STOP";
  at: string;
  detail?: unknown;
}

export interface AutomationSchedulerState {
  running: boolean;
  stopping: boolean;
  tickCount: number;
  successCount: number;
  failureCount: number;
  skippedOverlapCount: number;
}

export interface RunTickOptions {
  fetchImpl?: typeof fetch;
  now?: () => Date;
  onEvent?: (
    event: AutomationSchedulerEvent,
  ) => void;
}

function normalizeBaseUrl(
  value: string,
) {
  return value
    .trim()
    .replace(/\/+$/, "");
}

export function resolveAutomationSchedulerConfig(
  env:
    NodeJS.ProcessEnv =
    process.env,
): AutomationSchedulerConfig {
  const baseUrl =
    normalizeBaseUrl(
      env.AI_STOCK_LAB_BASE_URL ??
        "http://localhost:3000",
    );

  const secret =
    env
      .TRADING_AUTOMATION_SECRET
      ?.trim() ??
    "";

  if (!secret) {
    throw new Error(
      "TRADING_AUTOMATION_SECRET_REQUIRED_FOR_SCHEDULER",
    );
  }

  const triggerType =
    (
      env
        .AUTOMATION_CYCLE_TRIGGER_TYPE ??
      "SCHEDULED"
    )
      .trim() ||
    "SCHEDULED";

  const cadenceRaw =
    Number(
      env
        .AUTOMATION_CYCLE_CADENCE_MS ??
      AUTOMATION_SCHEDULER_CADENCE_MS,
    );

  if (
    !Number.isFinite(
      cadenceRaw,
    ) ||
    cadenceRaw < 60_000
  ) {
    throw new Error(
      "AUTOMATION_CYCLE_CADENCE_MS_MUST_BE_AT_LEAST_60000",
    );
  }

  return {
    baseUrl,
    secret,
    triggerType,
    cadenceMs:
      Math.floor(
        cadenceRaw,
      ),
  };
}

export function createAutomationSchedulerState():
  AutomationSchedulerState {
  return {
    running: false,
    stopping: false,
    tickCount: 0,
    successCount: 0,
    failureCount: 0,
    skippedOverlapCount: 0,
  };
}

export async function runAutomationSchedulerTick(
  config: AutomationSchedulerConfig,
  state: AutomationSchedulerState,
  options:
    RunTickOptions =
    {},
) {

  /* ALPHA_V3_TRUE_FORWARD_OOS_AUTOMATION_BINDING_V1_CALL */
  const __forwardOosAutomation =
    await runTrueForwardOosAutomationBindingV1(
      {
        now:
          options.now?.() ??
          new Date(),
      },
    ).catch(
      (error) => ({
        status:
          "FAILED_CLOSED",
        kstDate:
          "",
        nowKst:
          new Date().toISOString(),
        executed:
          [],
        completed:
          [],
        blockedReason:
          "FORWARD_OOS_BINDING_UNHANDLED:" +
          String(
            error instanceof Error
              ? error.message
              : error,
          ),
      }),
    );

  if (
    __forwardOosAutomation.status ===
      "FAILED_CLOSED"
  ) {
    console.error(
      JSON.stringify(
        {
          status:
            "FORWARD_OOS_AUTOMATION_FAILED_CLOSED",
          blockedReason:
            __forwardOosAutomation.blockedReason,
        },
      ),
    );
  }

  const fetchImpl =
    options.fetchImpl ??
    globalThis.fetch;

  const now =
    options.now ??
    (() => new Date());

  const onEvent =
    options.onEvent ??
    (() => {});

  if (
    state.stopping
  ) {
    return {
      ok: false as const,
      skipped: true as const,
      reason:
        "STOPPING",
    };
  }

  if (
    state.running
  ) {
    state
      .skippedOverlapCount +=
      1;

    onEvent({
      type:
        "SKIPPED_OVERLAP",

      at:
        now()
          .toISOString(),

      detail: {
        tickCount:
          state.tickCount,

        skippedOverlapCount:
          state
            .skippedOverlapCount,
      },
    });

    return {
      ok: false as const,
      skipped: true as const,
      reason:
        "OVERLAP",
    };
  }

  state.running =
    true;

  state.tickCount +=
    1;

  const tickNumber =
    state.tickCount;

  const startedAt =
    now();

  onEvent({
    type: "START",
    at:
      startedAt
        .toISOString(),
    detail: {
      tickNumber,
      cadenceMs:
        config.cadenceMs,
    },
  });

  try {
    const response =
      await fetchImpl(
        `${config.baseUrl}/api/trading/automation/cycle`,
        {
          method:
            "POST",

          headers: {
            "content-type":
              "application/json",

            "x-automation-secret":
              config.secret,
          },

          body:
            JSON.stringify({
              triggerType:
                config.triggerType,

              scheduler: {
                cadenceSeconds:
                  Math.round(
                    config.cadenceMs /
                    1000,
                  ),

                tickNumber,
              },
            }),

          cache:
            "no-store",
        },
      );

    const responseText =
      await response.text();

    let payload:
      unknown =
      null;

    if (
      responseText.trim()
    ) {
      try {
        payload =
          JSON.parse(
            responseText,
          );
      } catch {
        payload =
          responseText;
      }
    }

    if (!response.ok) {
      state.failureCount +=
        1;

      const result = {
        ok: false as const,
        skipped:
          false as const,

        tickNumber,

        status:
          response.status,

        payload,
      };

      onEvent({
        type:
          "FAILURE",

        at:
          now()
            .toISOString(),

        detail:
          result,
      });

      return result;
    }

    state.successCount +=
      1;

    const result = {
      ok: true as const,
      skipped:
        false as const,

      tickNumber,

      status:
        response.status,

      payload,
    };

    onEvent({
      type:
        "SUCCESS",

      at:
        now()
          .toISOString(),

      detail:
        result,
    });

    return result;
  } catch (error) {
    state.failureCount +=
      1;

    const result = {
      ok: false as const,
      skipped:
        false as const,

      tickNumber,

      status:
        null,

      error:
        error instanceof Error
          ? error.message
          : String(
              error,
            ),
    };

    onEvent({
      type:
        "FAILURE",

      at:
        now()
          .toISOString(),

      detail:
        result,
    });

    return result;
  } finally {
    state.running =
      false;
  }
}

function defaultEventLogger(
  event:
    AutomationSchedulerEvent,
) {
  console.log(
    JSON.stringify(
      {
        scheduler:
          "ALPHA_V3_60S_AUTOMATION_CYCLE",

        ...event,
      },
      null,
      2,
    ),
  );
}

export async function startAutomationCycleScheduler(
  config:
    AutomationSchedulerConfig =
    resolveAutomationSchedulerConfig(),
) {
  const state =
    createAutomationSchedulerState();

  const onEvent =
    defaultEventLogger;

  const tick =
    async () =>
      runAutomationSchedulerTick(
        config,
        state,
        {
          onEvent,
        },
      );

  /*
   * Run once immediately, then every 60s.
   * The state-level single-flight guard prevents overlapping cycles.
   */
  void tick();

  const timer =
    setInterval(
      () => {
        void tick();
      },
      config.cadenceMs,
    );

  const stop =
    (
      signal:
        "SIGINT" |
        "SIGTERM",
    ) => {
      if (
        state.stopping
      ) {
        return;
      }

      state.stopping =
        true;

      clearInterval(
        timer,
      );

      onEvent({
        type:
          "STOP",

        at:
          new Date()
            .toISOString(),

        detail: {
          signal,

          tickCount:
            state.tickCount,

          successCount:
            state
              .successCount,

          failureCount:
            state
              .failureCount,

          skippedOverlapCount:
            state
              .skippedOverlapCount,

          inFlight:
            state.running,
        },
      });
    };

  process.once(
    "SIGINT",
    () => stop(
      "SIGINT",
    ),
  );

  process.once(
    "SIGTERM",
    () => stop(
      "SIGTERM",
    ),
  );

  return {
    state,
    timer,
    stop,
  };
}

async function runOnce() {
  const config =
    resolveAutomationSchedulerConfig();

  const state =
    createAutomationSchedulerState();

  const result =
    await runAutomationSchedulerTick(
      config,
      state,
      {
        onEvent:
          defaultEventLogger,
      },
    );

  if (!result.ok) {
    process.exitCode =
      2;
  }
}


function reportSchedulerFatal(
  error: unknown,
) {
  console.error(
    JSON.stringify(
      {
        scheduler:
          "ALPHA_V3_60S_AUTOMATION_CYCLE",

        type:
          "FATAL",

        at:
          new Date()
            .toISOString(),

        error:
          error instanceof Error
            ? error.message
            : String(
                error,
              ),
      },
      null,
      2,
    ),
  );

  process.exitCode =
    2;
}

if (
  typeof require !==
    "undefined" &&
  typeof module !==
    "undefined" &&
  require.main ===
    module
) {
  if (
    process.argv.includes(
      "--once",
    )
  ) {
    void runOnce()
      .catch(
        reportSchedulerFatal,
      );
  } else {
    void startAutomationCycleScheduler()
      .catch(
        reportSchedulerFatal,
      );
  }
}
