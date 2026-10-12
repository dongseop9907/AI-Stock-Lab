const fs = require("fs");
const path = require("path");

const root = process.cwd();

const migrationFile = path.resolve(
  root,
  "supabase/migrations/20261008001300_order_state_machine_audit_guard_v1.sql"
);

if (!fs.existsSync(migrationFile)) {
  throw new Error(
    "ORDER_STATE_MACHINE_AUDIT_MIGRATION_NOT_FOUND"
  );
}

const text =
  fs.readFileSync(
    migrationFile,
    "utf8"
  );

const checks = {
  configTablePresent:
    text.includes(
      "paper_order_state_machine_config"
    ),

  auditTablePresent:
    text.includes(
      "paper_order_state_transition_audit"
    ),

  defaultModeAudit:
    /mode\s+text\s+not\s+null\s+default\s+'AUDIT'/i.test(
      text
    ),

  migrationForcesAuditMode:
    /on conflict[\s\S]{0,300}?mode\s*=\s*'AUDIT'/im.test(
      text
    ),

  validatorPresent:
    text.includes(
      "validate_paper_order_state_transition_v1"
    ),

  normalizationPresent:
    text.includes(
      "normalize_paper_order_status_v1"
    ),

  canceledAlias:
    /when\s+'CANCELED'\s+then\s+'CANCELLED'/i.test(
      text
    ),

  createApprovedAllowed:
    /p_is_insert[\s\S]{0,700}?'RISK_APPROVED'[\s\S]{0,200}?'RISK_REJECTED'[\s\S]{0,200}?'FILLED'/im.test(
      text
    ),

  riskApprovedFillExpiry:
    /v_old\s*=\s*'RISK_APPROVED'[\s\S]{0,250}?'FILLED'[\s\S]{0,120}?'EXPIRED'/im.test(
      text
    ),

  terminalGuard:
    /'RISK_REJECTED'[\s\S]{0,200}?'FILLED'[\s\S]{0,200}?'EXPIRED'[\s\S]{0,200}?'CANCELLED'[\s\S]{0,200}?'FAILED'/im.test(
      text
    ),

  auditTriggerPresent:
    text.includes(
      "zz_paper_order_state_transition_audit_v1"
    ),

  triggerIsAfter:
    /create trigger[\s\S]{0,120}?after insert or update of status/im.test(
      text
    ),

  strictBranchExists:
    /v_mode\s*=\s*'STRICT'[\s\S]{0,120}?not v_allowed/im.test(
      text
    ),

  strictIsNotDefault:
    !/default\s+'STRICT'/i.test(
      text
    ),

  serviceRoleOnlyValidator:
    /revoke all on function[\s\S]{0,250}?validate_paper_order_state_transition_v1[\s\S]{0,350}?from public, anon, authenticated/im.test(
      text
    ),

  noPaperOrderTableConstraintAdded:
    !/alter table\s+public\.paper_order_requests[\s\S]{0,300}?add constraint/im.test(
      text
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
          ? "ALPHA_V3_DB_ORDER_TRANSITION_AUDIT_GUARD_V1_STATIC_VERIFIED"
          : "ALPHA_V3_DB_ORDER_TRANSITION_AUDIT_GUARD_V1_STATIC_REVIEW",

      checks,
      failed,

      enforcementMode:
        "AUDIT",

      behavior: {
        invalidTransitionsBlocked:
          false,

        allStatusCreatesAndChangesAudited:
          true,

        productionPaperOrderConstraintAdded:
          false,

        legacyRowsRewritten:
          false,
      },

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
          ? "APPLY_AUDIT_GUARD_MIGRATION_AND_VERIFY_DB"
          : "REVIEW_AUDIT_GUARD_MIGRATION",
    },
    null,
    2
  )
);

if (failed.length > 0) {
  process.exitCode = 2;
}
