const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const ROOT = process.cwd();

const PHASE3_PLAN =
  path.join(ROOT, "logs", "safe-cleanup-phase3-plan-v1.json");

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
  "lib/research/run-true-forward-oos-automation-binding-v1.ts",
]);

const PROTECTED_PATTERNS = [
  /forward-oos/i,
  /true-forward/i,
  /shadow/i,
  /promotion/i,
  /stage7/i,
  /controlled-producer/i,
  /maturity/i,
  /collector/i,
  /provenance/i,
  /scheduler/i,
  /kill-switch/i,
  /paper-order/i,
  /risk/i,
  /governance/i,
  /execution-realism/i,
  /accounting/i,
];

const TEXT_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".cjs", ".mjs",
  ".ps1", ".json", ".sql", ".md", ".txt", ".yml", ".yaml"
]);

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

function posix(p) {
  return p.split(path.sep).join("/");
}

function rel(full) {
  return posix(path.relative(ROOT, full));
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
  const raw = git(["status", "--porcelain=v1", "--untracked-files=all"]);
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

function corpus() {
  const roots = [
    "package.json",
    "app",
    "src",
    "lib",
    "scripts",
  ];

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

    let stat;

    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }

    if (stat.size > 2_000_000) continue;

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

      if (refs.length >= 50) break;
    }
  }

  return refs;
}

function taskText() {
  try {
    return cp.execFileSync(
      "schtasks",
      ["/Query", "/FO", "LIST", "/V"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
  } catch {
    return "";
  }
}

function packageText() {
  const p = path.join(ROOT, "package.json");

  return fs.existsSync(p)
    ? fs.readFileSync(p, "utf8")
    : "";
}

function isProtected(file) {
  if (PROTECTED_EXACT.has(file)) return true;
  return PROTECTED_PATTERNS.some((rx) => rx.test(file));
}

function sourceExists(file) {
  return fs.existsSync(path.join(ROOT, file));
}

function classify(row, sourceKind, context) {
  const file = row.file;
  const base = path.basename(file);

  const exists = sourceExists(file);
  const tracked = context.tracked.has(file);
  const gitStatus = context.status.get(file) || null;
  const refs = exists ? refsFor(file, context.rows) : [];
  const pkgRef =
    context.pkg.includes(file) ||
    context.pkg.includes(base);
  const taskRef =
    context.tasks.includes(file) ||
    context.tasks.includes(base);

  const facts = {
    exists,
    tracked,
    gitStatus,
    referenceCount: refs.length,
    references: refs,
    packageReference: pkgRef,
    taskReference: taskRef,
    protectedName: isProtected(file),
  };

  if (!exists) {
    return {
      bucket: "ALREADY_GONE",
      confidence: "HIGH",
      reason: "SOURCE_NO_LONGER_EXISTS",
      facts,
    };
  }

  if (facts.protectedName) {
    return {
      bucket: "KEEP_CURRENT_OR_SAFETY",
      confidence: "HIGH",
      reason: "CURRENT_OR_SAFETY_CRITICAL_NAME",
      facts,
    };
  }

  if (pkgRef || taskRef || refs.length > 0) {
    return {
      bucket: "KEEP_REFERENCED",
      confidence: "HIGH",
      reason:
        pkgRef
          ? "PACKAGE_JSON_REFERENCE"
          : taskRef
            ? "WINDOWS_TASK_REFERENCE"
            : "CURRENT_PROJECT_REFERENCE",
      facts,
    };
  }

  if (gitStatus && gitStatus !== "??") {
    return {
      bucket: "REVIEW_DIRTY",
      confidence: "HIGH",
      reason: "CURRENT_GIT_CHANGE_PRESENT",
      facts,
    };
  }

  if (!tracked || gitStatus === "??") {
    return {
      bucket: "REVIEW_UNTRACKED",
      confidence: "MEDIUM",
      reason: "NOT_GIT_TRACKED_NOW",
      facts,
    };
  }

  if (
    sourceKind === "research" &&
    /(?:extract|inspect|analy[sz]e|compare|trace|viewer|read-only)/i.test(file)
  ) {
    return {
      bucket: "ARCHIVE_SAFE_RESEARCH",
      confidence: "MEDIUM",
      reason: "CLEAN_UNREFERENCED_RESEARCH_INSPECTION_SCRIPT",
      facts,
    };
  }

  if (
    sourceKind === "root-installer" &&
    /^scripts\/install-.+\.cjs$/i.test(file)
  ) {
    return {
      bucket: "RELOCATE_ROOT_INSTALLER",
      confidence: "HIGH",
      reason: "ROOT_INSTALLER_VIOLATES_CURRENT_INSTALLERS_FOLDER_POLICY",
      facts,
    };
  }

  // Strong historical/dev artifact heuristics for manual-review leftovers.
  if (
    /(?:^|\/)(?:v\d|legacy|old|temp|tmp|debug|scratch|one-shot|manual-|probe|audit|verify|regression|replay|diagnos|trace|inspect|extract|compare)/i.test(file)
  ) {
    return {
      bucket: "ARCHIVE_SAFE_LEGACY",
      confidence: "MEDIUM",
      reason: "CLEAN_UNREFERENCED_HISTORICAL_OR_ONE_SHOT_SCRIPT",
      facts,
    };
  }

  return {
    bucket: "REVIEW_MANUAL_FINAL",
    confidence: "LOW",
    reason: "CLEAN_AND_UNREFERENCED_BUT_ROLE_STILL_AMBIGUOUS",
    facts,
  };
}

if (!fs.existsSync(path.join(ROOT, "package.json"))) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_SAFE_CLEANUP_PHASE3C_PLAN_V1_FAILED",
    reason:
      "PACKAGE_JSON_NOT_FOUND",
  }, null, 2));
  process.exit(1);
}

