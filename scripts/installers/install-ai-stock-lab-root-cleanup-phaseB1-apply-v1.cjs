const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const OUT =
  path.join(
    ROOT,
    "scripts",
    "root-cleanup-phaseB1-apply-v1.cjs"
  );

if (!fs.existsSync(path.join(ROOT, "package.json"))) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_ROOT_CLEANUP_PHASEB1_APPLY_V1_INSTALL_FAILED",
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
  "const fs = require(\"fs\");\nconst path = require(\"path\");\nconst cp = require(\"child_process\");\nconst crypto = require(\"crypto\");\n\nconst ROOT = process.cwd();\nconst APPLY = process.argv.includes(\"--apply\");\n\nconst PLAN_FILE =\n  path.join(\n    ROOT,\n    \"logs\",\n    \"root-cleanup-phaseB-plan-v1.json\"\n  );\n\nconst EXTERNAL_ROOT =\n  path.resolve(\n    ROOT,\n    \"..\",\n    \"ai-stock-lab-cleanup-backup-20261012-root-phaseB1\"\n  );\n\nconst MANIFEST_FILE =\n  path.join(EXTERNAL_ROOT, \"manifest.json\");\n\nconst PROGRESS_FILE =\n  path.join(EXTERNAL_ROOT, \"progress.json\");\n\nfunction posix(p) {\n  return p.split(path.sep).join(\"/\");\n}\n\nfunction git(args) {\n  try {\n    return cp.execFileSync(\n      \"git\",\n      args,\n      {\n        cwd: ROOT,\n        encoding: \"utf8\",\n        stdio: [\"ignore\", \"pipe\", \"pipe\"],\n      }\n    ).trim();\n  } catch {\n    return \"\";\n  }\n}\n\nfunction trackedSet() {\n  const raw = git([\"ls-files\"]);\n  return new Set(\n    raw ? raw.split(/\\r?\\n/).map(posix).filter(Boolean) : []\n  );\n}\n\nfunction statusMap() {\n  const raw =\n    git([\"status\", \"--porcelain=v1\", \"--untracked-files=all\"]);\n\n  const map = new Map();\n\n  if (!raw) return map;\n\n  for (const line of raw.split(/\\r?\\n/)) {\n    if (line.length < 4) continue;\n\n    const code = line.slice(0, 2);\n    let file = line.slice(3).trim();\n\n    if (file.includes(\" -> \")) {\n      file = file.split(\" -> \").pop();\n    }\n\n    file = file.replace(/^\"|\"$/g, \"\");\n    map.set(posix(file), code);\n  }\n\n  return map;\n}\n\nfunction packageText() {\n  const file = path.join(ROOT, \"package.json\");\n  return fs.existsSync(file)\n    ? fs.readFileSync(file, \"utf8\")\n    : \"\";\n}\n\nfunction taskText() {\n  try {\n    return cp.execFileSync(\n      \"schtasks\",\n      [\"/Query\", \"/FO\", \"LIST\", \"/V\"],\n      {\n        encoding: \"utf8\",\n        stdio: [\"ignore\", \"pipe\", \"pipe\"],\n      }\n    );\n  } catch {\n    return \"\";\n  }\n}\n\nfunction sha256(file) {\n  const h = crypto.createHash(\"sha256\");\n  h.update(fs.readFileSync(file));\n  return h.digest(\"hex\");\n}\n\nfunction copyVerified(src, dst) {\n  fs.mkdirSync(path.dirname(dst), { recursive: true });\n  fs.copyFileSync(src, dst);\n\n  const sourceHash = sha256(src);\n  const backupHash = sha256(dst);\n\n  if (sourceHash !== backupHash) {\n    throw new Error(\n      `SHA256_BACKUP_MISMATCH:${src}:${dst}`\n    );\n  }\n\n  return {\n    sourceHash,\n    backupHash,\n  };\n}\n\nfunction currentDuplicateProof(sourceFile, duplicatePaths) {\n  const src = path.join(ROOT, sourceFile);\n\n  if (!fs.existsSync(src)) {\n    return {\n      ok: false,\n      reason: \"SOURCE_MISSING\",\n      matchedDuplicate: null,\n      sourceHash: null,\n      duplicateHash: null,\n    };\n  }\n\n  const sourceHash = sha256(src);\n\n  for (const duplicate of duplicatePaths) {\n    const duplicateFull = path.join(ROOT, duplicate);\n\n    if (!fs.existsSync(duplicateFull)) continue;\n\n    try {\n      const duplicateHash = sha256(duplicateFull);\n\n      if (duplicateHash === sourceHash) {\n        return {\n          ok: true,\n          reason: null,\n          matchedDuplicate: duplicate,\n          sourceHash,\n          duplicateHash,\n        };\n      }\n    } catch {}\n  }\n\n  return {\n    ok: false,\n    reason: \"NO_CURRENT_BYTE_IDENTICAL_ACTIVE_COPY\",\n    matchedDuplicate: null,\n    sourceHash,\n    duplicateHash: null,\n  };\n}\n\nif (!fs.existsSync(path.join(ROOT, \"package.json\"))) {\n  console.error(JSON.stringify({\n    status:\n      \"AI_STOCK_LAB_ROOT_CLEANUP_PHASEB1_APPLY_V1_FAILED\",\n    reason:\n      \"PACKAGE_JSON_NOT_FOUND\",\n  }, null, 2));\n  process.exit(1);\n}\n\nif (!fs.existsSync(PLAN_FILE)) {\n  console.error(JSON.stringify({\n    status:\n      \"AI_STOCK_LAB_ROOT_CLEANUP_PHASEB1_APPLY_V1_FAILED\",\n    reason:\n      \"PHASEB_PLAN_NOT_FOUND\",\n  }, null, 2));\n  process.exit(1);\n}\n\nconst plan =\n  JSON.parse(fs.readFileSync(PLAN_FILE, \"utf8\"));\n\nconst candidates =\n  plan?.buckets?.ARCHIVE_EXACT_DUPLICATE ?? [];\n\nconst EXPECTED_COUNT = 43;\n\nif (candidates.length !== EXPECTED_COUNT) {\n  console.error(JSON.stringify({\n    status:\n      \"AI_STOCK_LAB_ROOT_CLEANUP_PHASEB1_APPLY_V1_PREFLIGHT_REVIEW\",\n    reason:\n      \"PLAN_COUNT_CHANGED\",\n    expected:\n      EXPECTED_COUNT,\n    actual:\n      candidates.length,\n    safety: {\n      filesBackedUp: 0,\n      filesRemoved: 0,\n      repoMutation: false,\n    },\n  }, null, 2));\n  process.exit(1);\n}\n\nconst tracked = trackedSet();\nconst status = statusMap();\nconst pkg = packageText();\nconst tasks = taskText();\n\nconst safe = [];\nconst blocked = [];\n\nfor (const row of candidates) {\n  const file = row.file;\n  const full = path.join(ROOT, file);\n  const base = path.basename(file);\n\n  const sourceExists =\n    fs.existsSync(full);\n\n  const trackedNow =\n    tracked.has(file);\n\n  const gitStatusNow =\n    status.get(file) || null;\n\n  const packageReferenceNow =\n    pkg.includes(file) ||\n    pkg.includes(base);\n\n  const taskReferenceNow =\n    tasks.includes(file) ||\n    tasks.includes(base);\n\n  const priorReferenceCount =\n    row.currentReferenceCount ?? 0;\n\n  const plannedDuplicates =\n    Array.isArray(row.exactDuplicatesElsewhere)\n      ? row.exactDuplicatesElsewhere\n      : [];\n\n  const duplicateProof =\n    currentDuplicateProof(\n      file,\n      plannedDuplicates\n    );\n\n  const reasons = [];\n\n  if (!sourceExists) {\n    reasons.push(\"SOURCE_MISSING\");\n  }\n\n  if (!trackedNow) {\n    reasons.push(\"NOT_GIT_TRACKED_NOW\");\n  }\n\n  if (gitStatusNow) {\n    reasons.push(\n      `CURRENT_GIT_STATUS_${gitStatusNow}`\n    );\n  }\n\n  if (packageReferenceNow) {\n    reasons.push(\"PACKAGE_JSON_REFERENCE_NOW\");\n  }\n\n  if (taskReferenceNow) {\n    reasons.push(\"WINDOWS_TASK_REFERENCE_NOW\");\n  }\n\n  if (priorReferenceCount !== 0) {\n    reasons.push(\"PRIOR_REFERENCE_COUNT_NONZERO\");\n  }\n\n  if (!duplicateProof.ok) {\n    reasons.push(\n      duplicateProof.reason ||\n      \"DUPLICATE_PROOF_FAILED\"\n    );\n  }\n\n  const record = {\n    file,\n    sourceExists,\n    trackedNow,\n    gitStatusNow,\n    packageReferenceNow,\n    taskReferenceNow,\n    priorReferenceCount,\n    plannedDuplicates,\n    duplicateProof,\n  };\n\n  if (reasons.length === 0) {\n    safe.push(record);\n  } else {\n    blocked.push({\n      ...record,\n      reasons,\n    });\n  }\n}\n\nconst collisions = [];\n\nfor (const row of safe) {\n  const dst =\n    path.join(\n      EXTERNAL_ROOT,\n      \"exact-duplicates\",\n      row.file\n    );\n\n  if (fs.existsSync(dst)) {\n    collisions.push({\n      file: row.file,\n      destination: dst,\n      reason:\n        \"EXTERNAL_BACKUP_COLLISION\",\n    });\n  }\n}\n\nconst summary = {\n  planExactDuplicates:\n    candidates.length,\n\n  safeExactDuplicates:\n    safe.length,\n\n  blocked:\n    blocked.length,\n\n  collisions:\n    collisions.length,\n};\n\nif (\n  blocked.length > 0 ||\n  collisions.length > 0\n) {\n  console.error(JSON.stringify({\n    status:\n      \"AI_STOCK_LAB_ROOT_CLEANUP_PHASEB1_APPLY_V1_PREFLIGHT_REVIEW\",\n\n    classification:\n      \"NO_MUTATION_PREFLIGHT_BLOCKED\",\n\n    summary,\n    blocked,\n    collisions,\n\n    safety: {\n      filesBackedUp: 0,\n      filesRemoved: 0,\n      repoMutation: false,\n      stage7Modified: false,\n      envModified: false,\n      scheduledTaskModified: false,\n      databaseWrites: 0,\n      realTradingChanged: false,\n    },\n\n    nextGate:\n      \"DO_NOT_APPLY_REVIEW_PREFLIGHT\",\n  }, null, 2));\n\n  process.exit(1);\n}\n\nif (!APPLY) {\n  console.log(JSON.stringify({\n    status:\n      \"AI_STOCK_LAB_ROOT_CLEANUP_PHASEB1_APPLY_V1_DRY_RUN_PASS\",\n\n    classification:\n      \"ROOT_43_BYTE_IDENTICAL_DUPLICATES_PREFLIGHT_SAFE_NO_MUTATION\",\n\n    summary,\n\n    externalBackupRoot:\n      EXTERNAL_ROOT,\n\n    candidates:\n      safe,\n\n    safety: {\n      dryRun: true,\n      filesBackedUp: 0,\n      filesRemoved: 0,\n      repoMutation: false,\n      stage7Modified: false,\n      envModified: false,\n      scheduledTaskModified: false,\n      databaseWrites: 0,\n      realTradingChanged: false,\n    },\n\n    nextGate:\n      \"RUN_--apply_ONLY_AFTER_DRY_RUN_REVIEW\",\n  }, null, 2));\n\n  process.exit(0);\n}\n\nfs.mkdirSync(\n  EXTERNAL_ROOT,\n  { recursive: true }\n);\n\nconst applied = [];\n\nfunction writeProgress(statusValue, error = null) {\n  fs.writeFileSync(\n    PROGRESS_FILE,\n    JSON.stringify({\n      status:\n        statusValue,\n      updatedAt:\n        new Date().toISOString(),\n      expectedCount:\n        EXPECTED_COUNT,\n      appliedCount:\n        applied.length,\n      applied,\n      error,\n    }, null, 2),\n    \"utf8\"\n  );\n}\n\nwriteProgress(\"STARTED\");\n\ntry {\n  for (const row of safe) {\n    const src =\n      path.join(ROOT, row.file);\n\n    // Re-check immediately before each destructive step.\n    const duplicateProof =\n      currentDuplicateProof(\n        row.file,\n        row.plannedDuplicates\n      );\n\n    if (!duplicateProof.ok) {\n      throw new Error(\n        `FINAL_DUPLICATE_PROOF_FAILED:${row.file}`\n      );\n    }\n\n    const dst =\n      path.join(\n        EXTERNAL_ROOT,\n        \"exact-duplicates\",\n        row.file\n      );\n\n    const hashes =\n      copyVerified(src, dst);\n\n    fs.unlinkSync(src);\n\n    applied.push({\n      file:\n        row.file,\n\n      activeIdenticalCopy:\n        duplicateProof.matchedDuplicate,\n\n      destination:\n        dst,\n\n      sha256:\n        hashes.backupHash,\n\n      sourceRemoved:\n        !fs.existsSync(src),\n\n      backupExists:\n        fs.existsSync(dst),\n\n      activeCopyStillExists:\n        fs.existsSync(\n          path.join(\n            ROOT,\n            duplicateProof.matchedDuplicate\n          )\n        ),\n    });\n\n    writeProgress(\"IN_PROGRESS\");\n  }\n} catch (error) {\n  const message =\n    error instanceof Error\n      ? error.message\n      : String(error);\n\n  writeProgress(\n    \"PARTIAL_FAILURE\",\n    message\n  );\n\n  console.error(JSON.stringify({\n    status:\n      \"AI_STOCK_LAB_ROOT_CLEANUP_PHASEB1_APPLY_V1_PARTIAL_FAILURE\",\n\n    reason:\n      message,\n\n    appliedCount:\n      applied.length,\n\n    progressFile:\n      PROGRESS_FILE,\n\n    externalBackupRoot:\n      EXTERNAL_ROOT,\n\n    important:\n      \"DO_NOT_RERUN_BLINDLY_USE_PROGRESS_FOR_RECOVERY\",\n  }, null, 2));\n\n  process.exit(1);\n}\n\nconst manifest = {\n  status:\n    \"AI_STOCK_LAB_ROOT_CLEANUP_PHASEB1_APPLY_V1_COMPLETE\",\n\n  appliedAt:\n    new Date().toISOString(),\n\n  classification:\n    \"ROOT_BYTE_IDENTICAL_ACTIVE_DUPLICATES_EXTERNALLY_BACKED_UP_AND_REMOVED\",\n\n  summary: {\n    exactDuplicatesRemoved:\n      applied.length,\n    total:\n      applied.length,\n  },\n\n  applied,\n\n  safety: {\n    sourceHadCurrentByteIdenticalActiveCopy:\n      true,\n\n    externalBackupSha256Verified:\n      true,\n\n    activeCopiesPreserved:\n      applied.every(\n        (x) => x.activeCopyStillExists\n      ),\n\n    stage7Modified:\n      false,\n\n    envModified:\n      false,\n\n    scheduledTaskModified:\n      false,\n\n    databaseWrites:\n      0,\n\n    realTradingChanged:\n      false,\n  },\n\n  nextGate:\n    \"VERIFY_TSC_TASK_AND_ROOT_COUNT_THEN_PHASEB2_REVIEW\",\n};\n\nfs.writeFileSync(\n  MANIFEST_FILE,\n  JSON.stringify(manifest, null, 2),\n  \"utf8\"\n);\n\nwriteProgress(\"COMPLETE\");\n\nconsole.log(\n  JSON.stringify(manifest, null, 2)\n);\n\nprocess.exit(0);\n",
  "utf8"
);

console.log(JSON.stringify({
  status:
    "AI_STOCK_LAB_ROOT_CLEANUP_PHASEB1_APPLY_V1_INSTALLED",

  generatedFile:
    "scripts/root-cleanup-phaseB1-apply-v1.cjs",

  mode:
    "DRY_RUN_BY_DEFAULT_APPLY_REQUIRES_--apply",

  expected: {
    exactDuplicates: 43
  },

  behavior: [
    "rechecks Git tracked and clean state",
    "rechecks package.json and Windows task references",
    "requires a currently existing byte-identical active copy",
    "apply backs up each root duplicate outside repo with SHA256 verification",
    "rechecks duplicate proof immediately before every removal",
    "writes progress.json after every successful file"
  ],

  safety: {
    noBroadDelete: true,
    noGitClean: true,
    stage7Modified: false,
    envModified: false,
    scheduledTaskModified: false,
    databaseWrites: 0,
    realTradingChanged: false
  },

  nextAction:
    "RUN_ROOT_PHASEB1_DRY_RUN_FIRST"
}, null, 2));
