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
    "root-cleanup-phaseB2-strict-plan-v2.json"
  );

const EXTERNAL_ROOT =
  path.resolve(
    ROOT,
    "..",
    "ai-stock-lab-cleanup-backup-20261012-root-phaseB2"
  );

const MANIFEST_FILE =
  path.join(EXTERNAL_ROOT, "manifest.json");

const PROGRESS_FILE =
  path.join(EXTERNAL_ROOT, "progress.json");

const SAFETY_PATTERNS = [
  /forward/i,
  /oos/i,
  /shadow/i,
  /risk/i,
  /kill-switch/i,
  /scheduler/i,
  /promotion/i,
  /paper/i,
  /governance/i,
  /accounting/i,
  /execution/i,
  /maturity/i,
  /collector/i,
  /provenance/i,
  /data-freshness/i,
  /market-eod/i,
];

const TEXT_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".cjs", ".mjs",
  ".ps1", ".sql", ".json", ".md", ".txt",
  ".yml", ".yaml", ".toml",
]);

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

function projectCorpus() {
  const roots = ["app", "src", "lib", "scripts", "supabase"];
  const excluded = new Set([
    ".git", ".next", "node_modules", ".turbo",
    "coverage", "dist", "build", "archive", "backups",
  ]);

  const rows = [];

  function walk(dir) {
    let entries = [];

    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory() && excluded.has(entry.name)) {
        continue;
      }

      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(full);
        continue;
      }

      if (!entry.isFile()) continue;

      const relativeFile =
        posix(path.relative(ROOT, full));

      // Ignore cleanup helpers and cleanup installers to prevent
      // candidate filename literals from becoming false references.
      if (
        /^scripts\/root-cleanup-/i.test(relativeFile) ||
        /^scripts\/installers\/install-ai-stock-lab-root-cleanup-/i.test(relativeFile)
      ) {
        continue;
      }

      let stat;

      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }

      if (stat.size > 2_000_000) continue;

      const ext = path.extname(entry.name).toLowerCase();

      if (!TEXT_EXTS.has(ext)) {
        continue;
      }

      try {
        rows.push({
          file: relativeFile,
          text: fs.readFileSync(full, "utf8"),
        });
      } catch {}
    }
  }

  for (const root of roots) {
    const full = path.join(ROOT, root);
    if (fs.existsSync(full)) walk(full);
  }

  return rows;
}

function refsFor(file, corpus) {
  const base = path.basename(file);
  const baseNoExt = base.replace(/\.[^.]+$/, "");

  const needles = [...new Set([
    file,
    "./" + file,
    base,
    baseNoExt,
  ])].filter((x) => x.length >= 6);

  const refs = [];

  for (const row of corpus) {
    if (row.file === file) continue;

    if (needles.some((needle) => row.text.includes(needle))) {
      refs.push(row.file);

      if (refs.length >= 50) break;
    }
  }

  return refs;
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

if (!fs.existsSync(path.join(ROOT, "package.json"))) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_ROOT_CLEANUP_PHASEB2_APPLY_V1_FAILED",
    reason:
      "PACKAGE_JSON_NOT_FOUND",
  }, null, 2));
  process.exit(1);
}

if (!fs.existsSync(PLAN_FILE)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_ROOT_CLEANUP_PHASEB2_APPLY_V1_FAILED",
    reason:
      "PHASEB2_STRICT_PLAN_V2_NOT_FOUND",
  }, null, 2));
  process.exit(1);
}

const plan =
  JSON.parse(fs.readFileSync(PLAN_FILE, "utf8"));

const legacy =
  plan?.buckets?.ARCHIVE_STRICT_LEGACY_TOOL ?? [];

const sql =
  plan?.buckets?.ARCHIVE_STRICT_ONE_SHOT_SQL ?? [];

const candidates = [
  ...legacy.map((x) => ({
    ...x,
    category: "legacy-tool",
  })),
  ...sql.map((x) => ({
    ...x,
    category: "one-shot-sql",
  })),
];

const EXPECTED = {
  legacy: 13,
  sql: 2,
  total: 15,
};

