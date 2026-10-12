const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const OUT =
  path.join(
    ROOT,
    "scripts",
    "phase3c-post-apply-diagnostic-v1.cjs"
  );

if (!fs.existsSync(path.join(ROOT, "package.json"))) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_PHASE3C_POST_APPLY_DIAGNOSTIC_V1_INSTALL_FAILED",
    reason:
      "PACKAGE_JSON_NOT_FOUND"
  }, null, 2));
  process.exit(1);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });

fs.writeFileSync(
  OUT,
  "const fs = require(\"fs\");\nconst path = require(\"path\");\nconst crypto = require(\"crypto\");\n\nconst ROOT = process.cwd();\n\nconst PLAN_FILE =\n  path.join(\n    ROOT,\n    \"logs\",\n    \"safe-cleanup-phase3c-strict-plan-v2.json\"\n  );\n\nconst EXTERNAL_ROOT =\n  path.resolve(\n    ROOT,\n    \"..\",\n    \"ai-stock-lab-cleanup-backup-20261012-phase3c\"\n  );\n\nconst MANIFEST_FILE =\n  path.join(EXTERNAL_ROOT, \"manifest.json\");\n\nfunction sha256(file) {\n  const h = crypto.createHash(\"sha256\");\n  h.update(fs.readFileSync(file));\n  return h.digest(\"hex\");\n}\n\nif (!fs.existsSync(path.join(ROOT, \"package.json\"))) {\n  console.error(JSON.stringify({\n    status:\n      \"AI_STOCK_LAB_PHASE3C_POST_APPLY_DIAGNOSTIC_V1_FAILED\",\n    reason:\n      \"PACKAGE_JSON_NOT_FOUND\"\n  }, null, 2));\n  process.exit(1);\n}\n\nif (!fs.existsSync(PLAN_FILE)) {\n  console.error(JSON.stringify({\n    status:\n      \"AI_STOCK_LAB_PHASE3C_POST_APPLY_DIAGNOSTIC_V1_FAILED\",\n    reason:\n      \"STRICT_PLAN_V2_NOT_FOUND\"\n  }, null, 2));\n  process.exit(1);\n}\n\nconst plan =\n  JSON.parse(fs.readFileSync(PLAN_FILE, \"utf8\"));\n\nconst research =\n  plan?.buckets?.ARCHIVE_STRICT_RESEARCH ?? [];\n\nconst legacy =\n  plan?.buckets?.ARCHIVE_STRICT_LEGACY ?? [];\n\nconst candidates = [\n  ...research.map((row) => ({\n    ...row,\n    type: \"research\",\n  })),\n  ...legacy.map((row) => ({\n    ...row,\n    type: \"legacy\",\n  })),\n];\n\nconst states = [];\nconst counts = {\n  expected: candidates.length,\n  sourcePresentBackupMissing: 0,\n  sourcePresentBackupPresent: 0,\n  sourceMissingBackupPresent: 0,\n  sourceMissingBackupMissing: 0,\n  backupHashReadable: 0,\n  manifestExists: fs.existsSync(MANIFEST_FILE),\n};\n\nfor (const row of candidates) {\n  const source =\n    path.resolve(ROOT, row.file);\n\n  const relative =\n    row.file.replace(/^scripts\\//i, \"\");\n\n  const backup =\n    path.join(\n      EXTERNAL_ROOT,\n      row.type === \"research\"\n        ? \"research\"\n        : \"legacy\",\n      relative\n    );\n\n  const sourceExists =\n    fs.existsSync(source);\n\n  const backupExists =\n    fs.existsSync(backup);\n\n  let state;\n\n  if (sourceExists && !backupExists) {\n    state = \"SOURCE_PRESENT_BACKUP_MISSING\";\n    counts.sourcePresentBackupMissing++;\n  }\n  else if (sourceExists && backupExists) {\n    state = \"SOURCE_PRESENT_BACKUP_PRESENT\";\n    counts.sourcePresentBackupPresent++;\n  }\n  else if (!sourceExists && backupExists) {\n    state = \"SOURCE_MISSING_BACKUP_PRESENT\";\n    counts.sourceMissingBackupPresent++;\n  }\n  else {\n    state = \"SOURCE_MISSING_BACKUP_MISSING\";\n    counts.sourceMissingBackupMissing++;\n  }\n\n  let sourceSha256 = null;\n  let backupSha256 = null;\n  let byteIdentical = null;\n\n  try {\n    if (sourceExists) {\n      sourceSha256 = sha256(source);\n    }\n\n    if (backupExists) {\n      backupSha256 = sha256(backup);\n      counts.backupHashReadable++;\n    }\n\n    if (sourceExists && backupExists) {\n      byteIdentical =\n        sourceSha256 === backupSha256;\n    }\n  } catch {}\n\n  states.push({\n    file: row.file,\n    type: row.type,\n    state,\n    sourceExists,\n    backupExists,\n    sourceSha256,\n    backupSha256,\n    byteIdentical,\n  });\n}\n\nlet manifest = null;\n\nif (counts.manifestExists) {\n  try {\n    manifest =\n      JSON.parse(fs.readFileSync(MANIFEST_FILE, \"utf8\"));\n  } catch (error) {\n    manifest = {\n      parseError:\n        error instanceof Error\n          ? error.message\n          : String(error),\n    };\n  }\n}\n\nlet diagnosis;\n\nif (\n  counts.sourcePresentBackupMissing === candidates.length &&\n  counts.sourcePresentBackupPresent === 0 &&\n  counts.sourceMissingBackupPresent === 0 &&\n  counts.sourceMissingBackupMissing === 0\n) {\n  diagnosis =\n    \"NO_MUTATION_DETECTED_LIKELY_PREFLIGHT_BLOCK\";\n}\nelse if (\n  counts.sourceMissingBackupPresent === candidates.length &&\n  counts.sourcePresentBackupMissing === 0 &&\n  counts.sourcePresentBackupPresent === 0 &&\n  counts.sourceMissingBackupMissing === 0\n) {\n  diagnosis =\n    \"ALL_89_ARCHIVE_REMOVE_ACTIONS_APPEAR_COMPLETE_MANIFEST_MAY_NEED_VERIFY_OR_RECOVERY\";\n}\nelse {\n  diagnosis =\n    \"MIXED_STATE_POSSIBLE_PARTIAL_APPLY_DO_NOT_RERUN_ORIGINAL_APPLY\";\n}\n\nconst report = {\n  status:\n    \"AI_STOCK_LAB_PHASE3C_POST_APPLY_DIAGNOSTIC_V1_COMPLETE\",\n\n  classification:\n    \"READ_ONLY_POST_FAILURE_STATE_INSPECTION\",\n\n  diagnosis,\n\n  counts,\n\n  manifest,\n\n  stateGroups: {\n    sourcePresentBackupMissing:\n      states.filter(\n        (x) => x.state === \"SOURCE_PRESENT_BACKUP_MISSING\"\n      ),\n\n    sourcePresentBackupPresent:\n      states.filter(\n        (x) => x.state === \"SOURCE_PRESENT_BACKUP_PRESENT\"\n      ),\n\n    sourceMissingBackupPresent:\n      states.filter(\n        (x) => x.state === \"SOURCE_MISSING_BACKUP_PRESENT\"\n      ),\n\n    sourceMissingBackupMissing:\n      states.filter(\n        (x) => x.state === \"SOURCE_MISSING_BACKUP_MISSING\"\n      ),\n  },\n\n  safety: {\n    readOnly: true,\n    repoFilesChanged: 0,\n    filesMoved: 0,\n    filesDeleted: 0,\n    filesRestored: 0,\n    manifestWritten: false,\n    databaseWrites: 0,\n    scheduledTaskModified: false,\n    realTradingChanged: false,\n  },\n\n  nextGate:\n    diagnosis === \"NO_MUTATION_DETECTED_LIKELY_PREFLIGHT_BLOCK\"\n      ? \"CAPTURE_ORIGINAL_APPLY_STDERR_AND_PATCH_PREFLIGHT_CAUSE\"\n      : diagnosis === \"ALL_89_ARCHIVE_REMOVE_ACTIONS_APPEAR_COMPLETE_MANIFEST_MAY_NEED_VERIFY_OR_RECOVERY\"\n        ? \"VERIFY_ALL_89_BACKUPS_AND_RECOVER_OR_ACCEPT_MANIFEST\"\n        : \"RECOVER_PARTIAL_APPLY_WITHOUT_RERUNNING_ORIGINAL_APPLY\",\n};\n\nfs.mkdirSync(\n  path.join(ROOT, \"logs\"),\n  { recursive: true }\n);\n\nfs.writeFileSync(\n  path.join(\n    ROOT,\n    \"logs\",\n    \"phase3c-post-apply-diagnostic-v1.json\"\n  ),\n  JSON.stringify(report, null, 2),\n  \"utf8\"\n);\n\nconsole.log(JSON.stringify(report, null, 2));\nprocess.exit(0);\n",
  "utf8"
);

console.log(JSON.stringify({
  status:
    "AI_STOCK_LAB_PHASE3C_POST_APPLY_DIAGNOSTIC_V1_INSTALLED",
  generatedFile:
    "scripts/phase3c-post-apply-diagnostic-v1.cjs",
  purpose:
    "READ_ONLY_INSPECTION_AFTER_PHASE3C_APPLY_ERROR",
  safety: {
    readOnly: true,
    filesMoved: 0,
    filesDeleted: 0,
    filesRestored: 0,
    manifestWritten: false,
    databaseWrites: 0,
    scheduledTaskModified: false,
    realTradingChanged: false
  },
  important:
    "DO_NOT_RERUN_ORIGINAL_PHASE3C_APPLY_UNTIL_DIAGNOSTIC_IS_REVIEWED"
}, null, 2));
