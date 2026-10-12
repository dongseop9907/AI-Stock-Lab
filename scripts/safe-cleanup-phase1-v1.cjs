const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = process.cwd();
const APPLY = process.argv.includes("--apply");

const TARGETS = [
  "scripts/alpha-v3-automation-cycle-route-contract-test.ts.before-v1-1.bak",
  "scripts/alpha-v3-automation-cycle-scheduler-contract-test.ts.before-cjs-compat-v1.bak",
  "scripts/alpha-v3-automation-cycle-scheduler.ts.before-cjs-compat-v1.bak",
  "scripts/alpha-v3-cycle-probe-only-static-verify.cjs.before-v1-1.bak",
  "scripts/alpha-v3-cycle-probe-only-static-verify.cjs.before-v1-2.bak",
  "scripts/alpha-v3-manual-proxy-probe-only-live-smoke.cjs.before-v1-2.bak",
  "scripts/v91002-1.cjs.bak"
];

const BACKUP_ROOT = path.resolve(
  ROOT,
  "..",
  "ai-stock-lab-cleanup-backup-20261012-phase1"
);

function sha256(file) {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(file));
  return h.digest("hex");
}

function ensureInsideRoot(full) {
  const root = path.resolve(ROOT) + path.sep;
  const target = path.resolve(full);
  return target.startsWith(root);
}

if (!fs.existsSync(path.join(ROOT, "package.json"))) {
  console.error(JSON.stringify({
    status: "AI_STOCK_LAB_SAFE_CLEANUP_PHASE1_V1_FAILED",
    reason: "PACKAGE_JSON_NOT_FOUND",
  }, null, 2));
  process.exit(1);
}

const rows = [];
let failure = null;

for (const rel of TARGETS) {
  const src = path.resolve(ROOT, rel);

  if (!ensureInsideRoot(src)) {
    failure = {
      reason: "TARGET_OUTSIDE_REPO",
      file: rel,
    };
    break;
  }

  const exists = fs.existsSync(src);

  rows.push({
    file: rel,
    exists,
    size: exists ? fs.statSync(src).size : null,
    sha256: exists ? sha256(src) : null,
  });
}

if (failure) {
  console.error(JSON.stringify({
    status: "AI_STOCK_LAB_SAFE_CLEANUP_PHASE1_V1_FAILED",
    ...failure,
    safety: {
      filesDeleted: 0,
      stage7Modified: false,
      migrationsModified: false,
    },
  }, null, 2));
  process.exit(1);
}

const missing = rows.filter((r) => !r.exists);

if (missing.length > 0) {
  console.error(JSON.stringify({
    status: "AI_STOCK_LAB_SAFE_CLEANUP_PHASE1_V1_REVIEW",
    classification: "EXPECTED_BAK_FILE_MISSING",
    missing: missing.map((r) => r.file),
    rows,
    safety: {
      filesDeleted: 0,
      stage7Modified: false,
      migrationsModified: false,
    },
  }, null, 2));
  process.exit(1);
}

if (!APPLY) {
  console.log(JSON.stringify({
    status: "AI_STOCK_LAB_SAFE_CLEANUP_PHASE1_V1_DRY_RUN_PASS",
    classification: "EXACT_ALLOWLIST_7_TRACKED_BAK_FILES_ONLY",
    applyRequired: "--apply",
    targets: rows,
    backupRoot: BACKUP_ROOT,
    plan: [
      "copy each target to external backup folder",
      "verify source and backup SHA256 match",
      "delete only exact allowlisted .bak source",
      "write cleanup manifest outside repo"
    ],
    safety: {
      filesDeleted: 0,
      filesMoved: 0,
      stage7Modified: false,
      migrationsModified: false,
      envModified: false,
      scheduledTaskModified: false,
      databaseWrites: 0,
      realTradingChanged: false,
    },
    nextGate: "RUN_WITH_--apply_AFTER_DRY_RUN_REVIEW",
  }, null, 2));
  process.exit(0);
}

fs.mkdirSync(BACKUP_ROOT, { recursive: true });

const applied = [];

for (const row of rows) {
  const src = path.resolve(ROOT, row.file);
  const dst = path.resolve(BACKUP_ROOT, row.file);

  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);

  const backupHash = sha256(dst);

  if (backupHash !== row.sha256) {
    console.error(JSON.stringify({
      status: "AI_STOCK_LAB_SAFE_CLEANUP_PHASE1_V1_FAILED",
      reason: "BACKUP_HASH_MISMATCH",
      file: row.file,
      sourceHash: row.sha256,
      backupHash,
      filesAlreadyDeleted: applied.map((x) => x.file),
    }, null, 2));
    process.exit(1);
  }

  fs.unlinkSync(src);

  applied.push({
    file: row.file,
    sourceHash: row.sha256,
    backupFile: dst,
    backupHash,
    deletedFromRepo: !fs.existsSync(src),
  });
}

const manifest = {
  status: "AI_STOCK_LAB_SAFE_CLEANUP_PHASE1_V1_APPLIED",
  appliedAt: new Date().toISOString(),
  classification: "ONLY_7_EXACT_BAK_FILES_REMOVED_AFTER_HASH_VERIFIED_EXTERNAL_BACKUP",
  backupRoot: BACKUP_ROOT,
  files: applied,
  safety: {
    exactAllowlistOnly: true,
    filesDeleted: applied.length,
    stage7Modified: false,
    migrationsModified: false,
    envModified: false,
    scheduledTaskModified: false,
    databaseWrites: 0,
    realTradingChanged: false,
  },
  nextGate: "RUN_TSC_AND_GIT_DIFF_THEN_REVIEW_PHASE2_ARCHIVE_CANDIDATES",
};

fs.writeFileSync(
  path.join(BACKUP_ROOT, "manifest.json"),
  JSON.stringify(manifest, null, 2),
  "utf8"
);

console.log(JSON.stringify(manifest, null, 2));
