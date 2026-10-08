const fs = require("fs");
const path = require("path");

const root = process.cwd();

const candidates = [
  "scripts/alpha-v3-committed-risk-db-apply-and-verify.cjs",
  "scripts/alpha-v3-fill-transition-lock-db-apply.cjs",
  "scripts/alpha-v3-fill-lock-order-apply-and-stress.cjs",
  "scripts/alpha-v3-committed-risk-expiry-reconciliation-v2-verify.cjs",
  "package.json",
  ".env.local",
  ".env.example",
];

const sensitiveValuePattern =
  /(password|secret|token|apikey|api_key|service_role|database_url|postgres|db_url)/i;

function inspectSource(rel, text) {
  const lines = text.split(/\r?\n/);

  const mechanisms = {
    requiresPg:
      /require\(["']pg["']\)|from\s+["']pg["']/i.test(text),

    requiresPostgres:
      /require\(["']postgres["']\)|from\s+["']postgres["']/i.test(text),

    usesSupabaseCli:
      /supabase(\.cmd)?["']?\s*,?\s*\[?[^\n]{0,120}(db|migration)/i.test(text) ||
      /supabase\s+db\s+(push|reset|execute)/i.test(text),

    usesPsql:
      /\bpsql\b/i.test(text),

    usesSpawn:
      /spawnSync|execFileSync|execSync|spawn\(/.test(text),

    usesProcessEnv:
      /process\.env\./.test(text),

    readsEnvLocal:
      /\.env\.local/.test(text),

    executesSqlText:
      /\.query\(|unsafe\(|execute\(|sqlText|migrationSql|readFileSync\([^\)]*\.sql/i.test(text),
  };

  const envNames = [
    ...new Set(
      [...text.matchAll(/process\.env\.([A-Z0-9_]+)/g)]
        .map((match) => match[1])
    ),
  ].filter((name) =>
    /DB|DATABASE|POSTGRES|SUPABASE|PG/i.test(name)
  );

  const relevant = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (
      /\b(pg|postgres|psql|supabase)\b|spawnSync|execSync|execFileSync|\.query\(|process\.env\.|migration/i.test(line)
    ) {
      let safe = line.trim();

      if (sensitiveValuePattern.test(safe) && /=/.test(safe)) {
        safe = safe.replace(/=(.*)$/g, "=<REDACTED_OR_EXPRESSION>");
      }

      relevant.push({
        line: i + 1,
        text: safe.slice(0, 240),
      });
    }
  }

  return {
    mechanisms,
    envNames,
    relevant: relevant.slice(0, 40),
  };
}

const files = [];

for (const rel of candidates) {
  const abs = path.resolve(root, rel);

  if (!fs.existsSync(abs)) {
    files.push({
      file: rel,
      exists: false,
    });
    continue;
  }

  if (rel === ".env.local") {
    const text = fs.readFileSync(abs, "utf8");
    const envNames = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => line.split("=", 1)[0].trim())
      .filter((name) => /DB|DATABASE|POSTGRES|SUPABASE|PG/i.test(name));

    files.push({
      file: rel,
      exists: true,
      envNamesOnly: [...new Set(envNames)],
    });

    continue;
  }

  const text = fs.readFileSync(abs, "utf8");

  files.push({
    file: rel,
    exists: true,
    analysis: inspectSource(rel, text),
  });
}

const existingApplyScripts = files.filter(
  (row) =>
    row.exists &&
    row.file.startsWith("scripts/") &&
    row.file.includes("apply"),
);

const mechanismScore = {
  pg:
    existingApplyScripts.filter(
      (row) => row.analysis?.mechanisms?.requiresPg,
    ).length,

  postgres:
    existingApplyScripts.filter(
      (row) => row.analysis?.mechanisms?.requiresPostgres,
    ).length,

  supabaseCli:
    existingApplyScripts.filter(
      (row) => row.analysis?.mechanisms?.usesSupabaseCli,
    ).length,

  psql:
    existingApplyScripts.filter(
      (row) => row.analysis?.mechanisms?.usesPsql,
    ).length,
};

const preferredMechanism =
  mechanismScore.pg > 0
    ? "PG_NODE_CLIENT"
    : mechanismScore.postgres > 0
      ? "POSTGRES_NODE_CLIENT"
      : mechanismScore.supabaseCli > 0
        ? "SUPABASE_CLI"
        : mechanismScore.psql > 0
          ? "PSQL"
          : "UNRESOLVED";

const report = {
  status:
    "ALPHA_V3_GAP_SLIPPAGE_DB_APPLY_MECHANISM_PROBE_V1_COMPLETE",

  preferredMechanism,

  mechanismScore,

  files,

  targetMigration:
    "supabase/migrations/20261008001800_gap_slippage_execution_binding_v1.sql",

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    networkCalls: 0,
    ordersCreated: 0,
    positionsChanged: 0,
    secretsPrinted: false,
  },

  fullLogFile:
    "logs/alpha-v3-gap-slippage-db-apply-mechanism-probe-v1.json",

  nextGate:
    preferredMechanism === "UNRESOLVED"
      ? "REVIEW_LOCAL_DB_APPLY_MECHANISM"
      : "BUILD_01800_APPLY_AND_NO_ORDER_REGRESSION_USING_EXISTING_MECHANISM",
};

fs.mkdirSync(
  path.resolve(root, "logs"),
  { recursive: true },
);

fs.writeFileSync(
  path.resolve(root, report.fullLogFile),
  JSON.stringify(report, null, 2) + "\n",
  "utf8",
);

console.log(
  JSON.stringify(
    {
      status: report.status,
      preferredMechanism,
      mechanismScore,
      existingApplyScripts:
        existingApplyScripts.map((row) => ({
          file: row.file,
          mechanisms: row.analysis.mechanisms,
          envNames: row.analysis.envNames,
        })),
      targetMigration: report.targetMigration,
      safety: report.safety,
      fullLogFile: report.fullLogFile,
      nextGate: report.nextGate,
    },
    null,
    2,
  ),
);
