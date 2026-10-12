const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const crypto = require("crypto");

const ROOT = process.cwd();
const APPLY = process.argv.includes("--apply");

const PLAN_FILE =
  path.join(
    ROOT,
    "logs",
    "root-cleanup-phaseB-plan-v1.json"
  );

const EXTERNAL_ROOT =
  path.resolve(
    ROOT,
    "..",
    "ai-stock-lab-cleanup-backup-20261012-root-phaseB1"
  );

const MANIFEST_FILE =
  path.join(EXTERNAL_ROOT, "manifest.json");

const PROGRESS_FILE =
  path.join(EXTERNAL_ROOT, "progress.json");

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

function sha256(file) {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(file));
  return h.digest("hex");
}

function copyVerified(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);

  const sourceHash = sha256(src);
  const backupHash = sha256(dst);

  if (sourceHash !== backupHash) {
    throw new Error(
      `SHA256_BACKUP_MISMATCH:${src}:${dst}`
    );
  }

  return {
    sourceHash,
    backupHash,
  };
}

function currentDuplicateProof(sourceFile, duplicatePaths) {
  const src = path.join(ROOT, sourceFile);

  if (!fs.existsSync(src)) {
    return {
      ok: false,
      reason: "SOURCE_MISSING",
      matchedDuplicate: null,
      sourceHash: null,
      duplicateHash: null,
    };
  }

  const sourceHash = sha256(src);

  for (const duplicate of duplicatePaths) {
    const duplicateFull = path.join(ROOT, duplicate);

    if (!fs.existsSync(duplicateFull)) continue;

    try {
      const duplicateHash = sha256(duplicateFull);

      if (duplicateHash === sourceHash) {
        return {
          ok: true,
          reason: null,
          matchedDuplicate: duplicate,
          sourceHash,
          duplicateHash,
        };
      }
    } catch {}
  }

  return {
    ok: false,
    reason: "NO_CURRENT_BYTE_IDENTICAL_ACTIVE_COPY",
    matchedDuplicate: null,
    sourceHash,
    duplicateHash: null,
  };
}

if (!fs.existsSync(path.join(ROOT, "package.json"))) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_ROOT_CLEANUP_PHASEB1_APPLY_V1_FAILED",
    reason:
      "PACKAGE_JSON_NOT_FOUND",
  }, null, 2));
  process.exit(1);
}

if (!fs.existsSync(PLAN_FILE)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_ROOT_CLEANUP_PHASEB1_APPLY_V1_FAILED",
    reason:
      "PHASEB_PLAN_NOT_FOUND",
  }, null, 2));
  process.exit(1);
}

const plan =
  JSON.parse(fs.readFileSync(PLAN_FILE, "utf8"));

const candidates =
  plan?.buckets?.ARCHIVE_EXACT_DUPLICATE ?? [];

const EXPECTED_COUNT = 43;

if (candidates.length !== EXPECTED_COUNT) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_ROOT_CLEANUP_PHASEB1_APPLY_V1_PREFLIGHT_REVIEW",
    reason:
      "PLAN_COUNT_CHANGED",
    expected:
      EXPECTED_COUNT,
    actual:
      candidates.length,
    safety: {
      filesBackedUp: 0,
      filesRemoved: 0,
      repoMutation: false,
    },
  }, null, 2));
  process.exit(1);
}

const tracked = trackedSet();
const status = statusMap();
const pkg = packageText();
const tasks = taskText();

const safe = [];
const blocked = [];

for (const row of candidates) {
  const file = row.file;
  const full = path.join(ROOT, file);
  const base = path.basename(file);

  const sourceExists =
    fs.existsSync(full);

  const trackedNow =
    tracked.has(file);

  const gitStatusNow =
    status.get(file) || null;

  const packageReferenceNow =
    pkg.includes(file) ||
    pkg.includes(base);

  const taskReferenceNow =
    tasks.includes(file) ||
    tasks.includes(base);

  const priorReferenceCount =
    row.currentReferenceCount ?? 0;

  const plannedDuplicates =
    Array.isArray(row.exactDuplicatesElsewhere)
      ? row.exactDuplicatesElsewhere
      : [];

  const duplicateProof =
    currentDuplicateProof(
      file,
      plannedDuplicates
    );

  const reasons = [];

  if (!sourceExists) {
    reasons.push("SOURCE_MISSING");
  }

  if (!trackedNow) {
    reasons.push("NOT_GIT_TRACKED_NOW");
  }

  if (gitStatusNow) {
    reasons.push(
      `CURRENT_GIT_STATUS_${gitStatusNow}`
    );
  }

  if (packageReferenceNow) {
    reasons.push("PACKAGE_JSON_REFERENCE_NOW");
  }

  if (taskReferenceNow) {
    reasons.push("WINDOWS_TASK_REFERENCE_NOW");
  }

  if (priorReferenceCount !== 0) {
    reasons.push("PRIOR_REFERENCE_COUNT_NONZERO");
  }

  if (!duplicateProof.ok) {
    reasons.push(
      duplicateProof.reason ||
      "DUPLICATE_PROOF_FAILED"
    );
  }

  const record = {
    file,
    sourceExists,
    trackedNow,
    gitStatusNow,
    packageReferenceNow,
    taskReferenceNow,
    priorReferenceCount,
    plannedDuplicates,
    duplicateProof,
  };

  if (reasons.length === 0) {
    safe.push(record);
  } else {
    blocked.push({
      ...record,
      reasons,
    });
  }
}

const collisions = [];

