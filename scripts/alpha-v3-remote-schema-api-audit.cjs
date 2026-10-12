const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

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

const typesFile =
  path.resolve(
    root,
    "logs/alpha-v3-remote-database-types.ts"
  );

const reportFile =
  path.resolve(
    root,
    "logs/alpha-v3-remote-schema-api-audit.json"
  );

function quoteCmdArg(value) {
  const text = String(value);

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
      ...args.map(quoteCmdArg),
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
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      env: process.env,
      timeout: 180000,
      maxBuffer: 40 * 1024 * 1024,
    }
  );
}

function normalizeName(value) {
  return String(value)
    .replace(/"/g, "")
    .trim()
    .toLowerCase();
}

function extractMigrationSignatures(sql) {
  const signatures = [];

  const patterns = [
    {
      kind: "table",
      regex:
        /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-zA-Z_][\w$]*)"?/ig,
    },
    {
      kind: "function",
      regex:
        /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?([a-zA-Z_][\w$]*)"?/ig,
    },
    {
      kind: "view",
      regex:
        /create\s+(?:or\s+replace\s+)?view\s+(?:public\.)?"?([a-zA-Z_][\w$]*)"?/ig,
    },
  ];

  for (const { kind, regex } of patterns) {
    let match;

    while ((match = regex.exec(sql))) {
      signatures.push({
        kind,
        name:
          normalizeName(
            match[1]
          ),
      });
    }
  }

  return [
    ...new Map(
      signatures.map(
        (item) => [
          `${item.kind}:${item.name}`,
          item,
        ]
      )
    ).values(),
  ];
}

function sectionBody(text, sectionName, nextNames) {
  const startPattern =
    new RegExp(
      `\\b${sectionName}:\\s*\\{`,
      "m"
    );

  const startMatch =
    startPattern.exec(text);

  if (!startMatch) {
    return "";
  }

  const start =
    startMatch.index +
    startMatch[0].length;

  let end =
    text.length;

  for (const nextName of nextNames) {
    const nextPattern =
      new RegExp(
        `\\n\\s*${nextName}:\\s*\\{`,
        "m"
      );

    const slice =
      text.slice(start);

    const match =
      nextPattern.exec(slice);

    if (
      match &&
      start + match.index < end
    ) {
      end =
        start + match.index;
    }
  }

  return text.slice(
    start,
    end
  );
}

