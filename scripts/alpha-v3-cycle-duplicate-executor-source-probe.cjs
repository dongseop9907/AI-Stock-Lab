const fs = require("fs");
const path = require("path");

const root = process.cwd();

const files = {
  cycle:
    "app/api/trading/automation/cycle/route.ts",
  run:
    "app/api/trading/automation/run/route.ts",
  panel:
    "app/components/AutomationRunPanel.tsx",
};

function read(rel) {
  const abs =
    path.resolve(root, rel);

  if (!fs.existsSync(abs)) {
    return {
      exists: false,
      rel,
      text: "",
      lines: [],
    };
  }

  const text =
    fs.readFileSync(abs, "utf8")
      .replace(/\r\n/g, "\n");

  return {
    exists: true,
    rel,
    text,
    lines:
      text.split("\n"),
  };
}

function lineNumber(text, index) {
  if (index < 0) {
    return null;
  }

  return text
    .slice(0, index)
    .split("\n")
    .length;
}

function excerpt(item, line, radius = 18) {
  if (!line) {
    return null;
  }

  const start =
    Math.max(1, line - radius);

  const end =
    Math.min(
      item.lines.length,
      line + radius,
    );

  return {
    startLine: start,
    endLine: end,
    text:
      item.lines
        .slice(start - 1, end)
        .map(
          (value, index) =>
            `${start + index}: ${value}`,
        )
        .join("\n"),
  };
}

function occurrences(item, needle) {
  const rows = [];
  let cursor = 0;

  while (true) {
    const index =
      item.text.indexOf(
        needle,
        cursor,
      );

    if (index < 0) {
      break;
    }

    rows.push({
      needle,
      index,
      line:
        lineNumber(
          item.text,
          index,
        ),
      excerpt:
        excerpt(
          item,
          lineNumber(
            item.text,
            index,
          ),
          22,
        ),
    });

    cursor =
      index +
      needle.length;
  }

  return rows;
}

const loaded =
  Object.fromEntries(
    Object.entries(files)
      .map(
        ([key, rel]) => [
          key,
          read(rel),
        ],
      ),
  );

const cycleNeedles = [
  "request.clone()",
  "/api/trading/automation/run",
  "JSON.stringify(",
  "executeApprovedPaperOrders(",
  "maxApprovedOrdersPerCycle",
  "probeOnly",
  "x-automation-secret",
];

const runNeedles = [
  "autoOrder",
  "if (autoOrder)",
  "/api/orders/paper/execute-approved",
  "/api/signals/entry/generate",
  "interface AutomationRequest",
];

const panelNeedles = [
  "/api/trading/automation/cycle",
  "autoOrder",
  "includeMarketSync",
  "maxOrders",
];

const findings = {
  cycle:
    Object.fromEntries(
      cycleNeedles.map(
        (needle) => [
          needle,
          occurrences(
            loaded.cycle,
            needle,
          ),
        ],
      ),
    ),

  run:
    Object.fromEntries(
      runNeedles.map(
        (needle) => [
          needle,
          occurrences(
            loaded.run,
            needle,
          ),
        ],
      ),
    ),

  panel:
    Object.fromEntries(
      panelNeedles.map(
        (needle) => [
          needle,
          occurrences(
            loaded.panel,
            needle,
          ),
        ],
      ),
    ),
};

const runHasExecutor =
  loaded.run.text.includes(
    "/api/orders/paper/execute-approved",
  );

const cycleHasExecutor =
  loaded.cycle.text.includes(
    "executeApprovedPaperOrders(",
  );

const duplicateExecutorSurface =
  runHasExecutor &&
  cycleHasExecutor;

const cycleHasAutoOrderReference =
  /\bautoOrder\b/.test(
    loaded.cycle.text,
  );

const panelCallsCycle =
  loaded.panel.text.includes(
    "/api/trading/automation/cycle",
  );

const report = {
  status:
    "ALPHA_V3_CYCLE_DUPLICATE_EXECUTOR_SOURCE_PROBE_COMPLETE",

  files:
    Object.fromEntries(
      Object.entries(loaded)
        .map(
          ([key, item]) => [
            key,
            {
              file: item.rel,
              exists: item.exists,
              lineCount:
                item.lines.length,
            },
          ],
        ),
    ),

  summary: {
    runHasApprovedExecutorStep:
      runHasExecutor,

    cycleHasApprovedExecutorCall:
      cycleHasExecutor,

    duplicateExecutorSurface,

    cycleReferencesAutoOrder:
      cycleHasAutoOrderReference,

    panelCallsCycle,

    requiresPatchBeforeOperationalOneShot:
      duplicateExecutorSurface,
  },

  findings,

  recommendedContract: {
    innerRunCreatesOrders:
      "autoOrder=true",

    innerRunExecutesApprovedOrders:
      false,

    cycleExecutesApprovedOrders:
      "exactly once when autoOrder=true",

    autoOrderFalse:
      "no order creation and no approved-order execution",

    ui:
      "call server-side manual proxy; never expose TRADING_AUTOMATION_SECRET to browser",
  },

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    networkCalls: 0,
    cyclePostRequests: 0,
    ordersCreated: 0,
    ordersChanged: 0,
    positionsChanged: 0,
  },

  nextGate:
    duplicateExecutorSurface
      ? "PATCH_SINGLE_EXECUTOR_CONTRACT_AND_UI_SERVER_PROXY"
      : "PATCH_UI_SERVER_PROXY_ONLY",
};

const outputFile =
  path.resolve(
    root,
    "logs/alpha-v3-cycle-duplicate-executor-source-probe.json",
  );

fs.mkdirSync(
  path.dirname(outputFile),
  {
    recursive: true,
  },
);

fs.writeFileSync(
  outputFile,
  JSON.stringify(
    report,
    null,
    2,
  ) + "\n",
  "utf8",
);

console.log(
  JSON.stringify(
    report,
    null,
    2,
  ),
);
