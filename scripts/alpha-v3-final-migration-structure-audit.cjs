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

const typesFile =
  path.resolve(
    root,
    "logs/alpha-v3-remote-database-types.ts"
  );

const outputFile =
  path.resolve(
    root,
    "logs/alpha-v3-final-migration-structure-audit.json"
  );

const targetMigrations = [
  "008_bind_models_to_orders.sql",
  "016_automation_failure_telegram.sql",
  "017_automation_recovery_telegram.sql",
  "031_market_regime_shadow_outcomes_signal_date.sql",
  "045_market_daily_bars_security_master_fk_v8_3_1.sql",
  "062_corporate_action_provider_identity.sql",
];

function quoteCmdArg(value) {
  const text =
    String(value);

  if (
    /^[A-Za-z0-9_./:\\=-]+$/.test(
      text
    )
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
        180000,

      maxBuffer:
        30 * 1024 * 1024,
    }
  );
}

function normalize(value) {
  return String(value)
    .replace(/"/g, "")
    .trim()
    .toLowerCase();
}

function unique(values) {
  return [
    ...new Set(
      values
    ),
  ];
}

function extractIndexNames(sql) {
  const rows = [];

  const regex =
    /create\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?"?([A-Za-z_][\w$]*)"?\s+on\s+(?:(?:public|[A-Za-z_][\w$]*)\s*\.\s*)?"?([A-Za-z_][\w$]*)"?/ig;

  let match;

  while (
    (match = regex.exec(sql))
  ) {
    rows.push({
      index:
        normalize(
          match[1]
        ),

      table:
        normalize(
          match[2]
        ),

      unique:
        /^create\s+unique\s+index/i.test(
          match[0]
        ),
    });
  }

  return rows;
}

function extractExplicitForeignKeys(sql) {
  const rows = [];

  /*
   * ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY (...) REFERENCES ...
   */
  const regex =
    /alter\s+table\s+(?:(?:public|[A-Za-z_][\w$]*)\s*\.\s*)?"?([A-Za-z_][\w$]*)"?[\s\S]{0,500}?add\s+constraint\s+"?([A-Za-z_][\w$]*)"?[\s\S]{0,400}?foreign\s+key\s*\(\s*"?([A-Za-z_][\w$]*)"?\s*\)[\s\S]{0,300}?references\s+(?:(?:public|[A-Za-z_][\w$]*)\s*\.\s*)?"?([A-Za-z_][\w$]*)"?\s*\(\s*"?([A-Za-z_][\w$]*)"?\s*\)/ig;

  let match;

  while (
    (match = regex.exec(sql))
  ) {
    rows.push({
      table:
        normalize(
          match[1]
        ),

      constraint:
        normalize(
          match[2]
        ),

      column:
        normalize(
          match[3]
        ),

      referencedTable:
        normalize(
          match[4]
        ),

      referencedColumn:
        normalize(
          match[5]
        ),
    });
  }

  return rows;
}

function extractRelationshipObjects(typesText) {
  const rows = [];

  /*
   * Match Supabase generated relationship entries:
   * {
   *   foreignKeyName: "..."
   *   columns: ["..."]
   *   isOneToOne: ...
   *   referencedRelation: "..."
   *   referencedColumns: ["..."]
   * }
   *
   * Source table is inferred by the nearest preceding top-level table key.
   */
  const lines =
    typesText.replace(/\r\n/g, "\n")
      .split("\n");

  let inTables =
    false;

  let currentTable =
    null;

  for (
    let i = 0;
    i < lines.length;
    i += 1
  ) {
    const line =
      lines[i];

    if (
      /^\s{4}Tables:\s*\{/.test(
        line
      )
    ) {
      inTables =
        true;

      continue;
    }

    if (
      inTables &&
      /^\s{4}(Views|Functions|Enums|CompositeTypes):\s*\{/.test(
        line
      )
    ) {
      inTables =
        false;

      currentTable =
        null;

      continue;
    }

    if (!inTables) {
      continue;
    }

    const tableMatch =
      line.match(
        /^\s{6}([A-Za-z_][A-Za-z0-9_]*):\s*\{/
      );

    if (tableMatch) {
      currentTable =
        normalize(
          tableMatch[1]
        );

      continue;
    }

    if (
      !currentTable ||
      !/foreignKeyName:\s*"/.test(
        line
      )
    ) {
      continue;
    }

    const block =
      lines
        .slice(
          i,
          Math.min(
            lines.length,
            i + 10
          )
        )
        .join("\n");

    const fkName =
      block.match(
        /foreignKeyName:\s*"([^"]+)"/
      );

    const columns =
      block.match(
        /columns:\s*\[\s*"([^"]+)"\s*\]/
      );

    const referencedRelation =
      block.match(
        /referencedRelation:\s*"([^"]+)"/
      );

    const referencedColumns =
      block.match(
        /referencedColumns:\s*\[\s*"([^"]+)"\s*\]/
      );

    if (
      fkName &&
      columns &&
      referencedRelation &&
      referencedColumns
    ) {
      rows.push({
        table:
          currentTable,

        constraint:
          normalize(
            fkName[1]
          ),

        column:
          normalize(
            columns[1]
          ),

        referencedTable:
          normalize(
            referencedRelation[1]
          ),

        referencedColumn:
          normalize(
            referencedColumns[1]
          ),
      });
    }
  }

  return rows;
}

