const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const ROOT = process.cwd();

const PHASE_B_PLAN =
  path.join(
    ROOT,
    "logs",
    "root-cleanup-phaseB-plan-v1.json"
  );

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

const STRICT_LEGACY_PATTERNS = [
  /^append-.+-v7\.ps1$/i,
  /^audit-v\d+.*\.cjs$/i,
  /^compare-v\d+.*\.cjs$/i,
  /^diagnose-v\d+.*\.cjs$/i,
  /^make-v\d+.*\.cjs$/i,
  /^test-v\d+.*\.cjs$/i,
  /^install-.+-v(?:7|8|9[-_.]?0).+\.ps1$/i,
  /^install-.+-v(?:7|8|9[-_.]?0)\.ps1$/i,
];

const ONE_SHOT_SQL_PATTERNS = [
  /^mark-legacy-.+\.sql$/i,
  /^mark-stale-.+\.sql$/i,
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
        ".ps1", ".sql", ".json", ".md", ".txt",
        ".yml", ".yaml", ".toml",
      ].includes(ext)) {
        continue;
      }

      try {
        const relativeFile =
          posix(path.relative(ROOT, full));

        if (/^scripts\/root-cleanup-/i.test(relativeFile)) {
          continue;
        }

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

if (!fs.existsSync(path.join(ROOT, "package.json"))) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_ROOT_CLEANUP_PHASEB2_STRICT_PLAN_V2_FAILED",
    reason:
      "PACKAGE_JSON_NOT_FOUND",
  }, null, 2));
  process.exit(1);
}

if (!fs.existsSync(PHASE_B_PLAN)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_ROOT_CLEANUP_PHASEB2_STRICT_PLAN_V2_FAILED",
    reason:
      "PHASE_B_PLAN_NOT_FOUND",
  }, null, 2));
  process.exit(1);
}

const phaseB =
  JSON.parse(fs.readFileSync(PHASE_B_PLAN, "utf8"));

const legacy =
  phaseB?.buckets?.REVIEW_LEGACY_TOOL ?? [];

const oneShotSql =
  phaseB?.buckets?.REVIEW_ONE_SHOT_SQL ?? [];

const other =
  phaseB?.buckets?.REVIEW_OTHER_SOURCE ?? [];

const input = [
  ...legacy.map((x) => ({
    ...x,
    sourceBucket: "REVIEW_LEGACY_TOOL",
  })),
  ...oneShotSql.map((x) => ({
    ...x,
    sourceBucket: "REVIEW_ONE_SHOT_SQL",
  })),
  ...other.map((x) => ({
    ...x,
    sourceBucket: "REVIEW_OTHER_SOURCE",
  })),
];

const EXPECTED_INPUT = 16;

if (input.length !== EXPECTED_INPUT) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_ROOT_CLEANUP_PHASEB2_STRICT_PLAN_V2_FAILED",
    reason:
      "EXPECTED_16_REVIEW_INPUTS",
    expected:
      EXPECTED_INPUT,
    actual:
      input.length,
  }, null, 2));
  process.exit(1);
}

const tracked = trackedSet();
const status = statusMap();
const pkg = packageText();
const tasks = taskText();
const corpus = projectCorpus();

const buckets = {
  ARCHIVE_STRICT_LEGACY_TOOL: [],
  ARCHIVE_STRICT_ONE_SHOT_SQL: [],
  KEEP_REUSABLE_DB_VERIFY: [],
  KEEP_SAFETY_OR_REFERENCED: [],
  REVIEW_DIRTY: [],
  REVIEW_UNTRACKED: [],
  REVIEW_FINAL: [],
};

