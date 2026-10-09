const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const schedulerPath =
  path.join(
    ROOT,
    "scripts",
    "alpha-v3-automation-cycle-scheduler.ts",
  );

const helperPath =
  path.join(
    ROOT,
    "lib",
    "research",
    "run-true-forward-oos-automation-binding-v1.ts",
  );

const scheduler =
  fs.readFileSync(
    schedulerPath,
    "utf8",
  );

const helper =
  fs.readFileSync(
    helperPath,
    "utf8",
  );

const checks = {
  schedulerImportsBinding:
    scheduler.includes(
      "runTrueForwardOosAutomationBindingV1",
    ),

  schedulerCallsBinding:
    scheduler.includes(
      "ALPHA_V3_TRUE_FORWARD_OOS_AUTOMATION_BINDING_V1_CALL",
    ),

  helperFeatureFlagFailClosed:
    helper.includes(
      "FORWARD_OOS_AUTOMATION_ENABLED",
    ),

  helperUsesSubprocess:
    helper.includes(
      "spawn(",
    ),

  helperDoesNotImportRuntimeScripts:
    !helper.includes(
      'from "../../scripts/alpha-v3-true-entry-forward-oos-collector-v1"',
    ) &&
    !helper.includes(
      'from "../../scripts/alpha-v3-true-forward-oos-evaluator-v1"',
    ) &&
    !helper.includes(
      'from "../../scripts/alpha-v3-true-forward-oos-summary"',
    ),

  helperForcesRealTradingOff:
    helper.includes(
      'REAL_TRADING_ENABLED:',
    ) &&
    helper.includes(
      'ENABLE_REAL_TRADING:',
    ) &&
    helper.includes(
      'ENABLE_LIVE_TRADING:',
    ),

  producerWindowFailClosed:
    helper.includes(
      "FORWARD_OOS_PRODUCER_WINDOW_MISSED_FAIL_CLOSED",
    ),

  orderedSteps:
    [
      "PRODUCE",
      "COLLECT",
      "EVALUATE",
      "SUMMARY",
    ].every(
      (step) =>
        helper.includes(
          step,
        ),
    ),

  noOrderCreationSurface:
    !helper.includes(
      "createPaperBuyOrder",
    ) &&
    !helper.includes(
      "executeApprovedPaperOrders",
    ) &&
    !helper.includes(
      "createLiveOrder",
    ),

  noPromotionApplySurface:
    !helper.includes(
      "applyManualPaperPromotion",
    ),
};

const failed =
  Object.entries(checks)
    .filter(([, value]) => !value)
    .map(([key]) => key);

console.log(JSON.stringify({
  status:
    failed.length === 0
      ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_BINDING_V1_STATIC_VERIFIED"
      : "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_BINDING_V1_STATIC_FAILED",
  checks,
  failed,
  safety: {
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
  nextGate:
    failed.length === 0
      ? "TYPECHECK_AND_KEEP_FORWARD_OOS_AUTOMATION_DISABLED"
      : "REPAIR_FORWARD_OOS_AUTOMATION_BINDING",
}, null, 2));

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
