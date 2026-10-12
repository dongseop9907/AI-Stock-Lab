const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const crypto = require("crypto");

const ROOT = process.cwd();

const EXCLUDE_DIRS = new Set([
  ".git",
  ".next",
  "node_modules",
  ".turbo",
  ".vercel",
  "coverage",
  "dist",
  "build",
  "installers",
  "backups",
]);

const PROTECTED_EXACT = new Set([
  "scripts/run-shadow-controlled-producer-0850.ps1",
  "scripts/true-forward-oos-controlled-producer-evidence-run-v1.ts",
  "scripts/true-forward-oos-controlled-normal-producer-v1.ts",
  "scripts/alpha-v3-true-forward-top1-producer-v1.ts",
  "scripts/true-forward-oos-first-real-session-readiness-v1.ts",
  "scripts/true-forward-oos-post-capture-maturity-audit-v1.ts",
  "scripts/true-forward-oos-maturity-aware-collector-gate-v1.ts",
  "scripts/forward-oos-data-quality-integrity-monitor-v1.ts",
  "scripts/model-shadow-canonical-lifecycle-watch-v1.ts",
  "scripts/stage7-forward-oos-paper-baseline-audit-v1.cjs",
  "scripts/stage7-scheduled-producer-safety-chain-audit-v1.cjs",
  "scripts/stage7-scheduled-producer-safety-chain-audit-v2.cjs",
  "scripts/stage7-first-verified-controlled-session-capture-v1.cjs",
]);

const TEXT_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".cjs", ".mjs",
  ".ps1", ".json", ".sql", ".md", ".txt", ".yml", ".yaml",
]);

function posix(p) {
  return p.split(path.sep).join("/");
}

function rel(full) {
  return posix(path.relative(ROOT, full));
}

function walk(dirRel) {
  const start = path.join(ROOT, dirRel);
  if (!fs.existsSync(start)) return [];

  const out = [];

  function visit(dir) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;

      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        visit(full);
      } else if (entry.isFile()) {
        out.push(full);
      }
    }
  }

  visit(start);
  return out;
}

function git(args) {
  try {
    return cp.execFileSync(
      "git",
      args,
      {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }
    ).trim();
  } catch {
    return "";
  }
}

function trackedSet() {
  const raw = git(["ls-files"]);
  return new Set(
    raw ? raw.split(/\r?\n/).map(posix).filter(Boolean) : []
  );
}

function statusMap() {
  const raw = git(["status", "--porcelain=v1"]);
  const map = new Map();

  if (!raw) return map;

  for (const line of raw.split(/\r?\n/)) {
    if (line.length < 4) continue;

    const code = line.slice(0, 2);
    let file = line.slice(3).trim();

    if (file.includes(" -> ")) {
      file = file.split(" -> ").pop();
    }

    file = file.replace(/^"|"$/g, "");
    map.set(posix(file), code);
  }

  return map;
}

function packageRefs() {
  const out = new Set();
  const pkg = path.join(ROOT, "package.json");

  if (!fs.existsSync(pkg)) return out;

  let json;
  try {
    json = JSON.parse(fs.readFileSync(pkg, "utf8"));
  } catch {
    return out;
  }

  for (const command of Object.values(json.scripts || {})) {
    const text = String(command);

    const matches =
      text.match(/scripts\/[A-Za-z0-9_./@()\- ]+\.(?:ts|tsx|js|cjs|mjs|ps1)/g)
      || [];

    for (const m of matches) {
      out.add(posix(m.trim()));
    }
  }

  return out;
}

function corpus() {
  const roots = ["package.json", "app", "src", "lib", "scripts"];
  const files = [];

  for (const root of roots) {
    const full = path.join(ROOT, root);

    if (!fs.existsSync(full)) continue;

    if (fs.statSync(full).isFile()) {
      files.push(full);
    } else {
      files.push(...walk(root));
    }
  }

  const rows = [];

  for (const full of files) {
    const ext = path.extname(full).toLowerCase();
    if (!TEXT_EXTS.has(ext)) continue;

    let st;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }

    if (st.size > 2_000_000) continue;

    try {
      rows.push({
        file: rel(full),
        text: fs.readFileSync(full, "utf8"),
      });
    } catch {}
  }

  return rows;
}

