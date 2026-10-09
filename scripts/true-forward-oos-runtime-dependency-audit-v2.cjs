const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const LOGS = path.join(ROOT, "logs");

const ENTRY_FILES = {
  collector: "scripts/alpha-v3-true-entry-forward-oos-collector-v1.ts",
  evaluator: "scripts/alpha-v3-true-forward-oos-evaluator-v1.ts",
  summary: "scripts/alpha-v3-true-forward-oos-summary.ts"
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

function rel(full) {
  return path.relative(ROOT, full).replace(/\\/g, "/");
}

function resolveImport(fromRel, spec) {
  if (!spec) return null;

  const candidates = [];

  if (spec.startsWith("@/")) {
    const base = path.join(ROOT, spec.slice(2));
    candidates.push(
      base,
      base + ".ts",
      base + ".tsx",
      base + ".js",
      base + ".cjs",
      path.join(base, "index.ts"),
      path.join(base, "index.tsx"),
      path.join(base, "index.js")
    );
  } else if (spec.startsWith(".")) {
    const base = path.resolve(path.dirname(path.join(ROOT, fromRel)), spec);
    candidates.push(
      base,
      base + ".ts",
      base + ".tsx",
      base + ".js",
      base + ".cjs",
      path.join(base, "index.ts"),
      path.join(base, "index.tsx"),
      path.join(base, "index.js")
    );
  } else {
    return null;
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return rel(candidate);
    }
  }

  return null;
}

