const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const SCHEDULER =
  path.join(
    ROOT,
    "scripts",
    "alpha-v3-automation-cycle-scheduler.ts",
  );

const HELPER =
  path.join(
    ROOT,
    "lib",
    "research",
    "run-true-forward-oos-automation-binding-v1.ts",
  );

const CONTRACT =
  path.join(
    ROOT,
    "scripts",
    "true-forward-oos-automation-binding-v1-contract-test.ts",
  );

const STATIC_VERIFY =
  path.join(
    ROOT,
    "scripts",
    "true-forward-oos-automation-binding-v1-static-verify.cjs",
  );

const PACKAGE =
  path.join(
    ROOT,
    "package.json",
  );

const BACKUPS =
  path.join(
    ROOT,
    "scripts",
    "backups",
  );

function fail(
  reason,
  extra = {},
) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_BINDING_V1_INSTALL_FAILED",
    reason,
    ...extra,
  }, null, 2));

  process.exit(1);
}

const required = [
  SCHEDULER,
  PACKAGE,
  path.join(
    ROOT,
    "scripts",
    "alpha-v3-true-forward-top1-producer-v1.ts",
  ),
  path.join(
    ROOT,
    "scripts",
    "alpha-v3-true-entry-forward-oos-collector-v1.ts",
  ),
  path.join(
    ROOT,
    "scripts",
    "alpha-v3-true-forward-oos-evaluator-v1.ts",
  ),
  path.join(
    ROOT,
    "scripts",
    "alpha-v3-true-forward-oos-summary.ts",
  ),
];

const missing =
  required.filter(
    (file) =>
      !fs.existsSync(file),
  );

if (missing.length > 0) {
  fail(
    "REQUIRED_FILE_MISSING",
    {
      missing:
        missing.map(
          (file) =>
            path.relative(
              ROOT,
              file,
            ),
        ),
    },
  );
}

fs.mkdirSync(
  path.dirname(HELPER),
  {
    recursive: true,
  },
);

fs.mkdirSync(
  BACKUPS,
  {
    recursive: true,
  },
);

const schedulerBackup =
  path.join(
    BACKUPS,
    "alpha-v3-automation-cycle-scheduler.before-forward-oos-binding-v1.ts",
  );

const packageBackup =
  path.join(
    BACKUPS,
    "package.before-forward-oos-binding-v1.json",
  );

if (
  !fs.existsSync(
    schedulerBackup,
  )
) {
  fs.copyFileSync(
    SCHEDULER,
    schedulerBackup,
  );
}

if (
  !fs.existsSync(
    packageBackup,
  )
) {
  fs.copyFileSync(
    PACKAGE,
    packageBackup,
  );
}

