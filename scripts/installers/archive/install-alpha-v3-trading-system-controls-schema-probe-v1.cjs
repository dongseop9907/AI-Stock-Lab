const fs = require("fs");
const path = require("path");

const target =
  path.resolve(
    process.cwd(),
    "scripts/alpha-v3-trading-system-controls-schema-probe-v1.cjs"
  );

fs.mkdirSync(
  path.dirname(target),
  {
    recursive: true
  }
);

fs.writeFileSync(
  target,
  "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nconst migrationRel =\n  \"supabase/migrations/018_trading_system_controls.sql\";\n\nconst controlLibRel =\n  \"lib/trading/get-trading-system-control.ts\";\n\nconst controlRouteRel =\n  \"app/api/trading/system/control/route.ts\";\n\nfunction parseEnvFile(file) {\n  const env = {};\n\n  if (!fs.existsSync(file)) {\n    return env;\n  }\n\n  for (\n    const rawLine of\n      fs.readFileSync(file, \"utf8\")\n        .split(/\\r?\\n/)\n  ) {\n    const line = rawLine.trim();\n\n    if (\n      !line ||\n      line.startsWith(\"#\")\n    ) {\n      continue;\n    }\n\n    const index =\n      line.indexOf(\"=\");\n\n    if (index <= 0) {\n      continue;\n    }\n\n    const key =\n      line.slice(0, index).trim();\n\n    let value =\n      line.slice(index + 1).trim();\n\n    if (\n      (\n        value.startsWith('\"') &&\n        value.endsWith('\"')\n      ) ||\n      (\n        value.startsWith(\"'\") &&\n        value.endsWith(\"'\")\n      )\n    ) {\n      value =\n        value.slice(1, -1);\n    }\n\n    env[key] = value;\n  }\n\n  return env;\n}\n\nfunction readText(rel) {\n  const abs =\n    path.resolve(root, rel);\n\n  if (!fs.existsSync(abs)) {\n    return null;\n  }\n\n  return fs\n    .readFileSync(abs, \"utf8\")\n    .replace(/\\r\\n/g, \"\\n\");\n}\n\nfunction findContexts(text, patterns, radius = 6) {\n  if (!text) {\n    return [];\n  }\n\n  const lines =\n    text.split(\"\\n\");\n\n  const results = [];\n\n  for (\n    let i = 0;\n    i < lines.length;\n    i += 1\n  ) {\n    if (\n      patterns.some(\n        (pattern) =>\n          pattern.test(lines[i])\n      )\n    ) {\n      const start =\n        Math.max(\n          0,\n          i - radius\n        );\n\n      const end =\n        Math.min(\n          lines.length,\n          i + radius + 1\n        );\n\n      results.push({\n        line:\n          i + 1,\n\n        text:\n          lines\n            .slice(start, end)\n            .map(\n              (value, index) =>\n                `${start + index + 1}: ${value}`\n            )\n            .join(\"\\n\")\n      });\n    }\n  }\n\n  return results.slice(0, 30);\n}\n\nconst migrationText =\n  readText(migrationRel);\n\nconst controlLibText =\n  readText(controlLibRel);\n\nconst controlRouteText =\n  readText(controlRouteRel);\n\nconst env = {\n  ...parseEnvFile(\n    path.resolve(\n      root,\n      \".env.local\"\n    )\n  ),\n  ...process.env\n};\n\nconst supabaseUrl =\n  String(\n    env.NEXT_PUBLIC_SUPABASE_URL ||\n    env.SUPABASE_URL ||\n    \"\"\n  )\n    .trim()\n    .replace(/\\/+$/, \"\");\n\nconst serviceRoleKey =\n  String(\n    env.SUPABASE_SERVICE_ROLE_KEY ||\n    env.SUPABASE_SERVICE_KEY ||\n    \"\"\n  ).trim();\n\nasync function parseResponse(response) {\n  const text =\n    await response.text();\n\n  try {\n    return text\n      ? JSON.parse(text)\n      : null;\n  } catch {\n    return {\n      raw: text\n    };\n  }\n}\n\nasync function main() {\n  if (\n    !supabaseUrl ||\n    !serviceRoleKey\n  ) {\n    throw new Error(\n      \"SUPABASE_SERVICE_ROLE_CONFIG_MISSING\"\n    );\n  }\n\n  const response =\n    await fetch(\n      supabaseUrl +\n      \"/rest/v1/trading_system_controls?select=*&limit=10\",\n      {\n        method:\n          \"GET\",\n\n        headers: {\n          apikey:\n            serviceRoleKey,\n\n          authorization:\n            \"Bearer \" +\n            serviceRoleKey\n        },\n\n        cache:\n          \"no-store\"\n      }\n    );\n\n  const payload =\n    await parseResponse(\n      response\n    );\n\n  if (\n    !response.ok ||\n    !Array.isArray(payload)\n  ) {\n    throw new Error(\n      \"TRADING_SYSTEM_CONTROLS_READ_FAILED \" +\n      JSON.stringify(payload)\n    );\n  }\n\n  const rowKeys =\n    payload.map(\n      (row) =>\n        Object.keys(\n          row ?? {}\n        ).sort()\n    );\n\n  const candidateIdentityColumns = [\n    \"scope\",\n    \"control_key\",\n    \"key\",\n    \"name\",\n    \"singleton_key\",\n    \"environment\",\n    \"mode\",\n    \"created_at\",\n    \"updated_at\"\n  ];\n\n  const identityCandidates =\n    payload.length > 0\n      ? candidateIdentityColumns\n          .filter(\n            (key) =>\n              Object.prototype\n                .hasOwnProperty.call(\n                  payload[0],\n                  key\n                )\n          )\n          .map(\n            (key) => ({\n              column: key,\n              values:\n                payload.map(\n                  (row) =>\n                    row?.[key] ??\n                    null\n                )\n            })\n          )\n      : [];\n\n  const report = {\n    status:\n      \"ALPHA_V3_TRADING_SYSTEM_CONTROLS_SCHEMA_PROBE_V1_COMPLETE\",\n\n    database: {\n      httpStatus:\n        response.status,\n\n      rowCount:\n        payload.length,\n\n      rowKeys,\n\n      rows:\n        payload,\n\n      identityCandidates\n    },\n\n    source: {\n      migration: {\n        file:\n          migrationRel,\n\n        exists:\n          migrationText !== null,\n\n        contexts:\n          findContexts(\n            migrationText,\n            [\n              /create\\s+table/i,\n              /primary\\s+key/i,\n              /unique/i,\n              /trading_system_controls/i,\n              /insert\\s+into/i\n            ],\n            8\n          )\n      },\n\n      controlLibrary: {\n        file:\n          controlLibRel,\n\n        exists:\n          controlLibText !== null,\n\n        contexts:\n          findContexts(\n            controlLibText,\n            [\n              /trading_system_controls/i,\n              /\\.eq\\s*\\(/,\n              /\\.single\\s*\\(/,\n              /\\.maybeSingle\\s*\\(/,\n              /\\.limit\\s*\\(/,\n              /\\.order\\s*\\(/\n            ],\n            8\n          )\n      },\n\n      controlRoute: {\n        file:\n          controlRouteRel,\n\n        exists:\n          controlRouteText !== null,\n\n        contexts:\n          findContexts(\n            controlRouteText,\n            [\n              /trading_system_controls/i,\n              /emergency_stop/i,\n              /\\.eq\\s*\\(/,\n              /\\.update\\s*\\(/\n            ],\n            8\n          )\n      }\n    },\n\n    diagnosis: {\n      tableName:\n        \"trading_system_controls\",\n\n      idColumnPresent:\n        payload.length > 0\n          ? Object.prototype\n              .hasOwnProperty.call(\n                payload[0],\n                \"id\"\n              )\n          : null,\n\n      singletonRowCount:\n        payload.length,\n\n      nextQuestion:\n        \"USE_ACTUAL_SOURCE_SINGLETON_KEY_AND_ROW_SHAPE_TO_PATCH_01500_WITHOUT_GUESSING\"\n    },\n\n    safety: {\n      databaseReads:\n        1,\n\n      databaseWrites:\n        0,\n\n      ordersCreated:\n        0,\n\n      ordersChanged:\n        0,\n\n      positionsChanged:\n        0\n    },\n\n    logFile:\n      \"logs/alpha-v3-trading-system-controls-schema-probe-v1.json\",\n\n    nextGate:\n      \"PATCH_KILL_SWITCH_FOUNDATION_TO_ACTUAL_CONTROL_SCHEMA\"\n  };\n\n  fs.mkdirSync(\n    path.resolve(\n      root,\n      \"logs\"\n    ),\n    {\n      recursive: true\n    }\n  );\n\n  fs.writeFileSync(\n    path.resolve(\n      root,\n      report.logFile\n    ),\n    JSON.stringify(\n      report,\n      null,\n      2\n    ) + \"\\n\",\n    \"utf8\"\n  );\n\n  console.log(\n    JSON.stringify(\n      {\n        status:\n          report.status,\n\n        database:\n          report.database,\n\n        sourceSummary: {\n          migrationExists:\n            report.source\n              .migration\n              .exists,\n\n          migrationContextCount:\n            report.source\n              .migration\n              .contexts\n              .length,\n\n          controlLibraryExists:\n            report.source\n              .controlLibrary\n              .exists,\n\n          controlLibraryContextCount:\n            report.source\n              .controlLibrary\n              .contexts\n              .length,\n\n          controlRouteExists:\n            report.source\n              .controlRoute\n              .exists,\n\n          controlRouteContextCount:\n            report.source\n              .controlRoute\n              .contexts\n              .length\n        },\n\n        diagnosis:\n          report.diagnosis,\n\n        safety:\n          report.safety,\n\n        logFile:\n          report.logFile,\n\n        nextGate:\n          report.nextGate\n      },\n      null,\n      2\n    )\n  );\n\n  console.log(\n    \"\\n=== MIGRATION CONTEXTS ===\"\n  );\n\n  for (\n    const item of\n      report.source\n        .migration\n        .contexts\n  ) {\n    console.log(\n      \"\\n\" +\n      item.text\n    );\n  }\n\n  console.log(\n    \"\\n=== CONTROL LIBRARY CONTEXTS ===\"\n  );\n\n  for (\n    const item of\n      report.source\n        .controlLibrary\n        .contexts\n  ) {\n    console.log(\n      \"\\n\" +\n      item.text\n    );\n  }\n\n  console.log(\n    \"\\n=== CONTROL ROUTE CONTEXTS ===\"\n  );\n\n  for (\n    const item of\n      report.source\n        .controlRoute\n        .contexts\n  ) {\n    console.log(\n      \"\\n\" +\n      item.text\n    );\n  }\n}\n\nmain().catch(\n  (error) => {\n    console.error(\n      JSON.stringify(\n        {\n          status:\n            \"ALPHA_V3_TRADING_SYSTEM_CONTROLS_SCHEMA_PROBE_V1_FATAL\",\n\n          error:\n            error instanceof Error\n              ? error.message\n              : String(error),\n\n          safety: {\n            databaseWrites:\n              0,\n\n            ordersCreated:\n              0,\n\n            positionsChanged:\n              0\n          },\n\n          nextGate:\n            \"REVIEW_CONTROL_SCHEMA_PROBE_FATAL\"\n        },\n        null,\n        2\n      )\n    );\n\n    process.exitCode =\n      2;\n  }\n);\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_TRADING_SYSTEM_CONTROLS_SCHEMA_PROBE_V1_INSTALLED",

      generatedFile:
        "scripts/alpha-v3-trading-system-controls-schema-probe-v1.cjs",

      purpose:
        "READ_ACTUAL_CONTROL_TABLE_ROW_SHAPE_AND_LOCAL_SINGLETON_KEY_USAGE_BEFORE_PATCHING_KILL_SWITCH_FOUNDATION",

      safety: {
        databaseReadsOnly:
          true,

        databaseWrites:
          0,

        ordersCreated:
          0,

        ordersChanged:
          0,

        positionsChanged:
          0
      },

      nextAction:
        "RUN_CONTROL_SCHEMA_PROBE"
    },
    null,
    2
  )
);