function relationMatches(
  expected,
  actual
) {
  return (
    expected.table ===
      actual.table &&
    expected.column ===
      actual.column &&
    expected.referencedTable ===
      actual.referencedTable &&
    expected.referencedColumn ===
      actual.referencedColumn
  );
}

function tail(
  value,
  lines = 20
) {
  return String(
    value ?? ""
  )
    .split(/\r?\n/)
    .slice(
      -lines
    )
    .join("\n")
    .trim();
}

if (
  !fs.existsSync(
    typesFile
  )
) {
  throw new Error(
    "REMOTE_TYPES_FILE_MISSING"
  );
}

const typesText =
  fs.readFileSync(
    typesFile,
    "utf8"
  );

const remoteRelationships =
  extractRelationshipObjects(
    typesText
  );

const inspect =
  runSupabase([
    "inspect",
    "db",
    "index-stats",
    "--linked",
  ]);

const inspectOutput =
  [
    inspect.stdout ?? "",
    inspect.stderr ?? "",
  ].join("\n");

const indexInspectSucceeded =
  inspect.status === 0;

const migrationRows =
  [];

for (
  const migration
  of targetMigrations
) {
  const file =
    path.join(
      migrationsDir,
      migration
    );

  if (
    !fs.existsSync(
      file
    )
  ) {
    migrationRows.push({
      migration,
      exists:
        false,

      status:
        "LOCAL_MIGRATION_MISSING",
    });

    continue;
  }

  const sql =
    fs.readFileSync(
      file,
      "utf8"
    );

  const expectedIndexes =
    extractIndexNames(
      sql
    );

  const expectedFks =
    extractExplicitForeignKeys(
      sql
    );

  const indexChecks =
    expectedIndexes.map(
      (item) => ({
        ...item,

        remotePresent:
          new RegExp(
            `\\b${item.index.replace(
              /[.*+?^${}()|[\]\\]/g,
              "\\$&"
            )}\\b`,
            "i"
          ).test(
            inspectOutput
          ),
      })
    );

  const fkChecks =
    expectedFks.map(
      (item) => {
        const matched =
          remoteRelationships.find(
            (remote) =>
              relationMatches(
                item,
                remote
              )
          );

        return {
          ...item,

          remotePresent:
            Boolean(
              matched
            ),

          remoteConstraint:
            matched?.constraint ??
            null,
        };
      }
    );

  const allIndexesPresent =
    indexChecks.every(
      (row) =>
        row.remotePresent
    );

  const allFksPresent =
    fkChecks.every(
      (row) =>
        row.remotePresent
    );

  let status =
    "STRUCTURE_CONFIRMED";

  if (
    expectedIndexes.length > 0 &&
    !indexInspectSucceeded
  ) {
    status =
      "INDEX_INSPECTION_FAILED";
  } else if (
    !allIndexesPresent ||
    !allFksPresent
  ) {
    status =
      "STRUCTURE_EVIDENCE_MISSING";
  }

  migrationRows.push({
    migration,

    exists:
      true,

    expectedIndexes,

    expectedFks,

    indexChecks,

    fkChecks,

    status,
  });
}

