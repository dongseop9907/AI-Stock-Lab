const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const ROOT = process.cwd();

const EXCLUDE_DIRS = new Set([
  ".git",
  ".next",
  "node_modules",
  ".turbo",
  ".vercel",
  "coverage",
  "dist",
  "build",
]);

const TEXT_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".cjs", ".mjs",
  ".json", ".ps1", ".sql", ".md", ".txt", ".yml", ".yaml",
]);

const PROTECTED_EXACT = new Set([
  "scripts/run-shadow-controlled-producer-0850.ps1",
  "scripts/true-forward-oos-controlled-producer-evidence-run-v1.ts",
  "scripts/true-forward-oos-controlled-normal-producer-v1.ts",
  "scripts/alpha-v3-true-forward-top1-producer-v1.ts",
  "scripts/true-forward-oos-first-real-session-readiness-v1.ts",
  "scripts/true-forward-oos-post-capture-maturity-audit-v1.ts",
  "scripts/true-forward-oos-maturity-aware-collector-gate-v1.ts",
  "scripts/forward-oos-data-quality-integrity-monitor-v1.ts",
  "scripts/model-shadow-canonical-lifecycle-watch-v1.ts",
  "scripts/stage7-forward-oos-paper-baseline-audit-v1.cjs",
  "scripts/stage7-scheduled-producer-safety-chain-audit-v1.cjs",
  "scripts/stage7-scheduled-producer-safety-chain-audit-v2.cjs",
  "scripts/stage7-first-verified-controlled-session-capture-v1.cjs",
  "scripts/safe-cleanup-audit-v2.cjs",
]);

function posix(p) {
  return p.split(path.sep).join("/");
}

function rel(full) {
  return posix(path.relative(ROOT, full));
}

function walk(relativeDir) {
  const start = path.join(ROOT, relativeDir);
  if (!fs.existsSync(start)) return [];

  const result = [];

  function visit(dir) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;

      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        visit(full);
      } else if (entry.isFile()) {
        result.push(full);
      }
    }
  }

  visit(start);
  return result;
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

function gitTracked() {
  const raw = git(["ls-files"]);
  return new Set(
    raw ? raw.split(/\r?\n/).map(posix).filter(Boolean) : []
  );
}

function gitStatus() {
  const raw = git(["status", "--porcelain=v1"]);
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

function packageRefs() {
  const file = path.join(ROOT, "package.json");
  const refs = new Set();
  const scripts = {};

  if (!fs.existsSync(file)) {
    return { refs, scripts };
  }

  try {
    const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
    Object.assign(scripts, pkg.scripts || {});
  } catch {
    return { refs, scripts };
  }

  for (const command of Object.values(scripts)) {
    const text = String(command);

    const matches =
      text.match(/scripts\/[A-Za-z0-9_./@()\-]+\.(?:ts|tsx|js|cjs|mjs|ps1)/g)
      || [];

    for (const match of matches) {
      refs.add(posix(match));
    }
  }

  return { refs, scripts };
}

function referenceCorpus() {
  const roots = ["package.json", "app", "src", "lib", "scripts"];
  const files = [];

  for (const item of roots) {
    const full = path.join(ROOT, item);
    if (!fs.existsSync(full)) continue;

    if (fs.statSync(full).isFile()) {
      files.push(full);
    } else {
      files.push(...walk(item));
    }
  }

  const corpus = [];

  for (const full of files) {
    const ext = path.extname(full).toLowerCase();
    if (!TEXT_EXTS.has(ext)) continue;

    let st;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }

    if (st.size > 2_000_000) continue;

    try {
      corpus.push({
        file: rel(full),
        text: fs.readFileSync(full, "utf8"),
      });
    } catch {}
  }

  return corpus;
}

function findRefs(target, corpus) {
  const base = path.basename(target);
  const noExt = target.replace(/\.[^.]+$/, "");
  const baseNoExt = base.replace(/\.[^.]+$/, "");

  const needles = [...new Set([
    target,
    "./" + target,
    noExt,
    base,
    baseNoExt,
  ])].filter((x) => x.length >= 6);

  const refs = [];

  for (const item of corpus) {
    if (item.file === target) continue;

    if (needles.some((needle) => item.text.includes(needle))) {
      refs.push(item.file);
      if (refs.length >= 20) break;
    }
  }

  return refs;
}

