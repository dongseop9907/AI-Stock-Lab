export const KILL_SWITCH_CONTRACT_VERSION =
  "ALPHA_V3_KILL_SWITCH_V1" as const;

export type KillSwitchAction =
  | "DATA_COLLECTION"
  | "MODEL_EVALUATION"
  | "ENTRY_ANALYSIS"
  | "RISK_MAINTENANCE"
  | "PROTECTIVE_STOP_LOSS_EXIT"
  | "PROTECTIVE_TRAILING_EXIT"
  | "PAPER_BUY_CREATE"
  | "PAPER_BUY_EXECUTE"
  | "LIVE_ORDER_SUBMIT";

export type KillSwitchControl = {
  emergencyStop: boolean;
  automationEnabled: boolean;
  paperOrderEnabled: boolean;
  realOrderEnabled: boolean;
};

export type KillSwitchDecision = {
  allowed: boolean;
  mode:
    | "NORMAL"
    | "PROTECTIVE_ONLY"
    | "DISABLED";
  reason:
    | "ALLOWED_NORMAL"
    | "ALLOWED_OBSERVATION_DURING_KILL_SWITCH"
    | "ALLOWED_PROTECTIVE_EXIT_DURING_KILL_SWITCH"
    | "ALLOWED_RISK_MAINTENANCE_DURING_KILL_SWITCH"
    | "BLOCKED_KILL_SWITCH_NEW_RISK"
    | "BLOCKED_AUTOMATION_DISABLED"
    | "BLOCKED_PAPER_ORDER_DISABLED"
    | "BLOCKED_REAL_ORDER_DISABLED";
};

export const KILL_SWITCH_BLOCKED_NEW_RISK_ACTIONS =
  [
    "PAPER_BUY_CREATE",
    "PAPER_BUY_EXECUTE",
    "LIVE_ORDER_SUBMIT",
  ] as const satisfies readonly KillSwitchAction[];

export const KILL_SWITCH_PROTECTIVE_ACTIONS =
  [
    "PROTECTIVE_STOP_LOSS_EXIT",
    "PROTECTIVE_TRAILING_EXIT",
    "RISK_MAINTENANCE",
  ] as const satisfies readonly KillSwitchAction[];

export const KILL_SWITCH_OBSERVATION_ACTIONS =
  [
    "DATA_COLLECTION",
    "MODEL_EVALUATION",
    "ENTRY_ANALYSIS",
  ] as const satisfies readonly KillSwitchAction[];

const blockedNewRiskSet =
  new Set<KillSwitchAction>(
    KILL_SWITCH_BLOCKED_NEW_RISK_ACTIONS,
  );

const protectiveSet =
  new Set<KillSwitchAction>(
    KILL_SWITCH_PROTECTIVE_ACTIONS,
  );

const observationSet =
  new Set<KillSwitchAction>(
    KILL_SWITCH_OBSERVATION_ACTIONS,
  );

export function evaluateKillSwitchAction(
  control: KillSwitchControl,
  action: KillSwitchAction,
): KillSwitchDecision {
  if (control.emergencyStop) {
    if (blockedNewRiskSet.has(action)) {
      return {
        allowed: false,
        mode: "PROTECTIVE_ONLY",
        reason: "BLOCKED_KILL_SWITCH_NEW_RISK",
      };
    }

    if (protectiveSet.has(action)) {
      if (action === "RISK_MAINTENANCE") {
        return {
          allowed: true,
          mode: "PROTECTIVE_ONLY",
          reason:
            "ALLOWED_RISK_MAINTENANCE_DURING_KILL_SWITCH",
        };
      }

      return {
        allowed: true,
        mode: "PROTECTIVE_ONLY",
        reason:
          "ALLOWED_PROTECTIVE_EXIT_DURING_KILL_SWITCH",
      };
    }

    if (observationSet.has(action)) {
      return {
        allowed: true,
        mode: "PROTECTIVE_ONLY",
        reason:
          "ALLOWED_OBSERVATION_DURING_KILL_SWITCH",
      };
    }
  }

  if (
    !control.automationEnabled &&
    (
      action === "ENTRY_ANALYSIS" ||
      action === "PAPER_BUY_CREATE" ||
      action === "PAPER_BUY_EXECUTE" ||
      action === "LIVE_ORDER_SUBMIT"
    )
  ) {
    return {
      allowed: false,
      mode: "DISABLED",
      reason: "BLOCKED_AUTOMATION_DISABLED",
    };
  }

  if (
    (
      action === "PAPER_BUY_CREATE" ||
      action === "PAPER_BUY_EXECUTE"
    ) &&
    !control.paperOrderEnabled
  ) {
    return {
      allowed: false,
      mode: "DISABLED",
      reason: "BLOCKED_PAPER_ORDER_DISABLED",
    };
  }

  if (
    action === "LIVE_ORDER_SUBMIT" &&
    !control.realOrderEnabled
  ) {
    return {
      allowed: false,
      mode: "DISABLED",
      reason: "BLOCKED_REAL_ORDER_DISABLED",
    };
  }

  return {
    allowed: true,
    mode: "NORMAL",
    reason: "ALLOWED_NORMAL",
  };
}

