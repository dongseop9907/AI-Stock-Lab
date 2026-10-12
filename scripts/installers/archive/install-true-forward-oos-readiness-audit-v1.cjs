const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const SCRIPTS = path.join(ROOT, "scripts");
const PACKAGE = path.join(ROOT, "package.json");
const BACKUPS = path.join(SCRIPTS, "backups");
const TARGET = path.join(SCRIPTS, "true-forward-oos-readiness-audit-v1.cjs");

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status: "AI_STOCK_LAB_TRUE_FORWARD_OOS_READINESS_AUDIT_V1_INSTALL_FAILED",
    reason,
    ...extra
  }, null, 2));
  process.exit(1);
}

if (!fs.existsSync(SCRIPTS)) fail("SCRIPTS_DIRECTORY_NOT_FOUND");
if (!fs.existsSync(PACKAGE)) fail("PACKAGE_JSON_NOT_FOUND");

fs.mkdirSync(BACKUPS, { recursive: true });

const packageBackup = path.join(
  BACKUPS,
  "package.before-true-forward-oos-readiness-audit-v1.json"
);

if (!fs.existsSync(packageBackup)) {
  fs.copyFileSync(PACKAGE, packageBackup);
}

const auditSource = "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst ROOT = process.cwd();\nconst LOGS = path.join(ROOT, \"logs\");\nconst SCRIPTS = path.join(ROOT, \"scripts\");\n\nfunction walk(dir, out = []) {\n  if (!fs.existsSync(dir)) return out;\n  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {\n    if (entry.name === \"node_modules\" || entry.name === \".next\" || entry.name === \".git\") continue;\n    const full = path.join(dir, entry.name);\n    if (entry.isDirectory()) {\n      walk(full, out);\n    } else if (/\\.(ts|tsx|js|cjs|mjs|sql)$/.test(entry.name)) {\n      out.push(full);\n    }\n  }\n  return out;\n}\n\nfunction rel(full) {\n  return path.relative(ROOT, full).replace(/\\\\/g, \"/\");\n}\n\nfunction safeRead(full) {\n  try {\n    return fs.readFileSync(full, \"utf8\");\n  } catch {\n    return \"\";\n  }\n}\n\nconst roots = [\n  path.join(ROOT, \"lib\"),\n  path.join(ROOT, \"app\"),\n  path.join(ROOT, \"scripts\"),\n  path.join(ROOT, \"supabase\"),\n  path.join(ROOT, \"migrations\")\n].filter(fs.existsSync);\n\nconst files = roots.flatMap(r => walk(r));\n\nconst patterns = {\n  trueForward: /\\btrue[\\s_-]*forward\\b/i,\n  forwardOos: /\\bforward[\\s_-]*oos\\b|\\boos[\\s_-]*forward\\b/i,\n  outOfSample: /\\bout[\\s_-]*of[\\s_-]*sample\\b/i,\n  walkForward: /\\bwalk[\\s_-]*forward\\b/i,\n  oos: /\\bOOS\\b|\\boos\\b/i,\n  replay: /\\breplay\\b/i,\n  cutoff: /\\bcutoff\\b|\\bas[\\s_-]*of\\b/i,\n  frozen: /\\bfrozen\\b|\\bfreeze\\b/i,\n  leakage: /\\bleak(age)?\\b|\\bdata[\\s_-]*leak/i,\n  evaluator: /\\bevaluat(e|or|ion)\\b/i,\n  scheduler: /\\bcron\\b|\\bschedul(e|er|ing)\\b|\\bautomation\\b/i,\n  resultTable: /\\b(return|pnl|profit|loss|win_rate|drawdown|sharpe|expectancy)\\b/i\n};\n\nconst hits = [];\n\nfor (const file of files) {\n  const text = safeRead(file);\n  if (!text) continue;\n\n  const matched = Object.entries(patterns)\n    .filter(([, rx]) => rx.test(text))\n    .map(([name]) => name);\n\n  if (matched.length === 0) continue;\n\n  hits.push({\n    file: rel(file),\n    matched,\n    score:\n      (matched.includes(\"trueForward\") ? 5 : 0) +\n      (matched.includes(\"forwardOos\") ? 5 : 0) +\n      (matched.includes(\"outOfSample\") ? 3 : 0) +\n      (matched.includes(\"walkForward\") ? 3 : 0) +\n      (matched.includes(\"oos\") ? 2 : 0) +\n      (matched.includes(\"cutoff\") ? 2 : 0) +\n      (matched.includes(\"frozen\") ? 2 : 0) +\n      (matched.includes(\"leakage\") ? 2 : 0) +\n      (matched.includes(\"evaluator\") ? 1 : 0) +\n      (matched.includes(\"scheduler\") ? 1 : 0) +\n      (matched.includes(\"resultTable\") ? 1 : 0)\n  });\n}\n\nhits.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));\n\nconst top = hits.slice(0, 40);\n\nconst categories = {\n  hasExplicitTrueForward:\n    hits.some(x => x.matched.includes(\"trueForward\")),\n  hasForwardOos:\n    hits.some(x => x.matched.includes(\"forwardOos\")),\n  hasWalkForward:\n    hits.some(x => x.matched.includes(\"walkForward\")),\n  hasOos:\n    hits.some(x => x.matched.includes(\"oos\") || x.matched.includes(\"outOfSample\")),\n  hasCutoffProtection:\n    hits.some(x => x.matched.includes(\"cutoff\")),\n  hasFrozenParameterConcept:\n    hits.some(x => x.matched.includes(\"frozen\")),\n  hasLeakageProtectionConcept:\n    hits.some(x => x.matched.includes(\"leakage\")),\n  hasEvaluationPath:\n    hits.some(x => x.matched.includes(\"evaluator\")),\n  hasAutomationOrSchedulerReference:\n    hits.some(x => x.matched.includes(\"scheduler\")),\n  hasPerformanceMetricReference:\n    hits.some(x => x.matched.includes(\"resultTable\"))\n};\n\nconst required = [\n  \"hasWalkForward\",\n  \"hasOos\",\n  \"hasCutoffProtection\",\n  \"hasEvaluationPath\"\n];\n\nconst failedRequired = required.filter(k => categories[k] !== true);\n\nlet readiness;\nlet nextGate;\n\nif (failedRequired.length > 0) {\n  readiness = \"GAP\";\n  nextGate = \"INSPECT_AND_BUILD_MISSING_TRUE_FORWARD_OOS_FOUNDATIONS\";\n} else if (\n  categories.hasExplicitTrueForward &&\n  categories.hasForwardOos &&\n  categories.hasFrozenParameterConcept &&\n  categories.hasLeakageProtectionConcept &&\n  categories.hasAutomationOrSchedulerReference &&\n  categories.hasPerformanceMetricReference\n) {\n  readiness = \"STRONG_FOUNDATION\";\n  nextGate = \"AUDIT_RUNTIME_TRUE_FORWARD_OOS_DATA_FLOW\";\n} else {\n  readiness = \"PARTIAL_FOUNDATION\";\n  nextGate = \"HARDEN_TRUE_FORWARD_OOS_CONTRACT_AND_RUNTIME_BINDING\";\n}\n\nconst report = {\n  status: \"AI_STOCK_LAB_TRUE_FORWARD_OOS_READINESS_AUDIT_V1_COMPLETED\",\n  mode: \"READ_ONLY_SOURCE_AUDIT\",\n  readiness,\n  scanned: {\n    roots: roots.map(rel),\n    fileCount: files.length,\n    relevantFileCount: hits.length\n  },\n  categories,\n  failedRequired,\n  topRelevantFiles: top,\n  interpretation: {\n    strongFoundation:\n      \"Explicit true-forward/OOS concepts, frozen/cutoff/leakage controls, evaluation, automation references and metrics were all found.\",\n    partialFoundation:\n      \"Core OOS/WF foundations exist, but one or more explicit true-forward runtime safeguards or automation bindings are not obvious from source.\",\n    gap:\n      \"One or more required OOS foundations were not found and should be inspected before further forward validation work.\"\n  },\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    sourceFilesModified: 0,\n    orderCreation: false,\n    positionChange: false,\n    promotionApplyExecuted: false,\n    controlsChange: false,\n    realTradingEnable: false\n  },\n  nextGate\n};\n\nfs.mkdirSync(LOGS, { recursive: true });\nfs.writeFileSync(\n  path.join(LOGS, \"true-forward-oos-readiness-audit-v1.json\"),\n  JSON.stringify(report, null, 2),\n  \"utf8\"\n);\n\nconsole.log(JSON.stringify(report, null, 2));\nprocess.exitCode = failedRequired.length === 0 ? 0 : 1;\n";

