const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = process.cwd();
const APPLY = process.argv.includes("--apply");

const PLAN_FILE =
  path.join(ROOT, "logs", "safe-cleanup-phase3-plan-v1.json");

const INSTALLER_ARCHIVE =
  path.join(ROOT, "scripts", "installers", "archive");

const EXTERNAL_BACKUP_ROOT =
  path.resolve(
    ROOT,
    "..",
    "ai-stock-lab-cleanup-backup-20261012-phase3a"
  );

const PROTECTED_RUNTIME = new Set([
  "scripts/run-shadow-controlled-producer-0850.ps1",
  "scripts/true-forward-oos-controlled-producer-evidence-run-v1.ts",
  "scripts/true-forward-oos-controlled-normal-producer-v1.ts",
  "scripts/alpha-v3-true-forward-top1-producer-v1.ts",
  "scripts/true-forward-oos-first-real-session-readiness-v1.ts",
  "scripts/true-forward-oos-post-capture-maturity-audit-v1.ts",
  "scripts/true-forward-oos-maturity-aware-collector-gate-v1.ts",
  "scripts/forward-oos-data-quality-integrity-monitor-v1.ts",
  "scripts/model-shadow-canonical-lifecycle-watch-v1.ts"
]);

function posix(p) {
  return p.split(path.sep).join("/");
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
    throw new Error(`HASH_MISMATCH:${src}:${dst}`);
  }

  return { sourceHash, backupHash };
}

function repoRel(full) {
  return posix(path.relative(ROOT, full));
}

function insideRepo(full) {
  const root = path.resolve(ROOT) + path.sep;
  return path.resolve(full).startsWith(root);
}

function loadPlan() {
  if (!fs.existsSync(PLAN_FILE)) {
    throw new Error("PHASE3_PLAN_NOT_FOUND");
  }

  return JSON.parse(fs.readFileSync(PLAN_FILE, "utf8"));
}

if (!fs.existsSync(path.join(ROOT, "package.json"))) {
  console.error(JSON.stringify({
    status: "AI_STOCK_LAB_SAFE_CLEANUP_PHASE3A_APPLY_V1_FAILED",
    reason: "PACKAGE_JSON_NOT_FOUND"
  }, null, 2));
  process.exit(1);
}

let plan;

try {
  plan = loadPlan();
} catch (error) {
  console.error(JSON.stringify({
    status: "AI_STOCK_LAB_SAFE_CLEANUP_PHASE3A_APPLY_V1_FAILED",
    reason: error instanceof Error ? error.message : String(error)
  }, null, 2));
  process.exit(1);
}

const installers =
  plan?.buckets?.INSTALLER_RELOCATE_CANDIDATE ?? [];

const duplicates =
  plan?.buckets?.DUPLICATE_DELETE_CANDIDATE ?? [];

const failures = [];
const installerPreflight = [];
const duplicatePreflight = [];

for (const row of installers) {
  const rel = row.file;
  const src = path.resolve(ROOT, rel);
  const dst = path.resolve(
    INSTALLER_ARCHIVE,
    path.basename(rel)
  );

  const entry = {
    file: rel,
    sourceExists: fs.existsSync(src),
    destination: repoRel(dst),
    destinationExists: fs.existsSync(dst),
    references: row.referenceCount ?? null,
    gitStatus: row.gitStatus ?? null,
    hash: fs.existsSync(src) ? sha256(src) : null
  };

  if (!/^scripts\/install-.+\.cjs$/i.test(rel)) {
    failures.push({
      file: rel,
      reason: "NOT_ROOT_INSTALLER_PATTERN"
    });
  }

  if (PROTECTED_RUNTIME.has(rel)) {
    failures.push({
      file: rel,
      reason: "PROTECTED_RUNTIME_FILE"
    });
  }

  if (!insideRepo(src) || !insideRepo(dst)) {
    failures.push({
      file: rel,
      reason: "PATH_OUTSIDE_REPO"
    });
  }

  if (!entry.sourceExists) {
    failures.push({
      file: rel,
      reason: "SOURCE_MISSING"
    });
  }

  if (entry.destinationExists) {
    failures.push({
      file: rel,
      reason: "DESTINATION_COLLISION",
      destination: entry.destination
    });
  }

  if ((row.referenceCount ?? 0) !== 0) {
    failures.push({
      file: rel,
      reason: "SOURCE_REFERENCE_COUNT_NOT_ZERO",
      referenceCount: row.referenceCount
    });
  }

  installerPreflight.push(entry);
}

