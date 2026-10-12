const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const crypto = require("crypto");

const ROOT = process.cwd();

const PHASE_A_PLAN =
  path.join(
    ROOT,
    "logs",
    "root-cleanup-phaseA-plan-v1.json"
  );

const ACTIVE_SCAN_ROOTS = [
  "app",
  "src",
  "lib",
  "scripts",
  "supabase",
];

const EXCLUDED_DIR_NAMES = new Set([
  ".git",
  ".next",
  "node_modules",
  ".turbo",
  "coverage",
  "dist",
  "build",
  "backups",
  "archive",
]);

const CURRENT_SAFETY_PATTERNS = [
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

const RESEARCH_DATA_PATTERNS = [
  /corporate-action/i,
  /historical-market/i,
  /historical-pit/i,
  /historical-universe/i,
  /point-in-time/i,
  /market-universe/i,
  /regime/i,
  /backtest/i,
  /validation/i,
];

const HISTORICAL_TOOL_PATTERNS = [
  /^install-.+\.(?:ps1|cjs|js)$/i,
  /^fix-.+\.(?:ps1|cjs|js)$/i,
  /^patch-.+\.(?:ps1|cjs|js)$/i,
  /^integrate-.+\.(?:ps1|cjs|js)$/i,
  /^append-.+\.(?:ps1|cjs|js)$/i,
  /^make-.+\.cjs$/i,
  /^diagnose-.+\.cjs$/i,
  /^compare-.+\.cjs$/i,
  /^audit-.+\.cjs$/i,
  /^test-.+\.cjs$/i,
];

const ROUTE_STAGING_PATTERN =
  /(?:^|-)route\.ts$/i;

const SQL_ONE_SHOT_PATTERNS = [
  /^mark-.+\.sql$/i,
  /^verify-.+\.sql$/i,
];

const TEXT_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".cjs", ".mjs",
  ".ps1", ".sql", ".json", ".md", ".txt", ".yml",
  ".yaml", ".toml"
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

function packageText() {
  const file = path.join(ROOT, "package.json");
  return fs.existsSync(file)
    ? fs.readFileSync(file, "utf8")
    : "";
}

function walkActiveFiles() {
  const out = [];

  function walk(dir) {
    let entries = [];

    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        EXCLUDED_DIR_NAMES.has(entry.name)
      ) {
        continue;
      }

      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        let stat;
        try {
          stat = fs.statSync(full);
        } catch {
          continue;
        }

        if (stat.size > 2_000_000) continue;

        const ext = path.extname(entry.name).toLowerCase();
        if (!TEXT_EXTS.has(ext)) continue;

        out.push(full);
      }
    }
  }

  for (const root of ACTIVE_SCAN_ROOTS) {
    const full = path.join(ROOT, root);
    if (fs.existsSync(full)) {
      walk(full);
    }
  }

  return out;
}

function buildCorpus(activeFiles) {
  const rows = [];

  for (const full of activeFiles) {
    try {
      rows.push({
        file: rel(full),
        text: fs.readFileSync(full, "utf8"),
      });
    } catch {}
  }

  return rows;
}

function refsFor(rootFile, corpus) {
  const base = path.basename(rootFile);
  const noExt = rootFile.replace(/\.[^.]+$/, "");
  const baseNoExt = base.replace(/\.[^.]+$/, "");

  const needles = [...new Set([
    rootFile,
    "./" + rootFile,
    base,
    baseNoExt,
    noExt,
  ])].filter((x) => x.length >= 6);

  const refs = [];

  for (const row of corpus) {
    if (row.file === rootFile) continue;

    if (needles.some((needle) => row.text.includes(needle))) {
      refs.push(row.file);
      if (refs.length >= 50) break;
    }
  }

  return refs;
}

function duplicatesFor(rootFile, activeFiles) {
  const sourceFull = path.join(ROOT, rootFile);

  if (!fs.existsSync(sourceFull)) return [];

  const sourceHash = sha256(sourceFull);
  const sourceSize = fs.statSync(sourceFull).size;
  const matches = [];

  for (const full of activeFiles) {
    const candidateRel = rel(full);

    if (candidateRel === rootFile) continue;

    let stat;

    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }

    if (stat.size !== sourceSize) continue;

    let h;

    try {
      h = sha256(full);
    } catch {
      continue;
    }

    if (h === sourceHash) {
      matches.push(candidateRel);
    }
  }

  return matches;
}

function isCurrentSafety(file) {
  return CURRENT_SAFETY_PATTERNS.some((rx) => rx.test(file));
}

