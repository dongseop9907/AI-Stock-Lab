const fs = require("fs");
const path = require("path");

const root = process.cwd();
const migrationDir = path.resolve(root, "supabase/migrations");

const targetFunctions = [
  "create_paper_buy_order_with_committed_risk_v3",
  "execute_paper_buy_order"
];

const freshnessTables = [
  "market_data_freshness_observations",
  "market_data_quality_gate_observations"
];

function walkSql(dir) {
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({
      name,
      rel: `supabase/migrations/${name}`,
      abs: path.join(dir, name),
      text: fs.readFileSync(path.join(dir, name), "utf8")
    }));
}

function extractFunction(sql, fnName) {
  const re = new RegExp(
    String.raw`create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?${fnName}\s*\(`,
    "i"
  );

  const match = re.exec(sql);

  if (!match) return null;

  const start = match.index;
  const after = sql.slice(start);

  const dollarMatch =
    after.match(/\bas\s+(\$[A-Za-z0-9_]*\$)/i);

  if (!dollarMatch) {
    const nextCreate =
      after.slice(1).search(
        /\ncreate\s+(?:or\s+replace\s+)?function\s+/i
      );

    return nextCreate >= 0
      ? after.slice(0, nextCreate + 1).trim()
      : after.trim();
  }

  const tag = dollarMatch[1];
  const bodyStart =
    start +
    dollarMatch.index +
    dollarMatch[0].length;

  const closeIndex =
    sql.indexOf(tag, bodyStart);

  if (closeIndex < 0) {
    return after.trim();
  }

  const semicolon =
    sql.indexOf(";", closeIndex + tag.length);

  return sql.slice(
    start,
    semicolon >= 0
      ? semicolon + 1
      : closeIndex + tag.length
  ).trim();
}

function extractCreateTable(sql, table) {
  const re = new RegExp(
    String.raw`create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?${table}\s*\(`,
    "i"
  );

  const match = re.exec(sql);
  if (!match) return null;

  const start = match.index;
  const open = sql.indexOf("(", start);

  let depth = 0;
  let close = -1;

  for (let i = open; i < sql.length; i += 1) {
    if (sql[i] === "(") depth += 1;
    if (sql[i] === ")") {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }

  if (close < 0) return null;

  const semicolon = sql.indexOf(";", close);

  return sql.slice(
    start,
    semicolon >= 0 ? semicolon + 1 : close + 1
  ).trim();
}

function conciseFunctionFacts(text) {
  if (!text) return null;

  const lines = text.split(/\r?\n/);

  return {
    signature:
      lines
        .slice(0, Math.min(lines.length, 18))
        .join("\n"),

    hasKillSwitchAssert:
      /assert_paper_buy_new_risk_allowed_v1/i.test(text),

    hasAdvisoryLock:
      /advisory.*lock|pg_advisory/i.test(text),

    hasCommittedRisk:
      /committed.*risk|reserved.*risk|risk_reservation/i.test(text),

    freshnessMentions:
      (
        text.match(
          /freshness|quality_gate|market_data_freshness_observations|market_data_quality_gate_observations/gi
        ) || []
      ).length,

    transactionControlMentions:
      (
        text.match(
          /\b(for\s+update|for\s+share|lock\s+table)\b/gi
        ) || []
      )
  };
}

const migrations = walkSql(migrationDir);

const functions = {};

for (const fnName of targetFunctions) {
  const defs = [];

  for (const item of migrations) {
    const fn = extractFunction(item.text, fnName);

    if (fn) {
      defs.push({
        file: item.rel,
        functionText: fn,
        facts: conciseFunctionFacts(fn)
      });
    }
  }

  functions[fnName] = {
    definitionCount: defs.length,
    latest:
      defs.length > 0
        ? defs[defs.length - 1]
        : null,
    allFiles:
      defs.map((d) => d.file)
  };
}

const tables = {};

for (const table of freshnessTables) {
  const defs = [];

  for (const item of migrations) {
    const block = extractCreateTable(item.text, table);

    if (block) {
      defs.push({
        file: item.rel,
        createTable: block
      });
    }
  }

  tables[table] = {
    definitionCount: defs.length,
    latest:
      defs.length > 0
        ? defs[defs.length - 1]
        : null
  };
}

const relevantMigrations =
  migrations
    .filter((item) =>
      /kill[_ -]?switch|freshness|quality[_ -]?gate|committed[_ -]?risk|execute_paper_buy_order|create_paper_buy_order_with_committed_risk_v3/i.test(
        item.text
      )
    )
    .map((item) => item.rel);

const report = {
  status:
    "ALPHA_V3_DB_FRESHNESS_CREATE_FILL_BINDING_PROBE_V1_COMPLETE",

  functions,
  tables,
  relevantMigrations,

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    networkCalls: 0,
    ordersCreated: 0,
    positionsChanged: 0
  },

  logFile:
    "logs/alpha-v3-db-freshness-create-fill-binding-probe-v1.json",

  nextGate:
    "BUILD_DB_FRESHNESS_CREATE_FILL_GUARDS_V1"
};

const logAbs =
  path.resolve(root, report.logFile);

fs.mkdirSync(
  path.dirname(logAbs),
  { recursive: true }
);

fs.writeFileSync(
  logAbs,
  JSON.stringify(report, null, 2) + "\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        report.status,

      functionSummary:
        Object.fromEntries(
          Object.entries(functions).map(
            ([name, info]) => [
              name,
              {
                definitionCount:
                  info.definitionCount,

                latestFile:
                  info.latest?.file ?? null,

                facts:
                  info.latest?.facts ?? null
              }
            ]
          )
        ),

      tableSummary:
        Object.fromEntries(
          Object.entries(tables).map(
            ([name, info]) => [
              name,
              {
                definitionCount:
                  info.definitionCount,

                latestFile:
                  info.latest?.file ?? null
              }
            ]
          )
        ),

      relevantMigrationCount:
        relevantMigrations.length,

      logFile:
        report.logFile,

      nextGate:
        report.nextGate
    },
    null,
    2
  )
);
