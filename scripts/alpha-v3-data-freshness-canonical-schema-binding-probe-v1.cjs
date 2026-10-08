const fs = require("fs");
const path = require("path");

const root = process.cwd();

const targetTables = [
  "market_data_freshness_observations",
  "market_data_quality_gate_observations"
];

const searchRoots = [
  "app",
  "lib",
  "supabase/migrations"
];

function walk(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const out = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      out.push(...walk(abs));
      continue;
    }

    if (
      entry.isFile() &&
      /\.(ts|tsx|js|cjs|mjs|sql)$/.test(entry.name)
    ) {
      out.push(abs);
    }
  }

  return out;
}

function rel(abs) {
  return path
    .relative(root, abs)
    .replace(/\\/g, "/");
}

function excerpt(text, lineIndex, radius = 8) {
  const lines = text.split(/\r?\n/);

  const start = Math.max(0, lineIndex - radius);
  const end = Math.min(lines.length, lineIndex + radius + 1);

  return lines
    .slice(start, end)
    .map(
      (line, index) =>
        `${start + index + 1}: ${line}`
    )
    .join("\n");
}

function findMentions(text, needle) {
  const lines = text.split(/\r?\n/);
  const hits = [];

  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].includes(needle)) {
      hits.push({
        line: i + 1,
        excerpt: excerpt(text, i, 10)
      });
    }
  }

  return hits;
}

function extractCreateTableBlock(sql, table) {
  const regex =
    new RegExp(
      String.raw`create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?${table}\s*\(`,
      "i"
    );

  const match = regex.exec(sql);

  if (!match) {
    return null;
  }

  const open =
    sql.indexOf("(", match.index);

  if (open < 0) {
    return null;
  }

  let depth = 0;
  let close = -1;

  for (let i = open; i < sql.length; i += 1) {
    const ch = sql[i];

    if (ch === "(") {
      depth += 1;
    } else if (ch === ")") {
      depth -= 1;

      if (depth === 0) {
        close = i;
        break;
      }
    }
  }

  if (close < 0) {
    return null;
  }

  const semicolon =
    sql.indexOf(";", close);

  return sql
    .slice(
      match.index,
      semicolon >= 0 ? semicolon + 1 : close + 1
    )
    .trim();
}

function parseColumns(createBlock) {
  if (!createBlock) {
    return [];
  }

  const open = createBlock.indexOf("(");
  const close = createBlock.lastIndexOf(")");

  if (
    open < 0 ||
    close <= open
  ) {
    return [];
  }

  const body =
    createBlock.slice(open + 1, close);

  const rows =
    body.split(/\r?\n/);

  const columns = [];

  for (const raw of rows) {
    const line =
      raw.trim()
        .replace(/,$/, "");

    if (
      !line ||
      /^(constraint|primary\s+key|unique|foreign\s+key|check)\b/i.test(line)
    ) {
      continue;
    }

    const match =
      line.match(
        /^"?([A-Za-z_][A-Za-z0-9_]*)"?\s+(.+)$/
      );

    if (match) {
      columns.push({
        name: match[1],
        definition: match[2]
      });
    }
  }

  return columns;
}

const files = [];

for (const rootRel of searchRoots) {
  files.push(
    ...walk(
      path.resolve(root, rootRel)
    )
  );
}

const tableReports = [];

