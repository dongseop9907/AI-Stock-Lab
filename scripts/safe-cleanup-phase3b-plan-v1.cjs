const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const ROOT = process.cwd();

const PLAN_FILE =
  path.join(ROOT, "logs", "safe-cleanup-phase3-plan-v1.json");

const CURRENT_CRITICAL_PATTERNS = [
  /forward-oos/i,
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
];

const EXACT_PROTECTED = new Set([
  "scripts/run-shadow-controlled-producer-0850.ps1",
  "scripts/true-forward-oos-controlled-producer-evidence-run-v1.ts",
  "scripts/true-forward-oos-controlled-normal-producer-v1.ts",
  "scripts/alpha-v3-true-forward-top1-producer-v1.ts",
  "scripts/true-forward-oos-first-real-session-readiness-v1.ts",
  "scripts/true-forward-oos-post-capture-maturity-audit-v1.ts",
  "scripts/true-forward-oos-maturity-aware-collector-gate-v1.ts",
  "scripts/forward-oos-data-quality-integrity-monitor-v1.ts",
  "scripts/model-shadow-canonical-lifecycle-watch-v1.ts",
]);

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

function gitStatusMap() {
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

function packageJsonText() {
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

function isCriticalName(file) {
  if (EXACT_PROTECTED.has(file)) return true;
  return CURRENT_CRITICAL_PATTERNS.some((rx) => rx.test(file));
}

function exists(file) {
  return fs.existsSync(path.join(ROOT, file));
}

function loadPlan() {
  if (!fs.existsSync(PLAN_FILE)) {
    throw new Error("PHASE3_PLAN_FILE_NOT_FOUND");
  }

  return JSON.parse(
    fs.readFileSync(PLAN_FILE, "utf8")
  );
}

function classify(row, type, gitStatus, pkgText, taskText) {
  const file = row.file;
  const base = path.basename(file);

  if (!exists(file)) {
    return {
      bucket: "ALREADY_GONE",
      confidence: "HIGH",
      reason: "FILE_NO_LONGER_EXISTS_AFTER_PHASE3A",
    };
  }

  if (isCriticalName(file)) {
    return {
      bucket: "KEEP_CURRENT_STAGE_OR_SAFETY",
      confidence: "HIGH",
      reason: "CURRENT_FORWARD_SHADOW_PROMOTION_RISK_OR_SCHEDULER_SURFACE",
    };
  }

  if (pkgText.includes(file) || pkgText.includes(base)) {
    return {
      bucket: "KEEP_REFERENCED_NOW",
      confidence: "HIGH",
      reason: "PACKAGE_JSON_REFERENCE_FOUND_POST_PHASE3A",
    };
  }

  if (taskText.includes(file) || taskText.includes(base)) {
    return {
      bucket: "KEEP_REFERENCED_NOW",
      confidence: "HIGH",
      reason: "WINDOWS_SCHEDULED_TASK_REFERENCE_FOUND",
    };
  }

  if ((row.referenceCount ?? 0) > 0) {
    return {
      bucket: "KEEP_REFERENCED_NOW",
      confidence: "HIGH",
      reason: "PREVIOUS_PROJECT_REFERENCE_COUNT_NONZERO",
    };
  }

  if (gitStatus && gitStatus !== "??") {
    return {
      bucket: "REVIEW_DIRTY",
      confidence: "HIGH",
      reason: "FILE_HAS_GIT_MODIFICATIONS",
    };
  }

  if (gitStatus === "??") {
    return {
      bucket: "REVIEW_UNTRACKED",
      confidence: "MEDIUM",
      reason: "UNTRACKED_FILE_REQUIRES_MANUAL_DECISION",
    };
  }

  if (
    type === "repair" &&
    /^scripts\/(?:fix-|repair-|patch-)/i.test(file)
  ) {
    return {
      bucket: "ARCHIVE_SAFE_REPAIR",
      confidence: "MEDIUM",
      reason: "UNREFERENCED_CLEAN_ONE_SHOT_REPAIR_FIX_PATCH_SCRIPT",
    };
  }

  if (
    type === "diagnostic" &&
    /(?:probe|diag|diagnostic|audit|verify|contract-test|regression|stress|smoke)/i
      .test(file)
  ) {
    return {
      bucket: "ARCHIVE_SAFE_DIAGNOSTIC",
      confidence: "MEDIUM",
      reason: "UNREFERENCED_CLEAN_DIAGNOSTIC_OR_TEST_SCRIPT",
    };
  }

  return {
    bucket: "REVIEW_MANUAL",
    confidence: "LOW",
    reason: "ROLE_NOT_SAFE_TO_INFER",
  };
}

if (!fs.existsSync(path.join(ROOT, "package.json"))) {
  console.error(JSON.stringify({
    status: "AI_STOCK_LAB_SAFE_CLEANUP_PHASE3B_PLAN_V1_FAILED",
    reason: "PACKAGE_JSON_NOT_FOUND",
  }, null, 2));
  process.exit(1);
}

let prior;

try {
  prior = loadPlan();
} catch (error) {
  console.error(JSON.stringify({
    status: "AI_STOCK_LAB_SAFE_CLEANUP_PHASE3B_PLAN_V1_FAILED",
    reason:
      error instanceof Error
        ? error.message
        : String(error),
  }, null, 2));
  process.exit(1);
}

const repairs =
  prior?.buckets?.REPAIR_ARCHIVE_CANDIDATE ?? [];

const diagnostics =
  prior?.buckets?.DIAGNOSTIC_ARCHIVE_CANDIDATE ?? [];

const gitMap = gitStatusMap();
const pkgText = packageJsonText();
const taskText = scheduledTaskText();

const buckets = {
  ARCHIVE_SAFE_REPAIR: [],
  ARCHIVE_SAFE_DIAGNOSTIC: [],
  KEEP_CURRENT_STAGE_OR_SAFETY: [],
  KEEP_REFERENCED_NOW: [],
  REVIEW_DIRTY: [],
  REVIEW_UNTRACKED: [],
  REVIEW_MANUAL: [],
  ALREADY_GONE: [],
};

function processRows(rows, type) {
  for (const row of rows) {
    const status = gitMap.get(row.file) || null;
    const cls = classify(
      row,
      type,
      status,
      pkgText,
      taskText
    );

    buckets[cls.bucket].push({
      file: row.file,
      sourceBucket:
        type === "repair"
          ? "REPAIR_ARCHIVE_CANDIDATE"
          : "DIAGNOSTIC_ARCHIVE_CANDIDATE",
      confidence: cls.confidence,
      reason: cls.reason,
      tracked: row.tracked ?? null,
      gitStatus: status,
      referenceCount: row.referenceCount ?? 0,
      previousReason: row.reason ?? null,
      exists: exists(row.file),
    });
  }
}

processRows(repairs, "repair");
processRows(diagnostics, "diagnostic");

const archiveSafeCount =
  buckets.ARCHIVE_SAFE_REPAIR.length +
  buckets.ARCHIVE_SAFE_DIAGNOSTIC.length;

const protectedCount =
  buckets.KEEP_CURRENT_STAGE_OR_SAFETY.length +
  buckets.KEEP_REFERENCED_NOW.length;

const reviewCount =
  buckets.REVIEW_DIRTY.length +
  buckets.REVIEW_UNTRACKED.length +
  buckets.REVIEW_MANUAL.length;

const summary = {
  sourceRepairCount: repairs.length,
  sourceDiagnosticCount: diagnostics.length,
  totalInput: repairs.length + diagnostics.length,
  archiveSafeRepair: buckets.ARCHIVE_SAFE_REPAIR.length,
  archiveSafeDiagnostic: buckets.ARCHIVE_SAFE_DIAGNOSTIC.length,
  archiveSafeTotal: archiveSafeCount,
  protectedCurrentStageOrSafety:
    buckets.KEEP_CURRENT_STAGE_OR_SAFETY.length,
  referencedNow:
    buckets.KEEP_REFERENCED_NOW.length,
  protectedTotal: protectedCount,
  reviewDirty:
    buckets.REVIEW_DIRTY.length,
  reviewUntracked:
    buckets.REVIEW_UNTRACKED.length,
  reviewManual:
    buckets.REVIEW_MANUAL.length,
  reviewTotal: reviewCount,
  alreadyGone:
    buckets.ALREADY_GONE.length,
};

const report = {
  status:
    "AI_STOCK_LAB_SAFE_CLEANUP_PHASE3B_PLAN_V1_COMPLETE",

  classification:
    "FIX_REPAIR_AND_DIAGNOSTIC_RECLASSIFICATION_ONLY_NO_MUTATION",

  summary,
  buckets,

  intendedArchiveRoot:
    "../ai-stock-lab-cleanup-backup-20261012-phase3b/",

  policy: {
    autoArchiveAllowedOnlyFor: [
      "ARCHIVE_SAFE_REPAIR",
      "ARCHIVE_SAFE_DIAGNOSTIC",
    ],
    neverAutoArchiveWhen: [
      "current Forward OOS / SHADOW / promotion / scheduler / risk surface",
      "referenced by package.json",
      "referenced by Windows Scheduled Tasks",
      "previous reference count is nonzero",
      "tracked file currently modified",
      "untracked file",
      "role remains ambiguous",
    ],
    deletionPolicy:
      "NO_DIRECT_DELETE; archive externally with SHA256 verification first",
  },

  safety: {
    planOnly: true,
    filesMoved: 0,
    filesDeleted: 0,
    sourceModified: 0,
    stage7Modified: false,
    migrationsModified: false,
    envModified: false,
    scheduledTaskModified: false,
    databaseWrites: 0,
    realTradingChanged: false,
  },

  nextGate:
    archiveSafeCount > 0
      ? "GENERATE_PHASE3B_DRY_RUN_APPLY_FOR_ARCHIVE_SAFE_ONLY"
      : "NO_PHASE3B_AUTO_ARCHIVE_REVIEW_MANUALLY",
};

fs.mkdirSync(
  path.join(ROOT, "logs"),
  { recursive: true }
);

fs.writeFileSync(
  path.join(
    ROOT,
    "logs",
    "safe-cleanup-phase3b-plan-v1.json"
  ),
  JSON.stringify(report, null, 2),
  "utf8"
);

function compact(rows, limit = 60) {
  return rows.slice(0, limit).map((row) => ({
    file: row.file,
    confidence: row.confidence,
    reason: row.reason,
    tracked: row.tracked,
    gitStatus: row.gitStatus,
    referenceCount: row.referenceCount,
  }));
}

console.log(JSON.stringify({
  status: report.status,
  classification: report.classification,
  summary,

  samples: {
    archiveSafeRepair:
      compact(buckets.ARCHIVE_SAFE_REPAIR),
    archiveSafeDiagnostic:
      compact(buckets.ARCHIVE_SAFE_DIAGNOSTIC),
    keepCurrentStageOrSafety:
      compact(buckets.KEEP_CURRENT_STAGE_OR_SAFETY),
    keepReferencedNow:
      compact(buckets.KEEP_REFERENCED_NOW),
    reviewDirty:
      compact(buckets.REVIEW_DIRTY),
    reviewUntracked:
      compact(buckets.REVIEW_UNTRACKED),
    reviewManual:
      compact(buckets.REVIEW_MANUAL),
  },

  truncated: {
    archiveSafeRepair:
      buckets.ARCHIVE_SAFE_REPAIR.length > 60,
    archiveSafeDiagnostic:
      buckets.ARCHIVE_SAFE_DIAGNOSTIC.length > 60,
    keepCurrentStageOrSafety:
      buckets.KEEP_CURRENT_STAGE_OR_SAFETY.length > 60,
    keepReferencedNow:
      buckets.KEEP_REFERENCED_NOW.length > 60,
    reviewDirty:
      buckets.REVIEW_DIRTY.length > 60,
    reviewUntracked:
      buckets.REVIEW_UNTRACKED.length > 60,
    reviewManual:
      buckets.REVIEW_MANUAL.length > 60,
  },

  report:
    "logs/safe-cleanup-phase3b-plan-v1.json",

  safety:
    report.safety,

  nextGate:
    report.nextGate,
}, null, 2));

process.exitCode = 0;
