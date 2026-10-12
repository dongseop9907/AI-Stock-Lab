import {
  KILL_SWITCH_V1,
  evaluateKillSwitchAction,
  type KillSwitchAction,
  type KillSwitchControl,
} from "../lib/trading/kill-switch-contract";

type Scenario = {
  name: string;
  control: KillSwitchControl;
  action: KillSwitchAction;
  allowed: boolean;
  reason: string;
  mode: string;
};

const normal: KillSwitchControl = {
  emergencyStop: false,
  automationEnabled: true,
  paperOrderEnabled: true,
  realOrderEnabled: false,
};

const latched: KillSwitchControl = {
  emergencyStop: true,
  automationEnabled: true,
  paperOrderEnabled: true,
  realOrderEnabled: false,
};

const scenarios: Scenario[] = [
  {
    name: "NORMAL_PAPER_BUY_CREATE_ALLOWED",
    control: normal,
    action: "PAPER_BUY_CREATE",
    allowed: true,
    reason: "ALLOWED_NORMAL",
    mode: "NORMAL",
  },
  {
    name: "NORMAL_PAPER_BUY_EXECUTE_ALLOWED",
    control: normal,
    action: "PAPER_BUY_EXECUTE",
    allowed: true,
    reason: "ALLOWED_NORMAL",
    mode: "NORMAL",
  },
  {
    name: "REAL_ORDER_DISABLED_BLOCKS_LIVE",
    control: normal,
    action: "LIVE_ORDER_SUBMIT",
    allowed: false,
    reason: "BLOCKED_REAL_ORDER_DISABLED",
    mode: "DISABLED",
  },
  {
    name: "KILL_SWITCH_BLOCKS_PAPER_CREATE",
    control: latched,
    action: "PAPER_BUY_CREATE",
    allowed: false,
    reason: "BLOCKED_KILL_SWITCH_NEW_RISK",
    mode: "PROTECTIVE_ONLY",
  },
  {
    name: "KILL_SWITCH_BLOCKS_PAPER_EXECUTE",
    control: latched,
    action: "PAPER_BUY_EXECUTE",
    allowed: false,
    reason: "BLOCKED_KILL_SWITCH_NEW_RISK",
    mode: "PROTECTIVE_ONLY",
  },
  {
    name: "KILL_SWITCH_BLOCKS_LIVE_SUBMIT",
    control: latched,
    action: "LIVE_ORDER_SUBMIT",
    allowed: false,
    reason: "BLOCKED_KILL_SWITCH_NEW_RISK",
    mode: "PROTECTIVE_ONLY",
  },
  {
    name: "KILL_SWITCH_ALLOWS_STOP_LOSS",
    control: latched,
    action: "PROTECTIVE_STOP_LOSS_EXIT",
    allowed: true,
    reason:
      "ALLOWED_PROTECTIVE_EXIT_DURING_KILL_SWITCH",
    mode: "PROTECTIVE_ONLY",
  },
  {
    name: "KILL_SWITCH_ALLOWS_TRAILING_EXIT",
    control: latched,
    action: "PROTECTIVE_TRAILING_EXIT",
    allowed: true,
    reason:
      "ALLOWED_PROTECTIVE_EXIT_DURING_KILL_SWITCH",
    mode: "PROTECTIVE_ONLY",
  },
  {
    name: "KILL_SWITCH_ALLOWS_MAINTENANCE",
    control: latched,
    action: "RISK_MAINTENANCE",
    allowed: true,
    reason:
      "ALLOWED_RISK_MAINTENANCE_DURING_KILL_SWITCH",
    mode: "PROTECTIVE_ONLY",
  },
  {
    name: "KILL_SWITCH_ALLOWS_DATA_COLLECTION",
    control: latched,
    action: "DATA_COLLECTION",
    allowed: true,
    reason:
      "ALLOWED_OBSERVATION_DURING_KILL_SWITCH",
    mode: "PROTECTIVE_ONLY",
  },
  {
    name: "KILL_SWITCH_ALLOWS_MODEL_EVALUATION",
    control: latched,
    action: "MODEL_EVALUATION",
    allowed: true,
    reason:
      "ALLOWED_OBSERVATION_DURING_KILL_SWITCH",
    mode: "PROTECTIVE_ONLY",
  },
  {
    name: "KILL_SWITCH_ALLOWS_ENTRY_ANALYSIS_ONLY",
    control: latched,
    action: "ENTRY_ANALYSIS",
    allowed: true,
    reason:
      "ALLOWED_OBSERVATION_DURING_KILL_SWITCH",
    mode: "PROTECTIVE_ONLY",
  },
  {
    name: "AUTOMATION_DISABLED_BLOCKS_ENTRY",
    control: {
      ...normal,
      automationEnabled: false,
    },
    action: "ENTRY_ANALYSIS",
    allowed: false,
    reason: "BLOCKED_AUTOMATION_DISABLED",
    mode: "DISABLED",
  },
  {
    name: "PAPER_DISABLED_BLOCKS_CREATE",
    control: {
      ...normal,
      paperOrderEnabled: false,
    },
    action: "PAPER_BUY_CREATE",
    allowed: false,
    reason: "BLOCKED_PAPER_ORDER_DISABLED",
    mode: "DISABLED",
  },
  {
    name: "PAPER_DISABLED_BLOCKS_EXECUTE",
    control: {
      ...normal,
      paperOrderEnabled: false,
    },
    action: "PAPER_BUY_EXECUTE",
    allowed: false,
    reason: "BLOCKED_PAPER_ORDER_DISABLED",
    mode: "DISABLED",
  },
];

