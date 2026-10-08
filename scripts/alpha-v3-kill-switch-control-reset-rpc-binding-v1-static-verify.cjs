const fs = require("fs");
const path = require("path");

const root = process.cwd();

const rel =
  "app/api/trading/system/control/route.ts";

const text =
  fs.readFileSync(
    path.resolve(root, rel),
    "utf8"
  );

const resumeMatch =
  text.match(
    /case\s+"RESUME_AUTOMATION"\s*:\s*\{[\s\S]*?\n\s*break;\s*\n\s*\}/m
  );

const resumeBlock =
  resumeMatch?.[0] ?? "";

const checks = {
  bindingMarkerPresent:
    text.includes(
      "ALPHA_V3_KILL_SWITCH_RESET_RPC_BINDING_V1"
    ),

  resetRpcPresent:
    text.includes(
      '"reset_trading_kill_switch_v1"'
    ),

  explicitReasonRequired:
    text.includes(
      "KILL_SWITCH_RESET_REASON_REQUIRED"
    ),

  resetActorPresent:
    text.includes(
      'p_actor:' 
    ) &&
    text.includes(
      '"LOCAL_CONTROL_API"'
    ),

  resetMetadataPresent:
    text.includes(
      'route:' 
    ) &&
    text.includes(
      '"/api/trading/system/control"'
    ),

  resumeCaseFound:
    Boolean(
      resumeMatch
    ),

  resumeCaseNoDirectEmergencyFalse:
    !/updates\.emergency_stop\s*=\s*false\s*;/m.test(
      resumeBlock
    ),

  emergencyTripStillPresent:
    /case\s+"EMERGENCY_STOP"[\s\S]*?updates\.emergency_stop\s*=\s*true\s*;/m.test(
      text
    ),

  ordinaryUpdateStillTargetsGlobal:
    /\.eq\(\s*"control_key"\s*,\s*"global"\s*,?\s*\)/m.test(
      text
    )
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
          ? "ALPHA_V3_KILL_SWITCH_CONTROL_RESET_RPC_BINDING_V1_STATIC_VERIFIED"
          : "ALPHA_V3_KILL_SWITCH_CONTROL_RESET_RPC_BINDING_V1_STATIC_REVIEW",

      checks,
      failed,

      semantics: {
        directReset:
          "FORBIDDEN",

        authorizedResetRpc:
          "reset_trading_kill_switch_v1",

        resetReason:
          "REQUIRED",

        actor:
          "LOCAL_CONTROL_API",

        paperOrderAutoEnableOnResume:
          false
      },

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        networkCalls: 0,
        emergencyStopChanged: false
      },

      nextGate:
        failed.length === 0
          ? "TYPECHECK_AND_NEGATIVE_NO_WRITE_ROUTE_TEST"
          : "REVIEW_CONTROL_RESET_BINDING"
    },
    null,
    2
  )
);

if (failed.length > 0) {
  process.exitCode = 2;
}
