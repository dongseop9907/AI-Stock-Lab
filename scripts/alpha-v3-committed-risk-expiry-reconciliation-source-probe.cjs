const fs = require("fs");
const path = require("path");

const root = process.cwd();

const reportFile = path.resolve(
  root,
  "logs/alpha-v3-committed-risk-expiry-reconciliation-source-probe.json"
);

function rel(file) {
  return path.relative(root, file).replace(/\\/g, "/");
}

function readIf(file) {
  if (!fs.existsSync(file)) {
    return null;
  }

  return fs.readFileSync(file, "utf8");
}

function walk(dir, depth = 0, maxDepth = 7) {
  if (!fs.existsSync(dir) || depth > maxDepth) {
    return [];
  }

  const rows = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
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

    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      rows.push(...walk(full, depth + 1, maxDepth));
    } else if (/\.(sql|ts|tsx|js|cjs|mjs)$/i.test(entry.name)) {
      rows.push(full);
    }
  }

  return rows;
}

function lineNumber(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function snippets(text, regex, radius = 5, max = 20) {
  const out = [];
  let match;

  while ((match = regex.exec(text)) && out.length < max) {
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    const line = lineNumber(text, match.index);
    const start = Math.max(1, line - radius);
    const end = Math.min(lines.length, line + radius);

    out.push({
      match: match[0],
      line,
      snippet: lines
        .slice(start - 1, end)
        .map((value, offset) => `${start + offset}: ${value}`)
        .join("\n"),
    });
  }

  return out;
}

function extractCreateTable(text, tableName) {
  if (!text) {
    return null;
  }

  const escaped = tableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const match = new RegExp(
    `create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?(?:public\\.)?${escaped}\\s*\\(([\\s\\S]*?)\\)\\s*;`,
    "i"
  ).exec(text);

  return match ? match[0] : null;
}

function extractFunction(text, functionName) {
  if (!text) {
    return null;
  }

  const escaped = functionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const startMatch = new RegExp(
    `create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${escaped}\\s*\\(`,
    "i"
  ).exec(text);

  if (!startMatch) {
    return null;
  }

  const start = startMatch.index;
  const rest = text.slice(start);

  const asMatch = /\bas\s+(\$[A-Za-z0-9_]*\$)/i.exec(rest);

  if (!asMatch) {
    return text.slice(start, Math.min(text.length, start + 12000));
  }

  const delimiter = asMatch[1];
  const firstDelimiter =
    start + asMatch.index + asMatch[0].length - delimiter.length;
  const bodyStart = firstDelimiter + delimiter.length;
  const closing = text.indexOf(delimiter, bodyStart);

  if (closing < 0) {
    return text.slice(start, Math.min(text.length, start + 12000));
  }

  const semicolon = text.indexOf(";", closing + delimiter.length);
  const end = semicolon >= 0 ? semicolon + 1 : closing + delimiter.length;

  return text.slice(start, end);
}

const migrationFiles = [
  "supabase/migrations/002_paper_trading.sql",
  "supabase/migrations/003_execute_paper_orders.sql",
  "supabase/migrations/008_paper_order_risk_columns.sql",
  "supabase/migrations/20261008000100_committed_risk_reservation_v3.sql",
  "supabase/migrations/20261008000400_execute_paper_buy_order_committed_risk_lock.sql",
  "supabase/migrations/20261008000700_execute_paper_buy_order_lock_order_v2.sql",
].map((relPath) => ({
  rel: relPath,
  file: path.resolve(root, relPath),
}));

const migrationText = Object.fromEntries(
  migrationFiles.map(({ rel: relPath, file }) => [
    relPath,
    readIf(file),
  ])
);

const paperOrderCreate =
  extractCreateTable(
    migrationText["supabase/migrations/002_paper_trading.sql"],
    "paper_order_requests"
  );

const committedSql =
  migrationText[
    "supabase/migrations/20261008000100_committed_risk_reservation_v3.sql"
  ] ?? "";

const createRpc =
  extractFunction(
    committedSql,
    "create_paper_buy_order_with_committed_risk_v3"
  );

const releaseRpc =
  extractFunction(
    committedSql,
    "release_paper_buy_risk_v3"
  );

const terminalTriggerFns = [];
for (const match of committedSql.matchAll(
  /create\s+(?:or\s+replace\s+)?function\s+public\.([A-Za-z_][A-Za-z0-9_]*)\s*\(/gi
)) {
  const name = match[1];

  const fn = extractFunction(committedSql, name);

  if (
    fn &&
    /reserved_risk|EXPIRED|CANCELLED|CANCELED|FILLED|RISK_REJECTED/i.test(fn)
  ) {
    terminalTriggerFns.push({
      name,
      definition: fn,
    });
  }
}

const allFiles = walk(root);

const executorEvidence = [];
const schedulerEvidence = [];
const statusEvidence = [];

for (const file of allFiles) {
  let text;

  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    continue;
  }

  if (
    /paper_order_requests|RISK_APPROVED|executeApprovedPaperOrders|execute-approved-paper-orders/i.test(
      text
    )
  ) {
    const selectors = snippets(
      text,
      /\.eq\s*\(\s*["']status["']\s*,\s*["'][A-Z_]+["']|RISK_APPROVED|paper_order_requests/gi,
      6,
      16
    );

    const timeFilters = snippets(
      text,
      /created_at|updated_at|reserved_risk_at|expires?_at|ttl|timeout|stale|older\s+than/gi,
      6,
      16
    );

    if (selectors.length || timeFilters.length) {
      executorEvidence.push({
        file: rel(file),
        selectors,
        timeFilters,
      });
    }
  }

  if (
    /\b(cron|schedule|setInterval|automation|pollMinutes|polling|every\s+\d+)\b/i.test(
      text
    )
  ) {
    const hits = snippets(
      text,
      /\b(cron|schedule|setInterval|automation|pollMinutes|polling|every\s+\d+)\b/gi,
      5,
      12
    );

    if (hits.length) {
      schedulerEvidence.push({
        file: rel(file),
        hits,
      });
    }
  }

  if (
    /\b(RISK_APPROVED|RISK_REJECTED|REJECTED|CANCELLED|CANCELED|EXPIRED|FAILED|FILLED|CLOSED)\b/.test(
      text
    )
  ) {
    const hits = snippets(
      text,
      /\b(RISK_APPROVED|RISK_REJECTED|REJECTED|CANCELLED|CANCELED|EXPIRED|FAILED|FILLED|CLOSED)\b/g,
      3,
      24
    );

    if (hits.length) {
      statusEvidence.push({
        file: rel(file),
        hits,
      });
    }
  }
}

const orderColumns = {};

if (paperOrderCreate) {
  const candidateColumns = [
    "id",
    "account_id",
    "stock_code",
    "side",
    "status",
    "quantity",
    "qty",
    "entry_price",
    "requested_price",
    "stop_price",
    "created_at",
    "updated_at",
    "executed_at",
    "reserved_risk_amount",
    "reserved_risk_at",
    "reserved_risk_released_at",
    "reserved_risk_release_reason",
    "risk_decision_id",
  ];

  for (const column of candidateColumns) {
    orderColumns[column] = new RegExp(
      `\\b${column}\\b`,
      "i"
    ).test(paperOrderCreate);
  }
}

const alterColumnEvidence = snippets(
  committedSql,
  /add\s+column[\s\S]{0,120}?reserved_risk_[A-Za-z_]+|add\s+column[\s\S]{0,120}?committed_risk_[A-Za-z_]+/gi,
  3,
  20
);

const releaseStatuses =
  releaseRpc
    ? [
        ...new Set(
          (
            releaseRpc.match(
              /\b(RISK_APPROVED|RISK_REJECTED|REJECTED|CANCELLED|CANCELED|EXPIRED|FAILED|FILLED|CLOSED)\b/g
            ) ?? []
          )
        ),
      ]
    : [];

const triggerStatuses = [
  ...new Set(
    terminalTriggerFns.flatMap((row) =>
      row.definition.match(
        /\b(RISK_APPROVED|RISK_REJECTED|REJECTED|CANCELLED|CANCELED|EXPIRED|FAILED|FILLED|CLOSED)\b/g
      ) ?? []
    )
  ),
];

const createRpcLockOrder = createRpc
  ? {
      advisoryLockIndex: createRpc.search(/pg_advisory_xact_lock/i),
      existingOrderForUpdateIndex: createRpc.search(/risk_decision_id[\s\S]{0,1000}?for\s+update/i),
      insertOrderIndex: createRpc.search(/insert\s+into\s+public\.paper_order_requests/i),
    }
  : null;

const report = {
  status:
    "ALPHA_V3_COMMITTED_RISK_EXPIRY_RECONCILIATION_SOURCE_PROBE_COMPLETE",

  paperOrderSchema: {
    createTableFound: Boolean(paperOrderCreate),
    columnsFromCreateTable: orderColumns,
    reservationAlterEvidence: alterColumnEvidence,
  },

  committedRiskRpc: {
    createRpcFound: Boolean(createRpc),
    releaseRpcFound: Boolean(releaseRpc),
    createRpcLockOrder,
    releaseStatuses,
  },

  terminalRelease: {
    functions: terminalTriggerFns.map((row) => ({
      name: row.name,
      statuses: [
        ...new Set(
          row.definition.match(
            /\b(RISK_APPROVED|RISK_REJECTED|REJECTED|CANCELLED|CANCELED|EXPIRED|FAILED|FILLED|CLOSED)\b/g
          ) ?? []
        ),
      ],
      hasReservedRiskRelease:
        /reserved_risk_amount\s*=\s*0|reserved_risk_released_at|release_paper_buy_risk_v3/i.test(
          row.definition
        ),
    })),
    statuses: triggerStatuses,
    expiredCovered: triggerStatuses.includes("EXPIRED"),
    filledCovered: triggerStatuses.includes("FILLED"),
  },

  executor: {
    files: executorEvidence,
    riskApprovedExecutorPresent:
      executorEvidence.some((row) =>
        row.selectors.some((hit) =>
          /RISK_APPROVED/i.test(hit.match + "\n" + hit.snippet)
        )
      ),
    hasExistingExpiryFilter:
      executorEvidence.some((row) =>
        row.timeFilters.some((hit) =>
          /expires?_at|ttl|stale|older\s+than/i.test(
            hit.match + "\n" + hit.snippet
          )
        )
      ),
  },

  scheduler: {
    evidence: schedulerEvidence,
    automationSurfacePresent: schedulerEvidence.length > 0,
  },

  statuses: {
    files: statusEvidence,
    knownTerminalStatuses: [
      ...new Set([
        ...releaseStatuses,
        ...triggerStatuses,
      ]),
    ],
  },

  designInputs: {
    recommendedStaleAnchorPreference: [
      "reserved_risk_at",
      "created_at",
    ],

    expireAction:
      "SET_ORDER_STATUS_EXPIRED_UNDER_ACCOUNT_LOCK_AND_RELEASE_RESERVATION_IN_SAME_TRANSACTION",

    reconcileGoals: [
      "RELEASE_TERMINAL_STATUS_RESERVATIONS_LEFT_NONZERO",
      "EXPIRE_STALE_RISK_APPROVED_RESERVATIONS",
      "REPORT_ACTIVE_RISK_APPROVED_WITH_ZERO_OR_MISSING_RESERVATION",
      "NEVER_INCREASE_RESERVED_RISK_DURING_RECONCILIATION",
    ],
  },

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    ordersChanged: 0,
    positionsChanged: 0,
  },

  nextGate:
    "BUILD_EXPIRY_AND_RECONCILIATION_MIGRATION_FROM_CONFIRMED_SOURCE_CONTRACT",

  outputFile:
    "logs/alpha-v3-committed-risk-expiry-reconciliation-source-probe.json",
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
      status: report.status,

      paperOrderSchema:
        report.paperOrderSchema,

      committedRiskRpc:
        report.committedRiskRpc,

      terminalRelease:
        report.terminalRelease,

      executor: {
        riskApprovedExecutorPresent:
          report.executor.riskApprovedExecutorPresent,

        hasExistingExpiryFilter:
          report.executor.hasExistingExpiryFilter,

        files:
          report.executor.files.map((row) => row.file),
      },

      scheduler: {
        automationSurfacePresent:
          report.scheduler.automationSurfacePresent,

        files:
          report.scheduler.evidence.map((row) => row.file),
      },

      knownTerminalStatuses:
        report.statuses.knownTerminalStatuses,

      databaseWrites: 0,

      nextGate:
        report.nextGate,

      outputFile:
        report.outputFile,
    },
    null,
    2
  )
);
