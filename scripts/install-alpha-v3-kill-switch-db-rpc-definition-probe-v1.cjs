const fs = require("fs");
const path = require("path");

const target =
  path.resolve(
    process.cwd(),
    "scripts/alpha-v3-kill-switch-db-rpc-definition-probe-v1.cjs"
  );

fs.mkdirSync(
  path.dirname(target),
  {
    recursive: true
  }
);

fs.writeFileSync(
  target,
  "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\nconst migrationsDir =\n  path.resolve(root, \"supabase/migrations\");\n\nif (!fs.existsSync(migrationsDir)) {\n  throw new Error(\n    \"SUPABASE_MIGRATIONS_DIR_NOT_FOUND\"\n  );\n}\n\nconst files =\n  fs.readdirSync(migrationsDir)\n    .filter((name) =>\n      name.toLowerCase().endsWith(\".sql\")\n    )\n    .sort();\n\nconst patterns = [\n  /create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.([a-zA-Z0-9_]+)\\s*\\(([\\s\\S]*?)\\)\\s*returns/gim,\n];\n\nconst candidates = [];\n\nfor (const name of files) {\n  const rel =\n    \"supabase/migrations/\" + name;\n\n  const abs =\n    path.resolve(root, rel);\n\n  const text =\n    fs.readFileSync(abs, \"utf8\");\n\n  for (const pattern of patterns) {\n    pattern.lastIndex = 0;\n\n    let match;\n\n    while ((match = pattern.exec(text))) {\n      const fnName =\n        match[1];\n\n      const signature =\n        match[2]\n          .replace(/\\s+/g, \" \")\n          .trim();\n\n      const start =\n        match.index;\n\n      const tail =\n        text.slice(\n          start,\n          Math.min(\n            text.length,\n            start + 14000\n          )\n        );\n\n      const riskSignals = {\n        paperOrder:\n          /paper_order_requests/i.test(tail),\n\n        riskApproved:\n          /RISK_APPROVED/i.test(tail),\n\n        reservedRisk:\n          /reserved_risk/i.test(tail),\n\n        paperPosition:\n          /paper_positions/i.test(tail),\n\n        fill:\n          /\\bfill\\b|FILLED/i.test(tail),\n\n        insertOrder:\n          /insert\\s+into\\s+public\\.paper_order_requests/i.test(tail),\n\n        updateOrder:\n          /update\\s+public\\.paper_order_requests/i.test(tail),\n\n        insertPosition:\n          /insert\\s+into\\s+public\\.paper_positions/i.test(tail),\n\n        tradingControl:\n          /trading_system_controls/i.test(tail),\n\n        emergencyStop:\n          /emergency_stop/i.test(tail),\n      };\n\n      const score =\n        Object.values(riskSignals)\n          .filter(Boolean)\n          .length;\n\n      if (\n        score >= 2 ||\n        /paper.*order|order.*paper|committed.*risk|reserved.*risk/i.test(\n          fnName\n        )\n      ) {\n        const before =\n          text.slice(\n            0,\n            start\n          );\n\n        const line =\n          before.split(/\\r?\\n/).length;\n\n        const excerpt =\n          tail\n            .split(/\\r?\\n/)\n            .slice(0, 180)\n            .join(\"\\n\");\n\n        candidates.push({\n          file: rel,\n          migration:\n            name.replace(/\\.sql$/i, \"\"),\n          line,\n          functionName:\n            fnName,\n          signature,\n          score,\n          riskSignals,\n          excerpt\n        });\n      }\n    }\n  }\n}\n\nconst byFunction = {};\n\nfor (const item of candidates) {\n  if (!byFunction[item.functionName]) {\n    byFunction[item.functionName] = [];\n  }\n\n  byFunction[item.functionName]\n    .push(item);\n}\n\nfor (const list of Object.values(byFunction)) {\n  list.sort((a, b) =>\n    a.migration.localeCompare(\n      b.migration\n    )\n  );\n}\n\nconst likelyCreate = [];\nconst likelyFill = [];\n\nfor (const [fnName, list] of Object.entries(byFunction)) {\n  const latest =\n    list[list.length - 1];\n\n  const lower =\n    fnName.toLowerCase();\n\n  if (\n    latest.riskSignals.insertOrder ||\n    lower.includes(\"create\") ||\n    lower.includes(\"reserve\")\n  ) {\n    likelyCreate.push({\n      functionName: fnName,\n      latest\n    });\n  }\n\n  if (\n    latest.riskSignals.insertPosition ||\n    latest.riskSignals.fill ||\n    lower.includes(\"execute\") ||\n    lower.includes(\"fill\")\n  ) {\n    likelyFill.push({\n      functionName: fnName,\n      latest\n    });\n  }\n}\n\nconst report = {\n  status:\n    \"ALPHA_V3_KILL_SWITCH_DB_RPC_DEFINITION_PROBE_V1_COMPLETE\",\n\n  scannedMigrationCount:\n    files.length,\n\n  candidateDefinitionCount:\n    candidates.length,\n\n  uniqueCandidateFunctionCount:\n    Object.keys(byFunction).length,\n\n  likelyCreateFunctions:\n    likelyCreate.map((item) => ({\n      functionName:\n        item.functionName,\n      file:\n        item.latest.file,\n      migration:\n        item.latest.migration,\n      signature:\n        item.latest.signature,\n      riskSignals:\n        item.latest.riskSignals\n    })),\n\n  likelyFillFunctions:\n    likelyFill.map((item) => ({\n      functionName:\n        item.functionName,\n      file:\n        item.latest.file,\n      migration:\n        item.latest.migration,\n      signature:\n        item.latest.signature,\n      riskSignals:\n        item.latest.riskSignals\n    })),\n\n  allLatestDefinitions:\n    Object.entries(byFunction)\n      .map(([functionName, list]) => {\n        const latest =\n          list[list.length - 1];\n\n        return {\n          functionName,\n          file:\n            latest.file,\n          migration:\n            latest.migration,\n          signature:\n            latest.signature,\n          riskSignals:\n            latest.riskSignals,\n          definitionCount:\n            list.length\n        };\n      })\n      .sort((a, b) =>\n        a.functionName.localeCompare(\n          b.functionName\n        )\n      ),\n\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    networkCalls: 0,\n    ordersCreated: 0,\n    ordersChanged: 0,\n    positionsChanged: 0\n  },\n\n  logFile:\n    \"logs/alpha-v3-kill-switch-db-rpc-definition-probe-v1.json\",\n\n  nextGate:\n    \"PATCH_EXACT_LATEST_DB_CREATE_AND_FILL_RPC_DEFINITIONS_WITH_KILL_SWITCH_GUARDS\"\n};\n\nconst logPath =\n  path.resolve(\n    root,\n    report.logFile\n  );\n\nfs.mkdirSync(\n  path.dirname(logPath),\n  { recursive: true }\n);\n\nfs.writeFileSync(\n  logPath,\n  JSON.stringify(\n    {\n      ...report,\n      candidates\n    },\n    null,\n    2\n  ) + \"\\n\",\n  \"utf8\"\n);\n\nconsole.log(\n  JSON.stringify(\n    report,\n    null,\n    2\n  )\n);\n\nconsole.log(\n  \"\\n=== LIKELY CREATE LATEST DEFINITIONS ===\"\n);\n\nfor (const item of likelyCreate) {\n  console.log(\n    \"\\nFUNCTION: \" +\n    item.functionName\n  );\n  console.log(\n    \"FILE: \" +\n    item.latest.file\n  );\n  console.log(\n    \"SIGNATURE: \" +\n    item.latest.signature\n  );\n  console.log(\n    item.latest.excerpt\n  );\n}\n\nconsole.log(\n  \"\\n=== LIKELY FILL LATEST DEFINITIONS ===\"\n);\n\nfor (const item of likelyFill) {\n  console.log(\n    \"\\nFUNCTION: \" +\n    item.functionName\n  );\n  console.log(\n    \"FILE: \" +\n    item.latest.file\n  );\n  console.log(\n    \"SIGNATURE: \" +\n    item.latest.signature\n  );\n  console.log(\n    item.latest.excerpt\n  );\n}\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_KILL_SWITCH_DB_RPC_DEFINITION_PROBE_V1_INSTALLED",

      generatedFile:
        "scripts/alpha-v3-kill-switch-db-rpc-definition-probe-v1.cjs",

      purpose:
        "IDENTIFY_EXACT_LATEST_DB_CREATE_AND_FILL_RPC_DEFINITIONS_BEFORE_KILL_SWITCH_PATCH",

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        networkCalls: 0,
        ordersCreated: 0,
        ordersChanged: 0,
        positionsChanged: 0
      },

      nextAction:
        "RUN_DB_RPC_DEFINITION_PROBE"
    },
    null,
    2
  )
);
