const fs = require("fs");
const path = require("path");

const root = process.cwd();

const migrationRel =
  "supabase/migrations/20261008000100_committed_risk_reservation_v3.sql";

const migrationFile =
  path.resolve(root, migrationRel);

const reportFile =
  path.resolve(
    root,
    "logs/alpha-v3-reservation-lock-order-targeted-audit.json"
  );

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

function lineNo(text, index) {
  return text
    .slice(0, index)
    .split(/\r?\n/)
    .length;
}

function snippet(text, index, radius = 10) {
  const lines =
    text.replace(/\r\n/g, "\n")
      .split("\n");

  const line =
    lineNo(text, index);

  const start =
    Math.max(
      1,
      line - radius
    );

  const end =
    Math.min(
      lines.length,
      line + radius
    );

  return {
    line,
    snippet:
      lines
        .slice(start - 1, end)
        .map(
          (value, offset) =>
            `${start + offset}: ${value}`
        )
        .join("\n"),
  };
}

function allMatches(text, regex) {
  const rows = [];
  let match;

  while ((match = regex.exec(text))) {
    rows.push({
      index:
        match.index,

      match:
        match[0],

      ...snippet(
        text,
        match.index,
        8
      ),
    });
  }

  return rows;
}

if (!fs.existsSync(migrationFile)) {
  throw new Error(
    `MIGRATION_NOT_FOUND:${migrationRel}`
  );
}

const sql =
  fs.readFileSync(
    migrationFile,
    "utf8"
  );

const block =
  findFunctionBlock(
    sql,
    "create_paper_buy_order_with_committed_risk_v3"
  );

if (!block) {
  throw new Error(
    "CREATE_COMMITTED_RISK_RPC_NOT_FOUND"
  );
}

const fn =
  block.text;

const advisoryLocks =
  allMatches(
    fn,
    /pg_advisory_xact_lock\s*\([\s\S]{0,600}?\)\s*;/gi
  );

const forUpdates =
  allMatches(
    fn,
    /select[\s\S]{0,1400}?from\s+public\.paper_order_requests[\s\S]{0,1200}?for\s+update\s*;/gi
  );

const returns =
  allMatches(
    fn,
    /\breturn\b[\s\S]{0,500}?;/gi
  );

const firstAdvisoryIndex =
  advisoryLocks.length
    ? Math.min(
        ...advisoryLocks.map(
          (row) =>
            row.index
        )
      )
    : -1;

const preAdvisoryRowLocks =
  firstAdvisoryIndex >= 0
    ? forUpdates.filter(
        (row) =>
          row.index <
          firstAdvisoryIndex
      )
    : [];

const postAdvisoryRowLocks =
  firstAdvisoryIndex >= 0
    ? forUpdates.filter(
        (row) =>
          row.index >
          firstAdvisoryIndex
      )
    : [];

let preLockClassification =
  "NO_PRE_ADVISORY_ORDER_ROW_LOCK";

let preLockControlFlow = null;

if (
  firstAdvisoryIndex >= 0 &&
  preAdvisoryRowLocks.length > 0
) {
  const rowLock =
    preAdvisoryRowLocks[
      preAdvisoryRowLocks.length - 1
    ];

  const segment =
    fn.slice(
      rowLock.index,
      firstAdvisoryIndex
    );

  const hasIfFound =
    /\bif\s+found\s+then\b/i.test(
      segment
    );

  const hasIfExisting =
    /\bif\b[\s\S]{0,180}?\bexisting\b[\s\S]{0,120}?\bthen\b/i.test(
      segment
    );

  const hasReturn =
    /\breturn\b[\s\S]{0,900}?;/i.test(
      segment
    );

  const foundBlock =
    /\bif\s+found\s+then\b([\s\S]*?)\bend\s+if\s*;/i.exec(
      segment
    );

  const existingBlock =
    /\bif\b[\s\S]{0,180}?\bexisting\b[\s\S]{0,120}?\bthen\b([\s\S]*?)\bend\s+if\s*;/i.exec(
      segment
    );

  const guardedBlock =
    foundBlock?.[1] ??
    existingBlock?.[1] ??
    null;

  const guardedReturn =
    Boolean(
      guardedBlock &&
      /\breturn\b[\s\S]{0,900}?;/i.test(
        guardedBlock
      )
    );

  preLockControlFlow = {
    rowLockIndex:
      rowLock.index,

    advisoryLockIndex:
      firstAdvisoryIndex,

    hasIfFound,
    hasIfExisting,
    hasReturnBeforeAdvisory:
      hasReturn,

    guardedReturnBeforeAdvisory:
      guardedReturn,

    segment:
      segment
        .split(/\r?\n/)
        .slice(0, 80)
        .join("\n"),
  };

  if (guardedReturn) {
    preLockClassification =
      "IDEMPOTENCY_ROW_LOCK_RETURNS_BEFORE_ACCOUNT_LOCK";
  } else {
    preLockClassification =
      "POTENTIAL_ROW_LOCK_TO_ACCOUNT_LOCK_INVERSION";
  }
}

