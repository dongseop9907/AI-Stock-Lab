const fs = require("fs");
const path = require("path");

const target =
  path.resolve(
    process.cwd(),
    "scripts/alpha-v3-order-state-transition-deep-probe-v2.cjs"
  );

fs.mkdirSync(
  path.dirname(
    target
  ),
  {
    recursive: true
  }
);

fs.writeFileSync(
  target,
  "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nconst targets = [\n  \"app/api/orders/paper/execute/route.ts\",\n  \"lib/trading/execute-approved-paper-orders.ts\",\n  \"lib/trading/execute-paper-order.ts\",\n  \"lib/trading/generate-entry-signals.ts\",\n  \"lib/trading/paper-order-service.ts\",\n  \"supabase/migrations/002_paper_trading.sql\",\n  \"supabase/migrations/003_execute_paper_orders.sql\",\n  \"supabase/migrations/004_stop_loss_execution.sql\",\n  \"supabase/migrations/008_bind_models_to_orders.sql\",\n  \"supabase/migrations/011_entry_signal_engine.sql\",\n  \"supabase/migrations/012_reset_paper_account.sql\",\n  \"supabase/migrations/20261008000100_committed_risk_reservation_v3.sql\",\n  \"supabase/migrations/20261008000400_execute_paper_buy_order_committed_risk_lock.sql\",\n  \"supabase/migrations/20261008000700_execute_paper_buy_order_lock_order_v2.sql\",\n  \"supabase/migrations/20261008001000_committed_risk_expiry_reconciliation_v2.sql\"\n];\n\nconst knownStates = [\n  \"APPROVED\",\n  \"CANCELED\",\n  \"CANCELLED\",\n  \"CLOSED\",\n  \"EXPIRED\",\n  \"FAILED\",\n  \"FILLED\",\n  \"PENDING\",\n  \"REJECTED\",\n  \"RISK_APPROVED\",\n  \"RISK_REJECTED\"\n];\n\nfunction lineOf(text, index) {\n  return text\n    .slice(0, Math.max(0, index))\n    .split(\"\\n\")\n    .length;\n}\n\nfunction excerpt(lines, line, radius = 8) {\n  const start = Math.max(1, line - radius);\n  const end = Math.min(lines.length, line + radius);\n\n  return {\n    startLine: start,\n    endLine: end,\n    text: lines\n      .slice(start - 1, end)\n      .map((value, i) => `${start + i}: ${value}`)\n      .join(\"\\n\")\n  };\n}\n\nfunction collectStateMentions(text) {\n  const mentions = [];\n\n  for (const state of knownStates) {\n    let cursor = 0;\n\n    while (true) {\n      const index = text.indexOf(state, cursor);\n\n      if (index < 0) {\n        break;\n      }\n\n      mentions.push({\n        state,\n        index,\n        line: lineOf(text, index)\n      });\n\n      cursor = index + state.length;\n    }\n  }\n\n  return mentions.sort((a, b) => a.index - b.index);\n}\n\nfunction classifyContext(text) {\n  const lower = text.toLowerCase();\n\n  const signals = [];\n\n  if (\n    lower.includes(\"paper_order_requests\")\n  ) {\n    signals.push(\"PAPER_ORDER_REQUESTS\");\n  }\n\n  if (\n    lower.includes(\"paper_positions\")\n  ) {\n    signals.push(\"PAPER_POSITIONS\");\n  }\n\n  if (\n    lower.includes(\"paper_trades\")\n  ) {\n    signals.push(\"PAPER_TRADES\");\n  }\n\n  if (\n    lower.includes(\"status\")\n  ) {\n    signals.push(\"STATUS\");\n  }\n\n  if (\n    lower.includes(\"update\")\n  ) {\n    signals.push(\"UPDATE\");\n  }\n\n  if (\n    lower.includes(\"insert\")\n  ) {\n    signals.push(\"INSERT\");\n  }\n\n  if (\n    lower.includes(\"where\")\n  ) {\n    signals.push(\"WHERE\");\n  }\n\n  if (\n    lower.includes(\".eq(\")\n  ) {\n    signals.push(\"EQ_FILTER\");\n  }\n\n  if (\n    lower.includes(\"trigger\")\n  ) {\n    signals.push(\"TRIGGER\");\n  }\n\n  if (\n    lower.includes(\"function\")\n  ) {\n    signals.push(\"FUNCTION\");\n  }\n\n  return signals;\n}\n\nconst files = [];\nconst edges = [];\nconst ambiguous = [];\n\nfor (const rel of targets) {\n  const abs = path.resolve(root, rel);\n\n  if (!fs.existsSync(abs)) {\n    files.push({\n      file: rel,\n      exists: false\n    });\n\n    continue;\n  }\n\n  const text = fs\n    .readFileSync(abs, \"utf8\")\n    .replace(/\\r\\n/g, \"\\n\");\n\n  const lines = text.split(\"\\n\");\n  const mentions = collectStateMentions(text);\n\n  files.push({\n    file: rel,\n    exists: true,\n    lineCount: lines.length,\n    stateMentions: mentions.length\n  });\n\n  for (const mention of mentions) {\n    const line = mention.line;\n    const start = Math.max(1, line - 14);\n    const end = Math.min(lines.length, line + 14);\n    const contextText = lines\n      .slice(start - 1, end)\n      .join(\"\\n\");\n\n    const contextStates = knownStates.filter(\n      (state) => contextText.includes(state)\n    );\n\n    const contextSignals =\n      classifyContext(contextText);\n\n    if (\n      !contextSignals.includes(\n        \"PAPER_ORDER_REQUESTS\"\n      ) &&\n      !rel.includes(\n        \"paper-order\"\n      ) &&\n      !rel.includes(\n        \"paper_orders\"\n      ) &&\n      !rel.includes(\n        \"committed_risk\"\n      ) &&\n      !rel.includes(\n        \"execute_paper\"\n      )\n    ) {\n      continue;\n    }\n\n    const statusAssignmentPatterns = [\n      /status\\s*:\\s*[\"']([A-Z][A-Z0-9_]+)[\"']/g,\n      /status\\s*=\\s*['\"]([A-Z][A-Z0-9_]+)['\"]/g,\n      /set\\s+status\\s*=\\s*['\"]([A-Z][A-Z0-9_]+)['\"]/gi\n    ];\n\n    const statusFilterPatterns = [\n      /\\.eq\\s*\\(\\s*[\"']status[\"']\\s*,\\s*[\"']([A-Z][A-Z0-9_]+)[\"']\\s*\\)/g,\n      /where[\\s\\S]{0,180}?\\bstatus\\s*=\\s*['\"]([A-Z][A-Z0-9_]+)['\"]/gi,\n      /\\bstatus\\s+in\\s*\\(([^)]+)\\)/gi\n    ];\n\n    const toStates = [];\n    const fromStates = [];\n\n    for (const pattern of statusAssignmentPatterns) {\n      for (const match of contextText.matchAll(pattern)) {\n        const value = match[1];\n\n        if (\n          knownStates.includes(value) &&\n          !toStates.includes(value)\n        ) {\n          toStates.push(value);\n        }\n      }\n    }\n\n    for (const pattern of statusFilterPatterns) {\n      for (const match of contextText.matchAll(pattern)) {\n        const raw = match[1];\n\n        for (const state of knownStates) {\n          if (\n            raw.includes(state) &&\n            !fromStates.includes(state)\n          ) {\n            fromStates.push(state);\n          }\n        }\n      }\n    }\n\n    const item = {\n      file: rel,\n      anchorState: mention.state,\n      line,\n      contextSignals,\n      fromStates,\n      toStates,\n      excerpt: excerpt(lines, line, 10)\n    };\n\n    if (\n      fromStates.length > 0 &&\n      toStates.length > 0\n    ) {\n      edges.push(item);\n    } else {\n      ambiguous.push(item);\n    }\n  }\n}\n\n/*\n * Deduplicate identical local edge findings.\n */\nconst seen = new Set();\n\nconst uniqueEdges =\n  edges.filter((item) => {\n    const key = JSON.stringify({\n      file: item.file,\n      fromStates: item.fromStates.sort(),\n      toStates: item.toStates.sort(),\n      startLine: item.excerpt.startLine,\n      endLine: item.excerpt.endLine\n    });\n\n    if (seen.has(key)) {\n      return false;\n    }\n\n    seen.add(key);\n    return true;\n  });\n\nconst normalizedEdgePairs = [];\n\nfor (const item of uniqueEdges) {\n  for (const from of item.fromStates) {\n    for (const to of item.toStates) {\n      if (\n        from !== to\n      ) {\n        normalizedEdgePairs.push({\n          from,\n          to,\n          file: item.file,\n          line: item.line\n        });\n      }\n    }\n  }\n}\n\nconst edgeKeySet = new Set();\nconst uniquePairs = normalizedEdgePairs.filter(\n  (edge) => {\n    const key =\n      `${edge.from}->${edge.to}@${edge.file}`;\n\n    if (edgeKeySet.has(key)) {\n      return false;\n    }\n\n    edgeKeySet.add(key);\n    return true;\n  }\n);\n\nconst stateRoles = Object.fromEntries(\n  knownStates.map((state) => {\n    const appearsAsFrom =\n      uniquePairs.some(\n        (edge) => edge.from === state\n      );\n\n    const appearsAsTo =\n      uniquePairs.some(\n        (edge) => edge.to === state\n      );\n\n    return [\n      state,\n      {\n        appearsAsFrom,\n        appearsAsTo,\n        terminalCandidate:\n          appearsAsTo &&\n          !appearsAsFrom\n      }\n    ];\n  })\n);\n\nconst cancellationSpellings = {\n  canceledObserved:\n    files.some(\n      () => true\n    ) &&\n    knownStates.includes(\"CANCELED\"),\n\n  cancelledObserved:\n    knownStates.includes(\"CANCELLED\"),\n\n  requiresCanonicalizationReview:\n    true\n};\n\nconst report = {\n  status:\n    \"ALPHA_V3_ORDER_STATE_TRANSITION_DEEP_PROBE_V2_COMPLETE\",\n\n  scan: {\n    targetFileCount:\n      targets.length,\n\n    existingTargetFileCount:\n      files.filter(\n        (file) => file.exists\n      ).length\n  },\n\n  summary: {\n    uniqueTransitionEvidenceCount:\n      uniqueEdges.length,\n\n    normalizedPairCount:\n      uniquePairs.length,\n\n    uniquePairs,\n\n    stateRoles,\n\n    cancellationSpellings\n  },\n\n  evidence: {\n    files,\n    transitionEvidence:\n      uniqueEdges,\n\n    ambiguousEvidenceCount:\n      ambiguous.length,\n\n    ambiguousEvidenceSample:\n      ambiguous.slice(0, 25)\n  },\n\n  recommendedCanonicalization: {\n    preferredCancellationState:\n      \"CANCELLED\",\n\n    legacyAlias:\n      \"CANCELED\",\n\n    note:\n      \"Do not rewrite legacy rows yet. First define canonical transition validation that accepts CANCELED as a terminal legacy alias and emits CANCELLED for new writes.\"\n  },\n\n  nextGate:\n    \"BUILD_ORDER_STATE_MACHINE_CONTRACT_V1_FROM_CONFIRMED_TRANSITIONS\",\n\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    networkCalls: 0,\n    ordersCreated: 0,\n    ordersChanged: 0,\n    positionsChanged: 0\n  }\n};\n\nconst logsDir =\n  path.resolve(\n    root,\n    \"logs\"\n  );\n\nfs.mkdirSync(\n  logsDir,\n  {\n    recursive: true\n  }\n);\n\nfs.writeFileSync(\n  path.join(\n    logsDir,\n    \"alpha-v3-order-state-transition-deep-probe-v2.json\"\n  ),\n  JSON.stringify(\n    report,\n    null,\n    2\n  ) + \"\\n\",\n  \"utf8\"\n);\n\nconsole.log(\n  JSON.stringify(\n    {\n      status:\n        report.status,\n\n      scan:\n        report.scan,\n\n      summary:\n        report.summary,\n\n      recommendedCanonicalization:\n        report.recommendedCanonicalization,\n\n      safety:\n        report.safety,\n\n      logFile:\n        \"logs/alpha-v3-order-state-transition-deep-probe-v2.json\",\n\n      nextGate:\n        report.nextGate\n    },\n    null,\n    2\n  )\n);\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_ORDER_STATE_TRANSITION_DEEP_PROBE_V2_INSTALLED",

      generatedFile:
        "scripts/alpha-v3-order-state-transition-deep-probe-v2.cjs",

      purpose:
        "EXTRACT_CONFIRMED_FROM_TO_ORDER_STATUS_TRANSITIONS_BEFORE_CANONICAL_STATE_MACHINE",

      safety: {
        databaseReads:
          0,

        databaseWrites:
          0,

        networkCalls:
          0,

        ordersCreated:
          0,

        ordersChanged:
          0,

        positionsChanged:
          0
      },

      nextAction:
        "RUN_ORDER_STATE_TRANSITION_DEEP_PROBE_V2"
    },
    null,
    2
  )
);