if (!fs.existsSync(PHASE3_PLAN)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_SAFE_CLEANUP_PHASE3C_PLAN_V1_FAILED",
    reason:
      "PHASE3_PLAN_NOT_FOUND",
  }, null, 2));
  process.exit(1);
}

const phase3 =
  JSON.parse(fs.readFileSync(PHASE3_PLAN, "utf8"));

const research =
  phase3?.buckets?.RESEARCH_ARCHIVE_CANDIDATE ?? [];

const manual =
  phase3?.buckets?.REVIEW_MANUAL ?? [];

const rootInstallers =
  fs.readdirSync(path.join(ROOT, "scripts"), { withFileTypes: true })
    .filter((entry) =>
      entry.isFile() &&
      /^install-.+\.cjs$/i.test(entry.name)
    )
    .map((entry) => ({
      file: `scripts/${entry.name}`,
    }));

const context = {
  tracked: trackedSet(),
  status: statusMap(),
  rows: corpus(),
  pkg: packageText(),
  tasks: taskText(),
};

const buckets = {
  ARCHIVE_SAFE_RESEARCH: [],
  ARCHIVE_SAFE_LEGACY: [],
  RELOCATE_ROOT_INSTALLER: [],
  KEEP_CURRENT_OR_SAFETY: [],
  KEEP_REFERENCED: [],
  REVIEW_DIRTY: [],
  REVIEW_UNTRACKED: [],
  REVIEW_MANUAL_FINAL: [],
  ALREADY_GONE: [],
};

function addRows(rows, sourceKind) {
  for (const row of rows) {
    const result =
      classify(row, sourceKind, context);

    buckets[result.bucket].push({
      file: row.file,
      sourceKind,
      confidence: result.confidence,
      reason: result.reason,
      previousReason: row.reason ?? null,
      ...result.facts,
    });
  }
}

addRows(research, "research");
addRows(manual, "manual");
addRows(rootInstallers, "root-installer");

// De-duplicate files that may appear both in old manual/research list and root installer discovery.
// Keep the strongest bucket priority.
const priority = [
  "KEEP_CURRENT_OR_SAFETY",
  "KEEP_REFERENCED",
  "REVIEW_DIRTY",
  "REVIEW_UNTRACKED",
  "RELOCATE_ROOT_INSTALLER",
  "ARCHIVE_SAFE_RESEARCH",
  "ARCHIVE_SAFE_LEGACY",
  "REVIEW_MANUAL_FINAL",
  "ALREADY_GONE",
];

const allByFile = new Map();

for (const bucket of priority) {
  for (const row of buckets[bucket]) {
    if (!allByFile.has(row.file)) {
      allByFile.set(row.file, {
        bucket,
        row,
      });
    }
  }
}

for (const key of Object.keys(buckets)) {
  buckets[key] =
    [...allByFile.values()]
      .filter((x) => x.bucket === key)
      .map((x) => x.row)
      .sort((a, b) => a.file.localeCompare(b.file));
}

const summary = Object.fromEntries(
  Object.entries(buckets)
    .map(([key, rows]) => [key, rows.length])
);

