const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const SCRIPTS = path.join(ROOT, "scripts");
const PACKAGE = path.join(ROOT, "package.json");
const BACKUPS = path.join(SCRIPTS, "backups");

const TARGET = path.join(
  SCRIPTS,
  "true-forward-oos-runtime-dependency-audit-v2.cjs"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_RUNTIME_DEPENDENCY_AUDIT_V2_INSTALL_FAILED",
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
  "package.before-true-forward-oos-runtime-dependency-audit-v2.json"
);

if (!fs.existsSync(packageBackup)) {
  fs.copyFileSync(PACKAGE, packageBackup);
}

const auditSource = "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst ROOT = process.cwd();\nconst LOGS = path.join(ROOT, \"logs\");\n\nconst ENTRY_FILES = {\n  collector: \"scripts/alpha-v3-true-entry-forward-oos-collector-v1.ts\",\n  evaluator: \"scripts/alpha-v3-true-forward-oos-evaluator-v1.ts\",\n  summary: \"scripts/alpha-v3-true-forward-oos-summary.ts\"\n};\n\nfunction exists(rel) {\n  return fs.existsSync(path.join(ROOT, rel));\n}\n\nfunction read(rel) {\n  try {\n    return fs.readFileSync(path.join(ROOT, rel), \"utf8\");\n  } catch {\n    return \"\";\n  }\n}\n\nfunction rel(full) {\n  return path.relative(ROOT, full).replace(/\\\\/g, \"/\");\n}\n\nfunction resolveImport(fromRel, spec) {\n  if (!spec) return null;\n\n  const candidates = [];\n\n  if (spec.startsWith(\"@/\")) {\n    const base = path.join(ROOT, spec.slice(2));\n    candidates.push(\n      base,\n      base + \".ts\",\n      base + \".tsx\",\n      base + \".js\",\n      base + \".cjs\",\n      path.join(base, \"index.ts\"),\n      path.join(base, \"index.tsx\"),\n      path.join(base, \"index.js\")\n    );\n  } else if (spec.startsWith(\".\")) {\n    const base = path.resolve(path.dirname(path.join(ROOT, fromRel)), spec);\n    candidates.push(\n      base,\n      base + \".ts\",\n      base + \".tsx\",\n      base + \".js\",\n      base + \".cjs\",\n      path.join(base, \"index.ts\"),\n      path.join(base, \"index.tsx\"),\n      path.join(base, \"index.js\")\n    );\n  } else {\n    return null;\n  }\n\n  for (const candidate of candidates) {\n    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {\n      return rel(candidate);\n    }\n  }\n\n  return null;\n}\n\nfunction extractImports(text) {\n  const specs = new Set();\n\n  const regexes = [\n    /from\\s+[\"'`]([^\"'`]+)[\"'`]/g,\n    /import\\s*\\(\\s*[\"'`]([^\"'`]+)[\"'`]\\s*\\)/g,\n    /require\\(\\s*[\"'`]([^\"'`]+)[\"'`]\\s*\\)/g\n  ];\n\n  for (const rx of regexes) {\n    let m;\n    while ((m = rx.exec(text)) !== null) {\n      if (m[1]) specs.add(m[1]);\n    }\n  }\n\n  return [...specs];\n}\n\nfunction extractTables(text) {\n  const tables = new Set();\n\n  const regexes = [\n    /\\.from\\(\\s*[\"'`]([^\"'`]+)[\"'`]\\s*\\)/g,\n    /\\.rpc\\(\\s*[\"'`]([^\"'`]+)[\"'`]/g,\n    /\\binsert\\s+into\\s+([a-zA-Z0-9_\\.]+)/gi,\n    /\\bupdate\\s+([a-zA-Z0-9_\\.]+)/gi,\n    /\\bfrom\\s+([a-zA-Z0-9_\\.]+)/gi\n  ];\n\n  for (const rx of regexes) {\n    let m;\n    while ((m = rx.exec(text)) !== null) {\n      if (m[1]) tables.add(m[1]);\n    }\n  }\n\n  return [...tables].sort();\n}\n\nfunction capabilities(text) {\n  return {\n    dbRead:\n      /\\.select\\(|\\.from\\(|\\.maybeSingle\\(|\\.single\\(/.test(text),\n    dbWrite:\n      /\\.insert\\(|\\.upsert\\(|\\.update\\(|\\.delete\\(/.test(text),\n    fileRead:\n      /readFileSync|readFile\\(/.test(text),\n    fileWrite:\n      /writeFileSync|writeFile\\(/.test(text),\n    cutoff:\n      /\\bcutoff\\b|\\bas[\\s_-]*of\\b|\\bcaptured_at\\b|\\bobserved_at\\b|\\beffectiveDate\\b/i.test(text),\n    frozen:\n      /\\bfrozen\\b|\\bfreeze\\b|\\bsnapshot\\b/i.test(text),\n    evaluator:\n      /\\bevaluat(e|or|ion)\\b/i.test(text),\n    performance:\n      /\\breturn(1d|3d|5d|_1d|_3d|_5d)\\b|\\bpnl\\b|\\bprofit\\b|\\bdrawdown\\b|\\bexpectancy\\b|\\bwinRate\\b|\\bwin_rate\\b/i.test(text),\n    automation:\n      /\\bcron\\b|\\bschedule\\b|\\bscheduler\\b|\\bautomation\\b/i.test(text)\n  };\n}\n\nfunction crawl(entryRel, maxDepth = 8) {\n  const queue = [{ file: entryRel, depth: 0, parent: null }];\n  const seen = new Map();\n\n  while (queue.length > 0) {\n    const current = queue.shift();\n    if (!current || seen.has(current.file)) continue;\n    if (!exists(current.file)) continue;\n\n    const text = read(current.file);\n    const imports = extractImports(text);\n    const resolvedImports = imports\n      .map(spec => ({\n        spec,\n        resolved: resolveImport(current.file, spec)\n      }))\n      .filter(x => x.resolved);\n\n    seen.set(current.file, {\n      file: current.file,\n      depth: current.depth,\n      parent: current.parent,\n      capabilities: capabilities(text),\n      tables: extractTables(text),\n      imports: resolvedImports\n    });\n\n    if (current.depth >= maxDepth) continue;\n\n    for (const imp of resolvedImports) {\n      if (!seen.has(imp.resolved)) {\n        queue.push({\n          file: imp.resolved,\n          depth: current.depth + 1,\n          parent: current.file\n        });\n      }\n    }\n  }\n\n  return [...seen.values()];\n}\n\nfunction aggregate(nodes) {\n  const tables = new Set();\n  const readers = [];\n  const writers = [];\n  const fileReaders = [];\n  const fileWriters = [];\n  const cutoffFiles = [];\n  const frozenFiles = [];\n  const evaluatorFiles = [];\n  const performanceFiles = [];\n  const automationFiles = [];\n\n  for (const n of nodes) {\n    for (const t of n.tables) tables.add(t);\n    if (n.capabilities.dbRead) readers.push(n.file);\n    if (n.capabilities.dbWrite) writers.push(n.file);\n    if (n.capabilities.fileRead) fileReaders.push(n.file);\n    if (n.capabilities.fileWrite) fileWriters.push(n.file);\n    if (n.capabilities.cutoff) cutoffFiles.push(n.file);\n    if (n.capabilities.frozen) frozenFiles.push(n.file);\n    if (n.capabilities.evaluator) evaluatorFiles.push(n.file);\n    if (n.capabilities.performance) performanceFiles.push(n.file);\n    if (n.capabilities.automation) automationFiles.push(n.file);\n  }\n\n  return {\n    nodeCount: nodes.length,\n    tables: [...tables].sort(),\n    dbReaders: [...new Set(readers)].sort(),\n    dbWriters: [...new Set(writers)].sort(),\n    fileReaders: [...new Set(fileReaders)].sort(),\n    fileWriters: [...new Set(fileWriters)].sort(),\n    cutoffFiles: [...new Set(cutoffFiles)].sort(),\n    frozenFiles: [...new Set(frozenFiles)].sort(),\n    evaluatorFiles: [...new Set(evaluatorFiles)].sort(),\n    performanceFiles: [...new Set(performanceFiles)].sort(),\n    automationFiles: [...new Set(automationFiles)].sort()\n  };\n}\n\nfunction walk(dir, out = []) {\n  if (!fs.existsSync(dir)) return out;\n  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {\n    if (\n      entry.name === \"node_modules\" ||\n      entry.name === \".next\" ||\n      entry.name === \".git\" ||\n      entry.name === \"backups\"\n    ) continue;\n\n    const full = path.join(dir, entry.name);\n    if (entry.isDirectory()) walk(full, out);\n    else if (/\\.(ts|tsx|js|cjs|mjs)$/.test(entry.name)) out.push(full);\n  }\n  return out;\n}\n\nfunction reverseRefs(targetRel) {\n  const basename = path.basename(targetRel).replace(/\\.(ts|tsx|js|cjs|mjs)$/, \"\");\n  const searchRoots = [\"app\", \"lib\", \"scripts\"]\n    .map(x => path.join(ROOT, x))\n    .filter(fs.existsSync);\n\n  const results = [];\n\n  for (const root of searchRoots) {\n    for (const file of walk(root)) {\n      const r = rel(file);\n      if (\n        r === targetRel ||\n        r.startsWith(\"scripts/install-\") ||\n        r.includes(\"runtime-dependency-audit\")\n      ) continue;\n\n      const text = (() => {\n        try { return fs.readFileSync(file, \"utf8\"); }\n        catch { return \"\"; }\n      })();\n\n      if (text.includes(basename)) {\n        results.push(r);\n      }\n    }\n  }\n\n  return [...new Set(results)].sort();\n}\n\nconst graphs = {};\nconst aggregates = {};\nconst reverseBindings = {};\n\nfor (const [kind, entry] of Object.entries(ENTRY_FILES)) {\n  if (!exists(entry)) {\n    graphs[kind] = [];\n    aggregates[kind] = null;\n    reverseBindings[kind] = [];\n    continue;\n  }\n\n  const nodes = crawl(entry);\n  graphs[kind] = nodes;\n  aggregates[kind] = aggregate(nodes);\n  reverseBindings[kind] = reverseRefs(entry);\n}\n\nconst collector = aggregates.collector;\nconst evaluator = aggregates.evaluator;\nconst summary = aggregates.summary;\n\nconst checks = {\n  collectorDependencyGraphBuilt:\n    Array.isArray(graphs.collector) && graphs.collector.length > 0,\n\n  evaluatorDependencyGraphBuilt:\n    Array.isArray(graphs.evaluator) && graphs.evaluator.length > 0,\n\n  summaryDependencyGraphBuilt:\n    Array.isArray(graphs.summary) && graphs.summary.length > 0,\n\n  collectorHasAnyPersistence:\n    !!collector &&\n    (\n      collector.dbWriters.length > 0 ||\n      collector.fileWriters.length > 0\n    ),\n\n  collectorHasAnyReadPath:\n    !!collector &&\n    (\n      collector.dbReaders.length > 0 ||\n      collector.fileReaders.length > 0\n    ),\n\n  collectorHasCutoffSemantics:\n    !!collector && collector.cutoffFiles.length > 0,\n\n  collectorHasFrozenSemantics:\n    !!collector && collector.frozenFiles.length > 0,\n\n  evaluatorHasAnyReadPath:\n    !!evaluator &&\n    (\n      evaluator.dbReaders.length > 0 ||\n      evaluator.fileReaders.length > 0\n    ),\n\n  evaluatorHasEvaluationSemantics:\n    !!evaluator && evaluator.evaluatorFiles.length > 0,\n\n  evaluatorHasPerformanceSemantics:\n    !!evaluator && evaluator.performanceFiles.length > 0,\n\n  summaryHasAnyReadPath:\n    !!summary &&\n    (\n      summary.dbReaders.length > 0 ||\n      summary.fileReaders.length > 0\n    ),\n\n  collectorHasReverseRuntimeBinding:\n    reverseBindings.collector.length > 0,\n\n  evaluatorHasReverseRuntimeBinding:\n    reverseBindings.evaluator.length > 0\n};\n\nconst hardRequired = [\n  \"collectorDependencyGraphBuilt\",\n  \"evaluatorDependencyGraphBuilt\",\n  \"summaryDependencyGraphBuilt\",\n  \"collectorHasAnyPersistence\",\n  \"collectorHasAnyReadPath\",\n  \"collectorHasCutoffSemantics\",\n  \"collectorHasFrozenSemantics\",\n  \"evaluatorHasAnyReadPath\",\n  \"evaluatorHasEvaluationSemantics\"\n];\n\nconst hardFailures = hardRequired.filter(k => checks[k] !== true);\n\nconst warnings = [];\n\nif (!checks.evaluatorHasPerformanceSemantics) {\n  warnings.push(\"EVALUATOR_PERFORMANCE_SEMANTICS_NOT_FOUND_IN_DEPENDENCY_GRAPH\");\n}\n\nif (!checks.summaryHasAnyReadPath) {\n  warnings.push(\"SUMMARY_READ_PATH_NOT_FOUND_IN_DEPENDENCY_GRAPH\");\n}\n\nif (!checks.collectorHasReverseRuntimeBinding) {\n  warnings.push(\"COLLECTOR_REVERSE_RUNTIME_BINDING_NOT_FOUND\");\n}\n\nif (!checks.evaluatorHasReverseRuntimeBinding) {\n  warnings.push(\"EVALUATOR_REVERSE_RUNTIME_BINDING_NOT_FOUND\");\n}\n\nlet readiness;\nlet nextGate;\n\nif (hardFailures.length > 0) {\n  readiness = \"DEPENDENCY_RUNTIME_GAP\";\n  nextGate = \"INSPECT_EXACT_DEPENDENCY_GAPS_BEFORE_PRODUCT_PATCH\";\n} else if (warnings.length > 0) {\n  readiness = \"DEPENDENCY_RUNTIME_PATH_PRESENT_WITH_WARNINGS\";\n  nextGate = \"VERIFY_EXISTING_FORWARD_OOS_CONTRACT_AND_EXECUTION_PATH\";\n} else {\n  readiness = \"DEPENDENCY_RUNTIME_PATH_CONFIRMED\";\n  nextGate = \"RUN_EXISTING_FORWARD_OOS_CONTRACT_AND_EXECUTION_PATH\";\n}\n\nconst report = {\n  status:\n    \"AI_STOCK_LAB_TRUE_FORWARD_OOS_RUNTIME_DEPENDENCY_AUDIT_V2_COMPLETED\",\n\n  mode:\n    \"READ_ONLY_IMPORT_GRAPH_AND_REVERSE_BINDING_AUDIT\",\n\n  readiness,\n\n  entries:\n    ENTRY_FILES,\n\n  aggregates,\n\n  reverseBindings,\n\n  checks,\n\n  hardFailures,\n\n  warnings,\n\n  graphs,\n\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    sourceFilesModified: 0,\n    runtimeCollectorExecuted: false,\n    runtimeEvaluatorExecuted: false,\n    syntheticForwardDataCreated: false,\n    orderCreation: false,\n    positionChange: false,\n    promotionApplyExecuted: false,\n    controlsChange: false,\n    realTradingEnable: false\n  },\n\n  nextGate\n};\n\nfs.mkdirSync(LOGS, { recursive: true });\n\nfs.writeFileSync(\n  path.join(\n    LOGS,\n    \"true-forward-oos-runtime-dependency-audit-v2.json\"\n  ),\n  JSON.stringify(report, null, 2),\n  \"utf8\"\n);\n\nconsole.log(JSON.stringify(report, null, 2));\n\nprocess.exitCode =\n  hardFailures.length === 0 ? 0 : 1;\n";

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