fs.writeFileSync(
  HELPER,
  "import {\n  spawn,\n} from \"node:child_process\";\n\nimport fs from \"node:fs\";\nimport path from \"node:path\";\n\nexport type ForwardOosAutomationStep =\n  | \"PRODUCE\"\n  | \"COLLECT\"\n  | \"EVALUATE\"\n  | \"SUMMARY\";\n\nexport interface ForwardOosAutomationState {\n  kstDate: string;\n  completed: ForwardOosAutomationStep[];\n  blockedReason: string | null;\n  lastUpdatedAt: string;\n}\n\nexport interface ForwardOosAutomationResult {\n  status:\n    | \"DISABLED\"\n    | \"WAITING\"\n    | \"COMPLETED_DUE_STEPS\"\n    | \"FAILED_CLOSED\";\n  kstDate: string;\n  nowKst: string;\n  executed: ForwardOosAutomationStep[];\n  completed: ForwardOosAutomationStep[];\n  blockedReason: string | null;\n}\n\nexport interface ForwardOosAutomationDependencies {\n  runStep?: (\n    step: ForwardOosAutomationStep,\n  ) => Promise<{\n    exitCode: number;\n    stdout?: string;\n    stderr?: string;\n  }>;\n  loadState?: (\n    kstDate: string,\n  ) => ForwardOosAutomationState | null;\n  saveState?: (\n    state: ForwardOosAutomationState,\n  ) => void;\n  env?: NodeJS.ProcessEnv;\n}\n\nconst KST_TIME_ZONE =\n  \"Asia/Seoul\";\n\nconst STATE_FILE =\n  path.join(\n    process.cwd(),\n    \"logs\",\n    \"true-forward-oos-automation-binding-v1-state.json\",\n  );\n\nconst STEP_SCRIPT: Record<\n  ForwardOosAutomationStep,\n  string\n> = {\n  PRODUCE:\n    \"scripts/alpha-v3-true-forward-top1-producer-v1.ts\",\n  COLLECT:\n    \"scripts/alpha-v3-true-entry-forward-oos-collector-v1.ts\",\n  EVALUATE:\n    \"scripts/alpha-v3-true-forward-oos-evaluator-v1.ts\",\n  SUMMARY:\n    \"scripts/alpha-v3-true-forward-oos-summary.ts\",\n};\n\nconst DEFAULT_TIME: Record<\n  ForwardOosAutomationStep,\n  string\n> = {\n  PRODUCE: \"08:50\",\n  COLLECT: \"15:40\",\n  EVALUATE: \"15:50\",\n  SUMMARY: \"16:00\",\n};\n\nfunction parseBoolean(\n  value: string | undefined,\n) {\n  return (\n    value?.trim().toLowerCase() === \"true\"\n  );\n}\n\nfunction parseMinuteOfDay(\n  value: string,\n) {\n  const match =\n    /^([01]\\d|2[0-3]):([0-5]\\d)$/.exec(\n      value.trim(),\n    );\n\n  if (!match) {\n    throw new Error(\n      `INVALID_KST_TIME:${value}`,\n    );\n  }\n\n  return (\n    Number(match[1]) * 60 +\n    Number(match[2])\n  );\n}\n\nfunction kstParts(\n  now: Date,\n) {\n  const formatter =\n    new Intl.DateTimeFormat(\n      \"en-CA\",\n      {\n        timeZone: KST_TIME_ZONE,\n        year: \"numeric\",\n        month: \"2-digit\",\n        day: \"2-digit\",\n        hour: \"2-digit\",\n        minute: \"2-digit\",\n        second: \"2-digit\",\n        hourCycle: \"h23\",\n      },\n    );\n\n  const parts =\n    Object.fromEntries(\n      formatter\n        .formatToParts(now)\n        .filter(\n          (part) =>\n            part.type !== \"literal\",\n        )\n        .map(\n          (part) => [\n            part.type,\n            part.value,\n          ],\n        ),\n    );\n\n  const kstDate =\n    `${parts.year}-${parts.month}-${parts.day}`;\n\n  const minuteOfDay =\n    Number(parts.hour) * 60 +\n    Number(parts.minute);\n\n  const nowKst =\n    `${kstDate}T${parts.hour}:${parts.minute}:${parts.second}+09:00`;\n\n  return {\n    kstDate,\n    minuteOfDay,\n    nowKst,\n  };\n}\n\nfunction defaultLoadState(\n  kstDate: string,\n): ForwardOosAutomationState | null {\n  if (!fs.existsSync(STATE_FILE)) {\n    return null;\n  }\n\n  try {\n    const parsed =\n      JSON.parse(\n        fs.readFileSync(\n          STATE_FILE,\n          \"utf8\",\n        ),\n      ) as ForwardOosAutomationState;\n\n    if (\n      parsed.kstDate !==\n      kstDate\n    ) {\n      return null;\n    }\n\n    return parsed;\n  } catch {\n    return null;\n  }\n}\n\nfunction defaultSaveState(\n  state: ForwardOosAutomationState,\n) {\n  fs.mkdirSync(\n    path.dirname(STATE_FILE),\n    {\n      recursive: true,\n    },\n  );\n\n  fs.writeFileSync(\n    STATE_FILE,\n    JSON.stringify(\n      state,\n      null,\n      2,\n    ),\n    \"utf8\",\n  );\n}\n\nfunction defaultRunStep(\n  step: ForwardOosAutomationStep,\n): Promise<{\n  exitCode: number;\n  stdout: string;\n  stderr: string;\n}> {\n  const script =\n    STEP_SCRIPT[step];\n\n  return new Promise(\n    (resolve) => {\n      const child =\n        spawn(\n          process.execPath,\n          [\n            \"--env-file=.env.local\",\n            \"--import\",\n            \"tsx\",\n            script,\n          ],\n          {\n            cwd: process.cwd(),\n            env: {\n              ...process.env,\n              REAL_TRADING_ENABLED:\n                \"false\",\n              ENABLE_REAL_TRADING:\n                \"false\",\n              ENABLE_LIVE_TRADING:\n                \"false\",\n            },\n            stdio: [\n              \"ignore\",\n              \"pipe\",\n              \"pipe\",\n            ],\n            shell: false,\n          },\n        );\n\n      let stdout = \"\";\n      let stderr = \"\";\n\n      child.stdout?.on(\n        \"data\",\n        (chunk) => {\n          stdout +=\n            String(chunk);\n        },\n      );\n\n      child.stderr?.on(\n        \"data\",\n        (chunk) => {\n          stderr +=\n            String(chunk);\n        },\n      );\n\n      child.on(\n        \"error\",\n        (error) => {\n          resolve({\n            exitCode: 1,\n            stdout,\n            stderr:\n              `${stderr}\\n${String(error.message || error)}`.trim(),\n          });\n        },\n      );\n\n      child.on(\n        \"close\",\n        (code) => {\n          resolve({\n            exitCode:\n              typeof code === \"number\"\n                ? code\n                : 1,\n            stdout,\n            stderr,\n          });\n        },\n      );\n    },\n  );\n}\n\nfunction newState(\n  kstDate: string,\n  nowKst: string,\n): ForwardOosAutomationState {\n  return {\n    kstDate,\n    completed: [],\n    blockedReason: null,\n    lastUpdatedAt:\n      nowKst,\n  };\n}\n\nfunction envTime(\n  env: NodeJS.ProcessEnv,\n  step: ForwardOosAutomationStep,\n) {\n  const key =\n    `FORWARD_OOS_AUTOMATION_${step}_KST`;\n\n  return (\n    env[key] ??\n    DEFAULT_TIME[step]\n  );\n}\n\nexport async function runTrueForwardOosAutomationBindingV1(\n  input: {\n    now?: Date;\n  } = {},\n  deps: ForwardOosAutomationDependencies = {},\n): Promise<ForwardOosAutomationResult> {\n  const env =\n    deps.env ??\n    process.env;\n\n  const now =\n    input.now ??\n    new Date();\n\n  const {\n    kstDate,\n    minuteOfDay,\n    nowKst,\n  } = kstParts(now);\n\n  if (\n    !parseBoolean(\n      env\n        .FORWARD_OOS_AUTOMATION_ENABLED,\n    )\n  ) {\n    return {\n      status: \"DISABLED\",\n      kstDate,\n      nowKst,\n      executed: [],\n      completed: [],\n      blockedReason: null,\n    };\n  }\n\n  const loadState =\n    deps.loadState ??\n    defaultLoadState;\n\n  const saveState =\n    deps.saveState ??\n    defaultSaveState;\n\n  const runStep =\n    deps.runStep ??\n    defaultRunStep;\n\n  const state =\n    loadState(kstDate) ??\n    newState(\n      kstDate,\n      nowKst,\n    );\n\n  if (\n    state.blockedReason\n  ) {\n    return {\n      status:\n        \"FAILED_CLOSED\",\n      kstDate,\n      nowKst,\n      executed: [],\n      completed:\n        [...state.completed],\n      blockedReason:\n        state.blockedReason,\n    };\n  }\n\n  const produceMinute =\n    parseMinuteOfDay(\n      envTime(\n        env,\n        \"PRODUCE\",\n      ),\n    );\n\n  const collectMinute =\n    parseMinuteOfDay(\n      envTime(\n        env,\n        \"COLLECT\",\n      ),\n    );\n\n  const evaluateMinute =\n    parseMinuteOfDay(\n      envTime(\n        env,\n        \"EVALUATE\",\n      ),\n    );\n\n  const summaryMinute =\n    parseMinuteOfDay(\n      envTime(\n        env,\n        \"SUMMARY\",\n      ),\n    );\n\n  const marketOpenMinute =\n    9 * 60;\n\n  const completed =\n    new Set(\n      state.completed,\n    );\n\n  const executed:\n    ForwardOosAutomationStep[] =\n      [];\n\n  const persist = (\n    blockedReason:\n      string | null = null,\n  ) => {\n    const next:\n      ForwardOosAutomationState = {\n        kstDate,\n        completed:\n          [...completed],\n        blockedReason,\n        lastUpdatedAt:\n          nowKst,\n      };\n\n    saveState(next);\n\n    return next;\n  };\n\n  const execute =\n    async (\n      step:\n        ForwardOosAutomationStep,\n    ) => {\n      const result =\n        await runStep(step);\n\n      executed.push(step);\n\n      if (\n        result.exitCode !== 0\n      ) {\n        const reason =\n          `FORWARD_OOS_${step}_FAILED_EXIT_${result.exitCode}`;\n\n        persist(reason);\n\n        return {\n          ok: false,\n          reason,\n        };\n      }\n\n      completed.add(step);\n      persist(null);\n\n      return {\n        ok: true,\n        reason: null,\n      };\n    };\n\n  if (\n    !completed.has(\n      \"PRODUCE\",\n    )\n  ) {\n    if (\n      minuteOfDay >=\n      marketOpenMinute\n    ) {\n      const reason =\n        \"FORWARD_OOS_PRODUCER_WINDOW_MISSED_FAIL_CLOSED\";\n\n      persist(reason);\n\n      return {\n        status:\n          \"FAILED_CLOSED\",\n        kstDate,\n        nowKst,\n        executed,\n        completed:\n          [...completed],\n        blockedReason:\n          reason,\n      };\n    }\n\n    if (\n      minuteOfDay >=\n      produceMinute\n    ) {\n      const result =\n        await execute(\n          \"PRODUCE\",\n        );\n\n      if (!result.ok) {\n        return {\n          status:\n            \"FAILED_CLOSED\",\n          kstDate,\n          nowKst,\n          executed,\n          completed:\n            [...completed],\n          blockedReason:\n            result.reason,\n        };\n      }\n    }\n  }\n\n  if (\n    completed.has(\n      \"PRODUCE\",\n    ) &&\n    !completed.has(\n      \"COLLECT\",\n    ) &&\n    minuteOfDay >=\n      collectMinute\n  ) {\n    const result =\n      await execute(\n        \"COLLECT\",\n      );\n\n    if (!result.ok) {\n      return {\n        status:\n          \"FAILED_CLOSED\",\n        kstDate,\n        nowKst,\n        executed,\n        completed:\n          [...completed],\n        blockedReason:\n          result.reason,\n      };\n    }\n  }\n\n  if (\n    completed.has(\n      \"COLLECT\",\n    ) &&\n    !completed.has(\n      \"EVALUATE\",\n    ) &&\n    minuteOfDay >=\n      evaluateMinute\n  ) {\n    const result =\n      await execute(\n        \"EVALUATE\",\n      );\n\n    if (!result.ok) {\n      return {\n        status:\n          \"FAILED_CLOSED\",\n        kstDate,\n        nowKst,\n        executed,\n        completed:\n          [...completed],\n        blockedReason:\n          result.reason,\n      };\n    }\n  }\n\n  if (\n    completed.has(\n      \"EVALUATE\",\n    ) &&\n    !completed.has(\n      \"SUMMARY\",\n    ) &&\n    minuteOfDay >=\n      summaryMinute\n  ) {\n    const result =\n      await execute(\n        \"SUMMARY\",\n      );\n\n    if (!result.ok) {\n      return {\n        status:\n          \"FAILED_CLOSED\",\n        kstDate,\n        nowKst,\n        executed,\n        completed:\n          [...completed],\n        blockedReason:\n          result.reason,\n      };\n    }\n  }\n\n  persist(null);\n\n  return {\n    status:\n      executed.length > 0\n        ? \"COMPLETED_DUE_STEPS\"\n        : \"WAITING\",\n    kstDate,\n    nowKst,\n    executed,\n    completed:\n      [...completed],\n    blockedReason: null,\n  };\n}\n",
  "utf8",
);

