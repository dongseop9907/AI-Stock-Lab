const fs = require("fs");
const path = require("path");

const target = path.resolve(
  process.cwd(),
  "scripts/alpha-v3-committed-risk-db-apply-readiness.cjs"
);

fs.mkdirSync(
  path.dirname(target),
  { recursive: true }
);

fs.writeFileSync(
  target,
  "const fs = require(\"fs\");\nconst path = require(\"path\");\nconst { spawnSync } = require(\"child_process\");\n\nconst root = process.cwd();\nconst logFile = path.resolve(\n  root,\n  \"logs/alpha-v3-committed-risk-db-apply-readiness.json\"\n);\n\nfunction exists(rel) {\n  return fs.existsSync(path.resolve(root, rel));\n}\n\nfunction readEnvNames(rel) {\n  const file = path.resolve(root, rel);\n\n  if (!fs.existsSync(file)) {\n    return [];\n  }\n\n  return fs\n    .readFileSync(file, \"utf8\")\n    .split(/\\r?\\n/)\n    .map((line) => line.trim())\n    .filter(\n      (line) =>\n        line &&\n        !line.startsWith(\"#\") &&\n        line.includes(\"=\")\n    )\n    .map((line) => line.split(\"=\", 1)[0].trim())\n    .filter(Boolean);\n}\n\nfunction run(command, args) {\n  const result = spawnSync(\n    command,\n    args,\n    {\n      cwd: root,\n      encoding: \"utf8\",\n      windowsHide: true,\n      timeout: 45000,\n      env: process.env,\n    }\n  );\n\n  return {\n    command: [command, ...args].join(\" \"),\n    status: result.status,\n    signal: result.signal,\n    stdout: String(result.stdout ?? \"\"),\n    stderr: String(result.stderr ?? \"\"),\n    error: result.error\n      ? String(result.error.message ?? result.error)\n      : null,\n  };\n}\n\nfunction tail(text, maxLines = 30) {\n  return String(text)\n    .split(/\\r?\\n/)\n    .slice(-maxLines)\n    .join(\"\\n\")\n    .trim();\n}\n\nconst migrationDir = path.resolve(\n  root,\n  \"supabase/migrations\"\n);\n\nconst migrations =\n  fs.existsSync(migrationDir)\n    ? fs\n        .readdirSync(migrationDir)\n        .filter((name) => name.endsWith(\".sql\"))\n        .sort()\n    : [];\n\nconst targetMigration =\n  \"052_committed_risk_reservation_v3.sql\";\n\nconst envNames = [\n  ...new Set([\n    ...readEnvNames(\".env\"),\n    ...readEnvNames(\".env.local\"),\n  ]),\n].sort();\n\nconst dbUrlNames = envNames.filter((name) =>\n  /^(DATABASE_URL|DIRECT_URL|POSTGRES_URL|SUPABASE_DB_URL|DB_URL)$/i.test(name)\n);\n\nconst supabaseCredentialNames = envNames.filter((name) =>\n  /^(SUPABASE_ACCESS_TOKEN|NEXT_PUBLIC_SUPABASE_URL|SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)$/i.test(name)\n);\n\nconst localCli = path.resolve(\n  root,\n  \"node_modules/.bin/supabase.cmd\"\n);\n\nconst globalNpx =\n  process.platform === \"win32\"\n    ? path.join(\n        path.dirname(process.execPath),\n        \"npx.cmd\"\n      )\n    : \"npx\";\n\nlet cliProbe;\n\nif (fs.existsSync(localCli)) {\n  cliProbe = run(localCli, [\"--version\"]);\n} else {\n  cliProbe = run(\n    globalNpx,\n    [\"--no-install\", \"supabase\", \"--version\"]\n  );\n}\n\nconst cliAvailable =\n  cliProbe.status === 0;\n\nlet migrationList = null;\n\nif (\n  cliAvailable &&\n  exists(\"supabase/config.toml\")\n) {\n  const cliCommand =\n    fs.existsSync(localCli)\n      ? localCli\n      : globalNpx;\n\n  const cliArgs =\n    fs.existsSync(localCli)\n      ? [\"migration\", \"list\"]\n      : [\n          \"--no-install\",\n          \"supabase\",\n          \"migration\",\n          \"list\",\n        ];\n\n  migrationList = run(\n    cliCommand,\n    cliArgs\n  );\n}\n\nconst migrationListText =\n  migrationList\n    ? `${migrationList.stdout}\\n${migrationList.stderr}`\n    : \"\";\n\nconst targetMentionedRemotely =\n  /\\b052\\b/.test(migrationListText) ||\n  /052_committed_risk_reservation_v3/i.test(\n    migrationListText\n  );\n\nconst hasDbUrl =\n  dbUrlNames.length > 0;\n\nconst configExists =\n  exists(\"supabase/config.toml\");\n\nconst report = {\n  status:\n    \"ALPHA_V3_COMMITTED_RISK_DB_APPLY_READINESS_COMPLETE\",\n\n  targetMigration,\n  targetMigrationExists:\n    migrations.includes(targetMigration),\n\n  localMigrationCount:\n    migrations.length,\n\n  latestLocalMigrations:\n    migrations.slice(-8),\n\n  supabase: {\n    configExists,\n\n    cliAvailable,\n\n    cliVersion:\n      cliAvailable\n        ? tail(cliProbe.stdout || cliProbe.stderr, 3)\n        : null,\n\n    migrationListAttempted:\n      Boolean(migrationList),\n\n    migrationListSucceeded:\n      migrationList?.status === 0,\n\n    migrationListTail:\n      migrationList\n        ? tail(migrationListText, 35)\n        : null,\n\n    targetMigrationMentionedInMigrationList:\n      targetMentionedRemotely,\n  },\n\n  environment: {\n    hasDirectDatabaseUrl:\n      hasDbUrl,\n\n    directDatabaseUrlVariableNames:\n      dbUrlNames,\n\n    supabaseVariableNames:\n      supabaseCredentialNames,\n\n    secretValuesPrinted:\n      false,\n  },\n\n  decision: {\n    preferredApplyMode:\n      cliAvailable &&\n      configExists &&\n      migrationList?.status === 0\n        ? \"SUPABASE_CLI_AFTER_REVIEWING_PENDING_LIST\"\n        : hasDbUrl\n          ? \"DIRECT_DB_CONNECTION_IF_CLIENT_AVAILABLE\"\n          : \"SUPABASE_SQL_EDITOR_OR_LINK_PROJECT_FIRST\",\n\n    safeToAutoPushNow:\n      false,\n\n    reason:\n      \"REMOTE_PENDING_SET_MUST_BE_REVIEWED_BEFORE_ANY_WRITE\",\n\n    nextGate:\n      migrationList?.status === 0\n        ? \"REVIEW_REMOTE_PENDING_MIGRATIONS_BEFORE_APPLY\"\n        : \"ESTABLISH_SAFE_DB_APPLY_PATH\",\n  },\n\n  safety: {\n    databaseReads:\n      migrationList?.status === 0 ? 1 : 0,\n\n    databaseWrites: 0,\n    migrationsApplied: 0,\n    ordersCreated: 0,\n    positionsChanged: 0,\n    productionChanged: false,\n  },\n\n  outputFile:\n    \"logs/alpha-v3-committed-risk-db-apply-readiness.json\",\n};\n\nfs.mkdirSync(\n  path.dirname(logFile),\n  { recursive: true }\n);\n\nfs.writeFileSync(\n  logFile,\n  JSON.stringify(report, null, 2) + \"\\n\",\n  \"utf8\"\n);\n\nconsole.log(\n  JSON.stringify(\n    {\n      status:\n        report.status,\n\n      targetMigrationExists:\n        report.targetMigrationExists,\n\n      latestLocalMigrations:\n        report.latestLocalMigrations,\n\n      configExists:\n        report.supabase.configExists,\n\n      cliAvailable:\n        report.supabase.cliAvailable,\n\n      cliVersion:\n        report.supabase.cliVersion,\n\n      migrationListSucceeded:\n        report.supabase.migrationListSucceeded,\n\n      migrationListTail:\n        report.supabase.migrationListTail,\n\n      hasDirectDatabaseUrl:\n        report.environment.hasDirectDatabaseUrl,\n\n      directDatabaseUrlVariableNames:\n        report.environment.directDatabaseUrlVariableNames,\n\n      preferredApplyMode:\n        report.decision.preferredApplyMode,\n\n      safeToAutoPushNow:\n        report.decision.safeToAutoPushNow,\n\n      nextGate:\n        report.decision.nextGate,\n\n      outputFile:\n        report.outputFile,\n    },\n    null,\n    2\n  )\n);\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_COMMITTED_RISK_DB_APPLY_READINESS_INSTALLED",

      generatedFile:
        "scripts/alpha-v3-committed-risk-db-apply-readiness.cjs",

      behavior:
        "READ_ONLY_REMOTE_MIGRATION_STATUS_WHEN_AVAILABLE",

      secretsPrinted:
        false,

      databaseWrites:
        0,

      nextAction:
        "RUN_DB_APPLY_READINESS"
    },
    null,
    2
  )
);
