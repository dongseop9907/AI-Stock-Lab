const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const OUT = path.join(
  ROOT,
  "scripts",
  "safe-cleanup-phase3b-finalize-v1.cjs"
);

if (!fs.existsSync(path.join(ROOT, "package.json"))) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_SAFE_CLEANUP_PHASE3B_FINALIZE_V1_INSTALL_FAILED",
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
  "const fs = require(\"fs\");\nconst path = require(\"path\");\nconst cp = require(\"child_process\");\nconst crypto = require(\"crypto\");\n\nconst ROOT = process.cwd();\n\nconst PLAN_FILE =\n  path.join(ROOT, \"logs\", \"safe-cleanup-phase3b-plan-v1.json\");\n\nconst DRY_RUN_LOG =\n  path.join(\n    ROOT,\n    \"logs\",\n    \"chatgpt-safe-cleanup-phase3b-apply-dry-run-v1.txt\"\n  );\n\nconst EXTERNAL_ROOT =\n  path.resolve(\n    ROOT,\n    \"..\",\n    \"ai-stock-lab-cleanup-backup-20261012-phase3b\"\n  );\n\nconst MANIFEST_FILE =\n  path.join(EXTERNAL_ROOT, \"manifest.json\");\n\nconst CRITICAL_PATTERNS = [\n  /forward-oos/i,\n  /shadow/i,\n  /promotion/i,\n  /stage7/i,\n  /controlled-producer/i,\n  /maturity/i,\n  /collector/i,\n  /provenance/i,\n  /scheduler/i,\n  /kill-switch/i,\n  /paper-order/i,\n  /risk/i,\n];\n\nfunction runGit(args, encoding = \"utf8\") {\n  try {\n    return cp.execFileSync(\n      \"git\",\n      args,\n      {\n        cwd: ROOT,\n        encoding,\n        stdio: [\"ignore\", \"pipe\", \"pipe\"],\n      }\n    );\n  } catch (error) {\n    return null;\n  }\n}\n\nfunction sha256File(full) {\n  const h = crypto.createHash(\"sha256\");\n  h.update(fs.readFileSync(full));\n  return h.digest(\"hex\");\n}\n\nfunction isCritical(file) {\n  return CRITICAL_PATTERNS.some((rx) => rx.test(file));\n}\n\nfunction getIndexBlob(file) {\n  const raw = runGit([\"ls-files\", \"-s\", \"--\", file]);\n\n  if (!raw) return null;\n\n  const line = String(raw)\n    .split(/\\r?\\n/)\n    .find(Boolean);\n\n  if (!line) return null;\n\n  const m = line.match(/^\\d+\\s+([0-9a-f]{40,64})\\s+\\d+\\t/);\n\n  return m ? m[1] : null;\n}\n\nfunction getFilteredBackupBlob(file, backup) {\n  const raw = runGit([\n    \"hash-object\",\n    `--path=${file}`,\n    backup,\n  ]);\n\n  return raw ? String(raw).trim() : null;\n}\n\nif (!fs.existsSync(path.join(ROOT, \"package.json\"))) {\n  console.error(JSON.stringify({\n    status:\n      \"AI_STOCK_LAB_SAFE_CLEANUP_PHASE3B_FINALIZE_V1_FAILED\",\n    reason:\n      \"PACKAGE_JSON_NOT_FOUND\",\n  }, null, 2));\n  process.exit(1);\n}\n\nif (!fs.existsSync(PLAN_FILE)) {\n  console.error(JSON.stringify({\n    status:\n      \"AI_STOCK_LAB_SAFE_CLEANUP_PHASE3B_FINALIZE_V1_FAILED\",\n    reason:\n      \"PHASE3B_PLAN_NOT_FOUND\",\n  }, null, 2));\n  process.exit(1);\n}\n\nif (!fs.existsSync(DRY_RUN_LOG)) {\n  console.error(JSON.stringify({\n    status:\n      \"AI_STOCK_LAB_SAFE_CLEANUP_PHASE3B_FINALIZE_V1_FAILED\",\n    reason:\n      \"PHASE3B_DRY_RUN_LOG_NOT_FOUND\",\n  }, null, 2));\n  process.exit(1);\n}\n\nconst dryRunText =\n  fs.readFileSync(DRY_RUN_LOG, \"utf8\");\n\nconst dryRunContract = {\n  pass:\n    dryRunText.includes(\n      \"AI_STOCK_LAB_SAFE_CLEANUP_PHASE3B_APPLY_V1_DRY_RUN_PASS\"\n    ),\n  strictSafeTotal152:\n    /\"strictSafeTotal\"\\s*:\\s*152/.test(dryRunText),\n  heldBack0:\n    /\"heldBack\"\\s*:\\s*0/.test(dryRunText),\n  preflightFailures0:\n    /\"preflightFailures\"\\s*:\\s*0/.test(dryRunText),\n  tsc0:\n    /Full TSC Exit\\s*=\\s*0/.test(dryRunText),\n};\n\nif (!Object.values(dryRunContract).every(Boolean)) {\n  console.error(JSON.stringify({\n    status:\n      \"AI_STOCK_LAB_SAFE_CLEANUP_PHASE3B_FINALIZE_V1_REVIEW\",\n    reason:\n      \"DRY_RUN_CONTRACT_NOT_CONFIRMED\",\n    dryRunContract,\n    safety: {\n      repoFilesChanged: 0,\n      filesDeleted: 0,\n      filesRestored: 0,\n    },\n  }, null, 2));\n  process.exit(1);\n}\n\nconst plan =\n  JSON.parse(fs.readFileSync(PLAN_FILE, \"utf8\"));\n\nconst repairs =\n  plan?.buckets?.ARCHIVE_SAFE_REPAIR ?? [];\n\nconst diagnostics =\n  plan?.buckets?.ARCHIVE_SAFE_DIAGNOSTIC ?? [];\n\nconst candidates = [\n  ...repairs.map((row) => ({\n    ...row,\n    type: \"repair\",\n  })),\n  ...diagnostics.map((row) => ({\n    ...row,\n    type: \"diagnostic\",\n  })),\n];\n\nconst contract = {\n  repairCount: repairs.length,\n  diagnosticCount: diagnostics.length,\n  total: candidates.length,\n};\n\nif (\n  contract.repairCount !== 56 ||\n  contract.diagnosticCount !== 96 ||\n  contract.total !== 152\n) {\n  console.error(JSON.stringify({\n    status:\n      \"AI_STOCK_LAB_SAFE_CLEANUP_PHASE3B_FINALIZE_V1_REVIEW\",\n    reason:\n      \"PLAN_COUNTS_CHANGED\",\n    contract,\n    safety: {\n      repoFilesChanged: 0,\n      filesDeleted: 0,\n      filesRestored: 0,\n    },\n  }, null, 2));\n  process.exit(1);\n}\n\nconst verified = [];\nconst failures = [];\n\nfor (const row of candidates) {\n  const file = row.file;\n\n  if (isCritical(file)) {\n    failures.push({\n      file,\n      reason:\n        \"CRITICAL_NAME_APPEARED_IN_ARCHIVE_SAFE_PLAN\",\n    });\n    continue;\n  }\n\n  const src =\n    path.resolve(ROOT, file);\n\n  const relative =\n    file.replace(/^scripts\\//i, \"\");\n\n  const backup =\n    path.join(\n      EXTERNAL_ROOT,\n      row.type === \"repair\"\n        ? \"repairs\"\n        : \"diagnostics\",\n      relative\n    );\n\n  const sourceExists =\n    fs.existsSync(src);\n\n  const backupExists =\n    fs.existsSync(backup);\n\n  const indexBlob =\n    getIndexBlob(file);\n\n  const backupBlob =\n    backupExists\n      ? getFilteredBackupBlob(file, backup)\n      : null;\n\n  const backupSha256 =\n    backupExists\n      ? sha256File(backup)\n      : null;\n\n  const ok =\n    !sourceExists &&\n    backupExists &&\n    indexBlob !== null &&\n    backupBlob !== null &&\n    indexBlob === backupBlob;\n\n  if (!ok) {\n    failures.push({\n      file,\n      type: row.type,\n      reason:\n        \"POST_CRASH_STATE_NOT_FULLY_VERIFIED\",\n      sourceExists,\n      backupExists,\n      indexBlob,\n      backupBlob,\n      backupSha256,\n    });\n    continue;\n  }\n\n  verified.push({\n    action:\n      \"ARCHIVE_EXTERNAL_AND_REMOVE_REPO_SOURCE\",\n    type:\n      row.type,\n    source:\n      file,\n    destination:\n      backup,\n    sha256:\n      backupSha256,\n    gitIndexBlob:\n      indexBlob,\n    backupFilteredBlob:\n      backupBlob,\n    sourceRemoved:\n      true,\n    destinationExists:\n      true,\n    verifiedAgainstGitIndex:\n      true,\n  });\n}\n\nconst summary = {\n  repairVerified:\n    verified.filter((x) => x.type === \"repair\").length,\n  diagnosticVerified:\n    verified.filter((x) => x.type === \"diagnostic\").length,\n  totalVerified:\n    verified.length,\n  failures:\n    failures.length,\n};\n\nif (failures.length > 0) {\n  const report = {\n    status:\n      \"AI_STOCK_LAB_SAFE_CLEANUP_PHASE3B_FINALIZE_V1_REVIEW\",\n    classification:\n      \"POST_CRASH_VERIFICATION_INCOMPLETE_NO_FURTHER_MUTATION\",\n    summary,\n    failures,\n    dryRunContract,\n    safety: {\n      repoFilesChangedByFinalizer: 0,\n      filesDeletedByFinalizer: 0,\n      filesRestoredByFinalizer: 0,\n      manifestWritten: false,\n      databaseWrites: 0,\n      scheduledTaskModified: false,\n      realTradingChanged: false,\n    },\n    nextGate:\n      \"DO_NOT_RERUN_PHASE3B_APPLY_INSPECT_FAILURES_FIRST\",\n  };\n\n  fs.mkdirSync(\n    path.join(ROOT, \"logs\"),\n    { recursive: true }\n  );\n\n  fs.writeFileSync(\n    path.join(\n      ROOT,\n      \"logs\",\n      \"safe-cleanup-phase3b-finalize-review-v1.json\"\n    ),\n    JSON.stringify(report, null, 2),\n    \"utf8\"\n  );\n\n  console.error(JSON.stringify(report, null, 2));\n  process.exit(1);\n}\n\nfs.mkdirSync(EXTERNAL_ROOT, { recursive: true });\n\nconst manifest = {\n  status:\n    \"AI_STOCK_LAB_SAFE_CLEANUP_PHASE3B_APPLY_V1_COMPLETE_RECOVERED\",\n\n  recoveredAt:\n    new Date().toISOString(),\n\n  recoveryReason:\n    \"Original apply completed file loop but failed before manifest creation because manifest referenced undefined variable heldBack.\",\n\n  classification:\n    \"POST_CRASH_VERIFIED_EXTERNAL_ARCHIVE_COMPLETE\",\n\n  summary: {\n    repairArchived: 56,\n    diagnosticArchived: 96,\n    total: 152,\n    heldBack: 0,\n  },\n\n  verification: {\n    dryRunContract,\n    eachRepoSourceMissing: true,\n    eachExternalBackupExists: true,\n    eachExternalBackupMatchesGitIndexAfterPathFilters: true,\n    verifiedCount:\n      verified.length,\n  },\n\n  heldBack: [],\n  applied: verified,\n\n  safety: {\n    finalizerModifiedRepoFiles: false,\n    finalizerDeletedFiles: 0,\n    finalizerRestoredFiles: 0,\n    externalManifestWritten: true,\n    stage7RuntimeModifiedByFinalizer: false,\n    migrationsModifiedByFinalizer: false,\n    envModifiedByFinalizer: false,\n    scheduledTaskModifiedByFinalizer: false,\n    databaseWrites: 0,\n    realTradingChanged: false,\n  },\n\n  nextGate:\n    \"RUN_TSC_STAGE7_TASK_CHECK_THEN_PHASE3C_RESCAN\",\n};\n\nfs.writeFileSync(\n  MANIFEST_FILE,\n  JSON.stringify(manifest, null, 2),\n  \"utf8\"\n);\n\nfs.mkdirSync(\n  path.join(ROOT, \"logs\"),\n  { recursive: true }\n);\n\nfs.writeFileSync(\n  path.join(\n    ROOT,\n    \"logs\",\n    \"safe-cleanup-phase3b-finalize-v1.json\"\n  ),\n  JSON.stringify({\n    status:\n      \"AI_STOCK_LAB_SAFE_CLEANUP_PHASE3B_FINALIZE_V1_PASS\",\n    manifest:\n      MANIFEST_FILE,\n    summary:\n      manifest.summary,\n    verification:\n      manifest.verification,\n    safety:\n      manifest.safety,\n  }, null, 2),\n  \"utf8\"\n);\n\nconsole.log(JSON.stringify({\n  status:\n    \"AI_STOCK_LAB_SAFE_CLEANUP_PHASE3B_FINALIZE_V1_PASS\",\n  classification:\n    manifest.classification,\n  manifest:\n    MANIFEST_FILE,\n  summary:\n    manifest.summary,\n  verification:\n    manifest.verification,\n  safety:\n    manifest.safety,\n  nextGate:\n    manifest.nextGate,\n}, null, 2));\n\nprocess.exit(0);\n",
  "utf8"
);

console.log(JSON.stringify({
  status:
    "AI_STOCK_LAB_SAFE_CLEANUP_PHASE3B_FINALIZE_V1_INSTALLED",

  generatedFile:
    "scripts/safe-cleanup-phase3b-finalize-v1.cjs",

  purpose:
    "VERIFY_POST_CRASH_PHASE3B_STATE_AND_REBUILD_MANIFEST_ONLY",

  important: [
    "DO NOT rerun safe-cleanup-phase3b-apply-v1.cjs --apply",
    "this finalizer does not delete, move, or restore repo files",
    "it verifies all 152 external backups against Git index content",
    "manifest is written only if all 152 are verified"
  ],

  safety: {
    repoFilesChangedByFinalizer: 0,
    filesDeletedByFinalizer: 0,
    filesRestoredByFinalizer: 0,
    databaseWrites: 0,
    scheduledTaskModified: false,
    realTradingChanged: false
  },

  nextAction:
    "RUN_PHASE3B_FINALIZER"
}, null, 2));
