const fs = require("fs");
const path = require("path");

const target =
  path.resolve(
    process.cwd(),
    "scripts/alpha-v3-automation-stage-order-probe.cjs"
  );

fs.mkdirSync(
  path.dirname(target),
  {
    recursive: true
  }
);

fs.writeFileSync(
  target,
  "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nconst reportFile = path.resolve(\n  root,\n  \"logs/alpha-v3-automation-stage-order-probe.json\"\n);\n\nconst targets = [\n  \"app/api/trading/automation/run/route.ts\",\n  \"app/components/TradingMaintenanceButton.tsx\",\n  \"app/components/AutomationRunPanel.tsx\",\n  \"app/api/orders/paper/execute-approved/route.ts\",\n  \"lib/trading/execute-approved-paper-orders.ts\",\n];\n\nfunction read(rel) {\n  const file = path.resolve(root, rel);\n\n  if (!fs.existsSync(file)) {\n    return {\n      file: rel,\n      exists: false,\n      text: null,\n    };\n  }\n\n  return {\n    file: rel,\n    exists: true,\n    text: fs.readFileSync(file, \"utf8\"),\n  };\n}\n\nfunction lineNo(text, index) {\n  return text.slice(0, index).split(/\\r?\\n/).length;\n}\n\nfunction snippets(text, regex, radius = 5, max = 80) {\n  if (!text) {\n    return [];\n  }\n\n  const normalized =\n    text.replace(/\\r\\n/g, \"\\n\");\n\n  const lines =\n    normalized.split(\"\\n\");\n\n  const rows = [];\n  let match;\n\n  while (\n    (match = regex.exec(normalized)) &&\n    rows.length < max\n  ) {\n    const line =\n      lineNo(normalized, match.index);\n\n    const start =\n      Math.max(\n        1,\n        line - radius\n      );\n\n    const end =\n      Math.min(\n        lines.length,\n        line + radius\n      );\n\n    rows.push({\n      line,\n      match:\n        match[0],\n\n      snippet:\n        lines\n          .slice(start - 1, end)\n          .map(\n            (value, offset) =>\n              `${start + offset}: ${value}`\n          )\n          .join(\"\\n\"),\n    });\n  }\n\n  return rows;\n}\n\nfunction imports(text) {\n  if (!text) return [];\n\n  return [\n    ...text.matchAll(\n      /import\\s+([\\s\\S]*?)\\s+from\\s+[\"']([^\"']+)[\"'];?/g\n    ),\n  ].map(\n    (m) => ({\n      specifier:\n        m[1].trim(),\n\n      source:\n        m[2],\n    })\n  );\n}\n\nfunction awaitCalls(text) {\n  if (!text) return [];\n\n  const rows = [];\n\n  const regex =\n    /\\bawait\\s+([A-Za-z_$][A-Za-z0-9_$]*(?:\\.[A-Za-z_$][A-Za-z0-9_$]*)?)\\s*\\(/g;\n\n  let match;\n\n  while ((match = regex.exec(text))) {\n    rows.push({\n      callee:\n        match[1],\n\n      line:\n        lineNo(text, match.index),\n\n      snippet:\n        snippets(\n          text,\n          new RegExp(\n            `await\\\\s+${match[1]\n              .replace(/[.*+?^${}()|[\\]\\\\]/g, \"\\\\$&\")}\\\\s*\\\\(`,\n            \"g\"\n          ),\n          4,\n          1\n        )[0]?.snippet ?? null,\n    });\n  }\n\n  return rows;\n}\n\nfunction fetchCalls(text) {\n  if (!text) return [];\n\n  const rows = [];\n\n  const regex =\n    /fetch\\s*\\(\\s*([`\"'][\\s\\S]*?[`\"'])/g;\n\n  let match;\n\n  while ((match = regex.exec(text))) {\n    rows.push({\n      expression:\n        match[1],\n\n      line:\n        lineNo(text, match.index),\n\n      snippet:\n        snippets(\n          text,\n          /fetch\\s*\\(/g,\n          5,\n          80\n        ).find(\n          (row) =>\n            Math.abs(\n              row.line -\n              lineNo(text, match.index)\n            ) <= 1\n        )?.snippet ?? null,\n    });\n  }\n\n  return rows;\n}\n\nconst files =\n  targets.map(read);\n\nconst analysis =\n  files.map(\n    (row) => ({\n      file:\n        row.file,\n\n      exists:\n        row.exists,\n\n      imports:\n        imports(row.text),\n\n      awaitCalls:\n        awaitCalls(row.text),\n\n      fetchCalls:\n        fetchCalls(row.text),\n\n      stageMarkers:\n        snippets(\n          row.text,\n          /stage|step|phase|signal|order|execute|risk|trailing|stop-loss|stop loss|evaluate|report|snapshot|sync|shadow|maintenance/gi,\n          4,\n          100\n        ),\n\n      responses:\n        snippets(\n          row.text,\n          /NextResponse\\.json|return\\s+\\{|ok:\\s*true|ok:\\s*false|status:/gi,\n          5,\n          50\n        ),\n    })\n  );\n\nconst route =\n  analysis.find(\n    (row) =>\n      row.file ===\n      \"app/api/trading/automation/run/route.ts\"\n  );\n\nconst maintenance =\n  analysis.find(\n    (row) =>\n      row.file ===\n      \"app/components/TradingMaintenanceButton.tsx\"\n  );\n\nconst panel =\n  analysis.find(\n    (row) =>\n      row.file ===\n      \"app/components/AutomationRunPanel.tsx\"\n  );\n\nconst approvedRoute =\n  analysis.find(\n    (row) =>\n      row.file ===\n      \"app/api/orders/paper/execute-approved/route.ts\"\n  );\n\nconst executor =\n  analysis.find(\n    (row) =>\n      row.file ===\n      \"lib/trading/execute-approved-paper-orders.ts\"\n  );\n\nfunction apiPaths(row) {\n  return [\n    ...new Set(\n      (row?.fetchCalls ?? [])\n        .flatMap(\n          (call) =>\n            [\n              ...call.expression.matchAll(\n                /\\/api\\/[A-Za-z0-9_?=&${}/.-]+/g\n              ),\n            ].map(\n              (m) =>\n                m[0]\n            )\n        )\n    ),\n  ];\n}\n\nconst automationCallees =\n  route?.awaitCalls.map(\n    (row) =>\n      row.callee\n  ) ?? [];\n\nconst maintenanceApiPaths =\n  apiPaths(maintenance);\n\nconst panelApiPaths =\n  apiPaths(panel);\n\nconst approvedRouteCallees =\n  approvedRoute?.awaitCalls.map(\n    (row) =>\n      row.callee\n  ) ?? [];\n\nconst executorCallees =\n  executor?.awaitCalls.map(\n    (row) =>\n      row.callee\n  ) ?? [];\n\nconst knownStageNames = [\n  \"executeApprovedPaperOrders\",\n  \"generateEntrySignals\",\n  \"updateTrailingStops\",\n  \"checkAndExecuteStopLosses\",\n  \"evaluate\",\n  \"generateDailyPerformanceReport\",\n  \"sync\",\n];\n\nconst automationKnownStages =\n  automationCallees.filter(\n    (name) =>\n      knownStageNames.some(\n        (stage) =>\n          name.toLowerCase()\n            .includes(\n              stage.toLowerCase()\n            )\n      )\n  );\n\nconst report = {\n  status:\n    \"ALPHA_V3_AUTOMATION_STAGE_ORDER_PROBE_COMPLETE\",\n\n  files:\n    analysis,\n\n  summary: {\n    automationRun: {\n      awaitCallSequence:\n        route?.awaitCalls ?? [],\n\n      knownStageSequence:\n        automationKnownStages,\n\n      directlyCallsExecuteApproved:\n        automationCallees.some(\n          (name) =>\n            /executeApprovedPaperOrders/i.test(\n              name\n            )\n        ),\n    },\n\n    tradingMaintenanceButton: {\n      apiCallSequence:\n        maintenanceApiPaths,\n\n      callsExecuteApprovedApi:\n        maintenanceApiPaths.some(\n          (p) =>\n            /\\/api\\/orders\\/paper\\/execute-approved/i.test(\n              p\n            )\n        ),\n    },\n\n    automationRunPanel: {\n      apiCallSequence:\n        panelApiPaths,\n\n      callsAutomationRun:\n        panelApiPaths.some(\n          (p) =>\n            /\\/api\\/trading\\/automation\\/run/i.test(\n              p\n            )\n        ),\n    },\n\n    executeApprovedRoute: {\n      awaitCallSequence:\n        approvedRoute?.awaitCalls ?? [],\n\n      callsExecutor:\n        approvedRouteCallees.some(\n          (name) =>\n            /executeApprovedPaperOrders/i.test(\n              name\n            )\n        ),\n    },\n\n    executor: {\n      awaitCallSequence:\n        executor?.awaitCalls ?? [],\n\n      calleeNames:\n        executorCallees,\n    },\n  },\n\n  designDecision: {\n    proposedCadenceSeconds:\n      60,\n\n    proposedExpiryMinutes:\n      3,\n\n    preferredCycleOrder: [\n      \"PRE_MAINTENANCE_RECONCILE\",\n      \"EXPIRE_STALE_RESERVATIONS\",\n      \"RUN_EXISTING_AUTOMATION_SIGNAL_PIPELINE\",\n      \"EXECUTE_APPROVED_PAPER_ORDERS\",\n      \"POST_EXECUTION_RECONCILE\",\n    ],\n\n    patchTargetPendingSourceConfirmation:\n      true,\n  },\n\n  decision: {\n    safeToPatchAutomationCycle:\n      Boolean(\n        route?.exists &&\n        approvedRoute?.exists &&\n        executor?.exists\n      ),\n\n    nextGate:\n      Boolean(\n        route?.exists &&\n        approvedRoute?.exists &&\n        executor?.exists\n      )\n        ? \"BUILD_SERVER_SIDE_AUTOMATION_CYCLE_CONTRACT\"\n        : \"REVIEW_MISSING_AUTOMATION_COMPONENT\",\n  },\n\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    ordersChanged: 0,\n    positionsChanged: 0,\n  },\n\n  outputFile:\n    \"logs/alpha-v3-automation-stage-order-probe.json\",\n};\n\nfs.mkdirSync(\n  path.dirname(reportFile),\n  {\n    recursive: true,\n  }\n);\n\nfs.writeFileSync(\n  reportFile,\n  JSON.stringify(\n    report,\n    null,\n    2\n  ) + \"\\n\",\n  \"utf8\"\n);\n\nconsole.log(\n  JSON.stringify(\n    {\n      status:\n        report.status,\n\n      summary:\n        report.summary,\n\n      proposedCycle:\n        report.designDecision,\n\n      files:\n        report.files.map(\n          (row) => ({\n            file:\n              row.file,\n\n            exists:\n              row.exists,\n\n            importCount:\n              row.imports.length,\n\n            awaitCallCount:\n              row.awaitCalls.length,\n\n            fetchCallCount:\n              row.fetchCalls.length,\n\n            stageMarkerCount:\n              row.stageMarkers.length,\n          })\n        ),\n\n      databaseWrites:\n        0,\n\n      nextGate:\n        report.decision.nextGate,\n\n      outputFile:\n        report.outputFile,\n    },\n    null,\n    2\n  )\n);\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_AUTOMATION_STAGE_ORDER_PROBE_V1_INSTALLED",

      generatedFile:
        "scripts/alpha-v3-automation-stage-order-probe.cjs",

      proposedCycle: [
        "PRE_MAINTENANCE_RECONCILE",
        "EXPIRE_STALE_RESERVATIONS",
        "RUN_EXISTING_AUTOMATION_SIGNAL_PIPELINE",
        "EXECUTE_APPROVED_PAPER_ORDERS",
        "POST_EXECUTION_RECONCILE"
      ],

      databaseWrites:
        0,

      ordersChanged:
        0,

      positionsChanged:
        0,

      nextAction:
        "RUN_AUTOMATION_STAGE_ORDER_PROBE"
    },
    null,
    2
  )
);
