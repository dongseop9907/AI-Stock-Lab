const fs = require("fs");
const path = require("path");

const root =
  process.cwd();

const schedulerRel =
  "scripts/alpha-v3-automation-cycle-scheduler.ts";

const testRel =
  "scripts/alpha-v3-automation-cycle-scheduler-contract-test.ts";

const packageRel =
  "package.json";

const routeRel =
  "app/api/trading/automation/run/route.ts";

const schedulerFile =
  path.resolve(
    root,
    schedulerRel,
  );

const testFile =
  path.resolve(
    root,
    testRel,
  );

const packageFile =
  path.resolve(
    root,
    packageRel,
  );

const routeFile =
  path.resolve(
    root,
    routeRel,
  );

if (!fs.existsSync(packageFile)) {
  throw new Error(
    "PACKAGE_JSON_NOT_FOUND",
  );
}

if (!fs.existsSync(routeFile)) {
  throw new Error(
    "AUTOMATION_RUN_ROUTE_NOT_FOUND",
  );
}

const routeText =
  fs.readFileSync(
    routeFile,
    "utf8",
  );

let defaultTriggerType =
  "MANUAL";

if (
  /["']SCHEDULED["']/.test(
    routeText,
  )
) {
  defaultTriggerType =
    "SCHEDULED";
} else if (
  /["']CRON["']/.test(
    routeText,
  )
) {
  defaultTriggerType =
    "CRON";
}