function refsFor(target, rows) {
  const base = path.basename(target);
  const noExt = target.replace(/\.[^.]+$/, "");
  const baseNoExt = base.replace(/\.[^.]+$/, "");

  const needles = [...new Set([
    target,
    "./" + target,
    noExt,
    base,
    baseNoExt,
  ])].filter((x) => x.length >= 6);

  const refs = [];

  for (const row of rows) {
    if (row.file === target) continue;

    if (needles.some((needle) => row.text.includes(needle))) {
      refs.push(row.file);
      if (refs.length >= 30) break;
    }
  }

  return refs;
}

function sha256(full) {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(full));
  return h.digest("hex");
}

function duplicateInfo(file) {
  const base = path.basename(file);
  const m = base.match(/^(.*) \((\d+)\)(\.[^.]+)$/);

  if (!m) {
    return {
      isCopyName: false,
      canonicalSibling: null,
      canonicalExists: false,
      identicalHash: null,
    };
  }

  const canonicalBase = m[1] + m[3];
  const canonicalRel = posix(
    path.join(path.dirname(file), canonicalBase)
  );

  const source = path.join(ROOT, file);
  const canonical = path.join(ROOT, canonicalRel);

  const canonicalExists = fs.existsSync(canonical);

  return {
    isCopyName: true,
    canonicalSibling: canonicalRel,
    canonicalExists,
    identicalHash:
      canonicalExists
        ? sha256(source) === sha256(canonical)
        : null,
  };
}

function generatedTargetForInstaller(file) {
  const base = path.basename(file);
  const m = base.match(/^install-(.+)\.cjs$/i);

  if (!m) return null;

  const stem = m[1];

  const candidates = [
    `scripts/${stem}.cjs`,
    `scripts/${stem}.ts`,
    `scripts/${stem}.js`,
    `scripts/${stem}.ps1`,
  ];

  return candidates.find((candidate) =>
    fs.existsSync(path.join(ROOT, candidate))
  ) || null;
}

function classify(file, meta) {
  if (PROTECTED_EXACT.has(file)) {
    return {
      bucket: "KEEP_ACTIVE",
      confidence: "HIGH",
      reason: "CURRENT_STAGE7_CRITICAL",
    };
  }

  if (meta.packageRef) {
    return {
      bucket: "KEEP_ACTIVE",
      confidence: "HIGH",
      reason: "PACKAGE_JSON_SCRIPT_REFERENCE",
    };
  }

  if (meta.refs.length > 0) {
    return {
      bucket: "KEEP_REFERENCED",
      confidence: "MEDIUM",
      reason: "PROJECT_SOURCE_REFERENCE_FOUND",
    };
  }

  if (
    meta.duplicate.isCopyName &&
    meta.duplicate.canonicalExists &&
    meta.duplicate.identicalHash === true
  ) {
    return {
      bucket: "DUPLICATE_DELETE_CANDIDATE",
      confidence: "HIGH",
      reason: "COPY_SUFFIX_AND_BYTE_IDENTICAL_TO_CANONICAL_SIBLING",
    };
  }

  if (
    /^scripts\/install-.+\.cjs$/i.test(file)
  ) {
    return {
      bucket: "INSTALLER_RELOCATE_CANDIDATE",
      confidence:
        meta.generatedTarget ? "HIGH" : "MEDIUM",
      reason:
        meta.generatedTarget
          ? "UNREFERENCED_ROOT_INSTALLER_WITH_EXISTING_GENERATED_TARGET"
          : "UNREFERENCED_ROOT_INSTALLER_NEW_POLICY_REQUIRES_INSTALLERS_FOLDER",
    };
  }

  if (
    /^scripts\/(?:fix-|repair-|patch-).+\.(?:cjs|js|ts)$/i.test(file)
  ) {
    return {
      bucket: "REPAIR_ARCHIVE_CANDIDATE",
      confidence: "MEDIUM",
      reason: "UNREFERENCED_ONE_SHOT_REPAIR_OR_PATCH_SCRIPT",
    };
  }

  if (
    /(?:probe|diag|diagnostic|audit|verify|contract-test|regression|stress|smoke)/i.test(file)
  ) {
    return {
      bucket: "DIAGNOSTIC_ARCHIVE_CANDIDATE",
      confidence: "MEDIUM",
      reason: "UNREFERENCED_DIAGNOSTIC_TEST_OR_VERIFICATION_SCRIPT",
    };
  }

  if (
    /(?:extract|inspect|analyze|compare|trace|viewer|read-only)/i.test(file)
  ) {
    return {
      bucket: "RESEARCH_ARCHIVE_CANDIDATE",
      confidence: "LOW",
      reason: "UNREFERENCED_RESEARCH_OR_INSPECTION_SCRIPT",
    };
  }

  return {
    bucket: "REVIEW_MANUAL",
    confidence: "LOW",
    reason: "UNREFERENCED_BUT_ROLE_NOT_SAFE_TO_INFER",
  };
}

