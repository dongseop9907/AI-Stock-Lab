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
    "root-cleanup-phaseA-plan-v1.json"
  );

const EXTERNAL_ROOT =
  path.resolve(
    ROOT,
    "..",
    "ai-stock-lab-cleanup-backup-20261012-root-phaseA"
  );

const MANIFEST_FILE =
  path.join(EXTERNAL_ROOT, "manifest.json");

const PROGRESS_FILE =
  path.join(EXTERNAL_ROOT, "progress.json");

const CORE_PROTECT_PATTERNS = [
  /^\.env(?:\.|$)/i,
  /^package(?:-lock)?\.json$/i,
  /^tsconfig.*\.json$/i,
  /^next(?:-env|\.config)/i,
  /^eslint\.config\./i,
  /^\.gitignore$/i,
  /^README\.md$/i,
];

const ALLOWED_UNTRACKED_PATTERNS = [
  /\.tsbuildinfo$/i,
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
  const roots = ["app", "src", "lib", "scripts"];
  const exclude = new Set([
    ".git", ".next", "node_modules", ".turbo",
    "coverage", "dist", "build",
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
      if (exclude.has(entry.name)) continue;

      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(full);
        continue;
      }

      if (!entry.isFile()) continue;

      let stat;

      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }

      if (stat.size > 2_000_000) continue;

      const ext = path.extname(entry.name).toLowerCase();

      if (![
        ".ts", ".tsx", ".js", ".jsx", ".cjs", ".mjs",
        ".ps1", ".json", ".sql", ".md", ".txt",
        ".yml", ".yaml", ".toml"
      ].includes(ext)) {
        continue;
      }

      try {
        rows.push({
          file: posix(path.relative(ROOT, full)),
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
  const refs = [];

  for (const row of corpus) {
    if (
      row.text.includes(file) ||
      row.text.includes("./" + file)
    ) {
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
  const destinationHash = sha256(dst);

  if (sourceHash !== destinationHash) {
    throw new Error(
      `SHA256_MISMATCH:${src}:${dst}`
    );
  }

  return {
    sourceHash,
    destinationHash,
  };
}

if (!fs.existsSync(path.join(ROOT, "package.json"))) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_ROOT_CLEANUP_PHASEA_APPLY_V1_FAILED",
    reason:
      "PACKAGE_JSON_NOT_FOUND",
  }, null, 2));

  process.exit(1);
}

if (!fs.existsSync(PLAN_FILE)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_ROOT_CLEANUP_PHASEA_APPLY_V1_FAILED",
    reason:
      "PHASEA_PLAN_NOT_FOUND",
  }, null, 2));

  process.exit(1);
}

const plan =
  JSON.parse(fs.readFileSync(PLAN_FILE, "utf8"));

const remove =
  plan?.buckets?.REMOVE_AFTER_EXTERNAL_BACKUP ?? [];

const archive =
  plan?.buckets?.ARCHIVE_ROOT_ARTIFACT ?? [];

const candidates = [
  ...remove.map((row) => ({
    ...row,
    category: "disposable",
  })),
  ...archive.map((row) => ({
    ...row,
    category: "historical-artifact",
  })),
];

const EXPECTED = {
  remove: 30,
  archive: 52,
  total: 82,
};

