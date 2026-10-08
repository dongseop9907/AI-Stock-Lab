const fs = require("fs");
const path = require("path");

const target = path.resolve(
  process.cwd(),
  "scripts/alpha-v3-gap-slippage-db-apply-mechanism-probe-v1.cjs"
);

fs.mkdirSync(
  path.dirname(target),
  { recursive: true }
);

fs.writeFileSync(
  target,
  "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nconst candidates = [\n  \"scripts/alpha-v3-committed-risk-db-apply-and-verify.cjs\",\n  \"scripts/alpha-v3-fill-transition-lock-db-apply.cjs\",\n  \"scripts/alpha-v3-fill-lock-order-apply-and-stress.cjs\",\n  \"scripts/alpha-v3-committed-risk-expiry-reconciliation-v2-verify.cjs\",\n  \"package.json\",\n  \".env.local\",\n  \".env.example\",\n];\n\nconst sensitiveValuePattern =\n  /(password|secret|token|apikey|api_key|service_role|database_url|postgres|db_url)/i;\n\nfunction inspectSource(rel, text) {\n  const lines = text.split(/\\r?\\n/);\n\n  const mechanisms = {\n    requiresPg:\n      /require\\([\"']pg[\"']\\)|from\\s+[\"']pg[\"']/i.test(text),\n\n    requiresPostgres:\n      /require\\([\"']postgres[\"']\\)|from\\s+[\"']postgres[\"']/i.test(text),\n\n    usesSupabaseCli:\n      /supabase(\\.cmd)?[\"']?\\s*,?\\s*\\[?[^\\n]{0,120}(db|migration)/i.test(text) ||\n      /supabase\\s+db\\s+(push|reset|execute)/i.test(text),\n\n    usesPsql:\n      /\\bpsql\\b/i.test(text),\n\n    usesSpawn:\n      /spawnSync|execFileSync|execSync|spawn\\(/.test(text),\n\n    usesProcessEnv:\n      /process\\.env\\./.test(text),\n\n    readsEnvLocal:\n      /\\.env\\.local/.test(text),\n\n    executesSqlText:\n      /\\.query\\(|unsafe\\(|execute\\(|sqlText|migrationSql|readFileSync\\([^\\)]*\\.sql/i.test(text),\n  };\n\n  const envNames = [\n    ...new Set(\n      [...text.matchAll(/process\\.env\\.([A-Z0-9_]+)/g)]\n        .map((match) => match[1])\n    ),\n  ].filter((name) =>\n    /DB|DATABASE|POSTGRES|SUPABASE|PG/i.test(name)\n  );\n\n  const relevant = [];\n\n  for (let i = 0; i < lines.length; i += 1) {\n    const line = lines[i];\n\n    if (\n      /\\b(pg|postgres|psql|supabase)\\b|spawnSync|execSync|execFileSync|\\.query\\(|process\\.env\\.|migration/i.test(line)\n    ) {\n      let safe = line.trim();\n\n      if (sensitiveValuePattern.test(safe) && /=/.test(safe)) {\n        safe = safe.replace(/=(.*)$/g, \"=<REDACTED_OR_EXPRESSION>\");\n      }\n\n      relevant.push({\n        line: i + 1,\n        text: safe.slice(0, 240),\n      });\n    }\n  }\n\n  return {\n    mechanisms,\n    envNames,\n    relevant: relevant.slice(0, 40),\n  };\n}\n\nconst files = [];\n\nfor (const rel of candidates) {\n  const abs = path.resolve(root, rel);\n\n  if (!fs.existsSync(abs)) {\n    files.push({\n      file: rel,\n      exists: false,\n    });\n    continue;\n  }\n\n  if (rel === \".env.local\") {\n    const text = fs.readFileSync(abs, \"utf8\");\n    const envNames = text\n      .split(/\\r?\\n/)\n      .map((line) => line.trim())\n      .filter((line) => line && !line.startsWith(\"#\") && line.includes(\"=\"))\n      .map((line) => line.split(\"=\", 1)[0].trim())\n      .filter((name) => /DB|DATABASE|POSTGRES|SUPABASE|PG/i.test(name));\n\n    files.push({\n      file: rel,\n      exists: true,\n      envNamesOnly: [...new Set(envNames)],\n    });\n\n    continue;\n  }\n\n  const text = fs.readFileSync(abs, \"utf8\");\n\n  files.push({\n    file: rel,\n    exists: true,\n    analysis: inspectSource(rel, text),\n  });\n}\n\nconst existingApplyScripts = files.filter(\n  (row) =>\n    row.exists &&\n    row.file.startsWith(\"scripts/\") &&\n    row.file.includes(\"apply\"),\n);\n\nconst mechanismScore = {\n  pg:\n    existingApplyScripts.filter(\n      (row) => row.analysis?.mechanisms?.requiresPg,\n    ).length,\n\n  postgres:\n    existingApplyScripts.filter(\n      (row) => row.analysis?.mechanisms?.requiresPostgres,\n    ).length,\n\n  supabaseCli:\n    existingApplyScripts.filter(\n      (row) => row.analysis?.mechanisms?.usesSupabaseCli,\n    ).length,\n\n  psql:\n    existingApplyScripts.filter(\n      (row) => row.analysis?.mechanisms?.usesPsql,\n    ).length,\n};\n\nconst preferredMechanism =\n  mechanismScore.pg > 0\n    ? \"PG_NODE_CLIENT\"\n    : mechanismScore.postgres > 0\n      ? \"POSTGRES_NODE_CLIENT\"\n      : mechanismScore.supabaseCli > 0\n        ? \"SUPABASE_CLI\"\n        : mechanismScore.psql > 0\n          ? \"PSQL\"\n          : \"UNRESOLVED\";\n\nconst report = {\n  status:\n    \"ALPHA_V3_GAP_SLIPPAGE_DB_APPLY_MECHANISM_PROBE_V1_COMPLETE\",\n\n  preferredMechanism,\n\n  mechanismScore,\n\n  files,\n\n  targetMigration:\n    \"supabase/migrations/20261008001800_gap_slippage_execution_binding_v1.sql\",\n\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    networkCalls: 0,\n    ordersCreated: 0,\n    positionsChanged: 0,\n    secretsPrinted: false,\n  },\n\n  fullLogFile:\n    \"logs/alpha-v3-gap-slippage-db-apply-mechanism-probe-v1.json\",\n\n  nextGate:\n    preferredMechanism === \"UNRESOLVED\"\n      ? \"REVIEW_LOCAL_DB_APPLY_MECHANISM\"\n      : \"BUILD_01800_APPLY_AND_NO_ORDER_REGRESSION_USING_EXISTING_MECHANISM\",\n};\n\nfs.mkdirSync(\n  path.resolve(root, \"logs\"),\n  { recursive: true },\n);\n\nfs.writeFileSync(\n  path.resolve(root, report.fullLogFile),\n  JSON.stringify(report, null, 2) + \"\\n\",\n  \"utf8\",\n);\n\nconsole.log(\n  JSON.stringify(\n    {\n      status: report.status,\n      preferredMechanism,\n      mechanismScore,\n      existingApplyScripts:\n        existingApplyScripts.map((row) => ({\n          file: row.file,\n          mechanisms: row.analysis.mechanisms,\n          envNames: row.analysis.envNames,\n        })),\n      targetMigration: report.targetMigration,\n      safety: report.safety,\n      fullLogFile: report.fullLogFile,\n      nextGate: report.nextGate,\n    },\n    null,\n    2,\n  ),\n);\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_GAP_SLIPPAGE_DB_APPLY_MECHANISM_PROBE_V1_INSTALLED",

      generatedFile:
        "scripts/alpha-v3-gap-slippage-db-apply-mechanism-probe-v1.cjs",

      consoleMode:
        "COMPACT",

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        networkCalls: 0,
        ordersCreated: 0,
        positionsChanged: 0,
        secretsPrinted: false
      },

      nextAction:
        "RUN_DB_APPLY_MECHANISM_PROBE"
    },
    null,
    2
  )
);
