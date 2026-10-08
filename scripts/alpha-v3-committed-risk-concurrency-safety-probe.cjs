const fs = require("fs");
const path = require("path");

const root = process.cwd();

const outputFile =
  path.resolve(
    root,
    "logs/alpha-v3-committed-risk-concurrency-safety-probe.json"
  );

const migrationBackupDir =
  path.resolve(
    root,
    "backups/migrations/committed-risk"
  );

const migrationDir =
  path.resolve(
    root,
    "supabase/migrations"
  );

function rel(file) {
  return path
    .relative(root, file)
    .replace(/\\/g, "/");
}

function walk(dir, maxDepth = 7, depth = 0) {
  if (
    depth > maxDepth ||
    !fs.existsSync(dir)
  ) {
    return [];
  }

  const rows = [];

  for (
    const entry
    of fs.readdirSync(
      dir,
      { withFileTypes: true }
    )
  ) {
    if (
      [
        "node_modules",
        ".git",
        ".next",
        "logs",
        "backups",
      ].includes(entry.name)
    ) {
      continue;
    }

    const full =
      path.join(dir, entry.name);

    if (entry.isDirectory()) {
      rows.push(
        ...walk(
          full,
          maxDepth,
          depth + 1
        )
      );
    } else if (
      /\.(ts|tsx|js|cjs|mjs|sql)$/i.test(
        entry.name
      )
    ) {
      rows.push(full);
    }
  }

  return rows;
}

function lineNo(text, index) {
  return (
    text
      .slice(0, index)
      .split(/\r?\n/)
      .length
  );
}

