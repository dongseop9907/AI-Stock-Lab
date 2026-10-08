const fs = require("fs");
const path = require("path");

const root = process.cwd();

const reportFile = path.resolve(
  root,
  "logs/alpha-v3-automation-run-contract-source-probe.json"
);

const targets = [
  "app/api/trading/automation/run/route.ts",
  "lib/trading/execute-approved-paper-orders.ts",
  "app/api/orders/paper/execute-approved/route.ts",
  "app/components/AutomationRunPanel.tsx",
  "app/components/TradingMaintenanceButton.tsx",
  "lib/trading/get-trading-system-control.ts",
  ".env.example",
];

function read(rel) {
  const file = path.resolve(root, rel);

  if (!fs.existsSync(file)) {
    return {
      file: rel,
      exists: false,
      text: null,
      lineCount: 0,
    };
  }

  const text = fs.readFileSync(file, "utf8");

  return {
    file: rel,
    exists: true,
    text,
    lineCount: text.replace(/\r\n/g, "\n").split("\n").length,
  };
}

function lineNo(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function snippets(text, regex, radius = 7, max = 40) {
  if (!text) {
    return [];
  }

  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const rows = [];
  let match;

  while ((match = regex.exec(normalized)) && rows.length < max) {
    const line = lineNo(normalized, match.index);
    const start = Math.max(1, line - radius);
    const end = Math.min(lines.length, line + radius);

    rows.push({
      match: match[0],
      line,
      snippet: lines
        .slice(start - 1, end)
        .map((value, offset) => `${start + offset}: ${value}`)
        .join("\n"),
    });
  }

  return rows;
}

function exportFunctions(text) {
  if (!text) {
    return [];
  }

  return [
    ...text.matchAll(
      /export\s+(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g
    ),
  ].map((m) => m[1]);
}

const files = targets.map(read);

const analysis = files.map((row) => ({
  file: row.file,
  exists: row.exists,
  lineCount: row.lineCount,

  exports: exportFunctions(row.text),

  automationSequence: snippets(
    row.text,
    /executeApprovedPaperOrders|generateEntrySignals|updateTrailingStops|checkAndExecuteStopLosses|evaluate|sync|automation|systemControl|tradingSystemControl/gi,
    8,
    60
  ),

  requestAndAuth: snippets(
    row.text,
    /TRADING_AUTOMATION_SECRET|authorization|x-[a-z0-9-]+|headers\s*\(|request\.headers|NextRequest|POST\s*\(|GET\s*\(/gi,
    7,
    30
  ),

  env: snippets(
    row.text,
    /process\.env\.[A-Z0-9_]+|NEXT_PUBLIC_[A-Z0-9_]+|AUTOMATION_[A-Z0-9_]+|TRADING_[A-Z0-9_]+/g,
    5,
    30
  ),

  limits: snippets(
    row.text,
    /\.limit\s*\(|batchSize|batch_size|maxOrders|max_orders|concurrency|Promise\.all|Promise\.allSettled/gi,
    6,
    35
  ),

  uiTrigger: snippets(
    row.text,
    /fetch\s*\(|onClick|button|\/api\/trading\/automation\/run|\/api\/orders\/paper\/execute-approved|disabled|loading/gi,
    7,
    35
  ),

  maintenance: snippets(
    row.text,
    /maintenance|reconcile|expire|reserved_risk|committed_risk|RISK_APPROVED/gi,
    7,
    35
  ),
}));

const route = analysis.find(
  (row) => row.file === "app/api/trading/automation/run/route.ts"
);

const executor = analysis.find(
  (row) => row.file === "lib/trading/execute-approved-paper-orders.ts"
);

const panel = analysis.find(
  (row) => row.file === "app/components/AutomationRunPanel.tsx"
);

const maintenanceButton = analysis.find(
  (row) => row.file === "app/components/TradingMaintenanceButton.tsx"
);

const summary = {
  automationRouteExists:
    route?.exists === true,

  automationRouteExports:
    route?.exports ?? [],

  executeApprovedCalledByAutomationRoute:
    (route?.automationSequence ?? []).some(
      (hit) =>
        /executeApprovedPaperOrders/i.test(
          hit.match + "\n" + hit.snippet
        )
    ),

  executorExists:
    executor?.exists === true,

  panelCallsAutomationRoute:
    (panel?.uiTrigger ?? []).some(
      (hit) =>
        /\/api\/trading\/automation\/run/i.test(
          hit.match + "\n" + hit.snippet
        )
    ),

  maintenanceButtonExists:
    maintenanceButton?.exists === true,

  existingMaintenanceRpcReference:
    analysis.some(
      (row) =>
        row.maintenance.some(
          (hit) =>
            /expire_stale_paper_buy_reservations_v3|reconcile_paper_buy_reserved_risk_v3/i.test(
              hit.match + "\n" + hit.snippet
            )
        )
    ),

  automationSecretReferenced:
    analysis.some(
      (row) =>
        row.requestAndAuth.some(
          (hit) =>
            /TRADING_AUTOMATION_SECRET/i.test(
              hit.match + "\n" + hit.snippet
            )
        )
    ),
};

const recommendation = {
  proposedAutomationCadenceSeconds: 60,
  proposedAutomationCadenceMinutes: 1,
  proposedExpirySlaMinutes: 3,
  rationale:
    "DEFINE_60S_EXECUTION_CONTRACT_THEN_ALLOW_THREE_EXECUTION_OPPORTUNITIES_BEFORE_EXPIRY",
  schedulerImplementation:
    "DO_NOT_RELY_ON_BROWSER_INTERVAL_FOR_PRODUCTION; KEEP_ROUTE_CALLER_AGNOSTIC_AND_ENFORCE_CADENCE_CONTRACT_SERVER_SIDE",
};

const report = {
  status:
    "ALPHA_V3_AUTOMATION_RUN_CONTRACT_SOURCE_PROBE_COMPLETE",

  files: analysis,

  summary,

  recommendation,

  decision: {
    safeToBuildCadenceContract:
      summary.automationRouteExists &&
      summary.executorExists,

    nextGate:
      summary.automationRouteExists &&
      summary.executorExists
        ? "BUILD_60S_AUTOMATION_CADENCE_CONTRACT_AND_3M_MAINTENANCE_SLA"
        : "REVIEW_MISSING_AUTOMATION_RUN_SURFACE",
  },

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    ordersChanged: 0,
    positionsChanged: 0,
  },

  outputFile:
    "logs/alpha-v3-automation-run-contract-source-probe.json",
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

      summary: report.summary,

      recommendation: report.recommendation,

      files: report.files.map((row) => ({
        file: row.file,
        exists: row.exists,
        lineCount: row.lineCount,
        exports: row.exports,
        automationSequenceHits: row.automationSequence.length,
        requestAndAuthHits: row.requestAndAuth.length,
        envHits: row.env.length,
        limitHits: row.limits.length,
        uiTriggerHits: row.uiTrigger.length,
        maintenanceHits: row.maintenance.length,
      })),

      databaseWrites: 0,

      nextGate:
        report.decision.nextGate,

      outputFile:
        report.outputFile,
    },
    null,
    2
  )
);
