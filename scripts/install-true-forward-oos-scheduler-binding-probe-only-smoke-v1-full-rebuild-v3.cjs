const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const TARGET = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-scheduler-binding-probe-only-smoke-v1.ts"
);

const BACKUP = path.join(
  ROOT,
  "scripts",
  "backups",
  "true-forward-oos-scheduler-binding-probe-only-smoke-v1.before-full-rebuild-v3.ts"
);

function printFail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_SCHEDULER_BINDING_PROBE_ONLY_SMOKE_V1_FULL_REBUILD_V3_FAILED",
    reason,
    ...extra
  }, null, 2));

  process.exitCode = 1;
}

const scheduler = path.join(
  ROOT,
  "scripts",
  "alpha-v3-automation-cycle-scheduler.ts"
);

const helper = path.join(
  ROOT,
  "lib",
  "research",
  "run-true-forward-oos-automation-binding-v1.ts"
);

if (!fs.existsSync(scheduler)) {
  printFail("SCHEDULER_NOT_FOUND");
} else if (!fs.existsSync(helper)) {
  printFail("FORWARD_OOS_BINDING_HELPER_NOT_FOUND");
} else {
  fs.mkdirSync(
    path.dirname(BACKUP),
    { recursive: true }
  );

  if (
    fs.existsSync(TARGET) &&
    !fs.existsSync(BACKUP)
  ) {
    fs.copyFileSync(
      TARGET,
      BACKUP
    );
  }

  fs.writeFileSync(
    TARGET,
    "import { readFileSync } from \"node:fs\";\n\nimport {\n  createAutomationSchedulerState,\n  runAutomationSchedulerTick,\n  startAutomationCycleScheduler,\n} from \"./alpha-v3-automation-cycle-scheduler\";\n\nimport {\n  runTrueForwardOosAutomationBindingV1,\n} from \"../lib/research/run-true-forward-oos-automation-binding-v1\";\n\nasync function main() {\n  const schedulerSource =\n    readFileSync(\n      \"scripts/alpha-v3-automation-cycle-scheduler.ts\",\n      \"utf8\",\n    );\n\n  const calls: string[] = [];\n\n  const disabledResult =\n    await runTrueForwardOosAutomationBindingV1(\n      {\n        now:\n          new Date(\n            \"2026-10-09T08:50:00+09:00\",\n          ),\n      },\n      {\n        env: {\n          FORWARD_OOS_AUTOMATION_ENABLED:\n            \"false\",\n        },\n        runStep:\n          async (step) => {\n            calls.push(String(step));\n\n            return {\n              exitCode: 0,\n              stdout: \"\",\n              stderr: \"\",\n            };\n          },\n        loadState:\n          () => null,\n        saveState:\n          () => {},\n      },\n    );\n\n  const checks = {\n    schedulerModuleImported:\n      true,\n\n    createAutomationSchedulerStateExported:\n      typeof createAutomationSchedulerState ===\n      \"function\",\n\n    runAutomationSchedulerTickExported:\n      typeof runAutomationSchedulerTick ===\n      \"function\",\n\n    startAutomationCycleSchedulerExported:\n      typeof startAutomationCycleScheduler ===\n      \"function\",\n\n    schedulerImportsForwardOosBinding:\n      schedulerSource.includes(\n        \"runTrueForwardOosAutomationBindingV1\",\n      ),\n\n    schedulerContainsForwardOosCallMarker:\n      schedulerSource.includes(\n        \"ALPHA_V3_TRUE_FORWARD_OOS_AUTOMATION_BINDING_V1_CALL\",\n      ),\n\n    forwardOosDisabledByDefaultProbe:\n      disabledResult.status ===\n      \"DISABLED\",\n\n    noSubprocessStepExecuted:\n      calls.length === 0,\n  };\n\n  const failed =\n    Object.entries(checks)\n      .filter(([, value]) => value !== true)\n      .map(([key]) => key);\n\n  console.log(JSON.stringify({\n    status:\n      failed.length === 0\n        ? \"AI_STOCK_LAB_TRUE_FORWARD_OOS_SCHEDULER_BINDING_PROBE_ONLY_SMOKE_V1_VERIFIED\"\n        : \"AI_STOCK_LAB_TRUE_FORWARD_OOS_SCHEDULER_BINDING_PROBE_ONLY_SMOKE_V1_FAILED\",\n\n    checks,\n\n    runtime: {\n      forwardOosStatus:\n        disabledResult.status,\n      subprocessStepsExecuted:\n        calls,\n    },\n\n    safety: {\n      schedulerTickExecuted:\n        false,\n      schedulerLoopStarted:\n        false,\n      realSubprocessExecuted:\n        false,\n      databaseReads:\n        0,\n      databaseWrites:\n        0,\n      ordersCreated:\n        0,\n      positionsChanged:\n        0,\n      promotionApplied:\n        false,\n      realTradingEnabled:\n        false,\n    },\n\n    failed,\n\n    nextGate:\n      failed.length === 0\n        ? \"RUN_SCHEDULER_TICK_MOCK_FETCH_PROBE_V1\"\n        : \"REPAIR_SCHEDULER_BINDING_IMPORT_SURFACE\",\n  }, null, 2));\n\n  process.exitCode =\n    failed.length === 0\n      ? 0\n      : 1;\n}\n\nmain().catch((error) => {\n  console.error(JSON.stringify({\n    status:\n      \"AI_STOCK_LAB_TRUE_FORWARD_OOS_SCHEDULER_BINDING_PROBE_ONLY_SMOKE_V1_FAILED\",\n    error:\n      String(\n        error instanceof Error\n          ? error.message\n          : error,\n      ),\n    failed: [\n      \"probeRuntime\",\n    ],\n  }, null, 2));\n\n  process.exitCode = 1;\n});\n",
    "utf8"
  );

  console.log(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_SCHEDULER_BINDING_PROBE_ONLY_SMOKE_V1_FULL_REBUILD_V3_INSTALLED",
    repair:
      "REBUILD_SMOKE_TEST_WITH_STATIC_FS_IMPORT_AND_ASYNC_MAIN",
    target:
      "scripts/true-forward-oos-scheduler-binding-probe-only-smoke-v1.ts",
    backup:
      "scripts/backups/true-forward-oos-scheduler-binding-probe-only-smoke-v1.before-full-rebuild-v3.ts",
    productCodeChanged:
      false,
    safety: {
      schedulerTickExecuted:
        false,
      schedulerLoopStarted:
        false,
      realSubprocessExecuted:
        false,
      databaseWrites:
        0,
      ordersCreated:
        0,
      positionsChanged:
        0,
      promotionApplied:
        false,
      realTradingEnabled:
        false
    },
    nextAction:
      "RERUN_PROBE_ONLY_SMOKE"
  }, null, 2));
}
