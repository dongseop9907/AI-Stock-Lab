const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const ROOT = process.cwd();
const REPORT = path.join(ROOT, "logs", "safe-cleanup-audit-v2.json");

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

function loadReport() {
  if (!fs.existsSync(REPORT)) {
    throw new Error("SAFE_CLEANUP_AUDIT_V2_REPORT_NOT_FOUND");
  }

  return JSON.parse(fs.readFileSync(REPORT, "utf8"));
}

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function classify(row, tracked, status) {
  const file = row.file;
  const isTracked = tracked.has(file);
  const gitStatus = status.get(file) || null;

  if (/^scripts\/backups\//i.test(file)) {
    return {
      group: "BACKUP_TREE",
      action: "ARCHIVE_EXTERNAL",
      confidence: "HIGH",
      destination:
        "archive/cleanup-phase2/backups/" +
        file.replace(/^scripts\/backups\//i, ""),
      reason:
        "unreferenced backup-tree file; preserve outside working scripts tree",
      isTracked,
      gitStatus,
    };
  }

  if (
    /^scripts\/install-.+\.cjs$/i.test(file) &&
    row.generatedTarget &&
    exists(row.generatedTarget)
  ) {
    return {
      group: "OLD_INSTALLER_WITH_GENERATED_TARGET",
      action: "MOVE_TO_INSTALLERS_ARCHIVE",
      confidence: "HIGH",
      destination:
        "scripts/installers/archive/" +
        path.basename(file),
      reason:
        "unreferenced installer; generated runtime target already exists",
      isTracked,
      gitStatus,
    };
  }

  return {
    group: "UNRESOLVED_ARCHIVE_CANDIDATE",
    action: "REVIEW",
    confidence: "LOW",
    destination: null,
    reason:
      "candidate did not match Phase2 safe archive rules",
    isTracked,
    gitStatus,
  };
}

let report;

try {
  report = loadReport();
} catch (error) {
  console.error(JSON.stringify({
    status: "AI_STOCK_LAB_SAFE_CLEANUP_PHASE2_PLAN_V1_FAILED",
    reason:
      error instanceof Error
        ? error.message
        : String(error),
  }, null, 2));
  process.exit(1);
}

const archiveRows =
  report?.buckets?.ARCHIVE_CANDIDATE;

if (!Array.isArray(archiveRows)) {
  console.error(JSON.stringify({
    status: "AI_STOCK_LAB_SAFE_CLEANUP_PHASE2_PLAN_V1_FAILED",
    reason: "ARCHIVE_CANDIDATE_BUCKET_MISSING",
  }, null, 2));
  process.exit(1);
}

const tracked = trackedSet();
const status = statusMap();

const planned = archiveRows.map((row) => ({
  ...row,
  phase2: classify(row, tracked, status),
}));

const groups = {
  MOVE_TO_INSTALLERS_ARCHIVE: [],
  ARCHIVE_EXTERNAL: [],
  REVIEW: [],
};

for (const row of planned) {
  groups[row.phase2.action].push(row);
}

const blockers = planned.filter((row) => {
  if (row.phase2.action === "REVIEW") return true;

  // If the candidate itself currently has an unstaged/staged modification,
  // don't mutate it in Phase2.
  if (row.phase2.gitStatus) return true;

  return false;
});

const collisions = planned.filter((row) => {
  if (!row.phase2.destination) return false;

  const dst = path.join(ROOT, row.phase2.destination);
  return fs.existsSync(dst);
});

const summary = {
  sourceArchiveCandidates: archiveRows.length,
  moveToInstallersArchive:
    groups.MOVE_TO_INSTALLERS_ARCHIVE.length,
  archiveExternal:
    groups.ARCHIVE_EXTERNAL.length,
  review:
    groups.REVIEW.length,
  blockers:
    blockers.length,
  collisions:
    collisions.length,
};

const output = {
  status:
    blockers.length === 0 && collisions.length === 0
      ? "AI_STOCK_LAB_SAFE_CLEANUP_PHASE2_PLAN_V1_PASS"
      : "AI_STOCK_LAB_SAFE_CLEANUP_PHASE2_PLAN_V1_REVIEW",

  classification:
    "PHASE2_ARCHIVE_PLAN_ONLY_NO_FILES_MOVED",

  summary,

  groups: {
    moveToInstallersArchive:
      groups.MOVE_TO_INSTALLERS_ARCHIVE.map((row) => ({
        file: row.file,
        destination: row.phase2.destination,
        tracked: row.phase2.isTracked,
        gitStatus: row.phase2.gitStatus,
        generatedTarget: row.generatedTarget,
      })),

    archiveExternal:
      groups.ARCHIVE_EXTERNAL.map((row) => ({
        file: row.file,
        destination: row.phase2.destination,
        tracked: row.phase2.isTracked,
        gitStatus: row.phase2.gitStatus,
      })),

    review:
      groups.REVIEW.map((row) => ({
        file: row.file,
        reason: row.phase2.reason,
        tracked: row.phase2.isTracked,
        gitStatus: row.phase2.gitStatus,
      })),
  },

  blockers: blockers.map((row) => ({
    file: row.file,
    action: row.phase2.action,
    gitStatus: row.phase2.gitStatus,
    reason:
      row.phase2.action === "REVIEW"
        ? row.phase2.reason
        : "candidate currently has git modifications; excluded from automatic mutation",
  })),

  collisions: collisions.map((row) => ({
    file: row.file,
    destination: row.phase2.destination,
  })),

  safety: {
    planOnly: true,
    filesMoved: 0,
    filesDeleted: 0,
    filesRenamed: 0,
    stage7Modified: false,
    migrationsModified: false,
    envModified: false,
    scheduledTaskModified: false,
    databaseWrites: 0,
    realTradingChanged: false,
  },

  nextGate:
    blockers.length === 0 && collisions.length === 0
      ? "GENERATE_PHASE2_APPLY_SCRIPT"
      : "RESOLVE_PHASE2_BLOCKERS_BEFORE_ANY_MOVE",
};

const outFile = path.join(
  ROOT,
  "logs",
  "safe-cleanup-phase2-plan-v1.json"
);

fs.writeFileSync(
  outFile,
  JSON.stringify(output, null, 2),
  "utf8"
);

console.log(JSON.stringify({
  status: output.status,
  classification: output.classification,
  summary: output.summary,

  sample: {
    moveToInstallersArchive:
      output.groups.moveToInstallersArchive.slice(0, 25),

    archiveExternal:
      output.groups.archiveExternal.slice(0, 25),

    review:
      output.groups.review.slice(0, 25),

    blockers:
      output.blockers.slice(0, 25),

    collisions:
      output.collisions.slice(0, 25),
  },

  report:
    "logs/safe-cleanup-phase2-plan-v1.json",

  safety: output.safety,
  nextGate: output.nextGate,
}, null, 2));

process.exitCode =
  output.status.endsWith("_PASS")
    ? 0
    : 1;
