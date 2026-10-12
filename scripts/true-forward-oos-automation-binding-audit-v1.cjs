const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const LOGS = path.join(ROOT, "logs");

const TARGETS = {
  collector: "scripts/alpha-v3-true-entry-forward-oos-collector-v1.ts",
  evaluator: "scripts/alpha-v3-true-forward-oos-evaluator-v1.ts",
  summary: "scripts/alpha-v3-true-forward-oos-summary.ts",
  automationRoute: "app/api/trading/automation/run/route.ts",
  packageJson: "package.json"
};

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function read(rel) {
  try {
    return fs.readFileSync(path.join(ROOT, rel), "utf8");
  } catch {
    return "";
  }
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.name === "node_modules" ||
      entry.name === ".next" ||
      entry.name === ".git" ||
      entry.name === "backups"
    ) continue;

    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx|js|cjs|mjs|json)$/.test(entry.name)) {
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

function findRefs(tokens, roots) {
  const hits = [];

  for (const root of roots) {
    const fullRoot = path.join(ROOT, root);
    if (!fs.existsSync(fullRoot)) continue;

    const files = fs.statSync(fullRoot).isDirectory()
      ? walk(fullRoot)
      : [fullRoot];

    for (const file of files) {
      const relative = rel(file);

      if (
        relative.startsWith("scripts/install-") ||
        relative.includes("automation-binding-audit-v1") ||
        relative.includes("runtime-data-flow-audit-v1") ||
        relative.includes("runtime-dependency-audit-v2") ||
        relative.includes("existing-contract-verify-v1")
      ) {
        continue;
      }

      const text = safeRead(file);

      const matched = tokens.filter(token => text.includes(token));

      if (matched.length > 0) {
        hits.push({
          file: relative,
          matched
        });
      }
    }
  }

  return hits;
}

const basenames = {
  collector: path.basename(TARGETS.collector).replace(/\.ts$/, ""),
  evaluator: path.basename(TARGETS.evaluator).replace(/\.ts$/, ""),
  summary: path.basename(TARGETS.summary).replace(/\.ts$/, "")
};

const runtimeRefs = {
  collector: findRefs(
    [basenames.collector, TARGETS.collector],
    ["app", "lib", "scripts", "package.json"]
  ),
  evaluator: findRefs(
    [basenames.evaluator, TARGETS.evaluator],
    ["app", "lib", "scripts", "package.json"]
  ),
  summary: findRefs(
    [basenames.summary, TARGETS.summary],
    ["app", "lib", "scripts", "package.json"]
  )
};

const automationText = read(TARGETS.automationRoute);
const packageText = read(TARGETS.packageJson);

const scheduleFiles = findRefs(
  [
    "cron",
    "schedule",
    "scheduler",
    "automation",
    "15:40",
    "1540"
  ],
  ["app", "lib", "scripts", "package.json"]
);

const productionRefs = (refs) =>
  refs.filter(item =>
    item.file.startsWith("app/") ||
    item.file.startsWith("lib/")
  );

const scriptRefs = (refs) =>
  refs.filter(item =>
    item.file.startsWith("scripts/") &&
    !item.file.includes("contract-test") &&
    !item.file.includes("static-verify") &&
    !item.file.includes("probe") &&
    !item.file.includes("audit")
  );

const checks = {
  collectorExists:
    exists(TARGETS.collector),

  evaluatorExists:
    exists(TARGETS.evaluator),

  summaryExists:
    exists(TARGETS.summary),

  automationRouteExists:
    exists(TARGETS.automationRoute),

  collectorReferencedByProductionRuntime:
    productionRefs(runtimeRefs.collector).length > 0,

  evaluatorReferencedByProductionRuntime:
    productionRefs(runtimeRefs.evaluator).length > 0,

  summaryReferencedByProductionRuntime:
    productionRefs(runtimeRefs.summary).length > 0,

  collectorHasAnyNonAuditRuntimeReference:
    scriptRefs(runtimeRefs.collector).length > 0 ||
    productionRefs(runtimeRefs.collector).length > 0,

  evaluatorHasAnyNonAuditRuntimeReference:
    scriptRefs(runtimeRefs.evaluator).length > 0 ||
    productionRefs(runtimeRefs.evaluator).length > 0,

  summaryHasAnyNonAuditRuntimeReference:
    scriptRefs(runtimeRefs.summary).length > 0 ||
    productionRefs(runtimeRefs.summary).length > 0,

  packageHasForwardOosScript:
    /forward[-_:]?oos|true[-_:]?forward/i.test(packageText),

  automationRouteMentionsForwardOos:
    /forward[-_:]?oos|true[-_:]?forward/i.test(automationText),

  schedulerSurfaceExists:
    scheduleFiles.length > 0
};

const hardRequired = [
  "collectorExists",
  "evaluatorExists",
  "summaryExists",
  "automationRouteExists",
  "schedulerSurfaceExists"
];

const hardFailures =
  hardRequired.filter(key => checks[key] !== true);

const warnings = [];

if (!checks.collectorReferencedByProductionRuntime) {
  warnings.push("COLLECTOR_NOT_BOUND_TO_APP_OR_LIB_AUTOMATION_RUNTIME");
}

if (!checks.evaluatorReferencedByProductionRuntime) {
  warnings.push("EVALUATOR_NOT_BOUND_TO_APP_OR_LIB_AUTOMATION_RUNTIME");
}

if (!checks.summaryReferencedByProductionRuntime) {
  warnings.push("SUMMARY_NOT_BOUND_TO_APP_OR_LIB_AUTOMATION_RUNTIME");
}

if (!checks.packageHasForwardOosScript) {
  warnings.push("PACKAGE_FORWARD_OOS_SCRIPT_NOT_FOUND");
}

if (!checks.automationRouteMentionsForwardOos) {
  warnings.push("AUTOMATION_ROUTE_FORWARD_OOS_BINDING_NOT_FOUND");
}

let readiness;
let nextGate;

if (hardFailures.length > 0) {
  readiness = "AUTOMATION_FOUNDATION_GAP";
  nextGate = "FIX_AUTOMATION_FOUNDATION_BEFORE_BINDING";
} else if (warnings.length > 0) {
  readiness = "AUTOMATION_BINDING_MISSING_OR_PARTIAL";
  nextGate = "DESIGN_FAIL_CLOSED_TRUE_FORWARD_OOS_AUTOMATION_BINDING_V1";
} else {
  readiness = "AUTOMATION_BINDING_PRESENT";
  nextGate = "VERIFY_AUTOMATION_BINDING_RUNTIME_CONTRACT";
}

const report = {
  status:
    "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_BINDING_AUDIT_V1_COMPLETED",

  mode:
    "READ_ONLY_RUNTIME_BINDING_AUDIT",

  readiness,

  targets: TARGETS,

  references: {
    collector: runtimeRefs.collector,
    evaluator: runtimeRefs.evaluator,
    summary: runtimeRefs.summary,
    production: {
      collector: productionRefs(runtimeRefs.collector),
      evaluator: productionRefs(runtimeRefs.evaluator),
      summary: productionRefs(runtimeRefs.summary)
    },
    nonAuditScriptRuntime: {
      collector: scriptRefs(runtimeRefs.collector),
      evaluator: scriptRefs(runtimeRefs.evaluator),
      summary: scriptRefs(runtimeRefs.summary)
    },
    schedulerSurfaces:
      scheduleFiles.slice(0, 80)
  },

  checks,

  hardFailures,

  warnings,

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    sourceFilesModified: 0,
    collectorExecuted: false,
    evaluatorExecuted: false,
    summaryExecuted: false,
    automationExecuted: false,
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
  path.join(
    LOGS,
    "true-forward-oos-automation-binding-audit-v1.json"
  ),
  JSON.stringify(report, null, 2),
  "utf8"
);

console.log(JSON.stringify(report, null, 2));

process.exitCode =
  hardFailures.length === 0 ? 0 : 1;
