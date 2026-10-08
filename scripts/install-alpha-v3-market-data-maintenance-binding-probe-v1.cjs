const fs = require("fs");
const path = require("path");

const target =
  path.resolve(
    process.cwd(),
    "scripts/alpha-v3-market-data-maintenance-binding-probe-v1.cjs"
  );

fs.mkdirSync(
  path.dirname(target),
  { recursive: true }
);

fs.writeFileSync(
  target,
  "const fs = require(\"fs\");\nconst path = require(\"path\");\nconst ts = require(\"typescript\");\n\nconst root = process.cwd();\n\nconst targets = [\n  \"scripts/alpha-v3-automation-cycle-scheduler.ts\",\n  \"app/api/market/regime/v7/eod-sync/route.ts\",\n  \"app/api/market/regime/v7/freshness/capture/route.ts\",\n  \"app/api/market/regime/v7/quality-gate/capture/route.ts\",\n  \"app/api/trading/automation/run/route.ts\",\n  \"package.json\"\n];\n\nfunction read(rel) {\n  const abs = path.resolve(root, rel);\n\n  if (!fs.existsSync(abs)) {\n    return null;\n  }\n\n  return fs.readFileSync(abs, \"utf8\");\n}\n\nfunction parse(rel, text) {\n  return ts.createSourceFile(\n    rel,\n    text,\n    ts.ScriptTarget.Latest,\n    true,\n    rel.endsWith(\".tsx\")\n      ? ts.ScriptKind.TSX\n      : ts.ScriptKind.TS\n  );\n}\n\nfunction excerpt(text, lineIndex, radius = 8) {\n  const lines = text.split(/\\r?\\n/);\n  const start = Math.max(0, lineIndex - radius);\n  const end = Math.min(lines.length, lineIndex + radius + 1);\n\n  return lines\n    .slice(start, end)\n    .map(\n      (line, index) =>\n        `${start + index + 1}: ${line}`\n    )\n    .join(\"\\n\");\n}\n\nconst report = {\n  status:\n    \"ALPHA_V3_MARKET_DATA_MAINTENANCE_BINDING_PROBE_V1_COMPLETE\",\n\n  files: [],\n\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    networkCalls: 0,\n    ordersCreated: 0,\n    positionsChanged: 0\n  },\n\n  logFile:\n    \"logs/alpha-v3-market-data-maintenance-binding-probe-v1.json\",\n\n  nextGate:\n    \"BUILD_DAILY_MARKET_DATA_MAINTENANCE_SCHEDULER_V1\"\n};\n\nfor (const rel of targets) {\n  const text = read(rel);\n\n  if (text === null) {\n    report.files.push({\n      file: rel,\n      exists: false\n    });\n    continue;\n  }\n\n  if (rel === \"package.json\") {\n    let parsed = null;\n\n    try {\n      parsed = JSON.parse(text);\n    } catch {}\n\n    report.files.push({\n      file: rel,\n      exists: true,\n      scripts:\n        parsed?.scripts ?? null\n    });\n\n    continue;\n  }\n\n  const sf = parse(rel, text);\n\n  const functions = [];\n  const imports = [];\n  const fetchCalls = [];\n  const envNames = new Set();\n  const stringLiterals = [];\n  const bodySignals = [];\n\n  for (const statement of sf.statements) {\n    if (\n      ts.isImportDeclaration(statement) &&\n      ts.isStringLiteral(statement.moduleSpecifier)\n    ) {\n      imports.push(\n        statement.moduleSpecifier.text\n      );\n    }\n  }\n\n  function visit(node) {\n    if (\n      ts.isFunctionDeclaration(node) &&\n      node.name\n    ) {\n      functions.push({\n        name:\n          node.name.text,\n\n        line:\n          sf.getLineAndCharacterOfPosition(\n            node.getStart(sf)\n          ).line + 1\n      });\n    }\n\n    if (\n      ts.isCallExpression(node)\n    ) {\n      const expr =\n        node.expression.getText(sf);\n\n      if (\n        expr === \"fetch\" ||\n        expr.endsWith(\".fetch\")\n      ) {\n        const line =\n          sf.getLineAndCharacterOfPosition(\n            node.getStart(sf)\n          ).line;\n\n        fetchCalls.push({\n          line:\n            line + 1,\n\n          excerpt:\n            excerpt(\n              text,\n              line,\n              10\n            )\n        });\n      }\n    }\n\n    if (\n      ts.isPropertyAccessExpression(node) &&\n      node.expression.getText(sf) ===\n        \"process.env\"\n    ) {\n      envNames.add(\n        node.name.text\n      );\n    }\n\n    if (\n      ts.isStringLiteralLike(node)\n    ) {\n      const value =\n        node.text;\n\n      if (\n        /api\\/|secret|token|authorization|localhost|127\\.0\\.0\\.1|cron|schedule|autoOrder|lookback|market|fresh|quality/i.test(\n          value\n        )\n      ) {\n        stringLiterals.push(\n          value\n        );\n      }\n    }\n\n    ts.forEachChild(\n      node,\n      visit\n    );\n  }\n\n  visit(sf);\n\n  const lines =\n    text.split(/\\r?\\n/);\n\n  for (\n    let i = 0;\n    i < lines.length;\n    i += 1\n  ) {\n    if (\n      /request\\.json|await\\s+request\\.json|authorization|secret|token|lookback|expectedMarketDate|autoOrder|productionApplied|POST\\b|NextResponse|NextRequest/i.test(\n        lines[i]\n      )\n    ) {\n      bodySignals.push({\n        line:\n          i + 1,\n\n        text:\n          lines[i].trim(),\n\n        excerpt:\n          excerpt(\n            text,\n            i,\n            5\n          )\n      });\n    }\n  }\n\n  report.files.push({\n    file: rel,\n    exists: true,\n    functions,\n    imports,\n    fetchCalls,\n    envNames:\n      [...envNames],\n    stringLiterals:\n      [...new Set(stringLiterals)]\n        .slice(0, 80),\n    bodySignals:\n      bodySignals.slice(0, 80)\n  });\n}\n\nfs.mkdirSync(\n  path.resolve(root, \"logs\"),\n  { recursive: true }\n);\n\nfs.writeFileSync(\n  path.resolve(\n    root,\n    report.logFile\n  ),\n  JSON.stringify(\n    report,\n    null,\n    2\n  ) + \"\\n\",\n  \"utf8\"\n);\n\nconsole.log(\n  JSON.stringify(\n    {\n      status:\n        report.status,\n\n      files:\n        report.files.map(\n          (item) => ({\n            file:\n              item.file,\n\n            exists:\n              item.exists,\n\n            functions:\n              item.functions ?? [],\n\n            envNames:\n              item.envNames ?? [],\n\n            fetchCallCount:\n              item.fetchCalls?.length ?? 0,\n\n            notableStrings:\n              (\n                item.stringLiterals ?? []\n              ).slice(0, 20),\n\n            scripts:\n              item.scripts\n                ? Object.fromEntries(\n                    Object.entries(\n                      item.scripts\n                    ).filter(\n                      ([key]) =>\n                        /automation|scheduler|market|eod|fresh|quality/i.test(\n                          key\n                        )\n                    )\n                  )\n                : undefined\n          })\n        ),\n\n      logFile:\n        report.logFile,\n\n      nextGate:\n        report.nextGate\n    },\n    null,\n    2\n  )\n);\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_MARKET_DATA_MAINTENANCE_BINDING_PROBE_V1_INSTALLED",

      generatedFile:
        "scripts/alpha-v3-market-data-maintenance-binding-probe-v1.cjs",

      scope: [
        "AUTOMATION_SCHEDULER",
        "EOD_SYNC_ROUTE",
        "FRESHNESS_CAPTURE_ROUTE",
        "QUALITY_GATE_CAPTURE_ROUTE",
        "AUTOMATION_RUN_ROUTE",
        "PACKAGE_SCRIPTS"
      ],

      purpose:
        "RESOLVE_AUTH_BODY_AND_CALL_PATTERN_BEFORE_BUILDING_DAILY_MARKET_DATA_MAINTENANCE_SCHEDULER",

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        networkCalls: 0,
        ordersCreated: 0,
        positionsChanged: 0
      },

      nextAction:
        "RUN_MARKET_DATA_MAINTENANCE_BINDING_PROBE"
    },
    null,
    2
  )
);
