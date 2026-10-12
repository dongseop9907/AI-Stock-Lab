const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const PACKAGE =
  path.join(
    ROOT,
    "package.json"
  );

const TARGET =
  path.join(
    ROOT,
    "scripts",
    "true-forward-oos-producer-import-safety-audit-v1.cjs"
  );

function fail(
  reason,
  extra = {}
) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_IMPORT_SAFETY_AUDIT_V1_INSTALL_FAILED",

        reason,
        ...extra,
      },
      null,
      2
    )
  );

  process.exitCode = 1;
}

const required = [
  "scripts/alpha-v3-true-forward-top1-producer-v1.ts",
  "package.json",
];

const missing =
  required.filter(
    rel =>
      !fs.existsSync(
        path.join(
          ROOT,
          rel
        )
      )
  );

if (
  missing.length > 0
) {
  fail(
    "REQUIRED_FILES_MISSING",
    {
      missing,
    }
  );
} else {
  fs.writeFileSync(
    TARGET,
    "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst ROOT = process.cwd();\n\nconst TARGET_REL =\n  \"scripts/alpha-v3-true-forward-top1-producer-v1.ts\";\n\nconst TARGET =\n  path.join(\n    ROOT,\n    TARGET_REL\n  );\n\nfunction collect(\n  lines,\n  predicate,\n  limit = 30\n) {\n  const out = [];\n\n  for (\n    let i = 0;\n    i < lines.length;\n    i++\n  ) {\n    if (\n      predicate(\n        lines[i],\n        i\n      )\n    ) {\n      out.push({\n        line:\n          i + 1,\n\n        text:\n          lines[i].trim(),\n      });\n\n      if (\n        out.length >=\n        limit\n      ) {\n        break;\n      }\n    }\n  }\n\n  return out;\n}\n\nfunction sliceWindow(\n  lines,\n  center,\n  before = 8,\n  after = 16\n) {\n  const start =\n    Math.max(\n      1,\n      center - before\n    );\n\n  const end =\n    Math.min(\n      lines.length,\n      center + after\n    );\n\n  const selected = [];\n\n  for (\n    let n = start;\n    n <= end;\n    n++\n  ) {\n    selected.push({\n      line:\n        n,\n\n      text:\n        lines[n - 1],\n    });\n  }\n\n  return {\n    startLine:\n      start,\n\n    endLine:\n      end,\n\n    lines:\n      selected,\n  };\n}\n\nif (\n  !fs.existsSync(\n    TARGET\n  )\n) {\n  console.error(\n    JSON.stringify(\n      {\n        status:\n          \"AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_IMPORT_SAFETY_AUDIT_V1_FAILED\",\n\n        reason:\n          \"PRODUCER_NOT_FOUND\",\n      },\n      null,\n      2\n    )\n  );\n\n  process.exitCode = 1;\n} else {\n  const source =\n    fs.readFileSync(\n      TARGET,\n      \"utf8\"\n    );\n\n  const lines =\n    source.split(/\\r?\\n/);\n\n  const mainDefinitions =\n    collect(\n      lines,\n      line =>\n        /^\\s*(?:export\\s+)?(?:async\\s+)?function\\s+main\\s*\\(/.test(\n          line\n        )\n    );\n\n  const mainInvocations =\n    collect(\n      lines,\n      line =>\n        !/function\\s+main\\s*\\(/.test(\n          line\n        ) &&\n        (\n          /\\bmain\\s*\\(\\s*\\)\\s*\\.catch\\s*\\(/.test(\n            line\n          ) ||\n          /^\\s*(?:void\\s+)?main\\s*\\(\\s*\\)\\s*;?\\s*$/.test(\n            line\n          ) ||\n          /^\\s*await\\s+main\\s*\\(\\s*\\)\\s*;?\\s*$/.test(\n            line\n          )\n        )\n    );\n\n  const importMetaGuards =\n    collect(\n      lines,\n      line =>\n        /import\\.meta\\.url|pathToFileURL|fileURLToPath/.test(\n          line\n        )\n    );\n\n  const requireMainGuards =\n    collect(\n      lines,\n      line =>\n        /require\\.main\\s*===\\s*module|module\\s*===\\s*require\\.main/.test(\n          line\n        )\n    );\n\n  const argvEntryGuards =\n    collect(\n      lines,\n      line =>\n        /process\\.argv\\s*\\[\\s*1\\s*\\]|process\\.argv\\.at\\s*\\(\\s*1\\s*\\)/.test(\n          line\n        )\n    );\n\n  const nextExpectedDefinitions =\n    collect(\n      lines,\n      line =>\n        /export\\s+function\\s+nextExpectedKrxOpenDate\\s*\\(/.test(\n          line\n        )\n    );\n\n  const nextExpectedLine =\n    nextExpectedDefinitions[0]\n      ?.line ??\n    null;\n\n  const nextExpectedWindow =\n    nextExpectedLine\n      ? sliceWindow(\n          lines,\n          nextExpectedLine,\n          5,\n          22\n        )\n      : null;\n\n  const mainCallLine =\n    mainInvocations[0]\n      ?.line ??\n    null;\n\n  const mainCallWindow =\n    mainCallLine\n      ? sliceWindow(\n          lines,\n          mainCallLine,\n          12,\n          12\n        )\n      : null;\n\n  const hasEntrypointGuard =\n    importMetaGuards.length >\n      0 ||\n    requireMainGuards.length >\n      0 ||\n    argvEntryGuards.length >\n      0;\n\n  const autoMainInvocation =\n    mainInvocations.length >\n      0;\n\n  const importSafe =\n    !autoMainInvocation ||\n    hasEntrypointGuard;\n\n  const nextExpectedLooksPure =\n    Boolean(\n      nextExpectedWindow &&\n      nextExpectedWindow.lines.some(\n        item =>\n          /nextKrxTradingDate\\s*\\(/.test(\n            item.text\n          )\n      ) &&\n      !nextExpectedWindow.lines.some(\n        item =>\n          /(writeFile|insert\\s*\\(|update\\s*\\(|upsert\\s*\\(|delete\\s*\\(|fetch\\s*\\(|createClient|supabase)/i.test(\n            item.text\n          )\n      )\n    );\n\n  const checks = {\n    producerExists:\n      true,\n\n    mainDefinitionFound:\n      mainDefinitions.length >\n      0,\n\n    topLevelMainInvocationFound:\n      autoMainInvocation,\n\n    entrypointGuardFound:\n      hasEntrypointGuard,\n\n    moduleImportSafe:\n      importSafe,\n\n    nextExpectedKrxOpenDateExportFound:\n      nextExpectedDefinitions.length >\n      0,\n\n    nextExpectedKrxOpenDateLooksPure:\n      nextExpectedLooksPure,\n  };\n\n  let readiness;\n\n  if (\n    importSafe &&\n    nextExpectedLooksPure\n  ) {\n    readiness =\n      \"IMPORT_SAFE_PURE_EXPORT_WRAPPER_CAN_PROCEED\";\n  } else if (\n    !importSafe &&\n    nextExpectedLooksPure\n  ) {\n    readiness =\n      \"PURE_EXPORT_EXISTS_BUT_MODULE_IMPORT_UNSAFE_MAIN_AUTOEXECUTES\";\n  } else {\n    readiness =\n      \"DO_NOT_IMPORT_PRODUCER_MODULE_YET\";\n  }\n\n  const report = {\n    status:\n      \"AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_IMPORT_SAFETY_AUDIT_V1_COMPLETE\",\n\n    readiness,\n\n    checks,\n\n    evidence: {\n      mainDefinitions,\n\n      mainInvocations,\n\n      importMetaGuards,\n\n      requireMainGuards,\n\n      argvEntryGuards,\n\n      nextExpectedDefinitions,\n\n      nextExpectedWindow,\n\n      mainCallWindow,\n    },\n\n    safety: {\n      sourceOnlyAudit:\n        true,\n\n      producerImported:\n        false,\n\n      producerExecuted:\n        false,\n\n      subprocessExecuted:\n        false,\n\n      databaseReads:\n        0,\n\n      databaseWrites:\n        0,\n\n      fileWrites:\n        0,\n\n      networkCalls:\n        0,\n\n      ordersCreated:\n        0,\n\n      positionsChanged:\n        0,\n\n      realTradingEnabled:\n        false,\n    },\n\n    failed:\n      [],\n\n    nextGate:\n      readiness ===\n      \"IMPORT_SAFE_PURE_EXPORT_WRAPPER_CAN_PROCEED\"\n        ? \"IMPLEMENT_NON_EXECUTING_PRODUCER_PURE_EXPORT_PROBE_WRAPPER_V1\"\n        : readiness ===\n          \"PURE_EXPORT_EXISTS_BUT_MODULE_IMPORT_UNSAFE_MAIN_AUTOEXECUTES\"\n        ? \"ADD_IMPORT_SAFE_ENTRYPOINT_GUARD_TO_PRODUCER_BEFORE_WRAPPER_V1\"\n        : \"INSPECT_NEXT_EXPECTED_KRX_OPEN_DATE_DEPENDENCIES_BEFORE_WRAPPER\",\n  };\n\n  fs.mkdirSync(\n    path.join(\n      ROOT,\n      \"logs\"\n    ),\n    {\n      recursive:\n        true,\n    }\n  );\n\n  fs.writeFileSync(\n    path.join(\n      ROOT,\n      \"logs\",\n      \"true-forward-oos-producer-import-safety-audit-v1.json\"\n    ),\n    JSON.stringify(\n      report,\n      null,\n      2\n    ),\n    \"utf8\"\n  );\n\n  console.log(\n    JSON.stringify(\n      {\n        status:\n          report.status,\n\n        readiness:\n          report.readiness,\n\n        checks:\n          report.checks,\n\n        evidence: {\n          mainDefinitions:\n            report.evidence.mainDefinitions,\n\n          mainInvocations:\n            report.evidence.mainInvocations,\n\n          importMetaGuards:\n            report.evidence.importMetaGuards,\n\n          requireMainGuards:\n            report.evidence.requireMainGuards,\n\n          argvEntryGuards:\n            report.evidence.argvEntryGuards,\n\n          nextExpectedDefinitions:\n            report.evidence.nextExpectedDefinitions,\n        },\n\n        nextGate:\n          report.nextGate,\n      },\n      null,\n      2\n    )\n  );\n\n  process.exitCode = 0;\n}\n",
    "utf8"
  );

  let pkg;

  try {
    pkg =
      JSON.parse(
        fs.readFileSync(
          PACKAGE,
          "utf8"
        )
      );
  } catch (
    error
  ) {
    fail(
      "PACKAGE_JSON_PARSE_FAILED",
      {
        error:
          String(
            error instanceof Error
              ? error.message
              : error
          ),
      }
    );
  }

  if (
    pkg
  ) {
    pkg.scripts ||= {};

    pkg.scripts[
      "test:true-forward-oos-producer-import-safety"
    ] =
      "node ./scripts/true-forward-oos-producer-import-safety-audit-v1.cjs";

    fs.writeFileSync(
      PACKAGE,
      JSON.stringify(
        pkg,
        null,
        2
      ) + "\n",
      "utf8"
    );

    console.log(
      JSON.stringify(
        {
          status:
            "AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_IMPORT_SAFETY_AUDIT_V1_INSTALLED",

          generatedFile:
            "scripts/true-forward-oos-producer-import-safety-audit-v1.cjs",

          packageScript:
            "npm run test:true-forward-oos-producer-import-safety",

          mode:
            "READ_ONLY_IMPORT_SAFETY_AUDIT",

          productSourceChanges:
            0,

          safety: {
            producerImported:
              false,

            producerExecuted:
              false,

            databaseReads:
              0,

            databaseWrites:
              0,

            producerFileWrites:
              0,

            ordersCreated:
              0,

            positionsChanged:
              0,

            realTradingEnabled:
              false,
          },

          nextAction:
            "RUN_PRODUCER_IMPORT_SAFETY_AUDIT",
        },
        null,
        2
      )
    );
  }
}
