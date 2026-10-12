const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const root = process.cwd();

const routeRel =
  "app/api/market/regime/v7/integrity/route.ts";

function abs(rel) {
  return path.resolve(root, rel);
}

function exists(rel) {
  return fs.existsSync(abs(rel));
}

function read(rel) {
  return fs.readFileSync(
    abs(rel),
    "utf8"
  );
}

function resolveLocalImport(
  fromRel,
  spec
) {
  if (
    !spec.startsWith(".") &&
    !spec.startsWith("@/")
  ) {
    return null;
  }

  let base;

  if (spec.startsWith("@/")) {
    base =
      path.resolve(
        root,
        spec.slice(2)
      );
  } else {
    base =
      path.resolve(
        path.dirname(
          abs(fromRel)
        ),
        spec
      );
  }

  const candidates = [
    base,
    base + ".ts",
    base + ".tsx",
    base + ".js",
    base + ".cjs",
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
    path.join(base, "index.js")
  ];

  for (const candidate of candidates) {
    if (
      fs.existsSync(candidate) &&
      fs.statSync(candidate).isFile()
    ) {
      return path
        .relative(root, candidate)
        .replace(/\\/g, "/");
    }
  }

  return null;
}

function analyze(rel) {
  if (!exists(rel)) {
    return {
      file: rel,
      exists: false
    };
  }

  const text =
    read(rel);

  const sf =
    ts.createSourceFile(
      rel,
      text,
      ts.ScriptTarget.Latest,
      true,
      rel.endsWith(".tsx")
        ? ts.ScriptKind.TSX
        : ts.ScriptKind.TS
    );

  const imports = [];
  const functions = [];
  const calls = [];
  const envNames = new Set();
  const stringLiterals = [];
  const requestJsonLines = [];

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
            rel,
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
      functions.push({
        name:
          node.name.text,
        line:
          sf.getLineAndCharacterOfPosition(
            node.getStart(sf)
          ).line + 1
      });
    }

    if (ts.isCallExpression(node)) {
      const expr =
        node.expression.getText(sf);

      if (
        /integrity|scan|request\.json|supabase|insert|update|select|capture|run/i.test(
          expr
        )
      ) {
        calls.push(
          expr
        );
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

    if (ts.isStringLiteralLike(node)) {
      const value =
        node.text;

      if (
        /integrity|window|lookback|market|date|scan|warning|error|production|api\//i.test(
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
      /request\.json|await\s+request\.json|window|lookback|days|scan|integrity|POST\b|NextResponse|productionApplied/i.test(
        lines[i]
      )
    ) {
      requestJsonLines.push({
        line:
          i + 1,
        text:
          lines[i].trim()
      });
    }
  }

  return {
    file:
      rel,
    exists:
      true,
    imports,
    functions,
    calls:
      [...new Set(calls)],
    envNames:
      [...envNames],
    stringLiterals:
      [...new Set(stringLiterals)]
        .slice(0, 100),
    requestJsonLines:
      requestJsonLines.slice(0, 120),
    sourcePreview:
      lines
        .slice(0, 220)
        .map(
          (line, index) =>
            `${index + 1}: ${line}`
        )
  };
}

const route =
  analyze(
    routeRel
  );

const importedFiles =
  (route.imports ?? [])
    .map(
      (item) =>
        item.resolved
    )
    .filter(Boolean);

const imported =
  importedFiles.map(
    (file) =>
      analyze(file)
  );

const report = {
  status:
    "ALPHA_V3_MARKET_INTEGRITY_BINDING_PROBE_V1_COMPLETE",

  route,
  imported,

  classification: {
    routeExists:
      route.exists === true,

    hasPost:
      (
        route.functions ?? []
      ).some(
        (item) =>
          item.name === "POST"
      ),

    parsesJsonBody:
      (
        route.requestJsonLines ?? []
      ).some(
        (item) =>
          /request\.json/.test(
            item.text
          )
      ),

    hasLocalImplementation:
      importedFiles.length > 0,

    likelyNoAuthEnv:
      (
        route.envNames ?? []
      ).length === 0
  },

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    networkCalls: 0,
    ordersCreated: 0,
    positionsChanged: 0
  },

  logFile:
    "logs/alpha-v3-market-integrity-binding-probe-v1.json",

  nextGate:
    "PATCH_MARKET_DATA_MAINTENANCE_V2_WITH_INTEGRITY_AND_POST_1630_WINDOW"
};

fs.mkdirSync(
  path.resolve(
    root,
    "logs"
  ),
  {
    recursive: true
  }
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

      classification:
        report.classification,

      route: {
        file:
          route.file,
        functions:
          route.functions,
        imports:
          route.imports,
        envNames:
          route.envNames,
        calls:
          route.calls,
        notableStrings:
          route.stringLiterals,
        bodySignals:
          route.requestJsonLines
      },

      imported:
        imported.map(
          (item) => ({
            file:
              item.file,
            functions:
              item.functions,
            calls:
              item.calls,
            envNames:
              item.envNames,
            notableStrings:
              item.stringLiterals
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
