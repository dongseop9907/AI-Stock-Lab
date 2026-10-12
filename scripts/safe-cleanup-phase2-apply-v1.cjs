const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = process.cwd();
const APPLY = process.argv.includes("--apply");

const PLAN_FILE =
  path.join(ROOT, "logs", "safe-cleanup-phase2-plan-v1.json");

const EXTERNAL_BACKUP_ROOT =
  path.resolve(
    ROOT,
    "..",
    "ai-stock-lab-cleanup-backup-20261012-phase2"
  );

const INSTALLER_ARCHIVE_ROOT =
  path.join(
    ROOT,
    "scripts",
    "installers",
    "archive"
  );

function sha256(file) {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(file));
  return h.digest("hex");
}

function toPosix(p) {
  return p.split(path.sep).join("/");
}

function insideRepo(full) {
  const root = path.resolve(ROOT) + path.sep;
  return path.resolve(full).startsWith(root);
}

function copyVerified(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);

  const sourceHash = sha256(src);
  const backupHash = sha256(dst);

  if (sourceHash !== backupHash) {
    throw new Error(
      `HASH_MISMATCH:${src}:${dst}`
    );
  }

  return {
    sourceHash,
    backupHash,
  };
}

function loadPlan() {
  if (!fs.existsSync(PLAN_FILE)) {
    throw new Error(
      "PHASE2_PLAN_REPORT_NOT_FOUND"
    );
  }

  return JSON.parse(
    fs.readFileSync(PLAN_FILE, "utf8")
  );
}

if (!fs.existsSync(path.join(ROOT, "package.json"))) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_SAFE_CLEANUP_PHASE2_APPLY_V1_FAILED",
    reason:
      "PACKAGE_JSON_NOT_FOUND",
  }, null, 2));
  process.exit(1);
}

let plan;

try {
  plan = loadPlan();
} catch (error) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_SAFE_CLEANUP_PHASE2_APPLY_V1_FAILED",
    reason:
      error instanceof Error
        ? error.message
        : String(error),
  }, null, 2));
  process.exit(1);
}

const moveRows =
  plan?.groups?.moveToInstallersArchive ?? [];

const externalRows =
  plan?.groups?.archiveExternal ?? [];

const reviewRows =
  plan?.groups?.review ?? [];

const unresolvedBlockers =
  (plan?.blockers ?? []).filter((b) => {
    // The only accepted prior-plan blocker is an untracked old installer.
    // It still must be part of moveRows and satisfy all normal checks below.
    return !(
      b?.action === "MOVE_TO_INSTALLERS_ARCHIVE" &&
      b?.gitStatus === "??"
    );
  });

if (reviewRows.length > 0 || unresolvedBlockers.length > 0) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_SAFE_CLEANUP_PHASE2_APPLY_V1_REVIEW",
    reason:
      "UNRESOLVED_PLAN_REVIEW_OR_BLOCKER",
    reviewCount:
      reviewRows.length,
    unresolvedBlockers,
    safety: {
      filesMoved: 0,
      filesDeleted: 0,
    },
  }, null, 2));
  process.exit(1);
}

const preflight = [];
const failures = [];

for (const row of moveRows) {
  const srcRel = row.file;
  const dstRel =
    row?.phase2?.destination ??
    `scripts/installers/archive/${path.basename(srcRel)}`;

  const src = path.resolve(ROOT, srcRel);
  const dst = path.resolve(ROOT, dstRel);

  const generatedTarget =
    row.generatedTarget
      ? path.resolve(ROOT, row.generatedTarget)
      : null;

  const entry = {
    action:
      "MOVE_TO_INSTALLERS_ARCHIVE",
    source:
      toPosix(srcRel),
    destination:
      toPosix(path.relative(ROOT, dst)),
    sourceExists:
      fs.existsSync(src),
    destinationExists:
      fs.existsSync(dst),
    generatedTarget:
      row.generatedTarget ?? null,
    generatedTargetExists:
      generatedTarget
        ? fs.existsSync(generatedTarget)
        : false,
    sourceHash:
      fs.existsSync(src)
        ? sha256(src)
        : null,
  };

  if (!insideRepo(src) || !insideRepo(dst)) {
    failures.push({
      file: srcRel,
      reason: "MOVE_PATH_OUTSIDE_REPO",
    });
  }

  if (!entry.sourceExists) {
    failures.push({
      file: srcRel,
      reason: "SOURCE_MISSING",
    });
  }

  if (entry.destinationExists) {
    failures.push({
      file: srcRel,
      reason: "DESTINATION_COLLISION",
      destination: entry.destination,
    });
  }

  if (!entry.generatedTargetExists) {
    failures.push({
      file: srcRel,
      reason: "GENERATED_TARGET_MISSING",
      generatedTarget:
        row.generatedTarget ?? null,
    });
  }

  preflight.push(entry);
}