const schedulerSource =
  "import {\n  pathToFileURL,\n} from \"node:url\";\n\nexport const AUTOMATION_SCHEDULER_CADENCE_MS =\n  60_000;\n\nexport interface AutomationSchedulerConfig {\n  baseUrl: string;\n  secret: string;\n  triggerType: string;\n  cadenceMs: number;\n}\n\nexport interface AutomationSchedulerEvent {\n  type:\n    | \"START\"\n    | \"SUCCESS\"\n    | \"FAILURE\"\n    | \"SKIPPED_OVERLAP\"\n    | \"STOP\";\n  at: string;\n  detail?: unknown;\n}\n\nexport interface AutomationSchedulerState {\n  running: boolean;\n  stopping: boolean;\n  tickCount: number;\n  successCount: number;\n  failureCount: number;\n  skippedOverlapCount: number;\n}\n\nexport interface RunTickOptions {\n  fetchImpl?: typeof fetch;\n  now?: () => Date;\n  onEvent?: (\n    event: AutomationSchedulerEvent,\n  ) => void;\n}\n\nfunction normalizeBaseUrl(\n  value: string,\n) {\n  return value\n    .trim()\n    .replace(/\\/+$/, \"\");\n}\n\nexport function resolveAutomationSchedulerConfig(\n  env:\n    NodeJS.ProcessEnv =\n    process.env,\n): AutomationSchedulerConfig {\n  const baseUrl =\n    normalizeBaseUrl(\n      env.AI_STOCK_LAB_BASE_URL ??\n        \"http://localhost:3000\",\n    );\n\n  const secret =\n    env\n      .TRADING_AUTOMATION_SECRET\n      ?.trim() ??\n    \"\";\n\n  if (!secret) {\n    throw new Error(\n      \"TRADING_AUTOMATION_SECRET_REQUIRED_FOR_SCHEDULER\",\n    );\n  }\n\n  const triggerType =\n    (\n      env\n        .AUTOMATION_CYCLE_TRIGGER_TYPE ??\n      \"__DEFAULT_TRIGGER_TYPE__\"\n    )\n      .trim() ||\n    \"__DEFAULT_TRIGGER_TYPE__\";\n\n  const cadenceRaw =\n    Number(\n      env\n        .AUTOMATION_CYCLE_CADENCE_MS ??\n      AUTOMATION_SCHEDULER_CADENCE_MS,\n    );\n\n  if (\n    !Number.isFinite(\n      cadenceRaw,\n    ) ||\n    cadenceRaw < 60_000\n  ) {\n    throw new Error(\n      \"AUTOMATION_CYCLE_CADENCE_MS_MUST_BE_AT_LEAST_60000\",\n    );\n  }\n\n  return {\n    baseUrl,\n    secret,\n    triggerType,\n    cadenceMs:\n      Math.floor(\n        cadenceRaw,\n      ),\n  };\n}\n\nexport function createAutomationSchedulerState():\n  AutomationSchedulerState {\n  return {\n    running: false,\n    stopping: false,\n    tickCount: 0,\n    successCount: 0,\n    failureCount: 0,\n    skippedOverlapCount: 0,\n  };\n}\n\nexport async function runAutomationSchedulerTick(\n  config: AutomationSchedulerConfig,\n  state: AutomationSchedulerState,\n  options:\n    RunTickOptions =\n    {},\n) {\n  const fetchImpl =\n    options.fetchImpl ??\n    globalThis.fetch;\n\n  const now =\n    options.now ??\n    (() => new Date());\n\n  const onEvent =\n    options.onEvent ??\n    (() => {});\n\n  if (\n    state.stopping\n  ) {\n    return {\n      ok: false as const,\n      skipped: true as const,\n      reason:\n        \"STOPPING\",\n    };\n  }\n\n  if (\n    state.running\n  ) {\n    state\n      .skippedOverlapCount +=\n      1;\n\n    onEvent({\n      type:\n        \"SKIPPED_OVERLAP\",\n\n      at:\n        now()\n          .toISOString(),\n\n      detail: {\n        tickCount:\n          state.tickCount,\n\n        skippedOverlapCount:\n          state\n            .skippedOverlapCount,\n      },\n    });\n\n    return {\n      ok: false as const,\n      skipped: true as const,\n      reason:\n        \"OVERLAP\",\n    };\n  }\n\n  state.running =\n    true;\n\n  state.tickCount +=\n    1;\n\n  const tickNumber =\n    state.tickCount;\n\n  const startedAt =\n    now();\n\n  onEvent({\n    type: \"START\",\n    at:\n      startedAt\n        .toISOString(),\n    detail: {\n      tickNumber,\n      cadenceMs:\n        config.cadenceMs,\n    },\n  });\n\n  try {\n    const response =\n      await fetchImpl(\n        `${config.baseUrl}/api/trading/automation/cycle`,\n        {\n          method:\n            \"POST\",\n\n          headers: {\n            \"content-type\":\n              \"application/json\",\n\n            \"x-automation-secret\":\n              config.secret,\n          },\n\n          body:\n            JSON.stringify({\n              triggerType:\n                config.triggerType,\n\n              scheduler: {\n                cadenceSeconds:\n                  Math.round(\n                    config.cadenceMs /\n                    1000,\n                  ),\n\n                tickNumber,\n              },\n            }),\n\n          cache:\n            \"no-store\",\n        },\n      );\n\n    const responseText =\n      await response.text();\n\n    let payload:\n      unknown =\n      null;\n\n    if (\n      responseText.trim()\n    ) {\n      try {\n        payload =\n          JSON.parse(\n            responseText,\n          );\n      } catch {\n        payload =\n          responseText;\n      }\n    }\n\n    if (!response.ok) {\n      state.failureCount +=\n        1;\n\n      const result = {\n        ok: false as const,\n        skipped:\n          false as const,\n\n        tickNumber,\n\n        status:\n          response.status,\n\n        payload,\n      };\n\n      onEvent({\n        type:\n          \"FAILURE\",\n\n        at:\n          now()\n            .toISOString(),\n\n        detail:\n          result,\n      });\n\n      return result;\n    }\n\n    state.successCount +=\n      1;\n\n    const result = {\n      ok: true as const,\n      skipped:\n        false as const,\n\n      tickNumber,\n\n      status:\n        response.status,\n\n      payload,\n    };\n\n    onEvent({\n      type:\n        \"SUCCESS\",\n\n      at:\n        now()\n          .toISOString(),\n\n      detail:\n        result,\n    });\n\n    return result;\n  } catch (error) {\n    state.failureCount +=\n      1;\n\n    const result = {\n      ok: false as const,\n      skipped:\n        false as const,\n\n      tickNumber,\n\n      status:\n        null,\n\n      error:\n        error instanceof Error\n          ? error.message\n          : String(\n              error,\n            ),\n    };\n\n    onEvent({\n      type:\n        \"FAILURE\",\n\n      at:\n        now()\n          .toISOString(),\n\n      detail:\n        result,\n    });\n\n    return result;\n  } finally {\n    state.running =\n      false;\n  }\n}\n\nfunction defaultEventLogger(\n  event:\n    AutomationSchedulerEvent,\n) {\n  console.log(\n    JSON.stringify(\n      {\n        scheduler:\n          \"ALPHA_V3_60S_AUTOMATION_CYCLE\",\n\n        ...event,\n      },\n      null,\n      2,\n    ),\n  );\n}\n\nexport async function startAutomationCycleScheduler(\n  config:\n    AutomationSchedulerConfig =\n    resolveAutomationSchedulerConfig(),\n) {\n  const state =\n    createAutomationSchedulerState();\n\n  const onEvent =\n    defaultEventLogger;\n\n  const tick =\n    async () =>\n      runAutomationSchedulerTick(\n        config,\n        state,\n        {\n          onEvent,\n        },\n      );\n\n  /*\n   * Run once immediately, then every 60s.\n   * The state-level single-flight guard prevents overlapping cycles.\n   */\n  void tick();\n\n  const timer =\n    setInterval(\n      () => {\n        void tick();\n      },\n      config.cadenceMs,\n    );\n\n  const stop =\n    (\n      signal:\n        \"SIGINT\" |\n        \"SIGTERM\",\n    ) => {\n      if (\n        state.stopping\n      ) {\n        return;\n      }\n\n      state.stopping =\n        true;\n\n      clearInterval(\n        timer,\n      );\n\n      onEvent({\n        type:\n          \"STOP\",\n\n        at:\n          new Date()\n            .toISOString(),\n\n        detail: {\n          signal,\n\n          tickCount:\n            state.tickCount,\n\n          successCount:\n            state\n              .successCount,\n\n          failureCount:\n            state\n              .failureCount,\n\n          skippedOverlapCount:\n            state\n              .skippedOverlapCount,\n\n          inFlight:\n            state.running,\n        },\n      });\n    };\n\n  process.once(\n    \"SIGINT\",\n    () => stop(\n      \"SIGINT\",\n    ),\n  );\n\n  process.once(\n    \"SIGTERM\",\n    () => stop(\n      \"SIGTERM\",\n    ),\n  );\n\n  return {\n    state,\n    timer,\n    stop,\n  };\n}\n\nasync function runOnce() {\n  const config =\n    resolveAutomationSchedulerConfig();\n\n  const state =\n    createAutomationSchedulerState();\n\n  const result =\n    await runAutomationSchedulerTick(\n      config,\n      state,\n      {\n        onEvent:\n          defaultEventLogger,\n      },\n    );\n\n  if (!result.ok) {\n    process.exitCode =\n      2;\n  }\n}\n\nconst isMain =\n  Boolean(\n    process.argv[1],\n  ) &&\n  import.meta.url ===\n    pathToFileURL(\n      process.argv[1],\n    ).href;\n\nif (isMain) {\n  if (\n    process.argv.includes(\n      \"--once\",\n    )\n  ) {\n    await runOnce();\n  } else {\n    await startAutomationCycleScheduler();\n  }\n}\n";

