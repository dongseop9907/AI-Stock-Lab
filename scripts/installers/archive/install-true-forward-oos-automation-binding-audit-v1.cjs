const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const SCRIPTS = path.join(ROOT, "scripts");
const PACKAGE = path.join(ROOT, "package.json");
const BACKUPS = path.join(SCRIPTS, "backups");
const TARGET = path.join(
  SCRIPTS,
  "true-forward-oos-automation-binding-audit-v1.cjs"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_BINDING_AUDIT_V1_INSTALL_FAILED",
    reason,
    ...extra
  }, null, 2));
  process.exit(1);
}

if (!fs.existsSync(SCRIPTS)) fail("SCRIPTS_DIRECTORY_NOT_FOUND");
if (!fs.existsSync(PACKAGE)) fail("PACKAGE_JSON_NOT_FOUND");

const required = [
  "scripts/alpha-v3-true-entry-forward-oos-collector-v1.ts",
  "scripts/alpha-v3-true-forward-oos-evaluator-v1.ts",
  "scripts/alpha-v3-true-forward-oos-summary.ts",
  "app/api/trading/automation/run/route.ts"
];

const missing = required.filter(
  rel => !fs.existsSync(path.join(ROOT, rel))
);

if (missing.length > 0) {
  fail("REQUIRED_FORWARD_OOS_RUNTIME_FILES_MISSING", { missing });
}

fs.mkdirSync(BACKUPS, { recursive: true });

const packageBackup = path.join(
  BACKUPS,
  "package.before-true-forward-oos-automation-binding-audit-v1.json"
);

if (!fs.existsSync(packageBackup)) {
  fs.copyFileSync(PACKAGE, packageBackup);
}

