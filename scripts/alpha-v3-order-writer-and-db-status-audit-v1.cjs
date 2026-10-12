const fs = require("fs");
const path = require("path");

const root = process.cwd();

const sourceTargets = [
  "lib/trading/paper-order-service.ts",
  "lib/trading/execute-approved-paper-orders.ts",
  "lib/trading/execute-paper-order.ts",
  "lib/trading/generate-entry-signals.ts",
  "app/api/orders/paper/route.ts",
  "app/api/orders/paper/execute/route.ts",
  "app/api/orders/paper/execute-approved/route.ts",
  "supabase/migrations/002_paper_trading.sql",
  "supabase/migrations/003_execute_paper_orders.sql",
  "supabase/migrations/004_stop_loss_execution.sql",
  "supabase/migrations/20261008000100_committed_risk_reservation_v3.sql",
  "supabase/migrations/20261008000400_execute_paper_buy_order_committed_risk_lock.sql",
  "supabase/migrations/20261008000700_execute_paper_buy_order_lock_order_v2.sql",
  "supabase/migrations/20261008001000_committed_risk_expiry_reconciliation_v2.sql"
];

const knownStatuses = [
  "RISK_APPROVED",
  "RISK_REJECTED",
  "FILLED",
  "EXPIRED",
  "CANCELLED",
  "CANCELED",
  "FAILED",
  "APPROVED",
  "PENDING",
  "REJECTED",
  "CLOSED"
];

