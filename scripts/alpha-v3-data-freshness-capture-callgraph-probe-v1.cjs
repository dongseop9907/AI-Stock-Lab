const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const root = process.cwd();

const seeds = [
  "app/api/market/regime/v7/eod-sync/route.ts",
  "app/api/market/regime/v7/freshness/capture/route.ts",
  "app/api/market/regime/v7/quality-gate/capture/route.ts",
  "lib/market/run-market-eod-sync-v7-8.ts",
  "lib/market/capture-market-data-freshness-v7-7.ts",
  "lib/market/capture-market-data-quality-gate-v7-10.ts",
  "lib/market/get-market-data-freshness-v7-7.ts",
  "lib/market/get-market-data-quality-gate-v7-10.ts",
  "lib/market/sync-index-daily-bars.ts"
];

const schedulerFiles = [
  "vercel.json",
  "package.json",
  ".github/workflows"
];

function exists(rel) {
  return fs.existsSync(path.resolve(root, rel));
}

function read(rel) {
  const abs = path.resolve(root, rel);

  if (!fs.existsSync(abs)) {
    return null;
  }

  return fs.readFileSync(abs, "utf8");
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];

  const out = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      out.push(...walk(abs));
      continue;
    }

    if (entry.isFile()) {
      out.push(abs);
    }
  }

  return out;
}

function rel(abs) {
  return path.relative(root, abs).replace(/\\/g, "/");
}