export const KILL_SWITCH_V1 = {
  version: KILL_SWITCH_CONTRACT_VERSION,

  authoritativeSource:
    "trading_system_control.emergency_stop",

  latchPolicy: {
    automaticTripAllowed: true,
    automaticResetAllowed: false,
    manualResetRequired: true,
    resetRequiresReason: true,
    resetRequiresActor: true,
    resetRequiresTimestamp: true,
    resetRequiresAudit: true,
  },

  semantics: {
    emergencyStopTrue:
      "BLOCK_ALL_NEW_RISK_BUT_KEEP_RISK_REDUCING_AND_OBSERVATIONAL_WORK",

    schedulerPolicy:
      "SCHEDULER_MAY_CONTINUE_CALLING_CYCLE_BUT_NEW_RISK_ACTIONS_MUST_FAIL_CLOSED_AT_MULTIPLE_BOUNDARIES",

    automationCyclePolicy:
      "WHEN_LATCHED_RUN_MAINTENANCE_OBSERVATION_AND_PROTECTIVE_EXITS_ONLY",

    stopLossPolicy:
      "ALWAYS_ALLOW_PROTECTIVE_STOP_LOSS_EXIT_WHILE_KILL_SWITCH_IS_LATCHED",

    trailingStopPolicy:
      "ALWAYS_ALLOW_PROTECTIVE_TRAILING_EXIT_WHILE_KILL_SWITCH_IS_LATCHED",

    hardShutdownMode:
      "NOT_PART_OF_V1",
  },

  defenseInDepthRequiredAt: [
    "AUTOMATION_RUN_BOUNDARY",
    "PAPER_ORDER_CREATE_SERVICE",
    "APPROVED_ORDER_EXECUTOR",
    "SINGLE_ORDER_EXECUTOR",
    "DB_CREATE_RPC",
    "DB_FILL_RPC",
  ],

  knownProductionGuardGapsFromProbeV2: [
    "app/api/trading/automation/cycle/route.ts",
    "app/api/trading/automation/manual/route.ts",
    "app/api/orders/paper/route.ts",
    "app/api/orders/paper/execute/route.ts",
    "app/api/orders/paper/execute-approved/route.ts",
    "lib/trading/paper-order-service.ts",
    "lib/trading/committed-risk-reservation.ts",
    "lib/trading/execute-approved-paper-orders.ts",
    "lib/trading/execute-paper-order.ts",
    "lib/trading/generate-entry-signals.ts",
    "scripts/alpha-v3-automation-cycle-scheduler.ts",
  ],

  protectiveExitSurfaces: [
    "app/api/trading/stop-loss/check/route.ts",
    "app/api/trading/trailing-stop/update/route.ts",
  ],

  invariants: [
    "KILL_SWITCH_CAN_AUTO_TRIP_BUT_CAN_NEVER_AUTO_RESET",
    "KILL_SWITCH_BLOCKS_NEW_RISK_AT_APPLICATION_AND_DATABASE_BOUNDARIES",
    "KILL_SWITCH_DOES_NOT_BLOCK_STOP_LOSS_OR_TRAILING_PROTECTIVE_EXITS",
    "KILL_SWITCH_DOES_NOT_BLOCK_RISK_RECONCILIATION_OR_RESERVATION_RELEASE",
    "OBSERVATIONAL_DATA_AND_MODEL_EVALUATION_MAY_CONTINUE_WHILE_LATCHED",
    "MANUAL_RESET_REQUIRES_REASON_ACTOR_TIMESTAMP_AND_AUDIT",
    "DIRECT_ORDER_ENDPOINTS_MUST_NOT_BYPASS_THE_KILL_SWITCH",
    "DB_CREATE_AND_FILL_RPCS_MUST_FAIL_CLOSED_WHEN_LATCHED",
  ],
} as const;
