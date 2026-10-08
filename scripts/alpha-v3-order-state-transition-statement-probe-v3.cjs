const fs = require("fs");
const path = require("path");

const root = process.cwd();

const targets = [
  "app/api/orders/paper/execute/route.ts",
  "lib/trading/execute-approved-paper-orders.ts",
  "lib/trading/execute-paper-order.ts",
  "lib/trading/generate-entry-signals.ts",
  "lib/trading/paper-order-service.ts",
  "supabase/migrations/002_paper_trading.sql",
  "supabase/migrations/003_execute_paper_orders.sql",
  "supabase/migrations/004_stop_loss_execution.sql",
  "supabase/migrations/008_bind_models_to_orders.sql",
  "supabase/migrations/011_entry_signal_engine.sql",
  "supabase/migrations/012_reset_paper_account.sql",
  "supabase/migrations/20261008000100_committed_risk_reservation_v3.sql",
  "supabase/migrations/20261008000400_execute_paper_buy_order_committed_risk_lock.sql",
  "supabase/migrations/20261008000700_execute_paper_buy_order_lock_order_v2.sql",
  "supabase/migrations/20261008001000_committed_risk_expiry_reconciliation_v2.sql"
];

const states = [
  "APPROVED",
  "CANCELED",
  "CANCELLED",
  "CLOSED",
  "EXPIRED",
  "FAILED",
  "FILLED",
  "PENDING",
  "REJECTED",
  "RISK_APPROVED",
  "RISK_REJECTED"
];

function lineOf(text, index) {
  return text
    .slice(0, Math.max(0, index))
    .split("\n")
    .length;
}

function excerpt(lines, startLine, endLine) {
  return {
    startLine,
    endLine,
    text: lines
      .slice(startLine - 1, endLine)
      .map((line, i) => `${startLine + i}: ${line}`)
      .join("\n")
  };
}

function stateTokens(raw) {
  const found = [];

  for (const state of states) {
    if (
      raw.includes(`'${state}'`) ||
      raw.includes(`"${state}"`) ||
      raw.includes(state)
    ) {
      if (!found.includes(state)) {
        found.push(state);
      }
    }
  }

  return found;
}