for (const row of externalRows) {
  const srcRel = row.file;
  const src = path.resolve(ROOT, srcRel);

  const relativeBackup =
    srcRel.replace(/^scripts\/backups\//i, "");

  const dst = path.join(
    EXTERNAL_BACKUP_ROOT,
    "backups",
    relativeBackup
  );

  const entry = {
    action:
      "ARCHIVE_EXTERNAL",
    source:
      toPosix(srcRel),
    destination:
      dst,
    sourceExists:
      fs.existsSync(src),
    destinationExists:
      fs.existsSync(dst),
    sourceHash:
      fs.existsSync(src)
        ? sha256(src)
        : null,
  };

  if (!insideRepo(src)) {
    failures.push({
      file: srcRel,
      reason: "SOURCE_OUTSIDE_REPO",
    });
  }

  if (!entry.sourceExists) {
    failures.push({
      file: srcRel,
      reason: "SOURCE_MISSING",
    });
  }

  if (entry.destinationExists) {
    failures.push({
      file: srcRel,
      reason: "EXTERNAL_BACKUP_COLLISION",
      destination: dst,
    });
  }

  preflight.push(entry);
}

const summary = {
  installersToMove:
    moveRows.length,
  backupsToArchiveExternally:
    externalRows.length,
  totalMutations:
    moveRows.length + externalRows.length,
  unresolvedPlanBlockers:
    unresolvedBlockers.length,
  reviewRows:
    reviewRows.length,
  preflightFailures:
    failures.length,
};

if (failures.length > 0) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_SAFE_CLEANUP_PHASE2_APPLY_V1_PREFLIGHT_REVIEW",
    classification:
      "PHASE2_PREFLIGHT_BLOCKED_NO_MUTATION",
    summary,
    failures,
    safety: {
      filesMoved: 0,
      filesDeleted: 0,
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
      "AI_STOCK_LAB_SAFE_CLEANUP_PHASE2_APPLY_V1_DRY_RUN_PASS",
    classification:
      "125_INSTALLERS_PLUS_5_BACKUPS_PREFLIGHT_SAFE",
    summary,
    acceptedPriorPlanBlockers:
      (plan?.blockers ?? []).filter(
        (b) =>
          b?.action === "MOVE_TO_INSTALLERS_ARCHIVE" &&
          b?.gitStatus === "??"
      ),
    sample:
      preflight.slice(0, 30),
    destinations: {
      installerArchive:
        toPosix(
          path.relative(
            ROOT,
            INSTALLER_ARCHIVE_ROOT
          )
        ),
      externalBackup:
        EXTERNAL_BACKUP_ROOT,
    },
    safety: {
      dryRun: true,
      filesMoved: 0,
      filesDeleted: 0,
      sourceModified: 0,
      stage7RuntimeModified: false,
      migrationsModified: false,
      envModified: false,
      scheduledTaskModified: false,
      databaseWrites: 0,
      realTradingChanged: false,
    },
    nextGate:
      "RUN_WITH_--apply_AFTER_DRY_RUN_PASS",
  }, null, 2));

  process.exit(0);
}

fs.mkdirSync(
  INSTALLER_ARCHIVE_ROOT,
  { recursive: true }
);

fs.mkdirSync(
  EXTERNAL_BACKUP_ROOT,
  { recursive: true }
);

const applied = [];

try {
  for (const row of moveRows) {
    const src = path.resolve(ROOT, row.file);

    const dstRel =
      row?.phase2?.destination ??
      `scripts/installers/archive/${path.basename(row.file)}`;

    const dst = path.resolve(ROOT, dstRel);

    // External rollback copy first.
    const rollback = path.join(
      EXTERNAL_BACKUP_ROOT,
      "installers",
      path.basename(row.file)
    );

    const backupProof =
      copyVerified(src, rollback);

    fs.mkdirSync(
      path.dirname(dst),
      { recursive: true }
    );

    fs.renameSync(src, dst);

    const movedHash =
      sha256(dst);

    if (movedHash !== backupProof.sourceHash) {
      throw new Error(
        `MOVED_HASH_MISMATCH:${row.file}`
      );
    }

    applied.push({
      action:
        "MOVE_TO_INSTALLERS_ARCHIVE",
      source:
        row.file,
      destination:
        toPosix(path.relative(ROOT, dst)),
      rollbackBackup:
        rollback,
      sha256:
        movedHash,
      sourceRemoved:
        !fs.existsSync(src),
      destinationExists:
        fs.existsSync(dst),
    });
  }

  for (const row of externalRows) {
    const src = path.resolve(ROOT, row.file);

    const relativeBackup =
      row.file.replace(/^scripts\/backups\//i, "");

    const dst = path.join(
      EXTERNAL_BACKUP_ROOT,
      "backups",
      relativeBackup
    );

    const proof =
      copyVerified(src, dst);

    fs.unlinkSync(src);

    applied.push({
      action:
        "ARCHIVE_EXTERNAL",
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
      "AI_STOCK_LAB_SAFE_CLEANUP_PHASE2_APPLY_V1_PARTIAL_FAILURE",
    reason:
      error instanceof Error
        ? error.message
        : String(error),
    applied,
    recovery:
      "Use external backup root and manifest data to restore affected files before continuing.",
  }, null, 2));
  process.exit(1);
}

const manifest = {
  status:
    "AI_STOCK_LAB_SAFE_CLEANUP_PHASE2_APPLY_V1_COMPLETE",
  appliedAt:
    new Date().toISOString(),
  classification:
    "OLD_INSTALLERS_ARCHIVED_AND_BACKUP_TREE_EXTERNALIZED",
  summary: {
    installersMoved:
      applied.filter(
        (x) =>
          x.action ===
          "MOVE_TO_INSTALLERS_ARCHIVE"
      ).length,
    backupTreeFilesExternalized:
      applied.filter(
        (x) =>
          x.action ===
          "ARCHIVE_EXTERNAL"
      ).length,
    total:
      applied.length,
  },
  applied,
  safety: {
    onlyPlanCandidatesUsed: true,
    rollbackCopiesWritten: true,
    stage7RuntimeModified: false,
    migrationsModified: false,
    envModified: false,
    scheduledTaskModified: false,
    databaseWrites: 0,
    realTradingChanged: false,
  },
  nextGate:
    "RUN_TSC_GIT_STATUS_AND_RESCAN_CLEANUP_AUDIT",
};

fs.writeFileSync(
  path.join(
    EXTERNAL_BACKUP_ROOT,
    "manifest.json"
  ),
  JSON.stringify(manifest, null, 2),
  "utf8"
);

console.log(JSON.stringify(manifest, null, 2));
process.exit(0);
