const fs = require("fs");
const path = require("path");

const root =
  process.cwd();

function read(rel) {
  const file =
    path.resolve(
      root,
      rel,
    );

  if (!fs.existsSync(file)) {
    return "";
  }

  return fs.readFileSync(
    file,
    "utf8",
  );
}

const cycle =
  read(
    "app/api/trading/automation/cycle/route.ts",
  );

const run =
  read(
    "app/api/trading/automation/run/route.ts",
  );

const manual =
  read(
    "app/api/trading/automation/manual/route.ts",
  );

const panel =
  read(
    "app/components/AutomationRunPanel.tsx",
  );

const cycleExecutorCallPattern =
  /await\s+executeApprovedPaperOrders\s*\(/m;

const checks = {
  innerRunOwnsApprovedExecution:
    run.includes(
      "/api/orders/paper/execute-approved",
    ) &&
    run.includes(
      "if (autoOrder)",
    ),

  cycleNoSecondApprovedExecutorCall:
    !cycleExecutorCallPattern.test(
      cycle,
    ),

  cycleStillCallsAutomationRun:
    cycle.includes(
      "/api/trading/automation/run",
    ),

  cycleDetectsSemanticFailure:
    cycle.includes(
      "automationSemanticFailure",
    ) &&
    cycle.includes(
      "PARTIAL_FAILURE",
    ) &&
    cycle.includes(
      "\"FAILED\"",
    ),

  cycleSemanticFailureFailsClosed:
    /!automationResponse\.ok\s*\|\|\s*automationSemanticFailure/m.test(
      cycle,
    ),

  cycleStillRunsPostMaintenance:
    cycle.includes(
      "phase:" +
      "\n" +
      "            \"POST_EXECUTION\"",
    ) ||
    cycle.includes(
      "\"POST_EXECUTION\"",
    ),

  probeOnlyStillPresent:
    cycle.includes(
      "ALPHA_V3_PROBE_ONLY_V1",
    ),

  manualProxyExists:
    manual.length > 0,

  manualProxyUsesServerSecret:
    manual.includes(
      "TRADING_AUTOMATION_SECRET",
    ) &&
    manual.includes(
      "\"x-automation-secret\"",
    ),

  manualProxyForwardsToCycle:
    manual.includes(
      "/api/trading/automation/cycle",
    ),

  manualProxyForcesManualTrigger:
    manual.includes(
      "triggerType:" +
      "\n" +
      "      \"MANUAL\"",
    ) ||
    manual.includes(
      'triggerType: "MANUAL"',
    ),

  manualProxySanitizesControls:
    manual.includes(
      "includeMarketSync",
    ) &&
    manual.includes(
      "autoOrder",
    ) &&
    manual.includes(
      "maxOrders",
    ) &&
    !manual.includes(
      "probeOnly?:",
    ),

  manualProxyChecksOrigin:
    manual.includes(
      "AUTOMATION_MANUAL_ORIGIN_REJECTED",
    ),

  panelCallsManualProxy:
    panel.includes(
      "/api/trading/automation/manual",
    ),

  panelNoLongerCallsCycleDirectly:
    !panel.includes(
      "/api/trading/automation/cycle",
    ),

  panelDoesNotExposeAutomationSecret:
    !panel.includes(
      "TRADING_AUTOMATION_SECRET",
    ) &&
    !panel.includes(
      "x-automation-secret",
    ),
};

const failed =
  Object.entries(checks)
    .filter(
      ([, value]) =>
        !value,
    )
    .map(
      ([key]) =>
        key,
    );

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "ALPHA_V3_SINGLE_EXECUTOR_AND_UI_PROXY_STATIC_VERIFIED"
          : "ALPHA_V3_SINGLE_EXECUTOR_AND_UI_PROXY_STATIC_REVIEW",

      checks,
      failed,

      contract: {
        approvedExecutionOwner:
          "AUTOMATION_RUN_ONLY",

        autoOrderFalse:
          "NO_ORDER_CREATION_NO_APPROVED_EXECUTION",

        autoOrderTrue:
          "AUTOMATION_RUN_CREATES_AND_EXECUTES_APPROVED_ORDERS_ONCE",

        cycle:
          "PRE_MAINTENANCE -> AUTOMATION_RUN -> POST_MAINTENANCE",

        semanticFailure:
          "FAILED_OR_PARTIAL_FAILURE_IS_FAIL_CLOSED",

        ui:
          "BROWSER -> SERVER_MANUAL_PROXY -> SECRET_PROTECTED_CYCLE",
      },

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        networkCalls: 0,
        cyclePostRequests: 0,
        ordersCreated: 0,
        ordersChanged: 0,
        positionsChanged: 0,
      },

      nextGate:
        failed.length === 0
          ? "RUN_V2_MOCK_CONTRACT_TEST"
          : "REVIEW_SINGLE_EXECUTOR_AND_UI_PROXY_PATCH",
    },
    null,
    2,
  ),
);

if (
  failed.length > 0
) {
  process.exitCode =
    2;
}