function context(text, index, radius = 5) {
  const lines =
    text.replace(/\r\n/g, "\n")
      .split("\n");

  const line =
    lineNo(text, index);

  const start =
    Math.max(1, line - radius);

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

function findAll(text, regex, radius = 5) {
  const rows = [];
  let match;

  while (
    (match = regex.exec(text))
  ) {
    rows.push({
      match: match[0],
      ...context(
        text,
        match.index,
        radius
      ),
    });
  }

  return rows;
}

/*
 * Clean up the two local backup files that Supabase CLI warns about.
 * This is local filesystem housekeeping only; no database access.
 */
const movedBackupFiles = [];

if (fs.existsSync(migrationDir)) {
  const backupNames =
    fs.readdirSync(migrationDir)
      .filter(
        (name) =>
          name.startsWith(
            "20261008000100_committed_risk_reservation_v3.sql.before-security-hardening-"
          ) &&
          name.endsWith(".bak")
      );

  if (backupNames.length > 0) {
    fs.mkdirSync(
      migrationBackupDir,
      { recursive: true }
    );
  }

  for (const name of backupNames) {
    const from =
      path.join(
        migrationDir,
        name
      );

    const to =
      path.join(
        migrationBackupDir,
        name
      );

    if (
      fs.existsSync(to)
    ) {
      fs.rmSync(
        to,
        { force: true }
      );
    }

    fs.renameSync(
      from,
      to
    );

    movedBackupFiles.push({
      from: rel(from),
      to: rel(to),
    });
  }
}

const files =
  walk(root);

const interesting = [];

for (const file of files) {
  let text;

  try {
    text =
      fs.readFileSync(
        file,
        "utf8"
      );
  } catch {
    continue;
  }

  const lower =
    text.toLowerCase();

  if (
    !lower.includes(
      "risk_approved"
    ) &&
    !lower.includes(
      "execute_paper_buy_order"
    ) &&
    !lower.includes(
      "executeapprovedpaperorders"
    ) &&
    !lower.includes(
      "execute-approved-paper-orders"
    ) &&
    !lower.includes(
      "paper_order_requests"
    )
  ) {
    continue;
  }

  const riskApproved =
    findAll(
      text,
      /RISK_APPROVED/g,
      7
    );

  const executeRpc =
    findAll(
      text,
      /execute_paper_buy_order/gi,
      8
    );

  const accountFilters =
    findAll(
      text,
      /\.eq\s*\(\s*["']account_id["']|account_id\s*=|p_account_id/gi,
      7
    );

  const schedulerTerms =
    findAll(
      text,
      /\b(cron|schedule|automation|interval|setInterval|executeApprovedPaperOrders)\b/gi,
      5
    );

  const filledTerms =
    findAll(
      text,
      /\bFILLED\b/g,
      5
    );

  if (
    riskApproved.length ||
    executeRpc.length ||
    accountFilters.length ||
    schedulerTerms.length ||
    filledTerms.length
  ) {
    interesting.push({
      file: rel(file),
      riskApproved,
      executeRpc,
      accountFilters,
      schedulerTerms,
      filledTerms,
    });
  }
}

const executorFiles =
  interesting.filter(
    (row) =>
      /execute-approved-paper-orders|execute-paper-order|orders\/paper\/execute|trading_automation|automation/i.test(
        row.file
      )
  );

const sqlFile =
  path.resolve(
    root,
    "supabase/migrations/003_execute_paper_orders.sql"
  );

let sqlAnalysis = null;

if (fs.existsSync(sqlFile)) {
  const sql =
    fs.readFileSync(
      sqlFile,
      "utf8"
    );

  const fnStart =
    sql.search(
      /create\s+(?:or\s+replace\s+)?function\s+public\.execute_paper_buy_order/i
    );

  const functionSlice =
    fnStart >= 0
      ? sql.slice(
          fnStart,
          Math.min(
            sql.length,
            fnStart + 30000
          )
        )
      : "";

  const positionMutationIndex =
    functionSlice.search(
      /\b(?:insert\s+into|update)\s+public\.paper_positions\b/i
    );

  const filledUpdateIndex =
    functionSlice.search(
      /update\s+public\.paper_order_requests[\s\S]{0,1200}?status\s*=\s*['"]FILLED['"]/i
    );

  const advisoryLock =
    /pg_advisory_xact_lock/i.test(
      functionSlice
    );

  sqlAnalysis = {
    functionFound:
      fnStart >= 0,

    advisoryLock,

    positionMutationIndex,
    filledUpdateIndex,

    positionMutationBeforeFilled:
      positionMutationIndex >= 0 &&
      filledUpdateIndex >= 0 &&
      positionMutationIndex <
        filledUpdateIndex,

    orderRowForUpdate:
      /paper_order_requests[\s\S]{0,600}?for\s+update/i.test(
        functionSlice
      ),

    accountScopedLock:
      /AI_STOCK_LAB_COMMITTED_RISK_V3|hashtext[\s\S]{0,200}?account/i.test(
        functionSlice
      ),
  };
}

/*
 * Determine whether there appears to be an autonomous execution path.
 */
const autonomousEvidence =
  executorFiles.flatMap(
    (row) =>
      row.schedulerTerms.map(
        (hit) => ({
          file: row.file,
          line: hit.line,
          match: hit.match,
          snippet: hit.snippet,
        })
      )
  );

const riskApprovedSelectors =
  executorFiles.flatMap(
    (row) =>
      row.riskApproved.map(
        (hit) => ({
          file: row.file,
          line: hit.line,
          snippet: hit.snippet,
        })
      )
  );

const accountFilterEvidence =
  executorFiles.flatMap(
    (row) =>
      row.accountFilters.map(
        (hit) => ({
          file: row.file,
          line: hit.line,
          snippet: hit.snippet,
        })
      )
  );

const hasRiskApprovedExecutor =
  riskApprovedSelectors.length > 0;

const autonomousExecutionPossible =
  autonomousEvidence.length > 0;

const hasAccountFilterEvidence =
  accountFilterEvidence.length > 0;

/*
 * Conservative recommendation:
 * - If any autonomous executor can see RISK_APPROVED orders, do NOT create
 *   production-shaped test orders in a normal account.
 * - Prefer a dedicated isolated DB test harness/table or a test account only
 *   after proving executor exclusion.
 */
let recommendedTestMode =
  "DEDICATED_ISOLATED_TEST_HARNESS";

let reason =
  "CONSERVATIVE_DEFAULT";

if (
  hasRiskApprovedExecutor &&
  autonomousExecutionPossible
) {
  recommendedTestMode =
    "DEDICATED_ISOLATED_TEST_HARNESS";

  reason =
    "RISK_APPROVED_ORDERS_MAY_BE_AUTONOMOUSLY_EXECUTED";
} else if (
  hasRiskApprovedExecutor &&
  !hasAccountFilterEvidence
) {
  recommendedTestMode =
    "DEDICATED_ISOLATED_TEST_HARNESS";

  reason =
    "EXECUTOR_SELECTS_RISK_APPROVED_WITHOUT_CLEAR_ACCOUNT_EXCLUSION";
} else if (
  hasRiskApprovedExecutor &&
  hasAccountFilterEvidence
) {
  recommendedTestMode =
    "DEDICATED_TEST_ACCOUNT_ONLY_AFTER_ACCOUNT_FILTER_CONFIRMATION";

  reason =
    "ACCOUNT_FILTER_SURFACE_EXISTS_BUT_REQUIRES_EXACT_CONFIRMATION";
} else {
  recommendedTestMode =
    "CONTROLLED_MAIN_RPC_TEST_WITH_IMMEDIATE_CLEANUP_MAY_BE_SAFE";

  reason =
    "NO_RISK_APPROVED_EXECUTOR_SURFACE_DETECTED";
}

const report = {
  status:
    "ALPHA_V3_COMMITTED_RISK_CONCURRENCY_SAFETY_PROBE_COMPLETE",

  migrationHousekeeping: {
    movedBackupFiles,
    supabaseMigrationWarningsExpectedAfterCleanup:
      false,
  },

  executor: {
    files:
      executorFiles.map(
        (row) => row.file
      ),

    hasRiskApprovedExecutor,

    autonomousExecutionPossible,

    hasAccountFilterEvidence,

    riskApprovedSelectors,

    autonomousEvidence,

    accountFilterEvidence,
  },

  executeRpcSql:
    sqlAnalysis,

  decision: {
    recommendedTestMode,
    reason,

    safeToCreateNormalRiskApprovedTestOrders:
      recommendedTestMode ===
      "CONTROLLED_MAIN_RPC_TEST_WITH_IMMEDIATE_CLEANUP_MAY_BE_SAFE",

    nextGate:
      recommendedTestMode ===
      "DEDICATED_ISOLATED_TEST_HARNESS"
        ? "BUILD_ISOLATED_DB_CONCURRENCY_HARNESS"
        : recommendedTestMode ===
          "DEDICATED_TEST_ACCOUNT_ONLY_AFTER_ACCOUNT_FILTER_CONFIRMATION"
          ? "CONFIRM_EXECUTOR_ACCOUNT_SCOPE_THEN_BUILD_TEST_ACCOUNT"
          : "BUILD_CONTROLLED_COMMITTED_RISK_CONCURRENCY_TEST",
  },

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    ordersCreated: 0,
    positionsChanged: 0,
    migrationFilesChanged:
      movedBackupFiles.length > 0,
  },

  outputFile:
    "logs/alpha-v3-committed-risk-concurrency-safety-probe.json",
};

fs.mkdirSync(
  path.dirname(outputFile),
  { recursive: true }
);

fs.writeFileSync(
  outputFile,
  JSON.stringify(
    report,
    null,
    2
  ) + "\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        report.status,

      movedMigrationBackupFiles:
        report.migrationHousekeeping
          .movedBackupFiles,

      executorFiles:
        report.executor.files,

      hasRiskApprovedExecutor:
        report.executor
          .hasRiskApprovedExecutor,

      autonomousExecutionPossible:
        report.executor
          .autonomousExecutionPossible,

      hasAccountFilterEvidence:
        report.executor
          .hasAccountFilterEvidence,

      executeRpcSql:
        report.executeRpcSql,

      recommendedTestMode:
        report.decision
          .recommendedTestMode,

      reason:
        report.decision.reason,

      safeToCreateNormalRiskApprovedTestOrders:
        report.decision
          .safeToCreateNormalRiskApprovedTestOrders,

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
