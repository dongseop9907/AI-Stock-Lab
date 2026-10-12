const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const crypto = require("crypto");

const ROOT = process.cwd();
const APPLY = process.argv.includes("--apply");

const PLAN_FILE =
  path.join(ROOT, "logs", "safe-cleanup-phase3b-plan-v1.json");

const EXTERNAL_ROOT =
  path.resolve(
    ROOT,
    "..",
    "ai-stock-lab-cleanup-backup-20261012-phase3b"
  );

const CRITICAL_PATTERNS = [
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

function packageText() {
  const p = path.join(ROOT, "package.json");
  return fs.existsSync(p)
    ? fs.readFileSync(p, "utf8")
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

function sha256(full) {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(full));
  return h.digest("hex");
}

function isCritical(file) {
  return CRITICAL_PATTERNS.some((rx) => rx.test(file));
}

function copyVerified(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);

  const sourceHash = sha256(src);
  const backupHash = sha256(dst);

  if (sourceHash !== backupHash) {
    throw new Error(`HASH_MISMATCH:${src}:${dst}`);
  }

  return { sourceHash, backupHash };
}

if (!fs.existsSync(path.join(ROOT, "package.json"))) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_SAFE_CLEANUP_PHASE3B_APPLY_V1_FAILED",
    reason:
      "PACKAGE_JSON_NOT_FOUND",
  }, null, 2));
  process.exit(1);
}

if (!fs.existsSync(PLAN_FILE)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_SAFE_CLEANUP_PHASE3B_APPLY_V1_FAILED",
    reason:
      "PHASE3B_PLAN_NOT_FOUND",
  }, null, 2));
  process.exit(1);
}

const plan =
  JSON.parse(fs.readFileSync(PLAN_FILE, "utf8"));

const sourceRepair =
  plan?.buckets?.ARCHIVE_SAFE_REPAIR ?? [];

const sourceDiagnostic =
  plan?.buckets?.ARCHIVE_SAFE_DIAGNOSTIC ?? [];

const tracked = trackedSet();
const gitStatus = statusMap();
const pkg = packageText();
const tasks = scheduledTaskText();

const safe = [];
const held = [];

function evaluate(row, type) {
  const file = row.file;
  const full = path.resolve(ROOT, file);
  const base = path.basename(file);

  const checks = {
    sourceExists: fs.existsSync(full),
    trackedNow: tracked.has(file),
    gitStatusNow: gitStatus.get(file) || null,
    referenceCountFromPlan: row.referenceCount ?? 0,
    packageReferenceNow:
      pkg.includes(file) || pkg.includes(base),
    scheduledTaskReferenceNow:
      tasks.includes(file) || tasks.includes(base),
    criticalName:
      isCritical(file),
  };

  const reasons = [];

  if (!checks.sourceExists) {
    reasons.push("SOURCE_MISSING");
  }

  // Stronger than the Phase3B planner:
  // ignored/untracked files are never auto-archived even if git status is blank.
  if (!checks.trackedNow) {
    reasons.push("NOT_GIT_TRACKED_NOW");
  }

  if (checks.gitStatusNow) {
    reasons.push(`GIT_STATUS_${checks.gitStatusNow}`);
  }

  if (checks.referenceCountFromPlan !== 0) {
    reasons.push("REFERENCE_COUNT_NONZERO");
  }

  if (checks.packageReferenceNow) {
    reasons.push("PACKAGE_JSON_REFERENCE_NOW");
  }

  if (checks.scheduledTaskReferenceNow) {
    reasons.push("WINDOWS_TASK_REFERENCE_NOW");
  }

  if (checks.criticalName) {
    reasons.push("CURRENT_CRITICAL_NAME_GUARD");
  }

  const record = {
    file,
    type,
    checks,
    planTracked: row.tracked ?? null,
    planConfidence: row.confidence ?? null,
    planReason: row.reason ?? null,
  };

  if (reasons.length === 0) {
    safe.push(record);
  } else {
    held.push({
      ...record,
      holdReasons: reasons,
    });
  }
}

for (const row of sourceRepair) {
  evaluate(row, "repair");
}

for (const row of sourceDiagnostic) {
  evaluate(row, "diagnostic");
}

const preflightFailures = [];