function generatedTarget(file) {
  const base = path.basename(file);
  const match = base.match(/^install-(.+)\.cjs$/i);

  if (!match) return null;

  const stem = match[1];

  const candidates = [
    `scripts/${stem}.cjs`,
    `scripts/${stem}.ts`,
    `scripts/${stem}.js`,
  ];

  return candidates.find((candidate) =>
    fs.existsSync(path.join(ROOT, candidate))
  ) || null;
}

function protectedReason(file) {
  if (PROTECTED_EXACT.has(file)) {
    return "CURRENT_STAGE_OR_SAFETY_CRITICAL";
  }

  if (
    /forward-oos|shadow|paper|risk|kill-switch|trailing-stop|trade|order/i
      .test(file)
  ) {
    return "TRADING_OR_FORWARD_PIPELINE_NAME";
  }

  return null;
}

function classify(file, meta) {
  const protectedWhy = protectedReason(file);

  if (protectedWhy) {
    return ["KEEP", "HIGH", protectedWhy];
  }

  if (meta.packageRef) {
    return ["KEEP", "HIGH", "REFERENCED_BY_PACKAGE_JSON_SCRIPT"];
  }

  if (meta.refs.length > 0) {
    return ["KEEP", "MEDIUM", "REFERENCED_BY_PROJECT_SOURCE"];
  }

  if (/^scripts\/backups\//i.test(file)) {
    return ["ARCHIVE_CANDIDATE", "HIGH", "UNREFERENCED_BACKUP_TREE_FILE"];
  }

  if (/\.(tmp|temp|bak|old|orig)$/i.test(file)) {
    return ["DELETE_CANDIDATE", "HIGH", "UNREFERENCED_TEMP_OR_BACKUP_EXTENSION"];
  }

  if (
    /^scripts\/install-.+\.cjs$/i.test(file) &&
    meta.generatedTarget
  ) {
    return [
      "ARCHIVE_CANDIDATE",
      "MEDIUM",
      "UNREFERENCED_INSTALLER_WITH_EXISTING_GENERATED_TARGET",
    ];
  }

  if (/^scripts\/(?:install-|fix-|repair-|patch-).+\.cjs$/i.test(file)) {
    return ["REVIEW", "MEDIUM", "UNREFERENCED_INSTALL_OR_REPAIR_SCRIPT"];
  }

  if (
    /(?:probe|audit|verify|contract-test|regression|stress|diagnostic)/i
      .test(file)
  ) {
    return ["REVIEW", "MEDIUM", "UNREFERENCED_TEST_OR_DIAGNOSTIC_SCRIPT"];
  }

  return ["REVIEW", "LOW", "UNREFERENCED_SCRIPT_REQUIRES_REVIEW"];
}

