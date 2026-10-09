const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const LOGS = path.join(ROOT, "logs");

const TARGETS = {
  collector: "scripts/alpha-v3-true-entry-forward-oos-collector-v1.ts",
  evaluator: "scripts/alpha-v3-true-forward-oos-evaluator-v1.ts",
  summary: "scripts/alpha-v3-true-forward-oos-summary.ts",
  automationRun: "app/api/trading/automation/run/route.ts",
  automationCycle: "app/api/trading/automation/cycle/route.ts",
  scheduler: "scripts/alpha-v3-automation-cycle-scheduler.ts",
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

function lineNumberedMatches(text, regex, context = 3, max = 20) {
  const lines = text.split(/\r?\n/);
  const out = [];

  for (let i = 0; i < lines.length; i++) {
    regex.lastIndex = 0;
    if (!regex.test(lines[i])) continue;

    const start = Math.max(0, i - context);
    const end = Math.min(lines.length - 1, i + context);

    out.push({
      line: i + 1,
      snippet: lines.slice(start, end + 1).map((line, idx) => ({
        line: start + idx + 1,
        text: line
      }))
    });

    if (out.length >= max) break;
  }

  return out;
}

function exportsOf(text) {
  const names = new Set();

  const regexes = [
    /export\s+(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
    /export\s+const\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
    /export\s+let\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
    /export\s+class\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,
    /export\s*\{\s*([^}]+)\s*\}/g
  ];

  for (const rx of regexes) {
    let m;
    while ((m = rx.exec(text)) !== null) {
      if (rx === regexes[4]) {
        for (const part of m[1].split(",")) {
          const cleaned = part.trim().split(/\s+as\s+/i)[1] || part.trim().split(/\s+as\s+/i)[0];
          if (cleaned) names.add(cleaned.trim());
        }
      } else if (m[1]) {
        names.add(m[1]);
      }
    }
  }

  return [...names].sort();
}

function importsOf(text) {
  const out = [];
  const rx = /import\s+([\s\S]*?)\s+from\s+["'`]([^"'`]+)["'`]/g;
  let m;
  while ((m = rx.exec(text)) !== null) {
    out.push({
      clause: m[1].trim(),
      source: m[2]
    });
  }
  return out;
}

function topLevelExecutionSignals(text) {
  return {
    hasMainCall:
      /\bmain\s*\(\s*\)/.test(text),
    hasRunCall:
      /\brun\s*\(\s*\)/.test(text),
    hasProcessExit:
      /process\.exit|process\.exitCode/.test(text),
    hasArgv:
      /process\.argv/.test(text),
    hasWriteFile:
      /writeFileSync|writeFile\(/.test(text),
    hasReadFile:
      /readFileSync|readFile\(/.test(text),
    hasConsoleJson:
      /console\.log\s*\(\s*JSON\.stringify/.test(text),
    hasDirectAwaitAtTop:
      /(?:^|\n)\s*await\s+/m.test(text)
  };
}

function packageScripts() {
  try {
    const pkg = JSON.parse(read("package.json"));
    return pkg.scripts || {};
  } catch {
    return {};
  }
}

const sources = {};
const details = {};

for (const [key, rel] of Object.entries(TARGETS)) {
  const text = read(rel);
  sources[key] = text;

  details[key] = {
    file: rel,
    exists: exists(rel),
    exports: exportsOf(text),
    imports: importsOf(text).slice(0, 40),
    execution: topLevelExecutionSignals(text),
    relevantSnippets: {
      functions: lineNumberedMatches(
        text,
        /\b(function|async function|export|const .*=>|POST|GET)\b/,
        2,
        12
      ),
      automation: lineNumberedMatches(
        text,
        /automation|cycle|scheduler|fetch\(|route|stage|shadow|evaluate|summary|collector|15:40|1540/i,
        2,
        20
      ),
      safety: lineNumberedMatches(
        text,
        /real_order_enabled|realTrading|live|order|position|promotion|emergency_stop|paper_order_enabled/i,
        2,
        20
      )
    }
  };
}

const scripts = packageScripts();

const forwardPackageScripts = Object.fromEntries(
  Object.entries(scripts)
    .filter(([name, value]) =>
      /forward|oos/i.test(name) ||
      /true-forward|forward-oos|true-entry-forward/i.test(String(value))
    )
);

const automationPackageScripts = Object.fromEntries(
  Object.entries(scripts)
    .filter(([name, value]) =>
      /automation|scheduler|cycle/i.test(name) ||
      /automation|scheduler|cycle/i.test(String(value))
    )
);

const importable = {
  collector: details.collector.exports.length > 0,
  evaluator: details.evaluator.exports.length > 0,
  summary: details.summary.exports.length > 0
};

const automationSurfaces = {
  runRouteExists: details.automationRun.exists,
  cycleRouteExists: details.automationCycle.exists,
  schedulerExists: details.scheduler.exists,
  runRouteExports: details.automationRun.exports,
  cycleRouteExports: details.automationCycle.exports,
  schedulerExports: details.scheduler.exports
};

const risks = [];

for (const kind of ["collector", "evaluator", "summary"]) {
  const exec = details[kind].execution;

  if (!importable[kind]) {
    risks.push(`${kind.toUpperCase()}_HAS_NO_EXPORTED_RUNTIME_FUNCTION`);
  }

  if (exec.hasProcessExit) {
    risks.push(`${kind.toUpperCase()}_HAS_PROCESS_EXIT_BEHAVIOR`);
  }

  if (exec.hasMainCall || exec.hasRunCall || exec.hasDirectAwaitAtTop) {
    risks.push(`${kind.toUpperCase()}_MAY_EXECUTE_ON_IMPORT`);
  }
}

let recommendedStrategy;

if (
  importable.collector &&
  importable.evaluator &&
  importable.summary &&
  risks.every(x => !x.includes("EXECUTE_ON_IMPORT") && !x.includes("PROCESS_EXIT"))
) {
  recommendedStrategy =
    "DIRECT_LIB_WRAPPER_IMPORT_BINDING";
} else if (
  details.scheduler.exists &&
  Object.keys(forwardPackageScripts).length >= 2
) {
  recommendedStrategy =
    "SCHEDULER_SUBPROCESS_BINDING_WITH_FAIL_CLOSED_GUARDS";
} else {
  recommendedStrategy =
    "EXTRACT_SHARED_LIB_RUNTIME_FUNCTIONS_THEN_BIND_AUTOMATION";
}

const checks = {
  collectorExists: details.collector.exists,
  evaluatorExists: details.evaluator.exists,
  summaryExists: details.summary.exists,
  automationRunExists: details.automationRun.exists,
  automationCycleExists: details.automationCycle.exists,
  schedulerExists: details.scheduler.exists,
  forwardPackageScriptsFound: Object.keys(forwardPackageScripts).length > 0,
  automationPackageScriptsFound: Object.keys(automationPackageScripts).length > 0
};

const hardFailures = Object.entries(checks)
  .filter(([, value]) => value !== true)
  .map(([key]) => key);

const report = {
  status:
    "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_BINDING_DESIGN_PROBE_V1_COMPLETED",

  mode:
    "READ_ONLY_SOURCE_SURFACE_DESIGN_PROBE",

  recommendedStrategy,

  importable,

  automationSurfaces,

  packageScripts: {
    forwardOos: forwardPackageScripts,
    automation: automationPackageScripts
  },

  risks: [...new Set(risks)].sort(),

  checks,

  hardFailures,

  details,

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    sourceFilesModified: 0,
    automationExecuted: false,
    collectorExecuted: false,
    evaluatorExecuted: false,
    summaryExecuted: false,
    orderCreation: false,
    positionChange: false,
    promotionApplyExecuted: false,
    controlsChange: false,
    realTradingEnable: false
  },

  nextGate:
    hardFailures.length === 0
      ? "IMPLEMENT_FAIL_CLOSED_TRUE_FORWARD_OOS_AUTOMATION_BINDING_V1_USING_RECOMMENDED_STRATEGY"
      : "STOP_AND_FIX_MISSING_AUTOMATION_BINDING_SURFACES"
};

fs.mkdirSync(LOGS, { recursive: true });

fs.writeFileSync(
  path.join(
    LOGS,
    "true-forward-oos-automation-binding-design-probe-v1.json"
  ),
  JSON.stringify(report, null, 2),
  "utf8"
);

console.log(JSON.stringify(report, null, 2));

process.exitCode =
  hardFailures.length === 0 ? 0 : 1;
