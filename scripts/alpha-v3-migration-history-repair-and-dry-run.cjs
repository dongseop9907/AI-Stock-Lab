const fs = require("fs");
const path = require("path");
const { spawnSync } = require("node:child_process");

const root = process.cwd();

const cli =
  path.resolve(
    root,
    "node_modules/.bin/supabase.cmd"
  );

const migrationsDir =
  path.resolve(
    root,
    "supabase/migrations"
  );

const targetMigration =
  "20261008000100_committed_risk_reservation_v3.sql";

const targetVersion =
  targetMigration.split("_")[0];

const outputFile =
  path.resolve(
    root,
    "logs/alpha-v3-migration-history-repair-and-dry-run.json"
  );

const auditFiles = {
  finalStructure:
    path.resolve(
      root,
      "logs/alpha-v3-final-migration-structure-audit.json"
    ),

  modelFunction:
    path.resolve(
      root,
      "logs/alpha-v3-model-function-drift-probe.json"
    ),

  noSignature:
    path.resolve(
      root,
      "logs/alpha-v3-no-signature-migration-audit.json"
    ),

  remoteSchema:
    path.resolve(
      root,
      "logs/alpha-v3-remote-schema-api-audit.json"
    ),
};

function readJson(file) {
  if (!fs.existsSync(file)) {
    throw new Error(
      `REQUIRED_AUDIT_FILE_MISSING:${path.relative(root, file)}`
    );
  }

  return JSON.parse(
    fs.readFileSync(
      file,
      "utf8"
    )
  );
}

function quoteCmdArg(value) {
  const text =
    String(value);

  if (
    /^[A-Za-z0-9_./:\\=-]+$/.test(text)
  ) {
    return text;
  }

  return `"${text.replace(/"/g, '""')}"`;
}

function runSupabase(args) {
  if (!fs.existsSync(cli)) {
    throw new Error(
      "LOCAL_SUPABASE_CLI_NOT_FOUND"
    );
  }

  const comspec =
    process.env.ComSpec ||
    process.env.COMSPEC ||
    "C:\\Windows\\System32\\cmd.exe";

  const command =
    [
      quoteCmdArg(cli),
      ...args.map(
        quoteCmdArg
      ),
    ].join(" ");

  return spawnSync(
    comspec,
    [
      "/d",
      "/s",
      "/c",
      command,
    ],
    {
      cwd:
        root,

      encoding:
        "utf8",

      windowsHide:
        true,

      env:
        process.env,

      timeout:
        240000,

      maxBuffer:
        40 * 1024 * 1024,
    }
  );
}

function tail(value, count = 25) {
  return String(
    value ?? ""
  )
    .split(/\r?\n/)
    .slice(
      -count
    )
    .join("\n")
    .trim();
}