function uniqueBy(items, keyFn) {
  const seen = new Set();

  return items.filter((item) => {
    const key = keyFn(item);

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

const evidence = [];
const writers = [];
const readers = [];
const aliases = [];
const files = [];

for (const rel of targets) {
  const abs = path.resolve(root, rel);

  if (!fs.existsSync(abs)) {
    files.push({
      file: rel,
      exists: false
    });

    continue;
  }

  const text = fs
    .readFileSync(abs, "utf8")
    .replace(/\r\n/g, "\n");

  const lines = text.split("\n");

  files.push({
    file: rel,
    exists: true,
    lineCount: lines.length
  });

  /*
   * SQL UPDATE paper_order_requests ... ;
   * Only pair SET status and WHERE status inside the same SQL statement.
   */
  const sqlUpdateRegex =
    /update\s+(?:public\.)?paper_order_requests\b[\s\S]*?;/gim;

  for (const match of text.matchAll(sqlUpdateRegex)) {
    const statement = match[0];
    const index = match.index ?? 0;
    const startLine = lineOf(text, index);
    const endLine =
      startLine +
      statement.split("\n").length -
      1;

    const setMatch =
      statement.match(
        /\bset\b[\s\S]*?\bstatus\s*=\s*['"]([A-Z][A-Z0-9_]+)['"]/i
      );

    const toState =
      setMatch?.[1] &&
      states.includes(setMatch[1])
        ? setMatch[1]
        : null;

    const wherePart =
      statement
        .split(/\bwhere\b/i)
        .slice(1)
        .join(" where ");

    const fromStates = [];

    const eqMatches =
      wherePart.matchAll(
        /\bstatus\s*=\s*['"]([A-Z][A-Z0-9_]+)['"]/gi
      );

    for (const m of eqMatches) {
      if (
        states.includes(m[1]) &&
        !fromStates.includes(m[1])
      ) {
        fromStates.push(m[1]);
      }
    }

    const inMatches =
      wherePart.matchAll(
        /\bstatus\s+in\s*\(([^)]+)\)/gi
      );

    for (const m of inMatches) {
      for (const state of states) {
        if (
          m[1].includes(`'${state}'`) ||
          m[1].includes(`"${state}"`)
        ) {
          if (!fromStates.includes(state)) {
            fromStates.push(state);
          }
        }
      }
    }

    const item = {
      kind: "SQL_UPDATE",
      file: rel,
      startLine,
      endLine,
      fromStates,
      toState,
      statement: excerpt(
        lines,
        startLine,
        Math.min(endLine, startLine + 80)
      )
    };

    writers.push(item);

    if (
      toState &&
      fromStates.length > 0
    ) {
      for (const from of fromStates) {
        evidence.push({
          from,
          to: toState,
          kind: "SQL_UPDATE",
          file: rel,
          line: startLine
        });
      }
    }
  }

  /*
   * SQL INSERT INTO paper_order_requests ... VALUES ...
   * Capture initial status when the column mapping is explicit.
   */
  const sqlInsertRegex =
    /insert\s+into\s+(?:public\.)?paper_order_requests\s*\(([\s\S]*?)\)\s*values\s*\(([\s\S]*?)\)\s*;/gim;

  for (const match of text.matchAll(sqlInsertRegex)) {
    const index = match.index ?? 0;
    const startLine = lineOf(text, index);
    const statement = match[0];
    const endLine =
      startLine +
      statement.split("\n").length -
      1;

    const columns =
      match[1]
        .split(",")
        .map((v) => v.trim().replace(/"/g, ""));

    const values =
      match[2]
        .split(",")
        .map((v) => v.trim());

    const statusIndex =
      columns.findIndex(
        (column) =>
          column.toLowerCase() === "status"
      );

    let initialState = null;

    if (
      statusIndex >= 0 &&
      statusIndex < values.length
    ) {
      const raw =
        values[statusIndex];

      for (const state of states) {
        if (
          raw.includes(`'${state}'`) ||
          raw.includes(`"${state}"`)
        ) {
          initialState = state;
          break;
        }
      }
    }

    writers.push({
      kind: "SQL_INSERT",
      file: rel,
      startLine,
      endLine,
      fromStates: [],
      toState: initialState,
      statement: excerpt(
        lines,
        startLine,
        Math.min(endLine, startLine + 80)
      )
    });

    if (initialState) {
      evidence.push({
        from: "__CREATE__",
        to: initialState,
        kind: "SQL_INSERT",
        file: rel,
        line: startLine
      });
    }
  }

  /*
   * TypeScript Supabase chain:
   * .from("paper_order_requests") ... .update({ status: "X" }) ...
   * .eq("status","Y") / .in("status",[...])
   *
   * Bound the chain from .from(...) until semicolon.
   */
  const fromRegex =
    /\.from\s*\(\s*["']paper_order_requests["']\s*\)/g;

  for (const fromMatch of text.matchAll(fromRegex)) {
    const startIndex =
      fromMatch.index ?? 0;

    const semicolonIndex =
      text.indexOf(
        ";",
        startIndex
      );

    if (semicolonIndex < 0) {
      continue;
    }

    const chain =
      text.slice(
        startIndex,
        semicolonIndex + 1
      );

    const startLine =
      lineOf(
        text,
        startIndex
      );

    const endLine =
      lineOf(
        text,
        semicolonIndex
      );

    const updateMatch =
      chain.match(
        /\.update\s*\(\s*\{[\s\S]*?\bstatus\s*:\s*["']([A-Z][A-Z0-9_]+)["'][\s\S]*?\}\s*\)/m
      );

    const insertMatch =
      chain.match(
        /\.insert\s*\(\s*\{[\s\S]*?\bstatus\s*:\s*["']([A-Z][A-Z0-9_]+)["'][\s\S]*?\}\s*\)/m
      );

    const toState =
      (
        updateMatch?.[1] ||
        insertMatch?.[1] ||
        null
      );

    const fromStates = [];

    for (
      const match of
        chain.matchAll(
          /\.eq\s*\(\s*["']status["']\s*,\s*["']([A-Z][A-Z0-9_]+)["']\s*\)/g
        )
    ) {
      if (
        states.includes(match[1]) &&
        !fromStates.includes(match[1])
      ) {
        fromStates.push(match[1]);
      }
    }

    for (
      const match of
        chain.matchAll(
          /\.in\s*\(\s*["']status["']\s*,\s*\[([\s\S]*?)\]\s*\)/g
        )
    ) {
      for (const state of states) {
        if (
          match[1].includes(`"${state}"`) ||
          match[1].includes(`'${state}'`)
        ) {
          if (!fromStates.includes(state)) {
            fromStates.push(state);
          }
        }
      }
    }

    const kind =
      updateMatch
        ? "TS_UPDATE_CHAIN"
        : insertMatch
          ? "TS_INSERT_CHAIN"
          : "TS_READ_CHAIN";

    const item = {
      kind,
      file: rel,
      startLine,
      endLine,
      fromStates,
      toState:
        states.includes(toState)
          ? toState
          : null,
      statement: excerpt(
        lines,
        startLine,
        Math.min(endLine, startLine + 80)
      )
    };

    if (
      updateMatch ||
      insertMatch
    ) {
      writers.push(item);
    } else {
      readers.push(item);
    }

    if (
      updateMatch &&
      item.toState &&
      fromStates.length > 0
    ) {
      for (const from of fromStates) {
        evidence.push({
          from,
          to: item.toState,
          kind: "TS_UPDATE_CHAIN",
          file: rel,
          line: startLine
        });
      }
    }

    if (
      insertMatch &&
      item.toState
    ) {
      evidence.push({
        from: "__CREATE__",
        to: item.toState,
        kind: "TS_INSERT_CHAIN",
        file: rel,
        line: startLine
      });
    }
  }

  /*
   * Explicit terminal status arrays / aliases.
   */
  const aliasWindowRegex =
    /(CANCELED|CANCELLED)[\s\S]{0,200}(CANCELED|CANCELLED)/g;

  for (
    const match of
      text.matchAll(
        aliasWindowRegex
      )
  ) {
    const index =
      match.index ?? 0;

    aliases.push({
      file: rel,
      line:
        lineOf(
          text,
          index
        ),
      excerpt:
        excerpt(
          lines,
          Math.max(
            1,
            lineOf(text, index) - 3
          ),
          Math.min(
            lines.length,
            lineOf(text, index) + 6
          )
        )
    });
  }
}

const uniqueEvidence =
  uniqueBy(
    evidence,
    (item) =>
      [
        item.from,
        item.to,
        item.kind,
        item.file,
        item.line
      ].join("|")
  );

const normalizedPairs =
  uniqueBy(
    uniqueEvidence.map(
      (item) => ({
        from: item.from,
        to: item.to
      })
    ),
    (item) =>
      `${item.from}->${item.to}`
  );

const writerStates = {
  creates:
    [...new Set(
      uniqueEvidence
        .filter(
          (item) =>
            item.from ===
              "__CREATE__"
        )
        .map(
          (item) =>
            item.to
        )
    )].sort(),

  writes:
    [...new Set(
      writers
        .map(
          (item) =>
            item.toState
        )
        .filter(Boolean)
    )].sort(),

  guardedFromStates:
    [...new Set(
      writers
        .flatMap(
          (item) =>
            item.fromStates
        )
    )].sort()
};

const suspiciousStates =
  states.filter(
    (state) =>
      !writerStates.creates.includes(
        state
      ) &&
      !writerStates.writes.includes(
        state
      ) &&
      !writerStates.guardedFromStates.includes(
        state
      )
  );

const report = {
  status:
    "ALPHA_V3_ORDER_STATE_TRANSITION_STATEMENT_PROBE_V3_COMPLETE",

  scan: {
    targetFileCount:
      targets.length,

    existingTargetFileCount:
      files.filter(
        (file) =>
          file.exists
      ).length
  },

  summary: {
    transitionEvidenceCount:
      uniqueEvidence.length,

    normalizedPairCount:
      normalizedPairs.length,

    normalizedPairs,

    writerStates,

    suspiciousStates,

    cancellationAliasEvidenceCount:
      aliases.length
  },

  evidence: {
    transitions:
      uniqueEvidence,

    writers,

    readersSample:
      readers.slice(
        0,
        20
      ),

    cancellationAliases:
      aliases.slice(
        0,
        20
      ),

    files
  },

  interpretationRules: {
    sql:
      "from/to must occur in the same UPDATE paper_order_requests statement",

    typescript:
      "from/to must occur in the same Supabase paper_order_requests chain",

    create:
      "__CREATE__ marks explicit INSERT initial status",

    noInference:
      "states mentioned only in comments, unrelated tables, nearby statements, or loose context are not treated as transitions"
  },

  canonicalizationPolicyCandidate: {
    cancellationWrite:
      "CANCELLED",

    cancellationReadAliases: [
      "CANCELLED",
      "CANCELED"
    ],

    migrateLegacyRowsNow:
      false
  },

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    networkCalls: 0,
    ordersCreated: 0,
    ordersChanged: 0,
    positionsChanged: 0
  },

  nextGate:
    "REVIEW_PRECISE_TRANSITIONS_THEN_BUILD_CANONICAL_ORDER_STATE_MACHINE_V1"
};

const logsDir =
  path.resolve(
    root,
    "logs"
  );

fs.mkdirSync(
  logsDir,
  {
    recursive: true
  }
);

fs.writeFileSync(
  path.join(
    logsDir,
    "alpha-v3-order-state-transition-statement-probe-v3.json"
  ),
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

      scan:
        report.scan,

      summary:
        report.summary,

      canonicalizationPolicyCandidate:
        report.canonicalizationPolicyCandidate,

      safety:
        report.safety,

      logFile:
        "logs/alpha-v3-order-state-transition-statement-probe-v3.json",

      nextGate:
        report.nextGate
    },
    null,
    2
  )
);
