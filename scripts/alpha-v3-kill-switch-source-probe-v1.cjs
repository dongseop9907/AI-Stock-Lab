const fs = require("fs");
const path = require("path");

const root = process.cwd();

const roots = [
  "app",
  "lib",
  "supabase/migrations",
  "scripts"
];

const excludeDirs = new Set([
  "node_modules",
  ".next",
  ".git",
  "logs",
  "dist",
  "build"
]);

const interestingTerms = [
  "emergency_stop",
  "emergencyStop",
  "automation_enabled",
  "automationEnabled",
  "paper_order_enabled",
  "paperOrderEnabled",
  "real_order_enabled",
  "realOrderEnabled",
  "trading_system_control",
  "getTradingSystemControl",
  "executeApprovedPaperOrders",
  "executePaperOrder",
  "createPaperBuyOrder",
  "createPaperBuyOrderWithCommittedRisk",
  "execute_paper_buy_order",
  "stop-loss",
  "trailing-stop",
  "automation/run",
  "automation/cycle",
  "automation/manual",
  "scheduler",
  "kill switch",
  "kill_switch",
  "KILL_SWITCH"
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) {
    return out;
  }

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (excludeDirs.has(entry.name)) {
      continue;
    }

    const abs = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walk(abs, out);
      continue;
    }

    if (
      entry.isFile() &&
      /\.(ts|tsx|js|cjs|mjs|sql)$/.test(entry.name)
    ) {
      out.push(abs);
    }
  }

  return out;
}

