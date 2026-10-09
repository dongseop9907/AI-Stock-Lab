const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const LOGS = path.join(ROOT, "logs");
const SCRIPTS = path.join(ROOT, "scripts");

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx|js|cjs|mjs|sql)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function rel(full) {
  return path.relative(ROOT, full).replace(/\\/g, "/");
}

function safeRead(full) {
  try {
    return fs.readFileSync(full, "utf8");
  } catch {
    return "";
  }
}

const roots = [
  path.join(ROOT, "lib"),
  path.join(ROOT, "app"),
  path.join(ROOT, "scripts"),
  path.join(ROOT, "supabase"),
  path.join(ROOT, "migrations")
].filter(fs.existsSync);

const files = roots.flatMap(r => walk(r));

const patterns = {
  trueForward: /\btrue[\s_-]*forward\b/i,
  forwardOos: /\bforward[\s_-]*oos\b|\boos[\s_-]*forward\b/i,
  outOfSample: /\bout[\s_-]*of[\s_-]*sample\b/i,
  walkForward: /\bwalk[\s_-]*forward\b/i,
  oos: /\bOOS\b|\boos\b/i,
  replay: /\breplay\b/i,
  cutoff: /\bcutoff\b|\bas[\s_-]*of\b/i,
  frozen: /\bfrozen\b|\bfreeze\b/i,
  leakage: /\bleak(age)?\b|\bdata[\s_-]*leak/i,
  evaluator: /\bevaluat(e|or|ion)\b/i,
  scheduler: /\bcron\b|\bschedul(e|er|ing)\b|\bautomation\b/i,
  resultTable: /\b(return|pnl|profit|loss|win_rate|drawdown|sharpe|expectancy)\b/i
};

const hits = [];

for (const file of files) {
  const text = safeRead(file);
  if (!text) continue;

  const matched = Object.entries(patterns)
    .filter(([, rx]) => rx.test(text))
    .map(([name]) => name);

  if (matched.length === 0) continue;

  hits.push({
    file: rel(file),
    matched,
    score:
      (matched.includes("trueForward") ? 5 : 0) +
      (matched.includes("forwardOos") ? 5 : 0) +
      (matched.includes("outOfSample") ? 3 : 0) +
      (matched.includes("walkForward") ? 3 : 0) +
      (matched.includes("oos") ? 2 : 0) +
      (matched.includes("cutoff") ? 2 : 0) +
      (matched.includes("frozen") ? 2 : 0) +
      (matched.includes("leakage") ? 2 : 0) +
      (matched.includes("evaluator") ? 1 : 0) +
      (matched.includes("scheduler") ? 1 : 0) +
      (matched.includes("resultTable") ? 1 : 0)
  });
}

hits.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));

const top = hits.slice(0, 40);

const categories = {
  hasExplicitTrueForward:
    hits.some(x => x.matched.includes("trueForward")),
  hasForwardOos:
    hits.some(x => x.matched.includes("forwardOos")),
  hasWalkForward:
    hits.some(x => x.matched.includes("walkForward")),
  hasOos:
    hits.some(x => x.matched.includes("oos") || x.matched.includes("outOfSample")),
  hasCutoffProtection:
    hits.some(x => x.matched.includes("cutoff")),
  hasFrozenParameterConcept:
    hits.some(x => x.matched.includes("frozen")),
  hasLeakageProtectionConcept:
    hits.some(x => x.matched.includes("leakage")),
  hasEvaluationPath:
    hits.some(x => x.matched.includes("evaluator")),
  hasAutomationOrSchedulerReference:
    hits.some(x => x.matched.includes("scheduler")),
  hasPerformanceMetricReference:
    hits.some(x => x.matched.includes("resultTable"))
};

const required = [
  "hasWalkForward",
  "hasOos",
  "hasCutoffProtection",
  "hasEvaluationPath"
];

const failedRequired = required.filter(k => categories[k] !== true);

let readiness;
let nextGate;

if (failedRequired.length > 0) {
  readiness = "GAP";
  nextGate = "INSPECT_AND_BUILD_MISSING_TRUE_FORWARD_OOS_FOUNDATIONS";
} else if (
  categories.hasExplicitTrueForward &&
  categories.hasForwardOos &&
  categories.hasFrozenParameterConcept &&
  categories.hasLeakageProtectionConcept &&
  categories.hasAutomationOrSchedulerReference &&
  categories.hasPerformanceMetricReference
) {
  readiness = "STRONG_FOUNDATION";
  nextGate = "AUDIT_RUNTIME_TRUE_FORWARD_OOS_DATA_FLOW";
} else {
  readiness = "PARTIAL_FOUNDATION";
  nextGate = "HARDEN_TRUE_FORWARD_OOS_CONTRACT_AND_RUNTIME_BINDING";
}

const report = {
  status: "AI_STOCK_LAB_TRUE_FORWARD_OOS_READINESS_AUDIT_V1_COMPLETED",
  mode: "READ_ONLY_SOURCE_AUDIT",
  readiness,
  scanned: {
    roots: roots.map(rel),
    fileCount: files.length,
    relevantFileCount: hits.length
  },
  categories,
  failedRequired,
  topRelevantFiles: top,
  interpretation: {
    strongFoundation:
      "Explicit true-forward/OOS concepts, frozen/cutoff/leakage controls, evaluation, automation references and metrics were all found.",
    partialFoundation:
      "Core OOS/WF foundations exist, but one or more explicit true-forward runtime safeguards or automation bindings are not obvious from source.",
    gap:
      "One or more required OOS foundations were not found and should be inspected before further forward validation work."
  },
  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    sourceFilesModified: 0,
    orderCreation: false,
    positionChange: false,
    promotionApplyExecuted: false,
    controlsChange: false,
    realTradingEnable: false
  },
  nextGate
};

fs.mkdirSync(LOGS, { recursive: true });
fs.writeFileSync(
  path.join(LOGS, "true-forward-oos-readiness-audit-v1.json"),
  JSON.stringify(report, null, 2),
  "utf8"
);

console.log(JSON.stringify(report, null, 2));
process.exitCode = failedRequired.length === 0 ? 0 : 1;