pkg.scripts["test:true-forward-oos-runtime-deps"] =
  "node ./scripts/true-forward-oos-runtime-dependency-audit-v2.cjs";

fs.writeFileSync(
  PACKAGE,
  JSON.stringify(pkg, null, 2) + "\n",
  "utf8"
);

console.log(JSON.stringify({
  status:
    "AI_STOCK_LAB_TRUE_FORWARD_OOS_RUNTIME_DEPENDENCY_AUDIT_V2_INSTALLED",
  generatedFile:
    "scripts/true-forward-oos-runtime-dependency-audit-v2.cjs",
  packageScript:
    "npm run test:true-forward-oos-runtime-deps",
  backup:
    "scripts/backups/package.before-true-forward-oos-runtime-dependency-audit-v2.json",
  focus: [
    "IMPORT_GRAPH",
    "INDIRECT_DB_READS",
    "INDIRECT_DB_WRITES",
    "FILE_PERSISTENCE",
    "TABLE_DISCOVERY",
    "CUTOFF",
    "FROZEN_SNAPSHOT",
    "EVALUATOR_OUTCOME_PATH",
    "REVERSE_RUNTIME_BINDINGS"
  ],
  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    sourceProductCodeChanges: 0,
    runtimeCollectorExecuted: false,
    runtimeEvaluatorExecuted: false,
    orderCreation: false,
    positionChange: false,
    realTradingEnable: false
  },
  nextAction:
    "RUN_TRUE_FORWARD_OOS_RUNTIME_DEPENDENCY_AUDIT_V2"
}, null, 2));
