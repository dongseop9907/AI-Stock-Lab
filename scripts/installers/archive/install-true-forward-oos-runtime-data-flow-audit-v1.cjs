const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const SCRIPTS = path.join(ROOT, "scripts");
const PACKAGE = path.join(ROOT, "package.json");
const BACKUPS = path.join(SCRIPTS, "backups");
const TARGET = path.join(
  SCRIPTS,
  "true-forward-oos-runtime-data-flow-audit-v1.cjs"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_RUNTIME_DATA_FLOW_AUDIT_V1_INSTALL_FAILED",
    reason,
    ...extra
  }, null, 2));
  process.exit(1);
}

if (!fs.existsSync(SCRIPTS)) {
  fail("SCRIPTS_DIRECTORY_NOT_FOUND");
}

if (!fs.existsSync(PACKAGE)) {
  fail("PACKAGE_JSON_NOT_FOUND");
}

fs.mkdirSync(BACKUPS, { recursive: true });

const packageBackup = path.join(
  BACKUPS,
  "package.before-true-forward-oos-runtime-data-flow-audit-v1.json"
);

if (!fs.existsSync(packageBackup)) {
  fs.copyFileSync(PACKAGE, packageBackup);
}

const auditSource = "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst ROOT = process.cwd();\nconst LOGS = path.join(ROOT, \"logs\");\n\nfunction exists(rel) {\n  return fs.existsSync(path.join(ROOT, rel));\n}\n\nfunction read(rel) {\n  const full = path.join(ROOT, rel);\n  if (!fs.existsSync(full)) return \"\";\n  try {\n    return fs.readFileSync(full, \"utf8\");\n  } catch {\n    return \"\";\n  }\n}\n\nfunction walk(dir, out = []) {\n  if (!fs.existsSync(dir)) return out;\n\n  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {\n    if (\n      entry.name === \"node_modules\" ||\n      entry.name === \".next\" ||\n      entry.name === \".git\" ||\n      entry.name === \"backups\"\n    ) {\n      continue;\n    }\n\n    const full = path.join(dir, entry.name);\n\n    if (entry.isDirectory()) {\n      walk(full, out);\n    } else if (/\\.(ts|tsx|js|cjs|mjs|sql)$/.test(entry.name)) {\n      out.push(full);\n    }\n  }\n\n  return out;\n}\n\nfunction rel(full) {\n  return path.relative(ROOT, full).replace(/\\\\/g, \"/\");\n}\n\nfunction safeRead(full) {\n  try {\n    return fs.readFileSync(full, \"utf8\");\n  } catch {\n    return \"\";\n  }\n}\n\nfunction findRefs(pattern, roots) {\n  const hits = [];\n\n  for (const root of roots) {\n    const fullRoot = path.join(ROOT, root);\n    const files = walk(fullRoot);\n\n    for (const file of files) {\n      const relative = rel(file);\n\n      if (\n        relative.startsWith(\"scripts/install-\") ||\n        relative.includes(\"/backups/\") ||\n        relative.endsWith(\"true-forward-oos-runtime-data-flow-audit-v1.cjs\")\n      ) {\n        continue;\n      }\n\n      const text = safeRead(file);\n      if (!text) continue;\n\n      if (pattern.test(text)) {\n        hits.push(relative);\n      }\n    }\n  }\n\n  return [...new Set(hits)].sort();\n}\n\nfunction extractSupabaseTables(text) {\n  const tables = new Set();\n\n  const patterns = [\n    /\\.from\\(\\s*[\"'`]([^\"'`]+)[\"'`]\\s*\\)/g,\n    /\\bfrom\\s+([a-zA-Z0-9_\\.]+)/gi,\n    /\\binsert\\s+into\\s+([a-zA-Z0-9_\\.]+)/gi,\n    /\\bupdate\\s+([a-zA-Z0-9_\\.]+)/gi\n  ];\n\n  for (const rx of patterns) {\n    let m;\n    while ((m = rx.exec(text)) !== null) {\n      if (m[1]) tables.add(m[1]);\n    }\n  }\n\n  return [...tables].sort();\n}\n\nfunction keywordFlags(text) {\n  return {\n    cutoff:\n      /\\bcutoff\\b|\\bas[\\s_-]*of\\b|\\bcaptured_at\\b|\\bobserved_at\\b/i.test(text),\n    frozen:\n      /\\bfrozen\\b|\\bfreeze\\b|\\bsnapshot\\b/i.test(text),\n    leakage:\n      /\\bleak(age)?\\b|\\blookahead\\b|\\bfuture[\\s_-]*data\\b/i.test(text),\n    dbWrite:\n      /\\.insert\\(|\\.upsert\\(|\\.update\\(|\\.delete\\(/.test(text),\n    dbRead:\n      /\\.select\\(|\\.from\\(/.test(text),\n    evaluator:\n      /\\bevaluat(e|or|ion)\\b/i.test(text),\n    returns:\n      /\\breturn(1d|3d|5d|_1d|_3d|_5d)\\b|\\bpnl\\b|\\bprofit\\b|\\bdrawdown\\b|\\bexpectancy\\b/i.test(text),\n    schedule:\n      /\\bcron\\b|\\bschedule\\b|\\bscheduler\\b|\\bautomation\\b/i.test(text)\n  };\n}\n\nconst candidates = {\n  collector: [\n    \"scripts/alpha-v3-true-entry-forward-oos-collector-v1.ts\",\n    \"scripts/alpha-v3-true-forward-oos-collector-v1.ts\"\n  ],\n  evaluator: [\n    \"scripts/alpha-v3-true-forward-oos-evaluator-v1.ts\"\n  ],\n  summary: [\n    \"scripts/alpha-v3-true-forward-oos-summary.ts\"\n  ],\n  contract: [\n    \"scripts/alpha-v3-true-forward-oos-pipeline-v1-contract-test.ts\"\n  ],\n  staticVerify: [\n    \"scripts/alpha-v3-true-forward-oos-pipeline-v1-static-verify.cjs\"\n  ],\n  postCaptureIntegrity: [\n    \"scripts/alpha-v3-forward-oos-post-capture-integrity-audit-v1.cjs\"\n  ]\n};\n\nconst resolved = {};\n\nfor (const [kind, list] of Object.entries(candidates)) {\n  resolved[kind] = list.filter(exists);\n}\n\nconst sourceDetails = {};\n\nfor (const [kind, list] of Object.entries(resolved)) {\n  sourceDetails[kind] = list.map((file) => {\n    const text = read(file);\n\n    return {\n      file,\n      flags: keywordFlags(text),\n      referencedTables: extractSupabaseTables(text)\n    };\n  });\n}\n\nconst allRuntimeTexts = Object.values(resolved)\n  .flat()\n  .map(read)\n  .join(\"\\n\");\n\nconst runtimeTables = extractSupabaseTables(allRuntimeTexts);\n\nconst runtimeNamePattern =\n  /alpha-v3-true-forward-oos|alpha-v3-true-entry-forward-oos|true-forward-oos/i;\n\nconst appLibAutomationRefs = findRefs(\n  runtimeNamePattern,\n  [\"app\", \"lib\"]\n);\n\nconst scriptRuntimeRefs = findRefs(\n  runtimeNamePattern,\n  [\"scripts\"]\n).filter(\n  (file) =>\n    !file.startsWith(\"scripts/install-\") &&\n    !file.includes(\"readiness-audit\") &&\n    !file.includes(\"runtime-data-flow-audit\")\n);\n\nconst migrationsWithRuntimeTerms = findRefs(\n  /true[\\s_-]*forward|forward[\\s_-]*oos|oos/i,\n  [\"supabase/migrations\", \"migrations\"]\n);\n\nconst collectorFiles = resolved.collector;\nconst evaluatorFiles = resolved.evaluator;\nconst summaryFiles = resolved.summary;\n\nconst collectorText = collectorFiles.map(read).join(\"\\n\");\nconst evaluatorText = evaluatorFiles.map(read).join(\"\\n\");\nconst summaryText = summaryFiles.map(read).join(\"\\n\");\n\nconst checks = {\n  collectorExists:\n    collectorFiles.length > 0,\n\n  evaluatorExists:\n    evaluatorFiles.length > 0,\n\n  summaryExists:\n    summaryFiles.length > 0,\n\n  contractTestExists:\n    resolved.contract.length > 0,\n\n  staticVerifyExists:\n    resolved.staticVerify.length > 0,\n\n  postCaptureIntegrityAuditExists:\n    resolved.postCaptureIntegrity.length > 0,\n\n  collectorHasPersistenceSurface:\n    keywordFlags(collectorText).dbWrite,\n\n  collectorHasCutoffOrObservationTime:\n    keywordFlags(collectorText).cutoff,\n\n  collectorHasFrozenOrSnapshotSemantics:\n    keywordFlags(collectorText).frozen,\n\n  evaluatorHasReadSurface:\n    keywordFlags(evaluatorText).dbRead,\n\n  evaluatorHasEvaluationSemantics:\n    keywordFlags(evaluatorText).evaluator,\n\n  evaluatorHasPerformanceOutcomeTerms:\n    keywordFlags(evaluatorText).returns,\n\n  summaryHasReadOrPerformanceTerms:\n    keywordFlags(summaryText).dbRead ||\n    keywordFlags(summaryText).returns,\n\n  runtimeTablesDetected:\n    runtimeTables.length > 0,\n\n  appLibAutomationBindingFound:\n    appLibAutomationRefs.length > 0,\n\n  runtimeScriptCrossReferencesFound:\n    scriptRuntimeRefs.length > 0\n};\n\nconst hardRequired = [\n  \"collectorExists\",\n  \"evaluatorExists\",\n  \"summaryExists\",\n  \"collectorHasPersistenceSurface\",\n  \"collectorHasCutoffOrObservationTime\",\n  \"evaluatorHasReadSurface\",\n  \"evaluatorHasEvaluationSemantics\",\n  \"runtimeTablesDetected\"\n];\n\nconst hardFailures = hardRequired.filter(\n  (key) => checks[key] !== true\n);\n\nconst warnings = [];\n\nif (!checks.collectorHasFrozenOrSnapshotSemantics) {\n  warnings.push(\"COLLECTOR_FROZEN_OR_SNAPSHOT_SEMANTICS_NOT_OBVIOUS\");\n}\n\nif (!checks.evaluatorHasPerformanceOutcomeTerms) {\n  warnings.push(\"EVALUATOR_PERFORMANCE_OUTCOME_TERMS_NOT_OBVIOUS\");\n}\n\nif (!checks.appLibAutomationBindingFound) {\n  warnings.push(\"NO_APP_LIB_AUTOMATION_BINDING_FOUND\");\n}\n\nif (!checks.postCaptureIntegrityAuditExists) {\n  warnings.push(\"POST_CAPTURE_INTEGRITY_AUDIT_NOT_FOUND\");\n}\n\nlet readiness;\nlet nextGate;\n\nif (hardFailures.length > 0) {\n  readiness = \"RUNTIME_GAP\";\n  nextGate = \"INSPECT_TRUE_FORWARD_OOS_RUNTIME_GAPS_BEFORE_PATCHING\";\n} else if (warnings.length > 0) {\n  readiness = \"RUNTIME_PATH_PRESENT_WITH_GAPS\";\n  nextGate = \"HARDEN_TRUE_FORWARD_OOS_RUNTIME_BINDING_AND_INTEGRITY\";\n} else {\n  readiness = \"RUNTIME_PATH_STRONGLY_CONNECTED\";\n  nextGate = \"RUN_EXISTING_TRUE_FORWARD_OOS_CONTRACT_AND_STATIC_VERIFIERS\";\n}\n\nconst report = {\n  status:\n    \"AI_STOCK_LAB_TRUE_FORWARD_OOS_RUNTIME_DATA_FLOW_AUDIT_V1_COMPLETED\",\n\n  mode:\n    \"READ_ONLY_TARGETED_RUNTIME_SOURCE_AUDIT\",\n\n  readiness,\n\n  resolvedFiles:\n    resolved,\n\n  sourceDetails,\n\n  runtimePersistence: {\n    detectedTables:\n      runtimeTables,\n    migrationsWithRuntimeTerms:\n      migrationsWithRuntimeTerms.slice(0, 40)\n  },\n\n  bindings: {\n    appLibAutomationRefs,\n    scriptRuntimeRefs:\n      scriptRuntimeRefs.slice(0, 60)\n  },\n\n  checks,\n\n  hardFailures,\n\n  warnings,\n\n  interpretation: {\n    runtimeGap:\n      \"A required Collector/Evaluator/Persistence runtime element is not obvious from source.\",\n    runtimePathPresentWithGaps:\n      \"Core runtime path exists, but one or more automation/integrity/frozen-evidence bindings need hardening or explicit verification.\",\n    runtimePathStronglyConnected:\n      \"Collector, persistence, evaluator, summary, integrity and automation/runtime binding surfaces are all visible.\"\n  },\n\n  safety: {\n    databaseReads:\n      0,\n    databaseWrites:\n      0,\n    sourceFilesModified:\n      0,\n    collectorExecuted:\n      false,\n    evaluatorExecuted:\n      false,\n    syntheticForwardDataCreated:\n      false,\n    orderCreation:\n      false,\n    positionChange:\n      false,\n    promotionApplyExecuted:\n      false,\n    controlsChange:\n      false,\n    realTradingEnable:\n      false\n  },\n\n  nextGate\n};\n\nfs.mkdirSync(LOGS, { recursive: true });\n\nfs.writeFileSync(\n  path.join(\n    LOGS,\n    \"true-forward-oos-runtime-data-flow-audit-v1.json\"\n  ),\n  JSON.stringify(report, null, 2),\n  \"utf8\"\n);\n\nconsole.log(JSON.stringify(report, null, 2));\n\nprocess.exitCode =\n  hardFailures.length === 0\n    ? 0\n    : 1;\n";

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

