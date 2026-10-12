const fs = require("fs");
const path = require("path");

const root = process.cwd();

const outputs = [
  {
    rel:
      "scripts/alpha-v3-market-data-maintenance-scheduler.ts",
    text:
      "type FetchLike = (\n  input: string | URL,\n  init?: RequestInit,\n) => Promise<Response>;\n\nexport interface MarketDataMaintenanceConfig {\n  baseUrl:\n    string;\n\n  hourKst:\n    number;\n\n  minuteKst:\n    number;\n\n  pollMs:\n    number;\n\n  automationSecret:\n    string | null;\n}\n\nexport interface MarketDataMaintenanceState {\n  lastAttemptDateKst:\n    string | null;\n\n  running:\n    boolean;\n}\n\nexport interface MarketDataMaintenanceStepResult {\n  name:\n    \"EOD_SYNC\" |\n    \"FRESHNESS_CAPTURE\" |\n    \"QUALITY_GATE_CAPTURE\";\n\n  path:\n    string;\n\n  ok:\n    boolean;\n\n  status:\n    number | null;\n\n  payload:\n    unknown;\n\n  error:\n    string | null;\n\n  durationMs:\n    number;\n}\n\nexport interface MarketDataMaintenanceRunResult {\n  version:\n    \"ALPHA_V3_MARKET_DATA_MAINTENANCE_SCHEDULER_V1\";\n\n  runDateKst:\n    string;\n\n  startedAt:\n    string;\n\n  finishedAt:\n    string;\n\n  success:\n    boolean;\n\n  steps:\n    MarketDataMaintenanceStepResult[];\n\n  safety: {\n    autoOrder:\n      false;\n\n    productionOrderEndpointCalled:\n      false;\n\n    purpose:\n      \"MARKET_DATA_MAINTENANCE_ONLY\";\n  };\n}\n\nexport const MARKET_DATA_MAINTENANCE_VERSION =\n  \"ALPHA_V3_MARKET_DATA_MAINTENANCE_SCHEDULER_V1\" as const;\n\nconst DEFAULT_BASE_URL =\n  \"http://localhost:3000\";\n\nconst DEFAULT_HOUR_KST =\n  16;\n\nconst DEFAULT_MINUTE_KST =\n  20;\n\nconst DEFAULT_POLL_MS =\n  60_000;\n\nconst STEP_DEFINITIONS = [\n  {\n    name:\n      \"EOD_SYNC\" as const,\n\n    path:\n      \"/api/market/regime/v7/eod-sync\",\n\n    body:\n      {},\n  },\n  {\n    name:\n      \"FRESHNESS_CAPTURE\" as const,\n\n    path:\n      \"/api/market/regime/v7/freshness/capture\",\n\n    body:\n      {},\n  },\n  {\n    name:\n      \"QUALITY_GATE_CAPTURE\" as const,\n\n    path:\n      \"/api/market/regime/v7/quality-gate/capture\",\n\n    body:\n      {},\n  },\n];\n\nfunction finiteInt(\n  value:\n    string | undefined,\n  fallback:\n    number,\n  min:\n    number,\n  max:\n    number,\n): number {\n  const parsed =\n    Number(value);\n\n  if (\n    !Number.isFinite(parsed)\n  ) {\n    return fallback;\n  }\n\n  const integer =\n    Math.trunc(parsed);\n\n  return Math.min(\n    max,\n    Math.max(\n      min,\n      integer,\n    ),\n  );\n}\n\nexport function normalizeBaseUrl(\n  value:\n    string,\n): string {\n  return value\n    .trim()\n    .replace(/\\/+$/, \"\");\n}\n\nexport function resolveMarketDataMaintenanceConfig(\n  env:\n    NodeJS.ProcessEnv =\n      process.env,\n): MarketDataMaintenanceConfig {\n  const baseUrl =\n    normalizeBaseUrl(\n      env.MARKET_DATA_MAINTENANCE_BASE_URL ??\n      env.TRADING_AUTOMATION_BASE_URL ??\n      DEFAULT_BASE_URL,\n    );\n\n  const hourKst =\n    finiteInt(\n      env.MARKET_DATA_MAINTENANCE_HOUR_KST,\n      DEFAULT_HOUR_KST,\n      0,\n      23,\n    );\n\n  const minuteKst =\n    finiteInt(\n      env.MARKET_DATA_MAINTENANCE_MINUTE_KST,\n      DEFAULT_MINUTE_KST,\n      0,\n      59,\n    );\n\n  const pollMs =\n    finiteInt(\n      env.MARKET_DATA_MAINTENANCE_POLL_MS,\n      DEFAULT_POLL_MS,\n      10_000,\n      3_600_000,\n    );\n\n  const automationSecret =\n    String(\n      env.TRADING_AUTOMATION_SECRET ??\n      \"\",\n    ).trim() || null;\n\n  return {\n    baseUrl,\n    hourKst,\n    minuteKst,\n    pollMs,\n    automationSecret,\n  };\n}\n\nexport function createMarketDataMaintenanceState():\n  MarketDataMaintenanceState {\n  return {\n    lastAttemptDateKst:\n      null,\n\n    running:\n      false,\n  };\n}\n\nexport function getKoreanClock(\n  now:\n    Date = new Date(),\n): {\n  date:\n    string;\n\n  hour:\n    number;\n\n  minute:\n    number;\n\n  weekday:\n    number;\n} {\n  const parts =\n    new Intl.DateTimeFormat(\n      \"en-US\",\n      {\n        timeZone:\n          \"Asia/Seoul\",\n\n        year:\n          \"numeric\",\n\n        month:\n          \"2-digit\",\n\n        day:\n          \"2-digit\",\n\n        hour:\n          \"2-digit\",\n\n        minute:\n          \"2-digit\",\n\n        weekday:\n          \"short\",\n\n        hourCycle:\n          \"h23\",\n      },\n    ).formatToParts(\n      now,\n    );\n\n  const byType =\n    new Map(\n      parts.map(\n        (part) => [\n          part.type,\n          part.value,\n        ],\n      ),\n    );\n\n  const year =\n    byType.get(\"year\") ??\n    \"0000\";\n\n  const month =\n    byType.get(\"month\") ??\n    \"00\";\n\n  const day =\n    byType.get(\"day\") ??\n    \"00\";\n\n  const weekdayText =\n    byType.get(\"weekday\") ??\n    \"\";\n\n  const weekdayMap:\n    Record<string, number> = {\n      Sun: 0,\n      Mon: 1,\n      Tue: 2,\n      Wed: 3,\n      Thu: 4,\n      Fri: 5,\n      Sat: 6,\n    };\n\n  return {\n    date:\n      `${year}-${month}-${day}`,\n\n    hour:\n      Number(\n        byType.get(\"hour\") ??\n        0,\n      ),\n\n    minute:\n      Number(\n        byType.get(\"minute\") ??\n        0,\n      ),\n\n    weekday:\n      weekdayMap[\n        weekdayText\n      ] ?? -1,\n  };\n}\n\nexport function shouldRunScheduledMaintenance(\n  config:\n    MarketDataMaintenanceConfig,\n  state:\n    MarketDataMaintenanceState,\n  now:\n    Date = new Date(),\n): {\n  shouldRun:\n    boolean;\n\n  reason:\n    string;\n\n  dateKst:\n    string;\n} {\n  const clock =\n    getKoreanClock(\n      now,\n    );\n\n  if (\n    clock.weekday === 0 ||\n    clock.weekday === 6\n  ) {\n    return {\n      shouldRun:\n        false,\n\n      reason:\n        \"WEEKEND\",\n\n      dateKst:\n        clock.date,\n    };\n  }\n\n  const nowMinutes =\n    clock.hour * 60 +\n    clock.minute;\n\n  const targetMinutes =\n    config.hourKst * 60 +\n    config.minuteKst;\n\n  if (\n    nowMinutes <\n    targetMinutes\n  ) {\n    return {\n      shouldRun:\n        false,\n\n      reason:\n        \"BEFORE_DAILY_WINDOW\",\n\n      dateKst:\n        clock.date,\n    };\n  }\n\n  if (\n    state.lastAttemptDateKst ===\n    clock.date\n  ) {\n    return {\n      shouldRun:\n        false,\n\n      reason:\n        \"ALREADY_ATTEMPTED_TODAY\",\n\n      dateKst:\n        clock.date,\n    };\n  }\n\n  if (\n    state.running\n  ) {\n    return {\n      shouldRun:\n        false,\n\n      reason:\n        \"RUN_ALREADY_IN_PROGRESS\",\n\n      dateKst:\n        clock.date,\n    };\n  }\n\n  return {\n    shouldRun:\n      true,\n\n    reason:\n      \"DAILY_WINDOW_READY\",\n\n    dateKst:\n      clock.date,\n  };\n}\n\nasync function readResponsePayload(\n  response:\n    Response,\n): Promise<unknown> {\n  const text =\n    await response.text();\n\n  if (!text) {\n    return null;\n  }\n\n  try {\n    return JSON.parse(\n      text,\n    );\n  } catch {\n    return text;\n  }\n}\n\nasync function executeMaintenanceStep(\n  fetchFn:\n    FetchLike,\n  config:\n    MarketDataMaintenanceConfig,\n  step:\n    typeof STEP_DEFINITIONS[number],\n): Promise<MarketDataMaintenanceStepResult> {\n  const started =\n    Date.now();\n\n  try {\n    const headers:\n      Record<string, string> = {\n        \"content-type\":\n          \"application/json\",\n\n        \"x-market-data-maintenance\":\n          \"ALPHA_V3_V1\",\n      };\n\n    if (\n      config.automationSecret\n    ) {\n      headers[\n        \"x-automation-secret\"\n      ] =\n        config.automationSecret;\n    }\n\n    const response =\n      await fetchFn(\n        config.baseUrl +\n          step.path,\n        {\n          method:\n            \"POST\",\n\n          headers,\n\n          body:\n            JSON.stringify(\n              step.body,\n            ),\n        },\n      );\n\n    const payload =\n      await readResponsePayload(\n        response,\n      );\n\n    return {\n      name:\n        step.name,\n\n      path:\n        step.path,\n\n      ok:\n        response.ok,\n\n      status:\n        response.status,\n\n      payload,\n\n      error:\n        response.ok\n          ? null\n          : `HTTP_${response.status}`,\n\n      durationMs:\n        Date.now() -\n        started,\n    };\n  } catch (error) {\n    return {\n      name:\n        step.name,\n\n      path:\n        step.path,\n\n      ok:\n        false,\n\n      status:\n        null,\n\n      payload:\n        null,\n\n      error:\n        error instanceof Error\n          ? error.message\n          : String(error),\n\n      durationMs:\n        Date.now() -\n        started,\n    };\n  }\n}\n\nexport async function runMarketDataMaintenanceOnce(\n  config:\n    MarketDataMaintenanceConfig =\n      resolveMarketDataMaintenanceConfig(),\n  dependencies:\n    {\n      fetchFn?:\n        FetchLike;\n\n      now?:\n        Date;\n    } = {},\n): Promise<MarketDataMaintenanceRunResult> {\n  const fetchFn =\n    dependencies.fetchFn ??\n    fetch;\n\n  const now =\n    dependencies.now ??\n    new Date();\n\n  const startedAt =\n    now.toISOString();\n\n  const runDateKst =\n    getKoreanClock(\n      now,\n    ).date;\n\n  const steps:\n    MarketDataMaintenanceStepResult[] =\n      [];\n\n  for (\n    const step of\n      STEP_DEFINITIONS\n  ) {\n    steps.push(\n      await executeMaintenanceStep(\n        fetchFn,\n        config,\n        step,\n      ),\n    );\n  }\n\n  const finishedAt =\n    new Date().toISOString();\n\n  return {\n    version:\n      MARKET_DATA_MAINTENANCE_VERSION,\n\n    runDateKst,\n\n    startedAt,\n\n    finishedAt,\n\n    success:\n      steps.every(\n        (step) =>\n          step.ok,\n      ),\n\n    steps,\n\n    safety: {\n      autoOrder:\n        false,\n\n      productionOrderEndpointCalled:\n        false,\n\n      purpose:\n        \"MARKET_DATA_MAINTENANCE_ONLY\",\n    },\n  };\n}\n\nexport async function runMarketDataMaintenanceSchedulerTick(\n  config:\n    MarketDataMaintenanceConfig,\n  state:\n    MarketDataMaintenanceState,\n  dependencies:\n    {\n      fetchFn?:\n        FetchLike;\n\n      now?:\n        Date;\n    } = {},\n): Promise<{\n  ran:\n    boolean;\n\n  reason:\n    string;\n\n  result:\n    MarketDataMaintenanceRunResult | null;\n}> {\n  const now =\n    dependencies.now ??\n    new Date();\n\n  const decision =\n    shouldRunScheduledMaintenance(\n      config,\n      state,\n      now,\n    );\n\n  if (\n    !decision.shouldRun\n  ) {\n    return {\n      ran:\n        false,\n\n      reason:\n        decision.reason,\n\n      result:\n        null,\n    };\n  }\n\n  state.running =\n    true;\n\n  /*\n   * Mark the KST date before network calls.\n   * This prevents rapid retry storms on provider/API failure.\n   * Manual --once remains available for an explicit retry.\n   */\n  state.lastAttemptDateKst =\n    decision.dateKst;\n\n  try {\n    const result =\n      await runMarketDataMaintenanceOnce(\n        config,\n        {\n          ...dependencies,\n          now,\n        },\n      );\n\n    return {\n      ran:\n        true,\n\n      reason:\n        result.success\n          ? \"DAILY_MAINTENANCE_COMPLETE\"\n          : \"DAILY_MAINTENANCE_PARTIAL_FAILURE\",\n\n      result,\n    };\n  } finally {\n    state.running =\n      false;\n  }\n}\n\nfunction logJson(\n  value:\n    unknown,\n) {\n  console.log(\n    JSON.stringify(\n      value,\n      null,\n      2,\n    ),\n  );\n}\n\nexport async function startMarketDataMaintenanceScheduler() {\n  const config =\n    resolveMarketDataMaintenanceConfig();\n\n  const state =\n    createMarketDataMaintenanceState();\n\n  logJson({\n    status:\n      \"ALPHA_V3_MARKET_DATA_MAINTENANCE_SCHEDULER_V1_STARTED\",\n\n    config: {\n      baseUrl:\n        config.baseUrl,\n\n      hourKst:\n        config.hourKst,\n\n      minuteKst:\n        config.minuteKst,\n\n      pollMs:\n        config.pollMs,\n\n      automationSecretConfigured:\n        Boolean(\n          config.automationSecret,\n        ),\n    },\n\n    sequence:\n      STEP_DEFINITIONS.map(\n        (step) =>\n          step.path,\n      ),\n\n    safety: {\n      autoOrder:\n        false,\n\n      productionOrderEndpointCalled:\n        false,\n    },\n  });\n\n  const tick =\n    async () => {\n      const outcome =\n        await runMarketDataMaintenanceSchedulerTick(\n          config,\n          state,\n        );\n\n      if (\n        outcome.ran\n      ) {\n        logJson({\n          status:\n            outcome.result\n              ?.success\n              ? \"ALPHA_V3_MARKET_DATA_MAINTENANCE_DAILY_RUN_COMPLETE\"\n              : \"ALPHA_V3_MARKET_DATA_MAINTENANCE_DAILY_RUN_PARTIAL_FAILURE\",\n\n          reason:\n            outcome.reason,\n\n          result:\n            outcome.result,\n        });\n      }\n    };\n\n  await tick();\n\n  setInterval(\n    () => {\n      tick().catch(\n        (error) => {\n          logJson({\n            status:\n              \"ALPHA_V3_MARKET_DATA_MAINTENANCE_SCHEDULER_V1_TICK_FATAL\",\n\n            error:\n              error instanceof Error\n                ? error.message\n                : String(error),\n          });\n        },\n      );\n    },\n    config.pollMs,\n  );\n}\n\nexport async function runOnceFromCli() {\n  const config =\n    resolveMarketDataMaintenanceConfig();\n\n  const result =\n    await runMarketDataMaintenanceOnce(\n      config,\n    );\n\n  logJson({\n    status:\n      result.success\n        ? \"ALPHA_V3_MARKET_DATA_MAINTENANCE_ONCE_V1_COMPLETE\"\n        : \"ALPHA_V3_MARKET_DATA_MAINTENANCE_ONCE_V1_PARTIAL_FAILURE\",\n\n    result,\n  });\n\n  if (\n    !result.success\n  ) {\n    process.exitCode =\n      2;\n  }\n}\n\nif (\n  require.main ===\n  module\n) {\n  const once =\n    process.argv.includes(\n      \"--once\",\n    );\n\n  (\n    once\n      ? runOnceFromCli()\n      : startMarketDataMaintenanceScheduler()\n  ).catch(\n    (error) => {\n      logJson({\n        status:\n          \"ALPHA_V3_MARKET_DATA_MAINTENANCE_SCHEDULER_V1_FATAL\",\n\n        error:\n          error instanceof Error\n            ? error.message\n            : String(error),\n\n        safety: {\n          autoOrder:\n            false,\n\n          productionOrderEndpointCalled:\n            false,\n        },\n      });\n\n      process.exitCode =\n        2;\n    },\n  );\n}\n"
  },
  {
    rel:
      "scripts/alpha-v3-market-data-maintenance-scheduler-contract-test.ts",
    text:
      "import assert from \"node:assert/strict\";\n\nimport {\n  createMarketDataMaintenanceState,\n  resolveMarketDataMaintenanceConfig,\n  runMarketDataMaintenanceOnce,\n  runMarketDataMaintenanceSchedulerTick,\n  shouldRunScheduledMaintenance,\n} from \"./alpha-v3-market-data-maintenance-scheduler\";\n\nfunction response(\n  status:\n    number,\n  payload:\n    unknown,\n): Response {\n  return new Response(\n    JSON.stringify(\n      payload,\n    ),\n    {\n      status,\n      headers: {\n        \"content-type\":\n          \"application/json\",\n      },\n    },\n  );\n}\n\nasync function main() {\n  const config =\n    resolveMarketDataMaintenanceConfig(\n      {\n        MARKET_DATA_MAINTENANCE_BASE_URL:\n          \"http://localhost:3000/\",\n\n        MARKET_DATA_MAINTENANCE_HOUR_KST:\n          \"16\",\n\n        MARKET_DATA_MAINTENANCE_MINUTE_KST:\n          \"20\",\n\n        MARKET_DATA_MAINTENANCE_POLL_MS:\n          \"60000\",\n\n        TRADING_AUTOMATION_SECRET:\n          \"test-secret\",\n      },\n    );\n\n  const checks:\n    Record<string, boolean> = {};\n\n  checks.normalizedBaseUrl =\n    config.baseUrl ===\n      \"http://localhost:3000\";\n\n  checks.scheduleConfig =\n    config.hourKst === 16 &&\n    config.minuteKst === 20 &&\n    config.pollMs === 60000;\n\n  const state =\n    createMarketDataMaintenanceState();\n\n  const beforeWindow =\n    shouldRunScheduledMaintenance(\n      config,\n      state,\n      new Date(\n        \"2026-10-08T07:19:00.000Z\",\n      ),\n    );\n\n  checks.beforeWindowSkipped =\n    beforeWindow.shouldRun ===\n      false &&\n    beforeWindow.reason ===\n      \"BEFORE_DAILY_WINDOW\";\n\n  const atWindow =\n    shouldRunScheduledMaintenance(\n      config,\n      state,\n      new Date(\n        \"2026-10-08T07:20:00.000Z\",\n      ),\n    );\n\n  checks.atWindowRuns =\n    atWindow.shouldRun ===\n      true &&\n    atWindow.dateKst ===\n      \"2026-10-08\";\n\n  const calls:\n    Array<{\n      url:\n        string;\n\n      method:\n        string | undefined;\n\n      body:\n        string | undefined;\n\n      secret:\n        string | null;\n    }> = [];\n\n  const successFetch =\n    async (\n      input:\n        string | URL,\n      init?:\n        RequestInit,\n    ) => {\n      const headers =\n        new Headers(\n          init?.headers,\n        );\n\n      calls.push({\n        url:\n          String(input),\n\n        method:\n          init?.method,\n\n        body:\n          typeof init?.body ===\n            \"string\"\n            ? init.body\n            : undefined,\n\n        secret:\n          headers.get(\n            \"x-automation-secret\",\n          ),\n      });\n\n      return response(\n        200,\n        {\n          ok: true,\n        },\n      );\n    };\n\n  const once =\n    await runMarketDataMaintenanceOnce(\n      config,\n      {\n        fetchFn:\n          successFetch,\n\n        now:\n          new Date(\n            \"2026-10-08T07:20:00.000Z\",\n          ),\n      },\n    );\n\n  checks.onceSuccess =\n    once.success ===\n      true;\n\n  checks.exactThreeStepOrder =\n    calls.length === 3 &&\n    calls[0]?.url.endsWith(\n      \"/api/market/regime/v7/eod-sync\",\n    ) &&\n    calls[1]?.url.endsWith(\n      \"/api/market/regime/v7/freshness/capture\",\n    ) &&\n    calls[2]?.url.endsWith(\n      \"/api/market/regime/v7/quality-gate/capture\",\n    );\n\n  checks.postEmptyJsonBody =\n    calls.every(\n      (call) =>\n        call.method === \"POST\" &&\n        call.body === \"{}\",\n    );\n\n  checks.secretForwarded =\n    calls.every(\n      (call) =>\n        call.secret ===\n          \"test-secret\",\n    );\n\n  const scheduledState =\n    createMarketDataMaintenanceState();\n\n  let scheduledCalls =\n    0;\n\n  const scheduledFetch =\n    async () => {\n      scheduledCalls +=\n        1;\n\n      return response(\n        200,\n        {\n          ok: true,\n        },\n      );\n    };\n\n  const firstTick =\n    await runMarketDataMaintenanceSchedulerTick(\n      config,\n      scheduledState,\n      {\n        fetchFn:\n          scheduledFetch,\n\n        now:\n          new Date(\n            \"2026-10-08T07:20:00.000Z\",\n          ),\n      },\n    );\n\n  const secondTick =\n    await runMarketDataMaintenanceSchedulerTick(\n      config,\n      scheduledState,\n      {\n        fetchFn:\n          scheduledFetch,\n\n        now:\n          new Date(\n            \"2026-10-08T08:20:00.000Z\",\n          ),\n      },\n    );\n\n  checks.oncePerKstDate =\n    firstTick.ran ===\n      true &&\n    secondTick.ran ===\n      false &&\n    scheduledCalls ===\n      3;\n\n  const failureCalls:\n    string[] = [];\n\n  const partialFailureFetch =\n    async (\n      input:\n        string | URL,\n    ) => {\n      const url =\n        String(input);\n\n      failureCalls.push(\n        url,\n      );\n\n      if (\n        url.endsWith(\n          \"/eod-sync\",\n        )\n      ) {\n        return response(\n          500,\n          {\n            error:\n              \"synthetic eod failure\",\n          },\n        );\n      }\n\n      return response(\n        200,\n        {\n          ok: true,\n        },\n      );\n    };\n\n  const partial =\n    await runMarketDataMaintenanceOnce(\n      config,\n      {\n        fetchFn:\n          partialFailureFetch,\n\n        now:\n          new Date(\n            \"2026-10-08T07:20:00.000Z\",\n          ),\n      },\n    );\n\n  checks.captureStillRunsAfterEodFailure =\n    failureCalls.length ===\n      3;\n\n  checks.partialFailureReported =\n    partial.success ===\n      false &&\n    partial.steps[0]?.ok ===\n      false &&\n    partial.steps[1]?.ok ===\n      true &&\n    partial.steps[2]?.ok ===\n      true;\n\n  checks.noOrderEndpoint =\n    [...calls, ...failureCalls.map(\n      (url) => ({\n        url,\n        method: \"POST\",\n        body: \"{}\",\n        secret: null,\n      }),\n    )].every(\n      (call) =>\n        !call.url.includes(\n          \"/api/orders/\",\n        ) &&\n        !call.url.includes(\n          \"/api/signals/entry/\",\n        ) &&\n        !call.url.includes(\n          \"/api/trading/automation/\",\n        ),\n    );\n\n  const failed =\n    Object.entries(\n      checks,\n    )\n      .filter(\n        ([, value]) =>\n          !value,\n      )\n      .map(\n        ([key]) =>\n          key,\n      );\n\n  console.log(\n    JSON.stringify(\n      {\n        status:\n          failed.length === 0\n            ? \"ALPHA_V3_MARKET_DATA_MAINTENANCE_SCHEDULER_V1_CONTRACT_VERIFIED\"\n            : \"ALPHA_V3_MARKET_DATA_MAINTENANCE_SCHEDULER_V1_CONTRACT_REVIEW\",\n\n        checks,\n        failed,\n\n        sequence:\n          calls.map(\n            (call) =>\n              call.url,\n          ),\n\n        safety: {\n          networkCalls:\n            0,\n\n          databaseWrites:\n            0,\n\n          productionOrderEndpointCalled:\n            false,\n\n          autoOrder:\n            false,\n        },\n\n        nextGate:\n          failed.length === 0\n            ? \"TARGETED_TYPESCRIPT_THEN_MANUAL_ONCE_SMOKE\"\n            : \"REVIEW_MARKET_DATA_MAINTENANCE_SCHEDULER\",\n      },\n      null,\n      2,\n    ),\n  );\n\n  if (\n    failed.length > 0\n  ) {\n    process.exitCode =\n      2;\n  }\n}\n\nmain().catch(\n  (error) => {\n    console.error(\n      JSON.stringify(\n        {\n          status:\n            \"ALPHA_V3_MARKET_DATA_MAINTENANCE_SCHEDULER_V1_CONTRACT_FATAL\",\n\n          error:\n            error instanceof Error\n              ? error.message\n              : String(error),\n        },\n        null,\n        2,\n      ),\n    );\n\n    process.exitCode =\n      2;\n  },\n);\n"
  },
  {
    rel:
      "scripts/alpha-v3-market-data-maintenance-scheduler-v1-static-verify.cjs",
    text:
      "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nconst scheduler =\n  fs.readFileSync(\n    path.resolve(\n      root,\n      \"scripts/alpha-v3-market-data-maintenance-scheduler.ts\"\n    ),\n    \"utf8\"\n  );\n\nconst pkg =\n  JSON.parse(\n    fs.readFileSync(\n      path.resolve(\n        root,\n        \"package.json\"\n      ),\n      \"utf8\"\n    )\n  );\n\nconst expectedSequence = [\n  \"/api/market/regime/v7/eod-sync\",\n  \"/api/market/regime/v7/freshness/capture\",\n  \"/api/market/regime/v7/quality-gate/capture\"\n];\n\nconst positions =\n  expectedSequence.map(\n    (value) =>\n      scheduler.indexOf(\n        value\n      )\n  );\n\nconst checks = {\n  version:\n    scheduler.includes(\n      \"ALPHA_V3_MARKET_DATA_MAINTENANCE_SCHEDULER_V1\"\n    ),\n\n  sequencePresent:\n    positions.every(\n      (value) =>\n        value >= 0\n    ),\n\n  sequenceOrdered:\n    positions[0] <\n      positions[1] &&\n    positions[1] <\n      positions[2],\n\n  defaultKstWindow:\n    scheduler.includes(\n      \"DEFAULT_HOUR_KST =\\n  16\"\n    ) &&\n    scheduler.includes(\n      \"DEFAULT_MINUTE_KST =\\n  20\"\n    ),\n\n  kstClock:\n    scheduler.includes(\n      '\"Asia/Seoul\"'\n    ),\n\n  oncePerDayState:\n    scheduler.includes(\n      \"lastAttemptDateKst\"\n    ),\n\n  explicitOnceMode:\n    scheduler.includes(\n      '\"--once\"'\n    ),\n\n  noOrderEndpoints:\n    !scheduler.includes(\n      \"/api/orders/\"\n    ) &&\n    !scheduler.includes(\n      \"/api/signals/entry/\"\n    ) &&\n    !scheduler.includes(\n      \"/api/trading/automation/run\"\n    ),\n\n  autoOrderFalseSafety:\n    scheduler.includes(\n      \"autoOrder:\\n        false\"\n    ),\n\n  packageScheduler:\n    pkg.scripts?.[\n      \"market-data:maintenance:scheduler\"\n    ] ===\n      \"tsx --env-file=.env.local scripts/alpha-v3-market-data-maintenance-scheduler.ts\",\n\n  packageOnce:\n    pkg.scripts?.[\n      \"market-data:maintenance:once\"\n    ] ===\n      \"tsx --env-file=.env.local scripts/alpha-v3-market-data-maintenance-scheduler.ts --once\",\n\n  packageTest:\n    pkg.scripts?.[\n      \"market-data:maintenance:test\"\n    ] ===\n      \"tsx scripts/alpha-v3-market-data-maintenance-scheduler-contract-test.ts\"\n};\n\nconst failed =\n  Object.entries(\n    checks\n  )\n    .filter(\n      ([, value]) =>\n        !value\n    )\n    .map(\n      ([key]) =>\n        key\n    );\n\nconsole.log(\n  JSON.stringify(\n    {\n      status:\n        failed.length === 0\n          ? \"ALPHA_V3_MARKET_DATA_MAINTENANCE_SCHEDULER_V1_STATIC_VERIFIED\"\n          : \"ALPHA_V3_MARKET_DATA_MAINTENANCE_SCHEDULER_V1_STATIC_REVIEW\",\n\n      checks,\n      failed,\n\n      defaults: {\n        timezone:\n          \"Asia/Seoul\",\n\n        dailyWindow:\n          \"16:20 KST\",\n\n        pollMs:\n          60000,\n\n        sequence:\n          expectedSequence\n      },\n\n      safety: {\n        databaseReads:\n          0,\n\n        databaseWrites:\n          0,\n\n        networkCalls:\n          0,\n\n        productionOrderEndpointCalled:\n          false\n      },\n\n      nextGate:\n        failed.length === 0\n          ? \"CONTRACT_TEST_AND_TARGETED_TYPESCRIPT\"\n          : \"REVIEW_MARKET_DATA_MAINTENANCE_SCHEDULER\"\n    },\n    null,\n    2\n  )\n);\n\nif (\n  failed.length > 0\n) {\n  process.exitCode =\n    2;\n}\n"
  }
];

