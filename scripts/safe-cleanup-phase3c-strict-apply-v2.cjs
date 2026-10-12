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
    "safe-cleanup-phase3c-strict-plan-v2.json"
  );

const EXTERNAL_ROOT =
  path.resolve(
    ROOT,
    "..",
    "ai-stock-lab-cleanup-backup-20261012-phase3c"
  );

const CRITICAL_PATTERNS = [
  /forward/i,
  /oos/i,
  /shadow/i,
  /stage7/i,
  /promot/i,
  /walk-forward/i,
  /replay/i,
  /corporate-action/i,
  /calendar/i,
  /paper/i,
  /risk/i,
  /kill-switch/i,
  /scheduler/i,
  /maintenance/i,
  /governance/i,
  /accounting/i,
  /execution/i,
  /top1/i,
  /data-freshness/i,
  /backfill/i,
  /live/i,
  /controlled/i,
  /maturity/i,
  /collector/i,
  /provenance/i,
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
      "AI_STOCK_LAB_SAFE_CLEANUP_PHASE3C_STRICT_APPLY_V2_FAILED",
    reason:
      "PACKAGE_JSON_NOT_FOUND",
  }, null, 2));
  process.exit(1);
}

if (!fs.existsSync(PLAN_FILE)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_SAFE_CLEANUP_PHASE3C_STRICT_APPLY_V2_FAILED",
    reason:
      "STRICT_PLAN_V2_NOT_FOUND",
  }, null, 2));
  process.exit(1);
}

const plan =
  JSON.parse(fs.readFileSync(PLAN_FILE, "utf8"));

const research =
  plan?.buckets?.ARCHIVE_STRICT_RESEARCH ?? [];

const legacy =
  plan?.buckets?.ARCHIVE_STRICT_LEGACY ?? [];

const installers =
  plan?.buckets?.RELOCATE_STRICT_INSTALLER ?? [];

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

const tracked = trackedSet();
const status = statusMap();
const pkg = packageText();
const tasks = taskText();

const failures = [];
const safe = [];

for (const row of candidates) {
  const file = row.file;
  const full = path.resolve(ROOT, file);
  const base = path.basename(file);

  const checks = {
    sourceExists: fs.existsSync(full),
    trackedNow: tracked.has(file),
    gitStatusNow: status.get(file) || null,
    packageReferenceNow:
      pkg.includes(file) || pkg.includes(base),
    taskReferenceNow:
      tasks.includes(file) || tasks.includes(base),
    priorReferenceCount:
      row.priorReferenceCount ?? 0,
    criticalName:
      isCritical(file),
  };

  const reasons = [];

  if (!checks.sourceExists) {
    reasons.push("SOURCE_MISSING");
  }

  if (!checks.trackedNow) {
    reasons.push("NOT_GIT_TRACKED_NOW");
  }

  if (checks.gitStatusNow) {
    reasons.push(`GIT_STATUS_${checks.gitStatusNow}`);
  }

  if (checks.packageReferenceNow) {
    reasons.push("PACKAGE_JSON_REFERENCE_NOW");
  }

  if (checks.taskReferenceNow) {
    reasons.push("WINDOWS_TASK_REFERENCE_NOW");
  }

  if (checks.priorReferenceCount !== 0) {
    reasons.push("PRIOR_REFERENCE_COUNT_NONZERO");
  }

  if (checks.criticalName) {
    reasons.push("STRICT_SAFETY_KEYWORD_GUARD");
  }

  const record = {
    file,
    type: row.type,
    checks,
    sourceBucket: row.sourceBucket ?? null,
    previousReason: row.reason ?? null,
  };

  if (reasons.length === 0) {
    safe.push(record);
  } else {
    failures.push({
      ...record,
      reasons,
    });
  }
}

for (const row of installers) {
  failures.push({
    file: row.file,
    type: "installer",
    reasons: [
      "STRICT_PLAN_V2_HAS_NO_INSTALLER_RELOCATION_EXPECTED",
    ],
  });
}

const collisions = [];

for (const row of safe) {
  const relative =
    row.file.replace(/^scripts\//i, "");

  const dst =
    path.join(
      EXTERNAL_ROOT,
      row.type === "research"
        ? "research"
        : "legacy",
      relative
    );

  if (fs.existsSync(dst)) {
    collisions.push({
      file: row.file,
      destination: dst,
      reason: "EXTERNAL_ARCHIVE_COLLISION",
    });
  }
}

const summary = {
  planResearch:
    research.length,
  planLegacy:
    legacy.length,
  planTotal:
    research.length + legacy.length,
  planInstallerRelocate:
    installers.length,

  strictSafeResearch:
    safe.filter((x) => x.type === "research").length,
  strictSafeLegacy:
    safe.filter((x) => x.type === "legacy").length,
  strictSafeTotal:
    safe.length,

  blocked:
    failures.length,

  collisions:
    collisions.length,
};

if (
  failures.length > 0 ||
  collisions.length > 0
) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_SAFE_CLEANUP_PHASE3C_STRICT_APPLY_V2_PREFLIGHT_REVIEW",

    classification:
      "NO_MUTATION_PREFLIGHT_BLOCKED",

    summary,

    failures,
    collisions,

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

    nextGate:
      "DO_NOT_APPLY_INSPECT_PREFLIGHT_REVIEW",
  }, null, 2));

  process.exit(1);
}

if (!APPLY) {
  console.log(JSON.stringify({
    status:
      "AI_STOCK_LAB_SAFE_CLEANUP_PHASE3C_STRICT_APPLY_V2_DRY_RUN_PASS",

    classification:
      "STRICT_89_EXTERNAL_ARCHIVE_PREFLIGHT_SAFE",

    summary,

    destination:
      EXTERNAL_ROOT,

    sampleSafe:
      safe.slice(0, 50),

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
      "RUN_WITH_--apply_ONLY_AFTER_DRY_RUN_REVIEW",
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

    const dst =
      path.join(
        EXTERNAL_ROOT,
        row.type === "research"
          ? "research"
          : "legacy",
        relative
      );

    const proof =
      copyVerified(src, dst);

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
      "AI_STOCK_LAB_SAFE_CLEANUP_PHASE3C_STRICT_APPLY_V2_PARTIAL_FAILURE",

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
    "AI_STOCK_LAB_SAFE_CLEANUP_PHASE3C_STRICT_APPLY_V2_COMPLETE",

  appliedAt:
    new Date().toISOString(),

  classification:
    "STRICT_RESEARCH_AND_LEGACY_ARCHIVED_EXTERNALLY",

  summary: {
    researchArchived:
      applied.filter((x) => x.type === "research").length,

    legacyArchived:
      applied.filter((x) => x.type === "legacy").length,

    total:
      applied.length,

    installerRelocated:
      0,
  },

  applied,

  safety: {
    externalBackupVerifiedBySha256:
      true,

    strictSafetyGuardRechecked:
      true,

    stage7RuntimeModified:
      false,

    migrationsModified:
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
    "RUN_TSC_STAGE7_TASK_CHECK_AND_FINAL_CLEANUP_AUDIT",
};

fs.writeFileSync(
  path.join(EXTERNAL_ROOT, "manifest.json"),
  JSON.stringify(manifest, null, 2),
  "utf8"
);

console.log(JSON.stringify(manifest, null, 2));
process.exit(0);
