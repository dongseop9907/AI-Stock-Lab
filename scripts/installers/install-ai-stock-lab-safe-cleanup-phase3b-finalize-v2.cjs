const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const OUT = path.join(
  ROOT,
  "scripts",
  "safe-cleanup-phase3b-finalize-v2.cjs"
);

if (!fs.existsSync(path.join(ROOT, "package.json"))) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_SAFE_CLEANUP_PHASE3B_FINALIZE_V2_INSTALL_FAILED",
    reason:
      "PACKAGE_JSON_NOT_FOUND"
  }, null, 2));
  process.exit(1);
}

fs.mkdirSync(
  path.dirname(OUT),
  { recursive: true }
);

fs.writeFileSync(
  OUT,
  "const fs = require(\"fs\");\nconst path = require(\"path\");\nconst cp = require(\"child_process\");\nconst crypto = require(\"crypto\");\n\nconst ROOT = process.cwd();\n\nconst PLAN_FILE =\n  path.join(ROOT, \"logs\", \"safe-cleanup-phase3b-plan-v1.json\");\n\nconst EXTERNAL_ROOT =\n  path.resolve(\n    ROOT,\n    \"..\",\n    \"ai-stock-lab-cleanup-backup-20261012-phase3b\"\n  );\n\nconst MANIFEST_FILE =\n  path.join(EXTERNAL_ROOT, \"manifest.json\");\n\nconst REVIEW_FILE =\n  path.join(\n    ROOT,\n    \"logs\",\n    \"safe-cleanup-phase3b-finalize-v2-review.json\"\n  );\n\nconst PASS_FILE =\n  path.join(\n    ROOT,\n    \"logs\",\n    \"safe-cleanup-phase3b-finalize-v2.json\"\n  );\n\nconst CRITICAL_PATTERNS = [\n  /forward-oos/i,\n  /shadow/i,\n  /promotion/i,\n  /stage7/i,\n  /controlled-producer/i,\n  /maturity/i,\n  /collector/i,\n  /provenance/i,\n  /scheduler/i,\n  /kill-switch/i,\n  /paper-order/i,\n  /risk/i,\n];\n\nfunction git(args) {\n  try {\n    return cp.execFileSync(\n      \"git\",\n      args,\n      {\n        cwd: ROOT,\n        encoding: \"utf8\",\n        stdio: [\"ignore\", \"pipe\", \"pipe\"],\n      }\n    ).trim();\n  } catch {\n    return \"\";\n  }\n}\n\nfunction sha256(full) {\n  const h = crypto.createHash(\"sha256\");\n  h.update(fs.readFileSync(full));\n  return h.digest(\"hex\");\n}\n\nfunction isCritical(file) {\n  return CRITICAL_PATTERNS.some((rx) => rx.test(file));\n}\n\nfunction getIndexBlob(file) {\n  const raw = git([\"ls-files\", \"-s\", \"--\", file]);\n\n  if (!raw) return null;\n\n  const line =\n    raw.split(/\\r?\\n/).find(Boolean);\n\n  if (!line) return null;\n\n  const m =\n    line.match(/^\\d+\\s+([0-9a-f]{40,64})\\s+\\d+\\t/);\n\n  return m ? m[1] : null;\n}\n\nfunction getBackupFilteredBlob(file, backup) {\n  const raw = git([\n    \"hash-object\",\n    `--path=${file}`,\n    backup,\n  ]);\n\n  return raw || null;\n}\n\nif (!fs.existsSync(path.join(ROOT, \"package.json\"))) {\n  console.error(JSON.stringify({\n    status:\n      \"AI_STOCK_LAB_SAFE_CLEANUP_PHASE3B_FINALIZE_V2_FAILED\",\n    reason:\n      \"PACKAGE_JSON_NOT_FOUND\",\n  }, null, 2));\n  process.exit(1);\n}\n\nif (!fs.existsSync(PLAN_FILE)) {\n  console.error(JSON.stringify({\n    status:\n      \"AI_STOCK_LAB_SAFE_CLEANUP_PHASE3B_FINALIZE_V2_FAILED\",\n    reason:\n      \"PHASE3B_PLAN_NOT_FOUND\",\n  }, null, 2));\n  process.exit(1);\n}\n\nconst plan =\n  JSON.parse(fs.readFileSync(PLAN_FILE, \"utf8\"));\n\nconst repairs =\n  plan?.buckets?.ARCHIVE_SAFE_REPAIR ?? [];\n\nconst diagnostics =\n  plan?.buckets?.ARCHIVE_SAFE_DIAGNOSTIC ?? [];\n\nconst candidates = [\n  ...repairs.map((row) => ({\n    ...row,\n    type: \"repair\",\n  })),\n  ...diagnostics.map((row) => ({\n    ...row,\n    type: \"diagnostic\",\n  })),\n];\n\nconst expected = {\n  repair: 56,\n  diagnostic: 96,\n  total: 152,\n};\n\nif (\n  repairs.length !== expected.repair ||\n  diagnostics.length !== expected.diagnostic ||\n  candidates.length !== expected.total\n) {\n  console.error(JSON.stringify({\n    status:\n      \"AI_STOCK_LAB_SAFE_CLEANUP_PHASE3B_FINALIZE_V2_REVIEW\",\n    reason:\n      \"PLAN_COUNTS_CHANGED\",\n    expected,\n    actual: {\n      repair: repairs.length,\n      diagnostic: diagnostics.length,\n      total: candidates.length,\n    },\n    safety: {\n      repoFilesChanged: 0,\n      filesDeleted: 0,\n      filesRestored: 0,\n      manifestWritten: false,\n    },\n  }, null, 2));\n  process.exit(1);\n}\n\nconst verified = [];\nconst failures = [];\n\nfor (const row of candidates) {\n  const file = row.file;\n\n  if (isCritical(file)) {\n    failures.push({\n      file,\n      type: row.type,\n      reason:\n        \"CRITICAL_NAME_APPEARED_IN_ARCHIVE_SAFE_PLAN\",\n    });\n    continue;\n  }\n\n  const source =\n    path.resolve(ROOT, file);\n\n  const relative =\n    file.replace(/^scripts\\//i, \"\");\n\n  const backup =\n    path.join(\n      EXTERNAL_ROOT,\n      row.type === \"repair\"\n        ? \"repairs\"\n        : \"diagnostics\",\n      relative\n    );\n\n  const sourceExists =\n    fs.existsSync(source);\n\n  const backupExists =\n    fs.existsSync(backup);\n\n  const indexBlob =\n    getIndexBlob(file);\n\n  const backupFilteredBlob =\n    backupExists\n      ? getBackupFilteredBlob(file, backup)\n      : null;\n\n  const backupSha256 =\n    backupExists\n      ? sha256(backup)\n      : null;\n\n  const indexTracked =\n    indexBlob !== null;\n\n  const backupMatchesGitIndex =\n    indexTracked &&\n    backupFilteredBlob !== null &&\n    indexBlob === backupFilteredBlob;\n\n  const ok =\n    sourceExists === false &&\n    backupExists === true &&\n    indexTracked === true &&\n    backupMatchesGitIndex === true;\n\n  if (!ok) {\n    failures.push({\n      file,\n      type: row.type,\n      reason:\n        \"POST_CRASH_ARCHIVE_STATE_NOT_VERIFIED\",\n      checks: {\n        sourceExists,\n        backupExists,\n        indexTracked,\n        indexBlob,\n        backupFilteredBlob,\n        backupMatchesGitIndex,\n        backupSha256,\n      },\n    });\n\n    continue;\n  }\n\n  verified.push({\n    action:\n      \"ARCHIVE_EXTERNAL_AND_REMOVE_REPO_SOURCE\",\n    type: row.type,\n    source: file,\n    destination: backup,\n    sha256: backupSha256,\n    gitIndexBlob: indexBlob,\n    backupFilteredBlob,\n    sourceRemoved: true,\n    destinationExists: true,\n    verifiedAgainstGitIndex: true,\n  });\n}\n\nconst summary = {\n  repairVerified:\n    verified.filter((x) => x.type === \"repair\").length,\n  diagnosticVerified:\n    verified.filter((x) => x.type === \"diagnostic\").length,\n  totalVerified:\n    verified.length,\n  failures:\n    failures.length,\n};\n\nfs.mkdirSync(\n  path.join(ROOT, \"logs\"),\n  { recursive: true }\n);\n\nif (failures.length > 0) {\n  const review = {\n    status:\n      \"AI_STOCK_LAB_SAFE_CLEANUP_PHASE3B_FINALIZE_V2_REVIEW\",\n\n    classification:\n      \"POST_CRASH_VERIFICATION_INCOMPLETE_NO_MUTATION\",\n\n    expected,\n    summary,\n\n    failures,\n\n    safety: {\n      repoFilesChangedByFinalizer: 0,\n      filesDeletedByFinalizer: 0,\n      filesRestoredByFinalizer: 0,\n      manifestWritten: false,\n      databaseWrites: 0,\n      scheduledTaskModified: false,\n      realTradingChanged: false,\n    },\n\n    nextGate:\n      \"DO_NOT_RERUN_ORIGINAL_APPLY_INSPECT_FAILURES_FIRST\",\n  };\n\n  fs.writeFileSync(\n    REVIEW_FILE,\n    JSON.stringify(review, null, 2),\n    \"utf8\"\n  );\n\n  console.error(\n    JSON.stringify(review, null, 2)\n  );\n\n  process.exit(1);\n}\n\nfs.mkdirSync(\n  EXTERNAL_ROOT,\n  { recursive: true }\n);\n\nconst manifest = {\n  status:\n    \"AI_STOCK_LAB_SAFE_CLEANUP_PHASE3B_APPLY_V1_COMPLETE_RECOVERED\",\n\n  recoveredAt:\n    new Date().toISOString(),\n\n  recoveryReason:\n    \"Original Phase3B apply finished its archive/remove loop and then crashed while constructing its manifest because of an undefined variable. V2 verified all candidates directly against the Git index and external backups.\",\n\n  classification:\n    \"POST_CRASH_VERIFIED_EXTERNAL_ARCHIVE_COMPLETE\",\n\n  summary: {\n    repairArchived: 56,\n    diagnosticArchived: 96,\n    total: 152,\n    heldBack: 0,\n  },\n\n  verification: {\n    expectedCandidateCount: 152,\n    eachRepoSourceMissing: true,\n    eachExternalBackupExists: true,\n    eachCandidateStillTrackedInGitIndex: true,\n    eachExternalBackupMatchesGitIndexAfterPathFilters: true,\n    verifiedCount: verified.length,\n  },\n\n  heldBack: [],\n  applied: verified,\n\n  safety: {\n    finalizerModifiedRepoFiles: false,\n    finalizerDeletedFiles: 0,\n    finalizerRestoredFiles: 0,\n    externalManifestWritten: true,\n    stage7RuntimeModifiedByFinalizer: false,\n    migrationsModifiedByFinalizer: false,\n    envModifiedByFinalizer: false,\n    scheduledTaskModifiedByFinalizer: false,\n    databaseWrites: 0,\n    realTradingChanged: false,\n  },\n\n  nextGate:\n    \"RUN_TSC_STAGE7_TASK_CHECK_THEN_PHASE3C_RESCAN\",\n};\n\nfs.writeFileSync(\n  MANIFEST_FILE,\n  JSON.stringify(manifest, null, 2),\n  \"utf8\"\n);\n\nconst pass = {\n  status:\n    \"AI_STOCK_LAB_SAFE_CLEANUP_PHASE3B_FINALIZE_V2_PASS\",\n\n  manifest:\n    MANIFEST_FILE,\n\n  summary:\n    manifest.summary,\n\n  verification:\n    manifest.verification,\n\n  safety:\n    manifest.safety,\n\n  nextGate:\n    manifest.nextGate,\n};\n\nfs.writeFileSync(\n  PASS_FILE,\n  JSON.stringify(pass, null, 2),\n  \"utf8\"\n);\n\nconsole.log(\n  JSON.stringify(pass, null, 2)\n);\n\nprocess.exit(0);\n",
  "utf8"
);

console.log(JSON.stringify({
  status:
    "AI_STOCK_LAB_SAFE_CLEANUP_PHASE3B_FINALIZE_V2_INSTALLED",

  generatedFile:
    "scripts/safe-cleanup-phase3b-finalize-v2.cjs",

  purpose:
    "DIRECT_POST_CRASH_VERIFICATION_AND_MANIFEST_RECOVERY",

  differencesFromV1: [
    "does not depend on PowerShell dry-run log encoding",
    "verifies all 152 planned files directly",
    "requires repo source to be absent",
    "requires external backup to exist",
    "requires candidate to still exist in Git index",
    "requires external backup content to hash to the exact Git index blob"
  ],

  safety: {
    noRepoMutation: true,
    noDelete: true,
    noRestore: true,
    manifestOnlyOnFull152Verification: true,
    databaseWrites: 0,
    scheduledTaskModified: false,
    realTradingChanged: false
  },

  important:
    "DO_NOT_RERUN_ORIGINAL_PHASE3B_APPLY"
}, null, 2));