summary.sourceResearchCount = research.length;
summary.sourceManualCount = manual.length;
summary.rootInstallerDiscovered = rootInstallers.length;
summary.uniqueFilesClassified = allByFile.size;
summary.autoArchiveCandidateTotal =
  buckets.ARCHIVE_SAFE_RESEARCH.length +
  buckets.ARCHIVE_SAFE_LEGACY.length;
summary.autoRelocateInstallerTotal =
  buckets.RELOCATE_ROOT_INSTALLER.length;
summary.protectedTotal =
  buckets.KEEP_CURRENT_OR_SAFETY.length +
  buckets.KEEP_REFERENCED.length;
summary.reviewTotal =
  buckets.REVIEW_DIRTY.length +
  buckets.REVIEW_UNTRACKED.length +
  buckets.REVIEW_MANUAL_FINAL.length;

const report = {
  status:
    "AI_STOCK_LAB_SAFE_CLEANUP_PHASE3C_PLAN_V1_COMPLETE",

  classification:
    "FINAL_RESEARCH_MANUAL_AND_ROOT_INSTALLER_RECLASSIFICATION_NO_MUTATION",

  summary,
  buckets,

  destinations: {
    researchArchive:
      "../ai-stock-lab-cleanup-backup-20261012-phase3c/research/",
    legacyArchive:
      "../ai-stock-lab-cleanup-backup-20261012-phase3c/legacy/",
    rootInstallers:
      "scripts/installers/archive/",
  },

  policy: {
    archiveOnlyWhen:
      "exists + Git tracked + clean + zero current refs + no package/task ref + not protected",
    relocateRootInstallerOnlyWhen:
      "exists + Git tracked + clean + zero current refs + not protected",
    neverAutoMutate: [
      "Forward OOS / SHADOW / promotion / scheduler / risk / governance current surfaces",
      "currently referenced files",
      "dirty files",
      "untracked files",
      "final ambiguous manual-review files",
    ],
  },

  safety: {
    planOnly: true,
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
    "REVIEW_PHASE3C_COUNTS_BEFORE_ANY_FINAL_ARCHIVE_OR_RELOCATION",
};

fs.mkdirSync(
  path.join(ROOT, "logs"),
  { recursive: true }
);

fs.writeFileSync(
  path.join(
    ROOT,
    "logs",
    "safe-cleanup-phase3c-plan-v1.json"
  ),
  JSON.stringify(report, null, 2),
  "utf8"
);

function compact(rows, limit = 50) {
  return rows.slice(0, limit).map((row) => ({
    file: row.file,
    sourceKind: row.sourceKind,
    confidence: row.confidence,
    reason: row.reason,
    tracked: row.tracked,
    gitStatus: row.gitStatus,
    referenceCount: row.referenceCount,
    packageReference: row.packageReference,
    taskReference: row.taskReference,
  }));
}

console.log(JSON.stringify({
  status: report.status,
  classification: report.classification,
  summary,

  samples: {
    archiveSafeResearch:
      compact(buckets.ARCHIVE_SAFE_RESEARCH),
    archiveSafeLegacy:
      compact(buckets.ARCHIVE_SAFE_LEGACY),
    relocateRootInstaller:
      compact(buckets.RELOCATE_ROOT_INSTALLER),
    keepCurrentOrSafety:
      compact(buckets.KEEP_CURRENT_OR_SAFETY),
    keepReferenced:
      compact(buckets.KEEP_REFERENCED),
    reviewDirty:
      compact(buckets.REVIEW_DIRTY),
    reviewUntracked:
      compact(buckets.REVIEW_UNTRACKED),
    reviewManualFinal:
      compact(buckets.REVIEW_MANUAL_FINAL),
  },

  truncated: {
    archiveSafeResearch:
      buckets.ARCHIVE_SAFE_RESEARCH.length > 50,
    archiveSafeLegacy:
      buckets.ARCHIVE_SAFE_LEGACY.length > 50,
    relocateRootInstaller:
      buckets.RELOCATE_ROOT_INSTALLER.length > 50,
    keepCurrentOrSafety:
      buckets.KEEP_CURRENT_OR_SAFETY.length > 50,
    keepReferenced:
      buckets.KEEP_REFERENCED.length > 50,
    reviewDirty:
      buckets.REVIEW_DIRTY.length > 50,
    reviewUntracked:
      buckets.REVIEW_UNTRACKED.length > 50,
    reviewManualFinal:
      buckets.REVIEW_MANUAL_FINAL.length > 50,
  },

  report:
    "logs/safe-cleanup-phase3c-plan-v1.json",

  safety:
    report.safety,

  nextGate:
    report.nextGate,
}, null, 2));

process.exit(0);
