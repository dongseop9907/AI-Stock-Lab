const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const ROOT = process.cwd();

const PLAN_V1 =
  path.join(ROOT, "logs", "safe-cleanup-phase3c-plan-v1.json");

const STRICT_PROTECT_PATTERNS = [
  /forward/i,
  /oos/i,
  /shadow/i,
  /stage7/i,
  /promot/i,
  /walk-forward/i,
  /replay/i,
  /corporate-action/i,
  /calendar/i,
  /paper/i,
  /risk/i,
  /kill-switch/i,
  /scheduler/i,
  /maintenance/i,
  /governance/i,
  /accounting/i,
  /execution/i,
  /top1/i,
  /data-freshness/i,
  /backfill/i,
  /live/i,
  /controlled/i,
  /maturity/i,
  /collector/i,
  /provenance/i,
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

function packageText() {
  const file = path.join(ROOT, "package.json");

  return fs.existsSync(file)
    ? fs.readFileSync(file, "utf8")
    : "";
}

function scheduledTaskText() {
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

function exists(file) {
  return fs.existsSync(path.join(ROOT, file));
}

function strictProtected(file) {
  return STRICT_PROTECT_PATTERNS.some(
    (rx) => rx.test(file)
  );
}

if (!fs.existsSync(path.join(ROOT, "package.json"))) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_SAFE_CLEANUP_PHASE3C_STRICT_PLAN_V2_FAILED",
    reason:
      "PACKAGE_JSON_NOT_FOUND",
  }, null, 2));

  process.exit(1);
}

if (!fs.existsSync(PLAN_V1)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_SAFE_CLEANUP_PHASE3C_STRICT_PLAN_V2_FAILED",
    reason:
      "PHASE3C_PLAN_V1_NOT_FOUND",
  }, null, 2));

  process.exit(1);
}

const v1 =
  JSON.parse(fs.readFileSync(PLAN_V1, "utf8"));

const tracked = trackedSet();
const status = statusMap();
const pkg = packageText();
const tasks = scheduledTaskText();

const sources = [];

for (const row of v1?.buckets?.ARCHIVE_SAFE_RESEARCH ?? []) {
  sources.push({
    ...row,
    sourceBucket: "ARCHIVE_SAFE_RESEARCH",
  });
}

for (const row of v1?.buckets?.ARCHIVE_SAFE_LEGACY ?? []) {
  sources.push({
    ...row,
    sourceBucket: "ARCHIVE_SAFE_LEGACY",
  });
}

for (const row of v1?.buckets?.RELOCATE_ROOT_INSTALLER ?? []) {
  sources.push({
    ...row,
    sourceBucket: "RELOCATE_ROOT_INSTALLER",
  });
}

for (const row of v1?.buckets?.REVIEW_MANUAL_FINAL ?? []) {
  sources.push({
    ...row,
    sourceBucket: "REVIEW_MANUAL_FINAL",
  });
}

const buckets = {
  ARCHIVE_STRICT_RESEARCH: [],
  ARCHIVE_STRICT_LEGACY: [],
  RELOCATE_STRICT_INSTALLER: [],
  KEEP_STRICT_SAFETY: [],
  KEEP_REFERENCED_NOW: [],
  REVIEW_DIRTY: [],
  REVIEW_UNTRACKED: [],
  REVIEW_FINAL: [],
  ALREADY_GONE: [],
};