for (const row of safe) {
  const dst =
    path.join(
      EXTERNAL_ROOT,
      "exact-duplicates",
      row.file
    );

  if (fs.existsSync(dst)) {
    collisions.push({
      file: row.file,
      destination: dst,
      reason:
        "EXTERNAL_BACKUP_COLLISION",
    });
  }
}

const summary = {
  planExactDuplicates:
    candidates.length,

  safeExactDuplicates:
    safe.length,

  blocked:
    blocked.length,

  collisions:
    collisions.length,
};

if (
  blocked.length > 0 ||
  collisions.length > 0
) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_ROOT_CLEANUP_PHASEB1_APPLY_V1_PREFLIGHT_REVIEW",

    classification:
      "NO_MUTATION_PREFLIGHT_BLOCKED",

    summary,
    blocked,
    collisions,

    safety: {
      filesBackedUp: 0,
      filesRemoved: 0,
      repoMutation: false,
      stage7Modified: false,
      envModified: false,
      scheduledTaskModified: false,
      databaseWrites: 0,
      realTradingChanged: false,
    },

    nextGate:
      "DO_NOT_APPLY_REVIEW_PREFLIGHT",
  }, null, 2));

  process.exit(1);
}

if (!APPLY) {
  console.log(JSON.stringify({
    status:
      "AI_STOCK_LAB_ROOT_CLEANUP_PHASEB1_APPLY_V1_DRY_RUN_PASS",

    classification:
      "ROOT_43_BYTE_IDENTICAL_DUPLICATES_PREFLIGHT_SAFE_NO_MUTATION",

    summary,

    externalBackupRoot:
      EXTERNAL_ROOT,

    candidates:
      safe,

    safety: {
      dryRun: true,
      filesBackedUp: 0,
      filesRemoved: 0,
      repoMutation: false,
      stage7Modified: false,
      envModified: false,
      scheduledTaskModified: false,
      databaseWrites: 0,
      realTradingChanged: false,
    },

    nextGate:
      "RUN_--apply_ONLY_AFTER_DRY_RUN_REVIEW",
  }, null, 2));

  process.exit(0);
}

fs.mkdirSync(
  EXTERNAL_ROOT,
  { recursive: true }
);

const applied = [];

function writeProgress(statusValue, error = null) {
  fs.writeFileSync(
    PROGRESS_FILE,
    JSON.stringify({
      status:
        statusValue,
      updatedAt:
        new Date().toISOString(),
      expectedCount:
        EXPECTED_COUNT,
      appliedCount:
        applied.length,
      applied,
      error,
    }, null, 2),
    "utf8"
  );
}

writeProgress("STARTED");

try {
  for (const row of safe) {
    const src =
      path.join(ROOT, row.file);

    // Re-check immediately before each destructive step.
    const duplicateProof =
      currentDuplicateProof(
        row.file,
        row.plannedDuplicates
      );

    if (!duplicateProof.ok) {
      throw new Error(
        `FINAL_DUPLICATE_PROOF_FAILED:${row.file}`
      );
    }

    const dst =
      path.join(
        EXTERNAL_ROOT,
        "exact-duplicates",
        row.file
      );

    const hashes =
      copyVerified(src, dst);

    fs.unlinkSync(src);

    applied.push({
      file:
        row.file,

      activeIdenticalCopy:
        duplicateProof.matchedDuplicate,

      destination:
        dst,

      sha256:
        hashes.backupHash,

      sourceRemoved:
        !fs.existsSync(src),

      backupExists:
        fs.existsSync(dst),

      activeCopyStillExists:
        fs.existsSync(
          path.join(
            ROOT,
            duplicateProof.matchedDuplicate
          )
        ),
    });

    writeProgress("IN_PROGRESS");
  }
} catch (error) {
  const message =
    error instanceof Error
      ? error.message
      : String(error);

  writeProgress(
    "PARTIAL_FAILURE",
    message
  );

  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_ROOT_CLEANUP_PHASEB1_APPLY_V1_PARTIAL_FAILURE",

    reason:
      message,

    appliedCount:
      applied.length,

    progressFile:
      PROGRESS_FILE,

    externalBackupRoot:
      EXTERNAL_ROOT,

    important:
      "DO_NOT_RERUN_BLINDLY_USE_PROGRESS_FOR_RECOVERY",
  }, null, 2));

  process.exit(1);
}

const manifest = {
  status:
    "AI_STOCK_LAB_ROOT_CLEANUP_PHASEB1_APPLY_V1_COMPLETE",

  appliedAt:
    new Date().toISOString(),

  classification:
    "ROOT_BYTE_IDENTICAL_ACTIVE_DUPLICATES_EXTERNALLY_BACKED_UP_AND_REMOVED",

  summary: {
    exactDuplicatesRemoved:
      applied.length,
    total:
      applied.length,
  },

  applied,

  safety: {
    sourceHadCurrentByteIdenticalActiveCopy:
      true,

    externalBackupSha256Verified:
      true,

    activeCopiesPreserved:
      applied.every(
        (x) => x.activeCopyStillExists
      ),

    stage7Modified:
      false,

    envModified:
      false,

    scheduledTaskModified:
      false,

    databaseWrites:
      0,

    realTradingChanged:
      false,
  },

  nextGate:
    "VERIFY_TSC_TASK_AND_ROOT_COUNT_THEN_PHASEB2_REVIEW",
};

fs.writeFileSync(
  MANIFEST_FILE,
  JSON.stringify(manifest, null, 2),
  "utf8"
);

writeProgress("COMPLETE");

console.log(
  JSON.stringify(manifest, null, 2)
);

process.exit(0);