for (const table of targetTables) {
  const mentions = [];
  const createDefinitions = [];
  const insertSites = [];
  const readSites = [];
  const indexSites = [];

  for (const abs of files) {
    const text =
      fs.readFileSync(abs, "utf8");

    if (!text.includes(table)) {
      continue;
    }

    const fileRel = rel(abs);
    const hits = findMentions(text, table);

    mentions.push({
      file: fileRel,
      hits
    });

    if (fileRel.startsWith("supabase/migrations/")) {
      const block =
        extractCreateTableBlock(
          text,
          table
        );

      if (block) {
        createDefinitions.push({
          file: fileRel,
          createBlock: block,
          columns: parseColumns(block)
        });
      }

      const lines =
        text.split(/\r?\n/);

      for (let i = 0; i < lines.length; i += 1) {
        if (
          new RegExp(
            String.raw`create\s+(?:unique\s+)?index[\s\S]*${table}`,
            "i"
          ).test(
            lines
              .slice(
                Math.max(0, i - 2),
                Math.min(lines.length, i + 4)
              )
              .join("\n")
          )
        ) {
          indexSites.push({
            file: fileRel,
            line: i + 1,
            excerpt: excerpt(text, i, 5)
          });
        }
      }
    }

    if (
      new RegExp(
        String.raw`\.from\(\s*["'\`]${table}["'\`]\s*\)[\s\S]{0,800}\.(insert|upsert)\(`,
        "i"
      ).test(text)
    ) {
      insertSites.push({
        file: fileRel,
        hints: hits.slice(0, 5)
      });
    }

    if (
      new RegExp(
        String.raw`\.from\(\s*["'\`]${table}["'\`]\s*\)[\s\S]{0,1200}\.(select|order|limit|maybeSingle|single)\(`,
        "i"
      ).test(text)
    ) {
      readSites.push({
        file: fileRel,
        order:
          /\.order\(/.test(text),

        limit:
          /\.limit\(/.test(text),

        maybeSingle:
          /\.maybeSingle\(/.test(text),

        single:
          /\.single\(/.test(text),

        hints:
          hits.slice(0, 5)
      });
    }
  }

  const allColumns =
    [];

  for (const definition of createDefinitions) {
    for (const column of definition.columns) {
      if (
        !allColumns.some(
          (item) =>
            item.name === column.name
        )
      ) {
        allColumns.push(column);
      }
    }
  }

  const keyColumnNames =
    allColumns
      .map((item) => item.name)
      .filter(
        (name) =>
          /status|fresh|usable|expected|latest|date|captured|observed|created|quality|integrity|production|shadow|lag/i.test(
            name
          )
      );

  tableReports.push({
    table,
    createDefinitions,
    keyColumns:
      keyColumnNames,

    allColumns,
    insertSites,
    readSites,
    indexSites,
    mentionFiles:
      mentions.map(
        (item) => item.file
      ),
    mentions
  });
}

const canonicalAssessment = {
  freshnessTable:
    tableReports.find(
      (item) =>
        item.table ===
        "market_data_freshness_observations"
    ) || null,

  qualityGateTable:
    tableReports.find(
      (item) =>
        item.table ===
        "market_data_quality_gate_observations"
    ) || null
};

const report = {
  status:
    "ALPHA_V3_DATA_FRESHNESS_CANONICAL_SCHEMA_BINDING_PROBE_V1_COMPLETE",

  summary: {
    targetTableCount:
      targetTables.length,

    tablesWithCreateDefinition:
      tableReports.filter(
        (item) =>
          item.createDefinitions.length > 0
      ).length,

    tablesWithInsertSites:
      tableReports.filter(
        (item) =>
          item.insertSites.length > 0
      ).length,

    tablesWithReadSites:
      tableReports.filter(
        (item) =>
          item.readSites.length > 0
      ).length
  },

  canonicalAssessment,
  tables:
    tableReports,

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    networkCalls: 0,
    ordersCreated: 0,
    positionsChanged: 0
  },

  logFile:
    "logs/alpha-v3-data-freshness-canonical-schema-binding-probe-v1.json",

  nextGate:
    "BUILD_CANONICAL_FRESHNESS_STATE_READER_V1"
};

const logFile =
  path.resolve(
    root,
    report.logFile
  );

fs.mkdirSync(
  path.dirname(logFile),
  {
    recursive: true
  }
);

fs.writeFileSync(
  logFile,
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

      summary:
        report.summary,

      tables:
        tableReports.map(
          (item) => ({
            table:
              item.table,

            createFiles:
              item.createDefinitions.map(
                (entry) => entry.file
              ),

            keyColumns:
              item.keyColumns,

            insertFiles:
              item.insertSites.map(
                (entry) => entry.file
              ),

            readFiles:
              item.readSites.map(
                (entry) => ({
                  file:
                    entry.file,

                  order:
                    entry.order,

                  limit:
                    entry.limit,

                  maybeSingle:
                    entry.maybeSingle,

                  single:
                    entry.single
                })
              )
          })
        ),

      logFile:
        report.logFile,

      nextGate:
        report.nextGate
    },
    null,
    2
  )
);
