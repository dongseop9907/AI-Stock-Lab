const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const crypto = require("crypto");

const ROOT = process.cwd();

const CORE_EXACT = new Set([
  ".env.local",
  ".env.example",
  ".gitignore",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "next-env.d.ts",
  "next.config.ts",
  "eslint.config.mjs",
  "postcss.config.mjs",
  "README.md",
  "run-market-eod-sync.ps1",
  "verify_market_daily_bars_fk_v8_3_1.sql",
]);

const CORE_PATTERNS = [
  /^\.env(?:\.|$)/i,
  /^package(?:-lock)?\.json$/i,
  /^tsconfig(?:\..+)?\.json$/i,
  /^next\.config\./i,
  /^eslint\.config\./i,
  /^postcss\.config\./i,
  /^tailwind\.config\./i,
  /^README\.md$/i,
];

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

const GENERATED_PATTERNS = [
  /\.tsbuildinfo$/i,
  /\.bak$/i,
  /\.backup$/i,
  /\.tmp$/i,
  /\.temp$/i,
  /\.old$/i,
];

const ACTIVE_ROOTS = [
  "app",
  "src",
  "lib",
  "scripts",
  "supabase",
];

const EXCLUDED_DIRS = new Set([
  ".git",
  ".next",
  "node_modules",
  ".turbo",
  "coverage",
  "dist",
  "build",
  "archive",
  "backups",
]);

const TEXT_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".cjs", ".mjs",
  ".ps1", ".sql", ".json", ".md", ".txt",
  ".yml", ".yaml", ".toml",
]);

function posix(p) {
  return p.split(path.sep).join("/");
}

function rel(full) {
  return posix(path.relative(ROOT, full));
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

function sha256(file) {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(file));
  return h.digest("hex");
}

function walkActive() {
  const files = [];

  function walk(dir) {
    let entries = [];

    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory() && EXCLUDED_DIRS.has(entry.name)) {
        continue;
      }

      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(full);
        continue;
      }

      if (!entry.isFile()) continue;

      const relativeFile = rel(full);

      // Cleanup helper scripts are not production references.
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
      if (!TEXT_EXTS.has(ext)) continue;

      let text = "";

      try {
        text = fs.readFileSync(full, "utf8");
      } catch {}

      files.push({
        full,
        file: relativeFile,
        size: stat.size,
        text,
      });
    }
  }

  for (const root of ACTIVE_ROOTS) {
    const full = path.join(ROOT, root);
    if (fs.existsSync(full)) walk(full);
  }

  return files;
}

function exactDuplicates(rootFile, activeFiles) {
  const source = path.join(ROOT, rootFile);

  if (!fs.existsSync(source)) return [];

  const size = fs.statSync(source).size;
  const hash = sha256(source);
  const matches = [];

  for (const row of activeFiles) {
    if (row.size !== size) continue;

    let candidateHash;

    try {
      candidateHash = sha256(row.full);
    } catch {
      continue;
    }

    if (candidateHash === hash) {
      matches.push(row.file);
    }
  }

  return matches;
}

// Strict import/reference detection.
// We intentionally do NOT treat plain matching basenames in arbitrary text as references.
function strictRefs(rootFile, activeFiles) {
  const stem =
    rootFile.replace(/\.[^.]+$/, "");

  const escapedStem =
    stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const patterns = [
    new RegExp(
      String.raw`(?:from\s+|import\s*\(|require\s*\()\s*["'][^"']*(?:^|/)${escapedStem}["']`,
      "m"
    ),
    new RegExp(
      String.raw`["'][^"']*/${escapedStem}["']`,
      "m"
    ),
  ];

  const refs = [];

  for (const row of activeFiles) {
    if (patterns.some((rx) => rx.test(row.text))) {
      refs.push(row.file);
      if (refs.length >= 50) break;
    }
  }

  return refs;
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

if (!fs.existsSync(path.join(ROOT, "package.json"))) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_ROOT_FINAL_AUDIT_V2_FAILED",
    reason:
      "PACKAGE_JSON_NOT_FOUND",
  }, null, 2));
  process.exit(1);
}

