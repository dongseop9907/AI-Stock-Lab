const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const crypto = require("crypto");

const ROOT = process.cwd();

const CRITICAL_FILES = [
  "scripts/run-shadow-controlled-producer-0850.ps1",
  "scripts/true-forward-oos-controlled-producer-evidence-run-v1.ts",
  "scripts/true-forward-oos-controlled-normal-producer-v1.ts",
  "scripts/alpha-v3-true-forward-top1-producer-v1.ts",
  "scripts/true-forward-oos-first-real-session-readiness-v1.ts",
  "scripts/true-forward-oos-post-capture-maturity-audit-v1.ts",
  "scripts/true-forward-oos-maturity-aware-collector-gate-v1.ts",
  "scripts/forward-oos-data-quality-integrity-monitor-v1.ts",
  "scripts/model-shadow-canonical-lifecycle-watch-v1.ts",
  "lib/research/run-true-forward-oos-automation-binding-v1.ts",
];

const PROTECTED_SPOT_CHECK = [
  "scripts/v9729-promote.ts",
  "scripts/corporate-action-daily.cjs",
  "scripts/read-oos-design-summary.cjs",
  "scripts/alpha-v3-limit-policy-walk-forward.ts",
  "scripts/paper-fee-basis-runtime-rpc-name-fix-v1-structural-proof.ts",
  "scripts/install-alpha-v3-data-freshness-canonical-reader-v1.cjs",
  "scripts/install-alpha-v3-data-freshness-production-guards-v2.cjs",
];

const PHASE1_DELETED = [
  "scripts/alpha-v3-automation-cycle-route-contract-test.ts.before-v1-1.bak",
  "scripts/alpha-v3-automation-cycle-scheduler-contract-test.ts.before-cjs-compat-v1.bak",
  "scripts/alpha-v3-automation-cycle-scheduler.ts.before-cjs-compat-v1.bak",
  "scripts/alpha-v3-cycle-probe-only-static-verify.cjs.before-v1-1.bak",
  "scripts/alpha-v3-cycle-probe-only-static-verify.cjs.before-v1-2.bak",
  "scripts/alpha-v3-manual-proxy-probe-only-live-smoke.cjs.before-v1-2.bak",
  "scripts/v91002-1.cjs.bak",
];

const BACKUPS = [
  {
    phase: "PHASE2",
    root: path.resolve(ROOT, "..", "ai-stock-lab-cleanup-backup-20261012-phase2"),
  },
  {
    phase: "PHASE3A",
    root: path.resolve(ROOT, "..", "ai-stock-lab-cleanup-backup-20261012-phase3a"),
  },
  {
    phase: "PHASE3B",
    root: path.resolve(ROOT, "..", "ai-stock-lab-cleanup-backup-20261012-phase3b"),
  },
  {
    phase: "PHASE3C",
    root: path.resolve(ROOT, "..", "ai-stock-lab-cleanup-backup-20261012-phase3c"),
  },
];

function posix(p) {
  return p.split(path.sep).join("/");
}

function sha256(file) {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(file));
  return h.digest("hex");
}