function isResearchData(file) {
  return RESEARCH_DATA_PATTERNS.some((rx) => rx.test(file));
}

function isHistoricalTool(file) {
  return HISTORICAL_TOOL_PATTERNS.some((rx) => rx.test(file));
}

function isSqlOneShot(file) {
  return SQL_ONE_SHOT_PATTERNS.some((rx) => rx.test(file));
}

if (!fs.existsSync(path.join(ROOT, "package.json"))) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_ROOT_CLEANUP_PHASEB_PLAN_V1_FAILED",
    reason:
      "PACKAGE_JSON_NOT_FOUND",
  }, null, 2));

  process.exit(1);
}

if (!fs.existsSync(PHASE_A_PLAN)) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_ROOT_CLEANUP_PHASEB_PLAN_V1_FAILED",
    reason:
      "PHASE_A_PLAN_NOT_FOUND",
  }, null, 2));

  process.exit(1);
}

const phaseA =
  JSON.parse(fs.readFileSync(PHASE_A_PLAN, "utf8"));

const sources =
  phaseA?.buckets?.HOLD_MANUAL_SOURCE ?? [];

const tracked = trackedSet();
const status = statusMap();
const tasks = taskText();
const pkg = packageText();
const activeFiles = walkActiveFiles();
const corpus = buildCorpus(activeFiles);

const buckets = {
  ARCHIVE_EXACT_DUPLICATE: [],
  REVIEW_LEGACY_TOOL: [],
  REVIEW_ROUTE_STAGING: [],
  REVIEW_ONE_SHOT_SQL: [],
  KEEP_CURRENT_SAFETY: [],
  KEEP_RESEARCH_DATA_PIPELINE: [],
  KEEP_REFERENCED_NOW: [],
  HOLD_DIRTY: [],
  HOLD_UNTRACKED: [],
  REVIEW_OTHER_SOURCE: [],
  ALREADY_GONE: [],
};

for (const row of sources) {
  const file = row.file;
  const full = path.join(ROOT, file);

  if (!fs.existsSync(full)) {
    buckets.ALREADY_GONE.push({
      file,
      reason: "SOURCE_NO_LONGER_EXISTS",
    });
    continue;
  }

  const trackedNow = tracked.has(file);
  const gitStatusNow = status.get(file) || null;
  const refs = refsFor(file, corpus);
  const taskReferenceNow =
    tasks.includes(file) ||
    tasks.includes(path.basename(file));
  const packageReferenceNow =
    pkg.includes(file) ||
    pkg.includes(path.basename(file));
  const duplicates = duplicatesFor(file, activeFiles);

  const facts = {
    file,
    sizeBytes: fs.statSync(full).size,
    trackedNow,
    gitStatusNow,
    currentReferenceCount: refs.length,
    currentReferences: refs,
    taskReferenceNow,
    packageReferenceNow,
    exactDuplicatesElsewhere: duplicates,
    exactDuplicateCount: duplicates.length,
  };

  if (
    gitStatusNow &&
    gitStatusNow !== "??"
  ) {
    buckets.HOLD_DIRTY.push({
      ...facts,
      reason: "CURRENT_GIT_CHANGE_PRESENT",
    });
    continue;
  }

  if (!trackedNow || gitStatusNow === "??") {
    buckets.HOLD_UNTRACKED.push({
      ...facts,
      reason: "UNTRACKED_SOURCE_NEVER_AUTO_ARCHIVE",
    });
    continue;
  }

  if (
    refs.length > 0 ||
    taskReferenceNow ||
    packageReferenceNow
  ) {
    buckets.KEEP_REFERENCED_NOW.push({
      ...facts,
      reason:
        taskReferenceNow
          ? "WINDOWS_TASK_REFERENCE_NOW"
          : packageReferenceNow
            ? "PACKAGE_JSON_REFERENCE_NOW"
            : "CURRENT_PROJECT_REFERENCE_NOW",
    });
    continue;
  }

  if (isCurrentSafety(file)) {
    buckets.KEEP_CURRENT_SAFETY.push({
      ...facts,
      reason: "CURRENT_SAFETY_OR_STAGE7_DOMAIN",
    });
    continue;
  }

  if (
    duplicates.length > 0
  ) {
    buckets.ARCHIVE_EXACT_DUPLICATE.push({
      ...facts,
      reason:
        "CLEAN_UNREFERENCED_ROOT_SOURCE_HAS_BYTE_IDENTICAL_ACTIVE_COPY",
    });
    continue;
  }

  if (isResearchData(file)) {
    buckets.KEEP_RESEARCH_DATA_PIPELINE.push({
      ...facts,
      reason:
        "RESEARCH_OR_HISTORICAL_DATA_PIPELINE_SOURCE_RETAIN_FOR_NOW",
    });
    continue;
  }

  if (isHistoricalTool(file)) {
    buckets.REVIEW_LEGACY_TOOL.push({
      ...facts,
      reason:
        "CLEAN_UNREFERENCED_VERSIONED_INSTALL_FIX_PATCH_OR_DIAGNOSTIC_TOOL",
    });
    continue;
  }

  if (ROUTE_STAGING_PATTERN.test(file)) {
    buckets.REVIEW_ROUTE_STAGING.push({
      ...facts,
      reason:
        "CLEAN_UNREFERENCED_ROOT_ROUTE_STAGING_SOURCE",
    });
    continue;
  }

  if (isSqlOneShot(file)) {
    buckets.REVIEW_ONE_SHOT_SQL.push({
      ...facts,
      reason:
        "CLEAN_UNREFERENCED_ONE_SHOT_SQL_HELPER",
    });
    continue;
  }

  buckets.REVIEW_OTHER_SOURCE.push({
    ...facts,
    reason:
      "CLEAN_UNREFERENCED_SOURCE_ROLE_AMBIGUOUS",
  });
}