const testSource =
  "import {\n  createAutomationSchedulerState,\n  resolveAutomationSchedulerConfig,\n  runAutomationSchedulerTick,\n  type AutomationSchedulerEvent,\n} from \"./alpha-v3-automation-cycle-scheduler\";\n\ntype Scenario = {\n  name: string;\n  passed: boolean;\n  expected: unknown;\n  observed: unknown;\n};\n\nconst scenarios:\n  Scenario[] =\n  [];\n\nconst baseConfig = {\n  baseUrl:\n    \"http://scheduler-test.local\",\n\n  secret:\n    \"test-secret\",\n\n  triggerType:\n    \"__DEFAULT_TRIGGER_TYPE__\",\n\n  cadenceMs:\n    60_000,\n};\n\n{\n  const calls:\n    Array<{\n      url: string;\n      init?: RequestInit;\n    }> =\n    [];\n\n  const events:\n    AutomationSchedulerEvent[] =\n    [];\n\n  const state =\n    createAutomationSchedulerState();\n\n  const result =\n    await runAutomationSchedulerTick(\n      baseConfig,\n      state,\n      {\n        fetchImpl:\n          (async (\n            input,\n            init,\n          ) => {\n            calls.push({\n              url:\n                String(\n                  input,\n                ),\n              init,\n            });\n\n            return new Response(\n              JSON.stringify({\n                ok: true,\n              }),\n              {\n                status: 200,\n              },\n            );\n          }) as typeof fetch,\n\n        onEvent:\n          (event) =>\n            events.push(\n              event,\n            ),\n      },\n    );\n\n  const headers =\n    new Headers(\n      calls[0]\n        ?.init\n        ?.headers,\n    );\n\n  const body =\n    JSON.parse(\n      String(\n        calls[0]\n          ?.init\n          ?.body ??\n        \"{}\",\n      ),\n    );\n\n  scenarios.push({\n    name:\n      \"SUCCESS_CALL_CONTRACT\",\n\n    passed:\n      result.ok ===\n        true &&\n      calls.length ===\n        1 &&\n      calls[0]?.url ===\n        \"http://scheduler-test.local/api/trading/automation/cycle\" &&\n      headers.get(\n        \"x-automation-secret\",\n      ) ===\n        \"test-secret\" &&\n      body.triggerType ===\n        \"__DEFAULT_TRIGGER_TYPE__\" &&\n      body.scheduler\n        ?.cadenceSeconds ===\n        60 &&\n      state.successCount ===\n        1 &&\n      state.failureCount ===\n        0 &&\n      events.map(\n        (event) =>\n          event.type,\n      ).join(\",\") ===\n        \"START,SUCCESS\",\n\n    expected: {\n      url:\n        \"http://scheduler-test.local/api/trading/automation/cycle\",\n\n      secret:\n        \"test-secret\",\n\n      cadenceSeconds:\n        60,\n\n      events: [\n        \"START\",\n        \"SUCCESS\",\n      ],\n    },\n\n    observed: {\n      result,\n      calls,\n      state,\n      events,\n    },\n  });\n}\n\n{\n  const state =\n    createAutomationSchedulerState();\n\n  state.running =\n    true;\n\n  let fetchCount =\n    0;\n\n  const result =\n    await runAutomationSchedulerTick(\n      baseConfig,\n      state,\n      {\n        fetchImpl:\n          (async () => {\n            fetchCount +=\n              1;\n\n            return new Response(\n              \"{}\",\n              {\n                status: 200,\n              },\n            );\n          }) as typeof fetch,\n      },\n    );\n\n  scenarios.push({\n    name:\n      \"OVERLAP_IS_SKIPPED\",\n\n    passed:\n      result.skipped ===\n        true &&\n      result.reason ===\n        \"OVERLAP\" &&\n      fetchCount ===\n        0 &&\n      state\n        .skippedOverlapCount ===\n        1,\n\n    expected: {\n      skipped:\n        true,\n      fetchCount:\n        0,\n      skippedOverlapCount:\n        1,\n    },\n\n    observed: {\n      result,\n      fetchCount,\n      state,\n    },\n  });\n}\n\n{\n  const state =\n    createAutomationSchedulerState();\n\n  const result =\n    await runAutomationSchedulerTick(\n      baseConfig,\n      state,\n      {\n        fetchImpl:\n          (async () =>\n            new Response(\n              JSON.stringify({\n                ok: false,\n              }),\n              {\n                status: 503,\n              },\n            )) as typeof fetch,\n      },\n    );\n\n  scenarios.push({\n    name:\n      \"NON_2XX_COUNTS_FAILURE\",\n\n    passed:\n      result.ok ===\n        false &&\n      result.skipped ===\n        false &&\n      result.status ===\n        503 &&\n      state.failureCount ===\n        1 &&\n      state.successCount ===\n        0,\n\n    expected: {\n      status:\n        503,\n      failureCount:\n        1,\n    },\n\n    observed: {\n      result,\n      state,\n    },\n  });\n}\n\n{\n  let threw =\n    false;\n\n  let errorMessage =\n    \"\";\n\n  try {\n    resolveAutomationSchedulerConfig(\n      {\n        AI_STOCK_LAB_BASE_URL:\n          \"http://localhost:3000\",\n\n        TRADING_AUTOMATION_SECRET:\n          \"\",\n      } as NodeJS.ProcessEnv,\n    );\n  } catch (error) {\n    threw =\n      true;\n\n    errorMessage =\n      error instanceof Error\n        ? error.message\n        : String(\n            error,\n          );\n  }\n\n  scenarios.push({\n    name:\n      \"SECRET_IS_REQUIRED\",\n\n    passed:\n      threw &&\n      errorMessage ===\n        \"TRADING_AUTOMATION_SECRET_REQUIRED_FOR_SCHEDULER\",\n\n    expected: {\n      throws:\n        true,\n      error:\n        \"TRADING_AUTOMATION_SECRET_REQUIRED_FOR_SCHEDULER\",\n    },\n\n    observed: {\n      threw,\n      errorMessage,\n    },\n  });\n}\n\n{\n  let threw =\n    false;\n\n  let errorMessage =\n    \"\";\n\n  try {\n    resolveAutomationSchedulerConfig(\n      {\n        TRADING_AUTOMATION_SECRET:\n          \"x\",\n\n        AUTOMATION_CYCLE_CADENCE_MS:\n          \"59000\",\n      } as NodeJS.ProcessEnv,\n    );\n  } catch (error) {\n    threw =\n      true;\n\n    errorMessage =\n      error instanceof Error\n        ? error.message\n        : String(\n            error,\n          );\n  }\n\n  scenarios.push({\n    name:\n      \"CADENCE_CANNOT_BE_BELOW_60S\",\n\n    passed:\n      threw &&\n      errorMessage ===\n        \"AUTOMATION_CYCLE_CADENCE_MS_MUST_BE_AT_LEAST_60000\",\n\n    expected: {\n      throws:\n        true,\n      minimumMs:\n        60000,\n    },\n\n    observed: {\n      threw,\n      errorMessage,\n    },\n  });\n}\n\nconst failed =\n  scenarios.filter(\n    (scenario) =>\n      !scenario.passed,\n  );\n\nconsole.log(\n  JSON.stringify(\n    {\n      status:\n        failed.length === 0\n          ? \"ALPHA_V3_60S_SERVER_SIDE_SCHEDULER_CONTRACT_TEST_VERIFIED\"\n          : \"ALPHA_V3_60S_SERVER_SIDE_SCHEDULER_CONTRACT_TEST_REVIEW\",\n\n      scenarios,\n\n      summary: {\n        scenarioCount:\n          scenarios.length,\n\n        passedCount:\n          scenarios.length -\n          failed.length,\n\n        failedCount:\n          failed.length,\n\n        realNetworkCalls:\n          0,\n\n        databaseWrites:\n          0,\n\n        productionOrdersCreated:\n          0,\n\n        productionPositionsChanged:\n          0,\n      },\n\n      nextGate:\n        failed.length === 0\n          ? \"RUN_ONE_SHOT_LIVE_ROUTE_SMOKE_TEST_WHEN_SERVER_IS_READY\"\n          : \"REVIEW_60S_SERVER_SIDE_SCHEDULER\",\n\n    },\n    null,\n    2,\n  ),\n);\n\nif (\n  failed.length > 0\n) {\n  process.exitCode =\n    2;\n}\n";