function readJson(file) {
  try {
    return {
      ok: true,
      value: JSON.parse(fs.readFileSync(file, "utf8")),
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      value: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
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

if (!fs.existsSync(path.join(ROOT, "package.json"))) {
  console.error(JSON.stringify({
    status: "AI_STOCK_LAB_FINAL_CLEANUP_AUDIT_V1_FAILED",
    reason: "PACKAGE_JSON_NOT_FOUND",
  }, null, 2));
  process.exit(1);
}

const critical = CRITICAL_FILES.map((file) => ({
  file,
  exists: fs.existsSync(path.join(ROOT, file)),
}));

const protectedSpot = PROTECTED_SPOT_CHECK.map((file) => ({
  file,
  exists: fs.existsSync(path.join(ROOT, file)),
}));

const phase1 = PHASE1_DELETED.map((file) => ({
  file,
  absent: !fs.existsSync(path.join(ROOT, file)),
}));

const backupResults = [];

for (const item of BACKUPS) {
  const manifestPath = path.join(item.root, "manifest.json");
  const rootExists = fs.existsSync(item.root);
  const manifestExists = fs.existsSync(manifestPath);

  let parsed = null;

  if (manifestExists) {
    parsed = readJson(manifestPath);
  }

  backupResults.push({
    phase: item.phase,
    root: item.root,
    rootExists,
    manifestExists,
    manifestParsed: parsed ? parsed.ok : false,
    status: parsed?.ok ? parsed.value?.status ?? null : null,
    summary: parsed?.ok ? parsed.value?.summary ?? null : null,
    parseError: parsed && !parsed.ok ? parsed.error : null,
  });
}

// Deep verify Phase 3B and 3C manifests because they removed repo sources.
const deepVerify = [];

for (const phaseName of ["PHASE3B", "PHASE3C"]) {
  const entry = BACKUPS.find((x) => x.phase === phaseName);
  const manifestPath = path.join(entry.root, "manifest.json");

  if (!fs.existsSync(manifestPath)) {
    deepVerify.push({
      phase: phaseName,
      ok: false,
      reason: "MANIFEST_MISSING",
      expectedApplied: 0,
      verifiedApplied: 0,
      failures: [],
    });
    continue;
  }

  const parsed = readJson(manifestPath);

  if (!parsed.ok) {
    deepVerify.push({
      phase: phaseName,
      ok: false,
      reason: "MANIFEST_PARSE_FAILED",
      expectedApplied: 0,
      verifiedApplied: 0,
      failures: [parsed.error],
    });
    continue;
  }

  const applied = Array.isArray(parsed.value.applied)
    ? parsed.value.applied
    : [];

  const failures = [];
  let verified = 0;

  for (const row of applied) {
    const sourceRel = row.source;
    const destination = row.destination;
    const expectedHash = row.sha256 ?? null;

    const sourceExists =
      typeof sourceRel === "string"
        ? fs.existsSync(path.join(ROOT, sourceRel))
        : null;

    const destinationExists =
      typeof destination === "string"
        ? fs.existsSync(destination)
        : false;

    let actualHash = null;

    if (destinationExists) {
      try {
        actualHash = sha256(destination);
      } catch {}
    }

    const hashMatches =
      expectedHash === null
        ? destinationExists
        : actualHash === expectedHash;

    if (
      sourceExists === false &&
      destinationExists &&
      hashMatches
    ) {
      verified++;
    } else {
      failures.push({
        source: sourceRel,
        destination,
        sourceExists,
        destinationExists,
        expectedHash,
        actualHash,
        hashMatches,
      });
    }
  }

  deepVerify.push({
    phase: phaseName,
    ok: failures.length === 0,
    expectedApplied: applied.length,
    verifiedApplied: verified,
    failures,
  });
}

const scriptsRoot = path.join(ROOT, "scripts");

const rootInstallers =
  fs.existsSync(scriptsRoot)
    ? fs.readdirSync(scriptsRoot, { withFileTypes: true })
        .filter((entry) =>
          entry.isFile() &&
          /^install-.+\.cjs$/i.test(entry.name)
        )
        .map((entry) => `scripts/${entry.name}`)
        .sort()
    : [];

const installerArchive = path.join(
  ROOT,
  "scripts",
  "installers",
  "archive"
);

const archivedInstallerCount =
  fs.existsSync(installerArchive)
    ? fs.readdirSync(installerArchive, { withFileTypes: true })
        .filter((entry) =>
          entry.isFile() &&
          /^install-.+\.cjs$/i.test(entry.name)
        ).length
    : 0;

const gitStatusRaw =
  git(["status", "--porcelain=v1", "--untracked-files=all"]);

const gitLines =
  gitStatusRaw
    ? gitStatusRaw.split(/\r?\n/).filter(Boolean)
    : [];

const gitSummary = {
  total: gitLines.length,
  deleted: gitLines.filter((x) => x.slice(0, 2).includes("D")).length,
  modified: gitLines.filter((x) => x.slice(0, 2).includes("M")).length,
  added: gitLines.filter((x) => x.slice(0, 2).includes("A")).length,
  untracked: gitLines.filter((x) => x.startsWith("??")).length,
};

const phase3cManifest = backupResults.find((x) => x.phase === "PHASE3C");

const checks = {
  missingCritical:
    critical.filter((x) => !x.exists).length,

  missingProtectedSpotCheck:
    protectedSpot.filter((x) => !x.exists).length,

  phase1DeletedPresentAgain:
    phase1.filter((x) => !x.absent).length,

  backupRootsMissing:
    backupResults.filter((x) => !x.rootExists).length,

  manifestsMissingOrInvalid:
    backupResults.filter(
      (x) => !x.manifestExists || !x.manifestParsed
    ).length,

  deepVerifyFailures:
    deepVerify.filter((x) => !x.ok).length,

  phase3cStatusComplete:
    phase3cManifest?.status ===
      "AI_STOCK_LAB_SAFE_CLEANUP_PHASE3C_STRICT_APPLY_V2_COMPLETE",

  phase3cTotal89:
    Number(phase3cManifest?.summary?.total) === 89,

  phase3cResearch13:
    Number(phase3cManifest?.summary?.researchArchived) === 13,

  phase3cLegacy76:
    Number(phase3cManifest?.summary?.legacyArchived) === 76,
};

const pass =
  checks.missingCritical === 0 &&
  checks.missingProtectedSpotCheck === 0 &&
  checks.phase1DeletedPresentAgain === 0 &&
  checks.backupRootsMissing === 0 &&
  checks.manifestsMissingOrInvalid === 0 &&
  checks.deepVerifyFailures === 0 &&
  checks.phase3cStatusComplete &&
  checks.phase3cTotal89 &&
  checks.phase3cResearch13 &&
  checks.phase3cLegacy76;

const report = {
  status: pass
    ? "AI_STOCK_LAB_FINAL_CLEANUP_AUDIT_V1_PASS"
    : "AI_STOCK_LAB_FINAL_CLEANUP_AUDIT_V1_REVIEW",

  classification:
    "READ_ONLY_FINAL_CLEANUP_INTEGRITY_AUDIT",

  checks,

  critical,
  protectedSpot,
  phase1,
  backups: backupResults,
  deepVerify,

  scripts: {
    rootInstallerCount: rootInstallers.length,
    rootInstallers,
    archivedInstallerCount,
  },

  gitSummary,

  note:
    "Git deletions are expected until cleanup changes are committed. This audit does not require a clean git working tree.",

  safety: {
    readOnly: true,
    filesMoved: 0,
    filesDeleted: 0,
    filesRestored: 0,
    sourceModified: 0,
    stage7Modified: false,
    migrationsModified: false,
    envModified: false,
    scheduledTaskModified: false,
    databaseWrites: 0,
    realTradingChanged: false,
  },

  nextGate: pass
    ? "RUN_EXTERNAL_TSC_AND_WINDOWS_TASK_CHECK_THEN_CLOSE_CLEANUP"
    : "REVIEW_FAILED_AUDIT_CHECKS_BEFORE_ANY_MORE_MUTATION",
};

fs.mkdirSync(
  path.join(ROOT, "logs"),
  { recursive: true }
);

fs.writeFileSync(
  path.join(ROOT, "logs", "final-cleanup-audit-v1.json"),
  JSON.stringify(report, null, 2),
  "utf8"
);

console.log(JSON.stringify(report, null, 2));
process.exit(pass ? 0 : 1);
