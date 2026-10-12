const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const LOGS = path.join(ROOT, "logs");

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function read(rel) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) return "";
  try {
    return fs.readFileSync(full, "utf8");
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
    ) {
      continue;
    }

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

function findRefs(pattern, roots) {
  const hits = [];

  for (const root of roots) {
    const fullRoot = path.join(ROOT, root);
    const files = walk(fullRoot);

    for (const file of files) {
      const relative = rel(file);

      if (
        relative.startsWith("scripts/install-") ||
        relative.includes("/backups/") ||
        relative.endsWith("true-forward-oos-runtime-data-flow-audit-v1.cjs")
      ) {
        continue;
      }

      const text = safeRead(file);
      if (!text) continue;

      if (pattern.test(text)) {
        hits.push(relative);
      }
    }
  }

  return [...new Set(hits)].sort();
}

function extractSupabaseTables(text) {
  const tables = new Set();

  const patterns = [
    /\.from\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
    /\bfrom\s+([a-zA-Z0-9_\.]+)/gi,
    /\binsert\s+into\s+([a-zA-Z0-9_\.]+)/gi,
    /\bupdate\s+([a-zA-Z0-9_\.]+)/gi
  ];

  for (const rx of patterns) {
    let m;
    while ((m = rx.exec(text)) !== null) {
      if (m[1]) tables.add(m[1]);
    }
  }

  return [...tables].sort();
}