for (const row of sources) {
  const file = row.file;
  const base = path.basename(file);

  const current = {
    exists: exists(file),
    trackedNow: tracked.has(file),
    gitStatusNow: status.get(file) || null,
    packageReferenceNow:
      pkg.includes(file) || pkg.includes(base),
    taskReferenceNow:
      tasks.includes(file) || tasks.includes(base),
    priorReferenceCount:
      row.referenceCount ?? 0,
    strictProtectedName:
      strictProtected(file),
  };

  const output = {
    file,
    sourceBucket: row.sourceBucket,
    confidence: row.confidence ?? null,
    previousReason: row.reason ?? null,
    ...current,
  };

  if (!current.exists) {
    buckets.ALREADY_GONE.push({
      ...output,
      reason: "SOURCE_NO_LONGER_EXISTS",
    });
    continue;
  }

  if (current.strictProtectedName) {
    buckets.KEEP_STRICT_SAFETY.push({
      ...output,
      reason: "STRICT_FINAL_SAFETY_KEYWORD_GUARD",
    });
    continue;
  }

  if (
    current.packageReferenceNow ||
    current.taskReferenceNow ||
    current.priorReferenceCount > 0
  ) {
    buckets.KEEP_REFERENCED_NOW.push({
      ...output,
      reason: "CURRENT_OR_PRIOR_REFERENCE_PRESENT",
    });
    continue;
  }

  if (
    current.gitStatusNow &&
    current.gitStatusNow !== "??"
  ) {
    buckets.REVIEW_DIRTY.push({
      ...output,
      reason: "CURRENT_GIT_CHANGE_PRESENT",
    });
    continue;
  }

  if (
    !current.trackedNow ||
    current.gitStatusNow === "??"
  ) {
    buckets.REVIEW_UNTRACKED.push({
      ...output,
      reason: "NOT_GIT_TRACKED_NOW",
    });
    continue;
  }

  if (
    row.sourceBucket === "RELOCATE_ROOT_INSTALLER" &&
    /^scripts\/install-.+\.cjs$/i.test(file)
  ) {
    buckets.RELOCATE_STRICT_INSTALLER.push({
      ...output,
      reason: "CLEAN_UNREFERENCED_ROOT_INSTALLER",
    });
    continue;
  }

  if (
    row.sourceBucket === "ARCHIVE_SAFE_RESEARCH" &&
    /(?:extract|inspect|analy[sz]e|compare|trace|viewer|fetch|field-extraction)/i.test(file)
  ) {
    buckets.ARCHIVE_STRICT_RESEARCH.push({
      ...output,
      reason: "STRICT_CLEAN_UNREFERENCED_RESEARCH_ARTIFACT",
    });
    continue;
  }

  if (
    row.sourceBucket === "ARCHIVE_SAFE_LEGACY" &&
    /^scripts\/v(?:9|8|7)\d/i.test(file)
  ) {
    buckets.ARCHIVE_STRICT_LEGACY.push({
      ...output,
      reason: "STRICT_CLEAN_UNREFERENCED_VERSIONED_LEGACY_ARTIFACT",
    });
    continue;
  }

  buckets.REVIEW_FINAL.push({
    ...output,
    reason: "FINAL_ROLE_REMAINS_AMBIGUOUS_OR_INTENTIONALLY_HELD",
  });
}

for (const key of Object.keys(buckets)) {
  buckets[key].sort((a, b) =>
    a.file.localeCompare(b.file)
  );
}

const summary = {
  sourceCandidateCount: sources.length,

  strictArchiveResearch:
    buckets.ARCHIVE_STRICT_RESEARCH.length,

  strictArchiveLegacy:
    buckets.ARCHIVE_STRICT_LEGACY.length,

  strictArchiveTotal:
    buckets.ARCHIVE_STRICT_RESEARCH.length +
    buckets.ARCHIVE_STRICT_LEGACY.length,

  strictRelocateInstaller:
    buckets.RELOCATE_STRICT_INSTALLER.length,

  strictSafetyKeep:
    buckets.KEEP_STRICT_SAFETY.length,

  referencedKeep:
    buckets.KEEP_REFERENCED_NOW.length,

  protectedTotal:
    buckets.KEEP_STRICT_SAFETY.length +
    buckets.KEEP_REFERENCED_NOW.length,

  reviewDirty:
    buckets.REVIEW_DIRTY.length,

  reviewUntracked:
    buckets.REVIEW_UNTRACKED.length,

  reviewFinal:
    buckets.REVIEW_FINAL.length,

  reviewTotal:
    buckets.REVIEW_DIRTY.length +
    buckets.REVIEW_UNTRACKED.length +
    buckets.REVIEW_FINAL.length,

  alreadyGone:
    buckets.ALREADY_GONE.length,
};