const rootFiles =
  fs.readdirSync(ROOT, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .sort();

const tracked = trackedSet();
const status = statusMap();
const activeFiles = walkActive();
const tasks = taskText();
const pkg =
  fs.readFileSync(path.join(ROOT, "package.json"), "utf8");

const buckets = {
  KEEP_CORE: [],
  KEEP_SAFETY: [],
  KEEP_STRICT_REFERENCED: [],
  REVIEW_EXACT_DUPLICATE_UNREFERENCED: [],
  REVIEW_UNREFERENCED_ROOT_SOURCE: [],
  GENERATED_CACHE: [],
  REVIEW_DIRTY: [],
  REVIEW_UNTRACKED: [],
  REVIEW_OTHER: [],
};

for (const file of rootFiles) {
  const full = path.join(ROOT, file);
  const ext = path.extname(file).toLowerCase();
  const gitStatus = status.get(file) || null;
  const trackedNow = tracked.has(file);

  const refs = strictRefs(file, activeFiles);
  const duplicates = exactDuplicates(file, activeFiles);

  const packageRef =
    pkg.includes(file);

  const taskRef =
    tasks.includes(file);

  const facts = {
    file,
    sizeBytes: fs.statSync(full).size,
    trackedNow,
    gitStatus,
    strictReferenceCount: refs.length,
    strictReferences: refs,
    exactDuplicateCount: duplicates.length,
    exactDuplicatesElsewhere: duplicates,
    packageReference: packageRef,
    taskReference: taskRef,
  };

  if (
    CORE_EXACT.has(file) ||
    CORE_PATTERNS.some((rx) => rx.test(file))
  ) {
    buckets.KEEP_CORE.push({
      ...facts,
      reason: "CORE_PROJECT_ROOT_FILE",
    });
    continue;
  }

  if (GENERATED_PATTERNS.some((rx) => rx.test(file))) {
    buckets.GENERATED_CACHE.push({
      ...facts,
      reason: "GENERATED_OR_TEMP_ROOT_ARTIFACT",
    });
    continue;
  }

  if (
    gitStatus &&
    gitStatus !== "??"
  ) {
    buckets.REVIEW_DIRTY.push({
      ...facts,
      reason: "CURRENT_GIT_CHANGE_PRESENT",
    });
    continue;
  }

  if (!trackedNow || gitStatus === "??") {
    buckets.REVIEW_UNTRACKED.push({
      ...facts,
      reason: "UNTRACKED_ROOT_FILE",
    });
    continue;
  }

  if (
    SAFETY_PATTERNS.some((rx) => rx.test(file))
  ) {
    buckets.KEEP_SAFETY.push({
      ...facts,
      reason: "CURRENT_SAFETY_OR_STAGE7_DOMAIN",
    });
    continue;
  }

  if (
    refs.length > 0 ||
    packageRef ||
    taskRef
  ) {
    buckets.KEEP_STRICT_REFERENCED.push({
      ...facts,
      reason:
        packageRef
          ? "PACKAGE_JSON_REFERENCE"
          : taskRef
            ? "WINDOWS_TASK_REFERENCE"
            : "STRICT_IMPORT_REFERENCE",
    });
    continue;
  }

  if (duplicates.length > 0) {
    buckets.REVIEW_EXACT_DUPLICATE_UNREFERENCED.push({
      ...facts,
      reason:
        "ROOT_FILE_UNREFERENCED_AND_BYTE_IDENTICAL_COPY_EXISTS_ELSEWHERE",
    });
    continue;
  }

  if (
    [".ts", ".tsx", ".js", ".jsx", ".cjs", ".mjs", ".ps1", ".sql"].includes(ext)
  ) {
    buckets.REVIEW_UNREFERENCED_ROOT_SOURCE.push({
      ...facts,
      reason:
        "ROOT_SOURCE_HAS_NO_STRICT_CURRENT_REFERENCE",
    });
    continue;
  }

  buckets.REVIEW_OTHER.push({
    ...facts,
    reason:
      "OTHER_ROOT_FILE_REVIEW",
  });
}

for (const key of Object.keys(buckets)) {
  buckets[key].sort((a, b) =>
    a.file.localeCompare(b.file)
  );
}

const summary = {
  rootFileCount:
    rootFiles.length,

  keepCore:
    buckets.KEEP_CORE.length,

  keepSafety:
    buckets.KEEP_SAFETY.length,

  keepStrictReferenced:
    buckets.KEEP_STRICT_REFERENCED.length,

  reviewExactDuplicateUnreferenced:
    buckets.REVIEW_EXACT_DUPLICATE_UNREFERENCED.length,

  reviewUnreferencedRootSource:
    buckets.REVIEW_UNREFERENCED_ROOT_SOURCE.length,

  generatedCache:
    buckets.GENERATED_CACHE.length,

  reviewDirty:
    buckets.REVIEW_DIRTY.length,

  reviewUntracked:
    buckets.REVIEW_UNTRACKED.length,

  reviewOther:
    buckets.REVIEW_OTHER.length,
};

summary.additionalCleanupCandidateTotal =
  buckets.REVIEW_EXACT_DUPLICATE_UNREFERENCED.length +
  buckets.GENERATED_CACHE.length;

summary.manualReviewTotal =
  buckets.REVIEW_UNREFERENCED_ROOT_SOURCE.length +
  buckets.REVIEW_DIRTY.length +
  buckets.REVIEW_UNTRACKED.length +
  buckets.REVIEW_OTHER.length;

const report = {
  status:
    "AI_STOCK_LAB_ROOT_FINAL_AUDIT_V2_COMPLETE",

  classification:
    "ROOT_PATH_AWARE_FINAL_AUDIT_NO_MUTATION",

  summary,
  buckets,

  important:
    "This audit uses strict import/path reference detection instead of broad basename matching, so it can reveal root duplicates previously kept by conservative false-positive reference detection.",

  safety: {
    readOnly: true,
    filesMoved: 0,
    filesDeleted: 0,
    sourceModified: 0,
    envModified: false,
    stage7Modified: false,
    scheduledTaskModified: false,
    databaseWrites: 0,
    realTradingChanged: false,
  },

  nextGate:
    summary.additionalCleanupCandidateTotal > 0 ||
    summary.manualReviewTotal > 0
      ? "REVIEW_REMAINING_ROOT_CANDIDATES"
      : "ROOT_CLEANUP_CAN_CLOSE",
};

fs.mkdirSync(
  path.join(ROOT, "logs"),
  { recursive: true }
);

fs.writeFileSync(
  path.join(
    ROOT,
    "logs",
    "root-final-audit-v2.json"
  ),
  JSON.stringify(report, null, 2),
  "utf8"
);

console.log(JSON.stringify(report, null, 2));
process.exit(0);
