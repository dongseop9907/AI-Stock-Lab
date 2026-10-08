const fs = require("fs");
const path = require("path");

const target =
  path.resolve(
    process.cwd(),
    "scripts/alpha-v3-market-integrity-binding-probe-v1.cjs"
  );

fs.mkdirSync(
  path.dirname(target),
  {
    recursive: true
  }
);

fs.writeFileSync(
  target,
  "const fs = require(\"fs\");\nconst path = require(\"path\");\nconst ts = require(\"typescript\");\n\nconst root = process.cwd();\n\nconst routeRel =\n  \"app/api/market/regime/v7/integrity/route.ts\";\n\nfunction abs(rel) {\n  return path.resolve(root, rel);\n}\n\nfunction exists(rel) {\n  return fs.existsSync(abs(rel));\n}\n\nfunction read(rel) {\n  return fs.readFileSync(\n    abs(rel),\n    \"utf8\"\n  );\n}\n\nfunction resolveLocalImport(\n  fromRel,\n  spec\n) {\n  if (\n    !spec.startsWith(\".\") &&\n    !spec.startsWith(\"@/\")\n  ) {\n    return null;\n  }\n\n  let base;\n\n  if (spec.startsWith(\"@/\")) {\n    base =\n      path.resolve(\n        root,\n        spec.slice(2)\n      );\n  } else {\n    base =\n      path.resolve(\n        path.dirname(\n          abs(fromRel)\n        ),\n        spec\n      );\n  }\n\n  const candidates = [\n    base,\n    base + \".ts\",\n    base + \".tsx\",\n    base + \".js\",\n    base + \".cjs\",\n    path.join(base, \"index.ts\"),\n    path.join(base, \"index.tsx\"),\n    path.join(base, \"index.js\")\n  ];\n\n  for (const candidate of candidates) {\n    if (\n      fs.existsSync(candidate) &&\n      fs.statSync(candidate).isFile()\n    ) {\n      return path\n        .relative(root, candidate)\n        .replace(/\\\\/g, \"/\");\n    }\n  }\n\n  return null;\n}\n\nfunction analyze(rel) {\n  if (!exists(rel)) {\n    return {\n      file: rel,\n      exists: false\n    };\n  }\n\n  const text =\n    read(rel);\n\n  const sf =\n    ts.createSourceFile(\n      rel,\n      text,\n      ts.ScriptTarget.Latest,\n      true,\n      rel.endsWith(\".tsx\")\n        ? ts.ScriptKind.TSX\n        : ts.ScriptKind.TS\n    );\n\n  const imports = [];\n  const functions = [];\n  const calls = [];\n  const envNames = new Set();\n  const stringLiterals = [];\n  const requestJsonLines = [];\n\n  for (const statement of sf.statements) {\n    if (\n      ts.isImportDeclaration(statement) &&\n      ts.isStringLiteral(statement.moduleSpecifier)\n    ) {\n      const spec =\n        statement.moduleSpecifier.text;\n\n      imports.push({\n        spec,\n        resolved:\n          resolveLocalImport(\n            rel,\n            spec\n          )\n      });\n    }\n  }\n\n  function visit(node) {\n    if (\n      ts.isFunctionDeclaration(node) &&\n      node.name\n    ) {\n      functions.push({\n        name:\n          node.name.text,\n        line:\n          sf.getLineAndCharacterOfPosition(\n            node.getStart(sf)\n          ).line + 1\n      });\n    }\n\n    if (ts.isCallExpression(node)) {\n      const expr =\n        node.expression.getText(sf);\n\n      if (\n        /integrity|scan|request\\.json|supabase|insert|update|select|capture|run/i.test(\n          expr\n        )\n      ) {\n        calls.push(\n          expr\n        );\n      }\n    }\n\n    if (\n      ts.isPropertyAccessExpression(node) &&\n      node.expression.getText(sf) ===\n        \"process.env\"\n    ) {\n      envNames.add(\n        node.name.text\n      );\n    }\n\n    if (ts.isStringLiteralLike(node)) {\n      const value =\n        node.text;\n\n      if (\n        /integrity|window|lookback|market|date|scan|warning|error|production|api\\//i.test(\n          value\n        )\n      ) {\n        stringLiterals.push(\n          value\n        );\n      }\n    }\n\n    ts.forEachChild(\n      node,\n      visit\n    );\n  }\n\n  visit(sf);\n\n  const lines =\n    text.split(/\\r?\\n/);\n\n  for (\n    let i = 0;\n    i < lines.length;\n    i += 1\n  ) {\n    if (\n      /request\\.json|await\\s+request\\.json|window|lookback|days|scan|integrity|POST\\b|NextResponse|productionApplied/i.test(\n        lines[i]\n      )\n    ) {\n      requestJsonLines.push({\n        line:\n          i + 1,\n        text:\n          lines[i].trim()\n      });\n    }\n  }\n\n  return {\n    file:\n      rel,\n    exists:\n      true,\n    imports,\n    functions,\n    calls:\n      [...new Set(calls)],\n    envNames:\n      [...envNames],\n    stringLiterals:\n      [...new Set(stringLiterals)]\n        .slice(0, 100),\n    requestJsonLines:\n      requestJsonLines.slice(0, 120),\n    sourcePreview:\n      lines\n        .slice(0, 220)\n        .map(\n          (line, index) =>\n            `${index + 1}: ${line}`\n        )\n  };\n}\n\nconst route =\n  analyze(\n    routeRel\n  );\n\nconst importedFiles =\n  (route.imports ?? [])\n    .map(\n      (item) =>\n        item.resolved\n    )\n    .filter(Boolean);\n\nconst imported =\n  importedFiles.map(\n    (file) =>\n      analyze(file)\n  );\n\nconst report = {\n  status:\n    \"ALPHA_V3_MARKET_INTEGRITY_BINDING_PROBE_V1_COMPLETE\",\n\n  route,\n  imported,\n\n  classification: {\n    routeExists:\n      route.exists === true,\n\n    hasPost:\n      (\n        route.functions ?? []\n      ).some(\n        (item) =>\n          item.name === \"POST\"\n      ),\n\n    parsesJsonBody:\n      (\n        route.requestJsonLines ?? []\n      ).some(\n        (item) =>\n          /request\\.json/.test(\n            item.text\n          )\n      ),\n\n    hasLocalImplementation:\n      importedFiles.length > 0,\n\n    likelyNoAuthEnv:\n      (\n        route.envNames ?? []\n      ).length === 0\n  },\n\n  safety: {\n    databaseReads: 0,\n    databaseWrites: 0,\n    networkCalls: 0,\n    ordersCreated: 0,\n    positionsChanged: 0\n  },\n\n  logFile:\n    \"logs/alpha-v3-market-integrity-binding-probe-v1.json\",\n\n  nextGate:\n    \"PATCH_MARKET_DATA_MAINTENANCE_V2_WITH_INTEGRITY_AND_POST_1630_WINDOW\"\n};\n\nfs.mkdirSync(\n  path.resolve(\n    root,\n    \"logs\"\n  ),\n  {\n    recursive: true\n  }\n);\n\nfs.writeFileSync(\n  path.resolve(\n    root,\n    report.logFile\n  ),\n  JSON.stringify(\n    report,\n    null,\n    2\n  ) + \"\\n\",\n  \"utf8\"\n);\n\nconsole.log(\n  JSON.stringify(\n    {\n      status:\n        report.status,\n\n      classification:\n        report.classification,\n\n      route: {\n        file:\n          route.file,\n        functions:\n          route.functions,\n        imports:\n          route.imports,\n        envNames:\n          route.envNames,\n        calls:\n          route.calls,\n        notableStrings:\n          route.stringLiterals,\n        bodySignals:\n          route.requestJsonLines\n      },\n\n      imported:\n        imported.map(\n          (item) => ({\n            file:\n              item.file,\n            functions:\n              item.functions,\n            calls:\n              item.calls,\n            envNames:\n              item.envNames,\n            notableStrings:\n              item.stringLiterals\n          })\n        ),\n\n      logFile:\n        report.logFile,\n\n      nextGate:\n        report.nextGate\n    },\n    null,\n    2\n  )\n);\n",
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_MARKET_INTEGRITY_BINDING_PROBE_V1_INSTALLED",

      generatedFile:
        "scripts/alpha-v3-market-integrity-binding-probe-v1.cjs",

      purpose:
        "RESOLVE_INTEGRITY_ROUTE_BODY_AND_IMPLEMENTATION_BEFORE_SCHEDULER_V2",

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        networkCalls: 0,
        ordersCreated: 0,
        positionsChanged: 0
      },

      nextAction:
        "RUN_MARKET_INTEGRITY_BINDING_PROBE"
    },
    null,
    2
  )
);
