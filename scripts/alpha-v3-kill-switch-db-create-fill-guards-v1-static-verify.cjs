const fs = require("fs");
const path = require("path");

const root = process.cwd();

const migrationRel =
  "supabase/migrations/20261008001600_kill_switch_db_create_fill_guards_v1.sql";

const text =
  fs.readFileSync(
    path.resolve(root, migrationRel),
    "utf8"
  );

const createSource =
  fs.readFileSync(
    path.resolve(root, "supabase/migrations/20261008000100_committed_risk_reservation_v3.sql"),
    "utf8"
  );

const fillSource =
  fs.readFileSync(
    path.resolve(root, "supabase/migrations/20261008000700_execute_paper_buy_order_lock_order_v2.sql"),
    "utf8"
  );

function count(haystack, needle) {
  return haystack
    .split(needle)
    .length - 1;
}

const checks = {
  migrationVersion01600:
    path.basename(
      migrationRel
    ).startsWith(
      "20261008001600_"
    ),

  pureValidatorPresent:
    text.includes(
      "validate_paper_buy_new_risk_control_v1"
    ),

  dbGuardPresent:
    text.includes(
      "assert_paper_buy_new_risk_allowed_v1"
    ),

  canonicalGlobalControlRow:
    text.includes(
      "control_key = 'global'"
    ),

  controlLockedForShare:
    /from\s+public\.trading_system_controls[\s\S]*?where\s+control_key\s*=\s*'global'[\s\S]*?for\s+share;/im.test(
      text
    ),

  emergencyStopChecked:
    text.includes(
      "v_control.emergency_stop"
    ),

  paperOrderEnabledChecked:
    text.includes(
      "v_control.paper_order_enabled"
    ),

  failClosedMissingControl:
    text.includes(
      "KILL_SWITCH_NEW_RISK_BLOCKED:CONTROL_ROW_MISSING"
    ),

  createRpcRedefined:
    text.includes(
      "create_paper_buy_order_with_committed_risk_v3"
    ),

  fillRpcRedefined:
    text.includes(
      "execute_paper_buy_order"
    ),

  createRpcGuarded:
    /create\s+(?:or\s+replace\s+)?function\s+public\.create_paper_buy_order_with_committed_risk_v3[\s\S]*?perform\s+public\.assert_paper_buy_new_risk_allowed_v1\(\);/im.test(
      text
    ),

  fillRpcGuarded:
    /create\s+(?:or\s+replace\s+)?function\s+public\.execute_paper_buy_order[\s\S]*?perform\s+public\.assert_paper_buy_new_risk_allowed_v1\(\);/im.test(
      text
    ),

  exactlyTwoProductionGuardCalls:
    count(
      text,
      "perform public.assert_paper_buy_new_risk_allowed_v1();"
    ) === 2,

  stopLossNotRedefined:
    !/create\s+(?:or\s+replace\s+)?function\s+public\.execute_paper_stop_loss\s*\(/im.test(
      text
    ),

  createSourceUnmodified:
    !createSource.includes(
      "assert_paper_buy_new_risk_allowed_v1"
    ),

  fillSourceUnmodified:
    !fillSource.includes(
      "assert_paper_buy_new_risk_allowed_v1"
    ),

  serviceRoleOnly:
    text.includes(
      "from public, anon, authenticated"
    ) &&
    text.includes(
      "to service_role"
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
          ? "ALPHA_V3_KILL_SWITCH_DB_CREATE_FILL_GUARDS_V1_STATIC_VERIFIED"
          : "ALPHA_V3_KILL_SWITCH_DB_CREATE_FILL_GUARDS_V1_STATIC_REVIEW",

      checks,
      failed,

      protectedRpc: {
        create:
          "create_paper_buy_order_with_committed_risk_v3",

        fill:
          "execute_paper_buy_order"
      },

      intentionallyUngated: [
        "execute_paper_stop_loss",
        "risk_release",
        "expiry",
        "reconciliation"
      ],

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        ordersCreated: 0,
        positionsChanged: 0
      },

      nextGate:
        failed.length === 0
          ? "PREFLIGHT_AND_DB_PUSH"
          : "REVIEW_DB_GUARD_MIGRATION"
    },
    null,
    2
  )
);

if (failed.length > 0) {
  process.exitCode = 2;
}
