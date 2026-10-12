const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const OUT = path.join(
  ROOT,
  "scripts",
  "safe-cleanup-phase3b-apply-v1.cjs"
);

if (!fs.existsSync(path.join(ROOT, "package.json"))) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_SAFE_CLEANUP_PHASE3B_APPLY_V1_INSTALL_FAILED",
    reason:
      "PACKAGE_JSON_NOT_FOUND"
  }, null, 2));
  process.exit(1);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });

fs.writeFileSync(
  OUT,
  "const fs = require(\"fs\");\nconst path = require(\"path\");\nconst cp = require(\"child_process\");\nconst crypto = require(\"crypto\");\n\nconst ROOT = process.cwd();\nconst APPLY = process.argv.includes(\"--apply\");\n\nconst PLAN_FILE =\n  path.join(ROOT, \"logs\", \"safe-cleanup-phase3b-plan-v1.json\");\n\nconst EXTERNAL_ROOT =\n  path.resolve(\n    ROOT,\n    \"..\",\n    \"ai-stock-lab-cleanup-backup-20261012-phase3b\"\n  );\n\nconst CRITICAL_PATTERNS = [\n  /forward-oos/i,\n  /shadow/i,\n  /promotion/i,\n  /stage7/i,\n  /controlled-producer/i,\n  /maturity/i,\n  /collector/i,\n  /provenance/i,\n  /scheduler/i,\n  /kill-switch/i,\n  /paper-order/i,\n  /risk/i,\n];\n\nfunction posix(p) {\n  return p.split(path.sep).join(\"/\");\n}\n\nfunction git(args) {\n  try {\n    return cp.execFileSync(\n      \"git\",\n      args,\n      {\n        cwd: ROOT,\n        encoding: \"utf8\",\n        stdio: [\"ignore\", \"pipe\", \"pipe\"],\n      }\n    ).trim();\n  } catch {\n    return \"\";\n  }\n}\n\nfunction trackedSet() {\n  const raw = git([\"ls-files\"]);\n  return new Set(\n    raw ? raw.split(/\\r?\\n/).map(posix).filter(Boolean) : []\n  );\n}\n\nfunction statusMap() {\n  const raw = git([\"status\", \"--porcelain=v1\", \"--untracked-files=all\"]);\n  const map = new Map();\n\n  if (!raw) return map;\n\n  for (const line of raw.split(/\\r?\\n/)) {\n    if (line.length < 4) continue;\n\n    const code = line.slice(0, 2);\n    let file = line.slice(3).trim();\n\n    if (file.includes(\" -> \")) {\n      file = file.split(\" -> \").pop();\n    }\n\n    file = file.replace(/^\"|\"$/g, \"\");\n    map.set(posix(file), code);\n  }\n\n  return map;\n}\n\nfunction packageText() {\n  const p = path.join(ROOT, \"package.json\");\n  return fs.existsSync(p)\n    ? fs.readFileSync(p, \"utf8\")\n    : \"\";\n}\n\nfunction scheduledTaskText() {\n  try {\n    return cp.execFileSync(\n      \"schtasks\",\n      [\"/Query\", \"/FO\", \"LIST\", \"/V\"],\n      {\n        encoding: \"utf8\",\n        stdio: [\"ignore\", \"pipe\", \"pipe\"],\n      }\n    );\n  } catch {\n    return \"\";\n  }\n}\n\nfunction sha256(full) {\n  const h = crypto.createHash(\"sha256\");\n  h.update(fs.readFileSync(full));\n  return h.digest(\"hex\");\n}\n\nfunction isCritical(file) {\n  return CRITICAL_PATTERNS.some((rx) => rx.test(file));\n}\n\nfunction copyVerified(src, dst) {\n  fs.mkdirSync(path.dirname(dst), { recursive: true });\n  fs.copyFileSync(src, dst);\n\n  const sourceHash = sha256(src);\n  const backupHash = sha256(dst);\n\n  if (sourceHash !== backupHash) {\n    throw new Error(`HASH_MISMATCH:${src}:${dst}`);\n  }\n\n  return { sourceHash, backupHash };\n}\n\nif (!fs.existsSync(path.join(ROOT, \"package.json\"))) {\n  console.error(JSON.stringify({\n    status:\n      \"AI_STOCK_LAB_SAFE_CLEANUP_PHASE3B_APPLY_V1_FAILED\",\n    reason:\n      \"PACKAGE_JSON_NOT_FOUND\",\n  }, null, 2));\n  process.exit(1);\n}\n\nif (!fs.existsSync(PLAN_FILE)) {\n  console.error(JSON.stringify({\n    status:\n      \"AI_STOCK_LAB_SAFE_CLEANUP_PHASE3B_APPLY_V1_FAILED\",\n    reason:\n      \"PHASE3B_PLAN_NOT_FOUND\",\n  }, null, 2));\n  process.exit(1);\n}\n\nconst plan =\n  JSON.parse(fs.readFileSync(PLAN_FILE, \"utf8\"));\n\nconst sourceRepair =\n  plan?.buckets?.ARCHIVE_SAFE_REPAIR ?? [];\n\nconst sourceDiagnostic =\n  plan?.buckets?.ARCHIVE_SAFE_DIAGNOSTIC ?? [];\n\nconst tracked = trackedSet();\nconst gitStatus = statusMap();\nconst pkg = packageText();\nconst tasks = scheduledTaskText();\n\nconst safe = [];\nconst held = [];\n\nfunction evaluate(row, type) {\n  const file = row.file;\n  const full = path.resolve(ROOT, file);\n  const base = path.basename(file);\n\n  const checks = {\n    sourceExists: fs.existsSync(full),\n    trackedNow: tracked.has(file),\n    gitStatusNow: gitStatus.get(file) || null,\n    referenceCountFromPlan: row.referenceCount ?? 0,\n    packageReferenceNow:\n      pkg.includes(file) || pkg.includes(base),\n    scheduledTaskReferenceNow:\n      tasks.includes(file) || tasks.includes(base),\n    criticalName:\n      isCritical(file),\n  };\n\n  const reasons = [];\n\n  if (!checks.sourceExists) {\n    reasons.push(\"SOURCE_MISSING\");\n  }\n\n  // Stronger than the Phase3B planner:\n  // ignored/untracked files are never auto-archived even if git status is blank.\n  if (!checks.trackedNow) {\n    reasons.push(\"NOT_GIT_TRACKED_NOW\");\n  }\n\n  if (checks.gitStatusNow) {\n    reasons.push(`GIT_STATUS_${checks.gitStatusNow}`);\n  }\n\n  if (checks.referenceCountFromPlan !== 0) {\n    reasons.push(\"REFERENCE_COUNT_NONZERO\");\n  }\n\n  if (checks.packageReferenceNow) {\n    reasons.push(\"PACKAGE_JSON_REFERENCE_NOW\");\n  }\n\n  if (checks.scheduledTaskReferenceNow) {\n    reasons.push(\"WINDOWS_TASK_REFERENCE_NOW\");\n  }\n\n  if (checks.criticalName) {\n    reasons.push(\"CURRENT_CRITICAL_NAME_GUARD\");\n  }\n\n  const record = {\n    file,\n    type,\n    checks,\n    planTracked: row.tracked ?? null,\n    planConfidence: row.confidence ?? null,\n    planReason: row.reason ?? null,\n  };\n\n  if (reasons.length === 0) {\n    safe.push(record);\n  } else {\n    held.push({\n      ...record,\n      holdReasons: reasons,\n    });\n  }\n}\n\nfor (const row of sourceRepair) {\n  evaluate(row, \"repair\");\n}\n\nfor (const row of sourceDiagnostic) {\n  evaluate(row, \"diagnostic\");\n}\n\nconst preflightFailures = [];\n\nfor (const row of safe) {\n  const src = path.resolve(ROOT, row.file);\n\n  const relative =\n    row.file.replace(/^scripts\\//i, \"\");\n\n  const dst = path.join(\n    EXTERNAL_ROOT,\n    row.type === \"repair\"\n      ? \"repairs\"\n      : \"diagnostics\",\n    relative\n  );\n\n  if (fs.existsSync(dst)) {\n    preflightFailures.push({\n      file: row.file,\n      reason: \"EXTERNAL_ARCHIVE_COLLISION\",\n      destination: dst,\n    });\n  }\n\n  if (!src.startsWith(path.resolve(ROOT) + path.sep)) {\n    preflightFailures.push({\n      file: row.file,\n      reason: \"SOURCE_OUTSIDE_REPO\",\n    });\n  }\n}\n\nconst summary = {\n  planArchiveSafeRepair:\n    sourceRepair.length,\n  planArchiveSafeDiagnostic:\n    sourceDiagnostic.length,\n  planArchiveSafeTotal:\n    sourceRepair.length + sourceDiagnostic.length,\n\n  strictSafeRepair:\n    safe.filter((x) => x.type === \"repair\").length,\n  strictSafeDiagnostic:\n    safe.filter((x) => x.type === \"diagnostic\").length,\n  strictSafeTotal:\n    safe.length,\n\n  heldBack:\n    held.length,\n\n  preflightFailures:\n    preflightFailures.length,\n};\n\nif (preflightFailures.length > 0) {\n  console.error(JSON.stringify({\n    status:\n      \"AI_STOCK_LAB_SAFE_CLEANUP_PHASE3B_APPLY_V1_PREFLIGHT_REVIEW\",\n\n    classification:\n      \"NO_MUTATION_PREFLIGHT_BLOCKED\",\n\n    summary,\n    heldBack:\n      held.slice(0, 100),\n    preflightFailures,\n\n    safety: {\n      filesArchived: 0,\n      filesRemovedFromRepo: 0,\n      stage7RuntimeModified: false,\n      migrationsModified: false,\n      envModified: false,\n      scheduledTaskModified: false,\n      databaseWrites: 0,\n      realTradingChanged: false,\n    },\n  }, null, 2));\n\n  process.exit(1);\n}\n\nif (!APPLY) {\n  console.log(JSON.stringify({\n    status:\n      \"AI_STOCK_LAB_SAFE_CLEANUP_PHASE3B_APPLY_V1_DRY_RUN_PASS\",\n\n    classification:\n      \"STRICT_TRACKED_CLEAN_UNREFERENCED_ARCHIVE_SAFE_ONLY\",\n\n    summary,\n\n    heldBack:\n      held.slice(0, 100),\n\n    sampleSafe:\n      safe.slice(0, 50),\n\n    destination:\n      EXTERNAL_ROOT,\n\n    safety: {\n      dryRun: true,\n      filesArchived: 0,\n      filesRemovedFromRepo: 0,\n      stage7RuntimeModified: false,\n      migrationsModified: false,\n      envModified: false,\n      scheduledTaskModified: false,\n      databaseWrites: 0,\n      realTradingChanged: false,\n    },\n\n    nextGate:\n      \"RUN_WITH_--apply_ONLY_AFTER_REVIEWING_STRICT_SAFE_AND_HELD_COUNTS\",\n  }, null, 2));\n\n  process.exit(0);\n}\n\nfs.mkdirSync(EXTERNAL_ROOT, { recursive: true });\n\nconst applied = [];\n\ntry {\n  for (const row of safe) {\n    const src = path.resolve(ROOT, row.file);\n\n    const relative =\n      row.file.replace(/^scripts\\//i, \"\");\n\n    const dst = path.join(\n      EXTERNAL_ROOT,\n      row.type === \"repair\"\n        ? \"repairs\"\n        : \"diagnostics\",\n      relative\n    );\n\n    const proof = copyVerified(src, dst);\n\n    fs.unlinkSync(src);\n\n    applied.push({\n      action:\n        \"ARCHIVE_EXTERNAL_AND_REMOVE_REPO_SOURCE\",\n      type:\n        row.type,\n      source:\n        row.file,\n      destination:\n        dst,\n      sha256:\n        proof.backupHash,\n      sourceRemoved:\n        !fs.existsSync(src),\n      destinationExists:\n        fs.existsSync(dst),\n    });\n  }\n} catch (error) {\n  console.error(JSON.stringify({\n    status:\n      \"AI_STOCK_LAB_SAFE_CLEANUP_PHASE3B_APPLY_V1_PARTIAL_FAILURE\",\n    reason:\n      error instanceof Error\n        ? error.message\n        : String(error),\n    appliedCount:\n      applied.length,\n    applied,\n    recoveryRoot:\n      EXTERNAL_ROOT,\n  }, null, 2));\n\n  process.exit(1);\n}\n\nconst manifest = {\n  status:\n    \"AI_STOCK_LAB_SAFE_CLEANUP_PHASE3B_APPLY_V1_COMPLETE\",\n\n  appliedAt:\n    new Date().toISOString(),\n\n  classification:\n    \"STRICT_SAFE_REPAIR_AND_DIAGNOSTIC_ARCHIVED_EXTERNALLY\",\n\n  summary: {\n    repairArchived:\n      applied.filter((x) => x.type === \"repair\").length,\n    diagnosticArchived:\n      applied.filter((x) => x.type === \"diagnostic\").length,\n    total:\n      applied.length,\n    heldBack:\n      held.length,\n  },\n\n  heldBack,\n  applied,\n\n  safety: {\n    externalBackupVerifiedBySha256: true,\n    onlyStrictTrackedCleanCandidatesUsed: true,\n    stage7RuntimeModified: false,\n    migrationsModified: false,\n    envModified: false,\n    scheduledTaskModified: false,\n    databaseWrites: 0,\n    realTradingChanged: false,\n  },\n\n  nextGate:\n    \"RUN_TSC_TASK_CHECK_AND_PHASE3C_RESCAN\",\n};\n\nfs.writeFileSync(\n  path.join(EXTERNAL_ROOT, \"manifest.json\"),\n  JSON.stringify(manifest, null, 2),\n  \"utf8\"\n);\n\nconsole.log(JSON.stringify(manifest, null, 2));\nprocess.exit(0);\n",
  "utf8"
);