for (const row of duplicates) {
  const rel = row.file;
  const src = path.resolve(ROOT, rel);

  const canonicalRel =
    row?.duplicate?.canonicalSibling;

  const canonical =
    canonicalRel
      ? path.resolve(ROOT, canonicalRel)
      : null;

  const sourceExists = fs.existsSync(src);
  const canonicalExists =
    canonical ? fs.existsSync(canonical) : false;

  const sourceHash =
    sourceExists ? sha256(src) : null;

  const canonicalHash =
    canonicalExists ? sha256(canonical) : null;

  const entry = {
    file: rel,
    sourceExists,
    canonicalSibling: canonicalRel ?? null,
    canonicalExists,
    sourceHash,
    canonicalHash,
    identical:
      sourceHash !== null &&
      canonicalHash !== null &&
      sourceHash === canonicalHash,
    references: row.referenceCount ?? null,
    gitStatus: row.gitStatus ?? null
  };

  if (!sourceExists) {
    failures.push({
      file: rel,
      reason: "DUPLICATE_SOURCE_MISSING"
    });
  }

  if (!canonicalRel || !canonicalExists) {
    failures.push({
      file: rel,
      reason: "CANONICAL_SIBLING_MISSING",
      canonicalSibling: canonicalRel ?? null
    });
  }

  if (!entry.identical) {
    failures.push({
      file: rel,
      reason: "DUPLICATE_HASH_MISMATCH",
      sourceHash,
      canonicalHash
    });
  }

  if ((row.referenceCount ?? 0) !== 0) {
    failures.push({
      file: rel,
      reason: "DUPLICATE_REFERENCE_COUNT_NOT_ZERO",
      referenceCount: row.referenceCount
    });
  }

  duplicatePreflight.push(entry);
}

const summary = {
  installersToRelocate: installers.length,
  exactDuplicatesToRemove: duplicates.length,
  totalMutations: installers.length + duplicates.length,
  preflightFailures: failures.length
};

if (failures.length > 0) {
  console.error(JSON.stringify({
    status: "AI_STOCK_LAB_SAFE_CLEANUP_PHASE3A_APPLY_V1_PREFLIGHT_REVIEW",
    classification: "NO_MUTATION_PREFLIGHT_BLOCKED",
    summary,
    failures: failures.slice(0, 100),
    safety: {
      filesMoved: 0,
      filesDeleted: 0,
      stage7RuntimeModified: false,
      migrationsModified: false,
      envModified: false,
      scheduledTaskModified: false,
      databaseWrites: 0,
      realTradingChanged: false
    }
  }, null, 2));

  process.exit(1);
}

if (!APPLY) {
  console.log(JSON.stringify({
    status: "AI_STOCK_LAB_SAFE_CLEANUP_PHASE3A_APPLY_V1_DRY_RUN_PASS",
    classification: "INSTALLER_RELOCATION_AND_EXACT_DUPLICATE_CLEANUP_PREFLIGHT_SAFE",
    summary,
    samples: {
      installers: installerPreflight.slice(0, 30),
      duplicates: duplicatePreflight.slice(0, 30)
    },
    destinations: {
      installerArchive: repoRel(INSTALLER_ARCHIVE),
      externalBackup: EXTERNAL_BACKUP_ROOT
    },
    safety: {
      dryRun: true,
      filesMoved: 0,
      filesDeleted: 0,
      stage7RuntimeModified: false,
      migrationsModified: false,
      envModified: false,
      scheduledTaskModified: false,
      databaseWrites: 0,
      realTradingChanged: false
    },
    nextGate: "RUN_WITH_--apply_AFTER_DRY_RUN_PASS"
  }, null, 2));

  process.exit(0);
}

