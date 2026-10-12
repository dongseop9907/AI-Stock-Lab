const fs = require("fs");
const path = require("path");

const root = process.cwd();

const reportFile = path.resolve(
  root,
  "logs/alpha-v3-automation-stage-order-probe.json"
);

const targets = [
  "app/api/trading/automation/run/route.ts",
  "app/components/TradingMaintenanceButton.tsx",
  "app/components/AutomationRunPanel.tsx",
  "app/api/orders/paper/execute-approved/route.ts",
  "lib/trading/execute-approved-paper-orders.ts",
];

function read(rel) {
  const file = path.resolve(root, rel);

  if (!fs.existsSync(file)) {
    return {
      file: rel,
      exists: false,
      text: null,
    };
  }

  return {
    file: rel,
    exists: true,
    text: fs.readFileSync(file, "utf8"),
  };
}

function lineNo(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function snippets(text, regex, radius = 5, max = 80) {
  if (!text) {
    return [];
  }

  const normalized =
    text.replace(/\r\n/g, "\n");

  const lines =
    normalized.split("\n");

  const rows = [];
  let match;

  while (
    (match = regex.exec(normalized)) &&
    rows.length < max
  ) {
    const line =
      lineNo(normalized, match.index);

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

    rows.push({
      line,
      match:
        match[0],

      snippet:
        lines
          .slice(start - 1, end)
          .map(
            (value, offset) =>
              `${start + offset}: ${value}`
          )
          .join("\n"),
    });
  }

  return rows;
}

function imports(text) {
  if (!text) return [];

  return [
    ...text.matchAll(
      /import\s+([\s\S]*?)\s+from\s+["']([^"']+)["'];?/g
    ),
  ].map(
    (m) => ({
      specifier:
        m[1].trim(),

      source:
        m[2],
    })
  );
}

function awaitCalls(text) {
  if (!text) return [];

  const rows = [];

  const regex =
    /\bawait\s+([A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)?)\s*\(/g;

  let match;

  while ((match = regex.exec(text))) {
    rows.push({
      callee:
        match[1],

      line:
        lineNo(text, match.index),

      snippet:
        snippets(
          text,
          new RegExp(
            `await\\s+${match[1]
              .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\(`,
            "g"
          ),
          4,
          1
        )[0]?.snippet ?? null,
    });
  }

  return rows;
}

function fetchCalls(text) {
  if (!text) return [];

  const rows = [];

  const regex =
    /fetch\s*\(\s*([`"'][\s\S]*?[`"'])/g;

  let match;

  while ((match = regex.exec(text))) {
    rows.push({
      expression:
        match[1],

      line:
        lineNo(text, match.index),

      snippet:
        snippets(
          text,
          /fetch\s*\(/g,
          5,
          80
        ).find(
          (row) =>
            Math.abs(
              row.line -
              lineNo(text, match.index)
            ) <= 1
        )?.snippet ?? null,
    });
  }

  return rows;
}

const files =
  targets.map(read);

const analysis =
  files.map(
    (row) => ({
      file:
        row.file,

      exists:
        row.exists,

      imports:
        imports(row.text),

      awaitCalls:
        awaitCalls(row.text),

      fetchCalls:
        fetchCalls(row.text),

      stageMarkers:
        snippets(
          row.text,
          /stage|step|phase|signal|order|execute|risk|trailing|stop-loss|stop loss|evaluate|report|snapshot|sync|shadow|maintenance/gi,
          4,
          100
        ),

      responses:
        snippets(
          row.text,
          /NextResponse\.json|return\s+\{|ok:\s*true|ok:\s*false|status:/gi,
          5,
          50
        ),
    })
  );

const route =
  analysis.find(
    (row) =>
      row.file ===
      "app/api/trading/automation/run/route.ts"
  );

const maintenance =
  analysis.find(
    (row) =>
      row.file ===
      "app/components/TradingMaintenanceButton.tsx"
  );

const panel =
  analysis.find(
    (row) =>
      row.file ===
      "app/components/AutomationRunPanel.tsx"
  );

const approvedRoute =
  analysis.find(
    (row) =>
      row.file ===
      "app/api/orders/paper/execute-approved/route.ts"
  );

const executor =
  analysis.find(
    (row) =>
      row.file ===
      "lib/trading/execute-approved-paper-orders.ts"
  );

function apiPaths(row) {
  return [
    ...new Set(
      (row?.fetchCalls ?? [])
        .flatMap(
          (call) =>
            [
              ...call.expression.matchAll(
                /\/api\/[A-Za-z0-9_?=&${}/.-]+/g
              ),
            ].map(
              (m) =>
                m[0]
            )
        )
    ),
  ];
}

const automationCallees =
  route?.awaitCalls.map(
    (row) =>
      row.callee
  ) ?? [];

const maintenanceApiPaths =
  apiPaths(maintenance);

const panelApiPaths =
  apiPaths(panel);

const approvedRouteCallees =
  approvedRoute?.awaitCalls.map(
    (row) =>
      row.callee
  ) ?? [];

const executorCallees =
  executor?.awaitCalls.map(
    (row) =>
      row.callee
  ) ?? [];

const knownStageNames = [
  "executeApprovedPaperOrders",
  "generateEntrySignals",
  "updateTrailingStops",
  "checkAndExecuteStopLosses",
  "evaluate",
  "generateDailyPerformanceReport",
  "sync",
];

const automationKnownStages =
  automationCallees.filter(
    (name) =>
      knownStageNames.some(
        (stage) =>
          name.toLowerCase()
            .includes(
              stage.toLowerCase()
            )
      )
  );

const report = {
  status:
    "ALPHA_V3_AUTOMATION_STAGE_ORDER_PROBE_COMPLETE",

  files:
    analysis,

  summary: {
    automationRun: {
      awaitCallSequence:
        route?.awaitCalls ?? [],

      knownStageSequence:
        automationKnownStages,

      directlyCallsExecuteApproved:
        automationCallees.some(
          (name) =>
            /executeApprovedPaperOrders/i.test(
              name
            )
        ),
    },

    tradingMaintenanceButton: {
      apiCallSequence:
        maintenanceApiPaths,

      callsExecuteApprovedApi:
        maintenanceApiPaths.some(
          (p) =>
            /\/api\/orders\/paper\/execute-approved/i.test(
              p
            )
        ),
    },

    automationRunPanel: {
      apiCallSequence:
        panelApiPaths,

      callsAutomationRun:
        panelApiPaths.some(
          (p) =>
            /\/api\/trading\/automation\/run/i.test(
              p
            )
        ),
    },

    executeApprovedRoute: {
      awaitCallSequence:
        approvedRoute?.awaitCalls ?? [],

      callsExecutor:
        approvedRouteCallees.some(
          (name) =>
            /executeApprovedPaperOrders/i.test(
              name
            )
        ),
    },

    executor: {
      awaitCallSequence:
        executor?.awaitCalls ?? [],

      calleeNames:
        executorCallees,
    },
  },

  designDecision: {
    proposedCadenceSeconds:
      60,

    proposedExpiryMinutes:
      3,

    preferredCycleOrder: [
      "PRE_MAINTENANCE_RECONCILE",
      "EXPIRE_STALE_RESERVATIONS",
      "RUN_EXISTING_AUTOMATION_SIGNAL_PIPELINE",
      "EXECUTE_APPROVED_PAPER_ORDERS",
      "POST_EXECUTION_RECONCILE",
    ],

    patchTargetPendingSourceConfirmation:
      true,
  },

  decision: {
    safeToPatchAutomationCycle:
      Boolean(
        route?.exists &&
        approvedRoute?.exists &&
        executor?.exists
      ),

    nextGate:
      Boolean(
        route?.exists &&
        approvedRoute?.exists &&
        executor?.exists
      )
        ? "BUILD_SERVER_SIDE_AUTOMATION_CYCLE_CONTRACT"
        : "REVIEW_MISSING_AUTOMATION_COMPONENT",
  },

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    ordersChanged: 0,
    positionsChanged: 0,
  },

  outputFile:
    "logs/alpha-v3-automation-stage-order-probe.json",
};

fs.mkdirSync(
  path.dirname(reportFile),
  {
    recursive: true,
  }
);

fs.writeFileSync(
  reportFile,
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

      summary:
        report.summary,

      proposedCycle:
        report.designDecision,

      files:
        report.files.map(
          (row) => ({
            file:
              row.file,

            exists:
              row.exists,

            importCount:
              row.imports.length,

            awaitCallCount:
              row.awaitCalls.length,

            fetchCallCount:
              row.fetchCalls.length,

            stageMarkerCount:
              row.stageMarkers.length,
          })
        ),

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