function extractImports(text) {
  const specs = new Set();

  const regexes = [
    /from\s+["'`]([^"'`]+)["'`]/g,
    /import\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
    /require\(\s*["'`]([^"'`]+)["'`]\s*\)/g
  ];

  for (const rx of regexes) {
    let m;
    while ((m = rx.exec(text)) !== null) {
      if (m[1]) specs.add(m[1]);
    }
  }

  return [...specs];
}

function extractTables(text) {
  const tables = new Set();

  const regexes = [
    /\.from\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
    /\.rpc\(\s*["'`]([^"'`]+)["'`]/g,
    /\binsert\s+into\s+([a-zA-Z0-9_\.]+)/gi,
    /\bupdate\s+([a-zA-Z0-9_\.]+)/gi,
    /\bfrom\s+([a-zA-Z0-9_\.]+)/gi
  ];

  for (const rx of regexes) {
    let m;
    while ((m = rx.exec(text)) !== null) {
      if (m[1]) tables.add(m[1]);
    }
  }

  return [...tables].sort();
}

function capabilities(text) {
  return {
    dbRead:
      /\.select\(|\.from\(|\.maybeSingle\(|\.single\(/.test(text),
    dbWrite:
      /\.insert\(|\.upsert\(|\.update\(|\.delete\(/.test(text),
    fileRead:
      /readFileSync|readFile\(/.test(text),
    fileWrite:
      /writeFileSync|writeFile\(/.test(text),
    cutoff:
      /\bcutoff\b|\bas[\s_-]*of\b|\bcaptured_at\b|\bobserved_at\b|\beffectiveDate\b/i.test(text),
    frozen:
      /\bfrozen\b|\bfreeze\b|\bsnapshot\b/i.test(text),
    evaluator:
      /\bevaluat(e|or|ion)\b/i.test(text),
    performance:
      /\breturn(1d|3d|5d|_1d|_3d|_5d)\b|\bpnl\b|\bprofit\b|\bdrawdown\b|\bexpectancy\b|\bwinRate\b|\bwin_rate\b/i.test(text),
    automation:
      /\bcron\b|\bschedule\b|\bscheduler\b|\bautomation\b/i.test(text)
  };
}

function crawl(entryRel, maxDepth = 8) {
  const queue = [{ file: entryRel, depth: 0, parent: null }];
  const seen = new Map();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || seen.has(current.file)) continue;
    if (!exists(current.file)) continue;

    const text = read(current.file);
    const imports = extractImports(text);
    const resolvedImports = imports
      .map(spec => ({
        spec,
        resolved: resolveImport(current.file, spec)
      }))
      .filter(x => x.resolved);

    seen.set(current.file, {
      file: current.file,
      depth: current.depth,
      parent: current.parent,
      capabilities: capabilities(text),
      tables: extractTables(text),
      imports: resolvedImports
    });

    if (current.depth >= maxDepth) continue;

    for (const imp of resolvedImports) {
      if (!seen.has(imp.resolved)) {
        queue.push({
          file: imp.resolved,
          depth: current.depth + 1,
          parent: current.file
        });
      }
    }
  }

  return [...seen.values()];
}

function aggregate(nodes) {
  const tables = new Set();
  const readers = [];
  const writers = [];
  const fileReaders = [];
  const fileWriters = [];
  const cutoffFiles = [];
  const frozenFiles = [];
  const evaluatorFiles = [];
  const performanceFiles = [];
  const automationFiles = [];

  for (const n of nodes) {
    for (const t of n.tables) tables.add(t);
    if (n.capabilities.dbRead) readers.push(n.file);
    if (n.capabilities.dbWrite) writers.push(n.file);
    if (n.capabilities.fileRead) fileReaders.push(n.file);
    if (n.capabilities.fileWrite) fileWriters.push(n.file);
    if (n.capabilities.cutoff) cutoffFiles.push(n.file);
    if (n.capabilities.frozen) frozenFiles.push(n.file);
    if (n.capabilities.evaluator) evaluatorFiles.push(n.file);
    if (n.capabilities.performance) performanceFiles.push(n.file);
    if (n.capabilities.automation) automationFiles.push(n.file);
  }

  return {
    nodeCount: nodes.length,
    tables: [...tables].sort(),
    dbReaders: [...new Set(readers)].sort(),
    dbWriters: [...new Set(writers)].sort(),
    fileReaders: [...new Set(fileReaders)].sort(),
    fileWriters: [...new Set(fileWriters)].sort(),
    cutoffFiles: [...new Set(cutoffFiles)].sort(),
    frozenFiles: [...new Set(frozenFiles)].sort(),
    evaluatorFiles: [...new Set(evaluatorFiles)].sort(),
    performanceFiles: [...new Set(performanceFiles)].sort(),
    automationFiles: [...new Set(automationFiles)].sort()
  };
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
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|cjs|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function reverseRefs(targetRel) {
  const basename = path.basename(targetRel).replace(/\.(ts|tsx|js|cjs|mjs)$/, "");
  const searchRoots = ["app", "lib", "scripts"]
    .map(x => path.join(ROOT, x))
    .filter(fs.existsSync);

  const results = [];

  for (const root of searchRoots) {
    for (const file of walk(root)) {
      const r = rel(file);
      if (
        r === targetRel ||
        r.startsWith("scripts/install-") ||
        r.includes("runtime-dependency-audit")
      ) continue;

      const text = (() => {
        try { return fs.readFileSync(file, "utf8"); }
        catch { return ""; }
      })();

      if (text.includes(basename)) {
        results.push(r);
      }
    }
  }

  return [...new Set(results)].sort();
}

const graphs = {};
const aggregates = {};
const reverseBindings = {};

for (const [kind, entry] of Object.entries(ENTRY_FILES)) {
  if (!exists(entry)) {
    graphs[kind] = [];
    aggregates[kind] = null;
    reverseBindings[kind] = [];
    continue;
  }

  const nodes = crawl(entry);
  graphs[kind] = nodes;
  aggregates[kind] = aggregate(nodes);
  reverseBindings[kind] = reverseRefs(entry);
}

const collector = aggregates.collector;
const evaluator = aggregates.evaluator;
const summary = aggregates.summary;

const checks = {
  collectorDependencyGraphBuilt:
    Array.isArray(graphs.collector) && graphs.collector.length > 0,

  evaluatorDependencyGraphBuilt:
    Array.isArray(graphs.evaluator) && graphs.evaluator.length > 0,

  summaryDependencyGraphBuilt:
    Array.isArray(graphs.summary) && graphs.summary.length > 0,

  collectorHasAnyPersistence:
    !!collector &&
    (
      collector.dbWriters.length > 0 ||
      collector.fileWriters.length > 0
    ),

  collectorHasAnyReadPath:
    !!collector &&
    (
      collector.dbReaders.length > 0 ||
      collector.fileReaders.length > 0
    ),

  collectorHasCutoffSemantics:
    !!collector && collector.cutoffFiles.length > 0,

  collectorHasFrozenSemantics:
    !!collector && collector.frozenFiles.length > 0,

  evaluatorHasAnyReadPath:
    !!evaluator &&
    (
      evaluator.dbReaders.length > 0 ||
      evaluator.fileReaders.length > 0
    ),

  evaluatorHasEvaluationSemantics:
    !!evaluator && evaluator.evaluatorFiles.length > 0,

  evaluatorHasPerformanceSemantics:
    !!evaluator && evaluator.performanceFiles.length > 0,

  summaryHasAnyReadPath:
    !!summary &&
    (
      summary.dbReaders.length > 0 ||
      summary.fileReaders.length > 0
    ),

  collectorHasReverseRuntimeBinding:
    reverseBindings.collector.length > 0,

  evaluatorHasReverseRuntimeBinding:
    reverseBindings.evaluator.length > 0
};

const hardRequired = [
  "collectorDependencyGraphBuilt",
  "evaluatorDependencyGraphBuilt",
  "summaryDependencyGraphBuilt",
  "collectorHasAnyPersistence",
  "collectorHasAnyReadPath",
  "collectorHasCutoffSemantics",
  "collectorHasFrozenSemantics",
  "evaluatorHasAnyReadPath",
  "evaluatorHasEvaluationSemantics"
];

const hardFailures = hardRequired.filter(k => checks[k] !== true);

const warnings = [];

if (!checks.evaluatorHasPerformanceSemantics) {
  warnings.push("EVALUATOR_PERFORMANCE_SEMANTICS_NOT_FOUND_IN_DEPENDENCY_GRAPH");
}

if (!checks.summaryHasAnyReadPath) {
  warnings.push("SUMMARY_READ_PATH_NOT_FOUND_IN_DEPENDENCY_GRAPH");
}

if (!checks.collectorHasReverseRuntimeBinding) {
  warnings.push("COLLECTOR_REVERSE_RUNTIME_BINDING_NOT_FOUND");
}

if (!checks.evaluatorHasReverseRuntimeBinding) {
  warnings.push("EVALUATOR_REVERSE_RUNTIME_BINDING_NOT_FOUND");
}

let readiness;
let nextGate;

if (hardFailures.length > 0) {
  readiness = "DEPENDENCY_RUNTIME_GAP";
  nextGate = "INSPECT_EXACT_DEPENDENCY_GAPS_BEFORE_PRODUCT_PATCH";
} else if (warnings.length > 0) {
  readiness = "DEPENDENCY_RUNTIME_PATH_PRESENT_WITH_WARNINGS";
  nextGate = "VERIFY_EXISTING_FORWARD_OOS_CONTRACT_AND_EXECUTION_PATH";
} else {
  readiness = "DEPENDENCY_RUNTIME_PATH_CONFIRMED";
  nextGate = "RUN_EXISTING_FORWARD_OOS_CONTRACT_AND_EXECUTION_PATH";
}

const report = {
  status:
    "AI_STOCK_LAB_TRUE_FORWARD_OOS_RUNTIME_DEPENDENCY_AUDIT_V2_COMPLETED",

  mode:
    "READ_ONLY_IMPORT_GRAPH_AND_REVERSE_BINDING_AUDIT",

  readiness,

  entries:
    ENTRY_FILES,

  aggregates,

  reverseBindings,

  checks,

  hardFailures,

  warnings,

  graphs,

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    sourceFilesModified: 0,
    runtimeCollectorExecuted: false,
    runtimeEvaluatorExecuted: false,
    syntheticForwardDataCreated: false,
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
    "true-forward-oos-runtime-dependency-audit-v2.json"
  ),
  JSON.stringify(report, null, 2),
  "utf8"
);

console.log(JSON.stringify(report, null, 2));

process.exitCode =
  hardFailures.length === 0 ? 0 : 1;