fs.writeFileSync(
  CONTRACT,
  "import {\n  runTrueForwardOosAutomationBindingV1,\n  type ForwardOosAutomationState,\n  type ForwardOosAutomationStep,\n} from \"../lib/research/run-true-forward-oos-automation-binding-v1\";\n\nfunction assert(\n  condition: unknown,\n  message: string,\n) {\n  if (!condition) {\n    throw new Error(message);\n  }\n}\n\nfunction kst(\n  date: string,\n  time: string,\n) {\n  return new Date(\n    `${date}T${time}+09:00`,\n  );\n}\n\nconst date =\n  \"2026-10-09\";\n\nconst memory:\n  {\n    state:\n      ForwardOosAutomationState | null;\n  } = {\n    state: null,\n  };\n\nconst calls:\n  ForwardOosAutomationStep[] =\n    [];\n\nconst deps = {\n  env: {\n    FORWARD_OOS_AUTOMATION_ENABLED:\n      \"true\",\n  } as NodeJS.ProcessEnv,\n\n  loadState:\n    () =>\n      memory.state,\n\n  saveState:\n    (\n      state:\n        ForwardOosAutomationState,\n    ) => {\n      memory.state =\n        JSON.parse(\n          JSON.stringify(\n            state,\n          ),\n        );\n    },\n\n  runStep:\n    async (\n      step:\n        ForwardOosAutomationStep,\n    ) => {\n      calls.push(step);\n\n      return {\n        exitCode: 0,\n        stdout: \"\",\n        stderr: \"\",\n      };\n    },\n};\n\nconst disabled =\n  await runTrueForwardOosAutomationBindingV1(\n    {\n      now: kst(\n        date,\n        \"08:50:00\",\n      ),\n    },\n    {\n      ...deps,\n      env: {\n        FORWARD_OOS_AUTOMATION_ENABLED:\n          \"false\",\n      },\n    },\n  );\n\nassert(\n  disabled.status ===\n    \"DISABLED\",\n  \"disabled must not run\",\n);\n\nassert(\n  calls.length === 0,\n  \"disabled spawned subprocess\",\n);\n\nconst produced =\n  await runTrueForwardOosAutomationBindingV1(\n    {\n      now: kst(\n        date,\n        \"08:50:00\",\n      ),\n    },\n    deps,\n  );\n\nassert(\n  produced.executed.join(\n    \",\",\n  ) === \"PRODUCE\",\n  \"producer not isolated\",\n);\n\nconst collectedAndEvaluated =\n  await runTrueForwardOosAutomationBindingV1(\n    {\n      now: kst(\n        date,\n        \"15:50:00\",\n      ),\n    },\n    deps,\n  );\n\nassert(\n  collectedAndEvaluated.executed.join(\n    \",\",\n  ) ===\n    \"COLLECT,EVALUATE\",\n  \"collect/evaluate order invalid\",\n);\n\nconst summarized =\n  await runTrueForwardOosAutomationBindingV1(\n    {\n      now: kst(\n        date,\n        \"16:00:00\",\n      ),\n    },\n    deps,\n  );\n\nassert(\n  summarized.executed.join(\n    \",\",\n  ) === \"SUMMARY\",\n  \"summary not executed\",\n);\n\nconst duplicate =\n  await runTrueForwardOosAutomationBindingV1(\n    {\n      now: kst(\n        date,\n        \"16:01:00\",\n      ),\n    },\n    deps,\n  );\n\nassert(\n  duplicate.executed.length === 0,\n  \"duplicate step executed\",\n);\n\nconst missedState:\n  {\n    state:\n      ForwardOosAutomationState | null;\n  } = {\n    state: null,\n  };\n\nconst missed =\n  await runTrueForwardOosAutomationBindingV1(\n    {\n      now: kst(\n        \"2026-10-10\",\n        \"09:01:00\",\n      ),\n    },\n    {\n      ...deps,\n      loadState:\n        () =>\n          missedState.state,\n      saveState:\n        (\n          state:\n            ForwardOosAutomationState,\n        ) => {\n          missedState.state =\n            state;\n        },\n    },\n  );\n\nassert(\n  missed.status ===\n    \"FAILED_CLOSED\",\n  \"missed producer window not blocked\",\n);\n\nassert(\n  missed.blockedReason ===\n    \"FORWARD_OOS_PRODUCER_WINDOW_MISSED_FAIL_CLOSED\",\n  \"wrong missed window reason\",\n);\n\nconst failedCalls:\n  ForwardOosAutomationStep[] =\n    [];\n\nlet failedState:\n  ForwardOosAutomationState | null =\n    null;\n\nconst failedProduce =\n  await runTrueForwardOosAutomationBindingV1(\n    {\n      now: kst(\n        \"2026-10-11\",\n        \"08:50:00\",\n      ),\n    },\n    {\n      env: {\n        FORWARD_OOS_AUTOMATION_ENABLED:\n          \"true\",\n      },\n      loadState:\n        () =>\n          failedState,\n      saveState:\n        (\n          state:\n            ForwardOosAutomationState,\n        ) => {\n          failedState =\n            state;\n        },\n      runStep:\n        async (\n          step:\n            ForwardOosAutomationStep,\n        ) => {\n          failedCalls.push(\n            step,\n          );\n\n          return {\n            exitCode: 9,\n            stdout: \"\",\n            stderr: \"\",\n          };\n        },\n    },\n  );\n\nassert(\n  failedProduce.status ===\n    \"FAILED_CLOSED\",\n  \"failed subprocess did not fail closed\",\n);\n\nassert(\n  failedCalls.join(\",\") ===\n    \"PRODUCE\",\n  \"steps continued after failure\",\n);\n\nconsole.log(JSON.stringify({\n  status:\n    \"AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_BINDING_V1_CONTRACT_VERIFIED\",\n  checks: {\n    disabledNoExecution:\n      true,\n    producerBeforeOpen:\n      true,\n    collectThenEvaluate:\n      true,\n    summaryAfterEvaluation:\n      true,\n    duplicateSuppressed:\n      true,\n    missedProducerWindowFailClosed:\n      true,\n    subprocessFailureFailClosed:\n      true,\n  },\n  safety: {\n    realSubprocessExecuted:\n      false,\n    databaseWrites:\n      0,\n    ordersCreated:\n      0,\n    positionsChanged:\n      0,\n    realTradingEnabled:\n      false,\n  },\n  failed: [],\n  nextGate:\n    \"STATIC_VERIFY_SCHEDULER_BINDING\",\n}, null, 2));\n",
  "utf8",
);

