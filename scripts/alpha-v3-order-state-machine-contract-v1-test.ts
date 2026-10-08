import {
  ORDER_STATE_MACHINE_V1,
  classifyOrderStatus,
  isTerminalOrderStatus,
  normalizeOrderStatus,
  validateOrderTransition,
} from "../lib/trading/order-state-machine";

type Scenario = {
  name: string;
  passed: boolean;
  observed: unknown;
};

const scenarios:
  Scenario[] = [];

function add(
  name: string,
  passed: boolean,
  observed: unknown,
) {
  scenarios.push({
    name,
    passed,
    observed,
  });
}

const createApproved =
  validateOrderTransition(
    "__CREATE__",
    "RISK_APPROVED",
  );

add(
  "CREATE_RISK_APPROVED_ALLOWED",
  createApproved.allowed ===
    true &&
    createApproved.reason ===
      "CREATE_ALLOWED",
  createApproved,
);

const createRejected =
  validateOrderTransition(
    "__CREATE__",
    "RISK_REJECTED",
  );

add(
  "CREATE_RISK_REJECTED_ALLOWED",
  createRejected.allowed ===
    true,
  createRejected,
);

const createFilled =
  validateOrderTransition(
    "__CREATE__",
    "FILLED",
  );

add(
  "DIRECT_CREATE_FILLED_ALLOWED",
  createFilled.allowed ===
    true,
  createFilled,
);

const fill =
  validateOrderTransition(
    "RISK_APPROVED",
    "FILLED",
  );

add(
  "RISK_APPROVED_TO_FILLED_ALLOWED",
  fill.allowed ===
    true &&
    fill.reason ===
      "TRANSITION_ALLOWED",
  fill,
);

const expire =
  validateOrderTransition(
    "RISK_APPROVED",
    "EXPIRED",
  );

add(
  "RISK_APPROVED_TO_EXPIRED_ALLOWED",
  expire.allowed ===
    true,
  expire,
);

const cancelNotYetEnabled =
  validateOrderTransition(
    "RISK_APPROVED",
    "CANCELLED",
  );

add(
  "CANCEL_TRANSITION_RESERVED_NOT_ENABLED",
  cancelNotYetEnabled.allowed ===
    false &&
    cancelNotYetEnabled.reason ===
      "TRANSITION_NOT_ALLOWED",
  cancelNotYetEnabled,
);

const failureNotYetEnabled =
  validateOrderTransition(
    "RISK_APPROVED",
    "FAILED",
  );

add(
  "FAILED_TRANSITION_RESERVED_NOT_ENABLED",
  failureNotYetEnabled.allowed ===
    false &&
    failureNotYetEnabled.reason ===
      "TRANSITION_NOT_ALLOWED",
  failureNotYetEnabled,
);

const terminalCannotMove =
  validateOrderTransition(
    "FILLED",
    "EXPIRED",
  );

add(
  "TERMINAL_CANNOT_TRANSITION",
  terminalCannotMove.allowed ===
    false &&
    terminalCannotMove.reason ===
      "TERMINAL_STATE_CANNOT_TRANSITION",
  terminalCannotMove,
);

const retry =
  validateOrderTransition(
    "FILLED",
    "FILLED",
  );

add(
  "SAME_STATE_RETRY_IDEMPOTENT",
  retry.allowed ===
    true &&
    retry.idempotent ===
      true,
  retry,
);

const legacyAlias =
  classifyOrderStatus(
    "CANCELED",
  );

add(
  "CANCELED_NORMALIZES_TO_CANCELLED",
  legacyAlias.kind ===
    "LEGACY_ALIAS" &&
    legacyAlias.canonical ===
      "CANCELLED" &&
    normalizeOrderStatus(
      "CANCELED",
    ) ===
      "CANCELLED",
  legacyAlias,
);

for (
  const unsupported of
    [
      "APPROVED",
      "PENDING",
      "REJECTED",
      "CLOSED",
    ]
) {
  const classification =
    classifyOrderStatus(
      unsupported,
    );

  add(
    `LEGACY_UNSUPPORTED_${unsupported}`,
    classification.kind ===
      "LEGACY_UNSUPPORTED" &&
    classification.canonical ===
      null,
    classification,
  );
}

add(
  "TERMINAL_RECOGNITION",
  [
    "RISK_REJECTED",
    "FILLED",
    "EXPIRED",
    "CANCELLED",
    "CANCELED",
    "FAILED",
  ].every(
    (status) =>
      isTerminalOrderStatus(
        status,
      ),
  ),
  ORDER_STATE_MACHINE_V1
    .terminalStatuses,
);

const failed =
  scenarios.filter(
    (scenario) =>
      !scenario.passed,
  );

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "ALPHA_V3_ORDER_STATE_MACHINE_CONTRACT_V1_VERIFIED"
          : "ALPHA_V3_ORDER_STATE_MACHINE_CONTRACT_V1_REVIEW",

      contract:
        ORDER_STATE_MACHINE_V1,

      summary: {
        scenarioCount:
          scenarios.length,

        passedCount:
          scenarios.length -
          failed.length,

        failedCount:
          failed.length,
      },

      scenarios,

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        networkCalls: 0,
        ordersCreated: 0,
        ordersChanged: 0,
        positionsChanged: 0,
      },

      nextGate:
        failed.length === 0
          ? "AUDIT_AND_BIND_PRODUCTION_ORDER_WRITERS_TO_STATE_MACHINE"
          : "REVIEW_ORDER_STATE_MACHINE_CONTRACT_V1",
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
