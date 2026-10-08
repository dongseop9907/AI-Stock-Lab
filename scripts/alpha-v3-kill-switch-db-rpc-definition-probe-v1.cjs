const fs = require("fs");
const path = require("path");

const root = process.cwd();
const migrationsDir =
  path.resolve(root, "supabase/migrations");

if (!fs.existsSync(migrationsDir)) {
  throw new Error(
    "SUPABASE_MIGRATIONS_DIR_NOT_FOUND"
  );
}

const files =
  fs.readdirSync(migrationsDir)
    .filter((name) =>
      name.toLowerCase().endsWith(".sql")
    )
    .sort();

const patterns = [
  /create\s+(?:or\s+replace\s+)?function\s+public\.([a-zA-Z0-9_]+)\s*\(([\s\S]*?)\)\s*returns/gim,
];

const candidates = [];

for (const name of files) {
  const rel =
    "supabase/migrations/" + name;

  const abs =
    path.resolve(root, rel);

  const text =
    fs.readFileSync(abs, "utf8");

  for (const pattern of patterns) {
    pattern.lastIndex = 0;

    let match;

    while ((match = pattern.exec(text))) {
      const fnName =
        match[1];

      const signature =
        match[2]
          .replace(/\s+/g, " ")
          .trim();

      const start =
        match.index;

      const tail =
        text.slice(
          start,
          Math.min(
            text.length,
            start + 14000
          )
        );

      const riskSignals = {
        paperOrder:
          /paper_order_requests/i.test(tail),

        riskApproved:
          /RISK_APPROVED/i.test(tail),

        reservedRisk:
          /reserved_risk/i.test(tail),

        paperPosition:
          /paper_positions/i.test(tail),

        fill:
          /\bfill\b|FILLED/i.test(tail),

        insertOrder:
          /insert\s+into\s+public\.paper_order_requests/i.test(tail),

        updateOrder:
          /update\s+public\.paper_order_requests/i.test(tail),

        insertPosition:
          /insert\s+into\s+public\.paper_positions/i.test(tail),

        tradingControl:
          /trading_system_controls/i.test(tail),

        emergencyStop:
          /emergency_stop/i.test(tail),
      };

      const score =
        Object.values(riskSignals)
          .filter(Boolean)
          .length;

      if (
        score >= 2 ||
        /paper.*order|order.*paper|committed.*risk|reserved.*risk/i.test(
          fnName
        )
      ) {
        const before =
          text.slice(
            0,
            start
          );

        const line =
          before.split(/\r?\n/).length;

        const excerpt =
          tail
            .split(/\r?\n/)
            .slice(0, 180)
            .join("\n");

        candidates.push({
          file: rel,
          migration:
            name.replace(/\.sql$/i, ""),
          line,
          functionName:
            fnName,
          signature,
          score,
          riskSignals,
          excerpt
        });
      }
    }
  }
}

const byFunction = {};

for (const item of candidates) {
  if (!byFunction[item.functionName]) {
    byFunction[item.functionName] = [];
  }

  byFunction[item.functionName]
    .push(item);
}

for (const list of Object.values(byFunction)) {
  list.sort((a, b) =>
    a.migration.localeCompare(
      b.migration
    )
  );
}

const likelyCreate = [];
const likelyFill = [];

for (const [fnName, list] of Object.entries(byFunction)) {
  const latest =
    list[list.length - 1];

  const lower =
    fnName.toLowerCase();

  if (
    latest.riskSignals.insertOrder ||
    lower.includes("create") ||
    lower.includes("reserve")
  ) {
    likelyCreate.push({
      functionName: fnName,
      latest
    });
  }

  if (
    latest.riskSignals.insertPosition ||
    latest.riskSignals.fill ||
    lower.includes("execute") ||
    lower.includes("fill")
  ) {
    likelyFill.push({
      functionName: fnName,
      latest
    });
  }
}

const report = {
  status:
    "ALPHA_V3_KILL_SWITCH_DB_RPC_DEFINITION_PROBE_V1_COMPLETE",

  scannedMigrationCount:
    files.length,

  candidateDefinitionCount:
    candidates.length,

  uniqueCandidateFunctionCount:
    Object.keys(byFunction).length,

  likelyCreateFunctions:
    likelyCreate.map((item) => ({
      functionName:
        item.functionName,
      file:
        item.latest.file,
      migration:
        item.latest.migration,
      signature:
        item.latest.signature,
      riskSignals:
        item.latest.riskSignals
    })),

  likelyFillFunctions:
    likelyFill.map((item) => ({
      functionName:
        item.functionName,
      file:
        item.latest.file,
      migration:
        item.latest.migration,
      signature:
        item.latest.signature,
      riskSignals:
        item.latest.riskSignals
    })),

  allLatestDefinitions:
    Object.entries(byFunction)
      .map(([functionName, list]) => {
        const latest =
          list[list.length - 1];

        return {
          functionName,
          file:
            latest.file,
          migration:
            latest.migration,
          signature:
            latest.signature,
          riskSignals:
            latest.riskSignals,
          definitionCount:
            list.length
        };
      })
      .sort((a, b) =>
        a.functionName.localeCompare(
          b.functionName
        )
      ),

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    networkCalls: 0,
    ordersCreated: 0,
    ordersChanged: 0,
    positionsChanged: 0
  },

  logFile:
    "logs/alpha-v3-kill-switch-db-rpc-definition-probe-v1.json",

  nextGate:
    "PATCH_EXACT_LATEST_DB_CREATE_AND_FILL_RPC_DEFINITIONS_WITH_KILL_SWITCH_GUARDS"
};

const logPath =
  path.resolve(
    root,
    report.logFile
  );

fs.mkdirSync(
  path.dirname(logPath),
  { recursive: true }
);

fs.writeFileSync(
  logPath,
  JSON.stringify(
    {
      ...report,
      candidates
    },
    null,
    2
  ) + "\n",
  "utf8"
);

console.log(
  JSON.stringify(
    report,
    null,
    2
  )
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_KILL_SWITCH_DB_RPC_DEFINITION_PROBE_V1_SHORT_SUMMARY",

      likelyCreateFunctions:
        report.likelyCreateFunctions,

      likelyFillFunctions:
        report.likelyFillFunctions,

      logFile:
        report.logFile,

      nextGate:
        report.nextGate
    },
    null,
    2
  )
);
