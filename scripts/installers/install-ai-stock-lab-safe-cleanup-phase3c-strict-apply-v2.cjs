const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const OUT = path.join(
  ROOT,
  "scripts",
  "safe-cleanup-phase3c-strict-apply-v2.cjs"
);

if (!fs.existsSync(path.join(ROOT, "package.json"))) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_SAFE_CLEANUP_PHASE3C_STRICT_APPLY_V2_INSTALL_FAILED",
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
  "const fs = require(\"fs\");\nconst path = require(\"path\");\nconst cp = require(\"child_process\");\nconst crypto = require(\"crypto\");\n\nconst ROOT = process.cwd();\nconst APPLY = process.argv.includes(\"--apply\");\n\nconst PLAN_FILE =\n  path.join(\n    ROOT,\n    \"logs\",\n    \"safe-cleanup-phase3c-strict-plan-v2.json\"\n  );\n\nconst EXTERNAL_ROOT =\n  path.resolve(\n    ROOT,\n    \"..\",\n    \"ai-stock-lab-cleanup-backup-20261012-phase3c\"\n  );\n\nconst CRITICAL_PATTERNS = [\n  /forward/i,\n  /oos/i,\n  /shadow/i,\n  /stage7/i,\n  /promot/i,\n  /walk-forward/i,\n  /replay/i,\n  /corporate-action/i,\n  /calendar/i,\n  /paper/i,\n  /risk/i,\n  /kill-switch/i,\n  /scheduler/i,\n  /maintenance/i,\n  /governance/i,\n  /accounting/i,\n  /execution/i,\n  /top1/i,\n  /data-freshness/i,\n  /backfill/i,\n  /live/i,\n  /controlled/i,\n  /maturity/i,\n  /collector/i,\n  /provenance/i,\n];\n\nfunction posix(p) {\n  return p.split(path.sep).join(\"/\");\n}\n\nfunction git(args) {\n  try {\n    return cp.execFileSync(\n      \"git\",\n      args,\n      {\n        cwd: ROOT,\n        encoding: \"utf8\",\n        stdio: [\"ignore\", \"pipe\", \"pipe\"],\n      }\n    ).trim();\n  } catch {\n    return \"\";\n  }\n}\n\nfunction trackedSet() {\n  const raw = git([\"ls-files\"]);\n  return new Set(\n    raw ? raw.split(/\\r?\\n/).map(posix).filter(Boolean) : []\n  );\n}\n\nfunction statusMap() {\n  const raw =\n    git([\"status\", \"--porcelain=v1\", \"--untracked-files=all\"]);\n\n  const map = new Map();\n\n  if (!raw) return map;\n\n  for (const line of raw.split(/\\r?\\n/)) {\n    if (line.length < 4) continue;\n\n    const code = line.slice(0, 2);\n    let file = line.slice(3).trim();\n\n    if (file.includes(\" -> \")) {\n      file = file.split(\" -> \").pop();\n    }\n\n    file = file.replace(/^\"|\"$/g, \"\");\n\n    map.set(posix(file), code);\n  }\n\n  return map;\n}\n\nfunction packageText() {\n  const file = path.join(ROOT, \"package.json\");\n\n  return fs.existsSync(file)\n    ? fs.readFileSync(file, \"utf8\")\n    : \"\";\n}\n\nfunction taskText() {\n  try {\n    return cp.execFileSync(\n      \"schtasks\",\n      [\"/Query\", \"/FO\", \"LIST\", \"/V\"],\n      {\n        encoding: \"utf8\",\n        stdio: [\"ignore\", \"pipe\", \"pipe\"],\n      }\n    );\n  } catch {\n    return \"\";\n  }\n}\n\nfunction sha256(file) {\n  const h = crypto.createHash(\"sha256\");\n  h.update(fs.readFileSync(file));\n  return h.digest(\"hex\");\n}\n\nfunction isCritical(file) {\n  return CRITICAL_PATTERNS.some((rx) => rx.test(file));\n}\n\nfunction copyVerified(src, dst) {\n  fs.mkdirSync(path.dirname(dst), { recursive: true });\n  fs.copyFileSync(src, dst);\n\n  const sourceHash = sha256(src);\n  const backupHash = sha256(dst);\n\n  if (sourceHash !== backupHash) {\n    throw new Error(`HASH_MISMATCH:${src}:${dst}`);\n  }\n\n  return { sourceHash, backupHash };\n}\n\nif (!fs.existsSync(path.join(ROOT, \"package.json\"))) {\n  console.error(JSON.stringify({\n    status:\n      \"AI_STOCK_LAB_SAFE_CLEANUP_PHASE3C_STRICT_APPLY_V2_FAILED\",\n    reason:\n      \"PACKAGE_JSON_NOT_FOUND\",\n  }, null, 2));\n  process.exit(1);\n}\n\nif (!fs.existsSync(PLAN_FILE)) {\n  console.error(JSON.stringify({\n    status:\n      \"AI_STOCK_LAB_SAFE_CLEANUP_PHASE3C_STRICT_APPLY_V2_FAILED\",\n    reason:\n      \"STRICT_PLAN_V2_NOT_FOUND\",\n  }, null, 2));\n  process.exit(1);\n}\n\nconst plan =\n  JSON.parse(fs.readFileSync(PLAN_FILE, \"utf8\"));\n\nconst research =\n  plan?.buckets?.ARCHIVE_STRICT_RESEARCH ?? [];\n\nconst legacy =\n  plan?.buckets?.ARCHIVE_STRICT_LEGACY ?? [];\n\nconst installers =\n  plan?.buckets?.RELOCATE_STRICT_INSTALLER ?? [];\n\nconst candidates = [\n  ...research.map((row) => ({\n    ...row,\n    type: \"research\",\n  })),\n  ...legacy.map((row) => ({\n    ...row,\n    type: \"legacy\",\n  })),\n];\n\nconst tracked = trackedSet();\nconst status = statusMap();\nconst pkg = packageText();\nconst tasks = taskText();\n\nconst failures = [];\nconst safe = [];\n\nfor (const row of candidates) {\n  const file = row.file;\n  const full = path.resolve(ROOT, file);\n  const base = path.basename(file);\n\n  const checks = {\n    sourceExists: fs.existsSync(full),\n    trackedNow: tracked.has(file),\n    gitStatusNow: status.get(file) || null,\n    packageReferenceNow:\n      pkg.includes(file) || pkg.includes(base),\n    taskReferenceNow:\n      tasks.includes(file) || tasks.includes(base),\n    priorReferenceCount:\n      row.priorReferenceCount ?? 0,\n    criticalName:\n      isCritical(file),\n  };\n\n  const reasons = [];\n\n  if (!checks.sourceExists) {\n    reasons.push(\"SOURCE_MISSING\");\n  }\n\n  if (!checks.trackedNow) {\n    reasons.push(\"NOT_GIT_TRACKED_NOW\");\n  }\n\n  if (checks.gitStatusNow) {\n    reasons.push(`GIT_STATUS_${checks.gitStatusNow}`);\n  }\n\n  if (checks.packageReferenceNow) {\n    reasons.push(\"PACKAGE_JSON_REFERENCE_NOW\");\n  }\n\n  if (checks.taskReferenceNow) {\n    reasons.push(\"WINDOWS_TASK_REFERENCE_NOW\");\n  }\n\n  if (checks.priorReferenceCount !== 0) {\n    reasons.push(\"PRIOR_REFERENCE_COUNT_NONZERO\");\n  }\n\n  if (checks.criticalName) {\n    reasons.push(\"STRICT_SAFETY_KEYWORD_GUARD\");\n  }\n\n  const record = {\n    file,\n    type: row.type,\n    checks,\n    sourceBucket: row.sourceBucket ?? null,\n    previousReason: row.reason ?? null,\n  };\n\n  if (reasons.length === 0) {\n    safe.push(record);\n  } else {\n    failures.push({\n      ...record,\n      reasons,\n    });\n  }\n}\n\nfor (const row of installers) {\n  failures.push({\n    file: row.file,\n    type: \"installer\",\n    reasons: [\n      \"STRICT_PLAN_V2_HAS_NO_INSTALLER_RELOCATION_EXPECTED\",\n    ],\n  });\n}\n\nconst collisions = [];\n\nfor (const row of safe) {\n  const relative =\n    row.file.replace(/^scripts\\//i, \"\");\n\n  const dst =\n    path.join(\n      EXTERNAL_ROOT,\n      row.type === \"research\"\n        ? \"research\"\n        : \"legacy\",\n      relative\n    );\n\n  if (fs.existsSync(dst)) {\n    collisions.push({\n      file: row.file,\n      destination: dst,\n      reason: \"EXTERNAL_ARCHIVE_COLLISION\",\n    });\n  }\n}\n\nconst summary = {\n  planResearch:\n    research.length,\n  planLegacy:\n    legacy.length,\n  planTotal:\n    research.length + legacy.length,\n  planInstallerRelocate:\n    installers.length,\n\n  strictSafeResearch:\n    safe.filter((x) => x.type === \"research\").length,\n  strictSafeLegacy:\n    safe.filter((x) => x.type === \"legacy\").length,\n  strictSafeTotal:\n    safe.length,\n\n  blocked:\n    failures.length,\n\n  collisions:\n    collisions.length,\n};\n\nif (\n  failures.length > 0 ||\n  collisions.length > 0\n) {\n  console.error(JSON.stringify({\n    status:\n      \"AI_STOCK_LAB_SAFE_CLEANUP_PHASE3C_STRICT_APPLY_V2_PREFLIGHT_REVIEW\",\n\n    classification:\n      \"NO_MUTATION_PREFLIGHT_BLOCKED\",\n\n    summary,\n\n    failures,\n    collisions,\n\n    safety: {\n      filesArchived: 0,\n      filesRemovedFromRepo: 0,\n      stage7RuntimeModified: false,\n      migrationsModified: false,\n      envModified: false,\n      scheduledTaskModified: false,\n      databaseWrites: 0,\n      realTradingChanged: false,\n    },\n\n    nextGate:\n      \"DO_NOT_APPLY_INSPECT_PREFLIGHT_REVIEW\",\n  }, null, 2));\n\n  process.exit(1);\n}\n\nif (!APPLY) {\n  console.log(JSON.stringify({\n    status:\n      \"AI_STOCK_LAB_SAFE_CLEANUP_PHASE3C_STRICT_APPLY_V2_DRY_RUN_PASS\",\n\n    classification:\n      \"STRICT_89_EXTERNAL_ARCHIVE_PREFLIGHT_SAFE\",\n\n    summary,\n\n    destination:\n      EXTERNAL_ROOT,\n\n    sampleSafe:\n      safe.slice(0, 50),\n\n    safety: {\n      dryRun: true,\n      filesArchived: 0,\n      filesRemovedFromRepo: 0,\n      stage7RuntimeModified: false,\n      migrationsModified: false,\n      envModified: false,\n      scheduledTaskModified: false,\n      databaseWrites: 0,\n      realTradingChanged: false,\n    },\n\n    nextGate:\n      \"RUN_WITH_--apply_ONLY_AFTER_DRY_RUN_REVIEW\",\n  }, null, 2));\n\n  process.exit(0);\n}\n\nfs.mkdirSync(EXTERNAL_ROOT, { recursive: true });\n\nconst applied = [];\n\ntry {\n  for (const row of safe) {\n    const src = path.resolve(ROOT, row.file);\n\n    const relative =\n      row.file.replace(/^scripts\\//i, \"\");\n\n    const dst =\n      path.join(\n        EXTERNAL_ROOT,\n        row.type === \"research\"\n          ? \"research\"\n          : \"legacy\",\n        relative\n      );\n\n    const proof =\n      copyVerified(src, dst);\n\n    fs.unlinkSync(src);\n\n    applied.push({\n      action:\n        \"ARCHIVE_EXTERNAL_AND_REMOVE_REPO_SOURCE\",\n      type:\n        row.type,\n      source:\n        row.file,\n      destination:\n        dst,\n      sha256:\n        proof.backupHash,\n      sourceRemoved:\n        !fs.existsSync(src),\n      destinationExists:\n        fs.existsSync(dst),\n    });\n  }\n} catch (error) {\n  console.error(JSON.stringify({\n    status:\n      \"AI_STOCK_LAB_SAFE_CLEANUP_PHASE3C_STRICT_APPLY_V2_PARTIAL_FAILURE\",\n\n    reason:\n      error instanceof Error\n        ? error.message\n        : String(error),\n\n    appliedCount:\n      applied.length,\n\n    applied,\n\n    recoveryRoot:\n      EXTERNAL_ROOT,\n  }, null, 2));\n\n  process.exit(1);\n}\n\nconst manifest = {\n  status:\n    \"AI_STOCK_LAB_SAFE_CLEANUP_PHASE3C_STRICT_APPLY_V2_COMPLETE\",\n\n  appliedAt:\n    new Date().toISOString(),\n\n  classification:\n    \"STRICT_RESEARCH_AND_LEGACY_ARCHIVED_EXTERNALLY\",\n\n  summary: {\n    researchArchived:\n      applied.filter((x) => x.type === \"research\").length,\n\n    legacyArchived:\n      applied.filter((x) => x.type === \"legacy\").length,\n\n    total:\n      applied.length,\n\n    installerRelocated:\n      0,\n  },\n\n  applied,\n\n  safety: {\n    externalBackupVerifiedBySha256:\n      true,\n\n    strictSafetyGuardRechecked:\n      true,\n\n    stage7RuntimeModified:\n      false,\n\n    migrationsModified:\n      false,\n\n    envModified:\n      false,\n\n    scheduledTaskModified:\n      false,\n\n    databaseWrites:\n      0,\n\n    realTradingChanged:\n      false,\n  },\n\n  nextGate:\n    \"RUN_TSC_STAGE7_TASK_CHECK_AND_FINAL_CLEANUP_AUDIT\",\n};\n\nfs.writeFileSync(\n  path.join(EXTERNAL_ROOT, \"manifest.json\"),\n  JSON.stringify(manifest, null, 2),\n  \"utf8\"\n);\n\nconsole.log(JSON.stringify(manifest, null, 2));\nprocess.exit(0);\n",
  "utf8"
);

console.log(JSON.stringify({
  status:
    "AI_STOCK_LAB_SAFE_CLEANUP_PHASE3C_STRICT_APPLY_V2_INSTALLED",

  generatedFile:
    "scripts/safe-cleanup-phase3c-strict-apply-v2.cjs",

  mode:
    "DRY_RUN_BY_DEFAULT_APPLY_REQUIRES_--apply",

  expectedFromStrictPlanV2: {
    research: 13,
    legacy: 76,
    total: 89,
    installerRelocate: 0
  },

  behavior: [
    "rechecks current Git tracked/clean state",
    "rechecks package.json and Windows Task references",
    "rechecks strict safety keyword guard",
    "apply mode copies outside repo and verifies SHA256 before source removal"
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
    "RUN_STRICT_PHASE3C_DRY_RUN_FIRST"
}, null, 2));