function parseEnvFile(file) {
  const env = {};

  if (!fs.existsSync(file)) {
    return env;
  }

  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const index = line.indexOf("=");

    if (index <= 0) {
      continue;
    }

    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

function lineOf(text, index) {
  return text
    .slice(0, Math.max(0, index))
    .split("\n")
    .length;
}

function excerpt(lines, line, radius = 5) {
  const start = Math.max(1, line - radius);
  const end = Math.min(lines.length, line + radius);

  return {
    startLine: start,
    endLine: end,
    text: lines
      .slice(start - 1, end)
      .map((value, i) => `${start + i}: ${value}`)
      .join("\n")
  };
}

function collectOccurrences(text, needle) {
  const rows = [];
  let cursor = 0;

  while (true) {
    const index = text.indexOf(needle, cursor);

    if (index < 0) {
      break;
    }

    rows.push({
      index,
      line: lineOf(text, index)
    });

    cursor = index + needle.length;
  }

  return rows;
}

function analyzeSource(rel) {
  const abs = path.resolve(root, rel);

  if (!fs.existsSync(abs)) {
    return {
      file: rel,
      exists: false
    };
  }

  const text = fs
    .readFileSync(abs, "utf8")
    .replace(/\r\n/g, "\n");

  const lines = text.split("\n");

  const statusMentions = {};

  for (const status of knownStatuses) {
    const occurrences = collectOccurrences(text, status);

    if (occurrences.length > 0) {
      statusMentions[status] = occurrences.map((item) => ({
        line: item.line,
        excerpt: excerpt(lines, item.line, 3)
      }));
    }
  }

  const directOrderInsert =
    /\.from\s*\(\s*["']paper_order_requests["']\s*\)[\s\S]{0,1200}?\.insert\s*\(/m.test(
      text
    );

  const directOrderUpdate =
    /\.from\s*\(\s*["']paper_order_requests["']\s*\)[\s\S]{0,1600}?\.update\s*\(/m.test(
      text
    );

  const usesAtomicCreateRpc =
    text.includes(
      "create_paper_buy_order_with_committed_risk_v3"
    ) ||
    text.includes(
      "createPaperBuyOrderWithCommittedRisk"
    );

  const usesFillRpc =
    text.includes(
      "execute_paper_buy_order"
    );

  const readsRiskApproved =
    text.includes(
      "RISK_APPROVED"
    ) &&
    (
      text.includes(
        'eq("status", "RISK_APPROVED")'
      ) ||
      text.includes(
        "status = 'RISK_APPROVED'"
      ) ||
      text.includes(
        "status='RISK_APPROVED'"
      )
    );

  const writesExpired =
    (
      text.includes(
        "EXPIRED"
      ) &&
      (
        /status\s*:\s*["']EXPIRED["']/m.test(text) ||
        /status\s*=\s*['"]EXPIRED['"]/m.test(text)
      )
    );

  const writesFilled =
    (
      text.includes(
        "FILLED"
      ) &&
      (
        /status\s*:\s*["']FILLED["']/m.test(text) ||
        /status\s*=\s*['"]FILLED['"]/m.test(text)
      )
    );

  let classification = "READ_OR_UNKNOWN";

  if (usesAtomicCreateRpc) {
    classification = "CANONICAL_CREATE_PATH";
  } else if (usesFillRpc) {
    classification = "CANONICAL_FILL_RPC_PATH";
  } else if (directOrderInsert || directOrderUpdate) {
    classification = "DIRECT_ORDER_TABLE_WRITER_REVIEW_REQUIRED";
  } else if (writesExpired) {
    classification = "EXPIRY_WRITER_REVIEW_REQUIRED";
  } else if (writesFilled) {
    classification = "FILLED_WRITER_REVIEW_REQUIRED";
  } else if (readsRiskApproved) {
    classification = "RISK_APPROVED_READER";
  }

  return {
    file: rel,
    exists: true,
    lineCount: lines.length,

    writerSignals: {
      directOrderInsert,
      directOrderUpdate,
      usesAtomicCreateRpc,
      usesFillRpc,
      readsRiskApproved,
      writesExpired,
      writesFilled
    },

    classification,
    statusMentions
  };
}

const sourceAudit =
  sourceTargets.map(
    analyzeSource
  );

const env = {
  ...parseEnvFile(
    path.resolve(root, ".env.local")
  ),
  ...process.env
};

const supabaseUrl =
  String(
    env.NEXT_PUBLIC_SUPABASE_URL ||
    env.SUPABASE_URL ||
    ""
  )
    .trim()
    .replace(/\/+$/, "");

const serviceRoleKey =
  String(
    env.SUPABASE_SERVICE_ROLE_KEY ||
    env.SUPABASE_SERVICE_KEY ||
    ""
  ).trim();

async function parseResponse(response) {
  const text = await response.text();

  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return {
      raw: text
    };
  }
}

async function fetchStatusRows() {
  if (
    !supabaseUrl ||
    !serviceRoleKey
  ) {
    return {
      ok: false,
      status: null,
      rows: null,
      error:
        "SUPABASE_SERVICE_ROLE_CONFIG_MISSING"
    };
  }

  const response =
    await fetch(
      supabaseUrl +
      "/rest/v1/paper_order_requests" +
      "?select=id,status,side,reserved_risk_amount,reserved_risk_released_at,created_at" +
      "&order=created_at.desc" +
      "&limit=5000",
      {
        method: "GET",

        headers: {
          apikey:
            serviceRoleKey,

          authorization:
            "Bearer " +
            serviceRoleKey
        },

        cache:
          "no-store"
      }
    );

  const payload =
    await parseResponse(
      response
    );

  return {
    ok:
      response.ok,
    status:
      response.status,
    rows:
      Array.isArray(payload)
        ? payload
        : null,
    error:
      response.ok
        ? null
        : payload
  };
}

function summarizeRows(rows) {
  const statusCounts = {};
  const sideCounts = {};
  const statusSideCounts = {};

  let activeReservationCount = 0;
  let activeReservedRiskAmount = 0;

  for (const row of rows) {
    const status =
      String(
        row.status ??
        "NULL"
      );

    const side =
      String(
        row.side ??
        "NULL"
      );

    statusCounts[status] =
      (statusCounts[status] ?? 0) +
      1;

    sideCounts[side] =
      (sideCounts[side] ?? 0) +
      1;

    const pair =
      `${side}:${status}`;

    statusSideCounts[pair] =
      (statusSideCounts[pair] ?? 0) +
      1;

    const reserved =
      Number(
        row.reserved_risk_amount ??
        0
      );

    if (
      reserved > 0 &&
      !row.reserved_risk_released_at
    ) {
      activeReservationCount += 1;
      activeReservedRiskAmount += reserved;
    }
  }

  return {
    rowCount:
      rows.length,

    statusCounts,
    sideCounts,
    statusSideCounts,

    activeReservationCount,
    activeReservedRiskAmount
  };
}

async function main() {
  const dbResult =
    await fetchStatusRows();

  const dbSummary =
    dbResult.ok &&
    Array.isArray(
      dbResult.rows
    )
      ? summarizeRows(
          dbResult.rows
        )
      : null;

  const observedDbStatuses =
    dbSummary
      ? Object.keys(
          dbSummary.statusCounts
        )
      : [];

  const legacyObserved =
    observedDbStatuses.filter(
      (status) =>
        [
          "APPROVED",
          "PENDING",
          "REJECTED",
          "CLOSED",
          "CANCELED"
        ].includes(
          status
        )
    );

  const unknownObserved =
    observedDbStatuses.filter(
      (status) =>
        !knownStatuses.includes(
          status
        )
    );

  const directWriters =
    sourceAudit.filter(
      (item) =>
        item.exists &&
        (
          item.writerSignals
            ?.directOrderInsert ||
          item.writerSignals
            ?.directOrderUpdate
        )
    );

  const blockers = [];

  if (!dbResult.ok) {
    blockers.push(
      "PRODUCTION_ORDER_STATUS_DISTRIBUTION_NOT_VERIFIED"
    );
  }

  if (
    legacyObserved.length > 0
  ) {
    blockers.push(
      "LEGACY_ORDER_STATUSES_EXIST_IN_DB"
    );
  }

  if (
    unknownObserved.length > 0
  ) {
    blockers.push(
      "UNKNOWN_ORDER_STATUSES_EXIST_IN_DB"
    );
  }

  const report = {
    status:
      "ALPHA_V3_ORDER_WRITER_AND_DB_STATUS_AUDIT_COMPLETE",

    sourceAudit,

    productionDb: {
      readOk:
        dbResult.ok,

      httpStatus:
        dbResult.status,

      summary:
        dbSummary,

      legacyObserved,
      unknownObserved,

      error:
        dbResult.error
    },

    decision: {
      directWriterCount:
        directWriters.length,

      directWriters:
        directWriters.map(
          (item) => ({
            file:
              item.file,

            classification:
              item.classification,

            writerSignals:
              item.writerSignals
          })
        ),

      blockers,

      safeToAddDbTransitionGuard:
        blockers.length ===
          0,

      recommendedBindingOrder: [
        "DB_TRANSITION_GUARD_FIRST_IN_AUDIT_ONLY_OR_COMPATIBLE_MODE",
        "COMMITTED_RISK_CREATE_RPC",
        "BUY_FILL_RPC",
        "EXPIRY_RPC",
        "APPLICATION_WRITER_ASSERTIONS",
        "THEN_ENABLE_STRICT_DB_ENFORCEMENT"
      ]
    },

    safety: {
      sourceFilesModified:
        0,

      databaseReads:
        dbResult.ok
          ? 1
          : 0,

      databaseWrites:
        0,

      ordersCreated:
        0,

      ordersChanged:
        0,

      positionsChanged:
        0
    },

    nextGate:
      blockers.length ===
        0
        ? "BUILD_DB_TRANSITION_GUARD_AUDIT_MODE_V1"
        : "REVIEW_LEGACY_OR_UNKNOWN_DB_STATUSES_BEFORE_ENFORCEMENT"
  };

  const logFile =
    path.resolve(
      root,
      "logs/alpha-v3-order-writer-and-db-status-audit-v1.json"
    );

  fs.mkdirSync(
    path.dirname(logFile),
    {
      recursive: true
    }
  );

  fs.writeFileSync(
    logFile,
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

        sourceSummary: {
          fileCount:
            sourceAudit.length,

          directWriterCount:
            directWriters.length,

          classifications:
            Object.fromEntries(
              [...new Set(
                sourceAudit
                  .filter(
                    (item) =>
                      item.exists
                  )
                  .map(
                    (item) =>
                      item.classification
                  )
              )]
                .map(
                  (classification) => [
                    classification,
                    sourceAudit.filter(
                      (item) =>
                        item.classification ===
                        classification
                    ).length
                  ]
                )
            )
        },

        productionDb:
          report.productionDb,

        decision:
          report.decision,

        safety:
          report.safety,

        logFile:
          "logs/alpha-v3-order-writer-and-db-status-audit-v1.json",

        nextGate:
          report.nextGate
      },
      null,
      2
    )
  );
}

main().catch(
  (error) => {
    console.error(
      JSON.stringify(
        {
          status:
            "ALPHA_V3_ORDER_WRITER_AND_DB_STATUS_AUDIT_FATAL",

          error:
            error instanceof Error
              ? error.message
              : String(error),

          safety: {
            databaseWrites: 0,
            ordersCreated: 0,
            positionsChanged: 0
          },

          nextGate:
            "REVIEW_ORDER_WRITER_AUDIT_FATAL"
        },
        null,
        2
      )
    );

    process.exitCode =
      2;
  }
);
