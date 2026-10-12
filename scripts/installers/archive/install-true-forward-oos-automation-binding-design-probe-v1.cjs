const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const SCRIPTS = path.join(ROOT, "scripts");
const PACKAGE = path.join(ROOT, "package.json");
const BACKUPS = path.join(SCRIPTS, "backups");

const TARGET = path.join(
  SCRIPTS,
  "true-forward-oos-automation-binding-design-probe-v1.cjs"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_BINDING_DESIGN_PROBE_V1_INSTALL_FAILED",
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
  "app/api/trading/automation/run/route.ts",
  "app/api/trading/automation/cycle/route.ts",
  "scripts/alpha-v3-automation-cycle-scheduler.ts"
];

const missing = required.filter(
  rel => !fs.existsSync(path.join(ROOT, rel))
);

if (missing.length > 0) {
  fail("REQUIRED_BINDING_SURFACES_MISSING", { missing });
}

fs.mkdirSync(BACKUPS, { recursive: true });

const packageBackup = path.join(
  BACKUPS,
  "package.before-true-forward-oos-automation-binding-design-probe-v1.json"
);

if (!fs.existsSync(packageBackup)) {
  fs.copyFileSync(PACKAGE, packageBackup);
}

const probeSource = "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst ROOT = process.cwd();\nconst LOGS = path.join(ROOT, \"logs\");\n\nconst TARGETS = {\n  collector: \"scripts/alpha-v3-true-entry-forward-oos-collector-v1.ts\",\n  evaluator: \"scripts/alpha-v3-true-forward-oos-evaluator-v1.ts\",\n  summary: \"scripts/alpha-v3-true-forward-oos-summary.ts\",\n  automationRun: \"app/api/trading/automation/run/route.ts\",\n  automationCycle: \"app/api/trading/automation/cycle/route.ts\",\n  scheduler: \"scripts/alpha-v3-automation-cycle-scheduler.ts\",\n  packageJson: \"package.json\"\n};\n\nfunction exists(rel) {\n  return fs.existsSync(path.join(ROOT, rel));\n}\n\nfunction read(rel) {\n  try {\n    return fs.readFileSync(path.join(ROOT, rel), \"utf8\");\n  } catch {\n    return \"\";\n  }\n}\n\nfunction lineNumberedMatches(text, regex, context = 3, max = 20) {\n  const lines = text.split(/\\r?\\n/);\n  const out = [];\n\n  for (let i = 0; i < lines.length; i++) {\n    regex.lastIndex = 0;\n    if (!regex.test(lines[i])) continue;\n\n    const start = Math.max(0, i - context);\n    const end = Math.min(lines.length - 1, i + context);\n\n    out.push({\n      line: i + 1,\n      snippet: lines.slice(start, end + 1).map((line, idx) => ({\n        line: start + idx + 1,\n        text: line\n      }))\n    });\n\n    if (out.length >= max) break;\n  }\n\n  return out;\n}\n\nfunction exportsOf(text) {\n  const names = new Set();\n\n  const regexes = [\n    /export\\s+(?:async\\s+)?function\\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,\n    /export\\s+const\\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,\n    /export\\s+let\\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,\n    /export\\s+class\\s+([A-Za-z_$][A-Za-z0-9_$]*)/g,\n    /export\\s*\\{\\s*([^}]+)\\s*\\}/g\n  ];\n\n  for (const rx of regexes) {\n    let m;\n    while ((m = rx.exec(text)) !== null) {\n      if (rx === regexes[4]) {\n        for (const part of m[1].split(\",\")) {\n          const cleaned = part.trim().split(/\\s+as\\s+/i)[1] || part.trim().split(/\\s+as\\s+/i)[0];\n          if (cleaned) names.add(cleaned.trim());\n        }\n      } else if (m[1]) {\n        names.add(m[1]);\n      }\n    }\n  }\n\n  return [...names].sort();\n}\n\nfunction importsOf(text) {\n  const out = [];\n  const rx = /import\\s+([\\s\\S]*?)\\s+from\\s+[\"'`]([^\"'`]+)[\"'`]/g;\n  let m;\n  while ((m = rx.exec(text)) !== null) {\n    out.push({\n      clause: m[1].trim(),\n      source: m[2]\n    });\n  }\n  return out;\n}\n\nfunction topLevelExecutionSignals(text) {\n  return {\n    hasMainCall:\n      /\\bmain\\s*\\(\\s*\\)/.test(text),\n    hasRunCall:\n      /\\brun\\s*\\(\\s*\\)/.test(text),\n    hasProcessExit:\n      /process\\.exit|process\\.exitCode/.test(text),\n    hasArgv:\n      /process\\.argv/.test(text),\n    hasWriteFile:\n      /writeFileSync|writeFile\\(/.test(text),\n    hasReadFile:\n      /readFileSync|readFile\\(/.test(text),\n    hasConsoleJson:\n      /console\\.log\\s*\\(\\s*JSON\\.stringify/.test(text),\n    hasDirectAwaitAtTop:\n      /(?:^|\\n)\\s*await\\s+/m.test(text)\n  };\n}\n\nfunction packageScripts() {\n  try {\n    const pkg = JSON.parse(read(\"package.json\"));\n    return pkg.scripts || {};\n  } catch {\n    return {};\n  }\n}\n\nconst sources = {};\nconst details = {};\n\nfor (const [key, rel] of Object.entries(TARGETS)) {\n  const text = read(rel);\n  sources[key] = text;\n\n  details[key] = {\n    file: rel,\n    exists: exists(rel),\n    exports: exportsOf(text),\n    imports: importsOf(text).slice(0, 40),\n    execution: topLevelExecutionSignals(text),\n    relevantSnippets: {\n      functions: lineNumberedMatches(\n        text,\n        /\\b(function|async function|export|const .*=>|POST|GET)\\b/,\n        2,\n        12\n      ),\n      automation: lineNumberedMatches(\n        text,\n        /automation|cycle|scheduler|fetch\\(|route|stage|shadow|evaluate|summary|collector|15:40|1540/i,\n        2,\n        20\n      ),\n      safety: lineNumberedMatches(\n        text,\n        /real_order_enabled|realTrading|live|order|position|promotion|emergency_stop|paper_order_enabled/i,\n        2,\n        20\n      )\n    }\n  };\n}\n\nconst scripts = packageScripts();\n\nconst forwardPackageScripts = Object.fromEntries(\n  Object.entries(scripts)\n    .filter(([name, value]) =>\n      /forward|oos/i.test(name) ||\n      /true-forward|forward-oos|true-entry-forward/i.test(String(value))\n    )\n);\n\nconst automationPackageScripts = Object.fromEntries(\n  Object.entries(scripts)\n    .filter(([name, value]) =>\n      /automation|scheduler|cycle/i.test(name) ||\n      /automation|scheduler|cycle/i.test(String(value))\n    )\n);\n\nconst importable = {\n  collector: details.collector.exports.length > 0,\n  evaluator: details.evaluator.exports.length > 0,\n  summary: details.summary.exports.length > 0\n};\n\nconst automationSurfaces = {\n  runRouteExists: details.automationRun.exists,\n  cycleRouteExists: details.automationCycle.exists,\n  schedulerExists: details.scheduler.exists,\n  runRouteExports: details.automationRun.exports,\n  cycleRouteExports: details.automationCycle.exports,\n  schedulerExports: details.scheduler.exports\n};\n\nconst risks = [];\n\nfor (const kind of [\"collector\", \"evaluator\", \"summary\"]) {\n  const exec = details[kind].execution;\n\n  if (!importable[kind]) {\n    risks.push(`${kind.toUpperCase()}_HAS_NO_EXPORTED_RUNTIME_FUNCTION`);\n  }\n\n  if (exec.hasProcessExit) {\n    risks.push(`${kind.toUpperCase()}_HAS_PROCESS_EXIT_BEHAVIOR`);\n  }\n\n  if (exec.hasMainCall || exec.hasRunCall || exec.hasDirectAwaitAtTop) {\n    risks.push(`${kind.toUpperCase()}_MAY_EXECUTE_ON_IMPORT`);\n  }\n}\n\nlet recommendedStrategy;\n\nif (\n  importable.collector &&\n  importable.evaluator &&\n  importable.summary &&\n  risks.every(x => !x.includes(\"EXECUTE_ON_IMPORT\") && !x.includes(\"PROCESS_EXIT\"))\n) {\n  recommendedStrategy =\n    \"DIRECT_LIB_WRAPPER_IMPORT_BINDING\";\n} else if (\n  details.scheduler.exists &&\n  Object.keys(forwardPackageScripts).length >= 2\n) {\n  recommendedStrategy =\n    \"SCHEDULER_SUBPROCESS_BINDING_WITH_FAIL_CLOSED_GUARDS\";\n} else {\n  recommendedStrategy =\n    \"EXTRACT_SHARED_LIB_RUNTIME_FUNCTIONS_THEN_BIND_AUTOMATION\";\n}\n\nconst checks = {\n  collectorExists: details.collector.exists,\n  evaluatorExists: details.evaluator.exists,\n  summaryExists: details.summary.exists,\n  automationRunExists: details.automationRun.exists,\n  automationCycleExists: details.automationCycle.exists,\n  schedulerExists: details.scheduler.exists,\n  forwardPackageScriptsFound: Object.keys(forwardPackageScripts).length > 0,\n  automationPackageScriptsFound: Object.keys(automationPackageScripts).length > 0\n};\n\nconst hardFailures = Object.entries(checks)\n  .filter(([, value]) => value !== true)\n  .map(([key]) => key);\n\nconst report = {\n  status:\n    \"AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_BINDING_DESIGN_PROBE_V1_COMPLETED\",\n\n  mode:\n    \"READ_ONLY_SOURCE_SURFACE_DESIGN_PROBE\",\n\n  recommendedStrategy,\n\n  importable,\n\n  automationSurfaces,\n\n  packageScripts: {\n    forwardOos: forwardPackageScripts,\n    automation: automationPackageScripts\n  },\n\n  risks: [...new Set(risks)].sort(),\n\n  checks,\n\n  hardFailures,\n\n  details,\n\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    sourceFilesModified: 0,\n    automationExecuted: false,\n    collectorExecuted: false,\n    evaluatorExecuted: false,\n    summaryExecuted: false,\n    orderCreation: false,\n    positionChange: false,\n    promotionApplyExecuted: false,\n    controlsChange: false,\n    realTradingEnable: false\n  },\n\n  nextGate:\n    hardFailures.length === 0\n      ? \"IMPLEMENT_FAIL_CLOSED_TRUE_FORWARD_OOS_AUTOMATION_BINDING_V1_USING_RECOMMENDED_STRATEGY\"\n      : \"STOP_AND_FIX_MISSING_AUTOMATION_BINDING_SURFACES\"\n};\n\nfs.mkdirSync(LOGS, { recursive: true });\n\nfs.writeFileSync(\n  path.join(\n    LOGS,\n    \"true-forward-oos-automation-binding-design-probe-v1.json\"\n  ),\n  JSON.stringify(report, null, 2),\n  \"utf8\"\n);\n\nconsole.log(JSON.stringify(report, null, 2));\n\nprocess.exitCode =\n  hardFailures.length === 0 ? 0 : 1;\n";

