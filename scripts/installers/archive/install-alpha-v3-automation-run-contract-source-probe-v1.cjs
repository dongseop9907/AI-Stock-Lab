const fs = require("fs");
const path = require("path");

const target = path.resolve(
  process.cwd(),
  "scripts/alpha-v3-automation-run-contract-source-probe.cjs"
);

fs.mkdirSync(
  path.dirname(target),
  { recursive: true }
);

fs.writeFileSync(
  target,
  "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nconst reportFile = path.resolve(\n  root,\n  \"logs/alpha-v3-automation-run-contract-source-probe.json\"\n);\n\nconst targets = [\n  \"app/api/trading/automation/run/route.ts\",\n  \"lib/trading/execute-approved-paper-orders.ts\",\n  \"app/api/orders/paper/execute-approved/route.ts\",\n  \"app/components/AutomationRunPanel.tsx\",\n  \"app/components/TradingMaintenanceButton.tsx\",\n  \"lib/trading/get-trading-system-control.ts\",\n  \".env.example\",\n];\n\nfunction read(rel) {\n  const file = path.resolve(root, rel);\n\n  if (!fs.existsSync(file)) {\n    return {\n      file: rel,\n      exists: false,\n      text: null,\n      lineCount: 0,\n    };\n  }\n\n  const text = fs.readFileSync(file, \"utf8\");\n\n  return {\n    file: rel,\n    exists: true,\n    text,\n    lineCount: text.replace(/\\r\\n/g, \"\\n\").split(\"\\n\").length,\n  };\n}\n\nfunction lineNo(text, index) {\n  return text.slice(0, index).split(/\\r?\\n/).length;\n}\n\nfunction snippets(text, regex, radius = 7, max = 40) {\n  if (!text) {\n    return [];\n  }\n\n  const normalized = text.replace(/\\r\\n/g, \"\\n\");\n  const lines = normalized.split(\"\\n\");\n  const rows = [];\n  let match;\n\n  while ((match = regex.exec(normalized)) && rows.length < max) {\n    const line = lineNo(normalized, match.index);\n    const start = Math.max(1, line - radius);\n    const end = Math.min(lines.length, line + radius);\n\n    rows.push({\n      match: match[0],\n      line,\n      snippet: lines\n        .slice(start - 1, end)\n        .map((value, offset) => `${start + offset}: ${value}`)\n        .join(\"\\n\"),\n    });\n  }\n\n  return rows;\n}\n\nfunction exportFunctions(text) {\n  if (!text) {\n    return [];\n  }\n\n  return [\n    ...text.matchAll(\n      /export\\s+(?:async\\s+)?function\\s+([A-Za-z_$][A-Za-z0-9_$]*)\\s*\\(/g\n    ),\n  ].map((m) => m[1]);\n}\n\nconst files = targets.map(read);\n\nconst analysis = files.map((row) => ({\n  file: row.file,\n  exists: row.exists,\n  lineCount: row.lineCount,\n\n  exports: exportFunctions(row.text),\n\n  automationSequence: snippets(\n    row.text,\n    /executeApprovedPaperOrders|generateEntrySignals|updateTrailingStops|checkAndExecuteStopLosses|evaluate|sync|automation|systemControl|tradingSystemControl/gi,\n    8,\n    60\n  ),\n\n  requestAndAuth: snippets(\n    row.text,\n    /TRADING_AUTOMATION_SECRET|authorization|x-[a-z0-9-]+|headers\\s*\\(|request\\.headers|NextRequest|POST\\s*\\(|GET\\s*\\(/gi,\n    7,\n    30\n  ),\n\n  env: snippets(\n    row.text,\n    /process\\.env\\.[A-Z0-9_]+|NEXT_PUBLIC_[A-Z0-9_]+|AUTOMATION_[A-Z0-9_]+|TRADING_[A-Z0-9_]+/g,\n    5,\n    30\n  ),\n\n  limits: snippets(\n    row.text,\n    /\\.limit\\s*\\(|batchSize|batch_size|maxOrders|max_orders|concurrency|Promise\\.all|Promise\\.allSettled/gi,\n    6,\n    35\n  ),\n\n  uiTrigger: snippets(\n    row.text,\n    /fetch\\s*\\(|onClick|button|\\/api\\/trading\\/automation\\/run|\\/api\\/orders\\/paper\\/execute-approved|disabled|loading/gi,\n    7,\n    35\n  ),\n\n  maintenance: snippets(\n    row.text,\n    /maintenance|reconcile|expire|reserved_risk|committed_risk|RISK_APPROVED/gi,\n    7,\n    35\n  ),\n}));\n\nconst route = analysis.find(\n  (row) => row.file === \"app/api/trading/automation/run/route.ts\"\n);\n\nconst executor = analysis.find(\n  (row) => row.file === \"lib/trading/execute-approved-paper-orders.ts\"\n);\n\nconst panel = analysis.find(\n  (row) => row.file === \"app/components/AutomationRunPanel.tsx\"\n);\n\nconst maintenanceButton = analysis.find(\n  (row) => row.file === \"app/components/TradingMaintenanceButton.tsx\"\n);\n\nconst summary = {\n  automationRouteExists:\n    route?.exists === true,\n\n  automationRouteExports:\n    route?.exports ?? [],\n\n  executeApprovedCalledByAutomationRoute:\n    (route?.automationSequence ?? []).some(\n      (hit) =>\n        /executeApprovedPaperOrders/i.test(\n          hit.match + \"\\n\" + hit.snippet\n        )\n    ),\n\n  executorExists:\n    executor?.exists === true,\n\n  panelCallsAutomationRoute:\n    (panel?.uiTrigger ?? []).some(\n      (hit) =>\n        /\\/api\\/trading\\/automation\\/run/i.test(\n          hit.match + \"\\n\" + hit.snippet\n        )\n    ),\n\n  maintenanceButtonExists:\n    maintenanceButton?.exists === true,\n\n  existingMaintenanceRpcReference:\n    analysis.some(\n      (row) =>\n        row.maintenance.some(\n          (hit) =>\n            /expire_stale_paper_buy_reservations_v3|reconcile_paper_buy_reserved_risk_v3/i.test(\n              hit.match + \"\\n\" + hit.snippet\n            )\n        )\n    ),\n\n  automationSecretReferenced:\n    analysis.some(\n      (row) =>\n        row.requestAndAuth.some(\n          (hit) =>\n            /TRADING_AUTOMATION_SECRET/i.test(\n              hit.match + \"\\n\" + hit.snippet\n            )\n        )\n    ),\n};\n\nconst recommendation = {\n  proposedAutomationCadenceSeconds: 60,\n  proposedAutomationCadenceMinutes: 1,\n  proposedExpirySlaMinutes: 3,\n  rationale:\n    \"DEFINE_60S_EXECUTION_CONTRACT_THEN_ALLOW_THREE_EXECUTION_OPPORTUNITIES_BEFORE_EXPIRY\",\n  schedulerImplementation:\n    \"DO_NOT_RELY_ON_BROWSER_INTERVAL_FOR_PRODUCTION; KEEP_ROUTE_CALLER_AGNOSTIC_AND_ENFORCE_CADENCE_CONTRACT_SERVER_SIDE\",\n};\n\nconst report = {\n  status:\n    \"ALPHA_V3_AUTOMATION_RUN_CONTRACT_SOURCE_PROBE_COMPLETE\",\n\n  files: analysis,\n\n  summary,\n\n  recommendation,\n\n  decision: {\n    safeToBuildCadenceContract:\n      summary.automationRouteExists &&\n      summary.executorExists,\n\n    nextGate:\n      summary.automationRouteExists &&\n      summary.executorExists\n        ? \"BUILD_60S_AUTOMATION_CADENCE_CONTRACT_AND_3M_MAINTENANCE_SLA\"\n        : \"REVIEW_MISSING_AUTOMATION_RUN_SURFACE\",\n  },\n\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    ordersChanged: 0,\n    positionsChanged: 0,\n  },\n\n  outputFile:\n    \"logs/alpha-v3-automation-run-contract-source-probe.json\",\n};\n\nfs.mkdirSync(\n  path.dirname(reportFile),\n  { recursive: true }\n);\n\nfs.writeFileSync(\n  reportFile,\n  JSON.stringify(report, null, 2) + \"\\n\",\n  \"utf8\"\n);\n\nconsole.log(\n  JSON.stringify(\n    {\n      status: report.status,\n\n      summary: report.summary,\n\n      recommendation: report.recommendation,\n\n      files: report.files.map((row) => ({\n        file: row.file,\n        exists: row.exists,\n        lineCount: row.lineCount,\n        exports: row.exports,\n        automationSequenceHits: row.automationSequence.length,\n        requestAndAuthHits: row.requestAndAuth.length,\n        envHits: row.env.length,\n        limitHits: row.limits.length,\n        uiTriggerHits: row.uiTrigger.length,\n        maintenanceHits: row.maintenance.length,\n      })),\n\n      databaseWrites: 0,\n\n      nextGate:\n        report.decision.nextGate,\n\n      outputFile:\n        report.outputFile,\n    },\n    null,\n    2\n  )\n);\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_AUTOMATION_RUN_CONTRACT_SOURCE_PROBE_V1_INSTALLED",

      generatedFile:
        "scripts/alpha-v3-automation-run-contract-source-probe.cjs",

      proposedContract: {
        automationCadenceSeconds: 60,
        expirySlaMinutes: 3,
        expiryOpportunities: 3
      },

      databaseWrites:
        0,

      ordersChanged:
        0,

      positionsChanged:
        0,

      nextAction:
        "RUN_AUTOMATION_RUN_CONTRACT_SOURCE_PROBE"
    },
    null,
    2
  )
);
