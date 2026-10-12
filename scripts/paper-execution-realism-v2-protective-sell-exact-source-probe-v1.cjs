const fs = require("fs");
const path = require("path");

const root = process.cwd();

const targets = [
  "supabase/migrations/004_stop_loss_execution.sql",
  "lib/trading/check-stop-losses.ts",
  "lib/trading/update-trailing-stops.ts",
];

function read(rel) {
  const abs = path.resolve(root, rel);
  if (!fs.existsSync(abs)) {
    return {
      exists: false,
      source: null,
    };
  }

  return {
    exists: true,
    source: fs.readFileSync(abs, "utf8"),
  };
}

function numberedLines(source) {
  return source
    .split(/\r?\n/)
    .map((text, index) => ({
      line: index + 1,
      text,
    }));
}

function collectMatches(source, patterns) {
  const lines = numberedLines(source);
  const out = [];

  for (const row of lines) {
    const matched =
      patterns.filter((p) =>
        p.re.test(row.text),
      );

    if (matched.length) {
      out.push({
        line: row.line,
        matched:
          matched.map((p) => p.name),
        text:
          row.text.trimEnd(),
      });
    }
  }

  return out;
}

function excerpt(
  source,
  line,
  before = 20,
  after = 40,
) {
  const lines = numberedLines(source);

  const start =
    Math.max(
      1,
      line - before,
    );

  const end =
    Math.min(
      lines.length,
      line + after,
    );

  return lines
    .slice(
      start - 1,
      end,
    );
}

