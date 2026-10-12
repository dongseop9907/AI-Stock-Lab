const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const crypto = require("crypto");

const ROOT = process.cwd();

const PLAN_FILE =
  path.join(ROOT, "logs", "safe-cleanup-phase3b-plan-v1.json");

const DRY_RUN_LOG =
  path.join(
    ROOT,
    "logs",
    "chatgpt-safe-cleanup-phase3b-apply-dry-run-v1.txt"
  );

const EXTERNAL_ROOT =
  path.resolve(
    ROOT,
    "..",
    "ai-stock-lab-cleanup-backup-20261012-phase3b"
  );

const MANIFEST_FILE =
  path.join(EXTERNAL_ROOT, "manifest.json");

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

function runGit(args, encoding = "utf8") {
  try {
    return cp.execFileSync(
      "git",
      args,
      {
        cwd: ROOT,
        encoding,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
  } catch (error) {
    return null;
  }
}

function sha256File(full) {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(full));
  return h.digest("hex");
}

function isCritical(file) {
  return CRITICAL_PATTERNS.some((rx) => rx.test(file));
}

function getIndexBlob(file) {
  const raw = runGit(["ls-files", "-s", "--", file]);

  if (!raw) return null;

  const line = String(raw)
    .split(/\r?\n/)
    .find(Boolean);

  if (!line) return null;

  const m = line.match(/^\d+\s+([0-9a-f]{40,64})\s+\d+\t/);

  return m ? m[1] : null;
}

function getFilteredBackupBlob(file, backup) {
  const raw = runGit([
    "hash-object",
    `--path=${file}`,
    backup,
  ]);

  return raw ? String(raw).trim() : null;
}

if (!fs.existsSync(path.join(ROOT, "package.json"))) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_SAFE_CLEANUP_PHASE3B_FINALIZE_V1_FAILED",
    reason:
      "PACKAGE_JSON_NOT_FOUND",
  }, null, 2));
  process.exit(1);
}

if (!fs.existsSync(PLAN_FILE)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_SAFE_CLEANUP_PHASE3B_FINALIZE_V1_FAILED",
    reason:
      "PHASE3B_PLAN_NOT_FOUND",
  }, null, 2));
  process.exit(1);
}

if (!fs.existsSync(DRY_RUN_LOG)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_SAFE_CLEANUP_PHASE3B_FINALIZE_V1_FAILED",
    reason:
      "PHASE3B_DRY_RUN_LOG_NOT_FOUND",
  }, null, 2));
  process.exit(1);
}

const dryRunText =
  fs.readFileSync(DRY_RUN_LOG, "utf8");

const dryRunContract = {
  pass:
    dryRunText.includes(
      "AI_STOCK_LAB_SAFE_CLEANUP_PHASE3B_APPLY_V1_DRY_RUN_PASS"
    ),
  strictSafeTotal152:
    /"strictSafeTotal"\s*:\s*152/.test(dryRunText),
  heldBack0:
    /"heldBack"\s*:\s*0/.test(dryRunText),
  preflightFailures0:
    /"preflightFailures"\s*:\s*0/.test(dryRunText),
  tsc0:
    /Full TSC Exit\s*=\s*0/.test(dryRunText),
};

