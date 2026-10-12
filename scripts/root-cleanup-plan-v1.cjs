const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const ROOT = process.cwd();

const TEXT_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".cjs", ".mjs",
  ".ps1", ".json", ".sql", ".md", ".txt",
  ".yml", ".yaml", ".toml", ".env"
]);

const CORE_EXACT = new Set([
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "tsconfig.json",
  "next-env.d.ts",
  ".gitignore",
  ".gitattributes",
  ".npmrc",
  ".nvmrc",
  ".node-version",
  "README.md",
  "LICENSE",
  "LICENSE.md",
]);

const CORE_PATTERNS = [
  /^\.env(?:\.|$)/i,
  /^package(?:-lock)?\.json$/i,
  /^(?:pnpm-lock\.yaml|yarn\.lock|bun\.lockb)$/i,
  /^tsconfig(?:\..+)?\.json$/i,
  /^next\.config\./i,
  /^eslint\.config\./i,
  /^\.eslintrc(?:\.|$)/i,
  /^prettier\.config\./i,
  /^\.prettierrc(?:\.|$)/i,
  /^postcss\.config\./i,
  /^tailwind\.config\./i,
  /^vitest\.config\./i,
  /^jest\.config\./i,
  /^playwright\.config\./i,
  /^wrangler\.toml$/i,
  /^vercel\.json$/i,
  /^supabase\.config\./i,
  /^dockerfile$/i,
  /^docker-compose\./i,
  /^compose\./i,
  /^readme(?:\.|$)/i,
  /^license(?:\.|$)/i,
];

const STRONG_JUNK_PATTERNS = [
  /\.bak$/i,
  /\.backup$/i,
  /\.old$/i,
  /\.orig$/i,
  /\.rej$/i,
  /\.tmp$/i,
  /\.temp$/i,
  /~$/,
  /^temp[-_.]/i,
  /^tmp[-_.]/i,
  /^debug[-_.]/i,
  /^scratch[-_.]/i,
];

const GENERATED_RESULT_PATTERNS = [
  /^result(?:s)?[-_.]/i,
  /^output[-_.]/i,
  /^dump[-_.]/i,
  /^report[-_.].*\.(?:txt|json|log)$/i,
  /^chatgpt[-_.].*\.(?:txt|json|log)$/i,
];

const NEVER_AUTO_DELETE_EXTS = new Set([
  ".db", ".sqlite", ".sqlite3", ".pem", ".key", ".crt", ".pfx", ".p12"
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
  const raw = git(["status", "--porcelain=v1", "--untracked-files=all"]);
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

function projectTextFiles() {
  const roots = ["app", "src", "lib", "scripts"];
  const exclude = new Set([
    ".git", ".next", "node_modules", ".turbo",
    "coverage", "dist", "build",
  ]);

  const files = [];

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
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!TEXT_EXTS.has(ext)) continue;

        let stat;
        try {
          stat = fs.statSync(full);
        } catch {
          continue;
        }

        if (stat.size > 2_000_000) continue;
        files.push(full);
      }
    }
  }

  for (const root of roots) {
    const full = path.join(ROOT, root);
    if (fs.existsSync(full)) walk(full);
  }

  return files;
}

