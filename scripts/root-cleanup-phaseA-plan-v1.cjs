const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const ROOT = process.cwd();
const SOURCE_PLAN =
  path.join(ROOT, "logs", "root-cleanup-plan-v1.json");

const DISPOSABLE_PATTERNS = [
  /\.tsbuildinfo$/i,
  /\.bak$/i,
  /\.backup$/i,
  /\.backup-/i,
  /\.before-/i,
  /^tsc-errors.*\.txt$/i,
  /^typescript-errors\.txt$/i,
  /(?:^|[-_])body\.json$/i,
  /(?:^|[-_])response\.json$/i,
];

const ARCHIVE_PATTERNS = [
  /\.zip$/i,
  /^README[_-].+/i,
  /\.patch\.ts\.txt$/i,
  /^alpha-research-gate-readiness\.txt$/i,
  /^backtest-alpha-(?:core-contracts|inventory)\.txt$/i,
  /^corporate-action-coverage-(?:contracts|finalization-discovery|inventory)\.txt$/i,
  /^generate-entry-signals\.txt$/i,
  /^cleanup-audit-ai-stock-lab\.cjs$/i,
];

const CORE_PROTECT_PATTERNS = [
  /^\.env(?:\.|$)/i,
  /^package(?:-lock)?\.json$/i,
  /^tsconfig.*\.json$/i,
  /^next(?:-env|\.config)/i,
  /^eslint\.config\./i,
  /^\.gitignore$/i,
  /^README\.md$/i,
];

function posix(p) {
  return p.split(path.sep).join("/");
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
  const raw =
    git(["status", "--porcelain=v1", "--untracked-files=all"]);
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

function projectCorpus() {
  const roots = ["app", "src", "lib", "scripts"];
  const exclude = new Set([
    ".git", ".next", "node_modules", ".turbo",
    "coverage", "dist", "build",
  ]);

  const rows = [];

  function walk(dir) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (exclude.has(entry.name)) continue;

      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(full);
        continue;
      }

      if (!entry.isFile()) continue;

      let stat;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }

      if (stat.size > 2_000_000) continue;

      const ext = path.extname(entry.name).toLowerCase();
      if (![
        ".ts", ".tsx", ".js", ".jsx", ".cjs", ".mjs",
        ".ps1", ".json", ".sql", ".md", ".txt",
        ".yml", ".yaml", ".toml"
      ].includes(ext)) continue;

      try {
        rows.push({
          file: posix(path.relative(ROOT, full)),
          text: fs.readFileSync(full, "utf8"),
        });
      } catch {}
    }
  }

  for (const root of roots) {
    const full = path.join(ROOT, root);
    if (fs.existsSync(full)) walk(full);
  }

  return rows;
}

function refsFor(file, corpus) {
  const refs = [];

  for (const row of corpus) {
    if (
      row.text.includes(file) ||
      row.text.includes("./" + file)
    ) {
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

if (!fs.existsSync(path.join(ROOT, "package.json"))) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_ROOT_CLEANUP_PHASEA_PLAN_V1_FAILED",
    reason:
      "PACKAGE_JSON_NOT_FOUND",
  }, null, 2));
  process.exit(1);
}

if (!fs.existsSync(SOURCE_PLAN)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_ROOT_CLEANUP_PHASEA_PLAN_V1_FAILED",
    reason:
      "ROOT_CLEANUP_PLAN_V1_NOT_FOUND",
  }, null, 2));
  process.exit(1);
}

const sourcePlan =
  JSON.parse(fs.readFileSync(SOURCE_PLAN, "utf8"));

const allRows = [];

for (const [bucket, rows] of Object.entries(sourcePlan.buckets ?? {})) {
  for (const row of rows ?? []) {
    allRows.push({
      ...row,
      sourceBucket: bucket,
    });
  }
}

const tracked = trackedSet();
const status = statusMap();
const corpus = projectCorpus();
const tasks = taskText();

const buckets = {
  REMOVE_AFTER_EXTERNAL_BACKUP: [],
  ARCHIVE_ROOT_ARTIFACT: [],
  KEEP_CORE_OR_REFERENCED: [],
  HOLD_DIRTY: [],
  HOLD_REFERENCED_NOW: [],
  HOLD_MANUAL_SOURCE: [],
};