fs.writeFileSync(
  STATIC_VERIFY,
  "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst ROOT = process.cwd();\n\nconst schedulerPath =\n  path.join(\n    ROOT,\n    \"scripts\",\n    \"alpha-v3-automation-cycle-scheduler.ts\",\n  );\n\nconst helperPath =\n  path.join(\n    ROOT,\n    \"lib\",\n    \"research\",\n    \"run-true-forward-oos-automation-binding-v1.ts\",\n  );\n\nconst scheduler =\n  fs.readFileSync(\n    schedulerPath,\n    \"utf8\",\n  );\n\nconst helper =\n  fs.readFileSync(\n    helperPath,\n    \"utf8\",\n  );\n\nconst checks = {\n  schedulerImportsBinding:\n    scheduler.includes(\n      \"runTrueForwardOosAutomationBindingV1\",\n    ),\n\n  schedulerCallsBinding:\n    scheduler.includes(\n      \"ALPHA_V3_TRUE_FORWARD_OOS_AUTOMATION_BINDING_V1_CALL\",\n    ),\n\n  helperFeatureFlagFailClosed:\n    helper.includes(\n      \"FORWARD_OOS_AUTOMATION_ENABLED\",\n    ),\n\n  helperUsesSubprocess:\n    helper.includes(\n      \"spawn(\",\n    ),\n\n  helperDoesNotImportRuntimeScripts:\n    !helper.includes(\n      'from \"../../scripts/alpha-v3-true-entry-forward-oos-collector-v1\"',\n    ) &&\n    !helper.includes(\n      'from \"../../scripts/alpha-v3-true-forward-oos-evaluator-v1\"',\n    ) &&\n    !helper.includes(\n      'from \"../../scripts/alpha-v3-true-forward-oos-summary\"',\n    ),\n\n  helperForcesRealTradingOff:\n    helper.includes(\n      'REAL_TRADING_ENABLED:',\n    ) &&\n    helper.includes(\n      'ENABLE_REAL_TRADING:',\n    ) &&\n    helper.includes(\n      'ENABLE_LIVE_TRADING:',\n    ),\n\n  producerWindowFailClosed:\n    helper.includes(\n      \"FORWARD_OOS_PRODUCER_WINDOW_MISSED_FAIL_CLOSED\",\n    ),\n\n  orderedSteps:\n    [\n      \"PRODUCE\",\n      \"COLLECT\",\n      \"EVALUATE\",\n      \"SUMMARY\",\n    ].every(\n      (step) =>\n        helper.includes(\n          step,\n        ),\n    ),\n\n  noOrderCreationSurface:\n    !helper.includes(\n      \"createPaperBuyOrder\",\n    ) &&\n    !helper.includes(\n      \"executeApprovedPaperOrders\",\n    ) &&\n    !helper.includes(\n      \"createLiveOrder\",\n    ),\n\n  noPromotionApplySurface:\n    !helper.includes(\n      \"applyManualPaperPromotion\",\n    ),\n};\n\nconst failed =\n  Object.entries(checks)\n    .filter(([, value]) => !value)\n    .map(([key]) => key);\n\nconsole.log(JSON.stringify({\n  status:\n    failed.length === 0\n      ? \"AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_BINDING_V1_STATIC_VERIFIED\"\n      : \"AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_BINDING_V1_STATIC_FAILED\",\n  checks,\n  failed,\n  safety: {\n    databaseWrites:\n      0,\n    ordersCreated:\n      0,\n    positionsChanged:\n      0,\n    promotionApplied:\n      false,\n    realTradingEnabled:\n      false,\n  },\n  nextGate:\n    failed.length === 0\n      ? \"TYPECHECK_AND_KEEP_FORWARD_OOS_AUTOMATION_DISABLED\"\n      : \"REPAIR_FORWARD_OOS_AUTOMATION_BINDING\",\n}, null, 2));\n\nprocess.exitCode =\n  failed.length === 0\n    ? 0\n    : 1;\n",
  "utf8",
);

