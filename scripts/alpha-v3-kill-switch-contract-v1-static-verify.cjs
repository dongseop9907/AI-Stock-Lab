const fs = require("fs");
const path = require("path");

const root = process.cwd();

const file = path.resolve(
  root,
  "lib/trading/kill-switch-contract.ts"
);

if (!fs.existsSync(file)) {
  throw new Error(
    "KILL_SWITCH_CONTRACT_NOT_FOUND"
  );
}

const text =
  fs.readFileSync(file, "utf8");

const checks = {
  versionPresent:
    text.includes(
      "ALPHA_V3_KILL_SWITCH_V1"
    ),

  authoritativeSource:
    text.includes(
      "trading_system_control.emergency_stop"
    ),

  blocksPaperCreate:
    text.includes(
      '"PAPER_BUY_CREATE"'
    ),

  blocksPaperExecute:
    text.includes(
      '"PAPER_BUY_EXECUTE"'
    ),

  blocksLiveSubmit:
    text.includes(
      '"LIVE_ORDER_SUBMIT"'
    ),

  protectiveStopLoss:
    text.includes(
      '"PROTECTIVE_STOP_LOSS_EXIT"'
    ),

  protectiveTrailing:
    text.includes(
      '"PROTECTIVE_TRAILING_EXIT"'
    ),

  maintenanceAllowed:
    text.includes(
      '"RISK_MAINTENANCE"'
    ),

  autoResetForbidden:
    /automaticResetAllowed:\s*false/m.test(
      text
    ),

  manualResetRequired:
    /manualResetRequired:\s*true/m.test(
      text
    ),

  resetReasonRequired:
    /resetRequiresReason:\s*true/m.test(
      text
    ),

  resetActorRequired:
    /resetRequiresActor:\s*true/m.test(
      text
    ),

  resetAuditRequired:
    /resetRequiresAudit:\s*true/m.test(
      text
    ),

  dbCreateGuardRequired:
    text.includes(
      '"DB_CREATE_RPC"'
    ),

  dbFillGuardRequired:
    text.includes(
      '"DB_FILL_RPC"'
    ),

  noHardShutdownV1:
    text.includes(
      '"NOT_PART_OF_V1"'
    ),
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
          ? "ALPHA_V3_KILL_SWITCH_CONTRACT_V1_STATIC_VERIFIED"
          : "ALPHA_V3_KILL_SWITCH_CONTRACT_V1_STATIC_REVIEW",

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
          ? "RUN_TYPECHECK_AND_KILL_SWITCH_CONTRACT_TEST"
          : "REVIEW_KILL_SWITCH_CONTRACT_V1_STATIC",
    },
    null,
    2,
  ),
);

if (failed.length > 0) {
  process.exitCode = 2;
}