if (!Object.values(dryRunContract).every(Boolean)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_SAFE_CLEANUP_PHASE3B_FINALIZE_V1_REVIEW",
    reason:
      "DRY_RUN_CONTRACT_NOT_CONFIRMED",
    dryRunContract,
    safety: {
      repoFilesChanged: 0,
      filesDeleted: 0,
      filesRestored: 0,
    },
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

const contract = {
  repairCount: repairs.length,
  diagnosticCount: diagnostics.length,
  total: candidates.length,
};

if (
  contract.repairCount !== 56 ||
  contract.diagnosticCount !== 96 ||
  contract.total !== 152
) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_SAFE_CLEANUP_PHASE3B_FINALIZE_V1_REVIEW",
    reason:
      "PLAN_COUNTS_CHANGED",
    contract,
    safety: {
      repoFilesChanged: 0,
      filesDeleted: 0,
      filesRestored: 0,
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
      reason:
        "CRITICAL_NAME_APPEARED_IN_ARCHIVE_SAFE_PLAN",
    });
    continue;
  }

  const src =
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
    fs.existsSync(src);

  const backupExists =
    fs.existsSync(backup);

  const indexBlob =
    getIndexBlob(file);

  const backupBlob =
    backupExists
      ? getFilteredBackupBlob(file, backup)
      : null;

  const backupSha256 =
    backupExists
      ? sha256File(backup)
      : null;

  const ok =
    !sourceExists &&
    backupExists &&
    indexBlob !== null &&
    backupBlob !== null &&
    indexBlob === backupBlob;

  if (!ok) {
    failures.push({
      file,
      type: row.type,
      reason:
        "POST_CRASH_STATE_NOT_FULLY_VERIFIED",
      sourceExists,
      backupExists,
      indexBlob,
      backupBlob,
      backupSha256,
    });
    continue;
  }

  verified.push({
    action:
      "ARCHIVE_EXTERNAL_AND_REMOVE_REPO_SOURCE",
    type:
      row.type,
    source:
      file,
    destination:
      backup,
    sha256:
      backupSha256,
    gitIndexBlob:
      indexBlob,
    backupFilteredBlob:
      backupBlob,
    sourceRemoved:
      true,
    destinationExists:
      true,
    verifiedAgainstGitIndex:
      true,
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

if (failures.length > 0) {
  const report = {
    status:
      "AI_STOCK_LAB_SAFE_CLEANUP_PHASE3B_FINALIZE_V1_REVIEW",
    classification:
      "POST_CRASH_VERIFICATION_INCOMPLETE_NO_FURTHER_MUTATION",
    summary,
    failures,
    dryRunContract,
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
      "DO_NOT_RERUN_PHASE3B_APPLY_INSPECT_FAILURES_FIRST",
  };

  fs.mkdirSync(
    path.join(ROOT, "logs"),
    { recursive: true }
  );

  fs.writeFileSync(
    path.join(
      ROOT,
      "logs",
      "safe-cleanup-phase3b-finalize-review-v1.json"
    ),
    JSON.stringify(report, null, 2),
    "utf8"
  );

  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}

fs.mkdirSync(EXTERNAL_ROOT, { recursive: true });

const manifest = {
  status:
    "AI_STOCK_LAB_SAFE_CLEANUP_PHASE3B_APPLY_V1_COMPLETE_RECOVERED",

  recoveredAt:
    new Date().toISOString(),

  recoveryReason:
    "Original apply completed file loop but failed before manifest creation because manifest referenced undefined variable heldBack.",

  classification:
    "POST_CRASH_VERIFIED_EXTERNAL_ARCHIVE_COMPLETE",

  summary: {
    repairArchived: 56,
    diagnosticArchived: 96,
    total: 152,
    heldBack: 0,
  },

  verification: {
    dryRunContract,
    eachRepoSourceMissing: true,
    eachExternalBackupExists: true,
    eachExternalBackupMatchesGitIndexAfterPathFilters: true,
    verifiedCount:
      verified.length,
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

fs.mkdirSync(
  path.join(ROOT, "logs"),
  { recursive: true }
);

fs.writeFileSync(
  path.join(
    ROOT,
    "logs",
    "safe-cleanup-phase3b-finalize-v1.json"
  ),
  JSON.stringify({
    status:
      "AI_STOCK_LAB_SAFE_CLEANUP_PHASE3B_FINALIZE_V1_PASS",
    manifest:
      MANIFEST_FILE,
    summary:
      manifest.summary,
    verification:
      manifest.verification,
    safety:
      manifest.safety,
  }, null, 2),
  "utf8"
);

console.log(JSON.stringify({
  status:
    "AI_STOCK_LAB_SAFE_CLEANUP_PHASE3B_FINALIZE_V1_PASS",
  classification:
    manifest.classification,
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
}, null, 2));

process.exit(0);