for (const row of allRows) {
  const file = row.file;
  const full = path.join(ROOT, file);

  if (!fs.existsSync(full)) continue;

  const nowTracked = tracked.has(file);
  const nowStatus = status.get(file) || null;
  const refs = refsFor(file, corpus);
  const taskReference = tasks.includes(file);

  const facts = {
    file,
    sourceBucket: row.sourceBucket,
    sizeBytes: fs.statSync(full).size,
    trackedNow: nowTracked,
    gitStatusNow: nowStatus,
    currentReferenceCount: refs.length,
    currentReferences: refs,
    taskReferenceNow: taskReference,
  };

  if (
    row.sourceBucket === "KEEP_CORE" ||
    row.sourceBucket === "KEEP_SENSITIVE" ||
    row.sourceBucket === "KEEP_REFERENCED" ||
    CORE_PROTECT_PATTERNS.some((rx) => rx.test(file))
  ) {
    buckets.KEEP_CORE_OR_REFERENCED.push({
      ...facts,
      reason: "CORE_OR_PREVIOUSLY_REFERENCED",
    });
    continue;
  }

  if (
    nowStatus &&
    nowStatus !== "??"
  ) {
    buckets.HOLD_DIRTY.push({
      ...facts,
      reason: "CURRENT_GIT_CHANGE_PRESENT",
    });
    continue;
  }

  if (
    refs.length > 0 ||
    taskReference
  ) {
    buckets.HOLD_REFERENCED_NOW.push({
      ...facts,
      reason:
        taskReference
          ? "WINDOWS_TASK_REFERENCE_NOW"
          : "CURRENT_PROJECT_REFERENCE_NOW",
    });
    continue;
  }

  if (
    row.sourceBucket === "DELETE_CANDIDATE_STRONG" ||
    DISPOSABLE_PATTERNS.some((rx) => rx.test(file))
  ) {
    buckets.REMOVE_AFTER_EXTERNAL_BACKUP.push({
      ...facts,
      reason:
        row.sourceBucket === "DELETE_CANDIDATE_STRONG"
          ? "PREVIOUS_STRONG_DELETE_CANDIDATE"
          : "GENERATED_OR_BACKUP_ROOT_ARTIFACT",
    });
    continue;
  }

  if (ARCHIVE_PATTERNS.some((rx) => rx.test(file))) {
    buckets.ARCHIVE_ROOT_ARTIFACT.push({
      ...facts,
      reason:
        "HISTORICAL_DOCUMENT_PACKAGE_OR_ANALYSIS_ARTIFACT",
    });
    continue;
  }

  buckets.HOLD_MANUAL_SOURCE.push({
    ...facts,
    reason:
      "SOURCE_OR_OPERATIONAL_ROLE_REQUIRES_SEPARATE_REVIEW",
  });
}

for (const key of Object.keys(buckets)) {
  buckets[key].sort((a, b) =>
    a.file.localeCompare(b.file)
  );
}

const summary = {
  removeAfterExternalBackup:
    buckets.REMOVE_AFTER_EXTERNAL_BACKUP.length,
  archiveRootArtifact:
    buckets.ARCHIVE_ROOT_ARTIFACT.length,
  phaseACandidateTotal:
    buckets.REMOVE_AFTER_EXTERNAL_BACKUP.length +
    buckets.ARCHIVE_ROOT_ARTIFACT.length,
  keepCoreOrReferenced:
    buckets.KEEP_CORE_OR_REFERENCED.length,
  holdDirty:
    buckets.HOLD_DIRTY.length,
  holdReferencedNow:
    buckets.HOLD_REFERENCED_NOW.length,
  holdManualSource:
    buckets.HOLD_MANUAL_SOURCE.length,
  totalAccounted:
    Object.values(buckets)
      .reduce((sum, rows) => sum + rows.length, 0),
};

const report = {
  status:
    "AI_STOCK_LAB_ROOT_CLEANUP_PHASEA_PLAN_V1_COMPLETE",

  classification:
    "ROOT_OBVIOUS_ARTIFACTS_ONLY_NO_MUTATION",

  summary,
  buckets,

  policy: {
    phaseA:
      "Only obvious backup/generated artifacts and historical documentation/packages are candidates.",
    removal:
      "All Phase A candidates must be copied to an external backup and SHA256-verified before removal from repo root.",
    held:
      "Versioned TS/PS1/SQL source and operational-looking files are held for a later source-specific review.",
  },

  safety: {
    planOnly: true,
    filesMoved: 0,
    filesDeleted: 0,
    sourceModified: 0,
    envModified: false,
    stage7Modified: false,
    scheduledTaskModified: false,
    databaseWrites: 0,
    realTradingChanged: false,
  },

  nextGate:
    "REVIEW_PHASEA_CANDIDATES_THEN_GENERATE_DRY_RUN_APPLY",
};

fs.mkdirSync(path.join(ROOT, "logs"), { recursive: true });

fs.writeFileSync(
  path.join(
    ROOT,
    "logs",
    "root-cleanup-phaseA-plan-v1.json"
  ),
  JSON.stringify(report, null, 2),
  "utf8"
);

console.log(JSON.stringify(report, null, 2));
process.exit(0);
