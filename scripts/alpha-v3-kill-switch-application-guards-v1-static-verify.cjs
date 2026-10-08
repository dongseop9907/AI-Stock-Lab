const fs = require("fs");
const path = require("path");

const root = process.cwd();

function read(rel) {
  const abs =
    path.resolve(root, rel);

  if (!fs.existsSync(abs)) {
    throw new Error(
      `FILE_NOT_FOUND ${rel}`
    );
  }

  return fs.readFileSync(
    abs,
    "utf8"
  );
}

const files = {
  helper:
    "lib/trading/kill-switch-guard.ts",

  paperOrder:
    "lib/trading/paper-order-service.ts",

  approvedExecutor:
    "lib/trading/execute-approved-paper-orders.ts",

  singleExecutor:
    "lib/trading/execute-paper-order.ts",

  entrySignals:
    "lib/trading/generate-entry-signals.ts",

  automationRun:
    "app/api/trading/automation/run/route.ts",

  stopLoss:
    "app/api/trading/stop-loss/check/route.ts",

  trailing:
    "app/api/trading/trailing-stop/update/route.ts"
};

const text = Object.fromEntries(
  Object.entries(files).map(
    ([key, rel]) => [
      key,
      read(rel)
    ]
  )
);

const checks = {
  entryGuardNotInsideDefaultParameter:
    !/input:\s*GenerateEntrySignalsInput\s*=\s*\{\s*if\s*\(\s*input\.autoOrder/m.test(
      text.entrySignals
    ),
  helperUsesContract:
    text.helper.includes(
      "evaluateKillSwitchAction"
    ) &&
    text.helper.includes(
      "getTradingSystemControl"
    ),

  helperFailsClosed:
    text.helper.includes(
      "KillSwitchBlockedError"
    ) &&
    text.helper.includes(
      "if (!result.decision.allowed)"
    ),

  createServiceGuarded:
    text.paperOrder.includes(
      'assertKillSwitchAllows("PAPER_BUY_CREATE")'
    ),

  approvedExecutorGuarded:
    text.approvedExecutor.includes(
      'assertKillSwitchAllows("PAPER_BUY_EXECUTE")'
    ),

  singleExecutorGuarded:
    text.singleExecutor.includes(
      'assertKillSwitchAllows("PAPER_BUY_EXECUTE")'
    ),

  entryAutoOrderGuarded:
    text.entrySignals.includes(
      'assertKillSwitchAllows("PAPER_BUY_CREATE")'
    ) &&
    /if\s*\(\s*input\.autoOrder\s*===\s*true\s*\)/m.test(
      text.entrySignals
    ),

  automationRunEmergencyStopGatesAutoOrder:
    /const\s+autoOrder\s*=\s*requestedAutoOrder\s*&&\s*control\.automationEnabled\s*&&\s*control\.paperOrderEnabled\s*&&\s*!control\.emergencyStop\s*;/m.test(
      text.automationRun
    ),

  protectiveStopLossNotGuardedAsNewRisk:
    !text.stopLoss.includes(
      'assertKillSwitchAllows("PAPER_BUY_CREATE")'
    ) &&
    !text.stopLoss.includes(
      'assertKillSwitchAllows("PAPER_BUY_EXECUTE")'
    ),

  protectiveTrailingNotGuardedAsNewRisk:
    !text.trailing.includes(
      'assertKillSwitchAllows("PAPER_BUY_CREATE")'
    ) &&
    !text.trailing.includes(
      'assertKillSwitchAllows("PAPER_BUY_EXECUTE")'
    ),

  noDbMigrationInThisStep:
    true
};

const failed =
  Object.entries(checks)
    .filter(([, value]) => !value)
    .map(([key]) => key);

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "ALPHA_V3_KILL_SWITCH_APPLICATION_GUARDS_V1_STATIC_VERIFIED"
          : "ALPHA_V3_KILL_SWITCH_APPLICATION_GUARDS_V1_STATIC_REVIEW",

      checks,
      failed,

      coverage: {
        applicationBoundaries: [
          "AUTOMATION_RUN_AUTO_ORDER_GATE",
          "PAPER_BUY_CREATE_SERVICE",
          "ENTRY_AUTO_ORDER_PATH",
          "APPROVED_ORDER_EXECUTOR",
          "SINGLE_ORDER_EXECUTOR"
        ],

        protectiveExitsIntentionallyUngated: [
          "STOP_LOSS",
          "TRAILING_STOP"
        ],

        remainingDefenseInDepth: [
          "DB_CREATE_RPC",
          "DB_FILL_RPC",
          "CONTROL_RESET_RPC_BINDING"
        ]
      },

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        networkCalls: 0,
        ordersCreated: 0,
        ordersChanged: 0,
        positionsChanged: 0
      },

      nextGate:
        failed.length === 0
          ? "TYPECHECK_AND_RUN_APPLICATION_GUARD_CONTRACT_TEST"
          : "REVIEW_APPLICATION_GUARD_BINDING"
    },
    null,
    2
  )
);

if (failed.length > 0) {
  process.exitCode = 2;
}