function referenceCount(fileName, corpus) {
  const needles = [
    fileName,
    "./" + fileName,
  ];

  let count = 0;
  const refs = [];

  for (const full of corpus) {
    let text = "";
    try {
      text = fs.readFileSync(full, "utf8");
    } catch {
      continue;
    }

    if (needles.some((n) => text.includes(n))) {
      count++;
      refs.push(posix(path.relative(ROOT, full)));
      if (refs.length >= 50) break;
    }
  }

  return { count, refs };
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

function classify(file, tracked, status, corpus, tasks) {
  const full = path.join(ROOT, file);
  const ext = path.extname(file).toLowerCase();
  const stat = fs.statSync(full);
  const gitStatus = status.get(file) || null;
  const refs = referenceCount(file, corpus);
  const taskRef = tasks.includes(file);

  const facts = {
    sizeBytes: stat.size,
    tracked: tracked.has(file),
    gitStatus,
    referenceCount: refs.count,
    references: refs.refs,
    taskReference: taskRef,
  };

  if (
    CORE_EXACT.has(file) ||
    CORE_PATTERNS.some((rx) => rx.test(file))
  ) {
    return {
      bucket: "KEEP_CORE",
      reason: "CORE_PROJECT_CONFIGURATION_OR_METADATA",
      confidence: "HIGH",
      facts,
    };
  }

  if (
    NEVER_AUTO_DELETE_EXTS.has(ext)
  ) {
    return {
      bucket: "KEEP_SENSITIVE",
      reason: "SENSITIVE_OR_STATEFUL_FILE_TYPE",
      confidence: "HIGH",
      facts,
    };
  }

  if (taskRef || refs.count > 0) {
    return {
      bucket: "KEEP_REFERENCED",
      reason: taskRef
        ? "WINDOWS_TASK_REFERENCE"
        : "CURRENT_PROJECT_REFERENCE",
      confidence: "HIGH",
      facts,
    };
  }

  if (gitStatus && gitStatus !== "??") {
    return {
      bucket: "REVIEW_DIRTY",
      reason: "CURRENT_GIT_CHANGE_PRESENT",
      confidence: "HIGH",
      facts,
    };
  }

  if (!tracked.has(file) || gitStatus === "??") {
    if (
      STRONG_JUNK_PATTERNS.some((rx) => rx.test(file)) ||
      GENERATED_RESULT_PATTERNS.some((rx) => rx.test(file))
    ) {
      return {
        bucket: "REVIEW_UNTRACKED_JUNK",
        reason: "UNTRACKED_BUT_NAME_LOOKS_DISPOSABLE",
        confidence: "MEDIUM",
        facts,
      };
    }

    return {
      bucket: "REVIEW_UNTRACKED",
      reason: "UNTRACKED_ROOT_FILE_NEVER_AUTO_DELETE",
      confidence: "MEDIUM",
      facts,
    };
  }

  if (STRONG_JUNK_PATTERNS.some((rx) => rx.test(file))) {
    return {
      bucket: "DELETE_CANDIDATE_STRONG",
      reason: "TRACKED_CLEAN_OBVIOUS_BACKUP_OR_TEMP_FILE",
      confidence: "HIGH",
      facts,
    };
  }

  if (GENERATED_RESULT_PATTERNS.some((rx) => rx.test(file))) {
    return {
      bucket: "ARCHIVE_CANDIDATE_RESULT",
      reason: "TRACKED_CLEAN_GENERATED_RESULT_ARTIFACT",
      confidence: "MEDIUM",
      facts,
    };
  }

  if ([".log"].includes(ext)) {
    return {
      bucket: "ARCHIVE_CANDIDATE_LOG",
      reason: "TRACKED_CLEAN_ROOT_LOG_FILE",
      confidence: "MEDIUM",
      facts,
    };
  }

  return {
    bucket: "REVIEW_MANUAL",
    reason: "ROOT_FILE_ROLE_AMBIGUOUS",
    confidence: "LOW",
    facts,
  };
}

if (!fs.existsSync(path.join(ROOT, "package.json"))) {
  console.error(JSON.stringify({
    status: "AI_STOCK_LAB_ROOT_CLEANUP_PLAN_V1_FAILED",
    reason: "PACKAGE_JSON_NOT_FOUND"
  }, null, 2));
  process.exit(1);
}

const rootEntries =
  fs.readdirSync(ROOT, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .sort();

const tracked = trackedSet();
const status = statusMap();
const corpus = projectTextFiles();
const tasks = taskText();

const buckets = {
  KEEP_CORE: [],
  KEEP_SENSITIVE: [],
  KEEP_REFERENCED: [],
  DELETE_CANDIDATE_STRONG: [],
  ARCHIVE_CANDIDATE_RESULT: [],
  ARCHIVE_CANDIDATE_LOG: [],
  REVIEW_DIRTY: [],
  REVIEW_UNTRACKED_JUNK: [],
  REVIEW_UNTRACKED: [],
  REVIEW_MANUAL: [],
};

for (const file of rootEntries) {
  const result = classify(
    file,
    tracked,
    status,
    corpus,
    tasks
  );

  buckets[result.bucket].push({
    file,
    confidence: result.confidence,
    reason: result.reason,
    ...result.facts,
  });
}

const summary = Object.fromEntries(
  Object.entries(buckets).map(
    ([key, rows]) => [key, rows.length]
  )
);

summary.totalRootFiles = rootEntries.length;
summary.autoDeleteCandidateTotal =
  buckets.DELETE_CANDIDATE_STRONG.length;
summary.autoArchiveCandidateTotal =
  buckets.ARCHIVE_CANDIDATE_RESULT.length +
  buckets.ARCHIVE_CANDIDATE_LOG.length;
summary.protectedTotal =
  buckets.KEEP_CORE.length +
  buckets.KEEP_SENSITIVE.length +
  buckets.KEEP_REFERENCED.length;
summary.reviewTotal =
  buckets.REVIEW_DIRTY.length +
  buckets.REVIEW_UNTRACKED_JUNK.length +
  buckets.REVIEW_UNTRACKED.length +
  buckets.REVIEW_MANUAL.length;

const report = {
  status:
    "AI_STOCK_LAB_ROOT_CLEANUP_PLAN_V1_COMPLETE",
  classification:
    "ROOT_LEVEL_FILES_ONLY_NO_MUTATION",
  root: ROOT,
  summary,
  buckets,
  policy: {
    scope:
      "ONLY files directly under ai-stock-lab root; no subdirectory mutation",
    neverAutoDelete: [
      ".env*",
      "package/lock files",
      "tsconfig/Next/ESLint/PostCSS/Tailwind config",
      "README/LICENSE/Git metadata",
      "database/certificate/key-like files",
      "referenced files",
      "dirty files",
      "untracked files",
    ],
  },
  safety: {
    planOnly: true,
    filesMoved: 0,
    filesDeleted: 0,
    sourceModified: 0,
    stage7Modified: false,
    migrationsModified: false,
    envModified: false,
    scheduledTaskModified: false,
    databaseWrites: 0,
    realTradingChanged: false,
  },
  nextGate:
    "REVIEW_ROOT_FILE_CLASSIFICATION_BEFORE_DELETE_OR_ARCHIVE",
};

fs.mkdirSync(
  path.join(ROOT, "logs"),
  { recursive: true }
);

fs.writeFileSync(
  path.join(ROOT, "logs", "root-cleanup-plan-v1.json"),
  JSON.stringify(report, null, 2),
  "utf8"
);

console.log(JSON.stringify(report, null, 2));
process.exit(0);