function functionDeclarations(source) {
  const lines = numberedLines(source);
  const out = [];

  const tsRe =
    /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/;

  const sqlRe =
    /create\s+or\s+replace\s+function\s+([A-Za-z0-9_."]+)\s*\(/i;

  for (const row of lines) {
    const ts =
      tsRe.exec(row.text);

    if (ts) {
      out.push({
        type: "TS",
        line: row.line,
        name: ts[1],
        declaration:
          row.text.trim(),
      });
    }

    const sql =
      sqlRe.exec(row.text);

    if (sql) {
      out.push({
        type: "SQL",
        line: row.line,
        name:
          sql[1].replace(/"/g, ""),
        declaration:
          row.text.trim(),
      });
    }
  }

  return out;
}

function sqlFunctionBlock(
  source,
  functionName,
) {
  const lower =
    source.toLowerCase();

  const needle =
    `function ${functionName.toLowerCase()}(`;

  const start =
    lower.indexOf(needle);

  if (start < 0) {
    return null;
  }

  const prefixStart =
    Math.max(
      0,
      lower.lastIndexOf(
        "create or replace",
        start,
      ),
    );

  const tail =
    source.slice(prefixStart);

  const dollarEnd =
    /\$function\$\s*;/i.exec(tail);

  if (dollarEnd) {
    return tail.slice(
      0,
      dollarEnd.index +
        dollarEnd[0].length,
    );
  }

  const genericEnd =
    /\$\$\s*;/i.exec(tail);

  if (genericEnd) {
    return tail.slice(
      0,
      genericEnd.index +
        genericEnd[0].length,
    );
  }

  return tail;
}

const patterns = [
  {
    name: "EXECUTE_STOP_RPC",
    re: /execute_paper_stop_loss/i,
  },
  {
    name: "PAPER_POSITIONS",
    re: /paper_positions/i,
  },
  {
    name: "PAPER_ACCOUNTS",
    re: /paper_accounts/i,
  },
  {
    name: "PAPER_ORDERS",
    re: /paper_orders|paper_order_requests/i,
  },
  {
    name: "TRADE_HISTORY",
    re: /trade_history|paper_trade/i,
  },
  {
    name: "QUANTITY",
    re: /\bquantity\b/i,
  },
  {
    name: "CASH",
    re: /cash_balance/i,
  },
  {
    name: "REALIZED_PNL",
    re: /realized_pnl|daily_realized_pnl/i,
  },
  {
    name: "EXIT_PRICE",
    re: /exit_price|p_exit_price/i,
  },
  {
    name: "OBSERVED_AT",
    re: /observed_at|p_observed_at/i,
  },
  {
    name: "INSERT",
    re: /\binsert\s+into\b|\.insert\s*\(/i,
  },
  {
    name: "UPDATE",
    re: /\bupdate\b|\.update\s*\(/i,
  },
  {
    name: "DELETE",
    re: /\bdelete\s+from\b|\.delete\s*\(/i,
  },
  {
    name: "RPC",
    re: /\.rpc\s*\(/i,
  },
  {
    name: "STOP",
    re: /current_stop_price|stop_price|stop_loss/i,
  },
  {
    name: "TRAILING",
    re: /trailing/i,
  },
];

const files = [];

for (const rel of targets) {
  const loaded =
    read(rel);

  if (!loaded.exists) {
    files.push({
      file: rel,
      exists: false,
    });
    continue;
  }

  const source =
    loaded.source;

  const matches =
    collectMatches(
      source,
      patterns,
    );

  const anchors =
    matches.filter((m) =>
      m.matched.some((name) =>
        [
          "EXECUTE_STOP_RPC",
          "PAPER_POSITIONS",
          "PAPER_ACCOUNTS",
          "PAPER_ORDERS",
          "TRADE_HISTORY",
          "QUANTITY",
          "CASH",
          "REALIZED_PNL",
          "EXIT_PRICE",
          "RPC",
          "DELETE",
        ].includes(name),
      ),
    );

  files.push({
    file: rel,
    exists: true,
    lineCount:
      source
        .split(/\r?\n/)
        .length,
    functions:
      functionDeclarations(source),
    matches,
    excerpts:
      anchors
        .slice(0, 20)
        .map((m) => ({
          anchorLine: m.line,
          matched: m.matched,
          block:
            excerpt(
              source,
              m.line,
              18,
              35,
            ),
        })),
    executePaperStopLossFunction:
      rel.endsWith(
        "004_stop_loss_execution.sql",
      )
        ? sqlFunctionBlock(
            source,
            "public.execute_paper_stop_loss",
          ) ??
          sqlFunctionBlock(
            source,
            "execute_paper_stop_loss",
          )
        : null,
  });
}

const sqlFile =
  files.find((x) =>
    x.file.endsWith(
      "004_stop_loss_execution.sql",
    ),
  );

const stopFile =
  files.find((x) =>
    x.file.endsWith(
      "check-stop-losses.ts",
    ),
  );

const trailingFile =
  files.find((x) =>
    x.file.endsWith(
      "update-trailing-stops.ts",
    ),
  );

const summary = {
  status:
    "PAPER_EXECUTION_REALISM_V2_PROTECTIVE_SELL_EXACT_SOURCE_PROBE_V1_COMPLETE",

  files: files.map((x) => ({
    file: x.file,
    exists: x.exists,
    lineCount:
      x.lineCount ?? null,
    functions:
      (x.functions ?? [])
        .map((f) => ({
          line: f.line,
          name: f.name,
          type: f.type,
        })),
    keyLines:
      (x.matches ?? [])
        .filter((m) =>
          m.matched.some((name) =>
            [
              "EXECUTE_STOP_RPC",
              "PAPER_POSITIONS",
              "PAPER_ACCOUNTS",
              "PAPER_ORDERS",
              "TRADE_HISTORY",
              "QUANTITY",
              "CASH",
              "REALIZED_PNL",
              "EXIT_PRICE",
              "RPC",
            ].includes(name),
          ),
        )
        .slice(0, 18)
        .map((m) => ({
          line: m.line,
          matched: m.matched,
        })),
  })),

  facts: {
    stopLossSqlExists:
      Boolean(sqlFile?.exists),

    stopLossServiceExists:
      Boolean(stopFile?.exists),

    trailingServiceExists:
      Boolean(trailingFile?.exists),

    stopLossSqlFunctionCaptured:
      Boolean(
        sqlFile
          ?.executePaperStopLossFunction,
      ),

    stopLossServiceCallsRpc:
      Boolean(
        stopFile
          ?.matches
          ?.some((m) =>
            m.matched.includes("RPC"),
          ),
      ),

    trailingServiceCallsRpc:
      Boolean(
        trailingFile
          ?.matches
          ?.some((m) =>
            m.matched.includes("RPC"),
          ),
      ),
  },

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    networkCalls: 0,
    sourceFilesModified: 0,
    ordersCreated: 0,
    positionsChanged: 0,
  },

  nextGate:
    "BUILD_PROTECTIVE_SELL_REALISM_V2_BINDING_FROM_EXACT_SOURCE",

  details:
    "logs/paper-execution-realism-v2-protective-sell-exact-source-probe-v1.json",
};

fs.mkdirSync(
  path.resolve(root, "logs"),
  {
    recursive: true,
  },
);

fs.writeFileSync(
  path.resolve(
    root,
    summary.details,
  ),
  JSON.stringify(
    {
      ...summary,
      detailedFiles:
        files,
    },
    null,
    2,
  ) + "\n",
  "utf8",
);

console.log(
  JSON.stringify(
    summary,
    null,
    2,
  ),
);
