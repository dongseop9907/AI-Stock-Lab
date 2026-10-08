const fs = require("fs");
const path = require("path");

const root = process.cwd();

const file = path.resolve(
  root,
  "lib/trading/order-state-machine.ts"
);

if (!fs.existsSync(file)) {
  throw new Error(
    "ORDER_STATE_MACHINE_CONTRACT_NOT_FOUND"
  );
}

const text =
  fs.readFileSync(
    file,
    "utf8"
  );

const checks = {
  contractVersionPresent:
    text.includes(
      "ALPHA_V3_ORDER_STATE_MACHINE_V1"
    ),

  contractOnlyMode:
    text.includes(
      'enforcementMode:' +
      '\n    "CONTRACT_ONLY"'
    ) ||
    text.includes(
      '"CONTRACT_ONLY"'
    ),

  riskApprovedCanonical:
    text.includes(
      '"RISK_APPROVED"'
    ),

  riskRejectedCanonical:
    text.includes(
      '"RISK_REJECTED"'
    ),

  filledCanonical:
    text.includes(
      '"FILLED"'
    ),

  expiredCanonical:
    text.includes(
      '"EXPIRED"'
    ),

  cancelledCanonical:
    text.includes(
      '"CANCELLED"'
    ),

  canceledLegacyAlias:
    text.includes(
      'CANCELED:' +
      '\n    "CANCELLED"'
    ),

  createRiskApproved:
    /ORDER_CREATE_STATUSES[\s\S]{0,500}?"RISK_APPROVED"/m.test(
      text
    ),

  createRiskRejected:
    /ORDER_CREATE_STATUSES[\s\S]{0,500}?"RISK_REJECTED"/m.test(
      text
    ),

  createFilled:
    /ORDER_CREATE_STATUSES[\s\S]{0,500}?"FILLED"/m.test(
      text
    ),

  riskApprovedToFilled:
    /RISK_APPROVED:\s*\[[\s\S]{0,200}?"FILLED"/m.test(
      text
    ),

  riskApprovedToExpired:
    /RISK_APPROVED:\s*\[[\s\S]{0,200}?"EXPIRED"/m.test(
      text
    ),

  cancelReservedNotEnabled:
    /RESERVED_FUTURE_TRANSITIONS[\s\S]{0,300}?RISK_APPROVED:[\s\S]{0,200}?"CANCELLED"/m.test(
      text
    ),

  failedReservedNotEnabled:
    /RESERVED_FUTURE_TRANSITIONS[\s\S]{0,300}?RISK_APPROVED:[\s\S]{0,200}?"FAILED"/m.test(
      text
    ),

  validatorPresent:
    text.includes(
      "validateOrderTransition"
    ),

  terminalGuardPresent:
    text.includes(
      "TERMINAL_STATE_CANNOT_TRANSITION"
    ),

  idempotentRetryPresent:
    text.includes(
      "IDEMPOTENT_NOOP"
    ),
};

const failed =
  Object.entries(checks)
    .filter(
      ([, value]) =>
        !value
    )
    .map(
      ([key]) =>
        key
    );

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "ALPHA_V3_ORDER_STATE_MACHINE_CONTRACT_V1_STATIC_VERIFIED"
          : "ALPHA_V3_ORDER_STATE_MACHINE_CONTRACT_V1_STATIC_REVIEW",

      checks,
      failed,

      enforcementMode:
        "CONTRACT_ONLY",

      productionWritersChanged:
        false,

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
          ? "RUN_TYPECHECK_AND_CONTRACT_TEST"
          : "REVIEW_ORDER_STATE_MACHINE_CONTRACT_V1_STATIC",
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