for (const key of Object.keys(buckets)) {
  buckets[key].sort((a, b) =>
    a.file.localeCompare(b.file)
  );
}

const summary = {
  sourceInputCount: sources.length,

  archiveExactDuplicate:
    buckets.ARCHIVE_EXACT_DUPLICATE.length,

  reviewLegacyTool:
    buckets.REVIEW_LEGACY_TOOL.length,

  reviewRouteStaging:
    buckets.REVIEW_ROUTE_STAGING.length,

  reviewOneShotSql:
    buckets.REVIEW_ONE_SHOT_SQL.length,

  keepCurrentSafety:
    buckets.KEEP_CURRENT_SAFETY.length,

  keepResearchDataPipeline:
    buckets.KEEP_RESEARCH_DATA_PIPELINE.length,

  keepReferencedNow:
    buckets.KEEP_REFERENCED_NOW.length,

  holdDirty:
    buckets.HOLD_DIRTY.length,

  holdUntracked:
    buckets.HOLD_UNTRACKED.length,

  reviewOtherSource:
    buckets.REVIEW_OTHER_SOURCE.length,

  alreadyGone:
    buckets.ALREADY_GONE.length,
};

summary.lowRiskArchiveCandidateTotal =
  buckets.ARCHIVE_EXACT_DUPLICATE.length;

summary.secondaryReviewCandidateTotal =
  buckets.REVIEW_LEGACY_TOOL.length +
  buckets.REVIEW_ROUTE_STAGING.length +
  buckets.REVIEW_ONE_SHOT_SQL.length +
  buckets.REVIEW_OTHER_SOURCE.length;

summary.protectedOrHeldTotal =
  buckets.KEEP_CURRENT_SAFETY.length +
  buckets.KEEP_RESEARCH_DATA_PIPELINE.length +
  buckets.KEEP_REFERENCED_NOW.length +
  buckets.HOLD_DIRTY.length +
  buckets.HOLD_UNTRACKED.length;

const report = {
  status:
    "AI_STOCK_LAB_ROOT_CLEANUP_PHASEB_PLAN_V1_COMPLETE",

  classification:
    "ROOT_SOURCE_DEDUP_AND_ROLE_ANALYSIS_NO_MUTATION",

  summary,
  buckets,

  policy: {
    safestAutomaticCandidate:
      "Only clean tracked root sources with byte-identical active copies elsewhere.",
    retainedForNow: [
      "Forward/OOS/SHADOW/risk/promotion/paper/governance/scheduler-related source",
      "historical market/PIT/corporate-action/regime/research pipeline source",
      "currently referenced source",
      "dirty or untracked source",
    ],
    secondaryReview:
      "Legacy install/fix/patch/integrate tools, root route staging files, one-shot SQL and ambiguous source are classified but not mutated.",
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
    "REVIEW_PHASEB_BUCKETS_BEFORE_ANY_SOURCE_ARCHIVE",
};

fs.mkdirSync(
  path.join(ROOT, "logs"),
  { recursive: true }
);

fs.writeFileSync(
  path.join(
    ROOT,
    "logs",
    "root-cleanup-phaseB-plan-v1.json"
  ),
  JSON.stringify(report, null, 2),
  "utf8"
);

console.log(JSON.stringify(report, null, 2));
process.exit(0);
