const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const crypto = require("crypto");

const ROOT = process.cwd();

const PLAN_FILE =
  path.join(ROOT, "logs", "safe-cleanup-phase3b-plan-v1.json");

const EXTERNAL_ROOT =
  path.resolve(
    ROOT,
    "..",
    "ai-stock-lab-cleanup-backup-20261012-phase3b"
  );

const MANIFEST_FILE =
  path.join(EXTERNAL_ROOT, "manifest.json");

const REVIEW_FILE =
  path.join(
    ROOT,
    "logs",
    "safe-cleanup-phase3b-finalize-v2-review.json"
  );

const PASS_FILE =
  path.join(
    ROOT,
    "logs",
    "safe-cleanup-phase3b-finalize-v2.json"
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

function sha256(full) {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(full));
  return h.digest("hex");
}

function isCritical(file) {
  return CRITICAL_PATTERNS.some((rx) => rx.test(file));
}

function getIndexBlob(file) {
  const raw = git(["ls-files", "-s", "--", file]);

  if (!raw) return null;

  const line =
    raw.split(/\r?\n/).find(Boolean);

  if (!line) return null;

  const m =
    line.match(/^\d+\s+([0-9a-f]{40,64})\s+\d+\t/);

  return m ? m[1] : null;
}

function getBackupFilteredBlob(file, backup) {
  const raw = git([
    "hash-object",
    `--path=${file}`,
    backup,
  ]);

  return raw || null;
}

if (!fs.existsSync(path.join(ROOT, "package.json"))) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_SAFE_CLEANUP_PHASE3B_FINALIZE_V2_FAILED",
    reason:
      "PACKAGE_JSON_NOT_FOUND",
  }, null, 2));
  process.exit(1);
}

if (!fs.existsSync(PLAN_FILE)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_SAFE_CLEANUP_PHASE3B_FINALIZE_V2_FAILED",
    reason:
      "PHASE3B_PLAN_NOT_FOUND",
  }, null, 2));
  process.exit(1);
}

const plan =
  JSON.parse(fs.readFileSync(PLAN_FILE, "utf8"));

const repairs =
  plan?.buckets?.ARCHIVE_SAFE_REPAIR ?? [];

const diagnostics =
  plan?.buckets?.ARCHIVE_SAFE_DIAGNOSTIC ?? [];

const candidates = [
  ...repairs.map((row) => ({
    ...row,
    type: "repair",
  })),
  ...diagnostics.map((row) => ({
    ...row,
    type: "diagnostic",
  })),
];

const expected = {
  repair: 56,
  diagnostic: 96,
  total: 152,
};

if (
  repairs.length !== expected.repair ||
  diagnostics.length !== expected.diagnostic ||
  candidates.length !== expected.total
) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_SAFE_CLEANUP_PHASE3B_FINALIZE_V2_REVIEW",
    reason:
      "PLAN_COUNTS_CHANGED",
    expected,
    actual: {
      repair: repairs.length,
      diagnostic: diagnostics.length,
      total: candidates.length,
    },
    safety: {
      repoFilesChanged: 0,
      filesDeleted: 0,
      filesRestored: 0,
      manifestWritten: false,
    },
  }, null, 2));
  process.exit(1);
}

const verified = [];
const failures = [];

