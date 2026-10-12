const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const OUT = path.join(
  ROOT,
  "scripts",
  "safe-cleanup-phase1-v1.cjs"
);

if (!fs.existsSync(path.join(ROOT, "package.json"))) {
  console.error(JSON.stringify({
    status: "AI_STOCK_LAB_SAFE_CLEANUP_PHASE1_V1_INSTALL_FAILED",
    reason: "PACKAGE_JSON_NOT_FOUND",
  }, null, 2));
  process.exit(1);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, "const fs = require(\"fs\");\nconst path = require(\"path\");\nconst crypto = require(\"crypto\");\n\nconst ROOT = process.cwd();\nconst APPLY = process.argv.includes(\"--apply\");\n\nconst TARGETS = [\n  \"scripts/alpha-v3-automation-cycle-route-contract-test.ts.before-v1-1.bak\",\n  \"scripts/alpha-v3-automation-cycle-scheduler-contract-test.ts.before-cjs-compat-v1.bak\",\n  \"scripts/alpha-v3-automation-cycle-scheduler.ts.before-cjs-compat-v1.bak\",\n  \"scripts/alpha-v3-cycle-probe-only-static-verify.cjs.before-v1-1.bak\",\n  \"scripts/alpha-v3-cycle-probe-only-static-verify.cjs.before-v1-2.bak\",\n  \"scripts/alpha-v3-manual-proxy-probe-only-live-smoke.cjs.before-v1-2.bak\",\n  \"scripts/v91002-1.cjs.bak\"\n];\n\nconst BACKUP_ROOT = path.resolve(\n  ROOT,\n  \"..\",\n  \"ai-stock-lab-cleanup-backup-20261012-phase1\"\n);\n\nfunction sha256(file) {\n  const h = crypto.createHash(\"sha256\");\n  h.update(fs.readFileSync(file));\n  return h.digest(\"hex\");\n}\n\nfunction ensureInsideRoot(full) {\n  const root = path.resolve(ROOT) + path.sep;\n  const target = path.resolve(full);\n  return target.startsWith(root);\n}\n\nif (!fs.existsSync(path.join(ROOT, \"package.json\"))) {\n  console.error(JSON.stringify({\n    status: \"AI_STOCK_LAB_SAFE_CLEANUP_PHASE1_V1_FAILED\",\n    reason: \"PACKAGE_JSON_NOT_FOUND\",\n  }, null, 2));\n  process.exit(1);\n}\n\nconst rows = [];\nlet failure = null;\n\nfor (const rel of TARGETS) {\n  const src = path.resolve(ROOT, rel);\n\n  if (!ensureInsideRoot(src)) {\n    failure = {\n      reason: \"TARGET_OUTSIDE_REPO\",\n      file: rel,\n    };\n    break;\n  }\n\n  const exists = fs.existsSync(src);\n\n  rows.push({\n    file: rel,\n    exists,\n    size: exists ? fs.statSync(src).size : null,\n    sha256: exists ? sha256(src) : null,\n  });\n}\n\nif (failure) {\n  console.error(JSON.stringify({\n    status: \"AI_STOCK_LAB_SAFE_CLEANUP_PHASE1_V1_FAILED\",\n    ...failure,\n    safety: {\n      filesDeleted: 0,\n      stage7Modified: false,\n      migrationsModified: false,\n    },\n  }, null, 2));\n  process.exit(1);\n}\n\nconst missing = rows.filter((r) => !r.exists);\n\nif (missing.length > 0) {\n  console.error(JSON.stringify({\n    status: \"AI_STOCK_LAB_SAFE_CLEANUP_PHASE1_V1_REVIEW\",\n    classification: \"EXPECTED_BAK_FILE_MISSING\",\n    missing: missing.map((r) => r.file),\n    rows,\n    safety: {\n      filesDeleted: 0,\n      stage7Modified: false,\n      migrationsModified: false,\n    },\n  }, null, 2));\n  process.exit(1);\n}\n\nif (!APPLY) {\n  console.log(JSON.stringify({\n    status: \"AI_STOCK_LAB_SAFE_CLEANUP_PHASE1_V1_DRY_RUN_PASS\",\n    classification: \"EXACT_ALLOWLIST_7_TRACKED_BAK_FILES_ONLY\",\n    applyRequired: \"--apply\",\n    targets: rows,\n    backupRoot: BACKUP_ROOT,\n    plan: [\n      \"copy each target to external backup folder\",\n      \"verify source and backup SHA256 match\",\n      \"delete only exact allowlisted .bak source\",\n      \"write cleanup manifest outside repo\"\n    ],\n    safety: {\n      filesDeleted: 0,\n      filesMoved: 0,\n      stage7Modified: false,\n      migrationsModified: false,\n      envModified: false,\n      scheduledTaskModified: false,\n      databaseWrites: 0,\n      realTradingChanged: false,\n    },\n    nextGate: \"RUN_WITH_--apply_AFTER_DRY_RUN_REVIEW\",\n  }, null, 2));\n  process.exit(0);\n}\n\nfs.mkdirSync(BACKUP_ROOT, { recursive: true });\n\nconst applied = [];\n\nfor (const row of rows) {\n  const src = path.resolve(ROOT, row.file);\n  const dst = path.resolve(BACKUP_ROOT, row.file);\n\n  fs.mkdirSync(path.dirname(dst), { recursive: true });\n  fs.copyFileSync(src, dst);\n\n  const backupHash = sha256(dst);\n\n  if (backupHash !== row.sha256) {\n    console.error(JSON.stringify({\n      status: \"AI_STOCK_LAB_SAFE_CLEANUP_PHASE1_V1_FAILED\",\n      reason: \"BACKUP_HASH_MISMATCH\",\n      file: row.file,\n      sourceHash: row.sha256,\n      backupHash,\n      filesAlreadyDeleted: applied.map((x) => x.file),\n    }, null, 2));\n    process.exit(1);\n  }\n\n  fs.unlinkSync(src);\n\n  applied.push({\n    file: row.file,\n    sourceHash: row.sha256,\n    backupFile: dst,\n    backupHash,\n    deletedFromRepo: !fs.existsSync(src),\n  });\n}\n\nconst manifest = {\n  status: \"AI_STOCK_LAB_SAFE_CLEANUP_PHASE1_V1_APPLIED\",\n  appliedAt: new Date().toISOString(),\n  classification: \"ONLY_7_EXACT_BAK_FILES_REMOVED_AFTER_HASH_VERIFIED_EXTERNAL_BACKUP\",\n  backupRoot: BACKUP_ROOT,\n  files: applied,\n  safety: {\n    exactAllowlistOnly: true,\n    filesDeleted: applied.length,\n    stage7Modified: false,\n    migrationsModified: false,\n    envModified: false,\n    scheduledTaskModified: false,\n    databaseWrites: 0,\n    realTradingChanged: false,\n  },\n  nextGate: \"RUN_TSC_AND_GIT_DIFF_THEN_REVIEW_PHASE2_ARCHIVE_CANDIDATES\",\n};\n\nfs.writeFileSync(\n  path.join(BACKUP_ROOT, \"manifest.json\"),\n  JSON.stringify(manifest, null, 2),\n  \"utf8\"\n);\n\nconsole.log(JSON.stringify(manifest, null, 2));\n", "utf8");

console.log(JSON.stringify({
  status: "AI_STOCK_LAB_SAFE_CLEANUP_PHASE1_V1_INSTALLED",
  generatedFile: "scripts/safe-cleanup-phase1-v1.cjs",
  exactTargetCount: 7,
  mode: "DRY_RUN_BY_DEFAULT_APPLY_REQUIRES_EXPLICIT_FLAG",
  backupRoot: "../ai-stock-lab-cleanup-backup-20261012-phase1",
  safety: {
    noStage7Target: true,
    noMigrationTarget: true,
    noEnvTarget: true,
    noScheduledTaskTarget: true,
    noDatabaseWrite: true,
    noRealTradingChange: true
  },
  nextAction: "RUN_WITHOUT_--apply_FIRST"
}, null, 2));