if (!fs.existsSync(path.join(ROOT, "package.json"))) {
  console.error(JSON.stringify({
    status: "AI_STOCK_LAB_SAFE_CLEANUP_PHASE3_PLAN_V1_FAILED",
    reason: "PACKAGE_JSON_NOT_FOUND",
  }, null, 2));
  process.exit(1);
}

const tracked = trackedSet();
const status = statusMap();
const pkgRefs = packageRefs();
const rows = corpus();

const files =
  walk("scripts")
    .map(rel)
    .filter((file) =>
      /\.(?:ts|tsx|js|jsx|cjs|mjs|ps1|json|sql)$/i.test(file)
    )
    .sort();

const buckets = {
  KEEP_ACTIVE: [],
  KEEP_REFERENCED: [],
  INSTALLER_RELOCATE_CANDIDATE: [],
  DUPLICATE_DELETE_CANDIDATE: [],
  REPAIR_ARCHIVE_CANDIDATE: [],
  DIAGNOSTIC_ARCHIVE_CANDIDATE: [],
  RESEARCH_ARCHIVE_CANDIDATE: [],
  REVIEW_MANUAL: [],
};

for (const file of files) {
  const refs = refsFor(file, rows);
  const duplicate = duplicateInfo(file);
  const generatedTarget = generatedTargetForInstaller(file);

  const meta = {
    refs,
    duplicate,
    generatedTarget,
    packageRef: pkgRefs.has(file),
  };

  const cls = classify(file, meta);
  const st = fs.statSync(path.join(ROOT, file));

  buckets[cls.bucket].push({
    file,
    confidence: cls.confidence,
    reason: cls.reason,
    tracked: tracked.has(file),
    gitStatus: status.get(file) || null,
    packageScriptRef: meta.packageRef,
    referenceCount: refs.length,
    references: refs,
    generatedTarget,
    duplicate,
    size: st.size,
    mtime: st.mtime.toISOString(),
  });
}

const mutationBuckets = [
  "INSTALLER_RELOCATE_CANDIDATE",
  "DUPLICATE_DELETE_CANDIDATE",
  "REPAIR_ARCHIVE_CANDIDATE",
  "DIAGNOSTIC_ARCHIVE_CANDIDATE",
  "RESEARCH_ARCHIVE_CANDIDATE",
];

const dirtyMutationCandidates = [];

for (const bucket of mutationBuckets) {
  for (const row of buckets[bucket]) {
    if (row.gitStatus && row.gitStatus !== "??") {
      dirtyMutationCandidates.push({
        file: row.file,
        bucket,
        gitStatus: row.gitStatus,
      });
    }
  }
}

