const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = process.cwd();
const migrationsDir =
  path.resolve(root, "supabase/migrations");

const cli =
  path.resolve(
    root,
    "node_modules/.bin/supabase.cmd"
  );

const targetMigration =
  "20261008000100_committed_risk_reservation_v3.sql";

const dumpFile =
  path.resolve(
    root,
    "logs/alpha-v3-remote-public-schema.sql"
  );

const reportFile =
  path.resolve(
    root,
    "logs/alpha-v3-remote-migration-baseline-audit.json"
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

  if (process.platform === "win32") {
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
        timeout: 300000,
        maxBuffer: 30 * 1024 * 1024,
      }
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
      timeout: 300000,
      maxBuffer: 30 * 1024 * 1024,
    }
  );
}

function normalizeName(value) {
  return String(value)
    .replace(/"/g, "")
    .trim()
    .toLowerCase();
}

function extractSignatures(sql) {
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
    {
      kind: "materialized_view",
      regex:
        /create\s+materialized\s+view\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-zA-Z_][\w$]*)"?/ig,
    },
    {
      kind: "index",
      regex:
        /create\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?"?([a-zA-Z_][\w$]*)"?/ig,
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

function remoteContains(remoteSql, signature) {
  const escaped =
    signature.name.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );

  const publicPrefix =
    '(?:public\\.)?"?';

  const suffix =
    '"?\\b';

  let pattern;

  if (signature.kind === "table") {
    pattern =
      `create\\s+table\\s+${publicPrefix}${escaped}${suffix}`;
  } else if (signature.kind === "function") {
    pattern =
      `create\\s+(?:or\\s+replace\\s+)?function\\s+${publicPrefix}${escaped}${suffix}`;
  } else if (signature.kind === "view") {
    pattern =
      `create\\s+(?:or\\s+replace\\s+)?view\\s+${publicPrefix}${escaped}${suffix}`;
  } else if (
    signature.kind ===
    "materialized_view"
  ) {
    pattern =
      `create\\s+materialized\\s+view\\s+${publicPrefix}${escaped}${suffix}`;
  } else if (signature.kind === "index") {
    pattern =
      `create\\s+(?:unique\\s+)?index\\s+"?${escaped}"?\\b`;
  } else {
    return false;
  }

  return new RegExp(
    pattern,
    "i"
  ).test(remoteSql);
}

function tail(value, count = 30) {
  return String(value ?? "")
    .split(/\r?\n/)
    .slice(-count)
    .join("\n")
    .trim();
}

fs.mkdirSync(
  path.dirname(dumpFile),
  {
    recursive: true,
  }
);

if (fs.existsSync(dumpFile)) {
  fs.rmSync(
    dumpFile,
    {
      force: true,
    }
  );
}

const dump =
  runSupabase([
    "db",
    "dump",
    "--linked",
    "--schema",
    "public",
    "--file",
    dumpFile,
  ]);

const dumpSucceeded =
  dump.status === 0 &&
  fs.existsSync(dumpFile) &&
  fs.statSync(dumpFile).size > 0;

if (!dumpSucceeded) {
  const stderr =
    String(dump.stderr ?? "");

  const stdout =
    String(dump.stdout ?? "");

  const combined =
    `${stdout}\n${stderr}`;

  const dockerLikely =
    /docker|container|image|daemon/i.test(
      combined
    );

  const authLikely =
    /password|authentication|permission|login|access denied/i.test(
      combined
    );

  const failure = {
    status:
      "ALPHA_V3_REMOTE_MIGRATION_BASELINE_AUDIT_DUMP_FAILED",

    executionMode:
      process.platform === "win32"
        ? "WINDOWS_CMD_WRAPPER"
        : "DIRECT_EXEC",

    dumpExitCode:
      dump.status,

    dumpSignal:
      dump.signal ?? null,

    dumpError:
      dump.error
        ? String(
            dump.error.message ??
            dump.error
          )
        : null,

    likelyCause:
      dockerLikely
        ? "DOCKER_OR_CONTAINER_RUNTIME_REQUIRED_OR_UNAVAILABLE"
        : authLikely
          ? "REMOTE_DB_AUTH_OR_PERMISSION"
          : "REVIEW_CLI_OUTPUT",

    stdoutTail:
      tail(stdout, 30),

    stderrTail:
      tail(stderr, 30),

    safety: {
      databaseReads: 0,
      databaseWrites: 0,
      migrationsApplied: 0,
      migrationHistoryChanged: false,
    },

    nextGate:
      dockerLikely
        ? "USE_NON_DOCKER_REMOTE_SCHEMA_AUDIT_PATH"
        : "REVIEW_REMOTE_SCHEMA_DUMP_FAILURE",
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

const remoteSql =
  fs.readFileSync(
    dumpFile,
    "utf8"
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
    extractSignatures(sql);

  const matched =
    signatures.filter(
      (signature) =>
        remoteContains(
          remoteSql,
          signature
        )
    );

  const missing =
    signatures.filter(
      (signature) =>
        !remoteContains(
          remoteSql,
          signature
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

    missing,

    status:
      name === targetMigration
        ? (
            matched.length === 0
              ? "TARGET_NOT_APPLIED_EXPECTED"
              : "TARGET_ALREADY_PRESENT_REVIEW"
          )
        : signatures.length === 0
          ? "NO_SCHEMA_SIGNATURES_REVIEW"
          : missing.length === 0
            ? "SCHEMA_SIGNATURES_PRESENT"
            : "SCHEMA_SIGNATURES_MISSING",
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

const partiallyOrMissing =
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
    "ALPHA_V3_REMOTE_MIGRATION_BASELINE_AUDIT_COMPLETE",

  executionMode:
    process.platform === "win32"
      ? "WINDOWS_CMD_WRAPPER"
      : "DIRECT_EXEC",

  dump: {
    schema:
      "public",

    file:
      "logs/alpha-v3-remote-public-schema.sql",

    bytes:
      Buffer.byteLength(
        remoteSql,
        "utf8"
      ),

    databaseWrites:
      0,
  },

  counts: {
    localMigrationFiles:
      rows.length,

    historicalMigrationFiles:
      historical.length,

    historicalWithSchemaSignatures:
      withSignatures.length,

    historicalFullyMatched:
      fullyMatched.length,

    historicalWithMissingSignatures:
      partiallyOrMissing.length,

    historicalNoSchemaSignatures:
      noSignature.length,
  },

  historicalSchemaCoverageRate:
    withSignatures.length > 0
      ? fullyMatched.length /
        withSignatures.length
      : null,

  missingHistoricalMigrations:
    partiallyOrMissing.map(
      (row) => ({
        migration:
          row.migration,
        missing:
          row.missing,
      })
    ),

  noSchemaSignatureMigrations:
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
      partiallyOrMissing.length === 0
        ? "REVIEW_DML_ONLY_MIGRATIONS_THEN_BUILD_HISTORY_REPAIR_PLAN"
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

  outputFile:
    "logs/alpha-v3-remote-migration-baseline-audit.json",
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

      executionMode:
        report.executionMode,

      counts:
        report.counts,

      historicalSchemaCoverageRate:
        report.historicalSchemaCoverageRate,

      missingHistoricalMigrations:
        report.missingHistoricalMigrations,

      noSchemaSignatureMigrations:
        report.noSchemaSignatureMigrations,

      committedRiskTargetStatus:
        report.committedRiskTarget
          ?.status ??
        null,

      safeToBlindlyRepairAllHistory:
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