const results = scenarios.map(
  (scenario) => {
    const observed =
      evaluateKillSwitchAction(
        scenario.control,
        scenario.action,
      );

    return {
      name: scenario.name,
      passed:
        observed.allowed === scenario.allowed &&
        observed.reason === scenario.reason &&
        observed.mode === scenario.mode,
      expected: {
        allowed: scenario.allowed,
        reason: scenario.reason,
        mode: scenario.mode,
      },
      observed,
    };
  },
);

const failed =
  results.filter(
    (item) => !item.passed,
  );

const invariantChecks = {
  autoResetForbidden:
    KILL_SWITCH_V1
      .latchPolicy
      .automaticResetAllowed === false,

  manualResetRequired:
    KILL_SWITCH_V1
      .latchPolicy
      .manualResetRequired === true,

  resetAuditRequired:
    KILL_SWITCH_V1
      .latchPolicy
      .resetRequiresAudit === true,

  stopLossProtected:
    KILL_SWITCH_V1
      .protectiveExitSurfaces
      .some(
        (value) =>
          value.includes("stop-loss"),
      ),

  trailingProtected:
    KILL_SWITCH_V1
      .protectiveExitSurfaces
      .some(
        (value) =>
          value.includes("trailing-stop"),
      ),

  dbCreateGuardRequired:
    KILL_SWITCH_V1
      .defenseInDepthRequiredAt
      .includes("DB_CREATE_RPC"),

  dbFillGuardRequired:
    KILL_SWITCH_V1
      .defenseInDepthRequiredAt
      .includes("DB_FILL_RPC"),
};

const invariantFailures =
  Object.entries(invariantChecks)
    .filter(([, value]) => !value)
    .map(([key]) => key);

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0 &&
        invariantFailures.length === 0
          ? "ALPHA_V3_KILL_SWITCH_CONTRACT_V1_VERIFIED"
          : "ALPHA_V3_KILL_SWITCH_CONTRACT_V1_REVIEW",

      contract:
        KILL_SWITCH_V1,

      summary: {
        scenarioCount: results.length,
        passedCount:
          results.length - failed.length,
        failedCount: failed.length,
        invariantFailureCount:
          invariantFailures.length,
      },

      invariantChecks,
      invariantFailures,
      scenarios: results,

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        networkCalls: 0,
        ordersCreated: 0,
        ordersChanged: 0,
        positionsChanged: 0,
      },

      nextGate:
        failed.length === 0 &&
        invariantFailures.length === 0
          ? "BUILD_KILL_SWITCH_DB_LATCH_AND_AUDIT_FOUNDATION_V1"
          : "REVIEW_KILL_SWITCH_CONTRACT_V1",
    },
    null,
    2,
  ),
);

if (
  failed.length > 0 ||
  invariantFailures.length > 0
) {
  process.exitCode = 2;
}
