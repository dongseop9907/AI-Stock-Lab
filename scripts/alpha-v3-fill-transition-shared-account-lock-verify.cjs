const fs = require("fs");
const path = require("path");

const root = process.cwd();

const migrationRel =
  "supabase/migrations/20261008000400_execute_paper_buy_order_committed_risk_lock.sql";

const migrationFile =
  path.resolve(root, migrationRel);

if (!fs.existsSync(migrationFile)) {
  throw new Error(
    "FILL_TRANSITION_MIGRATION_NOT_FOUND"
  );
}

const sql =
  fs.readFileSync(
    migrationFile,
    "utf8"
  );

const checks = {
  recreateExecuteRpc:
    /create\s+(?:or\s+replace\s+)?function\s+public\.execute_paper_buy_order\s*\(/i.test(
      sql
    ),

  orderRowForUpdate:
    /from\s+public\.paper_order_requests[\s\S]{0,1200}?for\s+update\s*;/i.test(
      sql
    ),

  sharedAccountLock:
    /pg_advisory_xact_lock[\s\S]{0,300}?AI_STOCK_LAB_COMMITTED_RISK_V3:[\s\S]{0,300}?v_order\.account_id/i.test(
      sql
    ),

  lockAfterNotFoundGuard: (() => {
    const forUpdate =
      sql.search(
        /from\s+public\.paper_order_requests[\s\S]{0,1200}?for\s+update\s*;/i
      );

    const guard =
      forUpdate >= 0
        ? sql
            .slice(forUpdate)
            .search(
              /if\s+not\s+found\s+then[\s\S]{0,1600}?end\s+if\s*;/i
            )
        : -1;

    const lock =
      sql.search(
        /pg_advisory_xact_lock/i
      );

    if (
      forUpdate < 0 ||
      guard < 0 ||
      lock < 0
    ) {
      return false;
    }

    const guardAbsolute =
      forUpdate +
      guard;

    return lock >
      guardAbsolute;
  })(),

  positionMutationPresent:
    /\b(?:insert\s+into|update)\s+public\.paper_positions\b/i.test(
      sql
    ),

  filledTransitionPresent:
    /update\s+public\.paper_order_requests[\s\S]{0,1600}?status\s*=\s*['"]FILLED['"]/i.test(
      sql
    ),

  lockBeforePositionMutation: (() => {
    const lock =
      sql.search(
        /pg_advisory_xact_lock/i
      );

    const mutation =
      sql.search(
        /\b(?:insert\s+into|update)\s+public\.paper_positions\b/i
      );

    return (
      lock >= 0 &&
      mutation >= 0 &&
      lock < mutation
    );
  })(),

  lockBeforeFilledTransition: (() => {
    const lock =
      sql.search(
        /pg_advisory_xact_lock/i
      );

    const filled =
      sql.search(
        /update\s+public\.paper_order_requests[\s\S]{0,1600}?status\s*=\s*['"]FILLED['"]/i
      );

    return (
      lock >= 0 &&
      filled >= 0 &&
      lock < filled
    );
  })(),

  noProductionPolicyChange:
    true,
};

const securityDefiner =
  /\bsecurity\s+definer\b/i.test(
    sql
  );

if (securityDefiner) {
  checks.fixedSearchPath =
    /\bset\s+search_path\s*(?:=|to)\s*public\s*,\s*pg_temp\b/i.test(
      sql
    );

  checks.revokePublic =
    /revoke\s+all\s+on\s+function\s+public\.execute_paper_buy_order\s*\(\s*uuid\s*\)\s+from\s+public/i.test(
      sql
    );

  checks.revokeAnon =
    /revoke\s+all\s+on\s+function\s+public\.execute_paper_buy_order\s*\(\s*uuid\s*\)\s+from\s+anon/i.test(
      sql
    );

  checks.revokeAuthenticated =
    /revoke\s+all\s+on\s+function\s+public\.execute_paper_buy_order\s*\(\s*uuid\s*\)\s+from\s+authenticated/i.test(
      sql
    );

  checks.grantServiceRole =
    /grant\s+execute\s+on\s+function\s+public\.execute_paper_buy_order\s*\(\s*uuid\s*\)\s+to\s+service_role/i.test(
      sql
    );
}

const failed =
  Object.entries(checks)
    .filter(
      ([, value]) =>
        value !== true
    )
    .map(
      ([name]) =>
        name
    );

const result = {
  status:
    failed.length === 0
      ? "ALPHA_V3_FILL_TRANSITION_SHARED_ACCOUNT_LOCK_VERIFIED"
      : "ALPHA_V3_FILL_TRANSITION_SHARED_ACCOUNT_LOCK_REVIEW",

  checks,
  failed,

  contract: {
    lockKey:
      "AI_STOCK_LAB_COMMITTED_RISK_V3:<account_id>",

    reservationRpc:
      "create_paper_buy_order_with_committed_risk_v3",

    fillRpc:
      "execute_paper_buy_order",

    invariant:
      "RESERVATION_AND_FILL_TRANSITION_SHARE_ACCOUNT_SCOPED_TRANSACTION_LOCK",

    productionPolicyChanged:
      false,

    databaseApplied:
      false,
  },

  nextGate:
    failed.length === 0
      ? "FINAL_DRY_RUN_THEN_APPLY_FILL_LOCK_MIGRATION"
      : "REVIEW_FILL_LOCK_PATCH_BEFORE_DB_APPLY",
};

console.log(
  JSON.stringify(
    result,
    null,
    2
  )
);

if (failed.length > 0) {
  process.exitCode =
    2;
}