fs.mkdirSync(INSTALLER_ARCHIVE, { recursive: true });
fs.mkdirSync(EXTERNAL_BACKUP_ROOT, { recursive: true });

const applied = [];

try {
  // Remove exact byte-identical copies first, but only after verified external backup.
  for (const row of duplicates) {
    const src = path.resolve(ROOT, row.file);

    const backup = path.join(
      EXTERNAL_BACKUP_ROOT,
      "duplicates",
      row.file.replace(/^scripts\//i, "")
    );

    const proof = copyVerified(src, backup);

    fs.unlinkSync(src);

    applied.push({
      action: "REMOVE_EXACT_DUPLICATE",
      source: row.file,
      canonicalSibling: row.duplicate.canonicalSibling,
      externalBackup: backup,
      sha256: proof.backupHash,
      sourceRemoved: !fs.existsSync(src)
    });
  }

  // Relocate root installer artifacts to the dedicated archive folder.
  for (const row of installers) {
    const src = path.resolve(ROOT, row.file);
    const dst = path.resolve(
      INSTALLER_ARCHIVE,
      path.basename(row.file)
    );

    const rollback = path.join(
      EXTERNAL_BACKUP_ROOT,
      "installers",
      path.basename(row.file)
    );

    const proof = copyVerified(src, rollback);

    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.renameSync(src, dst);

    const movedHash = sha256(dst);

    if (movedHash !== proof.sourceHash) {
      throw new Error(`MOVED_HASH_MISMATCH:${row.file}`);
    }

    applied.push({
      action: "RELOCATE_INSTALLER",
      source: row.file,
      destination: repoRel(dst),
      externalBackup: rollback,
      sha256: movedHash,
      sourceRemoved: !fs.existsSync(src),
      destinationExists: fs.existsSync(dst)
    });
  }

} catch (error) {
  console.error(JSON.stringify({
    status: "AI_STOCK_LAB_SAFE_CLEANUP_PHASE3A_APPLY_V1_PARTIAL_FAILURE",
    reason: error instanceof Error ? error.message : String(error),
    appliedCount: applied.length,
    applied,
    recoveryRoot: EXTERNAL_BACKUP_ROOT
  }, null, 2));

  process.exit(1);
}

const manifest = {
  status: "AI_STOCK_LAB_SAFE_CLEANUP_PHASE3A_APPLY_V1_COMPLETE",
  appliedAt: new Date().toISOString(),
  classification: "ROOT_INSTALLERS_RELOCATED_AND_EXACT_DUPLICATES_REMOVED",
  summary: {
    installersRelocated:
      applied.filter((x) => x.action === "RELOCATE_INSTALLER").length,
    exactDuplicatesRemoved:
      applied.filter((x) => x.action === "REMOVE_EXACT_DUPLICATE").length,
    total:
      applied.length
  },
  applied,
  safety: {
    sourcePlanUsed: "logs/safe-cleanup-phase3-plan-v1.json",
    rollbackCopiesWritten: true,
    stage7RuntimeModified: false,
    migrationsModified: false,
    envModified: false,
    scheduledTaskModified: false,
    databaseWrites: 0,
    realTradingChanged: false
  },
  nextGate: "RUN_TSC_TASK_CHECK_AND_PHASE3B_RESCAN"
};

fs.writeFileSync(
  path.join(EXTERNAL_BACKUP_ROOT, "manifest.json"),
  JSON.stringify(manifest, null, 2),
  "utf8"
);

console.log(JSON.stringify(manifest, null, 2));
process.exit(0);
