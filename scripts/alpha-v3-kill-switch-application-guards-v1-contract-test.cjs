const fs = require("fs");
const path = require("path");

const root = process.cwd();

function read(rel) {
  return fs.readFileSync(
    path.resolve(root, rel),
    "utf8"
  );
}

const automationRun =
  read(
    "app/api/trading/automation/run/route.ts"
  );

const paperOrder =
  read(
    "lib/trading/paper-order-service.ts"
  );

const approvedExecutor =
  read(
    "lib/trading/execute-approved-paper-orders.ts"
  );

const singleExecutor =
  read(
    "lib/trading/execute-paper-order.ts"
  );

const entrySignals =
  read(
    "lib/trading/generate-entry-signals.ts"
  );

const scenarios = [
  {
    name:
      "ENTRY_GUARD_OUTSIDE_DEFAULT_PARAMETER_OBJECT",
    passed:
      !/input:\s*GenerateEntrySignalsInput\s*=\s*\{\s*if\s*\(\s*input\.autoOrder/m.test(
        entrySignals
      )
  },
  {
    name:
      "AUTOMATION_AUTO_ORDER_REQUIRES_AUTOMATION_ENABLED",
    passed:
      /requestedAutoOrder\s*&&\s*control\.automationEnabled/m.test(
        automationRun
      )
  },
  {
    name:
      "AUTOMATION_AUTO_ORDER_REQUIRES_PAPER_ENABLED",
    passed:
      /control\.automationEnabled\s*&&\s*control\.paperOrderEnabled/m.test(
        automationRun
      )
  },
  {
    name:
      "AUTOMATION_AUTO_ORDER_BLOCKED_BY_EMERGENCY_STOP",
    passed:
      /control\.paperOrderEnabled\s*&&\s*!control\.emergencyStop/m.test(
        automationRun
      )
  },
  {
    name:
      "CREATE_SERVICE_FAIL_CLOSED_GUARD",
    passed:
      paperOrder.includes(
        'await assertKillSwitchAllows("PAPER_BUY_CREATE");'
      )
  },
  {
    name:
      "APPROVED_EXECUTOR_FAIL_CLOSED_GUARD",
    passed:
      approvedExecutor.includes(
        'await assertKillSwitchAllows("PAPER_BUY_EXECUTE");'
      )
  },
  {
    name:
      "SINGLE_EXECUTOR_FAIL_CLOSED_GUARD",
    passed:
      singleExecutor.includes(
        'await assertKillSwitchAllows("PAPER_BUY_EXECUTE");'
      )
  },
  {
    name:
      "ENTRY_AUTO_ORDER_ONLY_GUARD",
    passed:
      /if\s*\(\s*input\.autoOrder\s*===\s*true\s*\)\s*\{\s*await\s+assertKillSwitchAllows\("PAPER_BUY_CREATE"\);\s*\}/m.test(
        entrySignals
      )
  }
];

const failed =
  scenarios.filter(
    (item) => !item.passed
  );

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "ALPHA_V3_KILL_SWITCH_APPLICATION_GUARDS_V1_CONTRACT_TEST_VERIFIED"
          : "ALPHA_V3_KILL_SWITCH_APPLICATION_GUARDS_V1_CONTRACT_TEST_REVIEW",

      summary: {
        scenarioCount:
          scenarios.length,

        passedCount:
          scenarios.length -
          failed.length,

        failedCount:
          failed.length
      },

      scenarios,
      failed:
        failed.map(
          (item) => item.name
        ),

      runtimeCalls: {
        databaseReads: 0,
        databaseWrites: 0,
        networkCalls: 0,
        orderCalls: 0
      },

      nextGate:
        failed.length === 0
          ? "RUN_NO_ORDER_OPERATIONAL_REGRESSION_THEN_BIND_DB_RPC_GUARDS"
          : "REVIEW_APPLICATION_GUARD_CONTRACT"
    },
    null,
    2
  )
);

if (failed.length > 0) {
  process.exitCode = 2;
}