if (!fs.existsSync(path.join(ROOT, "package.json"))) {
  console.error(JSON.stringify({
    status: "AI_STOCK_LAB_SAFE_CLEANUP_AUDIT_V2_FAILED",
    reason: "PACKAGE_JSON_NOT_FOUND",
  }, null, 2));

  process.exitCode = 1;
} else {
  const tracked = gitTracked();
  const status = gitStatus();
  const { refs: pkgRefs, scripts: pkgScripts } = packageRefs();
  const corpus = referenceCorpus();

  const targetExtensions =
    /\.(?:ts|tsx|js|jsx|cjs|mjs|ps1|json|txt|sql|tmp|temp|bak|old|orig)$/i;

  const files =
    walk("scripts")
      .map(rel)
      .filter((file) => targetExtensions.test(file))
      .sort();

  const buckets = {
    KEEP: [],
    ARCHIVE_CANDIDATE: [],
    DELETE_CANDIDATE: [],
    REVIEW: [],
  };

  for (const file of files) {
    const refs = findRefs(file, corpus);
    const target = generatedTarget(file);

    const meta = {
      packageRef: pkgRefs.has(file),
      refs,
      generatedTarget: target,
    };

    const [bucket, confidence, reason] =
      classify(file, meta);

    const st = fs.statSync(path.join(ROOT, file));

    buckets[bucket].push({
      file,
      confidence,
      reason,
      tracked: tracked.has(file),
      gitStatus: status.get(file) || null,
      packageScriptRef: meta.packageRef,
      referenceCount: refs.length,
      references: refs,
      generatedTarget: target,
      size: st.size,
      mtime: st.mtime.toISOString(),
    });
  }

  const summary = {
    totalScanned:
      Object.values(buckets)
        .reduce((sum, rows) => sum + rows.length, 0),

    keep:
      buckets.KEEP.length,

    archiveCandidate:
      buckets.ARCHIVE_CANDIDATE.length,

    deleteCandidate:
      buckets.DELETE_CANDIDATE.length,

    review:
      buckets.REVIEW.length,

    packageScriptCount:
      Object.keys(pkgScripts).length,

    gitDirtyCount:
      status.size,
  };

  const report = {
    status:
      "AI_STOCK_LAB_SAFE_CLEANUP_AUDIT_V2_COMPLETE",

    classification:
      "READ_ONLY_CLEANUP_CLASSIFICATION_NO_MUTATION",

    summary,
    buckets,

    safety: {
      readOnly: true,
      filesDeleted: 0,
      filesMoved: 0,
      filesRenamed: 0,
      sourceModified: 0,
      gitModified: false,
      scheduledTaskModified: false,
      envModified: false,
      databaseWrites: 0,
      producerExecuted: false,
      collectorExecuted: false,
      realTradingChanged: false,
      autoDeletePerformed: false,
    },

    nextGate:
      "REVIEW_CANDIDATES_THEN_GENERATE_EXPLICIT_ARCHIVE_DELETE_PLAN",
  };

  fs.mkdirSync(
    path.join(ROOT, "logs"),
    { recursive: true }
  );

  fs.writeFileSync(
    path.join(ROOT, "logs", "safe-cleanup-audit-v2.json"),
    JSON.stringify(report, null, 2),
    "utf8"
  );

  const text = [];

  text.push("AI STOCK LAB SAFE CLEANUP AUDIT V2");
  text.push("==================================");
  text.push("");
  text.push(`Total scanned     : ${summary.totalScanned}`);
  text.push(`KEEP              : ${summary.keep}`);
  text.push(`ARCHIVE_CANDIDATE : ${summary.archiveCandidate}`);
  text.push(`DELETE_CANDIDATE  : ${summary.deleteCandidate}`);
  text.push(`REVIEW            : ${summary.review}`);
  text.push("");

  for (const bucket of [
    "ARCHIVE_CANDIDATE",
    "DELETE_CANDIDATE",
    "REVIEW",
  ]) {
    text.push(`=== ${bucket} ===`);

    if (buckets[bucket].length === 0) {
      text.push("(none)");
    }

    for (const row of buckets[bucket]) {
      text.push(`[${row.confidence}] ${row.file}`);
      text.push(`  reason: ${row.reason}`);
      text.push(
        `  tracked=${row.tracked} git=${row.gitStatus ?? "-"} refs=${row.referenceCount}`
      );

      if (row.generatedTarget) {
        text.push(
          `  generatedTarget=${row.generatedTarget}`
        );
      }
    }

    text.push("");
  }

  text.push(
    "NO FILES WERE DELETED, MOVED, RENAMED, OR MODIFIED."
  );

  fs.writeFileSync(
    path.join(ROOT, "logs", "safe-cleanup-audit-v2.txt"),
    text.join("\n"),
    "utf8"
  );

  function compact(rows, limit = 120) {
    return rows.slice(0, limit).map((row) => ({
      file: row.file,
      confidence: row.confidence,
      reason: row.reason,
      tracked: row.tracked,
      gitStatus: row.gitStatus,
      references: row.referenceCount,
      generatedTarget: row.generatedTarget,
    }));
  }

  console.log(JSON.stringify({
    status: report.status,
    classification: report.classification,
    summary,

    candidates: {
      archive:
        compact(buckets.ARCHIVE_CANDIDATE),

      delete:
        compact(buckets.DELETE_CANDIDATE),

      review:
        compact(buckets.REVIEW),

      truncated: {
        archive:
          buckets.ARCHIVE_CANDIDATE.length > 120,

        delete:
          buckets.DELETE_CANDIDATE.length > 120,

        review:
          buckets.REVIEW.length > 120,
      },
    },

    reports: {
      json:
        "logs/safe-cleanup-audit-v2.json",

      text:
        "logs/safe-cleanup-audit-v2.txt",
    },

    safety:
      report.safety,

    nextGate:
      report.nextGate,
  }, null, 2));

  process.exitCode = 0;
}