const allConfirmed =
  indexInspectSucceeded &&
  migrationRows.every(
    (row) =>
      row.status ===
      "STRUCTURE_CONFIRMED"
  );

const missing =
  migrationRows.filter(
    (row) =>
      row.status !==
      "STRUCTURE_CONFIRMED"
  );

const historicalFiles =
  fs.readdirSync(
    migrationsDir
  )
    .filter(
      (name) =>
        name.endsWith(".sql") &&
        name !==
          "20261008000100_committed_risk_reservation_v3.sql"
    )
    .sort();

const versions =
  historicalFiles.map(
    (name) =>
      name.split("_")[0]
  );

const duplicateVersions =
  [
    ...new Set(
      versions.filter(
        (version, index) =>
          versions.indexOf(
            version
          ) !==
          index
      )
    ),
  ];

const report = {
  status:
    allConfirmed
      ? "ALPHA_V3_FINAL_MIGRATION_STRUCTURE_AUDIT_VERIFIED"
      : "ALPHA_V3_FINAL_MIGRATION_STRUCTURE_AUDIT_REVIEW",

  indexInspection: {
    succeeded:
      indexInspectSucceeded,

    exitCode:
      inspect.status,

    stderrTail:
      tail(
        inspect.stderr,
        12
      ),

    stdoutTail:
      tail(
        inspect.stdout,
        12
      ),
  },

  remoteRelationshipsCount:
    remoteRelationships.length,

  migrations:
    migrationRows,

  missingEvidence:
    missing,

  historyCandidate: {
    historicalMigrationFiles:
      historicalFiles.length,

    versions,

    duplicateVersions,

    committedRiskTargetExcluded:
      true,
  },

  decision: {
    allRemainingStructureConfirmed:
      allConfirmed,

    safeToBuildHistoryRepairCommand:
      allConfirmed &&
      duplicateVersions.length === 0,

    nextGate:
      allConfirmed &&
      duplicateVersions.length === 0
        ? "BUILD_AND_DRY_RUN_MIGRATION_HISTORY_REPAIR"
        : "REVIEW_MISSING_STRUCTURE_OR_DUPLICATE_VERSIONS",
  },

  safety: {
    databaseReads:
      indexInspectSucceeded
        ? 1
        : 0,

    databaseWrites:
      0,

    migrationHistoryChanged:
      false,

    migrationsApplied:
      0,
  },

  outputFile:
    "logs/alpha-v3-final-migration-structure-audit.json",
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

      indexInspectionSucceeded:
        report.indexInspection.succeeded,

      migrations:
        report.migrations.map(
          (row) => ({
            migration:
              row.migration,

            status:
              row.status,

            indexChecks:
              row.indexChecks,

            fkChecks:
              row.fkChecks,
          })
        ),

      missingEvidence:
        report.missingEvidence.map(
          (row) =>
            row.migration
        ),

      historicalMigrationFiles:
        report.historyCandidate
          .historicalMigrationFiles,

      duplicateVersions:
        report.historyCandidate
          .duplicateVersions,

      safeToBuildHistoryRepairCommand:
        report.decision
          .safeToBuildHistoryRepairCommand,

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

if (
  !report.decision
    .safeToBuildHistoryRepairCommand
) {
  process.exitCode =
    2;
}