try {
  new Function(
    "require",
    "__dirname",
    "__filename",
    "process",
    "console",
    probeSource
  );
} catch (error) {
  fail("GENERATED_PROBE_SYNTAX_ERROR", {
    error:
      error instanceof Error
        ? error.message
        : String(error)
  });
}

fs.writeFileSync(TARGET, probeSource, "utf8");

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

pkg.scripts["test:true-forward-oos-binding-design"] =
  "node ./scripts/true-forward-oos-automation-binding-design-probe-v1.cjs";

fs.writeFileSync(
  PACKAGE,
  JSON.stringify(pkg, null, 2) + "\n",
  "utf8"
);

console.log(JSON.stringify({
  status:
    "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_BINDING_DESIGN_PROBE_V1_INSTALLED",

  generatedFile:
    "scripts/true-forward-oos-automation-binding-design-probe-v1.cjs",

  packageScript:
    "npm run test:true-forward-oos-binding-design",

  backup:
    "scripts/backups/package.before-true-forward-oos-automation-binding-design-probe-v1.json",

  inspects: [
    "collector/evaluator/summary exports",
    "top-level execution-on-import risk",
    "automation run route",
    "automation cycle route",
    "scheduler",
    "package runtime scripts",
    "order/live/promotion safety references"
  ],

  safety: {
    productSourceChanges: 0,
    databaseWrites: 0,
    automationExecuted: false,
    orderCreation: false,
    positionChange: false,
    promotionApply: false,
    realTradingEnable: false
  },

  nextAction:
    "RUN_AUTOMATION_BINDING_DESIGN_PROBE"
}, null, 2));
