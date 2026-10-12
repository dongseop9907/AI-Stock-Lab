const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = process.cwd();

const migrationsDir =
  path.resolve(
    root,
    "supabase/migrations"
  );

const oldName =
  "052_committed_risk_reservation_v3.sql";

const targetName =
  "20261008000100_committed_risk_reservation_v3.sql";

const oldPath =
  path.join(
    migrationsDir,
    oldName
  );

const targetPath =
  path.join(
    migrationsDir,
    targetName
  );

const stagingRoot =
  path.resolve(
    root,
    "supabase/.committed-risk-migration-isolation"
  );

const logFile =
  path.resolve(
    root,
    "logs/alpha-v3-committed-risk-isolated-dry-run.json"
  );

function ensureTargetMigration() {
  if (
    fs.existsSync(oldPath) &&
    !fs.existsSync(targetPath)
  ) {
    fs.renameSync(
      oldPath,
      targetPath
    );
  }

  if (
    fs.existsSync(oldPath) &&
    fs.existsSync(targetPath)
  ) {
    const oldText =
      fs.readFileSync(
        oldPath,
        "utf8"
      );

    const targetText =
      fs.readFileSync(
        targetPath,
        "utf8"
      );

    if (oldText !== targetText) {
      throw new Error(
        "DUPLICATE_COMMITTED_RISK_MIGRATION_CONTENT_MISMATCH"
      );
    }

    fs.unlinkSync(oldPath);
  }

  if (!fs.existsSync(targetPath)) {
    throw new Error(
      `TARGET_MIGRATION_NOT_FOUND:${targetName}`
    );
  }
}

function patchVerifierReferences() {
  const files = [
    "scripts/alpha-v3-committed-risk-foundation-verify.ts",
    "scripts/alpha-v3-committed-risk-atomic-integration-verify.ts",
    "scripts/alpha-v3-committed-risk-db-apply-readiness.cjs",
  ];

  for (const rel of files) {
    const file =
      path.resolve(
        root,
        rel
      );

    if (!fs.existsSync(file)) {
      continue;
    }

    const before =
      fs.readFileSync(
        file,
        "utf8"
      );

    const after =
      before.replaceAll(
        oldName,
        targetName
      );

    if (after !== before) {
      fs.writeFileSync(
        file,
        after,
        "utf8"
      );
    }
  }
}

function runSupabase(args) {
  const cli =
    path.resolve(
      root,
      "node_modules/.bin/supabase.cmd"
    );

  if (!fs.existsSync(cli)) {
    throw new Error(
      "LOCAL_SUPABASE_CLI_NOT_FOUND"
    );
  }

  return spawnSync(
    cli,
    args,
    {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      env: process.env,
      timeout: 120000,
    }
  );
}

function restoreFiles(moved) {
  for (
    const item
    of [...moved].reverse()
  ) {
    if (
      fs.existsSync(item.to)
    ) {
      fs.renameSync(
        item.to,
        item.from
      );
    }
  }
}

ensureTargetMigration();
patchVerifierReferences();

fs.rmSync(
  stagingRoot,
  {
    recursive: true,
    force: true,
  }
);

fs.mkdirSync(
  stagingRoot,
  {
    recursive: true,
  }
);

const migrationFiles =
  fs.readdirSync(
    migrationsDir
  )
    .filter(
      (name) =>
        name.endsWith(".sql")
    )
    .sort();

const moved = [];

