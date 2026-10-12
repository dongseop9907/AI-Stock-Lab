const fs = require("fs");
const path = require("path");

const root = process.cwd();

const sourceRel =
  "supabase/migrations/20261008000400_execute_paper_buy_order_committed_risk_lock.sql";

const targetRel =
  "supabase/migrations/20261008000700_execute_paper_buy_order_lock_order_v2.sql";

const verifierRel =
  "scripts/alpha-v3-fill-lock-order-hardening-verify.cjs";

const sourceFile =
  path.resolve(root, sourceRel);

const targetFile =
  path.resolve(root, targetRel);

const verifierFile =
  path.resolve(root, verifierRel);

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

let fn =
  block.text;

/*
 * Identify the existing order-row FOR UPDATE.
 */
const rowLockRegex =
  /select\s+\*[\s\S]{0,800}?into\s+v_order[\s\S]{0,800}?from\s+public\.paper_order_requests[\s\S]{0,800}?where[\s\S]{0,500}?p_order_id[\s\S]{0,500}?for\s+update\s*;/i;

const rowLockMatch =
  rowLockRegex.exec(fn);

if (!rowLockMatch) {
  throw new Error(
    "ORDER_ROW_FOR_UPDATE_STATEMENT_NOT_FOUND"
  );
}

const rowLockIndex =
  rowLockMatch.index;

/*
 * Remove the V1 lock that currently appears after the not-found guard.
 */
const oldLockRegex =
  /\n\s*--\s*Serialize committed-risk reservation and fill transition by account\.[\s\S]{0,700}?perform\s+pg_advisory_xact_lock\s*\([\s\S]{0,700}?AI_STOCK_LAB_COMMITTED_RISK_V3:[\s\S]{0,400}?v_order\.account_id::text[\s\S]{0,300}?\)\s*;\s*/i;

const oldLockMatch =
  oldLockRegex.exec(fn);

if (!oldLockMatch) {
  throw new Error(
    "EXISTING_POST_ROW_ACCOUNT_LOCK_NOT_FOUND"
  );
}

fn =
  fn.slice(0, oldLockMatch.index) +
  "\n" +
  fn.slice(
    oldLockMatch.index +
    oldLockMatch[0].length
  );

/*
 * Re-find row lock after removal because offsets changed.
 */
const refreshedRowLock =
  rowLockRegex.exec(fn);

if (!refreshedRowLock) {
  throw new Error(
    "ORDER_ROW_FOR_UPDATE_STATEMENT_LOST_AFTER_PATCH"
  );
}

const lockBeforeRow =
`  -- Lock ordering invariant:
  -- account advisory lock -> order row FOR UPDATE.
  -- The account id is read without a row lock only to derive the shared
  -- committed-risk lock key. The canonical row is then re-read FOR UPDATE.
  perform pg_advisory_xact_lock(
    hashtext(
      'AI_STOCK_LAB_COMMITTED_RISK_V3:' ||
      coalesce(
        (
          select por.account_id::text
          from public.paper_order_requests por
          where por.id = p_order_id
        ),
        'MISSING_ORDER:' || p_order_id::text
      )
    )
  );

`;

fn =
  fn.slice(0, refreshedRowLock.index) +
  lockBeforeRow +
  fn.slice(refreshedRowLock.index);

/*
 * Ensure there is now exactly one committed-risk advisory lock in the function.
 */
const lockOccurrences =
  [
    ...fn.matchAll(
      /AI_STOCK_LAB_COMMITTED_RISK_V3:/g
    ),
  ].length;

if (lockOccurrences !== 1) {
  throw new Error(
    `UNEXPECTED_COMMITTED_RISK_LOCK_OCCURRENCES:${lockOccurrences}`
  );
}

const securityDefiner =
  /\bsecurity\s+definer\b/i.test(fn);

let privilegeSql = "";

if (securityDefiner) {
  privilegeSql =
`

revoke all on function public.execute_paper_buy_order(uuid) from public;
revoke all on function public.execute_paper_buy_order(uuid) from anon;
revoke all on function public.execute_paper_buy_order(uuid) from authenticated;
grant execute on function public.execute_paper_buy_order(uuid) to service_role;
`;
}

const migrationSql =
`-- Alpha V3: canonical lock ordering for fill transition.
-- Invariant:
--   account advisory lock -> paper_order_requests row FOR UPDATE
-- This matches committed-risk reservation ordering and removes the
-- order-row/account-lock inversion that could deadlock on retry vs fill.

${fn.trim()}
${privilegeSql}`.trim() +
"\n";

