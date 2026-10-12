const fs = require("fs");
const path = require("path");

const target =
  path.resolve(
    process.cwd(),
    "scripts/alpha-v3-data-freshness-canonical-schema-binding-probe-v1.cjs"
  );

fs.mkdirSync(
  path.dirname(target),
  {
    recursive: true
  }
);

fs.writeFileSync(
  target,
  "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst root = process.cwd();\n\nconst targetTables = [\n  \"market_data_freshness_observations\",\n  \"market_data_quality_gate_observations\"\n];\n\nconst searchRoots = [\n  \"app\",\n  \"lib\",\n  \"supabase/migrations\"\n];\n\nfunction walk(dir) {\n  if (!fs.existsSync(dir)) {\n    return [];\n  }\n\n  const out = [];\n\n  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {\n    const abs = path.join(dir, entry.name);\n\n    if (entry.isDirectory()) {\n      out.push(...walk(abs));\n      continue;\n    }\n\n    if (\n      entry.isFile() &&\n      /\\.(ts|tsx|js|cjs|mjs|sql)$/.test(entry.name)\n    ) {\n      out.push(abs);\n    }\n  }\n\n  return out;\n}\n\nfunction rel(abs) {\n  return path\n    .relative(root, abs)\n    .replace(/\\\\/g, \"/\");\n}\n\nfunction excerpt(text, lineIndex, radius = 8) {\n  const lines = text.split(/\\r?\\n/);\n\n  const start = Math.max(0, lineIndex - radius);\n  const end = Math.min(lines.length, lineIndex + radius + 1);\n\n  return lines\n    .slice(start, end)\n    .map(\n      (line, index) =>\n        `${start + index + 1}: ${line}`\n    )\n    .join(\"\\n\");\n}\n\nfunction findMentions(text, needle) {\n  const lines = text.split(/\\r?\\n/);\n  const hits = [];\n\n  for (let i = 0; i < lines.length; i += 1) {\n    if (lines[i].includes(needle)) {\n      hits.push({\n        line: i + 1,\n        excerpt: excerpt(text, i, 10)\n      });\n    }\n  }\n\n  return hits;\n}\n\nfunction extractCreateTableBlock(sql, table) {\n  const regex =\n    new RegExp(\n      String.raw`create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?(?:public\\.)?${table}\\s*\\(`,\n      \"i\"\n    );\n\n  const match = regex.exec(sql);\n\n  if (!match) {\n    return null;\n  }\n\n  const open =\n    sql.indexOf(\"(\", match.index);\n\n  if (open < 0) {\n    return null;\n  }\n\n  let depth = 0;\n  let close = -1;\n\n  for (let i = open; i < sql.length; i += 1) {\n    const ch = sql[i];\n\n    if (ch === \"(\") {\n      depth += 1;\n    } else if (ch === \")\") {\n      depth -= 1;\n\n      if (depth === 0) {\n        close = i;\n        break;\n      }\n    }\n  }\n\n  if (close < 0) {\n    return null;\n  }\n\n  const semicolon =\n    sql.indexOf(\";\", close);\n\n  return sql\n    .slice(\n      match.index,\n      semicolon >= 0 ? semicolon + 1 : close + 1\n    )\n    .trim();\n}\n\nfunction parseColumns(createBlock) {\n  if (!createBlock) {\n    return [];\n  }\n\n  const open = createBlock.indexOf(\"(\");\n  const close = createBlock.lastIndexOf(\")\");\n\n  if (\n    open < 0 ||\n    close <= open\n  ) {\n    return [];\n  }\n\n  const body =\n    createBlock.slice(open + 1, close);\n\n  const rows =\n    body.split(/\\r?\\n/);\n\n  const columns = [];\n\n  for (const raw of rows) {\n    const line =\n      raw.trim()\n        .replace(/,$/, \"\");\n\n    if (\n      !line ||\n      /^(constraint|primary\\s+key|unique|foreign\\s+key|check)\\b/i.test(line)\n    ) {\n      continue;\n    }\n\n    const match =\n      line.match(\n        /^\"?([A-Za-z_][A-Za-z0-9_]*)\"?\\s+(.+)$/\n      );\n\n    if (match) {\n      columns.push({\n        name: match[1],\n        definition: match[2]\n      });\n    }\n  }\n\n  return columns;\n}\n\nconst files = [];\n\nfor (const rootRel of searchRoots) {\n  files.push(\n    ...walk(\n      path.resolve(root, rootRel)\n    )\n  );\n}\n\nconst tableReports = [];\n\nfor (const table of targetTables) {\n  const mentions = [];\n  const createDefinitions = [];\n  const insertSites = [];\n  const readSites = [];\n  const indexSites = [];\n\n  for (const abs of files) {\n    const text =\n      fs.readFileSync(abs, \"utf8\");\n\n    if (!text.includes(table)) {\n      continue;\n    }\n\n    const fileRel = rel(abs);\n    const hits = findMentions(text, table);\n\n    mentions.push({\n      file: fileRel,\n      hits\n    });\n\n    if (fileRel.startsWith(\"supabase/migrations/\")) {\n      const block =\n        extractCreateTableBlock(\n          text,\n          table\n        );\n\n      if (block) {\n        createDefinitions.push({\n          file: fileRel,\n          createBlock: block,\n          columns: parseColumns(block)\n        });\n      }\n\n      const lines =\n        text.split(/\\r?\\n/);\n\n      for (let i = 0; i < lines.length; i += 1) {\n        if (\n          new RegExp(\n            String.raw`create\\s+(?:unique\\s+)?index[\\s\\S]*${table}`,\n            \"i\"\n          ).test(\n            lines\n              .slice(\n                Math.max(0, i - 2),\n                Math.min(lines.length, i + 4)\n              )\n              .join(\"\\n\")\n          )\n        ) {\n          indexSites.push({\n            file: fileRel,\n            line: i + 1,\n            excerpt: excerpt(text, i, 5)\n          });\n        }\n      }\n    }\n\n    if (\n      new RegExp(\n        String.raw`\\.from\\(\\s*[\"'\\`]${table}[\"'\\`]\\s*\\)[\\s\\S]{0,800}\\.(insert|upsert)\\(`,\n        \"i\"\n      ).test(text)\n    ) {\n      insertSites.push({\n        file: fileRel,\n        hints: hits.slice(0, 5)\n      });\n    }\n\n    if (\n      new RegExp(\n        String.raw`\\.from\\(\\s*[\"'\\`]${table}[\"'\\`]\\s*\\)[\\s\\S]{0,1200}\\.(select|order|limit|maybeSingle|single)\\(`,\n        \"i\"\n      ).test(text)\n    ) {\n      readSites.push({\n        file: fileRel,\n        order:\n          /\\.order\\(/.test(text),\n\n        limit:\n          /\\.limit\\(/.test(text),\n\n        maybeSingle:\n          /\\.maybeSingle\\(/.test(text),\n\n        single:\n          /\\.single\\(/.test(text),\n\n        hints:\n          hits.slice(0, 5)\n      });\n    }\n  }\n\n  const allColumns =\n    [];\n\n  for (const definition of createDefinitions) {\n    for (const column of definition.columns) {\n      if (\n        !allColumns.some(\n          (item) =>\n            item.name === column.name\n        )\n      ) {\n        allColumns.push(column);\n      }\n    }\n  }\n\n  const keyColumnNames =\n    allColumns\n      .map((item) => item.name)\n      .filter(\n        (name) =>\n          /status|fresh|usable|expected|latest|date|captured|observed|created|quality|integrity|production|shadow|lag/i.test(\n            name\n          )\n      );\n\n  tableReports.push({\n    table,\n    createDefinitions,\n    keyColumns:\n      keyColumnNames,\n\n    allColumns,\n    insertSites,\n    readSites,\n    indexSites,\n    mentionFiles:\n      mentions.map(\n        (item) => item.file\n      ),\n    mentions\n  });\n}\n\nconst canonicalAssessment = {\n  freshnessTable:\n    tableReports.find(\n      (item) =>\n        item.table ===\n        \"market_data_freshness_observations\"\n    ) || null,\n\n  qualityGateTable:\n    tableReports.find(\n      (item) =>\n        item.table ===\n        \"market_data_quality_gate_observations\"\n    ) || null\n};\n\nconst report = {\n  status:\n    \"ALPHA_V3_DATA_FRESHNESS_CANONICAL_SCHEMA_BINDING_PROBE_V1_COMPLETE\",\n\n  summary: {\n    targetTableCount:\n      targetTables.length,\n\n    tablesWithCreateDefinition:\n      tableReports.filter(\n        (item) =>\n          item.createDefinitions.length > 0\n      ).length,\n\n    tablesWithInsertSites:\n      tableReports.filter(\n        (item) =>\n          item.insertSites.length > 0\n      ).length,\n\n    tablesWithReadSites:\n      tableReports.filter(\n        (item) =>\n          item.readSites.length > 0\n      ).length\n  },\n\n  canonicalAssessment,\n  tables:\n    tableReports,\n\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    networkCalls: 0,\n    ordersCreated: 0,\n    positionsChanged: 0\n  },\n\n  logFile:\n    \"logs/alpha-v3-data-freshness-canonical-schema-binding-probe-v1.json\",\n\n  nextGate:\n    \"BUILD_CANONICAL_FRESHNESS_STATE_READER_V1\"\n};\n\nconst logFile =\n  path.resolve(\n    root,\n    report.logFile\n  );\n\nfs.mkdirSync(\n  path.dirname(logFile),\n  {\n    recursive: true\n  }\n);\n\nfs.writeFileSync(\n  logFile,\n  JSON.stringify(\n    report,\n    null,\n    2\n  ) + \"\\n\",\n  \"utf8\"\n);\n\nconsole.log(\n  JSON.stringify(\n    {\n      status:\n        report.status,\n\n      summary:\n        report.summary,\n\n      tables:\n        tableReports.map(\n          (item) => ({\n            table:\n              item.table,\n\n            createFiles:\n              item.createDefinitions.map(\n                (entry) => entry.file\n              ),\n\n            keyColumns:\n              item.keyColumns,\n\n            insertFiles:\n              item.insertSites.map(\n                (entry) => entry.file\n              ),\n\n            readFiles:\n              item.readSites.map(\n                (entry) => ({\n                  file:\n                    entry.file,\n\n                  order:\n                    entry.order,\n\n                  limit:\n                    entry.limit,\n\n                  maybeSingle:\n                    entry.maybeSingle,\n\n                  single:\n                    entry.single\n                })\n              )\n          })\n        ),\n\n      logFile:\n        report.logFile,\n\n      nextGate:\n        report.nextGate\n    },\n    null,\n    2\n  )\n);\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_DATA_FRESHNESS_CANONICAL_SCHEMA_BINDING_PROBE_V1_INSTALLED",

      generatedFile:
        "scripts/alpha-v3-data-freshness-canonical-schema-binding-probe-v1.cjs",

      focusTables: [
        "market_data_freshness_observations",
        "market_data_quality_gate_observations"
      ],

      purpose:
        "EXTRACT_EXACT_SCHEMA_INSERT_AND_LATEST_READ_BINDINGS",

      consolePolicy:
        "SUMMARY_ONLY_FULL_CONTEXT_IN_LOG",

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        networkCalls: 0,
        ordersCreated: 0,
        positionsChanged: 0
      },

      nextAction:
        "RUN_CANONICAL_SCHEMA_BINDING_PROBE"
    },
    null,
    2
  )
);
