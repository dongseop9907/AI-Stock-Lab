const fs = require("fs");
const path = require("path");

const root = process.cwd();

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
    "logs/alpha-v3-no-signature-migration-audit.json"
  );

const TARGETS = [
  "008_bind_models_to_orders.sql",
  "015_daily_report_telegram.sql",
  "016_automation_failure_telegram.sql",
  "017_automation_recovery_telegram.sql",
  "031_market_regime_shadow_outcomes_signal_date.sql",
  "045_market_daily_bars_security_master_fk_v8_3_1.sql",
  "062_corporate_action_provider_identity.sql",
];

function normalizeName(value) {
  return String(value)
    .replace(/"/g, "")
    .trim()
    .toLowerCase();
}

function extractPublicTypes(text) {
  const result = {
    tables: new Map(),
    views: new Map(),
  };

  const lines =
    text.replace(/\r\n/g, "\n")
      .split("\n");

  let section = null;
  let currentTable = null;
  let currentMode = null;
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line =
      lines[i];

    if (/^\s{4}Tables:\s*\{/.test(line)) {
      section = "tables";
      currentTable = null;
      currentMode = null;
      braceDepth = 1;
      continue;
    }

    if (/^\s{4}Views:\s*\{/.test(line)) {
      section = "views";
      currentTable = null;
      currentMode = null;
      braceDepth = 1;
      continue;
    }

    if (/^\s{4}(Functions|Enums|CompositeTypes):\s*\{/.test(line)) {
      section = null;
      currentTable = null;
      currentMode = null;
      continue;
    }

    if (!section) {
      continue;
    }

    const tableMatch =
      line.match(
        /^\s{6}([A-Za-z_][A-Za-z0-9_]*):\s*\{/
      );

    if (tableMatch) {
      currentTable =
        normalizeName(
          tableMatch[1]
        );

      if (
        !result[section].has(
          currentTable
        )
      ) {
        result[section].set(
          currentTable,
          new Set()
        );
      }

      currentMode = null;
      continue;
    }

    if (!currentTable) {
      continue;
    }

    if (/^\s{8}Row:\s*\{/.test(line)) {
      currentMode = "row";
      continue;
    }

    if (/^\s{8}(Insert|Update|Relationships):/.test(line)) {
      currentMode = null;
      continue;
    }

    if (currentMode === "row") {
      const colMatch =
        line.match(
          /^\s{10}([A-Za-z_][A-Za-z0-9_]*):/
        );

      if (colMatch) {
        result[section]
          .get(currentTable)
          .add(
            normalizeName(
              colMatch[1]
            )
          );
      }
    }
  }

  return result;
}

function contextAround(text, index, radius = 5) {
  const before =
    text
      .slice(0, index)
      .split(/\r?\n/)
      .length;

  const lines =
    text.replace(/\r\n/g, "\n")
      .split("\n");

  const start =
    Math.max(
      1,
      before - radius
    );

  const end =
    Math.min(
      lines.length,
      before + radius
    );

  return {
    line:
      before,

    text:
      lines
        .slice(
          start - 1,
          end
        )
        .map(
          (value, offset) =>
            `${start + offset}: ${value}`
        )
        .join("\n"),
  };
}

function allMatches(text, regex, mapper) {
  const rows = [];
  let match;

  while (
    (match = regex.exec(text))
  ) {
    rows.push(
      mapper(
        match,
        match.index
      )
    );
  }

  return rows;
}

function extractOperations(sql) {
  const addColumns =
    allMatches(
      sql,
      /alter\s+table\s+(?:if\s+exists\s+)?(?:(?:public|[A-Za-z_][\w$]*)\s*\.\s*)?"?([A-Za-z_][\w$]*)"?[\s\S]{0,800}?add\s+column\s+(?:if\s+not\s+exists\s+)?"?([A-Za-z_][\w$]*)"?/ig,
      (m, index) => ({
        table:
          normalizeName(
            m[1]
          ),

        column:
          normalizeName(
            m[2]
          ),

        context:
          contextAround(
            sql,
            index,
            8
          ),
      })
    );

  const alterTables =
    allMatches(
      sql,
      /alter\s+table\s+(?:if\s+exists\s+)?(?:(?:public|[A-Za-z_][\w$]*)\s*\.\s*)?"?([A-Za-z_][\w$]*)"?/ig,
      (m, index) => ({
        table:
          normalizeName(
            m[1]
          ),

        context:
          contextAround(
            sql,
            index,
            6
          ),
      })
    );

  const createTriggers =
    allMatches(
      sql,
      /create\s+trigger\s+"?([A-Za-z_][\w$]*)"?[\s\S]{0,700}?on\s+(?:(?:public|[A-Za-z_][\w$]*)\s*\.\s*)?"?([A-Za-z_][\w$]*)"?/ig,
      (m, index) => ({
        trigger:
          normalizeName(
            m[1]
          ),

        table:
          normalizeName(
            m[2]
          ),

        context:
          contextAround(
            sql,
            index,
            10
          ),
      })
    );

  const dropTriggers =
    allMatches(
      sql,
      /drop\s+trigger\s+(?:if\s+exists\s+)?"?([A-Za-z_][\w$]*)"?[\s\S]{0,200}?on\s+(?:(?:public|[A-Za-z_][\w$]*)\s*\.\s*)?"?([A-Za-z_][\w$]*)"?/ig,
      (m, index) => ({
        trigger:
          normalizeName(
            m[1]
          ),

        table:
          normalizeName(
            m[2]
          ),

        context:
          contextAround(
            sql,
            index,
            6
          ),
      })
    );

  const dml = [];

  for (
    const [type, regex]
    of [
      [
        "INSERT",
        /insert\s+into\s+(?:(?:public|[A-Za-z_][\w$]*)\s*\.\s*)?"?([A-Za-z_][\w$]*)"?/ig,
      ],
      [
        "UPDATE",
        /update\s+(?:(?:public|[A-Za-z_][\w$]*)\s*\.\s*)?"?([A-Za-z_][\w$]*)"?/ig,
      ],
      [
        "DELETE",
        /delete\s+from\s+(?:(?:public|[A-Za-z_][\w$]*)\s*\.\s*)?"?([A-Za-z_][\w$]*)"?/ig,
      ],
    ]
  ) {
    dml.push(
      ...allMatches(
        sql,
        regex,
        (m, index) => ({
          type,
          table:
            normalizeName(
              m[1]
            ),
          context:
            contextAround(
              sql,
              index,
              7
            ),
        })
      )
    );
  }

  const constraintOps =
    allMatches(
      sql,
      /\b(add\s+constraint|drop\s+constraint|foreign\s+key|references\s+(?:(?:public|[A-Za-z_][\w$]*)\s*\.\s*)?"?([A-Za-z_][\w$]*)"?)/ig,
      (m, index) => ({
        operation:
          m[1]
            .replace(/\s+/g, " ")
            .trim()
            .toUpperCase(),

        referencedTable:
          m[2]
            ? normalizeName(
                m[2]
              )
            : null,

        context:
          contextAround(
            sql,
            index,
            7
          ),
      })
    );

  const createIndexes =
    allMatches(
      sql,
      /create\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?"?([A-Za-z_][\w$]*)"?[\s\S]{0,300}?on\s+(?:(?:public|[A-Za-z_][\w$]*)\s*\.\s*)?"?([A-Za-z_][\w$]*)"?/ig,
      (m, index) => ({
        index:
          normalizeName(
            m[1]
          ),

        table:
          normalizeName(
            m[2]
          ),

        context:
          contextAround(
            sql,
            index,
            6
          ),
      })
    );

  const createFunctions =
    allMatches(
      sql,
      /create\s+(?:or\s+replace\s+)?function\s+(?:(?:public|[A-Za-z_][\w$]*)\s*\.\s*)?"?([A-Za-z_][\w$]*)"?/ig,
      (m, index) => ({
        function:
          normalizeName(
            m[1]
          ),

        returnsTrigger:
          /\breturns\s+trigger\b/i.test(
            sql.slice(
              index,
              Math.min(
                sql.length,
                index + 3000
              )
            )
          ),

        context:
          contextAround(
            sql,
            index,
            9
          ),
      })
    );

  return {
    addColumns,
    alterTables,
    createTriggers,
    dropTriggers,
    dml,
    constraintOps,
    createIndexes,
    createFunctions,
  };
}

if (!fs.existsSync(typesFile)) {
  throw new Error(
    "REMOTE_TYPES_FILE_MISSING:RUN_REMOTE_SCHEMA_API_AUDIT_FIRST"
  );
}

const remoteTypes =
  fs.readFileSync(
    typesFile,
    "utf8"
  );

const remote =
  extractPublicTypes(
    remoteTypes
  );

const rows = [];

for (const migration of TARGETS) {
  const file =
    path.join(
      migrationsDir,
      migration
    );

  if (!fs.existsSync(file)) {
    rows.push({
      migration,
      exists:
        false,
      classification:
        "LOCAL_FILE_MISSING",
    });

    continue;
  }

  const sql =
    fs.readFileSync(
      file,
      "utf8"
    );

  const ops =
    extractOperations(
      sql
    );

  const columnChecks =
    ops.addColumns.map(
      (item) => ({
        table:
          item.table,

        column:
          item.column,

        tablePresent:
          remote.tables.has(
            item.table
          ),

        columnPresent:
          remote.tables
            .get(
              item.table
            )
            ?.has(
              item.column
            ) ??
          false,
      })
    );

  const allCheckableColumnsPresent =
    columnChecks.length > 0 &&
    columnChecks.every(
      (row) =>
        row.columnPresent
    );

  const hasUnverifiableStructuralOps =
    ops.createTriggers.length > 0 ||
    ops.dropTriggers.length > 0 ||
    ops.constraintOps.length > 0 ||
    ops.createIndexes.length > 0 ||
    ops.createFunctions.some(
      (row) =>
        row.returnsTrigger
    );

  const hasDml =
    ops.dml.length > 0;

  let classification;

  if (
    columnChecks.length > 0 &&
    !allCheckableColumnsPresent
  ) {
    classification =
      "REMOTE_COLUMN_EVIDENCE_MISSING";
  } else if (
    columnChecks.length > 0 &&
    allCheckableColumnsPresent &&
    !hasUnverifiableStructuralOps &&
    !hasDml
  ) {
    classification =
      "REMOTE_COLUMN_EVIDENCE_CONFIRMS_APPLIED";
  } else if (
    columnChecks.length > 0 &&
    allCheckableColumnsPresent &&
    (
      hasUnverifiableStructuralOps ||
      hasDml
    )
  ) {
    classification =
      "COLUMN_EVIDENCE_PRESENT_ADDITIONAL_OPS_REQUIRE_REVIEW";
  } else if (
    hasDml &&
    !hasUnverifiableStructuralOps
  ) {
    classification =
      "DML_ONLY_REQUIRES_SEMANTIC_REVIEW";
  } else if (
    hasUnverifiableStructuralOps
  ) {
    classification =
      "NON_TYPE_SCHEMA_OPS_REQUIRE_REVIEW";
  } else {
    classification =
      "NO_RELEVANT_OPERATION_DETECTED_REVIEW";
  }

  rows.push({
    migration,
    exists:
      true,

    classification,

    columnChecks,

    summary: {
      addColumns:
        ops.addColumns.map(
          (row) => ({
            table:
              row.table,
            column:
              row.column,
          })
        ),

      createTriggers:
        ops.createTriggers.map(
          (row) => ({
            trigger:
              row.trigger,
            table:
              row.table,
          })
        ),

      dropTriggers:
        ops.dropTriggers.map(
          (row) => ({
            trigger:
              row.trigger,
            table:
              row.table,
          })
        ),

      dml:
        ops.dml.map(
          (row) => ({
            type:
              row.type,
            table:
              row.table,
          })
        ),

      constraints:
        ops.constraintOps.map(
          (row) => ({
            operation:
              row.operation,
            referencedTable:
              row.referencedTable,
          })
        ),

      indexes:
        ops.createIndexes.map(
          (row) => ({
            index:
              row.index,
            table:
              row.table,
          })
        ),

      functions:
        ops.createFunctions.map(
          (row) => ({
            function:
              row.function,
            returnsTrigger:
              row.returnsTrigger,
          })
        ),
    },

    detail:
      ops,
  });
}

const confirmed =
  rows.filter(
    (row) =>
      row.classification ===
      "REMOTE_COLUMN_EVIDENCE_CONFIRMS_APPLIED"
  );

const missingEvidence =
  rows.filter(
    (row) =>
      row.classification ===
      "REMOTE_COLUMN_EVIDENCE_MISSING"
  );

const review =
  rows.filter(
    (row) =>
      ![
        "REMOTE_COLUMN_EVIDENCE_CONFIRMS_APPLIED",
        "REMOTE_COLUMN_EVIDENCE_MISSING",
      ].includes(
        row.classification
      )
  );

const report = {
  status:
    "ALPHA_V3_NO_SIGNATURE_MIGRATION_AUDIT_COMPLETE",

  remoteTypeEvidence: {
    tables:
      remote.tables.size,

    views:
      remote.views.size,
  },

  counts: {
    targetMigrations:
      rows.length,

    columnEvidenceConfirmed:
      confirmed.length,

    remoteColumnEvidenceMissing:
      missingEvidence.length,

    requireReview:
      review.length,
  },

  confirmedAppliedByRemoteColumnEvidence:
    confirmed.map(
      (row) =>
        row.migration
    ),

  remoteEvidenceMissing:
    missingEvidence.map(
      (row) => ({
        migration:
          row.migration,
        columnChecks:
          row.columnChecks,
      })
    ),

  reviewMigrations:
    review.map(
      (row) => ({
        migration:
          row.migration,
        classification:
          row.classification,
        columnChecks:
          row.columnChecks,
        summary:
          row.summary,
      })
    ),

  rows,

  decision: {
    safeToRepairAllSeven:
      rows.every(
        (row) =>
          row.classification ===
            "REMOTE_COLUMN_EVIDENCE_CONFIRMS_APPLIED" ||
          (
            row.columnChecks?.length > 0 &&
            row.columnChecks.every(
              (check) =>
                check.columnPresent
            ) &&
            row.classification !==
              "REMOTE_COLUMN_EVIDENCE_MISSING"
          )
      ) &&
      review.every(
        (row) =>
          row.classification ===
          "COLUMN_EVIDENCE_PRESENT_ADDITIONAL_OPS_REQUIRE_REVIEW"
      ),

    nextGate:
      missingEvidence.length > 0
        ? "REVIEW_MISSING_REMOTE_COLUMN_EVIDENCE"
        : "BUILD_CONSERVATIVE_HISTORY_REPAIR_PLAN_WITH_EXPLICIT_REVIEW_EXCEPTIONS",
  },

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    migrationHistoryChanged: false,
    migrationsApplied: 0,
  },

  outputFile:
    "logs/alpha-v3-no-signature-migration-audit.json",
};

fs.mkdirSync(
  path.dirname(
    outputFile
  ),
  {
    recursive: true,
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

      counts:
        report.counts,

      confirmedAppliedByRemoteColumnEvidence:
        report.confirmedAppliedByRemoteColumnEvidence,

      remoteEvidenceMissing:
        report.remoteEvidenceMissing,

      reviewMigrations:
        report.reviewMigrations,

      safeToRepairAllSeven:
        report.decision.safeToRepairAllSeven,

      nextGate:
        report.decision.nextGate,

      outputFile:
        report.outputFile,
    },
    null,
    2
  )
);