function keywordFlags(text) {
  return {
    cutoff:
      /\bcutoff\b|\bas[\s_-]*of\b|\bcaptured_at\b|\bobserved_at\b/i.test(text),
    frozen:
      /\bfrozen\b|\bfreeze\b|\bsnapshot\b/i.test(text),
    leakage:
      /\bleak(age)?\b|\blookahead\b|\bfuture[\s_-]*data\b/i.test(text),
    dbWrite:
      /\.insert\(|\.upsert\(|\.update\(|\.delete\(/.test(text),
    dbRead:
      /\.select\(|\.from\(/.test(text),
    evaluator:
      /\bevaluat(e|or|ion)\b/i.test(text),
    returns:
      /\breturn(1d|3d|5d|_1d|_3d|_5d)\b|\bpnl\b|\bprofit\b|\bdrawdown\b|\bexpectancy\b/i.test(text),
    schedule:
      /\bcron\b|\bschedule\b|\bscheduler\b|\bautomation\b/i.test(text)
  };
}

const candidates = {
  collector: [
    "scripts/alpha-v3-true-entry-forward-oos-collector-v1.ts",
    "scripts/alpha-v3-true-forward-oos-collector-v1.ts"
  ],
  evaluator: [
    "scripts/alpha-v3-true-forward-oos-evaluator-v1.ts"
  ],
  summary: [
    "scripts/alpha-v3-true-forward-oos-summary.ts"
  ],
  contract: [
    "scripts/alpha-v3-true-forward-oos-pipeline-v1-contract-test.ts"
  ],
  staticVerify: [
    "scripts/alpha-v3-true-forward-oos-pipeline-v1-static-verify.cjs"
  ],
  postCaptureIntegrity: [
    "scripts/alpha-v3-forward-oos-post-capture-integrity-audit-v1.cjs"
  ]
};

const resolved = {};

for (const [kind, list] of Object.entries(candidates)) {
  resolved[kind] = list.filter(exists);
}

const sourceDetails = {};

for (const [kind, list] of Object.entries(resolved)) {
  sourceDetails[kind] = list.map((file) => {
    const text = read(file);

    return {
      file,
      flags: keywordFlags(text),
      referencedTables: extractSupabaseTables(text)
    };
  });
}

const allRuntimeTexts = Object.values(resolved)
  .flat()
  .map(read)
  .join("\n");

const runtimeTables = extractSupabaseTables(allRuntimeTexts);

const runtimeNamePattern =
  /alpha-v3-true-forward-oos|alpha-v3-true-entry-forward-oos|true-forward-oos/i;

const appLibAutomationRefs = findRefs(
  runtimeNamePattern,
  ["app", "lib"]
);

const scriptRuntimeRefs = findRefs(
  runtimeNamePattern,
  ["scripts"]
).filter(
  (file) =>
    !file.startsWith("scripts/install-") &&
    !file.includes("readiness-audit") &&
    !file.includes("runtime-data-flow-audit")
);

const migrationsWithRuntimeTerms = findRefs(
  /true[\s_-]*forward|forward[\s_-]*oos|oos/i,
  ["supabase/migrations", "migrations"]
);

const collectorFiles = resolved.collector;
const evaluatorFiles = resolved.evaluator;
const summaryFiles = resolved.summary;

const collectorText = collectorFiles.map(read).join("\n");
const evaluatorText = evaluatorFiles.map(read).join("\n");
const summaryText = summaryFiles.map(read).join("\n");

const checks = {
  collectorExists:
    collectorFiles.length > 0,

  evaluatorExists:
    evaluatorFiles.length > 0,

  summaryExists:
    summaryFiles.length > 0,

  contractTestExists:
    resolved.contract.length > 0,

  staticVerifyExists:
    resolved.staticVerify.length > 0,

  postCaptureIntegrityAuditExists:
    resolved.postCaptureIntegrity.length > 0,

  collectorHasPersistenceSurface:
    keywordFlags(collectorText).dbWrite,

  collectorHasCutoffOrObservationTime:
    keywordFlags(collectorText).cutoff,

  collectorHasFrozenOrSnapshotSemantics:
    keywordFlags(collectorText).frozen,

  evaluatorHasReadSurface:
    keywordFlags(evaluatorText).dbRead,

  evaluatorHasEvaluationSemantics:
    keywordFlags(evaluatorText).evaluator,

  evaluatorHasPerformanceOutcomeTerms:
    keywordFlags(evaluatorText).returns,

  summaryHasReadOrPerformanceTerms:
    keywordFlags(summaryText).dbRead ||
    keywordFlags(summaryText).returns,

  runtimeTablesDetected:
    runtimeTables.length > 0,

  appLibAutomationBindingFound:
    appLibAutomationRefs.length > 0,

  runtimeScriptCrossReferencesFound:
    scriptRuntimeRefs.length > 0
};

const hardRequired = [
  "collectorExists",
  "evaluatorExists",
  "summaryExists",
  "collectorHasPersistenceSurface",
  "collectorHasCutoffOrObservationTime",
  "evaluatorHasReadSurface",
  "evaluatorHasEvaluationSemantics",
  "runtimeTablesDetected"
];

const hardFailures = hardRequired.filter(
  (key) => checks[key] !== true
);

const warnings = [];

if (!checks.collectorHasFrozenOrSnapshotSemantics) {
  warnings.push("COLLECTOR_FROZEN_OR_SNAPSHOT_SEMANTICS_NOT_OBVIOUS");
}

if (!checks.evaluatorHasPerformanceOutcomeTerms) {
  warnings.push("EVALUATOR_PERFORMANCE_OUTCOME_TERMS_NOT_OBVIOUS");
}

if (!checks.appLibAutomationBindingFound) {
  warnings.push("NO_APP_LIB_AUTOMATION_BINDING_FOUND");
}

if (!checks.postCaptureIntegrityAuditExists) {
  warnings.push("POST_CAPTURE_INTEGRITY_AUDIT_NOT_FOUND");
}

let readiness;
let nextGate;

if (hardFailures.length > 0) {
  readiness = "RUNTIME_GAP";
  nextGate = "INSPECT_TRUE_FORWARD_OOS_RUNTIME_GAPS_BEFORE_PATCHING";
} else if (warnings.length > 0) {
  readiness = "RUNTIME_PATH_PRESENT_WITH_GAPS";
  nextGate = "HARDEN_TRUE_FORWARD_OOS_RUNTIME_BINDING_AND_INTEGRITY";
} else {
  readiness = "RUNTIME_PATH_STRONGLY_CONNECTED";
  nextGate = "RUN_EXISTING_TRUE_FORWARD_OOS_CONTRACT_AND_STATIC_VERIFIERS";
}

const report = {
  status:
    "AI_STOCK_LAB_TRUE_FORWARD_OOS_RUNTIME_DATA_FLOW_AUDIT_V1_COMPLETED",

  mode:
    "READ_ONLY_TARGETED_RUNTIME_SOURCE_AUDIT",

  readiness,

  resolvedFiles:
    resolved,

  sourceDetails,

  runtimePersistence: {
    detectedTables:
      runtimeTables,
    migrationsWithRuntimeTerms:
      migrationsWithRuntimeTerms.slice(0, 40)
  },

  bindings: {
    appLibAutomationRefs,
    scriptRuntimeRefs:
      scriptRuntimeRefs.slice(0, 60)
  },

  checks,

  hardFailures,

  warnings,

  interpretation: {
    runtimeGap:
      "A required Collector/Evaluator/Persistence runtime element is not obvious from source.",
    runtimePathPresentWithGaps:
      "Core runtime path exists, but one or more automation/integrity/frozen-evidence bindings need hardening or explicit verification.",
    runtimePathStronglyConnected:
      "Collector, persistence, evaluator, summary, integrity and automation/runtime binding surfaces are all visible."
  },

  safety: {
    databaseReads:
      0,
    databaseWrites:
      0,
    sourceFilesModified:
      0,
    collectorExecuted:
      false,
    evaluatorExecuted:
      false,
    syntheticForwardDataCreated:
      false,
    orderCreation:
      false,
    positionChange:
      false,
    promotionApplyExecuted:
      false,
    controlsChange:
      false,
    realTradingEnable:
      false
  },

  nextGate
};

fs.mkdirSync(LOGS, { recursive: true });

fs.writeFileSync(
  path.join(
    LOGS,
    "true-forward-oos-runtime-data-flow-audit-v1.json"
  ),
  JSON.stringify(report, null, 2),
  "utf8"
);

console.log(JSON.stringify(report, null, 2));

process.exitCode =
  hardFailures.length === 0
    ? 0
    : 1;