let scheduler =
  fs.readFileSync(
    SCHEDULER,
    "utf8",
  );

const importLine =
  'import { runTrueForwardOosAutomationBindingV1 } from "../lib/research/run-true-forward-oos-automation-binding-v1";';

if (
  !scheduler.includes(
    "runTrueForwardOosAutomationBindingV1",
  )
) {
  scheduler =
    `${importLine}\n${scheduler}`;
}

if (
  !scheduler.includes(
    "ALPHA_V3_TRUE_FORWARD_OOS_AUTOMATION_BINDING_V1_CALL",
  )
) {
  const functionIndex =
    scheduler.indexOf(
      "export async function runAutomationSchedulerTick",
    );

  if (
    functionIndex < 0
  ) {
    fail(
      "RUN_AUTOMATION_SCHEDULER_TICK_NOT_FOUND",
    );
  }

  let cursor =
    functionIndex;

  let parenDepth = 0;
  let seenParen = false;
  let bodyOpen = -1;

  for (
    ;
    cursor <
      scheduler.length;
    cursor++
  ) {
    const ch =
      scheduler[cursor];

    if (ch === "(") {
      parenDepth++;
      seenParen = true;
      continue;
    }

    if (ch === ")") {
      parenDepth--;

      continue;
    }

    if (
      seenParen &&
      parenDepth === 0 &&
      ch === "{"
    ) {
      bodyOpen =
        cursor;

      break;
    }
  }

  if (
    bodyOpen < 0
  ) {
    fail(
      "RUN_AUTOMATION_SCHEDULER_TICK_BODY_NOT_FOUND",
    );
  }

  const injection = `

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
`;

  scheduler =
    scheduler.slice(
      0,
      bodyOpen + 1,
    ) +
    injection +
    scheduler.slice(
      bodyOpen + 1,
    );
}