fs.mkdirSync(
  path.dirname(
    schedulerFile,
  ),
  {
    recursive: true,
  },
);

fs.writeFileSync(
  schedulerFile,
  schedulerSource.replaceAll(
    "__DEFAULT_TRIGGER_TYPE__",
    defaultTriggerType,
  ),
  "utf8",
);

fs.writeFileSync(
  testFile,
  testSource.replaceAll(
    "__DEFAULT_TRIGGER_TYPE__",
    defaultTriggerType,
  ),
  "utf8",
);

const packageJson =
  JSON.parse(
    fs.readFileSync(
      packageFile,
      "utf8",
    ),
  );

packageJson.scripts =
  packageJson.scripts ??
  {};

packageJson.scripts[
  "automation:scheduler"
] =
  "tsx --env-file=.env.local scripts/alpha-v3-automation-cycle-scheduler.ts";

packageJson.scripts[
  "automation:scheduler:once"
] =
  "tsx --env-file=.env.local scripts/alpha-v3-automation-cycle-scheduler.ts --once";

packageJson.scripts[
  "automation:scheduler:test"
] =
  "tsx scripts/alpha-v3-automation-cycle-scheduler-contract-test.ts";

const packageBackup =
  `${packageFile}.before-alpha-v3-60s-scheduler-v1.bak`;