function lineOf(text, index) {
  return text.slice(0, Math.max(0, index)).split("\n").length;
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

function occurrences(text, term) {
  const rows = [];
  let cursor = 0;

  while (true) {
    const index = text.indexOf(term, cursor);

    if (index < 0) {
      break;
    }

    rows.push({
      index,
      line: lineOf(text, index)
    });

    cursor = index + term.length;
  }

  return rows;
}

const files = roots
  .flatMap((rel) => walk(path.resolve(root, rel)));

const findings = [];
const controlReaders = [];
const controlWriters = [];
const executionSurfaces = [];
const schedulerSurfaces = [];
const potentialBypasses = [];

for (const abs of files) {
  const rel = path
    .relative(root, abs)
    .replace(/\\/g, "/");

  const text = fs
    .readFileSync(abs, "utf8")
    .replace(/\r\n/g, "\n");

  const lines = text.split("\n");

  const hits = [];

  for (const term of interestingTerms) {
    const found = occurrences(text, term);

    for (const item of found) {
      hits.push({
        term,
        line: item.line,
        excerpt: excerpt(lines, item.line, 4)
      });
    }
  }

  if (hits.length === 0) {
    continue;
  }

  findings.push({
    file: rel,
    hitCount: hits.length,
    hits
  });

  const lower = text.toLowerCase();

  const readsSystemControl =
    text.includes("getTradingSystemControl") ||
    (
      lower.includes("trading_system_control") &&
      (
        lower.includes(".select(") ||
        lower.includes("select ")
      )
    );

  const writesSystemControl =
    lower.includes("trading_system_control") &&
    (
      lower.includes(".update(") ||
      lower.includes(".insert(") ||
      /update\s+(?:public\.)?trading_system_control/i.test(text) ||
      /insert\s+into\s+(?:public\.)?trading_system_control/i.test(text)
    );

  const isExecutionSurface =
    text.includes("executeApprovedPaperOrders") ||
    text.includes("executePaperOrder") ||
    text.includes("execute_paper_buy_order") ||
    text.includes("createPaperBuyOrder") ||
    text.includes("createPaperBuyOrderWithCommittedRisk");

  const isSchedulerSurface =
    lower.includes("scheduler") ||
    rel.includes("automation-cycle-scheduler");

  const hasEmergencyReference =
    text.includes("emergencyStop") ||
    text.includes("emergency_stop");

  const hasOrderAction =
    isExecutionSurface ||
    lower.includes("autoorder") ||
    lower.includes("paperorderenabled") ||
    lower.includes("realorderenabled");

  if (readsSystemControl) {
    controlReaders.push(rel);
  }

  if (writesSystemControl) {
    controlWriters.push(rel);
  }

  if (isExecutionSurface) {
    executionSurfaces.push({
      file: rel,
      hasEmergencyReference,
      readsSystemControl,
      hasAutomationEnabled:
        text.includes("automationEnabled") ||
        text.includes("automation_enabled"),
      hasPaperOrderEnabled:
        text.includes("paperOrderEnabled") ||
        text.includes("paper_order_enabled"),
      hasRealOrderEnabled:
        text.includes("realOrderEnabled") ||
        text.includes("real_order_enabled")
    });
  }

  if (isSchedulerSurface) {
    schedulerSurfaces.push({
      file: rel,
      hasEmergencyReference,
      readsSystemControl,
      hasOrderAction
    });
  }

  if (
    hasOrderAction &&
    !hasEmergencyReference &&
    !readsSystemControl
  ) {
    potentialBypasses.push({
      file: rel,
      reason:
        "ORDER_OR_EXECUTION_SURFACE_WITHOUT_VISIBLE_EMERGENCY_STOP_OR_SYSTEM_CONTROL_READ"
    });
  }
}

function unique(values) {
  return [...new Set(values)].sort();
}

const summary = {
  scannedFileCount:
    files.length,

  relevantFileCount:
    findings.length,

  controlReaders:
    unique(controlReaders),

  controlWriters:
    unique(controlWriters),

  executionSurfaces,

  schedulerSurfaces,

  potentialBypasses,

  counts: {
    controlReaderCount:
      unique(controlReaders).length,

    controlWriterCount:
      unique(controlWriters).length,

    executionSurfaceCount:
      executionSurfaces.length,

    schedulerSurfaceCount:
      schedulerSurfaces.length,

    potentialBypassCount:
      potentialBypasses.length
  }
};

const report = {
  status:
    "ALPHA_V3_KILL_SWITCH_SOURCE_PROBE_V1_COMPLETE",

  summary,

  findings,

  designQuestions: [
    "WHERE_IS_THE_SINGLE_AUTHORITATIVE_KILL_SWITCH_STATE_STORED",
    "WHICH_PATHS_CREATE_OR_EXECUTE_ORDERS_WITHOUT_READING_CONTROL",
    "DO_STOP_LOSS_AND_TRAILING_EXITS_STILL_RUN_WHEN_KILL_SWITCH_IS_ACTIVE",
    "SHOULD_KILL_SWITCH_BLOCK_NEW_ENTRIES_ONLY_OR_ALL_NON_PROTECTIVE_ACTIONS",
    "DOES_SCHEDULER_STOP_CALLING_CYCLES_OR_DO_CYCLES_FAIL_CLOSED",
    "HOW_IS_MANUAL_RESET_AUTHORIZED_AND_AUDITED",
    "WHAT_REASON_AND_ACTOR_METADATA_MUST_BE_PERSISTED",
    "WHAT_AUTOMATIC_TRIGGERS_SHOULD_LATCH_THE_SWITCH"
  ],

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    networkCalls: 0,
    ordersCreated: 0,
    ordersChanged: 0,
    positionsChanged: 0
  },

  logFile:
    "logs/alpha-v3-kill-switch-source-probe-v1.json",

  nextGate:
    "DEFINE_KILL_SWITCH_CONTRACT_FROM_EXISTING_CONTROL_AND_EXECUTION_SURFACES"
};

const logsDir =
  path.resolve(root, "logs");

fs.mkdirSync(
  logsDir,
  { recursive: true }
);

fs.writeFileSync(
  path.join(
    logsDir,
    "alpha-v3-kill-switch-source-probe-v1.json"
  ),
  JSON.stringify(report, null, 2) + "\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status: report.status,
      summary: report.summary,
      designQuestions: report.designQuestions,
      safety: report.safety,
      logFile: report.logFile,
      nextGate: report.nextGate
    },
    null,
    2
  )
);