function cleanCell(value) {
  const text =
    String(value ?? "")
      .replace(
        /\x1b\[[0-9;]*m/g,
        ""
      )
      .replace(
        /`/g,
        ""
      )
      .trim();

  const match =
    text.match(
      /\b(\d{3,14})\b/
    );

  return match
    ? match[1]
    : null;
}

function parseMigrationList(value) {
  const rows = [];

  for (
    const rawLine
    of String(value ?? "")
      .split(/\r?\n/)
  ) {
    const line =
      rawLine.replace(
        /\x1b\[[0-9;]*m/g,
        ""
      );

    if (
      !line.includes("|") &&
      !line.includes("│")
    ) {
      continue;
    }

    const parts =
      line.split(
        /[|│]/
      );

    if (
      parts.length < 2
    ) {
      continue;
    }

    const local =
      cleanCell(
        parts[0]
      );

    const remote =
      cleanCell(
        parts[1]
      );

    if (
      !local &&
      !remote
    ) {
      continue;
    }

    rows.push({
      local,
      remote,
      raw:
        line.trim(),
    });
  }

  return rows;
}

function extractSqlFiles(value) {
  const matches =
    String(value ?? "")
      .match(
        /\b\d{3,14}_[A-Za-z0-9_.-]+\.sql\b/g
      ) ??
    [];

  return [
    ...new Set(
      matches
    ),
  ].sort();
}

function patchInstallerReferences() {
  const installers = [
    "scripts/install-alpha-v3-committed-risk-reservation-foundation-v1.cjs",
    "scripts/install-alpha-v3-committed-risk-atomic-integration-v2.cjs",
  ];

  const oldName =
    "052_committed_risk_reservation_v3.sql";

  for (
    const rel
    of installers
  ) {
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
        targetMigration
      );

    if (
      after !==
      before
    ) {
      fs.writeFileSync(
        file,
        after,
        "utf8"
      );
    }
  }
}

/*
 * Hard gates from the prior read-only audits.
 */
const finalStructure =
  readJson(
    auditFiles.finalStructure
  );

const modelFunction =
  readJson(
    auditFiles.modelFunction
  );

const noSignature =
  readJson(
    auditFiles.noSignature
  );

const remoteSchema =
  readJson(
    auditFiles.remoteSchema
  );

const auditChecks = {
  finalStructureVerified:
    finalStructure.status ===
      "ALPHA_V3_FINAL_MIGRATION_STRUCTURE_AUDIT_VERIFIED" &&
    finalStructure.decision
      ?.safeToBuildHistoryRepairCommand ===
      true,

  modelFunctionExplained:
    modelFunction.decision
      ?.genTypesAbsenceExplained ===
      true &&
    modelFunction.decision
      ?.migration009CanRemainBaselineCandidate ===
      true,

  noRemoteColumnEvidenceMissing:
    Array.isArray(
      noSignature.remoteEvidenceMissing
    ) &&
    noSignature.remoteEvidenceMissing.length ===
      0,

  committedRiskNotApplied:
    remoteSchema.committedRiskTarget
      ?.status ===
      "TARGET_NOT_APPLIED_EXPECTED",
};

const failedAuditChecks =
  Object.entries(
    auditChecks
  )
    .filter(
      ([, ok]) =>
        !ok
    )
    .map(
      ([name]) =>
        name
    );

if (
  failedAuditChecks.length >
  0
) {
  throw new Error(
    `AUDIT_GATES_NOT_SATISFIED:${failedAuditChecks.join(",")}`
  );
}

if (
  !fs.existsSync(
    path.join(
      migrationsDir,
      targetMigration
    )
  )
) {
  throw new Error(
    `COMMITTED_RISK_TARGET_MIGRATION_MISSING:${targetMigration}`
  );
}

const migrationFiles =
  fs.readdirSync(
    migrationsDir
  )
    .filter(
      (name) =>
        name.endsWith(".sql")
    )
    .sort();

const historicalFiles =
  migrationFiles.filter(
    (name) =>
      name !==
      targetMigration
  );

const historicalVersions =
  historicalFiles.map(
    (name) =>
      name.split("_")[0]
  );

const duplicateVersions =
  [
    ...new Set(
      historicalVersions.filter(
        (version, index) =>
          historicalVersions.indexOf(
            version
          ) !==
          index
      )
    ),
  ];

if (
  historicalFiles.length !==
  62
) {
  throw new Error(
    `UNEXPECTED_HISTORICAL_MIGRATION_COUNT:${historicalFiles.length}`
  );
}

if (
  duplicateVersions.length >
  0
) {
  throw new Error(
    `DUPLICATE_HISTORICAL_VERSIONS:${duplicateVersions.join(",")}`
  );
}

if (
  historicalVersions.includes(
    targetVersion
  )
) {
  throw new Error(
    "TARGET_VERSION_COLLIDES_WITH_HISTORY"
  );
}

patchInstallerReferences();

/*
 * Preflight remote history.
 * We only proceed if NONE of the 62 historical versions and not the target
 * are already recorded remotely. This matches the previously observed empty
 * remote migration history and prevents deleting pre-existing history later.
 */
const beforeList =
  runSupabase([
    "migration",
    "list",
    "--linked",
  ]);

if (
  beforeList.status !==
  0
) {
  throw new Error(
    [
      "PRE_REPAIR_MIGRATION_LIST_FAILED",
      tail(
        beforeList.stderr,
        20
      ),
    ].join(":")
  );
}

const beforeRows =
  parseMigrationList(
    [
      beforeList.stdout ?? "",
      beforeList.stderr ?? "",
    ].join("\n")
  );

const expectedSet =
  new Set(
    historicalVersions
  );

const remoteHistoricalBefore =
  beforeRows
    .map(
      (row) =>
        row.remote
    )
    .filter(
      (version) =>
        version &&
        expectedSet.has(
          version
        )
    );

const targetRemoteBefore =
  beforeRows.some(
    (row) =>
      row.remote ===
      targetVersion
  );

if (
  remoteHistoricalBefore.length >
    0 ||
  targetRemoteBefore
) {
  throw new Error(
    `REMOTE_HISTORY_NOT_EMPTY_AS_EXPECTED:historical=${JSON.stringify(remoteHistoricalBefore)}:target=${targetRemoteBefore}`
  );
}

/*
 * REAL WRITE: history table only.
 * Supabase CLI supports multiple [version] arguments in one repair command.
 */
const repair =
  runSupabase([
    "migration",
    "repair",
    ...historicalVersions,
    "--status",
    "applied",
    "--linked",
    "--yes",
  ]);

const repairCombined =
  [
    repair.stdout ?? "",
    repair.stderr ?? "",
  ].join("\n");

const repairSucceeded =
  repair.status ===
  0;

if (
  !repairSucceeded
) {
  const failure = {
    status:
      "ALPHA_V3_MIGRATION_HISTORY_REPAIR_FAILED",

    auditChecks,

    historicalVersions,

    repair: {
      exitCode:
        repair.status,

      stdoutTail:
        tail(
          repair.stdout,
          30
        ),

      stderrTail:
        tail(
          repair.stderr,
          30
        ),
    },

    safety: {
      schemaSqlExecuted:
        false,

      migrationFilesApplied:
        0,

      migrationHistoryMayBePartiallyChanged:
        true,
    },

    nextGate:
      "INSPECT_REMOTE_MIGRATION_HISTORY_AFTER_REPAIR_FAILURE",
  };

  fs.mkdirSync(
    path.dirname(
      outputFile
    ),
    {
      recursive:
        true,
    }
  );

  fs.writeFileSync(
    outputFile,
    JSON.stringify(
      failure,
      null,
      2
    ) + "\n",
    "utf8"
  );

  console.log(
    JSON.stringify(
      failure,
      null,
      2
    )
  );

  process.exitCode =
    2;

  return;
}

/*
 * Verify remote history after repair.
 */
const afterList =
  runSupabase([
    "migration",
    "list",
    "--linked",
  ]);

const afterListCombined =
  [
    afterList.stdout ?? "",
    afterList.stderr ?? "",
  ].join("\n");

const afterRows =
  parseMigrationList(
    afterListCombined
  );

const remoteHistoricalAfter =
  new Set(
    afterRows
      .map(
        (row) =>
          row.remote
      )
      .filter(Boolean)
  );

const missingRemoteAfter =
  historicalVersions.filter(
    (version) =>
      !remoteHistoricalAfter.has(
        version
      )
  );

const targetRemoteAfter =
  remoteHistoricalAfter.has(
    targetVersion
  );

/*
 * Critical post-repair dry run.
 * No SQL is applied here.
 */
const dryRun =
  runSupabase([
    "db",
    "push",
    "--dry-run",
    "--linked",
  ]);

const dryRunCombined =
  [
    dryRun.stdout ?? "",
    dryRun.stderr ?? "",
  ].join("\n");

const pendingSqlFiles =
  extractSqlFiles(
    dryRunCombined
  );

const onlyCommittedRiskPending =
  dryRun.status ===
    0 &&
  pendingSqlFiles.length ===
    1 &&
  pendingSqlFiles[0] ===
    targetMigration;

const historyVerified =
  afterList.status ===
    0 &&
  missingRemoteAfter.length ===
    0 &&
  !targetRemoteAfter;

const verified =
  historyVerified &&
  onlyCommittedRiskPending;

const report = {
  status:
    verified
      ? "ALPHA_V3_MIGRATION_HISTORY_REPAIR_AND_DRY_RUN_VERIFIED"
      : "ALPHA_V3_MIGRATION_HISTORY_REPAIR_POSTCHECK_REVIEW",

  auditChecks,

  historyRepair: {
    historicalMigrationFiles:
      historicalFiles.length,

    historicalVersions,

    repairExitCode:
      repair.status,

    repairOutputTail:
      tail(
        repairCombined,
        30
      ),

    schemaSqlExecuted:
      false,

    historyRowsRequestedApplied:
      historicalVersions.length,
  },

  postRepairMigrationList: {
    exitCode:
      afterList.status,

    missingRemoteAfter,

    targetRemoteAfter,

    outputTail:
      tail(
        afterListCombined,
        35
      ),
  },

  dryRun: {
    exitCode:
      dryRun.status,

    pendingSqlFiles,

    onlyCommittedRiskPending,

    outputTail:
      tail(
        dryRunCombined,
        35
      ),
  },

  decision: {
    historyVerified,

    onlyCommittedRiskPending,

    safeToApplyCommittedRiskMigration:
      verified,

    nextGate:
      verified
        ? "APPLY_COMMITTED_RISK_MIGRATION_AND_RUN_DB_CONCURRENCY_TEST"
        : "REVIEW_HISTORY_REPAIR_POSTCHECK_BEFORE_ANY_DB_PUSH",
  },

  safety: {
    migrationHistoryChanged:
      true,

    historyRowsRequestedApplied:
      historicalVersions.length,

    schemaDatabaseWrites:
      0,

    migrationSqlApplied:
      0,

    ordersCreated:
      0,

    positionsChanged:
      0,

    productionTradingChanged:
      false,
  },

  outputFile:
    "logs/alpha-v3-migration-history-repair-and-dry-run.json",
};

fs.mkdirSync(
  path.dirname(
    outputFile
  ),
  {
    recursive:
      true,
  }
);

fs.writeFileSync(
  outputFile,
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

      auditChecks:
        report.auditChecks,

      historicalMigrationFiles:
        report.historyRepair
          .historicalMigrationFiles,

      historyRowsRequestedApplied:
        report.historyRepair
          .historyRowsRequestedApplied,

      missingRemoteAfter:
        report.postRepairMigrationList
          .missingRemoteAfter,

      targetRemoteAfter:
        report.postRepairMigrationList
          .targetRemoteAfter,

      pendingSqlFiles:
        report.dryRun
          .pendingSqlFiles,

      onlyCommittedRiskPending:
        report.dryRun
          .onlyCommittedRiskPending,

      safeToApplyCommittedRiskMigration:
        report.decision
          .safeToApplyCommittedRiskMigration,

      schemaDatabaseWrites:
        0,

      nextGate:
        report.decision
          .nextGate,

      outputFile:
        report.outputFile,
    },
    null,
    2
  )
);

if (!verified) {
  process.exitCode =
    2;
}