if (
  remove.length !== EXPECTED.remove ||
  archive.length !== EXPECTED.archive ||
  candidates.length !== EXPECTED.total
) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_ROOT_CLEANUP_PHASEA_APPLY_V1_PREFLIGHT_REVIEW",
    reason:
      "PLAN_COUNTS_CHANGED",
    expected: EXPECTED,
    actual: {
      remove: remove.length,
      archive: archive.length,
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
const tasks = taskText();
const corpus = projectCorpus();

const safe = [];
const blocked = [];

for (const row of candidates) {
  const file = row.file;
  const full = path.join(ROOT, file);

  const sourceExists =
    fs.existsSync(full);

  const trackedNow =
    tracked.has(file);

  const gitStatusNow =
    status.get(file) || null;

  const refs =
    sourceExists ? refsFor(file, corpus) : [];

  const taskReferenceNow =
    tasks.includes(file);

  const coreProtected =
    CORE_PROTECT_PATTERNS.some((rx) => rx.test(file));

  const allowedUntracked =
    ALLOWED_UNTRACKED_PATTERNS.some((rx) => rx.test(file));

  const reasons = [];

  if (!sourceExists) {
    reasons.push("SOURCE_MISSING");
  }

  if (coreProtected) {
    reasons.push("CORE_PROTECTED");
  }

  if (refs.length > 0) {
    reasons.push("CURRENT_PROJECT_REFERENCE");
  }

  if (taskReferenceNow) {
    reasons.push("WINDOWS_TASK_REFERENCE");
  }

  if (
    gitStatusNow &&
    gitStatusNow !== "??"
  ) {
    reasons.push(
      `CURRENT_GIT_CHANGE_${gitStatusNow}`
    );
  }

  if (
    !trackedNow &&
    !allowedUntracked
  ) {
    reasons.push("UNTRACKED_NOT_ALLOWLISTED");
  }

  if (
    gitStatusNow === "??" &&
    !allowedUntracked
  ) {
    reasons.push("UNTRACKED_STATUS_NOT_ALLOWLISTED");
  }

  const record = {
    file,
    category: row.category,
    sourceBucket: row.sourceBucket ?? null,
    sourceExists,
    trackedNow,
    gitStatusNow,
    allowedUntracked,
    currentReferenceCount: refs.length,
    currentReferences: refs,
    taskReferenceNow,
    coreProtected,
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
      row.category === "disposable"
        ? "removed"
        : "historical-artifacts",
      row.file
    );

  if (fs.existsSync(dst)) {
    collisions.push({
      file: row.file,
      destination: dst,
      reason: "EXTERNAL_BACKUP_COLLISION",
    });
  }
}

const summary = {
  planRemove:
    remove.length,

  planArchive:
    archive.length,

  planTotal:
    candidates.length,

  safeRemove:
    safe.filter((x) => x.category === "disposable").length,

  safeArchive:
    safe.filter((x) => x.category === "historical-artifact").length,

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
      "AI_STOCK_LAB_ROOT_CLEANUP_PHASEA_APPLY_V1_PREFLIGHT_REVIEW",

    classification:
      "NO_MUTATION_PREFLIGHT_BLOCKED",

    summary,
    blocked,
    collisions,

    safety: {
      filesBackedUp: 0,
      filesRemoved: 0,
      repoMutation: false,
      envModified: false,
      stage7Modified: false,
      scheduledTaskModified: false,
      databaseWrites: 0,
      realTradingChanged: false,
    },

    nextGate:
      "DO_NOT_APPLY_REVIEW_BLOCKED_OR_COLLISIONS",
  }, null, 2));

  process.exit(1);
}

if (!APPLY) {
  console.log(JSON.stringify({
    status:
      "AI_STOCK_LAB_ROOT_CLEANUP_PHASEA_APPLY_V1_DRY_RUN_PASS",

    classification:
      "ROOT_82_CANDIDATES_PREFLIGHT_SAFE_NO_MUTATION",

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
      envModified: false,
      stage7Modified: false,
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

function writeProgress(status, error = null) {
  fs.writeFileSync(
    PROGRESS_FILE,
    JSON.stringify({
      status,
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

    const dst =
      path.join(
        EXTERNAL_ROOT,
        row.category === "disposable"
          ? "removed"
          : "historical-artifacts",
        row.file
      );

    const hashes =
      copyVerified(src, dst);

    fs.unlinkSync(src);

    const result = {
      file: row.file,
      category: row.category,
      destination: dst,
      sha256: hashes.destinationHash,
      sourceRemoved: !fs.existsSync(src),
      destinationExists: fs.existsSync(dst),
    };

    applied.push(result);

    // Persist after every successful file so a crash is recoverable.
    writeProgress("IN_PROGRESS");
  }
} catch (error) {
  const message =
    error instanceof Error
      ? error.message
      : String(error);

  writeProgress("PARTIAL_FAILURE", message);

  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_ROOT_CLEANUP_PHASEA_APPLY_V1_PARTIAL_FAILURE",
    reason: message,
    appliedCount: applied.length,
    progressFile: PROGRESS_FILE,
    externalBackupRoot: EXTERNAL_ROOT,
  }, null, 2));

  process.exit(1);
}

const manifest = {
  status:
    "AI_STOCK_LAB_ROOT_CLEANUP_PHASEA_APPLY_V1_COMPLETE",

  appliedAt:
    new Date().toISOString(),

  classification:
    "ROOT_OBVIOUS_ARTIFACTS_EXTERNAL_BACKUP_VERIFIED_AND_REMOVED",

  summary: {
    disposableRemoved:
      applied.filter(
        (x) => x.category === "disposable"
      ).length,

    historicalArtifactsArchived:
      applied.filter(
        (x) => x.category === "historical-artifact"
      ).length,

    total:
      applied.length,
  },

  applied,

  safety: {
    externalBackupSha256Verified: true,
    envModified: false,
    stage7Modified: false,
    scheduledTaskModified: false,
    databaseWrites: 0,
    realTradingChanged: false,
  },

  nextGate:
    "VERIFY_MANIFEST_TSC_TASK_THEN_ROOT_PHASEB_SOURCE_REVIEW",
};

fs.writeFileSync(
  MANIFEST_FILE,
  JSON.stringify(manifest, null, 2),
  "utf8"
);

writeProgress("COMPLETE");

console.log(JSON.stringify(manifest, null, 2));
process.exit(0);