if (
  legacy.length !== EXPECTED.legacy ||
  sql.length !== EXPECTED.sql ||
  candidates.length !== EXPECTED.total
) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_ROOT_CLEANUP_PHASEB2_APPLY_V1_PREFLIGHT_REVIEW",
    reason:
      "PLAN_COUNTS_CHANGED",
    expected: EXPECTED,
    actual: {
      legacy: legacy.length,
      sql: sql.length,
      total: candidates.length,
    },
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
const corpus = projectCorpus();

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

  const refs =
    sourceExists ? refsFor(file, corpus) : [];

  const packageReferenceNow =
    pkg.includes(file) || pkg.includes(base);

  const taskReferenceNow =
    tasks.includes(file) || tasks.includes(base);

  const safetyProtected =
    SAFETY_PATTERNS.some((rx) => rx.test(file));

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

  if (refs.length > 0) {
    reasons.push("CURRENT_PROJECT_REFERENCE_NOW");
  }

  if (packageReferenceNow) {
    reasons.push("PACKAGE_JSON_REFERENCE_NOW");
  }

  if (taskReferenceNow) {
    reasons.push("WINDOWS_TASK_REFERENCE_NOW");
  }

  if (safetyProtected) {
    reasons.push("CURRENT_SAFETY_KEYWORD");
  }

  const record = {
    file,
    category: row.category,
    sourceExists,
    trackedNow,
    gitStatusNow,
    currentReferenceCount: refs.length,
    currentReferences: refs,
    packageReferenceNow,
    taskReferenceNow,
    safetyProtected,
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
      row.category === "legacy-tool"
        ? "legacy-tools"
        : "one-shot-sql",
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
  planLegacy:
    legacy.length,

  planOneShotSql:
    sql.length,

  planTotal:
    candidates.length,

  safeLegacy:
    safe.filter(
      (x) => x.category === "legacy-tool"
    ).length,

  safeOneShotSql:
    safe.filter(
      (x) => x.category === "one-shot-sql"
    ).length,

  safeTotal:
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
      "AI_STOCK_LAB_ROOT_CLEANUP_PHASEB2_APPLY_V1_PREFLIGHT_REVIEW",

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
      "AI_STOCK_LAB_ROOT_CLEANUP_PHASEB2_APPLY_V1_DRY_RUN_PASS",

    classification:
      "ROOT_FINAL_15_LEGACY_AND_ONE_SHOT_SQL_PREFLIGHT_SAFE_NO_MUTATION",

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

fs.mkdirSync(EXTERNAL_ROOT, { recursive: true });

const applied = [];

function writeProgress(statusValue, error = null) {
  fs.writeFileSync(
    PROGRESS_FILE,
    JSON.stringify({
      status: statusValue,
      updatedAt: new Date().toISOString(),
      expected: EXPECTED,
      appliedCount: applied.length,
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

    // Final just-in-time recheck before destructive step.
    const liveTracked =
      trackedSet().has(row.file);

    const liveStatus =
      statusMap().get(row.file) || null;

    const liveCorpus =
      projectCorpus();

    const liveRefs =
      refsFor(row.file, liveCorpus);

    const livePkg =
      packageText();

    const liveTasks =
      taskText();

    if (!fs.existsSync(src)) {
      throw new Error(
        `FINAL_SOURCE_MISSING:${row.file}`
      );
    }

    if (!liveTracked) {
      throw new Error(
        `FINAL_NOT_TRACKED:${row.file}`
      );
    }

    if (liveStatus) {
      throw new Error(
        `FINAL_GIT_STATUS_BLOCK:${row.file}:${liveStatus}`
      );
    }

    if (liveRefs.length > 0) {
      throw new Error(
        `FINAL_REFERENCE_BLOCK:${row.file}:${liveRefs.join(",")}`
      );
    }

    if (
      livePkg.includes(row.file) ||
      livePkg.includes(path.basename(row.file))
    ) {
      throw new Error(
        `FINAL_PACKAGE_REFERENCE_BLOCK:${row.file}`
      );
    }

    if (
      liveTasks.includes(row.file) ||
      liveTasks.includes(path.basename(row.file))
    ) {
      throw new Error(
        `FINAL_TASK_REFERENCE_BLOCK:${row.file}`
      );
    }

    const dst =
      path.join(
        EXTERNAL_ROOT,
        row.category === "legacy-tool"
          ? "legacy-tools"
          : "one-shot-sql",
        row.file
      );

    const hashes =
      copyVerified(src, dst);

    fs.unlinkSync(src);

    applied.push({
      file:
        row.file,

      category:
        row.category,

      destination:
        dst,

      sha256:
        hashes.backupHash,

      sourceRemoved:
        !fs.existsSync(src),

      backupExists:
        fs.existsSync(dst),
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
      "AI_STOCK_LAB_ROOT_CLEANUP_PHASEB2_APPLY_V1_PARTIAL_FAILURE",

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
    "AI_STOCK_LAB_ROOT_CLEANUP_PHASEB2_APPLY_V1_COMPLETE",

  appliedAt:
    new Date().toISOString(),

  classification:
    "ROOT_LEGACY_TOOLS_AND_ONE_SHOT_SQL_EXTERNALLY_BACKED_UP_AND_REMOVED",

  summary: {
    legacyToolsArchived:
      applied.filter(
        (x) => x.category === "legacy-tool"
      ).length,

    oneShotSqlArchived:
      applied.filter(
        (x) => x.category === "one-shot-sql"
      ).length,

    total:
      applied.length,
  },

  applied,

  safety: {
    externalBackupSha256Verified:
      true,

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
    "VERIFY_TSC_TASK_ROOT_COUNT_AND_CLOSE_ROOT_CLEANUP",
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
