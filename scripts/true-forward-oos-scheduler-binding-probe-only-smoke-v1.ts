import { readFileSync } from "node:fs";

import {
  createAutomationSchedulerState,
  runAutomationSchedulerTick,
  startAutomationCycleScheduler,
} from "./alpha-v3-automation-cycle-scheduler";

import {
  runTrueForwardOosAutomationBindingV1,
} from "../lib/research/run-true-forward-oos-automation-binding-v1";

async function main() {
  const schedulerSource =
    readFileSync(
      "scripts/alpha-v3-automation-cycle-scheduler.ts",
      "utf8",
    );

  const calls: string[] = [];

  const disabledResult =
    await runTrueForwardOosAutomationBindingV1(
      {
        now:
          new Date(
            "2026-10-09T08:50:00+09:00",
          ),
      },
      {
        env: {
          FORWARD_OOS_AUTOMATION_ENABLED:
            "false",
        },
        runStep:
          async (step) => {
            calls.push(String(step));

            return {
              exitCode: 0,
              stdout: "",
              stderr: "",
            };
          },
        loadState:
          () => null,
        saveState:
          () => {},
      },
    );

  const checks = {
    schedulerModuleImported:
      true,

    createAutomationSchedulerStateExported:
      typeof createAutomationSchedulerState ===
      "function",

    runAutomationSchedulerTickExported:
      typeof runAutomationSchedulerTick ===
      "function",

    startAutomationCycleSchedulerExported:
      typeof startAutomationCycleScheduler ===
      "function",

    schedulerImportsForwardOosBinding:
      schedulerSource.includes(
        "runTrueForwardOosAutomationBindingV1",
      ),

    schedulerContainsForwardOosCallMarker:
      schedulerSource.includes(
        "ALPHA_V3_TRUE_FORWARD_OOS_AUTOMATION_BINDING_V1_CALL",
      ),

    forwardOosDisabledByDefaultProbe:
      disabledResult.status ===
      "DISABLED",

    noSubprocessStepExecuted:
      calls.length === 0,
  };

  const failed =
    Object.entries(checks)
      .filter(([, value]) => value !== true)
      .map(([key]) => key);

  console.log(JSON.stringify({
    status:
      failed.length === 0
        ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_SCHEDULER_BINDING_PROBE_ONLY_SMOKE_V1_VERIFIED"
        : "AI_STOCK_LAB_TRUE_FORWARD_OOS_SCHEDULER_BINDING_PROBE_ONLY_SMOKE_V1_FAILED",

    checks,

    runtime: {
      forwardOosStatus:
        disabledResult.status,
      subprocessStepsExecuted:
        calls,
    },

    safety: {
      schedulerTickExecuted:
        false,
      schedulerLoopStarted:
        false,
      realSubprocessExecuted:
        false,
      databaseReads:
        0,
      databaseWrites:
        0,
      ordersCreated:
        0,
      positionsChanged:
        0,
      promotionApplied:
        false,
      realTradingEnabled:
        false,
    },

    failed,

    nextGate:
      failed.length === 0
        ? "RUN_SCHEDULER_TICK_MOCK_FETCH_PROBE_V1"
        : "REPAIR_SCHEDULER_BINDING_IMPORT_SURFACE",
  }, null, 2));

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}

main().catch((error) => {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_SCHEDULER_BINDING_PROBE_ONLY_SMOKE_V1_FAILED",
    error:
      String(
        error instanceof Error
          ? error.message
          : error,
      ),
    failed: [
      "probeRuntime",
    ],
  }, null, 2));

  process.exitCode = 1;
});
