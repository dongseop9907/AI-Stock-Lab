const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const OUT =
  path.join(
    ROOT,
    "scripts",
    "root-cleanup-phaseA-plan-v1.cjs"
  );

if (!fs.existsSync(path.join(ROOT, "package.json"))) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_ROOT_CLEANUP_PHASEA_PLAN_V1_INSTALL_FAILED",
    reason:
      "PACKAGE_JSON_NOT_FOUND"
  }, null, 2));
  process.exit(1);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });

fs.writeFileSync(
  OUT,
  "const fs = require(\"fs\");\nconst path = require(\"path\");\nconst cp = require(\"child_process\");\n\nconst ROOT = process.cwd();\nconst SOURCE_PLAN =\n  path.join(ROOT, \"logs\", \"root-cleanup-plan-v1.json\");\n\nconst DISPOSABLE_PATTERNS = [\n  /\\.tsbuildinfo$/i,\n  /\\.bak$/i,\n  /\\.backup$/i,\n  /\\.backup-/i,\n  /\\.before-/i,\n  /^tsc-errors.*\\.txt$/i,\n  /^typescript-errors\\.txt$/i,\n  /(?:^|[-_])body\\.json$/i,\n  /(?:^|[-_])response\\.json$/i,\n];\n\nconst ARCHIVE_PATTERNS = [\n  /\\.zip$/i,\n  /^README[_-].+/i,\n  /\\.patch\\.ts\\.txt$/i,\n  /^alpha-research-gate-readiness\\.txt$/i,\n  /^backtest-alpha-(?:core-contracts|inventory)\\.txt$/i,\n  /^corporate-action-coverage-(?:contracts|finalization-discovery|inventory)\\.txt$/i,\n  /^generate-entry-signals\\.txt$/i,\n  /^cleanup-audit-ai-stock-lab\\.cjs$/i,\n];\n\nconst CORE_PROTECT_PATTERNS = [\n  /^\\.env(?:\\.|$)/i,\n  /^package(?:-lock)?\\.json$/i,\n  /^tsconfig.*\\.json$/i,\n  /^next(?:-env|\\.config)/i,\n  /^eslint\\.config\\./i,\n  /^\\.gitignore$/i,\n  /^README\\.md$/i,\n];\n\nfunction posix(p) {\n  return p.split(path.sep).join(\"/\");\n}\n\nfunction git(args) {\n  try {\n    return cp.execFileSync(\n      \"git\",\n      args,\n      {\n        cwd: ROOT,\n        encoding: \"utf8\",\n        stdio: [\"ignore\", \"pipe\", \"pipe\"],\n      }\n    ).trim();\n  } catch {\n    return \"\";\n  }\n}\n\nfunction trackedSet() {\n  const raw = git([\"ls-files\"]);\n  return new Set(\n    raw ? raw.split(/\\r?\\n/).map(posix).filter(Boolean) : []\n  );\n}\n\nfunction statusMap() {\n  const raw =\n    git([\"status\", \"--porcelain=v1\", \"--untracked-files=all\"]);\n  const map = new Map();\n\n  if (!raw) return map;\n\n  for (const line of raw.split(/\\r?\\n/)) {\n    if (line.length < 4) continue;\n\n    const code = line.slice(0, 2);\n    let file = line.slice(3).trim();\n\n    if (file.includes(\" -> \")) {\n      file = file.split(\" -> \").pop();\n    }\n\n    file = file.replace(/^\"|\"$/g, \"\");\n    map.set(posix(file), code);\n  }\n\n  return map;\n}\n\nfunction projectCorpus() {\n  const roots = [\"app\", \"src\", \"lib\", \"scripts\"];\n  const exclude = new Set([\n    \".git\", \".next\", \"node_modules\", \".turbo\",\n    \"coverage\", \"dist\", \"build\",\n  ]);\n\n  const rows = [];\n\n  function walk(dir) {\n    let entries = [];\n    try {\n      entries = fs.readdirSync(dir, { withFileTypes: true });\n    } catch {\n      return;\n    }\n\n    for (const entry of entries) {\n      if (exclude.has(entry.name)) continue;\n\n      const full = path.join(dir, entry.name);\n\n      if (entry.isDirectory()) {\n        walk(full);\n        continue;\n      }\n\n      if (!entry.isFile()) continue;\n\n      let stat;\n      try {\n        stat = fs.statSync(full);\n      } catch {\n        continue;\n      }\n\n      if (stat.size > 2_000_000) continue;\n\n      const ext = path.extname(entry.name).toLowerCase();\n      if (![\n        \".ts\", \".tsx\", \".js\", \".jsx\", \".cjs\", \".mjs\",\n        \".ps1\", \".json\", \".sql\", \".md\", \".txt\",\n        \".yml\", \".yaml\", \".toml\"\n      ].includes(ext)) continue;\n\n      try {\n        rows.push({\n          file: posix(path.relative(ROOT, full)),\n          text: fs.readFileSync(full, \"utf8\"),\n        });\n      } catch {}\n    }\n  }\n\n  for (const root of roots) {\n    const full = path.join(ROOT, root);\n    if (fs.existsSync(full)) walk(full);\n  }\n\n  return rows;\n}\n\nfunction refsFor(file, corpus) {\n  const refs = [];\n\n  for (const row of corpus) {\n    if (\n      row.text.includes(file) ||\n      row.text.includes(\"./\" + file)\n    ) {\n      refs.push(row.file);\n      if (refs.length >= 50) break;\n    }\n  }\n\n  return refs;\n}\n\nfunction taskText() {\n  try {\n    return cp.execFileSync(\n      \"schtasks\",\n      [\"/Query\", \"/FO\", \"LIST\", \"/V\"],\n      {\n        encoding: \"utf8\",\n        stdio: [\"ignore\", \"pipe\", \"pipe\"],\n      }\n    );\n  } catch {\n    return \"\";\n  }\n}\n\nif (!fs.existsSync(path.join(ROOT, \"package.json\"))) {\n  console.error(JSON.stringify({\n    status:\n      \"AI_STOCK_LAB_ROOT_CLEANUP_PHASEA_PLAN_V1_FAILED\",\n    reason:\n      \"PACKAGE_JSON_NOT_FOUND\",\n  }, null, 2));\n  process.exit(1);\n}\n\nif (!fs.existsSync(SOURCE_PLAN)) {\n  console.error(JSON.stringify({\n    status:\n      \"AI_STOCK_LAB_ROOT_CLEANUP_PHASEA_PLAN_V1_FAILED\",\n    reason:\n      \"ROOT_CLEANUP_PLAN_V1_NOT_FOUND\",\n  }, null, 2));\n  process.exit(1);\n}\n\nconst sourcePlan =\n  JSON.parse(fs.readFileSync(SOURCE_PLAN, \"utf8\"));\n\nconst allRows = [];\n\nfor (const [bucket, rows] of Object.entries(sourcePlan.buckets ?? {})) {\n  for (const row of rows ?? []) {\n    allRows.push({\n      ...row,\n      sourceBucket: bucket,\n    });\n  }\n}\n\nconst tracked = trackedSet();\nconst status = statusMap();\nconst corpus = projectCorpus();\nconst tasks = taskText();\n\nconst buckets = {\n  REMOVE_AFTER_EXTERNAL_BACKUP: [],\n  ARCHIVE_ROOT_ARTIFACT: [],\n  KEEP_CORE_OR_REFERENCED: [],\n  HOLD_DIRTY: [],\n  HOLD_REFERENCED_NOW: [],\n  HOLD_MANUAL_SOURCE: [],\n};\n\nfor (const row of allRows) {\n  const file = row.file;\n  const full = path.join(ROOT, file);\n\n  if (!fs.existsSync(full)) continue;\n\n  const nowTracked = tracked.has(file);\n  const nowStatus = status.get(file) || null;\n  const refs = refsFor(file, corpus);\n  const taskReference = tasks.includes(file);\n\n  const facts = {\n    file,\n    sourceBucket: row.sourceBucket,\n    sizeBytes: fs.statSync(full).size,\n    trackedNow: nowTracked,\n    gitStatusNow: nowStatus,\n    currentReferenceCount: refs.length,\n    currentReferences: refs,\n    taskReferenceNow: taskReference,\n  };\n\n  if (\n    row.sourceBucket === \"KEEP_CORE\" ||\n    row.sourceBucket === \"KEEP_SENSITIVE\" ||\n    row.sourceBucket === \"KEEP_REFERENCED\" ||\n    CORE_PROTECT_PATTERNS.some((rx) => rx.test(file))\n  ) {\n    buckets.KEEP_CORE_OR_REFERENCED.push({\n      ...facts,\n      reason: \"CORE_OR_PREVIOUSLY_REFERENCED\",\n    });\n    continue;\n  }\n\n  if (\n    nowStatus &&\n    nowStatus !== \"??\"\n  ) {\n    buckets.HOLD_DIRTY.push({\n      ...facts,\n      reason: \"CURRENT_GIT_CHANGE_PRESENT\",\n    });\n    continue;\n  }\n\n  if (\n    refs.length > 0 ||\n    taskReference\n  ) {\n    buckets.HOLD_REFERENCED_NOW.push({\n      ...facts,\n      reason:\n        taskReference\n          ? \"WINDOWS_TASK_REFERENCE_NOW\"\n          : \"CURRENT_PROJECT_REFERENCE_NOW\",\n    });\n    continue;\n  }\n\n  if (\n    row.sourceBucket === \"DELETE_CANDIDATE_STRONG\" ||\n    DISPOSABLE_PATTERNS.some((rx) => rx.test(file))\n  ) {\n    buckets.REMOVE_AFTER_EXTERNAL_BACKUP.push({\n      ...facts,\n      reason:\n        row.sourceBucket === \"DELETE_CANDIDATE_STRONG\"\n          ? \"PREVIOUS_STRONG_DELETE_CANDIDATE\"\n          : \"GENERATED_OR_BACKUP_ROOT_ARTIFACT\",\n    });\n    continue;\n  }\n\n  if (ARCHIVE_PATTERNS.some((rx) => rx.test(file))) {\n    buckets.ARCHIVE_ROOT_ARTIFACT.push({\n      ...facts,\n      reason:\n        \"HISTORICAL_DOCUMENT_PACKAGE_OR_ANALYSIS_ARTIFACT\",\n    });\n    continue;\n  }\n\n  buckets.HOLD_MANUAL_SOURCE.push({\n    ...facts,\n    reason:\n      \"SOURCE_OR_OPERATIONAL_ROLE_REQUIRES_SEPARATE_REVIEW\",\n  });\n}\n\nfor (const key of Object.keys(buckets)) {\n  buckets[key].sort((a, b) =>\n    a.file.localeCompare(b.file)\n  );\n}\n\nconst summary = {\n  removeAfterExternalBackup:\n    buckets.REMOVE_AFTER_EXTERNAL_BACKUP.length,\n  archiveRootArtifact:\n    buckets.ARCHIVE_ROOT_ARTIFACT.length,\n  phaseACandidateTotal:\n    buckets.REMOVE_AFTER_EXTERNAL_BACKUP.length +\n    buckets.ARCHIVE_ROOT_ARTIFACT.length,\n  keepCoreOrReferenced:\n    buckets.KEEP_CORE_OR_REFERENCED.length,\n  holdDirty:\n    buckets.HOLD_DIRTY.length,\n  holdReferencedNow:\n    buckets.HOLD_REFERENCED_NOW.length,\n  holdManualSource:\n    buckets.HOLD_MANUAL_SOURCE.length,\n  totalAccounted:\n    Object.values(buckets)\n      .reduce((sum, rows) => sum + rows.length, 0),\n};\n\nconst report = {\n  status:\n    \"AI_STOCK_LAB_ROOT_CLEANUP_PHASEA_PLAN_V1_COMPLETE\",\n\n  classification:\n    \"ROOT_OBVIOUS_ARTIFACTS_ONLY_NO_MUTATION\",\n\n  summary,\n  buckets,\n\n  policy: {\n    phaseA:\n      \"Only obvious backup/generated artifacts and historical documentation/packages are candidates.\",\n    removal:\n      \"All Phase A candidates must be copied to an external backup and SHA256-verified before removal from repo root.\",\n    held:\n      \"Versioned TS/PS1/SQL source and operational-looking files are held for a later source-specific review.\",\n  },\n\n  safety: {\n    planOnly: true,\n    filesMoved: 0,\n    filesDeleted: 0,\n    sourceModified: 0,\n    envModified: false,\n    stage7Modified: false,\n    scheduledTaskModified: false,\n    databaseWrites: 0,\n    realTradingChanged: false,\n  },\n\n  nextGate:\n    \"REVIEW_PHASEA_CANDIDATES_THEN_GENERATE_DRY_RUN_APPLY\",\n};\n\nfs.mkdirSync(path.join(ROOT, \"logs\"), { recursive: true });\n\nfs.writeFileSync(\n  path.join(\n    ROOT,\n    \"logs\",\n    \"root-cleanup-phaseA-plan-v1.json\"\n  ),\n  JSON.stringify(report, null, 2),\n  \"utf8\"\n);\n\nconsole.log(JSON.stringify(report, null, 2));\nprocess.exit(0);\n",
  "utf8"
);

console.log(JSON.stringify({
  status:
    "AI_STOCK_LAB_ROOT_CLEANUP_PHASEA_PLAN_V1_INSTALLED",

  generatedFile:
    "scripts/root-cleanup-phaseA-plan-v1.cjs",

  purpose:
    "STRICT_ROOT_PHASEA_CLASSIFICATION_OF_OBVIOUS_ARTIFACTS",

  safety: {
    planOnly: true,
    filesMoved: 0,
    filesDeleted: 0,
    stage7Modified: false,
    envModified: false,
    scheduledTaskModified: false,
    databaseWrites: 0,
    realTradingChanged: false
  },

  nextAction:
    "RUN_ROOT_PHASEA_PLAN_ONLY"
}, null, 2));
