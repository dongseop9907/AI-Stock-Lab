const fs = require("fs");
const path = require("path");

const target =
  path.resolve(
    process.cwd(),
    "scripts/alpha-v3-db-freshness-create-fill-binding-probe-v1.cjs"
  );

fs.mkdirSync(
  path.dirname(target),
  { recursive: true }
);

fs.writeFileSync(
  target,
  "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\nconst migrationDir = path.resolve(root, \"supabase/migrations\");\n\nconst targetFunctions = [\n  \"create_paper_buy_order_with_committed_risk_v3\",\n  \"execute_paper_buy_order\"\n];\n\nconst freshnessTables = [\n  \"market_data_freshness_observations\",\n  \"market_data_quality_gate_observations\"\n];\n\nfunction walkSql(dir) {\n  if (!fs.existsSync(dir)) return [];\n\n  return fs.readdirSync(dir)\n    .filter((name) => name.endsWith(\".sql\"))\n    .sort()\n    .map((name) => ({\n      name,\n      rel: `supabase/migrations/${name}`,\n      abs: path.join(dir, name),\n      text: fs.readFileSync(path.join(dir, name), \"utf8\")\n    }));\n}\n\nfunction extractFunction(sql, fnName) {\n  const re = new RegExp(\n    String.raw`create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\.)?${fnName}\\s*\\(`,\n    \"i\"\n  );\n\n  const match = re.exec(sql);\n\n  if (!match) return null;\n\n  const start = match.index;\n  const after = sql.slice(start);\n\n  const dollarMatch =\n    after.match(/\\bas\\s+(\\$[A-Za-z0-9_]*\\$)/i);\n\n  if (!dollarMatch) {\n    const nextCreate =\n      after.slice(1).search(\n        /\\ncreate\\s+(?:or\\s+replace\\s+)?function\\s+/i\n      );\n\n    return nextCreate >= 0\n      ? after.slice(0, nextCreate + 1).trim()\n      : after.trim();\n  }\n\n  const tag = dollarMatch[1];\n  const bodyStart =\n    start +\n    dollarMatch.index +\n    dollarMatch[0].length;\n\n  const closeIndex =\n    sql.indexOf(tag, bodyStart);\n\n  if (closeIndex < 0) {\n    return after.trim();\n  }\n\n  const semicolon =\n    sql.indexOf(\";\", closeIndex + tag.length);\n\n  return sql.slice(\n    start,\n    semicolon >= 0\n      ? semicolon + 1\n      : closeIndex + tag.length\n  ).trim();\n}\n\nfunction extractCreateTable(sql, table) {\n  const re = new RegExp(\n    String.raw`create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?(?:public\\.)?${table}\\s*\\(`,\n    \"i\"\n  );\n\n  const match = re.exec(sql);\n  if (!match) return null;\n\n  const start = match.index;\n  const open = sql.indexOf(\"(\", start);\n\n  let depth = 0;\n  let close = -1;\n\n  for (let i = open; i < sql.length; i += 1) {\n    if (sql[i] === \"(\") depth += 1;\n    if (sql[i] === \")\") {\n      depth -= 1;\n      if (depth === 0) {\n        close = i;\n        break;\n      }\n    }\n  }\n\n  if (close < 0) return null;\n\n  const semicolon = sql.indexOf(\";\", close);\n\n  return sql.slice(\n    start,\n    semicolon >= 0 ? semicolon + 1 : close + 1\n  ).trim();\n}\n\nfunction conciseFunctionFacts(text) {\n  if (!text) return null;\n\n  const lines = text.split(/\\r?\\n/);\n\n  return {\n    signature:\n      lines\n        .slice(0, Math.min(lines.length, 18))\n        .join(\"\\n\"),\n\n    hasKillSwitchAssert:\n      /assert_paper_buy_new_risk_allowed_v1/i.test(text),\n\n    hasAdvisoryLock:\n      /advisory.*lock|pg_advisory/i.test(text),\n\n    hasCommittedRisk:\n      /committed.*risk|reserved.*risk|risk_reservation/i.test(text),\n\n    freshnessMentions:\n      (\n        text.match(\n          /freshness|quality_gate|market_data_freshness_observations|market_data_quality_gate_observations/gi\n        ) || []\n      ).length,\n\n    transactionControlMentions:\n      (\n        text.match(\n          /\\b(for\\s+update|for\\s+share|lock\\s+table)\\b/gi\n        ) || []\n      )\n  };\n}\n\nconst migrations = walkSql(migrationDir);\n\nconst functions = {};\n\nfor (const fnName of targetFunctions) {\n  const defs = [];\n\n  for (const item of migrations) {\n    const fn = extractFunction(item.text, fnName);\n\n    if (fn) {\n      defs.push({\n        file: item.rel,\n        functionText: fn,\n        facts: conciseFunctionFacts(fn)\n      });\n    }\n  }\n\n  functions[fnName] = {\n    definitionCount: defs.length,\n    latest:\n      defs.length > 0\n        ? defs[defs.length - 1]\n        : null,\n    allFiles:\n      defs.map((d) => d.file)\n  };\n}\n\nconst tables = {};\n\nfor (const table of freshnessTables) {\n  const defs = [];\n\n  for (const item of migrations) {\n    const block = extractCreateTable(item.text, table);\n\n    if (block) {\n      defs.push({\n        file: item.rel,\n        createTable: block\n      });\n    }\n  }\n\n  tables[table] = {\n    definitionCount: defs.length,\n    latest:\n      defs.length > 0\n        ? defs[defs.length - 1]\n        : null\n  };\n}\n\nconst relevantMigrations =\n  migrations\n    .filter((item) =>\n      /kill[_ -]?switch|freshness|quality[_ -]?gate|committed[_ -]?risk|execute_paper_buy_order|create_paper_buy_order_with_committed_risk_v3/i.test(\n        item.text\n      )\n    )\n    .map((item) => item.rel);\n\nconst report = {\n  status:\n    \"ALPHA_V3_DB_FRESHNESS_CREATE_FILL_BINDING_PROBE_V1_COMPLETE\",\n\n  functions,\n  tables,\n  relevantMigrations,\n\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    networkCalls: 0,\n    ordersCreated: 0,\n    positionsChanged: 0\n  },\n\n  logFile:\n    \"logs/alpha-v3-db-freshness-create-fill-binding-probe-v1.json\",\n\n  nextGate:\n    \"BUILD_DB_FRESHNESS_CREATE_FILL_GUARDS_V1\"\n};\n\nconst logAbs =\n  path.resolve(root, report.logFile);\n\nfs.mkdirSync(\n  path.dirname(logAbs),\n  { recursive: true }\n);\n\nfs.writeFileSync(\n  logAbs,\n  JSON.stringify(report, null, 2) + \"\\n\",\n  \"utf8\"\n);\n\nconsole.log(\n  JSON.stringify(\n    {\n      status:\n        report.status,\n\n      functionSummary:\n        Object.fromEntries(\n          Object.entries(functions).map(\n            ([name, info]) => [\n              name,\n              {\n                definitionCount:\n                  info.definitionCount,\n\n                latestFile:\n                  info.latest?.file ?? null,\n\n                facts:\n                  info.latest?.facts ?? null\n              }\n            ]\n          )\n        ),\n\n      tableSummary:\n        Object.fromEntries(\n          Object.entries(tables).map(\n            ([name, info]) => [\n              name,\n              {\n                definitionCount:\n                  info.definitionCount,\n\n                latestFile:\n                  info.latest?.file ?? null\n              }\n            ]\n          )\n        ),\n\n      relevantMigrationCount:\n        relevantMigrations.length,\n\n      logFile:\n        report.logFile,\n\n      nextGate:\n        report.nextGate\n    },\n    null,\n    2\n  )\n);\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_DB_FRESHNESS_CREATE_FILL_BINDING_PROBE_V1_INSTALLED",

      generatedFile:
        "scripts/alpha-v3-db-freshness-create-fill-binding-probe-v1.cjs",

      targets: [
        "create_paper_buy_order_with_committed_risk_v3",
        "execute_paper_buy_order",
        "market_data_freshness_observations",
        "market_data_quality_gate_observations"
      ],

      purpose:
        "CAPTURE_LATEST_RPC_DEFINITIONS_AND_FRESHNESS_SCHEMA_BEFORE_DB_GUARD_PATCH",

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        networkCalls: 0,
        ordersCreated: 0,
        positionsChanged: 0
      },

      nextAction:
        "RUN_DB_FRESHNESS_BINDING_PROBE"
    },
    null,
    2
  )
);