if (!fs.existsSync(packageBackup)) {
  fs.copyFileSync(
    packageFile,
    packageBackup,
  );
}

fs.writeFileSync(
  packageFile,
  JSON.stringify(
    packageJson,
    null,
    2,
  ) + "\n",
  "utf8",
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_60S_SERVER_SIDE_SCHEDULER_V1_INSTALLED",

      generatedFiles: [
        schedulerRel,
        testRel,
      ],

      patchedFile:
        packageRel,

      contract: {
        cadenceMs:
          60000,

        cadenceSeconds:
          60,

        singleFlight:
          true,

        overlapPolicy:
          "SKIP_WHILE_PREVIOUS_CYCLE_IS_RUNNING",

        secretRequired:
          true,

        defaultBaseUrl:
          "http://localhost:3000",

        detectedTriggerType:
          defaultTriggerType,

        autoStartedByInstaller:
          false,
      },

      npmScripts: {
        continuous:
          "npm run automation:scheduler",

        once:
          "npm run automation:scheduler:once",

        test:
          "npm run automation:scheduler:test",
      },

      databaseWrites:
        0,

      productionOrdersCreated:
        0,

      productionPositionsChanged:
        0,

      nextAction:
        "RUN_SCHEDULER_CONTRACT_TEST_ONLY",
    },
    null,
    2,
  ),
);