const summary = Object.fromEntries(
  Object.entries(buckets)
    .map(([key, value]) => [key, value.length])
);

summary.totalScanned = files.length;
summary.dirtyMutationCandidates =
  dirtyMutationCandidates.length;

const report = {
  status:
    "AI_STOCK_LAB_SAFE_CLEANUP_PHASE3_PLAN_V1_COMPLETE",

  classification:
    "PHASE3_ROLE_CLASSIFICATION_ONLY_NO_MUTATION",

  summary,
  buckets,
  dirtyMutationCandidates,

  destinations: {
    installerRelocate:
      "scripts/installers/archive/",
    repairArchive:
      "../ai-stock-lab-cleanup-backup-20261012-phase3/repairs/",
    diagnosticArchive:
      "../ai-stock-lab-cleanup-backup-20261012-phase3/diagnostics/",
    researchArchive:
      "../ai-stock-lab-cleanup-backup-20261012-phase3/research/",
    duplicateDelete:
      "external backup first, then exact duplicate delete",
  },

  safety: {
    readOnlyPlan: true,
    filesMoved: 0,
    filesDeleted: 0,
    filesRenamed: 0,
    sourceModified: 0,
    stage7Modified: false,
    migrationsModified: false,
    envModified: false,
    scheduledTaskModified: false,
    databaseWrites: 0,
    realTradingChanged: false,
  },

  nextGate:
    "REVIEW_PHASE3_COUNTS_AND_DIRTY_MUTATION_CANDIDATES_BEFORE_APPLY",
};

fs.mkdirSync(
  path.join(ROOT, "logs"),
  { recursive: true }
);

fs.writeFileSync(
  path.join(
    ROOT,
    "logs",
    "safe-cleanup-phase3-plan-v1.json"
  ),
  JSON.stringify(report, null, 2),
  "utf8"
);

function compact(rows, limit = 40) {
  return rows.slice(0, limit).map((row) => ({
    file: row.file,
    confidence: row.confidence,
    reason: row.reason,
    tracked: row.tracked,
    gitStatus: row.gitStatus,
    references: row.referenceCount,
    generatedTarget: row.generatedTarget,
    duplicate: row.duplicate,
  }));
}

console.log(JSON.stringify({
  status: report.status,
  classification: report.classification,
  summary,

  samples: {
    installerRelocate:
      compact(buckets.INSTALLER_RELOCATE_CANDIDATE),

    duplicateDelete:
      compact(buckets.DUPLICATE_DELETE_CANDIDATE),

    repairArchive:
      compact(buckets.REPAIR_ARCHIVE_CANDIDATE),

    diagnosticArchive:
      compact(buckets.DIAGNOSTIC_ARCHIVE_CANDIDATE),

    researchArchive:
      compact(buckets.RESEARCH_ARCHIVE_CANDIDATE),

    reviewManual:
      compact(buckets.REVIEW_MANUAL),

    keepActive:
      compact(buckets.KEEP_ACTIVE, 20),

    keepReferenced:
      compact(buckets.KEEP_REFERENCED, 20),
  },

  dirtyMutationCandidates:
    dirtyMutationCandidates.slice(0, 60),

  truncated: {
    installerRelocate:
      buckets.INSTALLER_RELOCATE_CANDIDATE.length > 40,
    duplicateDelete:
      buckets.DUPLICATE_DELETE_CANDIDATE.length > 40,
    repairArchive:
      buckets.REPAIR_ARCHIVE_CANDIDATE.length > 40,
    diagnosticArchive:
      buckets.DIAGNOSTIC_ARCHIVE_CANDIDATE.length > 40,
    researchArchive:
      buckets.RESEARCH_ARCHIVE_CANDIDATE.length > 40,
    reviewManual:
      buckets.REVIEW_MANUAL.length > 40,
  },

  report:
    "logs/safe-cleanup-phase3-plan-v1.json",

  safety:
    report.safety,

  nextGate:
    report.nextGate,
}, null, 2));

process.exitCode = 0;