if (fs.existsSync(targetFile)) {
  const current =
    fs.readFileSync(
      targetFile,
      "utf8"
    );

  if (current !== migrationSql) {
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
  "supabase/migrations/20261008000700_execute_paper_buy_order_lock_order_v2.sql";

const file =
  path.resolve(
    root,
    migrationRel
  );

if (!fs.existsSync(file)) {
  throw new Error(
    "LOCK_ORDER_MIGRATION_NOT_FOUND"
  );
}

const sql =
  fs.readFileSync(
    file,
    "utf8"
  );

const accountLockIndex =
  sql.search(
    /pg_advisory_xact_lock[\s\S]{0,900}?AI_STOCK_LAB_COMMITTED_RISK_V3:/i
  );

const rowLockIndex =
  sql.search(
    /select\s+\*[\s\S]{0,800}?into\s+v_order[\s\S]{0,800}?from\s+public\.paper_order_requests[\s\S]{0,800}?for\s+update\s*;/i
  );

const positionMutationIndex =
  sql.search(
    /\b(?:insert\s+into|update)\s+public\.paper_positions\b/i
  );

const filledIndex =
  sql.search(
    /update\s+public\.paper_order_requests[\s\S]{0,1800}?status\s*=\s*['"]FILLED['"]/i
  );

const lockOccurrences =
  (
    sql.match(
      /AI_STOCK_LAB_COMMITTED_RISK_V3:/g
    ) || []
  ).length;

const checks = {
  recreateExecuteRpc:
    /create\s+(?:or\s+replace\s+)?function\s+public\.execute_paper_buy_order\s*\(/i.test(
      sql
    ),

  sharedAccountLockPresent:
    accountLockIndex >= 0,

  exactOneSharedAccountLock:
    lockOccurrences === 1,

  accountLockBeforeOrderRowLock:
    accountLockIndex >= 0 &&
    rowLockIndex >= 0 &&
    accountLockIndex < rowLockIndex,

  orderRowStillForUpdate:
    rowLockIndex >= 0,

  accountLockBeforePositionMutation:
    accountLockIndex >= 0 &&
    positionMutationIndex >= 0 &&
    accountLockIndex < positionMutationIndex,

  accountLockBeforeFilledTransition:
    accountLockIndex >= 0 &&
    filledIndex >= 0 &&
    accountLockIndex < filledIndex,

  missingOrderKeyFallback:
    /MISSING_ORDER:[\s\S]{0,120}?p_order_id::text/i.test(
      sql
    ),

  productionPolicyChanged:
    false,
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
      ? "ALPHA_V3_FILL_LOCK_ORDER_HARDENING_VERIFIED"
      : "ALPHA_V3_FILL_LOCK_ORDER_HARDENING_REVIEW",

  checks,
  failed,

  contract: {
    canonicalOrder:
      "ACCOUNT_ADVISORY_LOCK_THEN_ORDER_ROW_FOR_UPDATE",

    reservationRpcOrder:
      "ACCOUNT_ADVISORY_LOCK_THEN_ORDER_ACCESS",

    fillRpcOrder:
      "ACCOUNT_ADVISORY_LOCK_THEN_ORDER_ROW_FOR_UPDATE",

    deadlockInversionRemoved:
      failed.length === 0,

    databaseApplied:
      false,
  },

  nextGate:
    failed.length === 0
      ? "APPLY_FILL_LOCK_ORDER_MIGRATION_AND_STRESS_TEST"
      : "REVIEW_LOCK_ORDER_PATCH",
};

console.log(
  JSON.stringify(
    result,
    null,
    2
  )
);

if (failed.length > 0) {
  process.exitCode = 2;
}
`;

fs.mkdirSync(
  path.dirname(verifierFile),
  { recursive: true }
);

fs.writeFileSync(
  verifierFile,
  verifier,
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_FILL_LOCK_ORDER_HARDENING_V1_INSTALLED",

      sourceMigration:
        sourceRel,

      generatedMigration:
        targetRel,

      generatedVerifier:
        verifierRel,

      canonicalLockOrder:
        "ACCOUNT_ADVISORY_LOCK_THEN_ORDER_ROW_FOR_UPDATE",

      databaseApplied:
        false,

      nextAction:
        "RUN_FILL_LOCK_ORDER_HARDENING_VERIFY"
    },
    null,
    2
  )
);