function extractTopLevelKeys(section) {
  const keys = new Set();

  const lines =
    section.split(/\r?\n/);

  for (const line of lines) {
    const match =
      line.match(
        /^\s{6}([A-Za-z_][A-Za-z0-9_]*):\s*\{/
      );

    if (match) {
      keys.add(
        normalizeName(
          match[1]
        )
      );
    }
  }

  return [
    ...keys
  ].sort();
}

function tail(value, count = 25) {
  return String(value ?? "")
    .split(/\r?\n/)
    .slice(-count)
    .join("\n")
    .trim();
}

fs.mkdirSync(
  path.dirname(typesFile),
  {
    recursive: true,
  }
);

const gen =
  runSupabase([
    "gen",
    "types",
    "typescript",
    "--linked",
    "--schema",
    "public",
  ]);

const typesText =
  String(gen.stdout ?? "");

const genSucceeded =
  gen.status === 0 &&
  /public:\s*\{/m.test(
    typesText
  );

if (!genSucceeded) {
  const failure = {
    status:
      "ALPHA_V3_REMOTE_SCHEMA_API_AUDIT_TYPES_FAILED",

    exitCode:
      gen.status,

    signal:
      gen.signal ?? null,

    error:
      gen.error
        ? String(
            gen.error.message ??
            gen.error
          )
        : null,

    stdoutTail:
      tail(
        gen.stdout,
        25
      ),

    stderrTail:
      tail(
        gen.stderr,
        25
      ),

    safety: {
      databaseReads: 0,
      databaseWrites: 0,
      migrationsApplied: 0,
      migrationHistoryChanged: false,
    },

    nextGate:
      "REVIEW_GEN_TYPES_REMOTE_FAILURE",
  };

  fs.writeFileSync(
    reportFile,
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

  process.exitCode = 2;
  return;
}

fs.writeFileSync(
  typesFile,
  typesText,
  "utf8"
);

const tables =
  extractTopLevelKeys(
    sectionBody(
      typesText,
      "Tables",
      [
        "Views",
        "Functions",
        "Enums",
        "CompositeTypes",
      ]
    )
  );

const views =
  extractTopLevelKeys(
    sectionBody(
      typesText,
      "Views",
      [
        "Functions",
        "Enums",
        "CompositeTypes",
      ]
    )
  );

const functions =
  extractTopLevelKeys(
    sectionBody(
      typesText,
      "Functions",
      [
        "Enums",
        "CompositeTypes",
      ]
    )
  );

const remoteSets = {
  table:
    new Set(tables),
  view:
    new Set(views),
  function:
    new Set(functions),
};

const migrationFiles =
  fs.readdirSync(
    migrationsDir
  )
    .filter(
      (name) =>
        name.endsWith(".sql")
    )
    .sort();

const rows = [];

for (const name of migrationFiles) {
  const sql =
    fs.readFileSync(
      path.join(
        migrationsDir,
        name
      ),
      "utf8"
    );

  const signatures =
    extractMigrationSignatures(
      sql
    );

  const matched =
    signatures.filter(
      (signature) =>
        remoteSets[
          signature.kind
        ]?.has(
          signature.name
        )
    );

  const missing =
    signatures.filter(
      (signature) =>
        !remoteSets[
          signature.kind
        ]?.has(
          signature.name
        )
    );

  rows.push({
    migration:
      name,

    isCommittedRiskTarget:
      name === targetMigration,

    signatureCount:
      signatures.length,

    matchedCount:
      matched.length,

    missingCount:
      missing.length,

    coverage:
      signatures.length > 0
        ? matched.length /
          signatures.length
        : null,

    signatures,

    missing,

    status:
      name === targetMigration
        ? (
            signatures.length > 0 &&
            missing.length === signatures.length
              ? "TARGET_NOT_APPLIED_EXPECTED"
              : missing.length === 0 &&
                signatures.length > 0
                ? "TARGET_OBJECTS_ALREADY_PRESENT_REVIEW"
                : "TARGET_PARTIALLY_PRESENT_REVIEW"
          )
        : signatures.length === 0
          ? "NO_API_SCHEMA_SIGNATURES_REVIEW"
          : missing.length === 0
            ? "API_SCHEMA_SIGNATURES_PRESENT"
            : "API_SCHEMA_SIGNATURES_MISSING",
  });
}

const historical =
  rows.filter(
    (row) =>
      !row.isCommittedRiskTarget
  );

const withSignatures =
  historical.filter(
    (row) =>
      row.signatureCount > 0
  );

const fullyMatched =
  withSignatures.filter(
    (row) =>
      row.missingCount === 0
  );

const missingRows =
  withSignatures.filter(
    (row) =>
      row.missingCount > 0
  );

const noSignature =
  historical.filter(
    (row) =>
      row.signatureCount === 0
  );

const target =
  rows.find(
    (row) =>
      row.isCommittedRiskTarget
  ) ?? null;

const report = {
  status:
    "ALPHA_V3_REMOTE_SCHEMA_API_AUDIT_COMPLETE",

  source:
    "SUPABASE_GEN_TYPES_LINKED",

  remoteObjects: {
    tables:
      tables.length,

    views:
      views.length,

    functions:
      functions.length,
  },

  counts: {
    localMigrationFiles:
      rows.length,

    historicalMigrationFiles:
      historical.length,

    historicalWithApiSchemaSignatures:
      withSignatures.length,

    historicalFullyMatched:
      fullyMatched.length,

    historicalWithMissingSignatures:
      missingRows.length,

    historicalNoApiSchemaSignatures:
      noSignature.length,
  },

  historicalApiSchemaCoverageRate:
    withSignatures.length > 0
      ? fullyMatched.length /
        withSignatures.length
      : null,

  missingHistoricalMigrations:
    missingRows.map(
      (row) => ({
        migration:
          row.migration,
        missing:
          row.missing,
      })
    ),

  noApiSchemaSignatureMigrations:
    noSignature.map(
      (row) =>
        row.migration
    ),

  committedRiskTarget:
    target,

  rows,

  decision: {
    safeToBlindlyRepairAllHistory:
      false,

    nextGate:
      missingRows.length === 0
        ? "BUILD_CONSERVATIVE_MIGRATION_HISTORY_REPAIR_PLAN"
        : "REVIEW_REMOTE_SCHEMA_DRIFT_BEFORE_HISTORY_REPAIR",
  },

  safety: {
    databaseReads: 1,
    databaseWrites: 0,
    migrationsApplied: 0,
    migrationHistoryChanged: false,
    ordersCreated: 0,
    positionsChanged: 0,
  },

  files: {
    generatedTypes:
      "logs/alpha-v3-remote-database-types.ts",

    report:
      "logs/alpha-v3-remote-schema-api-audit.json",
  },
};

fs.writeFileSync(
  reportFile,
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

      source:
        report.source,

      remoteObjects:
        report.remoteObjects,

      counts:
        report.counts,

      historicalApiSchemaCoverageRate:
        report.historicalApiSchemaCoverageRate,

      missingHistoricalMigrations:
        report.missingHistoricalMigrations,

      noApiSchemaSignatureMigrations:
        report.noApiSchemaSignatureMigrations,

      committedRiskTargetStatus:
        report.committedRiskTarget
          ?.status ??
        null,

      safeToBlindlyRepairAllHistory:
        false,

      nextGate:
        report.decision.nextGate,

      reportFile:
        report.files.report,
    },
    null,
    2
  )
);
