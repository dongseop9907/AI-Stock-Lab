const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const root = process.cwd();

const targets = [
  "scripts/alpha-v3-automation-cycle-scheduler.ts",
  "app/api/market/regime/v7/eod-sync/route.ts",
  "app/api/market/regime/v7/freshness/capture/route.ts",
  "app/api/market/regime/v7/quality-gate/capture/route.ts",
  "app/api/trading/automation/run/route.ts",
  "package.json"
];

function read(rel) {
  const abs = path.resolve(root, rel);

  if (!fs.existsSync(abs)) {
    return null;
  }

  return fs.readFileSync(abs, "utf8");
}

function parse(rel, text) {
  return ts.createSourceFile(
    rel,
    text,
    ts.ScriptTarget.Latest,
    true,
    rel.endsWith(".tsx")
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS
  );
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

const report = {
  status:
    "ALPHA_V3_MARKET_DATA_MAINTENANCE_BINDING_PROBE_V1_COMPLETE",

  files: [],

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    networkCalls: 0,
    ordersCreated: 0,
    positionsChanged: 0
  },

  logFile:
    "logs/alpha-v3-market-data-maintenance-binding-probe-v1.json",

  nextGate:
    "BUILD_DAILY_MARKET_DATA_MAINTENANCE_SCHEDULER_V1"
};

for (const rel of targets) {
  const text = read(rel);

  if (text === null) {
    report.files.push({
      file: rel,
      exists: false
    });
    continue;
  }

  if (rel === "package.json") {
    let parsed = null;

    try {
      parsed = JSON.parse(text);
    } catch {}

    report.files.push({
      file: rel,
      exists: true,
      scripts:
        parsed?.scripts ?? null
    });

    continue;
  }

  const sf = parse(rel, text);

  const functions = [];
  const imports = [];
  const fetchCalls = [];
  const envNames = new Set();
  const stringLiterals = [];
  const bodySignals = [];

  for (const statement of sf.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      imports.push(
        statement.moduleSpecifier.text
      );
    }
  }

  function visit(node) {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name
    ) {
      functions.push({
        name:
          node.name.text,

        line:
          sf.getLineAndCharacterOfPosition(
            node.getStart(sf)
          ).line + 1
      });
    }

    if (
      ts.isCallExpression(node)
    ) {
      const expr =
        node.expression.getText(sf);

      if (
        expr === "fetch" ||
        expr.endsWith(".fetch")
      ) {
        const line =
          sf.getLineAndCharacterOfPosition(
            node.getStart(sf)
          ).line;

        fetchCalls.push({
          line:
            line + 1,

          excerpt:
            excerpt(
              text,
              line,
              10
            )
        });
      }
    }

    if (
      ts.isPropertyAccessExpression(node) &&
      node.expression.getText(sf) ===
        "process.env"
    ) {
      envNames.add(
        node.name.text
      );
    }

    if (
      ts.isStringLiteralLike(node)
    ) {
      const value =
        node.text;

      if (
        /api\/|secret|token|authorization|localhost|127\.0\.0\.1|cron|schedule|autoOrder|lookback|market|fresh|quality/i.test(
          value
        )
      ) {
        stringLiterals.push(
          value
        );
      }
    }

    ts.forEachChild(
      node,
      visit
    );
  }

  visit(sf);

  const lines =
    text.split(/\r?\n/);

  for (
    let i = 0;
    i < lines.length;
    i += 1
  ) {
    if (
      /request\.json|await\s+request\.json|authorization|secret|token|lookback|expectedMarketDate|autoOrder|productionApplied|POST\b|NextResponse|NextRequest/i.test(
        lines[i]
      )
    ) {
      bodySignals.push({
        line:
          i + 1,

        text:
          lines[i].trim(),

        excerpt:
          excerpt(
            text,
            i,
            5
          )
      });
    }
  }

  report.files.push({
    file: rel,
    exists: true,
    functions,
    imports,
    fetchCalls,
    envNames:
      [...envNames],
    stringLiterals:
      [...new Set(stringLiterals)]
        .slice(0, 80),
    bodySignals:
      bodySignals.slice(0, 80)
  });
}

fs.mkdirSync(
  path.resolve(root, "logs"),
  { recursive: true }
);

fs.writeFileSync(
  path.resolve(
    root,
    report.logFile
  ),
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

      files:
        report.files.map(
          (item) => ({
            file:
              item.file,

            exists:
              item.exists,

            functions:
              item.functions ?? [],

            envNames:
              item.envNames ?? [],

            fetchCallCount:
              item.fetchCalls?.length ?? 0,

            notableStrings:
              (
                item.stringLiterals ?? []
              ).slice(0, 20),

            scripts:
              item.scripts
                ? Object.fromEntries(
                    Object.entries(
                      item.scripts
                    ).filter(
                      ([key]) =>
                        /automation|scheduler|market|eod|fresh|quality/i.test(
                          key
                        )
                    )
                  )
                : undefined
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