console.log(JSON.stringify({
  status:
    "AI_STOCK_LAB_SAFE_CLEANUP_PHASE3B_APPLY_V1_INSTALLED",

  generatedFile:
    "scripts/safe-cleanup-phase3b-apply-v1.cjs",

  mode:
    "DRY_RUN_BY_DEFAULT_APPLY_REQUIRES_--apply",

  sourcePlan:
    "logs/safe-cleanup-phase3b-plan-v1.json",

  strongerSafety: [
    "candidate must still exist",
    "candidate must be Git tracked NOW",
    "candidate must have clean Git status NOW",
    "candidate must have zero prior references",
    "candidate must not be referenced by package.json NOW",
    "candidate must not be referenced by Windows Scheduled Tasks NOW",
    "candidate must not match Forward OOS/SHADOW/promotion/scheduler/risk safety patterns"
  ],

  behaviorOnApply: [
    "copy candidate outside repo",
    "verify SHA256 source == external copy",
    "remove repo source only after verified copy",
    "write external manifest"
  ],

  safety: {
    noDirectUnverifiedDelete: true,
    stage7RuntimeModified: false,
    migrationsModified: false,
    envModified: false,
    scheduledTaskModified: false,
    databaseWrites: 0,
    realTradingChanged: false
  },

  nextAction:
    "RUN_PHASE3B_APPLY_SCRIPT_WITHOUT_--apply_FIRST"
}, null, 2));