const auditSource = "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst ROOT = process.cwd();\nconst LOGS = path.join(ROOT, \"logs\");\n\nconst TARGETS = {\n  collector: \"scripts/alpha-v3-true-entry-forward-oos-collector-v1.ts\",\n  evaluator: \"scripts/alpha-v3-true-forward-oos-evaluator-v1.ts\",\n  summary: \"scripts/alpha-v3-true-forward-oos-summary.ts\",\n  automationRoute: \"app/api/trading/automation/run/route.ts\",\n  packageJson: \"package.json\"\n};\n\nfunction exists(rel) {\n  return fs.existsSync(path.join(ROOT, rel));\n}\n\nfunction read(rel) {\n  try {\n    return fs.readFileSync(path.join(ROOT, rel), \"utf8\");\n  } catch {\n    return \"\";\n  }\n}\n\nfunction walk(dir, out = []) {\n  if (!fs.existsSync(dir)) return out;\n\n  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {\n    if (\n      entry.name === \"node_modules\" ||\n      entry.name === \".next\" ||\n      entry.name === \".git\" ||\n      entry.name === \"backups\"\n    ) continue;\n\n    const full = path.join(dir, entry.name);\n\n    if (entry.isDirectory()) {\n      walk(full, out);\n    } else if (/\\.(ts|tsx|js|cjs|mjs|json)$/.test(entry.name)) {\n      out.push(full);\n    }\n  }\n\n  return out;\n}\n\nfunction rel(full) {\n  return path.relative(ROOT, full).replace(/\\\\/g, \"/\");\n}\n\nfunction safeRead(full) {\n  try {\n    return fs.readFileSync(full, \"utf8\");\n  } catch {\n    return \"\";\n  }\n}\n\nfunction findRefs(tokens, roots) {\n  const hits = [];\n\n  for (const root of roots) {\n    const fullRoot = path.join(ROOT, root);\n    if (!fs.existsSync(fullRoot)) continue;\n\n    const files = fs.statSync(fullRoot).isDirectory()\n      ? walk(fullRoot)\n      : [fullRoot];\n\n    for (const file of files) {\n      const relative = rel(file);\n\n      if (\n        relative.startsWith(\"scripts/install-\") ||\n        relative.includes(\"automation-binding-audit-v1\") ||\n        relative.includes(\"runtime-data-flow-audit-v1\") ||\n        relative.includes(\"runtime-dependency-audit-v2\") ||\n        relative.includes(\"existing-contract-verify-v1\")\n      ) {\n        continue;\n      }\n\n      const text = safeRead(file);\n\n      const matched = tokens.filter(token => text.includes(token));\n\n      if (matched.length > 0) {\n        hits.push({\n          file: relative,\n          matched\n        });\n      }\n    }\n  }\n\n  return hits;\n}\n\nconst basenames = {\n  collector: path.basename(TARGETS.collector).replace(/\\.ts$/, \"\"),\n  evaluator: path.basename(TARGETS.evaluator).replace(/\\.ts$/, \"\"),\n  summary: path.basename(TARGETS.summary).replace(/\\.ts$/, \"\")\n};\n\nconst runtimeRefs = {\n  collector: findRefs(\n    [basenames.collector, TARGETS.collector],\n    [\"app\", \"lib\", \"scripts\", \"package.json\"]\n  ),\n  evaluator: findRefs(\n    [basenames.evaluator, TARGETS.evaluator],\n    [\"app\", \"lib\", \"scripts\", \"package.json\"]\n  ),\n  summary: findRefs(\n    [basenames.summary, TARGETS.summary],\n    [\"app\", \"lib\", \"scripts\", \"package.json\"]\n  )\n};\n\nconst automationText = read(TARGETS.automationRoute);\nconst packageText = read(TARGETS.packageJson);\n\nconst scheduleFiles = findRefs(\n  [\n    \"cron\",\n    \"schedule\",\n    \"scheduler\",\n    \"automation\",\n    \"15:40\",\n    \"1540\"\n  ],\n  [\"app\", \"lib\", \"scripts\", \"package.json\"]\n);\n\nconst productionRefs = (refs) =>\n  refs.filter(item =>\n    item.file.startsWith(\"app/\") ||\n    item.file.startsWith(\"lib/\")\n  );\n\nconst scriptRefs = (refs) =>\n  refs.filter(item =>\n    item.file.startsWith(\"scripts/\") &&\n    !item.file.includes(\"contract-test\") &&\n    !item.file.includes(\"static-verify\") &&\n    !item.file.includes(\"probe\") &&\n    !item.file.includes(\"audit\")\n  );\n\nconst checks = {\n  collectorExists:\n    exists(TARGETS.collector),\n\n  evaluatorExists:\n    exists(TARGETS.evaluator),\n\n  summaryExists:\n    exists(TARGETS.summary),\n\n  automationRouteExists:\n    exists(TARGETS.automationRoute),\n\n  collectorReferencedByProductionRuntime:\n    productionRefs(runtimeRefs.collector).length > 0,\n\n  evaluatorReferencedByProductionRuntime:\n    productionRefs(runtimeRefs.evaluator).length > 0,\n\n  summaryReferencedByProductionRuntime:\n    productionRefs(runtimeRefs.summary).length > 0,\n\n  collectorHasAnyNonAuditRuntimeReference:\n    scriptRefs(runtimeRefs.collector).length > 0 ||\n    productionRefs(runtimeRefs.collector).length > 0,\n\n  evaluatorHasAnyNonAuditRuntimeReference:\n    scriptRefs(runtimeRefs.evaluator).length > 0 ||\n    productionRefs(runtimeRefs.evaluator).length > 0,\n\n  summaryHasAnyNonAuditRuntimeReference:\n    scriptRefs(runtimeRefs.summary).length > 0 ||\n    productionRefs(runtimeRefs.summary).length > 0,\n\n  packageHasForwardOosScript:\n    /forward[-_:]?oos|true[-_:]?forward/i.test(packageText),\n\n  automationRouteMentionsForwardOos:\n    /forward[-_:]?oos|true[-_:]?forward/i.test(automationText),\n\n  schedulerSurfaceExists:\n    scheduleFiles.length > 0\n};\n\nconst hardRequired = [\n  \"collectorExists\",\n  \"evaluatorExists\",\n  \"summaryExists\",\n  \"automationRouteExists\",\n  \"schedulerSurfaceExists\"\n];\n\nconst hardFailures =\n  hardRequired.filter(key => checks[key] !== true);\n\nconst warnings = [];\n\nif (!checks.collectorReferencedByProductionRuntime) {\n  warnings.push(\"COLLECTOR_NOT_BOUND_TO_APP_OR_LIB_AUTOMATION_RUNTIME\");\n}\n\nif (!checks.evaluatorReferencedByProductionRuntime) {\n  warnings.push(\"EVALUATOR_NOT_BOUND_TO_APP_OR_LIB_AUTOMATION_RUNTIME\");\n}\n\nif (!checks.summaryReferencedByProductionRuntime) {\n  warnings.push(\"SUMMARY_NOT_BOUND_TO_APP_OR_LIB_AUTOMATION_RUNTIME\");\n}\n\nif (!checks.packageHasForwardOosScript) {\n  warnings.push(\"PACKAGE_FORWARD_OOS_SCRIPT_NOT_FOUND\");\n}\n\nif (!checks.automationRouteMentionsForwardOos) {\n  warnings.push(\"AUTOMATION_ROUTE_FORWARD_OOS_BINDING_NOT_FOUND\");\n}\n\nlet readiness;\nlet nextGate;\n\nif (hardFailures.length > 0) {\n  readiness = \"AUTOMATION_FOUNDATION_GAP\";\n  nextGate = \"FIX_AUTOMATION_FOUNDATION_BEFORE_BINDING\";\n} else if (warnings.length > 0) {\n  readiness = \"AUTOMATION_BINDING_MISSING_OR_PARTIAL\";\n  nextGate = \"DESIGN_FAIL_CLOSED_TRUE_FORWARD_OOS_AUTOMATION_BINDING_V1\";\n} else {\n  readiness = \"AUTOMATION_BINDING_PRESENT\";\n  nextGate = \"VERIFY_AUTOMATION_BINDING_RUNTIME_CONTRACT\";\n}\n\nconst report = {\n  status:\n    \"AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_BINDING_AUDIT_V1_COMPLETED\",\n\n  mode:\n    \"READ_ONLY_RUNTIME_BINDING_AUDIT\",\n\n  readiness,\n\n  targets: TARGETS,\n\n  references: {\n    collector: runtimeRefs.collector,\n    evaluator: runtimeRefs.evaluator,\n    summary: runtimeRefs.summary,\n    production: {\n      collector: productionRefs(runtimeRefs.collector),\n      evaluator: productionRefs(runtimeRefs.evaluator),\n      summary: productionRefs(runtimeRefs.summary)\n    },\n    nonAuditScriptRuntime: {\n      collector: scriptRefs(runtimeRefs.collector),\n      evaluator: scriptRefs(runtimeRefs.evaluator),\n      summary: scriptRefs(runtimeRefs.summary)\n    },\n    schedulerSurfaces:\n      scheduleFiles.slice(0, 80)\n  },\n\n  checks,\n\n  hardFailures,\n\n  warnings,\n\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    sourceFilesModified: 0,\n    collectorExecuted: false,\n    evaluatorExecuted: false,\n    summaryExecuted: false,\n    automationExecuted: false,\n    orderCreation: false,\n    positionChange: false,\n    promotionApplyExecuted: false,\n    controlsChange: false,\n    realTradingEnable: false\n  },\n\n  nextGate\n};\n\nfs.mkdirSync(LOGS, { recursive: true });\n\nfs.writeFileSync(\n  path.join(\n    LOGS,\n    \"true-forward-oos-automation-binding-audit-v1.json\"\n  ),\n  JSON.stringify(report, null, 2),\n  \"utf8\"\n);\n\nconsole.log(JSON.stringify(report, null, 2));\n\nprocess.exitCode =\n  hardFailures.length === 0 ? 0 : 1;\n";