try {
  for (const name of migrationFiles) {
    if (
      name === targetName
    ) {
      continue;
    }

    const from =
      path.join(
        migrationsDir,
        name
      );

    const to =
      path.join(
        stagingRoot,
        name
      );

    fs.renameSync(
      from,
      to
    );

    moved.push({
      from,
      to,
      name,
    });
  }

  const isolatedFiles =
    fs.readdirSync(
      migrationsDir
    )
      .filter(
        (name) =>
          name.endsWith(".sql")
      )
      .sort();

  if (
    isolatedFiles.length !== 1 ||
    isolatedFiles[0] !== targetName
  ) {
    throw new Error(
      `ISOLATION_FAILED:${JSON.stringify(isolatedFiles)}`
    );
  }

  const result =
    runSupabase([
      "db",
      "push",
      "--dry-run",
    ]);

  const combined =
    [
      result.stdout ?? "",
      result.stderr ?? "",
    ].join("\n");

  const migrationLines =
    combined
      .split(/\r?\n/)
      .map(
        (line) =>
          line.trim()
      )
      .filter(
        (line) =>
          /\.sql$/i.test(line) ||
          line.includes(targetName)
      );

  const targetMentioned =
    combined.includes(
      targetName
    );

  const otherSqlMentioned =
    migrationLines.some(
      (line) =>
        !line.includes(
          targetName
        )
    );

  const dryRunSucceeded =
    result.status === 0;

  const safeForSingleMigrationPush =
    dryRunSucceeded &&
    targetMentioned &&
    !otherSqlMentioned;

  const report = {
    status:
      safeForSingleMigrationPush
        ? "ALPHA_V3_COMMITTED_RISK_ISOLATED_DRY_RUN_VERIFIED"
        : "ALPHA_V3_COMMITTED_RISK_ISOLATED_DRY_RUN_NOT_SAFE",

    migrationRename: {
      oldName,
      targetName,
      oldStillExists:
        fs.existsSync(oldPath),
      targetExists:
        fs.existsSync(targetPath),
    },

    isolation: {
      originalMigrationCount:
        migrationFiles.length,
      temporarilyMovedCount:
        moved.length,
      isolatedFiles,
    },

    dryRun: {
      exitCode:
        result.status,
      targetMentioned,
      otherSqlMentioned,
      migrationLines,
      stdoutTail:
        String(result.stdout ?? "")
          .split(/\r?\n/)
          .slice(-30)
          .join("\n"),
      stderrTail:
        String(result.stderr ?? "")
          .split(/\r?\n/)
          .slice(-15)
          .join("\n"),
    },

    decision: {
      safeForSingleMigrationPush,

      databaseApplied:
        false,

      nextGate:
        safeForSingleMigrationPush
          ? "RUN_ISOLATED_SINGLE_MIGRATION_PUSH"
          : "DO_NOT_PUSH_REVIEW_DRY_RUN",
    },

    safety: {
      databaseWrites: 0,
      migrationsApplied: 0,
      ordersCreated: 0,
      positionsChanged: 0,
      productionChanged: false,
    },

    outputFile:
      "logs/alpha-v3-committed-risk-isolated-dry-run.json",
  };

  fs.mkdirSync(
    path.dirname(logFile),
    {
      recursive: true,
    }
  );

  fs.writeFileSync(
    logFile,
    JSON.stringify(
      report,
      null,
      2
    ) + "\n",
    "utf8"
  );

  console.log(
    JSON.stringify(
      {
        status:
          report.status,

        migrationRename:
          report.migrationRename,

        originalMigrationCount:
          report.isolation.originalMigrationCount,

        temporarilyMovedCount:
          report.isolation.temporarilyMovedCount,

        isolatedFiles:
          report.isolation.isolatedFiles,

        dryRunExitCode:
          report.dryRun.exitCode,

        migrationLines:
          report.dryRun.migrationLines,

        safeForSingleMigrationPush:
          report.decision.safeForSingleMigrationPush,

        databaseApplied:
          false,

        nextGate:
          report.decision.nextGate,

        outputFile:
          report.outputFile,
      },
      null,
      2
    )
  );

  if (!safeForSingleMigrationPush) {
    process.exitCode = 2;
  }
} finally {
  restoreFiles(moved);

  fs.rmSync(
    stagingRoot,
    {
      recursive: true,
      force: true,
    }
  );
}