for (const row of input) {
  const file = row.file;
  const full = path.join(ROOT, file);
  const base = path.basename(file);

  const sourceExists = fs.existsSync(full);
  const trackedNow = tracked.has(file);
  const gitStatusNow = status.get(file) || null;
  const refs = sourceExists ? refsFor(file, corpus) : [];
  const packageReferenceNow =
    pkg.includes(file) || pkg.includes(base);
  const taskReferenceNow =
    tasks.includes(file) || tasks.includes(base);
  const safetyProtected =
    SAFETY_PATTERNS.some((rx) => rx.test(file));

  const facts = {
    file,
    sourceBucket: row.sourceBucket,
    sourceExists,
    trackedNow,
    gitStatusNow,
    currentReferenceCount: refs.length,
    currentReferences: refs,
    packageReferenceNow,
    taskReferenceNow,
    safetyProtected,
  };

  if (!sourceExists) {
    buckets.REVIEW_FINAL.push({
      ...facts,
      reason: "SOURCE_MISSING_REQUIRES_RECONCILIATION",
    });
    continue;
  }

  if (
    gitStatusNow &&
    gitStatusNow !== "??"
  ) {
    buckets.REVIEW_DIRTY.push({
      ...facts,
      reason: "CURRENT_GIT_CHANGE_PRESENT",
    });
    continue;
  }

  if (!trackedNow || gitStatusNow === "??") {
    buckets.REVIEW_UNTRACKED.push({
      ...facts,
      reason: "UNTRACKED_SOURCE_NEVER_AUTO_ARCHIVE",
    });
    continue;
  }

  if (
    refs.length > 0 ||
    packageReferenceNow ||
    taskReferenceNow ||
    safetyProtected
  ) {
    buckets.KEEP_SAFETY_OR_REFERENCED.push({
      ...facts,
      reason:
        refs.length > 0
          ? "CURRENT_PROJECT_REFERENCE_NOW"
          : packageReferenceNow
            ? "PACKAGE_JSON_REFERENCE_NOW"
            : taskReferenceNow
              ? "WINDOWS_TASK_REFERENCE_NOW"
              : "CURRENT_SAFETY_KEYWORD",
    });
    continue;
  }

  if (
    file === "verify_market_daily_bars_fk_v8_3_1.sql"
  ) {
    buckets.KEEP_REUSABLE_DB_VERIFY.push({
      ...facts,
      reason:
        "REUSABLE_DATABASE_INTEGRITY_VERIFICATION_SQL_KEEP",
    });
    continue;
  }

  if (
    row.sourceBucket === "REVIEW_ONE_SHOT_SQL" &&
    ONE_SHOT_SQL_PATTERNS.some((rx) => rx.test(file))
  ) {
    buckets.ARCHIVE_STRICT_ONE_SHOT_SQL.push({
      ...facts,
      reason:
        "CLEAN_UNREFERENCED_HISTORICAL_STATE_MARKING_SQL",
    });
    continue;
  }

  if (
    row.sourceBucket === "REVIEW_LEGACY_TOOL" &&
    STRICT_LEGACY_PATTERNS.some((rx) => rx.test(file))
  ) {
    buckets.ARCHIVE_STRICT_LEGACY_TOOL.push({
      ...facts,
      reason:
        "CLEAN_UNREFERENCED_HISTORICAL_INSTALL_FIX_DIAGNOSTIC_TOOL",
    });
    continue;
  }

  buckets.REVIEW_FINAL.push({
    ...facts,
    reason:
      "ROLE_NOT_STRICT_ENOUGH_FOR_AUTOMATIC_ARCHIVE",
  });
}

for (const key of Object.keys(buckets)) {
  buckets[key].sort((a, b) =>
    a.file.localeCompare(b.file)
  );
}

const summary = {
  inputTotal:
    input.length,

  archiveStrictLegacyTool:
    buckets.ARCHIVE_STRICT_LEGACY_TOOL.length,

  archiveStrictOneShotSql:
    buckets.ARCHIVE_STRICT_ONE_SHOT_SQL.length,

  strictArchiveTotal:
    buckets.ARCHIVE_STRICT_LEGACY_TOOL.length +
    buckets.ARCHIVE_STRICT_ONE_SHOT_SQL.length,

  keepReusableDbVerify:
    buckets.KEEP_REUSABLE_DB_VERIFY.length,

  keepSafetyOrReferenced:
    buckets.KEEP_SAFETY_OR_REFERENCED.length,

  reviewDirty:
    buckets.REVIEW_DIRTY.length,

  reviewUntracked:
    buckets.REVIEW_UNTRACKED.length,

  reviewFinal:
    buckets.REVIEW_FINAL.length,
};

summary.protectedOrReviewTotal =
  buckets.KEEP_REUSABLE_DB_VERIFY.length +
  buckets.KEEP_SAFETY_OR_REFERENCED.length +
  buckets.REVIEW_DIRTY.length +
  buckets.REVIEW_UNTRACKED.length +
  buckets.REVIEW_FINAL.length;

const report = {
  status:
    "AI_STOCK_LAB_ROOT_CLEANUP_PHASEB2_STRICT_PLAN_V2_COMPLETE",

  classification:
    "FINAL_16_ROOT_SOURCE_REVIEW_NO_MUTATION",

  summary,
  buckets,

  policy: {
    archive:
      "Only clean tracked unreferenced historical tools and explicit mark-legacy/mark-stale one-shot SQL.",
    keep:
      "Reusable DB integrity verification SQL is retained.",
    failClosed:
      "Any current reference, task/package reference, safety keyword, dirty or untracked state prevents automatic archive.",
  },

  safety: {
    planOnly: true,
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
    "REVIEW_STRICT_B2_RESULT_BEFORE_DRY_RUN_APPLY",
};

fs.mkdirSync(
  path.join(ROOT, "logs"),
  { recursive: true }
);

fs.writeFileSync(
  path.join(
    ROOT,
    "logs",
    "root-cleanup-phaseB2-strict-plan-v2.json"
  ),
  JSON.stringify(report, null, 2),
  "utf8"
);

console.log(JSON.stringify(report, null, 2));
process.exit(0);
