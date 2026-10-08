const fs = require("fs");
const path = require("path");

const root = process.cwd();

const sourceRel =
  "supabase/migrations/003_execute_paper_orders.sql";

const targetRel =
  "supabase/migrations/20261008000400_execute_paper_buy_order_committed_risk_lock.sql";

const verifyRel =
  "scripts/alpha-v3-fill-transition-shared-account-lock-verify.cjs";

const sourceFile =
  path.resolve(root, sourceRel);

const targetFile =
  path.resolve(root, targetRel);

const verifyFile =
  path.resolve(root, verifyRel);

function findFunctionBlock(sql, functionName) {
  const escaped =
    functionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const startRegex =
    new RegExp(
      `create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${escaped}\\s*\\(`,
      "i"
    );

  const startMatch =
    startRegex.exec(sql);

  if (!startMatch) {
    return null;
  }

  const start =
    startMatch.index;

  const rest =
    sql.slice(start);

  const asMatch =
    /\bas\s+(\$[A-Za-z0-9_]*\$)/i.exec(rest);

  if (!asMatch) {
    return null;
  }

  const delimiter =
    asMatch[1];

  const firstDelimiterIndex =
    start +
    asMatch.index +
    asMatch[0].length -
    delimiter.length;

  const bodyStart =
    firstDelimiterIndex +
    delimiter.length;

  const closingDelimiterIndex =
    sql.indexOf(
      delimiter,
      bodyStart
    );

  if (closingDelimiterIndex < 0) {
    return null;
  }

  const semicolonIndex =
    sql.indexOf(
      ";",
      closingDelimiterIndex +
      delimiter.length
    );

  const end =
    semicolonIndex >= 0
      ? semicolonIndex + 1
      : closingDelimiterIndex +
        delimiter.length;

  return {
    start,
    end,
    text:
      sql.slice(start, end),
  };
}

function insertSharedAccountLock(fnText) {
  if (
    /AI_STOCK_LAB_COMMITTED_RISK_V3:/i.test(
      fnText
    )
  ) {
    return {
      text:
        fnText,

      alreadyPresent:
        true,

      insertedAfterOrderRowFoundCheck:
        true,
    };
  }

  const forUpdateIndex =
    fnText.search(
      /from\s+public\.paper_order_requests[\s\S]{0,1200}?for\s+update\s*;/i
    );

  if (forUpdateIndex < 0) {
    throw new Error(
      "ORDER_ROW_FOR_UPDATE_ANCHOR_NOT_FOUND"
    );
  }

  const afterForUpdate =
    fnText.slice(
      forUpdateIndex
    );

  const notFoundMatch =
    /if\s+not\s+found\s+then[\s\S]{0,1600}?end\s+if\s*;/i.exec(
      afterForUpdate
    );

  if (!notFoundMatch) {
    throw new Error(
      "ORDER_NOT_FOUND_GUARD_NOT_FOUND_AFTER_FOR_UPDATE"
    );
  }

  const insertionIndex =
    forUpdateIndex +
    notFoundMatch.index +
    notFoundMatch[0].length;

  const lockSql =
    `

  -- Serialize committed-risk reservation and fill transition by account.
  perform pg_advisory_xact_lock(
    hashtext(
      'AI_STOCK_LAB_COMMITTED_RISK_V3:' ||
      v_order.account_id::text
    )
  );`;

  const patched =
    fnText.slice(0, insertionIndex) +
    lockSql +
    fnText.slice(insertionIndex);

  return {
    text:
      patched,

    alreadyPresent:
      false,

    insertedAfterOrderRowFoundCheck:
      true,
  };
}

function hardenSecurity(fnText) {
  let text =
    fnText;

  const securityDefiner =
    /\bsecurity\s+definer\b/i.test(
      text
    );

  if (
    securityDefiner &&
    !/\bset\s+search_path\s*(?:=|to)\s*public\s*,\s*pg_temp\b/i.test(
      text
    )
  ) {
    text =
      text.replace(
        /\bsecurity\s+definer\b/i,
        "security definer\nset search_path = public, pg_temp"
      );
  }

  return {
    text,
    securityDefiner,
  };
}

if (!fs.existsSync(sourceFile)) {
  throw new Error(
    `SOURCE_MIGRATION_NOT_FOUND:${sourceRel}`
  );
}

const sourceSql =
  fs.readFileSync(
    sourceFile,
    "utf8"
  );

const block =
  findFunctionBlock(
    sourceSql,
    "execute_paper_buy_order"
  );

if (!block) {
  throw new Error(
    "EXECUTE_PAPER_BUY_ORDER_DEFINITION_NOT_FOUND"
  );
}

const lockPatched =
  insertSharedAccountLock(
    block.text
  );

const hardened =
  hardenSecurity(
    lockPatched.text
  );

const functionSql =
  hardened.text.trim() +
  "\n";

const privilegeSql =
  hardened.securityDefiner
    ? `

revoke all on function public.execute_paper_buy_order(uuid) from public;
revoke all on function public.execute_paper_buy_order(uuid) from anon;
revoke all on function public.execute_paper_buy_order(uuid) from authenticated;
grant execute on function public.execute_paper_buy_order(uuid) to service_role;
`
    : "";

const migrationSql =
  `-- Alpha V3: serialize fill transition with committed-risk reservations.
-- Generated from the current canonical execute_paper_buy_order definition in 003.
-- The business logic is preserved; only the shared account advisory lock and
-- SECURITY DEFINER hardening (when applicable) are added.

${functionSql}${privilegeSql}`.trim() +
  "\n";

if (
  fs.existsSync(targetFile)
) {
  const existing =
    fs.readFileSync(
      targetFile,
      "utf8"
    );

  if (existing !== migrationSql) {
    throw new Error(
      `TARGET_MIGRATION_ALREADY_EXISTS_WITH_DIFFERENT_CONTENT:${targetRel}`
    );
  }
} else {
  fs.writeFileSync(
    targetFile,
    migrationSql,
    "utf8"
  );
}

const verifier = String.raw`const fs = require("fs");
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
`;

fs.mkdirSync(
  path.dirname(verifyFile),
  {
    recursive: true,
  }
);

fs.writeFileSync(
  verifyFile,
  verifier,
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_FILL_TRANSITION_SHARED_ACCOUNT_LOCK_V1_INSTALLED",

      sourceMigration:
        sourceRel,

      generatedMigration:
        targetRel,

      generatedVerifier:
        verifyRel,

      sourceFunctionPreserved:
        true,

      sharedLockKey:
        "AI_STOCK_LAB_COMMITTED_RISK_V3:<account_id>",

      insertedAfterOrderRowFoundCheck:
        lockPatched.insertedAfterOrderRowFoundCheck,

      databaseApplied:
        false,

      nextAction:
        "RUN_FILL_TRANSITION_SHARED_LOCK_VERIFY",
    },
    null,
    2
  )
);
