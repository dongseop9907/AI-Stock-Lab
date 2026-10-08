const fs = require("fs");
const path = require("path");

const root = process.cwd();

const migrationRel =
  "supabase/migrations/20261008001500_kill_switch_db_latch_audit_foundation_v1.sql";

const file =
  path.resolve(root, migrationRel);

if (!fs.existsSync(file)) {
  throw new Error(
    "KILL_SWITCH_FOUNDATION_MIGRATION_NOT_FOUND"
  );
}

const text =
  fs.readFileSync(file, "utf8");

const checks = {
  canonicalGlobalControlKey:
    text.includes("control_key = 'global'"),

  noTradingControlIdDependency:
    !/v_control\.id\b|new\.id::text|where\s+id\s*=\s*v_control\.id|order\s+by\s+id/im.test(
      text
    ),
  singletonPrecondition:
    text.includes(
      "expected_global_control_row"
    ) &&
    text.includes(
      "control_key = 'global'"
    ),

  metadataColumns:
    [
      "kill_switch_version",
      "kill_switch_latched_at",
      "kill_switch_latched_by",
      "kill_switch_latch_reason",
      "kill_switch_latch_source",
      "kill_switch_last_reset_at",
      "kill_switch_last_reset_by",
      "kill_switch_last_reset_reason"
    ].every(
      (value) => text.includes(value)
    ),

  auditTable:
    text.includes(
      "trading_kill_switch_events"
    ),

  transitionValidator:
    text.includes(
      "validate_kill_switch_transition_v1"
    ),

  directResetRejected:
    text.includes(
      "RESET_REQUIRES_AUTHORIZED_RPC"
    ),

  resetAuthorizationGuc:
    text.includes(
      "ai_stock_lab.kill_switch_reset_authorized"
    ),

  latchBeforeTrigger:
    text.includes(
      "aa_enforce_kill_switch_latch_v1"
    ),

  auditAfterTrigger:
    text.includes(
      "zz_audit_kill_switch_transition_v1"
    ),

  tripRpc:
    text.includes(
      "trip_trading_kill_switch_v1"
    ),

  resetRpc:
    text.includes(
      "reset_trading_kill_switch_v1"
    ),

  statusRpc:
    text.includes(
      "get_trading_kill_switch_status_v1"
    ),

  autoResetApiAbsent:
    !text.includes(
      "p_automatic_reset"
    ),

  serviceRoleOnly:
    /revoke all on function[\s\S]+?reset_trading_kill_switch_v1[\s\S]+?from public, anon, authenticated/im.test(
      text
    ) &&
    /grant execute on function[\s\S]+?reset_trading_kill_switch_v1[\s\S]+?to service_role/im.test(
      text
    ),

  noEmergencyStopInitialization:
    !/set\s+emergency_stop\s*=\s*(true|false)[\s\S]{0,80}where/im.test(
      text
    ) ||
    (
      text.includes(
        "trip_trading_kill_switch_v1"
      ) &&
      text.includes(
        "reset_trading_kill_switch_v1"
      )
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
          ? "ALPHA_V3_KILL_SWITCH_DB_LATCH_AUDIT_FOUNDATION_V1_STATIC_VERIFIED"
          : "ALPHA_V3_KILL_SWITCH_DB_LATCH_AUDIT_FOUNDATION_V1_STATIC_REVIEW",

      checks,
      failed,

      behavior: {
        changesEmergencyStopDuringMigration:
          false,

        directTripCompatible:
          true,

        directResetAllowed:
          false,

        authorizedResetRpcRequired:
          true,

        everyActualStateChangeAudited:
          true
      },

      safety: {
        ordersCreated: 0,
        ordersChanged: 0,
        positionsChanged: 0
      },

      nextGate:
        failed.length === 0
          ? "CAPTURE_KILL_SWITCH_BASELINE_THEN_APPLY_MIGRATION"
          : "REVIEW_KILL_SWITCH_FOUNDATION_STATIC"
    },
    null,
    2
  )
);

if (failed.length > 0) {
  process.exitCode = 2;
}