/*
 * Additional conservative check:
 * if the pre-advisory SELECT FOR UPDATE can return a row and control can
 * reach pg_advisory_xact_lock without an unconditional early return, flag it.
 */
const safeIdempotencyPrecheck =
  preLockClassification ===
  "IDEMPOTENCY_ROW_LOCK_RETURNS_BEFORE_ACCOUNT_LOCK";

const fillCanonicalMigration =
  path.resolve(
    root,
    "supabase/migrations/20261008000700_execute_paper_buy_order_lock_order_v2.sql"
  );

let fillLockOrder = null;

if (fs.existsSync(fillCanonicalMigration)) {
  const fillSql =
    fs.readFileSync(
      fillCanonicalMigration,
      "utf8"
    );

  const fillBlock =
    findFunctionBlock(
      fillSql,
      "execute_paper_buy_order"
    );

  if (fillBlock) {
    const fillFn =
      fillBlock.text;

    const fillAdvisory =
      fillFn.search(
        /pg_advisory_xact_lock/i
      );

    const fillRow =
      fillFn.search(
        /select\s+\*[\s\S]{0,1200}?from\s+public\.paper_order_requests[\s\S]{0,900}?for\s+update\s*;/i
      );

    fillLockOrder = {
      advisoryLockIndex:
        fillAdvisory,

      orderRowForUpdateIndex:
        fillRow,

      canonical:
        fillAdvisory >= 0 &&
        fillRow >= 0 &&
        fillAdvisory <
        fillRow,
    };
  }
}

const classification =
  advisoryLocks.length === 0
    ? "MISSING_ACCOUNT_ADVISORY_LOCK"
    : preAdvisoryRowLocks.length === 0
      ? "CANONICAL_ACCOUNT_LOCK_BEFORE_ORDER_ROW_LOCK"
      : safeIdempotencyPrecheck
        ? "SAFE_IDEMPOTENCY_PRECHECK_THEN_CANONICAL_ACCOUNT_LOCK"
        : "POTENTIAL_DEADLOCK_LOCK_ORDER_INVERSION";

const needsPatch =
  classification ===
    "MISSING_ACCOUNT_ADVISORY_LOCK" ||
  classification ===
    "POTENTIAL_DEADLOCK_LOCK_ORDER_INVERSION";

const report = {
  status:
    needsPatch
      ? "ALPHA_V3_RESERVATION_LOCK_ORDER_TARGETED_AUDIT_REVIEW"
      : "ALPHA_V3_RESERVATION_LOCK_ORDER_TARGETED_AUDIT_VERIFIED",

  classification,

  createRpc: {
    advisoryLocks,
    orderRowForUpdateStatements:
      forUpdates,

    preAdvisoryOrderRowLockCount:
      preAdvisoryRowLocks.length,

    postAdvisoryOrderRowLockCount:
      postAdvisoryRowLocks.length,

    preLockClassification,
    preLockControlFlow,

    returnStatements:
      returns.slice(0, 12),
  },

  fillRpc: {
    lockOrder:
      fillLockOrder,
  },

  decision: {
    needsReservationLockOrderPatch:
      needsPatch,

    safeToProceedExpiryReconciliation:
      !needsPatch,

    nextGate:
      needsPatch
        ? "PATCH_RESERVATION_RPC_LOCK_ORDER_BEFORE_EXPIRY"
        : "BUILD_EXPIRY_AND_RECONCILIATION_MIGRATION",
  },

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    ordersChanged: 0,
    positionsChanged: 0,
  },

  outputFile:
    "logs/alpha-v3-reservation-lock-order-targeted-audit.json",
};

fs.mkdirSync(
  path.dirname(reportFile),
  { recursive: true }
);

fs.writeFileSync(
  reportFile,
  JSON.stringify(report, null, 2) + "\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        report.status,

      classification:
        report.classification,

      createRpc: {
        advisoryLockCount:
          report.createRpc
            .advisoryLocks.length,

        orderRowForUpdateCount:
          report.createRpc
            .orderRowForUpdateStatements.length,

        preAdvisoryOrderRowLockCount:
          report.createRpc
            .preAdvisoryOrderRowLockCount,

        postAdvisoryOrderRowLockCount:
          report.createRpc
            .postAdvisoryOrderRowLockCount,

        preLockClassification:
          report.createRpc
            .preLockClassification,

        preLockControlFlow:
          report.createRpc
            .preLockControlFlow,
      },

      fillRpcLockOrder:
        report.fillRpc.lockOrder,

      needsReservationLockOrderPatch:
        report.decision
          .needsReservationLockOrderPatch,

      safeToProceedExpiryReconciliation:
        report.decision
          .safeToProceedExpiryReconciliation,

      databaseWrites:
        0,

      nextGate:
        report.decision.nextGate,

      outputFile:
        report.outputFile,
    },
    null,
    2
  )
);
