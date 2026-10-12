const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const SCRIPTS = path.join(ROOT, "scripts");
const PACKAGE = path.join(ROOT, "package.json");
const BACKUPS = path.join(SCRIPTS, "backups");

const TARGET = path.join(
  SCRIPTS,
  "true-forward-oos-scheduler-binding-probe-only-smoke-v1.ts"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_SCHEDULER_BINDING_PROBE_ONLY_SMOKE_V1_INSTALL_FAILED",
    reason,
    ...extra
  }, null, 2));
  process.exit(1);
}

const required = [
  "scripts/alpha-v3-automation-cycle-scheduler.ts",
  "lib/research/run-true-forward-oos-automation-binding-v1.ts",
  "package.json"
];

const missing =
  required.filter(
    rel =>
      !fs.existsSync(
        path.join(ROOT, rel)
      )
  );

if (missing.length > 0) {
  fail(
    "REQUIRED_FILES_MISSING",
    { missing }
  );
}

fs.mkdirSync(
  BACKUPS,
  { recursive: true }
);

const packageBackup =
  path.join(
    BACKUPS,
    "package.before-true-forward-oos-scheduler-binding-probe-only-smoke-v1.json"
  );

if (!fs.existsSync(packageBackup)) {
  fs.copyFileSync(
    PACKAGE,
    packageBackup
  );
}

fs.writeFileSync(
  TARGET,
  "import {\n  createAutomationSchedulerState,\n  runAutomationSchedulerTick,\n  startAutomationCycleScheduler,\n} from \"./alpha-v3-automation-cycle-scheduler\";\n\nimport {\n  runTrueForwardOosAutomationBindingV1,\n  type ForwardOosAutomationStep,\n} from \"../lib/research/run-true-forward-oos-automation-binding-v1\";\n\nconst schedulerSource =\n  await import(\"node:fs\").then(\n    ({ readFileSync }) =>\n      readFileSync(\n        \"scripts/alpha-v3-automation-cycle-scheduler.ts\",\n        \"utf8\",\n      ),\n  );\n\nconst calls:\n  ForwardOosAutomationStep[] =\n    [];\n\nconst disabledResult =\n  await runTrueForwardOosAutomationBindingV1(\n    {\n      now:\n        new Date(\n          \"2026-10-09T08:50:00+09:00\",\n        ),\n    },\n    {\n      env: {\n        FORWARD_OOS_AUTOMATION_ENABLED:\n          \"false\",\n      },\n      runStep:\n        async (step) => {\n          calls.push(step);\n\n          return {\n            exitCode: 0,\n            stdout: \"\",\n            stderr: \"\",\n          };\n        },\n      loadState:\n        () => null,\n      saveState:\n        () => {},\n    },\n  );\n\nconst checks = {\n  schedulerModuleImported:\n    true,\n\n  createAutomationSchedulerStateExported:\n    typeof createAutomationSchedulerState ===\n    \"function\",\n\n  runAutomationSchedulerTickExported:\n    typeof runAutomationSchedulerTick ===\n    \"function\",\n\n  startAutomationCycleSchedulerExported:\n    typeof startAutomationCycleScheduler ===\n    \"function\",\n\n  schedulerImportsForwardOosBinding:\n    schedulerSource.includes(\n      \"runTrueForwardOosAutomationBindingV1\",\n    ),\n\n  schedulerContainsForwardOosCallMarker:\n    schedulerSource.includes(\n      \"ALPHA_V3_TRUE_FORWARD_OOS_AUTOMATION_BINDING_V1_CALL\",\n    ),\n\n  forwardOosDisabledByDefaultProbe:\n    disabledResult.status ===\n    \"DISABLED\",\n\n  noSubprocessStepExecuted:\n    calls.length === 0,\n};\n\nconst failed =\n  Object.entries(checks)\n    .filter(([, value]) => value !== true)\n    .map(([key]) => key);\n\nconsole.log(JSON.stringify({\n  status:\n    failed.length === 0\n      ? \"AI_STOCK_LAB_TRUE_FORWARD_OOS_SCHEDULER_BINDING_PROBE_ONLY_SMOKE_V1_VERIFIED\"\n      : \"AI_STOCK_LAB_TRUE_FORWARD_OOS_SCHEDULER_BINDING_PROBE_ONLY_SMOKE_V1_FAILED\",\n\n  checks,\n\n  runtime: {\n    forwardOosStatus:\n      disabledResult.status,\n    subprocessStepsExecuted:\n      calls,\n  },\n\n  safety: {\n    schedulerTickExecuted:\n      false,\n    schedulerLoopStarted:\n      false,\n    realSubprocessExecuted:\n      false,\n    databaseReads:\n      0,\n    databaseWrites:\n      0,\n    ordersCreated:\n      0,\n    positionsChanged:\n      0,\n    promotionApplied:\n      false,\n    realTradingEnabled:\n      false,\n  },\n\n  failed,\n\n  nextGate:\n    failed.length === 0\n      ? \"RUN_SCHEDULER_TICK_MOCK_FETCH_PROBE_V1\"\n      : \"REPAIR_SCHEDULER_BINDING_IMPORT_SURFACE\",\n}, null, 2));\n\nprocess.exitCode =\n  failed.length === 0\n    ? 0\n    : 1;\n",
  "utf8"
);

let pkg =
  JSON.parse(
    fs.readFileSync(
      PACKAGE,
      "utf8"
    )
  );

if (
  !pkg.scripts ||
  typeof pkg.scripts !== "object"
) {
  pkg.scripts = {};
}

pkg.scripts[
  "test:true-forward-oos-scheduler-binding-smoke"
] =
  "tsx scripts/true-forward-oos-scheduler-binding-probe-only-smoke-v1.ts";

fs.writeFileSync(
  PACKAGE,
  JSON.stringify(
    pkg,
    null,
    2
  ) + "\n",
  "utf8"
);

console.log(JSON.stringify({
  status:
    "AI_STOCK_LAB_TRUE_FORWARD_OOS_SCHEDULER_BINDING_PROBE_ONLY_SMOKE_V1_INSTALLED",
  generatedFile:
    "scripts/true-forward-oos-scheduler-binding-probe-only-smoke-v1.ts",
  packageScript:
    "npm run test:true-forward-oos-scheduler-binding-smoke",
  safety: {
    schedulerTickExecuted: false,
    schedulerLoopStarted: false,
    realSubprocessExecuted: false,
    databaseWrites: 0,
    ordersCreated: 0,
    positionsChanged: 0,
    realTradingEnable: false
  },
  nextAction:
    "RUN_COMPACT_PROBE_ONLY_SMOKE"
}, null, 2));