fs.writeFileSync(
  TARGET,
  auditSource,
  "utf8"
);

let pkg;

try {
  pkg = JSON.parse(
    fs.readFileSync(PACKAGE, "utf8")
  );
} catch (error) {
  fail("PACKAGE_JSON_PARSE_FAILED", {
    error:
      error instanceof Error
        ? error.message
        : String(error)
  });
}

if (!pkg.scripts || typeof pkg.scripts !== "object") {
  pkg.scripts = {};
}

pkg.scripts["test:true-forward-oos-runtime"] =
  "node ./scripts/true-forward-oos-runtime-data-flow-audit-v1.cjs";

fs.writeFileSync(
  PACKAGE,
  JSON.stringify(pkg, null, 2) + "\n",
  "utf8"
);

console.log(JSON.stringify({
  status:
    "AI_STOCK_LAB_TRUE_FORWARD_OOS_RUNTIME_DATA_FLOW_AUDIT_V1_INSTALLED",

  generatedFile:
    "scripts/true-forward-oos-runtime-data-flow-audit-v1.cjs",

  packageScript:
    "npm run test:true-forward-oos-runtime",

  backup:
    "scripts/backups/package.before-true-forward-oos-runtime-data-flow-audit-v1.json",

  focus: [
    "COLLECTOR",
    "PERSISTENCE",
    "CUTOFF_OBSERVATION_TIME",
    "FROZEN_SNAPSHOT",
    "EVALUATOR",
    "SUMMARY",
    "POST_CAPTURE_INTEGRITY",
    "AUTOMATION_RUNTIME_BINDING"
  ],

  safety: {
    databaseReads:
      0,
    databaseWrites:
      0,
    runtimeCollectorExecuted:
      false,
    runtimeEvaluatorExecuted:
      false,
    orderCreation:
      false,
    positionChange:
      false,
    realTradingEnable:
      false
  },

  nextAction:
    "RUN_TRUE_FORWARD_OOS_RUNTIME_DATA_FLOW_AUDIT"
}, null, 2));
