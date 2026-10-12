const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = process.cwd();
const logFile = path.resolve(
  root,
  "logs/alpha-v3-committed-risk-db-apply-readiness.json"
);

function exists(rel) {
  return fs.existsSync(path.resolve(root, rel));
}

function readEnvNames(rel) {
  const file = path.resolve(root, rel);

  if (!fs.existsSync(file)) {
    return [];
  }

  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line &&
        !line.startsWith("#") &&
        line.includes("=")
    )
    .map((line) => line.split("=", 1)[0].trim())
    .filter(Boolean);
}

function run(command, args) {
  const result = spawnSync(
    command,
    args,
    {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      timeout: 45000,
      env: process.env,
    }
  );

  return {
    command: [command, ...args].join(" "),
    status: result.status,
    signal: result.signal,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
    error: result.error
      ? String(result.error.message ?? result.error)
      : null,
  };
}

function tail(text, maxLines = 30) {
  return String(text)
    .split(/\r?\n/)
    .slice(-maxLines)
    .join("\n")
    .trim();
}

const migrationDir = path.resolve(
  root,
  "supabase/migrations"
);

const migrations =
  fs.existsSync(migrationDir)
    ? fs
        .readdirSync(migrationDir)
        .filter((name) => name.endsWith(".sql"))
        .sort()
    : [];

const targetMigration =
  "20261008000100_committed_risk_reservation_v3.sql";

const envNames = [
  ...new Set([
    ...readEnvNames(".env"),
    ...readEnvNames(".env.local"),
  ]),
].sort();

const dbUrlNames = envNames.filter((name) =>
  /^(DATABASE_URL|DIRECT_URL|POSTGRES_URL|SUPABASE_DB_URL|DB_URL)$/i.test(name)
);

const supabaseCredentialNames = envNames.filter((name) =>
  /^(SUPABASE_ACCESS_TOKEN|NEXT_PUBLIC_SUPABASE_URL|SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)$/i.test(name)
);

const localCli = path.resolve(
  root,
  "node_modules/.bin/supabase.cmd"
);

const globalNpx =
  process.platform === "win32"
    ? path.join(
        path.dirname(process.execPath),
        "npx.cmd"
      )
    : "npx";

let cliProbe;

if (fs.existsSync(localCli)) {
  cliProbe = run(localCli, ["--version"]);
} else {
  cliProbe = run(
    globalNpx,
    ["--no-install", "supabase", "--version"]
  );
}

const cliAvailable =
  cliProbe.status === 0;

let migrationList = null;

if (
  cliAvailable &&
  exists("supabase/config.toml")
) {
  const cliCommand =
    fs.existsSync(localCli)
      ? localCli
      : globalNpx;

  const cliArgs =
    fs.existsSync(localCli)
      ? ["migration", "list"]
      : [
          "--no-install",
          "supabase",
          "migration",
          "list",
        ];

  migrationList = run(
    cliCommand,
    cliArgs
  );
}

const migrationListText =
  migrationList
    ? `${migrationList.stdout}\n${migrationList.stderr}`
    : "";

const targetMentionedRemotely =
  /\b052\b/.test(migrationListText) ||
  /052_committed_risk_reservation_v3/i.test(
    migrationListText
  );

const hasDbUrl =
  dbUrlNames.length > 0;

const configExists =
  exists("supabase/config.toml");

const report = {
  status:
    "ALPHA_V3_COMMITTED_RISK_DB_APPLY_READINESS_COMPLETE",

  targetMigration,
  targetMigrationExists:
    migrations.includes(targetMigration),

  localMigrationCount:
    migrations.length,

  latestLocalMigrations:
    migrations.slice(-8),

  supabase: {
    configExists,

    cliAvailable,

    cliVersion:
      cliAvailable
        ? tail(cliProbe.stdout || cliProbe.stderr, 3)
        : null,

    migrationListAttempted:
      Boolean(migrationList),

    migrationListSucceeded:
      migrationList?.status === 0,

    migrationListTail:
      migrationList
        ? tail(migrationListText, 35)
        : null,

    targetMigrationMentionedInMigrationList:
      targetMentionedRemotely,
  },

  environment: {
    hasDirectDatabaseUrl:
      hasDbUrl,

    directDatabaseUrlVariableNames:
      dbUrlNames,

    supabaseVariableNames:
      supabaseCredentialNames,

    secretValuesPrinted:
      false,
  },

  decision: {
    preferredApplyMode:
      cliAvailable &&
      configExists &&
      migrationList?.status === 0
        ? "SUPABASE_CLI_AFTER_REVIEWING_PENDING_LIST"
        : hasDbUrl
          ? "DIRECT_DB_CONNECTION_IF_CLIENT_AVAILABLE"
          : "SUPABASE_SQL_EDITOR_OR_LINK_PROJECT_FIRST",

    safeToAutoPushNow:
      false,

    reason:
      "REMOTE_PENDING_SET_MUST_BE_REVIEWED_BEFORE_ANY_WRITE",

    nextGate:
      migrationList?.status === 0
        ? "REVIEW_REMOTE_PENDING_MIGRATIONS_BEFORE_APPLY"
        : "ESTABLISH_SAFE_DB_APPLY_PATH",
  },

  safety: {
    databaseReads:
      migrationList?.status === 0 ? 1 : 0,

    databaseWrites: 0,
    migrationsApplied: 0,
    ordersCreated: 0,
    positionsChanged: 0,
    productionChanged: false,
  },

  outputFile:
    "logs/alpha-v3-committed-risk-db-apply-readiness.json",
};

fs.mkdirSync(
  path.dirname(logFile),
  { recursive: true }
);

fs.writeFileSync(
  logFile,
  JSON.stringify(report, null, 2) + "\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        report.status,

      targetMigrationExists:
        report.targetMigrationExists,

      latestLocalMigrations:
        report.latestLocalMigrations,

      configExists:
        report.supabase.configExists,

      cliAvailable:
        report.supabase.cliAvailable,

      cliVersion:
        report.supabase.cliVersion,

      migrationListSucceeded:
        report.supabase.migrationListSucceeded,

      migrationListTail:
        report.supabase.migrationListTail,

      hasDirectDatabaseUrl:
        report.environment.hasDirectDatabaseUrl,

      directDatabaseUrlVariableNames:
        report.environment.directDatabaseUrlVariableNames,

      preferredApplyMode:
        report.decision.preferredApplyMode,

      safeToAutoPushNow:
        report.decision.safeToAutoPushNow,

      nextGate:
        report.decision.nextGate,

      outputFile:
        report.outputFile,
    },
    null,
    2
  )
);