for (const row of candidates) {
  const file = row.file;

  if (isCritical(file)) {
    failures.push({
      file,
      type: row.type,
      reason:
        "CRITICAL_NAME_APPEARED_IN_ARCHIVE_SAFE_PLAN",
    });
    continue;
  }

  const source =
    path.resolve(ROOT, file);

  const relative =
    file.replace(/^scripts\//i, "");

  const backup =
    path.join(
      EXTERNAL_ROOT,
      row.type === "repair"
        ? "repairs"
        : "diagnostics",
      relative
    );

  const sourceExists =
    fs.existsSync(source);

  const backupExists =
    fs.existsSync(backup);

  const indexBlob =
    getIndexBlob(file);

  const backupFilteredBlob =
    backupExists
      ? getBackupFilteredBlob(file, backup)
      : null;

  const backupSha256 =
    backupExists
      ? sha256(backup)
      : null;

  const indexTracked =
    indexBlob !== null;

  const backupMatchesGitIndex =
    indexTracked &&
    backupFilteredBlob !== null &&
    indexBlob === backupFilteredBlob;

  const ok =
    sourceExists === false &&
    backupExists === true &&
    indexTracked === true &&
    backupMatchesGitIndex === true;

  if (!ok) {
    failures.push({
      file,
      type: row.type,
      reason:
        "POST_CRASH_ARCHIVE_STATE_NOT_VERIFIED",
      checks: {
        sourceExists,
        backupExists,
        indexTracked,
        indexBlob,
        backupFilteredBlob,
        backupMatchesGitIndex,
        backupSha256,
      },
    });

    continue;
  }

  verified.push({
    action:
      "ARCHIVE_EXTERNAL_AND_REMOVE_REPO_SOURCE",
    type: row.type,
    source: file,
    destination: backup,
    sha256: backupSha256,
    gitIndexBlob: indexBlob,
    backupFilteredBlob,
    sourceRemoved: true,
    destinationExists: true,
    verifiedAgainstGitIndex: true,
  });
}

const summary = {
  repairVerified:
    verified.filter((x) => x.type === "repair").length,
  diagnosticVerified:
    verified.filter((x) => x.type === "diagnostic").length,
  totalVerified:
    verified.length,
  failures:
    failures.length,
};

fs.mkdirSync(
  path.join(ROOT, "logs"),
  { recursive: true }
);

if (failures.length > 0) {
  const review = {
    status:
      "AI_STOCK_LAB_SAFE_CLEANUP_PHASE3B_FINALIZE_V2_REVIEW",

    classification:
      "POST_CRASH_VERIFICATION_INCOMPLETE_NO_MUTATION",

    expected,
    summary,

    failures,

    safety: {
      repoFilesChangedByFinalizer: 0,
      filesDeletedByFinalizer: 0,
      filesRestoredByFinalizer: 0,
      manifestWritten: false,
      databaseWrites: 0,
      scheduledTaskModified: false,
      realTradingChanged: false,
    },

    nextGate:
      "DO_NOT_RERUN_ORIGINAL_APPLY_INSPECT_FAILURES_FIRST",
  };

  fs.writeFileSync(
    REVIEW_FILE,
    JSON.stringify(review, null, 2),
    "utf8"
  );

  console.error(
    JSON.stringify(review, null, 2)
  );

  process.exit(1);
}

fs.mkdirSync(
  EXTERNAL_ROOT,
  { recursive: true }
);

const manifest = {
  status:
    "AI_STOCK_LAB_SAFE_CLEANUP_PHASE3B_APPLY_V1_COMPLETE_RECOVERED",

  recoveredAt:
    new Date().toISOString(),

  recoveryReason:
    "Original Phase3B apply finished its archive/remove loop and then crashed while constructing its manifest because of an undefined variable. V2 verified all candidates directly against the Git index and external backups.",

  classification:
    "POST_CRASH_VERIFIED_EXTERNAL_ARCHIVE_COMPLETE",

  summary: {
    repairArchived: 56,
    diagnosticArchived: 96,
    total: 152,
    heldBack: 0,
  },

  verification: {
    expectedCandidateCount: 152,
    eachRepoSourceMissing: true,
    eachExternalBackupExists: true,
    eachCandidateStillTrackedInGitIndex: true,
    eachExternalBackupMatchesGitIndexAfterPathFilters: true,
    verifiedCount: verified.length,
  },

  heldBack: [],
  applied: verified,

  safety: {
    finalizerModifiedRepoFiles: false,
    finalizerDeletedFiles: 0,
    finalizerRestoredFiles: 0,
    externalManifestWritten: true,
    stage7RuntimeModifiedByFinalizer: false,
    migrationsModifiedByFinalizer: false,
    envModifiedByFinalizer: false,
    scheduledTaskModifiedByFinalizer: false,
    databaseWrites: 0,
    realTradingChanged: false,
  },

  nextGate:
    "RUN_TSC_STAGE7_TASK_CHECK_THEN_PHASE3C_RESCAN",
};

fs.writeFileSync(
  MANIFEST_FILE,
  JSON.stringify(manifest, null, 2),
  "utf8"
);

const pass = {
  status:
    "AI_STOCK_LAB_SAFE_CLEANUP_PHASE3B_FINALIZE_V2_PASS",

  manifest:
    MANIFEST_FILE,

  summary:
    manifest.summary,

  verification:
    manifest.verification,

  safety:
    manifest.safety,

  nextGate:
    manifest.nextGate,
};

fs.writeFileSync(
  PASS_FILE,
  JSON.stringify(pass, null, 2),
  "utf8"
);

console.log(
  JSON.stringify(pass, null, 2)
);

process.exit(0);