try {
  new Function(
    "require",
    "__dirname",
    "__filename",
    "process",
    "console",
    auditSource
  );
} catch (error) {
  fail("GENERATED_AUDIT_SYNTAX_ERROR", {
    error:
      error instanceof Error
        ? error.message
        : String(error)
  });
}

fs.writeFileSync(TARGET, auditSource, "utf8");

let pkg;

try {
  pkg = JSON.parse(fs.readFileSync(PACKAGE, "utf8"));
} catch (error) {
  fail("PACKAGE_JSON_PARSE_FAILED", {
    error:
      error instanceof Error ? error.message : String(error)
  });
}

if (!pkg.scripts || typeof pkg.scripts !== "object") pkg.scripts = {};

pkg.scripts["test:true-forward-oos-automation-binding"] =
  "node ./scripts/true-forward-oos-automation-binding-audit-v1.cjs";

fs.writeFileSync(
  PACKAGE,
  JSON.stringify(pkg, null, 2) + "\n",
  "utf8"
);

console.log(JSON.stringify({
  status:
    "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_BINDING_AUDIT_V1_INSTALLED",
  generatedFile:
    "scripts/true-forward-oos-automation-binding-audit-v1.cjs",
  packageScript:
    "npm run test:true-forward-oos-automation-binding",
  backup:
    "scripts/backups/package.before-true-forward-oos-automation-binding-audit-v1.json",
  focus: [
    "COLLECTOR_RUNTIME_BINDING",
    "EVALUATOR_RUNTIME_BINDING",
    "SUMMARY_RUNTIME_BINDING",
    "AUTOMATION_ROUTE",
    "SCHEDULER_SURFACE",
    "PACKAGE_RUNTIME_SCRIPT"
  ],
  safety: {
    sourceProductCodeChanges: 0,
    databaseWrites: 0,
    automationExecuted: false,
    orderCreation: false,
    positionChange: false,
    promotionApply: false,
    realTradingEnable: false
  },
  nextAction:
    "RUN_TRUE_FORWARD_OOS_AUTOMATION_BINDING_AUDIT_V1"
}, null, 2));
