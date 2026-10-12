const fs = require("fs");
const path = require("path");

const root = process.cwd();

const file = path.resolve(
  root,
  "supabase/migrations/20261008001400_order_state_machine_strict_activation_v1.sql"
);

if (!fs.existsSync(file)) {
  throw new Error(
    "STRICT_ACTIVATION_MIGRATION_NOT_FOUND"
  );
}

const text =
  fs.readFileSync(
    file,
    "utf8"
  );

const checks = {
  transactionPresent:
    /^\s*begin;/im.test(text) &&
    /\bcommit;/im.test(text),

  requiresAuditMode:
    /v_mode\s+is\s+distinct\s+from\s+'AUDIT'/im.test(
      text
    ),

  requiresV1Version:
    text.includes(
      "ALPHA_V3_ORDER_STATE_MACHINE_V1"
    ),

  requiresZeroOrders:
    /from\s+public\.paper_order_requests[\s\S]{0,250}?v_total_orders\s*<>\s*0/im.test(
      text
    ),

  requiresZeroRiskApproved:
    /status\s*=\s*'RISK_APPROVED'[\s\S]{0,250}?v_approved_orders\s*<>\s*0/im.test(
      text
    ),

  requiresZeroActiveReservations:
    /reserved_risk_amount\s*>\s*0[\s\S]{0,250}?reserved_risk_released_at\s+is\s+null/im.test(
      text
    ),

  requiresZeroPositions:
    /from\s+public\.paper_positions[\s\S]{0,250}?v_positions\s*<>\s*0/im.test(
      text
    ),

  requiresZeroInvalidAudit:
    /paper_order_state_transition_audit[\s\S]{0,200}?allowed\s*=\s*false/im.test(
      text
    ),

  requiresTriggerPresence:
    text.includes(
      "zz_paper_order_state_transition_audit_v1"
    ) &&
    text.includes(
      "pg_trigger"
    ),

  activatesStrict:
    /update\s+public\.paper_order_state_machine_config[\s\S]{0,300}?mode\s*=\s*'STRICT'/im.test(
      text
    ),

  noOrderWrites:
    !/insert\s+into\s+public\.paper_order_requests/im.test(
      text
    ) &&
    !/update\s+public\.paper_order_requests/im.test(
      text
    ) &&
    !/delete\s+from\s+public\.paper_order_requests/im.test(
      text
    ),

  noPositionWrites:
    !/insert\s+into\s+public\.paper_positions/im.test(
      text
    ) &&
    !/update\s+public\.paper_positions/im.test(
      text
    ) &&
    !/delete\s+from\s+public\.paper_positions/im.test(
      text
    )
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
          ? "ALPHA_V3_ORDER_STATE_STRICT_ACTIVATION_V1_STATIC_VERIFIED"
          : "ALPHA_V3_ORDER_STATE_STRICT_ACTIVATION_V1_STATIC_REVIEW",

      checks,
      failed,

      targetMode:
        "STRICT",

      safety: {
        migrationOnlyChangesStateMachineConfig:
          true,

        paperOrderWrites:
          0,

        positionWrites:
          0,

        testOrdersCreated:
          0
      },

      nextGate:
        failed.length === 0
          ? "APPLY_STRICT_ACTIVATION_MIGRATION"
          : "REVIEW_STRICT_ACTIVATION_MIGRATION"
    },
    null,
    2
  )
);

if (failed.length > 0) {
  process.exitCode =
    2;
}