fs.writeFileSync(
  SCHEDULER,
  scheduler,
  "utf8",
);

let pkg;

try {
  pkg =
    JSON.parse(
      fs.readFileSync(
        PACKAGE,
        "utf8",
      ),
    );
} catch (error) {
  fail(
    "PACKAGE_JSON_PARSE_FAILED",
    {
      error:
        String(
          error instanceof Error
            ? error.message
            : error,
        ),
    },
  );
}

if (
  !pkg.scripts ||
  typeof pkg.scripts !==
    "object"
) {
  pkg.scripts = {};
}

pkg.scripts[
  "test:true-forward-oos-automation-binding-v1"
] =
  "tsx scripts/true-forward-oos-automation-binding-v1-contract-test.ts";

pkg.scripts[
  "test:true-forward-oos-automation-binding-v1:static"
] =
  "node scripts/true-forward-oos-automation-binding-v1-static-verify.cjs";

fs.writeFileSync(
  PACKAGE,
  JSON.stringify(
    pkg,
    null,
    2,
  ) + "\n",
  "utf8",
);

console.log(JSON.stringify({
  status:
    "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_BINDING_V1_INSTALLED",
  strategy:
    "SCHEDULER_SUBPROCESS_BINDING_WITH_FAIL_CLOSED_GUARDS",
  featureFlag: {
    name:
      "FORWARD_OOS_AUTOMATION_ENABLED",
    default:
      false,
  },
  scheduleKst: {
    produce:
      "08:50",
    collect:
      "15:40",
    evaluate:
      "15:50",
    summary:
      "16:00",
  },
  safety: {
    realTradingForcedOffInSubprocess:
      true,
    ordersCreatedByBinding:
      false,
    promotionApply:
      false,
    existingTradingAutomationBlockedByOosFailure:
      false,
    databaseWritesByInstaller:
      0,
  },
  generated: [
    "lib/research/run-true-forward-oos-automation-binding-v1.ts",
    "scripts/true-forward-oos-automation-binding-v1-contract-test.ts",
    "scripts/true-forward-oos-automation-binding-v1-static-verify.cjs",
  ],
  patched: [
    "scripts/alpha-v3-automation-cycle-scheduler.ts",
    "package.json",
  ],
  nextAction:
    "RUN_CONTRACT_AND_STATIC_VERIFY",
}, null, 2));