function resolveLocalImport(fromRel, spec) {
  if (
    !spec.startsWith(".") &&
    !spec.startsWith("@/")
  ) {
    return null;
  }

  let base;

  if (spec.startsWith("@/")) {
    base = path.resolve(root, spec.slice(2));
  } else {
    base = path.resolve(
      path.dirname(path.resolve(root, fromRel)),
      spec
    );
  }

  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.cjs`,
    `${base}.mjs`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
    path.join(base, "index.js")
  ];

  for (const candidate of candidates) {
    if (
      fs.existsSync(candidate) &&
      fs.statSync(candidate).isFile()
    ) {
      return rel(candidate);
    }
  }

  return null;
}

function parseFile(fileRel) {
  const text = read(fileRel);

  if (text === null) {
    return {
      file: fileRel,
      exists: false
    };
  }

  const sf = ts.createSourceFile(
    fileRel,
    text,
    ts.ScriptTarget.Latest,
    true,
    fileRel.endsWith(".tsx")
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS
  );

  const imports = [];
  const functions = [];
  const calls = [];
  const tableOps = [];
  const rpcCalls = [];
  const fetchCalls = [];
  const dateSignals = [];
  const envSignals = [];

  for (const statement of sf.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      const spec =
        statement.moduleSpecifier.text;

      imports.push({
        spec,
        resolved:
          resolveLocalImport(
            fileRel,
            spec
          )
      });
    }
  }

  function visit(node) {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name
    ) {
      functions.push(node.name.text);
    }

    if (ts.isCallExpression(node)) {
      const exprText =
        node.expression.getText(sf);

      calls.push(exprText);

      if (
        ts.isPropertyAccessExpression(node.expression)
      ) {
        const method =
          node.expression.name.text;

        if (
          ["insert", "upsert", "update", "select", "order", "limit", "maybeSingle", "single", "rpc"].includes(method)
        ) {
          const parentText =
            node.expression.expression.getText(sf);

          tableOps.push({
            method,
            receiver:
              parentText.slice(0, 220)
          });
        }

        if (
          method === "rpc" &&
          node.arguments[0] &&
          ts.isStringLiteralLike(
            node.arguments[0]
          )
        ) {
          rpcCalls.push(
            node.arguments[0].text
          );
        }
      }

      if (
        exprText === "fetch" ||
        exprText.endsWith(".fetch")
      ) {
        fetchCalls.push(
          node.getText(sf).slice(0, 500)
        );
      }
    }

    const nodeText =
      node.getText(sf);

    if (
      /expectedMarketDate|expected_market_date|businessWeekdayLag|business_weekday_lag|Asia\/Seoul|KST|holiday|calendar/i.test(
        nodeText
      )
    ) {
      if (
        dateSignals.length < 80
      ) {
        dateSignals.push(
          nodeText.slice(0, 500)
        );
      }
    }

    if (
      /process\.env\.[A-Z0-9_]+/.test(
        nodeText
      )
    ) {
      const matches =
        nodeText.match(
          /process\.env\.([A-Z0-9_]+)/g
        ) || [];

      for (const item of matches) {
        envSignals.push(
          item.replace(
            "process.env.",
            ""
          )
        );
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sf);

  const contentSignals = {
    freshnessTable:
      text.includes(
        "market_data_freshness_observations"
      ),

    qualityTable:
      text.includes(
        "market_data_quality_gate_observations"
      ),

    eodSyncTable:
      text.includes(
        "market_eod_sync_runs"
      ),

    freshnessCaptureCall:
      /captureMarketDataFreshness|capture_market_data_freshness/i.test(
        text
      ),

    qualityCaptureCall:
      /captureMarketDataQualityGate|capture_market_data_quality_gate/i.test(
        text
      ),

    eodSyncCall:
      /runMarketEodSync|run_market_eod_sync/i.test(
        text
      ),

    insertMention:
      /\.insert\(|\binsert\s+into\b/i.test(
        text
      ),

    upsertMention:
      /\.upsert\(|\bupsert\b/i.test(
        text
      )
  };

  return {
    file:
      fileRel,

    exists:
      true,

    imports,

    functions:
      [...new Set(functions)],

    calls:
      [...new Set(calls)]
        .filter(
          (name) =>
            /capture|fresh|quality|sync|market|calendar|date|insert|upsert|repository|repo|store|save|persist/i.test(
              name
            )
        )
        .slice(0, 100),

    tableOps:
      tableOps.slice(0, 100),

    rpcCalls:
      [...new Set(rpcCalls)],

    fetchCalls:
      fetchCalls.slice(0, 20),

    dateSignals:
      [...new Set(dateSignals)]
        .slice(0, 40),

    envSignals:
      [...new Set(envSignals)],

    contentSignals
  };
}

const queue =
  seeds.map(
    (file) => ({
      file,
      depth: 0,
      parent: null
    })
  );

const visited =
  new Set();

const nodes = [];

while (queue.length > 0) {
  const item =
    queue.shift();

  if (
    !item ||
    visited.has(item.file)
  ) {
    continue;
  }

  visited.add(item.file);

  const info =
    parseFile(item.file);

  nodes.push({
    ...info,
    depth:
      item.depth,

    parent:
      item.parent
  });

  if (
    info.exists &&
    item.depth < 2
  ) {
    for (const imp of info.imports) {
      if (
        imp.resolved &&
        !visited.has(
          imp.resolved
        )
      ) {
        queue.push({
          file:
            imp.resolved,

          depth:
            item.depth + 1,

          parent:
            item.file
        });
      }
    }
  }
}

const schedulerHits = [];

for (const target of schedulerFiles) {
  const abs =
    path.resolve(root, target);

  if (!fs.existsSync(abs)) {
    continue;
  }

  const paths =
    fs.statSync(abs).isDirectory()
      ? walk(abs)
      : [abs];

  for (const file of paths) {
    const text =
      fs.readFileSync(file, "utf8");

    if (
      /cron|schedule|eod-sync|freshness\/capture|quality-gate\/capture|automation\/run/i.test(
        text
      )
    ) {
      schedulerHits.push({
        file:
          rel(file),

        mentions:
          text
            .split(/\r?\n/)
            .map(
              (line, index) => ({
                line:
                  index + 1,

                text:
                  line.trim()
              })
            )
            .filter(
              (item) =>
                /cron|schedule|eod-sync|freshness\/capture|quality-gate\/capture|automation\/run/i.test(
                  item.text
                )
            )
            .slice(0, 50)
      });
    }
  }
}

const likelyWriters =
  nodes
    .filter(
      (node) =>
        node.exists &&
        (
          node.contentSignals?.insertMention ||
          node.contentSignals?.upsertMention ||
          (
            node.tableOps ?? []
          ).some(
            (op) =>
              ["insert", "upsert", "update"].includes(
                op.method
              )
          ) ||
          (
            node.calls ?? []
          ).some(
            (call) =>
              /save|persist|store|insert|upsert|repository|repo/i.test(
                call
              )
          )
        )
    )
    .map(
      (node) => ({
        file:
          node.file,

        depth:
          node.depth,

        parent:
          node.parent,

        calls:
          node.calls,

        tableOps:
          node.tableOps,

        contentSignals:
          node.contentSignals
      })
    );

const seedSummaries =
  nodes
    .filter(
      (node) =>
        node.depth === 0
    )
    .map(
      (node) => ({
        file:
          node.file,

        exists:
          node.exists,

        functions:
          node.functions ?? [],

        localImports:
          (
            node.imports ?? []
          )
            .filter(
              (imp) =>
                imp.resolved
            )
            .map(
              (imp) =>
                imp.resolved
            ),

        calls:
          node.calls ?? [],

        contentSignals:
          node.contentSignals ?? null
      })
    );

const report = {
  status:
    "ALPHA_V3_DATA_FRESHNESS_CAPTURE_CALLGRAPH_PROBE_V1_COMPLETE",

  summary: {
    seedCount:
      seeds.length,

    visitedNodeCount:
      nodes.length,

    likelyWriterCount:
      likelyWriters.length,

    schedulerHitFileCount:
      schedulerHits.length,

    missingSeedCount:
      seedSummaries.filter(
        (item) =>
          !item.exists
      ).length
  },

  seedSummaries,
  likelyWriters,
  schedulerHits,
  nodes,

  classificationHints: {
    captureCodeExists:
      seedSummaries.some(
        (item) =>
          item.file.includes(
            "capture-market-data-freshness"
          ) &&
          item.exists
      ) &&
      seedSummaries.some(
        (item) =>
          item.file.includes(
            "capture-market-data-quality-gate"
          ) &&
          item.exists
      ),

    eodSyncCodeExists:
      seedSummaries.some(
        (item) =>
          item.file.includes(
            "run-market-eod-sync"
          ) &&
          item.exists
      ),

    schedulerBindingFound:
      schedulerHits.some(
        (item) =>
          item.mentions.some(
            (m) =>
              /eod-sync|freshness\/capture|quality-gate\/capture/i.test(
                m.text
              )
          )
      ),

    hiddenWriterLayerFound:
      likelyWriters.length > 0
  },

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    networkCalls: 0,
    ordersCreated: 0,
    positionsChanged: 0
  },

  logFile:
    "logs/alpha-v3-data-freshness-capture-callgraph-probe-v1.json",

  nextGate:
    "CLASSIFY_EOD_VS_CAPTURE_VS_SCHEDULER_ROOT_CAUSE_V1"
};

const logAbs =
  path.resolve(
    root,
    report.logFile
  );

fs.mkdirSync(
  path.dirname(logAbs),
  {
    recursive: true
  }
);

fs.writeFileSync(
  logAbs,
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

      classificationHints:
        report.classificationHints,

      seeds:
        report.seedSummaries,

      likelyWriters:
        report.likelyWriters.slice(
          0,
          20
        ),

      schedulerHits:
        report.schedulerHits.slice(
          0,
          20
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