try {
  new Function("require", "__dirname", "__filename", "process", "console", auditSource);
} catch (error) {
  fail("GENERATED_AUDIT_SYNTAX_ERROR", {
    error: error instanceof Error ? error.message : String(error)
  });
}

fs.writeFileSync(TARGET, auditSource, "utf8");

let pkg;
try {
  pkg = JSON.parse(fs.readFileSync(PACKAGE, "utf8"));
} catch (error) {
  fail("PACKAGE_JSON_PARSE_FAILED", {
    error: error instanceof Error ? error.message : String(error)
  });
}

if (!pkg.scripts || typeof pkg.scripts !== "object") pkg.scripts = {};
pkg.scripts["test:true-forward-oos-readiness"] =
  "node ./scripts/true-forward-oos-readiness-audit-v1.cjs";

fs.writeFileSync(PACKAGE, JSON.stringify(pkg, null, 2) + "\n", "utf8");

console.log(JSON.stringify({
  status: "AI_STOCK_LAB_TRUE_FORWARD_OOS_READINESS_AUDIT_V1_INSTALLED",
  generatedFile: "scripts/true-forward-oos-readiness-audit-v1.cjs",
  packageScript: "npm run test:true-forward-oos-readiness",
  backup: "scripts/backups/package.before-true-forward-oos-readiness-audit-v1.json",
  safety: {
    sourceProductCodeChanges: 0,
    databaseWrites: 0,
    orderCreation: false,
    positionChange: false,
    realTradingEnable: false
  },
  nextAction: "RUN_TRUE_FORWARD_OOS_READINESS_AUDIT"
}, null, 2));