const report = {
  status:
    "AI_STOCK_LAB_SAFE_CLEANUP_PHASE3C_STRICT_PLAN_V2_COMPLETE",

  classification:
    "FINAL_STRICT_RECLASSIFICATION_NO_MUTATION",

  summary,
  buckets,

  safetyPolicy: {
    newlyProtectedKeywords: [
      "forward/oos/shadow/stage7",
      "promote/promotion",
      "walk-forward/replay",
      "corporate-action/calendar",
      "paper/risk/kill-switch",
      "scheduler/maintenance/governance",
      "accounting/execution",
      "top1/data-freshness",
      "backfill/live/controlled",
      "maturity/collector/provenance",
    ],

    mutationPolicy:
      "NO_MUTATION_IN_THIS_STAGE",

    futureArchivePolicy:
      "external SHA256-verified backup before repo source removal",

    futureInstallerPolicy:
      "move only strict clean unreferenced root installers to scripts/installers/archive",
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
    "GENERATE_PHASE3C_STRICT_APPLY_DRY_RUN_FOR_STRICT_ARCHIVE_AND_RELOCATE_ONLY",
};

fs.mkdirSync(
  path.join(ROOT, "logs"),
  { recursive: true }
);

fs.writeFileSync(
  path.join(
    ROOT,
    "logs",
    "safe-cleanup-phase3c-strict-plan-v2.json"
  ),
  JSON.stringify(report, null, 2),
  "utf8"
);

function compact(rows, limit = 60) {
  return rows.slice(0, limit).map((row) => ({
    file: row.file,
    sourceBucket: row.sourceBucket,
    reason: row.reason,
    trackedNow: row.trackedNow,
    gitStatusNow: row.gitStatusNow,
    priorReferenceCount: row.priorReferenceCount,
    packageReferenceNow: row.packageReferenceNow,
    taskReferenceNow: row.taskReferenceNow,
    strictProtectedName: row.strictProtectedName,
  }));
}

console.log(JSON.stringify({
  status: report.status,
  classification: report.classification,
  summary,

  samples: {
    archiveStrictResearch:
      compact(buckets.ARCHIVE_STRICT_RESEARCH),

    archiveStrictLegacy:
      compact(buckets.ARCHIVE_STRICT_LEGACY),

    relocateStrictInstaller:
      compact(buckets.RELOCATE_STRICT_INSTALLER),

    keepStrictSafety:
      compact(buckets.KEEP_STRICT_SAFETY),

    keepReferencedNow:
      compact(buckets.KEEP_REFERENCED_NOW),

    reviewDirty:
      compact(buckets.REVIEW_DIRTY),

    reviewUntracked:
      compact(buckets.REVIEW_UNTRACKED),

    reviewFinal:
      compact(buckets.REVIEW_FINAL),
  },

  truncated: {
    archiveStrictResearch:
      buckets.ARCHIVE_STRICT_RESEARCH.length > 60,
    archiveStrictLegacy:
      buckets.ARCHIVE_STRICT_LEGACY.length > 60,
    relocateStrictInstaller:
      buckets.RELOCATE_STRICT_INSTALLER.length > 60,
    keepStrictSafety:
      buckets.KEEP_STRICT_SAFETY.length > 60,
    keepReferencedNow:
      buckets.KEEP_REFERENCED_NOW.length > 60,
    reviewDirty:
      buckets.REVIEW_DIRTY.length > 60,
    reviewUntracked:
      buckets.REVIEW_UNTRACKED.length > 60,
    reviewFinal:
      buckets.REVIEW_FINAL.length > 60,
  },

  report:
    "logs/safe-cleanup-phase3c-strict-plan-v2.json",

  safety:
    report.safety,

  nextGate:
    report.nextGate,
}, null, 2));

process.exit(0);
