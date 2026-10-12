const fs = require("fs");
const path = require("path");

const target = path.resolve(
  process.cwd(),
  "scripts/alpha-v3-committed-risk-isolated-dry-run.cjs"
);

fs.mkdirSync(
  path.dirname(target),
  { recursive: true }
);

fs.writeFileSync(
  target,
  "const fs = require(\"fs\");\nconst path = require(\"path\");\nconst { spawnSync } = require(\"child_process\");\n\nconst root = process.cwd();\n\nconst migrationsDir =\n  path.resolve(\n    root,\n    \"supabase/migrations\"\n  );\n\nconst oldName =\n  \"052_committed_risk_reservation_v3.sql\";\n\nconst targetName =\n  \"20261008000100_committed_risk_reservation_v3.sql\";\n\nconst oldPath =\n  path.join(\n    migrationsDir,\n    oldName\n  );\n\nconst targetPath =\n  path.join(\n    migrationsDir,\n    targetName\n  );\n\nconst stagingRoot =\n  path.resolve(\n    root,\n    \"supabase/.committed-risk-migration-isolation\"\n  );\n\nconst logFile =\n  path.resolve(\n    root,\n    \"logs/alpha-v3-committed-risk-isolated-dry-run.json\"\n  );\n\nfunction ensureTargetMigration() {\n  if (\n    fs.existsSync(oldPath) &&\n    !fs.existsSync(targetPath)\n  ) {\n    fs.renameSync(\n      oldPath,\n      targetPath\n    );\n  }\n\n  if (\n    fs.existsSync(oldPath) &&\n    fs.existsSync(targetPath)\n  ) {\n    const oldText =\n      fs.readFileSync(\n        oldPath,\n        \"utf8\"\n      );\n\n    const targetText =\n      fs.readFileSync(\n        targetPath,\n        \"utf8\"\n      );\n\n    if (oldText !== targetText) {\n      throw new Error(\n        \"DUPLICATE_COMMITTED_RISK_MIGRATION_CONTENT_MISMATCH\"\n      );\n    }\n\n    fs.unlinkSync(oldPath);\n  }\n\n  if (!fs.existsSync(targetPath)) {\n    throw new Error(\n      `TARGET_MIGRATION_NOT_FOUND:${targetName}`\n    );\n  }\n}\n\nfunction patchVerifierReferences() {\n  const files = [\n    \"scripts/alpha-v3-committed-risk-foundation-verify.ts\",\n    \"scripts/alpha-v3-committed-risk-atomic-integration-verify.ts\",\n    \"scripts/alpha-v3-committed-risk-db-apply-readiness.cjs\",\n  ];\n\n  for (const rel of files) {\n    const file =\n      path.resolve(\n        root,\n        rel\n      );\n\n    if (!fs.existsSync(file)) {\n      continue;\n    }\n\n    const before =\n      fs.readFileSync(\n        file,\n        \"utf8\"\n      );\n\n    const after =\n      before.replaceAll(\n        oldName,\n        targetName\n      );\n\n    if (after !== before) {\n      fs.writeFileSync(\n        file,\n        after,\n        \"utf8\"\n      );\n    }\n  }\n}\n\nfunction runSupabase(args) {\n  const cli =\n    path.resolve(\n      root,\n      \"node_modules/.bin/supabase.cmd\"\n    );\n\n  if (!fs.existsSync(cli)) {\n    throw new Error(\n      \"LOCAL_SUPABASE_CLI_NOT_FOUND\"\n    );\n  }\n\n  return spawnSync(\n    cli,\n    args,\n    {\n      cwd: root,\n      encoding: \"utf8\",\n      windowsHide: true,\n      env: process.env,\n      timeout: 120000,\n    }\n  );\n}\n\nfunction restoreFiles(moved) {\n  for (\n    const item\n    of [...moved].reverse()\n  ) {\n    if (\n      fs.existsSync(item.to)\n    ) {\n      fs.renameSync(\n        item.to,\n        item.from\n      );\n    }\n  }\n}\n\nensureTargetMigration();\npatchVerifierReferences();\n\nfs.rmSync(\n  stagingRoot,\n  {\n    recursive: true,\n    force: true,\n  }\n);\n\nfs.mkdirSync(\n  stagingRoot,\n  {\n    recursive: true,\n  }\n);\n\nconst migrationFiles =\n  fs.readdirSync(\n    migrationsDir\n  )\n    .filter(\n      (name) =>\n        name.endsWith(\".sql\")\n    )\n    .sort();\n\nconst moved = [];\n\ntry {\n  for (const name of migrationFiles) {\n    if (\n      name === targetName\n    ) {\n      continue;\n    }\n\n    const from =\n      path.join(\n        migrationsDir,\n        name\n      );\n\n    const to =\n      path.join(\n        stagingRoot,\n        name\n      );\n\n    fs.renameSync(\n      from,\n      to\n    );\n\n    moved.push({\n      from,\n      to,\n      name,\n    });\n  }\n\n  const isolatedFiles =\n    fs.readdirSync(\n      migrationsDir\n    )\n      .filter(\n        (name) =>\n          name.endsWith(\".sql\")\n      )\n      .sort();\n\n  if (\n    isolatedFiles.length !== 1 ||\n    isolatedFiles[0] !== targetName\n  ) {\n    throw new Error(\n      `ISOLATION_FAILED:${JSON.stringify(isolatedFiles)}`\n    );\n  }\n\n  const result =\n    runSupabase([\n      \"db\",\n      \"push\",\n      \"--dry-run\",\n    ]);\n\n  const combined =\n    [\n      result.stdout ?? \"\",\n      result.stderr ?? \"\",\n    ].join(\"\\n\");\n\n  const migrationLines =\n    combined\n      .split(/\\r?\\n/)\n      .map(\n        (line) =>\n          line.trim()\n      )\n      .filter(\n        (line) =>\n          /\\.sql$/i.test(line) ||\n          line.includes(targetName)\n      );\n\n  const targetMentioned =\n    combined.includes(\n      targetName\n    );\n\n  const otherSqlMentioned =\n    migrationLines.some(\n      (line) =>\n        !line.includes(\n          targetName\n        )\n    );\n\n  const dryRunSucceeded =\n    result.status === 0;\n\n  const safeForSingleMigrationPush =\n    dryRunSucceeded &&\n    targetMentioned &&\n    !otherSqlMentioned;\n\n  const report = {\n    status:\n      safeForSingleMigrationPush\n        ? \"ALPHA_V3_COMMITTED_RISK_ISOLATED_DRY_RUN_VERIFIED\"\n        : \"ALPHA_V3_COMMITTED_RISK_ISOLATED_DRY_RUN_NOT_SAFE\",\n\n    migrationRename: {\n      oldName,\n      targetName,\n      oldStillExists:\n        fs.existsSync(oldPath),\n      targetExists:\n        fs.existsSync(targetPath),\n    },\n\n    isolation: {\n      originalMigrationCount:\n        migrationFiles.length,\n      temporarilyMovedCount:\n        moved.length,\n      isolatedFiles,\n    },\n\n    dryRun: {\n      exitCode:\n        result.status,\n      targetMentioned,\n      otherSqlMentioned,\n      migrationLines,\n      stdoutTail:\n        String(result.stdout ?? \"\")\n          .split(/\\r?\\n/)\n          .slice(-30)\n          .join(\"\\n\"),\n      stderrTail:\n        String(result.stderr ?? \"\")\n          .split(/\\r?\\n/)\n          .slice(-15)\n          .join(\"\\n\"),\n    },\n\n    decision: {\n      safeForSingleMigrationPush,\n\n      databaseApplied:\n        false,\n\n      nextGate:\n        safeForSingleMigrationPush\n          ? \"RUN_ISOLATED_SINGLE_MIGRATION_PUSH\"\n          : \"DO_NOT_PUSH_REVIEW_DRY_RUN\",\n    },\n\n    safety: {\n      databaseWrites: 0,\n      migrationsApplied: 0,\n      ordersCreated: 0,\n      positionsChanged: 0,\n      productionChanged: false,\n    },\n\n    outputFile:\n      \"logs/alpha-v3-committed-risk-isolated-dry-run.json\",\n  };\n\n  fs.mkdirSync(\n    path.dirname(logFile),\n    {\n      recursive: true,\n    }\n  );\n\n  fs.writeFileSync(\n    logFile,\n    JSON.stringify(\n      report,\n      null,\n      2\n    ) + \"\\n\",\n    \"utf8\"\n  );\n\n  console.log(\n    JSON.stringify(\n      {\n        status:\n          report.status,\n\n        migrationRename:\n          report.migrationRename,\n\n        originalMigrationCount:\n          report.isolation.originalMigrationCount,\n\n        temporarilyMovedCount:\n          report.isolation.temporarilyMovedCount,\n\n        isolatedFiles:\n          report.isolation.isolatedFiles,\n\n        dryRunExitCode:\n          report.dryRun.exitCode,\n\n        migrationLines:\n          report.dryRun.migrationLines,\n\n        safeForSingleMigrationPush:\n          report.decision.safeForSingleMigrationPush,\n\n        databaseApplied:\n          false,\n\n        nextGate:\n          report.decision.nextGate,\n\n        outputFile:\n          report.outputFile,\n      },\n      null,\n      2\n    )\n  );\n\n  if (!safeForSingleMigrationPush) {\n    process.exitCode = 2;\n  }\n} finally {\n  restoreFiles(moved);\n\n  fs.rmSync(\n    stagingRoot,\n    {\n      recursive: true,\n      force: true,\n    }\n  );\n}\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_COMMITTED_RISK_ISOLATED_DRY_RUN_V1_INSTALLED",

      generatedFile:
        "scripts/alpha-v3-committed-risk-isolated-dry-run.cjs",

      migrationRename: {
        from:
          "052_committed_risk_reservation_v3.sql",

        to:
          "20261008000100_committed_risk_reservation_v3.sql"
      },

      behavior:
        "TEMPORARILY_ISOLATE_OTHER_MIGRATIONS_AND_RUN_DB_PUSH_DRY_RUN",

      automaticRestore:
        true,

      databaseWrites:
        0,

      nextAction:
        "RUN_ISOLATED_DRY_RUN"
    },
    null,
    2
  )
);