for (const row of safe) {
  const src = path.resolve(ROOT, row.file);

  const relative =
    row.file.replace(/^scripts\//i, "");

  const dst = path.join(
    EXTERNAL_ROOT,
    row.type === "repair"
      ? "repairs"
      : "diagnostics",
    relative
  );

  if (fs.existsSync(dst)) {
    preflightFailures.push({
      file: row.file,
      reason: "EXTERNAL_ARCHIVE_COLLISION",
      destination: dst,
    });
  }

  if (!src.startsWith(path.resolve(ROOT) + path.sep)) {
    preflightFailures.push({
      file: row.file,
      reason: "SOURCE_OUTSIDE_REPO",
    });
  }
}

const summary = {
  planArchiveSafeRepair:
    sourceRepair.length,
  planArchiveSafeDiagnostic:
    sourceDiagnostic.length,
  planArchiveSafeTotal:
    sourceRepair.length + sourceDiagnostic.length,

  strictSafeRepair:
    safe.filter((x) => x.type === "repair").length,
  strictSafeDiagnostic:
    safe.filter((x) => x.type === "diagnostic").length,
  strictSafeTotal:
    safe.length,

  heldBack:
    held.length,

  preflightFailures:
    preflightFailures.length,
};

if (preflightFailures.length > 0) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_SAFE_CLEANUP_PHASE3B_APPLY_V1_PREFLIGHT_REVIEW",

    classification:
      "NO_MUTATION_PREFLIGHT_BLOCKED",

    summary,
    heldBack:
      held.slice(0, 100),
    preflightFailures,

    safety: {
      filesArchived: 0,
      filesRemovedFromRepo: 0,
      stage7RuntimeModified: false,
      migrationsModified: false,
      envModified: false,
      scheduledTaskModified: false,
      databaseWrites: 0,
      realTradingChanged: false,
    },
  }, null, 2));

  process.exit(1);
}

if (!APPLY) {
  console.log(JSON.stringify({
    status:
      "AI_STOCK_LAB_SAFE_CLEANUP_PHASE3B_APPLY_V1_DRY_RUN_PASS",

    classification:
      "STRICT_TRACKED_CLEAN_UNREFERENCED_ARCHIVE_SAFE_ONLY",

    summary,

    heldBack:
      held.slice(0, 100),

    sampleSafe:
      safe.slice(0, 50),

    destination:
      EXTERNAL_ROOT,

    safety: {
      dryRun: true,
      filesArchived: 0,
      filesRemovedFromRepo: 0,
      stage7RuntimeModified: false,
      migrationsModified: false,
      envModified: false,
      scheduledTaskModified: false,
      databaseWrites: 0,
      realTradingChanged: false,
    },

    nextGate:
      "RUN_WITH_--apply_ONLY_AFTER_REVIEWING_STRICT_SAFE_AND_HELD_COUNTS",
  }, null, 2));

  process.exit(0);
}

fs.mkdirSync(EXTERNAL_ROOT, { recursive: true });

const applied = [];

try {
  for (const row of safe) {
    const src = path.resolve(ROOT, row.file);

    const relative =
      row.file.replace(/^scripts\//i, "");

    const dst = path.join(
      EXTERNAL_ROOT,
      row.type === "repair"
        ? "repairs"
        : "diagnostics",
      relative
    );

    const proof = copyVerified(src, dst);

    fs.unlinkSync(src);

    applied.push({
      action:
        "ARCHIVE_EXTERNAL_AND_REMOVE_REPO_SOURCE",
      type:
        row.type,
      source:
        row.file,
      destination:
        dst,
      sha256:
        proof.backupHash,
      sourceRemoved:
        !fs.existsSync(src),
      destinationExists:
        fs.existsSync(dst),
    });
  }
} catch (error) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_SAFE_CLEANUP_PHASE3B_APPLY_V1_PARTIAL_FAILURE",
    reason:
      error instanceof Error
        ? error.message
        : String(error),
    appliedCount:
      applied.length,
    applied,
    recoveryRoot:
      EXTERNAL_ROOT,
  }, null, 2));

  process.exit(1);
}

const manifest = {
  status:
    "AI_STOCK_LAB_SAFE_CLEANUP_PHASE3B_APPLY_V1_COMPLETE",

  appliedAt:
    new Date().toISOString(),

  classification:
    "STRICT_SAFE_REPAIR_AND_DIAGNOSTIC_ARCHIVED_EXTERNALLY",

  summary: {
    repairArchived:
      applied.filter((x) => x.type === "repair").length,
    diagnosticArchived:
      applied.filter((x) => x.type === "diagnostic").length,
    total:
      applied.length,
    heldBack:
      held.length,
  },

  heldBack,
  applied,

  safety: {
    externalBackupVerifiedBySha256: true,
    onlyStrictTrackedCleanCandidatesUsed: true,
    stage7RuntimeModified: false,
    migrationsModified: false,
    envModified: false,
    scheduledTaskModified: false,
    databaseWrites: 0,
    realTradingChanged: false,
  },

  nextGate:
    "RUN_TSC_TASK_CHECK_AND_PHASE3C_RESCAN",
};

fs.writeFileSync(
  path.join(EXTERNAL_ROOT, "manifest.json"),
  JSON.stringify(manifest, null, 2),
  "utf8"
);

console.log(JSON.stringify(manifest, null, 2));
process.exit(0);
