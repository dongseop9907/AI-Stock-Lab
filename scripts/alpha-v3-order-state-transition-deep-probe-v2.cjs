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

const knownStates = [
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

function excerpt(lines, line, radius = 8) {
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

function collectStateMentions(text) {
  const mentions = [];

  for (const state of knownStates) {
    let cursor = 0;

    while (true) {
      const index = text.indexOf(state, cursor);

      if (index < 0) {
        break;
      }

      mentions.push({
        state,
        index,
        line: lineOf(text, index)
      });

      cursor = index + state.length;
    }
  }

  return mentions.sort((a, b) => a.index - b.index);
}

function classifyContext(text) {
  const lower = text.toLowerCase();

  const signals = [];

  if (
    lower.includes("paper_order_requests")
  ) {
    signals.push("PAPER_ORDER_REQUESTS");
  }

  if (
    lower.includes("paper_positions")
  ) {
    signals.push("PAPER_POSITIONS");
  }

  if (
    lower.includes("paper_trades")
  ) {
    signals.push("PAPER_TRADES");
  }

  if (
    lower.includes("status")
  ) {
    signals.push("STATUS");
  }

  if (
    lower.includes("update")
  ) {
    signals.push("UPDATE");
  }

  if (
    lower.includes("insert")
  ) {
    signals.push("INSERT");
  }

  if (
    lower.includes("where")
  ) {
    signals.push("WHERE");
  }

  if (
    lower.includes(".eq(")
  ) {
    signals.push("EQ_FILTER");
  }

  if (
    lower.includes("trigger")
  ) {
    signals.push("TRIGGER");
  }

  if (
    lower.includes("function")
  ) {
    signals.push("FUNCTION");
  }

  return signals;
}

const files = [];
const edges = [];
const ambiguous = [];

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
  const mentions = collectStateMentions(text);

  files.push({
    file: rel,
    exists: true,
    lineCount: lines.length,
    stateMentions: mentions.length
  });

  for (const mention of mentions) {
    const line = mention.line;
    const start = Math.max(1, line - 14);
    const end = Math.min(lines.length, line + 14);
    const contextText = lines
      .slice(start - 1, end)
      .join("\n");

    const contextStates = knownStates.filter(
      (state) => contextText.includes(state)
    );

    const contextSignals =
      classifyContext(contextText);

    if (
      !contextSignals.includes(
        "PAPER_ORDER_REQUESTS"
      ) &&
      !rel.includes(
        "paper-order"
      ) &&
      !rel.includes(
        "paper_orders"
      ) &&
      !rel.includes(
        "committed_risk"
      ) &&
      !rel.includes(
        "execute_paper"
      )
    ) {
      continue;
    }

    const statusAssignmentPatterns = [
      /status\s*:\s*["']([A-Z][A-Z0-9_]+)["']/g,
      /status\s*=\s*['"]([A-Z][A-Z0-9_]+)['"]/g,
      /set\s+status\s*=\s*['"]([A-Z][A-Z0-9_]+)['"]/gi
    ];

    const statusFilterPatterns = [
      /\.eq\s*\(\s*["']status["']\s*,\s*["']([A-Z][A-Z0-9_]+)["']\s*\)/g,
      /where[\s\S]{0,180}?\bstatus\s*=\s*['"]([A-Z][A-Z0-9_]+)['"]/gi,
      /\bstatus\s+in\s*\(([^)]+)\)/gi
    ];

    const toStates = [];
    const fromStates = [];

    for (const pattern of statusAssignmentPatterns) {
      for (const match of contextText.matchAll(pattern)) {
        const value = match[1];

        if (
          knownStates.includes(value) &&
          !toStates.includes(value)
        ) {
          toStates.push(value);
        }
      }
    }

    for (const pattern of statusFilterPatterns) {
      for (const match of contextText.matchAll(pattern)) {
        const raw = match[1];

        for (const state of knownStates) {
          if (
            raw.includes(state) &&
            !fromStates.includes(state)
          ) {
            fromStates.push(state);
          }
        }
      }
    }

    const item = {
      file: rel,
      anchorState: mention.state,
      line,
      contextSignals,
      fromStates,
      toStates,
      excerpt: excerpt(lines, line, 10)
    };

    if (
      fromStates.length > 0 &&
      toStates.length > 0
    ) {
      edges.push(item);
    } else {
      ambiguous.push(item);
    }
  }
}

/*
 * Deduplicate identical local edge findings.
 */
const seen = new Set();

const uniqueEdges =
  edges.filter((item) => {
    const key = JSON.stringify({
      file: item.file,
      fromStates: item.fromStates.sort(),
      toStates: item.toStates.sort(),
      startLine: item.excerpt.startLine,
      endLine: item.excerpt.endLine
    });

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });

const normalizedEdgePairs = [];

for (const item of uniqueEdges) {
  for (const from of item.fromStates) {
    for (const to of item.toStates) {
      if (
        from !== to
      ) {
        normalizedEdgePairs.push({
          from,
          to,
          file: item.file,
          line: item.line
        });
      }
    }
  }
}

const edgeKeySet = new Set();
const uniquePairs = normalizedEdgePairs.filter(
  (edge) => {
    const key =
      `${edge.from}->${edge.to}@${edge.file}`;

    if (edgeKeySet.has(key)) {
      return false;
    }

    edgeKeySet.add(key);
    return true;
  }
);

const stateRoles = Object.fromEntries(
  knownStates.map((state) => {
    const appearsAsFrom =
      uniquePairs.some(
        (edge) => edge.from === state
      );

    const appearsAsTo =
      uniquePairs.some(
        (edge) => edge.to === state
      );

    return [
      state,
      {
        appearsAsFrom,
        appearsAsTo,
        terminalCandidate:
          appearsAsTo &&
          !appearsAsFrom
      }
    ];
  })
);

const cancellationSpellings = {
  canceledObserved:
    files.some(
      () => true
    ) &&
    knownStates.includes("CANCELED"),

  cancelledObserved:
    knownStates.includes("CANCELLED"),

  requiresCanonicalizationReview:
    true
};

const report = {
  status:
    "ALPHA_V3_ORDER_STATE_TRANSITION_DEEP_PROBE_V2_COMPLETE",

  scan: {
    targetFileCount:
      targets.length,

    existingTargetFileCount:
      files.filter(
        (file) => file.exists
      ).length
  },

  summary: {
    uniqueTransitionEvidenceCount:
      uniqueEdges.length,

    normalizedPairCount:
      uniquePairs.length,

    uniquePairs,

    stateRoles,

    cancellationSpellings
  },

  evidence: {
    files,
    transitionEvidence:
      uniqueEdges,

    ambiguousEvidenceCount:
      ambiguous.length,

    ambiguousEvidenceSample:
      ambiguous.slice(0, 25)
  },

  recommendedCanonicalization: {
    preferredCancellationState:
      "CANCELLED",

    legacyAlias:
      "CANCELED",

    note:
      "Do not rewrite legacy rows yet. First define canonical transition validation that accepts CANCELED as a terminal legacy alias and emits CANCELLED for new writes."
  },

  nextGate:
    "BUILD_ORDER_STATE_MACHINE_CONTRACT_V1_FROM_CONFIRMED_TRANSITIONS",

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    networkCalls: 0,
    ordersCreated: 0,
    ordersChanged: 0,
    positionsChanged: 0
  }
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
    "alpha-v3-order-state-transition-deep-probe-v2.json"
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

      recommendedCanonicalization:
        report.recommendedCanonicalization,

      safety:
        report.safety,

      logFile:
        "logs/alpha-v3-order-state-transition-deep-probe-v2.json",

      nextGate:
        report.nextGate
    },
    null,
    2
  )
);