for (const item of outputs) {
  const file =
    path.resolve(
      root,
      item.rel
    );

  fs.mkdirSync(
    path.dirname(file),
    {
      recursive: true
    }
  );

  fs.writeFileSync(
    file,
    item.text,
    "utf8"
  );
}

const packagePath =
  path.resolve(
    root,
    "package.json"
  );

const pkg =
  JSON.parse(
    fs.readFileSync(
      packagePath,
      "utf8"
    )
  );

pkg.scripts =
  pkg.scripts ?? {};

pkg.scripts[
  "market-data:maintenance:scheduler"
] =
  "tsx --env-file=.env.local scripts/alpha-v3-market-data-maintenance-scheduler.ts";

pkg.scripts[
  "market-data:maintenance:once"
] =
  "tsx --env-file=.env.local scripts/alpha-v3-market-data-maintenance-scheduler.ts --once";

pkg.scripts[
  "market-data:maintenance:test"
] =
  "tsx scripts/alpha-v3-market-data-maintenance-scheduler-contract-test.ts";

fs.writeFileSync(
  packagePath,
  JSON.stringify(
    pkg,
    null,
    2
  ) + "\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_MARKET_DATA_MAINTENANCE_SCHEDULER_V1_INSTALLED",

      generatedFiles:
        outputs.map(
          (item) =>
            item.rel
        ),

      packageScripts: {
        scheduler:
          "market-data:maintenance:scheduler",

        once:
          "market-data:maintenance:once",

        test:
          "market-data:maintenance:test"
      },

      defaults: {
        timezone:
          "Asia/Seoul",

        runAfter:
          "16:20",

        weekdayOnly:
          true,

        sequence: [
          "EOD_SYNC",
          "FRESHNESS_CAPTURE",
          "QUALITY_GATE_CAPTURE"
        ]
      },

      safety: {
        installerNetworkCalls:
          0,

        installerDatabaseWrites:
          0,

        productionOrderEndpointCalled:
          false,

        autoOrder:
          false
      },

      nextAction:
        "STATIC_VERIFY_CONTRACT_TEST_AND_TYPESCRIPT"
    },
    null,
    2
  )
);
