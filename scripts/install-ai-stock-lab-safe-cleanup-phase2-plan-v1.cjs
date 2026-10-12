const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const OUT = path.join(
  ROOT,
  "scripts",
  "safe-cleanup-phase2-plan-v1.cjs"
);

if (!fs.existsSync(path.join(ROOT, "package.json"))) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_SAFE_CLEANUP_PHASE2_PLAN_V1_INSTALL_FAILED",
    reason:
      "PACKAGE_JSON_NOT_FOUND",
  }, null, 2));

  process.exit(1);
}

fs.mkdirSync(
  path.dirname(OUT),
  { recursive: true }
);

fs.writeFileSync(
  OUT,
  "const fs = require(\"fs\");\nconst path = require(\"path\");\nconst cp = require(\"child_process\");\n\nconst ROOT = process.cwd();\nconst REPORT = path.join(ROOT, \"logs\", \"safe-cleanup-audit-v2.json\");\n\nfunction posix(p) {\n  return p.split(path.sep).join(\"/\");\n}\n\nfunction git(args) {\n  try {\n    return cp.execFileSync(\n      \"git\",\n      args,\n      {\n        cwd: ROOT,\n        encoding: \"utf8\",\n        stdio: [\"ignore\", \"pipe\", \"pipe\"],\n      }\n    ).trim();\n  } catch {\n    return \"\";\n  }\n}\n\nfunction trackedSet() {\n  const raw = git([\"ls-files\"]);\n  return new Set(\n    raw ? raw.split(/\\r?\\n/).map(posix).filter(Boolean) : []\n  );\n}\n\nfunction statusMap() {\n  const raw = git([\"status\", \"--porcelain=v1\"]);\n  const map = new Map();\n\n  if (!raw) return map;\n\n  for (const line of raw.split(/\\r?\\n/)) {\n    if (line.length < 4) continue;\n\n    const code = line.slice(0, 2);\n    let file = line.slice(3).trim();\n\n    if (file.includes(\" -> \")) {\n      file = file.split(\" -> \").pop();\n    }\n\n    file = file.replace(/^\"|\"$/g, \"\");\n    map.set(posix(file), code);\n  }\n\n  return map;\n}\n\nfunction loadReport() {\n  if (!fs.existsSync(REPORT)) {\n    throw new Error(\"SAFE_CLEANUP_AUDIT_V2_REPORT_NOT_FOUND\");\n  }\n\n  return JSON.parse(fs.readFileSync(REPORT, \"utf8\"));\n}\n\nfunction exists(rel) {\n  return fs.existsSync(path.join(ROOT, rel));\n}\n\nfunction classify(row, tracked, status) {\n  const file = row.file;\n  const isTracked = tracked.has(file);\n  const gitStatus = status.get(file) || null;\n\n  if (/^scripts\\/backups\\//i.test(file)) {\n    return {\n      group: \"BACKUP_TREE\",\n      action: \"ARCHIVE_EXTERNAL\",\n      confidence: \"HIGH\",\n      destination:\n        \"archive/cleanup-phase2/backups/\" +\n        file.replace(/^scripts\\/backups\\//i, \"\"),\n      reason:\n        \"unreferenced backup-tree file; preserve outside working scripts tree\",\n      isTracked,\n      gitStatus,\n    };\n  }\n\n  if (\n    /^scripts\\/install-.+\\.cjs$/i.test(file) &&\n    row.generatedTarget &&\n    exists(row.generatedTarget)\n  ) {\n    return {\n      group: \"OLD_INSTALLER_WITH_GENERATED_TARGET\",\n      action: \"MOVE_TO_INSTALLERS_ARCHIVE\",\n      confidence: \"HIGH\",\n      destination:\n        \"scripts/installers/archive/\" +\n        path.basename(file),\n      reason:\n        \"unreferenced installer; generated runtime target already exists\",\n      isTracked,\n      gitStatus,\n    };\n  }\n\n  return {\n    group: \"UNRESOLVED_ARCHIVE_CANDIDATE\",\n    action: \"REVIEW\",\n    confidence: \"LOW\",\n    destination: null,\n    reason:\n      \"candidate did not match Phase2 safe archive rules\",\n    isTracked,\n    gitStatus,\n  };\n}\n\nlet report;\n\ntry {\n  report = loadReport();\n} catch (error) {\n  console.error(JSON.stringify({\n    status: \"AI_STOCK_LAB_SAFE_CLEANUP_PHASE2_PLAN_V1_FAILED\",\n    reason:\n      error instanceof Error\n        ? error.message\n        : String(error),\n  }, null, 2));\n  process.exit(1);\n}\n\nconst archiveRows =\n  report?.buckets?.ARCHIVE_CANDIDATE;\n\nif (!Array.isArray(archiveRows)) {\n  console.error(JSON.stringify({\n    status: \"AI_STOCK_LAB_SAFE_CLEANUP_PHASE2_PLAN_V1_FAILED\",\n    reason: \"ARCHIVE_CANDIDATE_BUCKET_MISSING\",\n  }, null, 2));\n  process.exit(1);\n}\n\nconst tracked = trackedSet();\nconst status = statusMap();\n\nconst planned = archiveRows.map((row) => ({\n  ...row,\n  phase2: classify(row, tracked, status),\n}));\n\nconst groups = {\n  MOVE_TO_INSTALLERS_ARCHIVE: [],\n  ARCHIVE_EXTERNAL: [],\n  REVIEW: [],\n};\n\nfor (const row of planned) {\n  groups[row.phase2.action].push(row);\n}\n\nconst blockers = planned.filter((row) => {\n  if (row.phase2.action === \"REVIEW\") return true;\n\n  // If the candidate itself currently has an unstaged/staged modification,\n  // don't mutate it in Phase2.\n  if (row.phase2.gitStatus) return true;\n\n  return false;\n});\n\nconst collisions = planned.filter((row) => {\n  if (!row.phase2.destination) return false;\n\n  const dst = path.join(ROOT, row.phase2.destination);\n  return fs.existsSync(dst);\n});\n\nconst summary = {\n  sourceArchiveCandidates: archiveRows.length,\n  moveToInstallersArchive:\n    groups.MOVE_TO_INSTALLERS_ARCHIVE.length,\n  archiveExternal:\n    groups.ARCHIVE_EXTERNAL.length,\n  review:\n    groups.REVIEW.length,\n  blockers:\n    blockers.length,\n  collisions:\n    collisions.length,\n};\n\nconst output = {\n  status:\n    blockers.length === 0 && collisions.length === 0\n      ? \"AI_STOCK_LAB_SAFE_CLEANUP_PHASE2_PLAN_V1_PASS\"\n      : \"AI_STOCK_LAB_SAFE_CLEANUP_PHASE2_PLAN_V1_REVIEW\",\n\n  classification:\n    \"PHASE2_ARCHIVE_PLAN_ONLY_NO_FILES_MOVED\",\n\n  summary,\n\n  groups: {\n    moveToInstallersArchive:\n      groups.MOVE_TO_INSTALLERS_ARCHIVE.map((row) => ({\n        file: row.file,\n        destination: row.phase2.destination,\n        tracked: row.phase2.isTracked,\n        gitStatus: row.phase2.gitStatus,\n        generatedTarget: row.generatedTarget,\n      })),\n\n    archiveExternal:\n      groups.ARCHIVE_EXTERNAL.map((row) => ({\n        file: row.file,\n        destination: row.phase2.destination,\n        tracked: row.phase2.isTracked,\n        gitStatus: row.phase2.gitStatus,\n      })),\n\n    review:\n      groups.REVIEW.map((row) => ({\n        file: row.file,\n        reason: row.phase2.reason,\n        tracked: row.phase2.isTracked,\n        gitStatus: row.phase2.gitStatus,\n      })),\n  },\n\n  blockers: blockers.map((row) => ({\n    file: row.file,\n    action: row.phase2.action,\n    gitStatus: row.phase2.gitStatus,\n    reason:\n      row.phase2.action === \"REVIEW\"\n        ? row.phase2.reason\n        : \"candidate currently has git modifications; excluded from automatic mutation\",\n  })),\n\n  collisions: collisions.map((row) => ({\n    file: row.file,\n    destination: row.phase2.destination,\n  })),\n\n  safety: {\n    planOnly: true,\n    filesMoved: 0,\n    filesDeleted: 0,\n    filesRenamed: 0,\n    stage7Modified: false,\n    migrationsModified: false,\n    envModified: false,\n    scheduledTaskModified: false,\n    databaseWrites: 0,\n    realTradingChanged: false,\n  },\n\n  nextGate:\n    blockers.length === 0 && collisions.length === 0\n      ? \"GENERATE_PHASE2_APPLY_SCRIPT\"\n      : \"RESOLVE_PHASE2_BLOCKERS_BEFORE_ANY_MOVE\",\n};\n\nconst outFile = path.join(\n  ROOT,\n  \"logs\",\n  \"safe-cleanup-phase2-plan-v1.json\"\n);\n\nfs.writeFileSync(\n  outFile,\n  JSON.stringify(output, null, 2),\n  \"utf8\"\n);\n\nconsole.log(JSON.stringify({\n  status: output.status,\n  classification: output.classification,\n  summary: output.summary,\n\n  sample: {\n    moveToInstallersArchive:\n      output.groups.moveToInstallersArchive.slice(0, 25),\n\n    archiveExternal:\n      output.groups.archiveExternal.slice(0, 25),\n\n    review:\n      output.groups.review.slice(0, 25),\n\n    blockers:\n      output.blockers.slice(0, 25),\n\n    collisions:\n      output.collisions.slice(0, 25),\n  },\n\n  report:\n    \"logs/safe-cleanup-phase2-plan-v1.json\",\n\n  safety: output.safety,\n  nextGate: output.nextGate,\n}, null, 2));\n\nprocess.exitCode =\n  output.status.endsWith(\"_PASS\")\n    ? 0\n    : 1;\n",
  "utf8"
);

console.log(JSON.stringify({
  status:
    "AI_STOCK_LAB_SAFE_CLEANUP_PHASE2_PLAN_V1_INSTALLED",

  generatedFile:
    "scripts/safe-cleanup-phase2-plan-v1.cjs",

  purpose:
    "PLAN_ONLY_OLD_INSTALLER_AND_BACKUP_ARCHIVAL",

  intendedDestinations: {
    oldInstallers:
      "scripts/installers/archive/",
    backupTree:
      "../ai-stock-lab-cleanup-backup-20261012-phase2/"
  },

  safety: {
    planOnly: true,
    filesMoved: 0,
    filesDeleted: 0,
    sourceModified: 0,
    stage7Modified: false,
    migrationsModified: false,
    scheduledTaskModified: false,
    realTradingChanged: false
  },

  nextAction:
    "RUN_PHASE2_PLAN_ONLY"
}, null, 2));
