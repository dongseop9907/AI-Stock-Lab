const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = process.cwd();

const PLAN_FILE =
  path.join(
    ROOT,
    "logs",
    "safe-cleanup-phase3c-strict-plan-v2.json"
  );

const EXTERNAL_ROOT =
  path.resolve(
    ROOT,
    "..",
    "ai-stock-lab-cleanup-backup-20261012-phase3c"
  );

const MANIFEST_FILE =
  path.join(EXTERNAL_ROOT, "manifest.json");

function sha256(file) {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(file));
  return h.digest("hex");
}

if (!fs.existsSync(path.join(ROOT, "package.json"))) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_PHASE3C_POST_APPLY_DIAGNOSTIC_V1_FAILED",
    reason:
      "PACKAGE_JSON_NOT_FOUND"
  }, null, 2));
  process.exit(1);
}

if (!fs.existsSync(PLAN_FILE)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_PHASE3C_POST_APPLY_DIAGNOSTIC_V1_FAILED",
    reason:
      "STRICT_PLAN_V2_NOT_FOUND"
  }, null, 2));
  process.exit(1);
}

const plan =
  JSON.parse(fs.readFileSync(PLAN_FILE, "utf8"));

const research =
  plan?.buckets?.ARCHIVE_STRICT_RESEARCH ?? [];

const legacy =
  plan?.buckets?.ARCHIVE_STRICT_LEGACY ?? [];

const candidates = [
  ...research.map((row) => ({
    ...row,
    type: "research",
  })),
  ...legacy.map((row) => ({
    ...row,
    type: "legacy",
  })),
];

const states = [];
const counts = {
  expected: candidates.length,
  sourcePresentBackupMissing: 0,
  sourcePresentBackupPresent: 0,
  sourceMissingBackupPresent: 0,
  sourceMissingBackupMissing: 0,
  backupHashReadable: 0,
  manifestExists: fs.existsSync(MANIFEST_FILE),
};

for (const row of candidates) {
  const source =
    path.resolve(ROOT, row.file);

  const relative =
    row.file.replace(/^scripts\//i, "");

  const backup =
    path.join(
      EXTERNAL_ROOT,
      row.type === "research"
        ? "research"
        : "legacy",
      relative
    );

  const sourceExists =
    fs.existsSync(source);

  const backupExists =
    fs.existsSync(backup);

  let state;

  if (sourceExists && !backupExists) {
    state = "SOURCE_PRESENT_BACKUP_MISSING";
    counts.sourcePresentBackupMissing++;
  }
  else if (sourceExists && backupExists) {
    state = "SOURCE_PRESENT_BACKUP_PRESENT";
    counts.sourcePresentBackupPresent++;
  }
  else if (!sourceExists && backupExists) {
    state = "SOURCE_MISSING_BACKUP_PRESENT";
    counts.sourceMissingBackupPresent++;
  }
  else {
    state = "SOURCE_MISSING_BACKUP_MISSING";
    counts.sourceMissingBackupMissing++;
  }

  let sourceSha256 = null;
  let backupSha256 = null;
  let byteIdentical = null;

  try {
    if (sourceExists) {
      sourceSha256 = sha256(source);
    }

    if (backupExists) {
      backupSha256 = sha256(backup);
      counts.backupHashReadable++;
    }

    if (sourceExists && backupExists) {
      byteIdentical =
        sourceSha256 === backupSha256;
    }
  } catch {}

  states.push({
    file: row.file,
    type: row.type,
    state,
    sourceExists,
    backupExists,
    sourceSha256,
    backupSha256,
    byteIdentical,
  });
}

let manifest = null;

if (counts.manifestExists) {
  try {
    manifest =
      JSON.parse(fs.readFileSync(MANIFEST_FILE, "utf8"));
  } catch (error) {
    manifest = {
      parseError:
        error instanceof Error
          ? error.message
          : String(error),
    };
  }
}

let diagnosis;

if (
  counts.sourcePresentBackupMissing === candidates.length &&
  counts.sourcePresentBackupPresent === 0 &&
  counts.sourceMissingBackupPresent === 0 &&
  counts.sourceMissingBackupMissing === 0
) {
  diagnosis =
    "NO_MUTATION_DETECTED_LIKELY_PREFLIGHT_BLOCK";
}
else if (
  counts.sourceMissingBackupPresent === candidates.length &&
  counts.sourcePresentBackupMissing === 0 &&
  counts.sourcePresentBackupPresent === 0 &&
  counts.sourceMissingBackupMissing === 0
) {
  diagnosis =
    "ALL_89_ARCHIVE_REMOVE_ACTIONS_APPEAR_COMPLETE_MANIFEST_MAY_NEED_VERIFY_OR_RECOVERY";
}
else {
  diagnosis =
    "MIXED_STATE_POSSIBLE_PARTIAL_APPLY_DO_NOT_RERUN_ORIGINAL_APPLY";
}

const report = {
  status:
    "AI_STOCK_LAB_PHASE3C_POST_APPLY_DIAGNOSTIC_V1_COMPLETE",

  classification:
    "READ_ONLY_POST_FAILURE_STATE_INSPECTION",

  diagnosis,

  counts,

  manifest,

  stateGroups: {
    sourcePresentBackupMissing:
      states.filter(
        (x) => x.state === "SOURCE_PRESENT_BACKUP_MISSING"
      ),

    sourcePresentBackupPresent:
      states.filter(
        (x) => x.state === "SOURCE_PRESENT_BACKUP_PRESENT"
      ),

    sourceMissingBackupPresent:
      states.filter(
        (x) => x.state === "SOURCE_MISSING_BACKUP_PRESENT"
      ),

    sourceMissingBackupMissing:
      states.filter(
        (x) => x.state === "SOURCE_MISSING_BACKUP_MISSING"
      ),
  },

  safety: {
    readOnly: true,
    repoFilesChanged: 0,
    filesMoved: 0,
    filesDeleted: 0,
    filesRestored: 0,
    manifestWritten: false,
    databaseWrites: 0,
    scheduledTaskModified: false,
    realTradingChanged: false,
  },

  nextGate:
    diagnosis === "NO_MUTATION_DETECTED_LIKELY_PREFLIGHT_BLOCK"
      ? "CAPTURE_ORIGINAL_APPLY_STDERR_AND_PATCH_PREFLIGHT_CAUSE"
      : diagnosis === "ALL_89_ARCHIVE_REMOVE_ACTIONS_APPEAR_COMPLETE_MANIFEST_MAY_NEED_VERIFY_OR_RECOVERY"
        ? "VERIFY_ALL_89_BACKUPS_AND_RECOVER_OR_ACCEPT_MANIFEST"
        : "RECOVER_PARTIAL_APPLY_WITHOUT_RERUNNING_ORIGINAL_APPLY",
};

fs.mkdirSync(
  path.join(ROOT, "logs"),
  { recursive: true }
);

fs.writeFileSync(
  path.join(
    ROOT,
    "logs",
    "phase3c-post-apply-diagnostic-v1.json"
  ),
  JSON.stringify(report, null, 2),
  "utf8"
);

console.log(JSON.stringify(report, null, 2));
process.exit(0);
