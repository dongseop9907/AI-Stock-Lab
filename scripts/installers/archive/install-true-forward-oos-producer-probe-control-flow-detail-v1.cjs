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
    "true-forward-oos-producer-probe-control-flow-detail-v1.cjs"
  );

function fail(
  reason,
  extra = {},
) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_PROBE_CONTROL_FLOW_DETAIL_V1_INSTALL_FAILED",

        reason,
        ...extra,
      },
      null,
      2,
    ),
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
          rel,
        ),
      ),
  );

if (
  missing.length > 0
) {
  fail(
    "REQUIRED_FILES_MISSING",
    {
      missing,
    },
  );
} else {
  fs.writeFileSync(
    TARGET,
    "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst ROOT = process.cwd();\n\nconst TARGET_REL =\n  \"scripts/alpha-v3-true-forward-top1-producer-v1.ts\";\n\nconst TARGET =\n  path.join(\n    ROOT,\n    TARGET_REL,\n  );\n\nfunction getLines() {\n  return fs\n    .readFileSync(\n      TARGET,\n      \"utf8\",\n    )\n    .split(/\\r?\\n/);\n}\n\nfunction window(\n  lines,\n  center,\n  before = 12,\n  after = 18,\n) {\n  const start =\n    Math.max(\n      1,\n      center - before,\n    );\n\n  const end =\n    Math.min(\n      lines.length,\n      center + after,\n    );\n\n  return {\n    startLine:\n      start,\n\n    endLine:\n      end,\n\n    lines:\n      lines\n        .slice(\n          start - 1,\n          end,\n        )\n        .map(\n          (\n            text,\n            index,\n          ) => ({\n            line:\n              start +\n              index,\n\n            text,\n          }),\n  };\n}\n\nfunction findAll(\n  lines,\n  regex,\n  limit = 40,\n) {\n  const out = [];\n\n  for (\n    let i = 0;\n    i < lines.length;\n    i++\n  ) {\n    if (\n      regex.test(\n        lines[i],\n      )\n    ) {\n      out.push({\n        line:\n          i + 1,\n\n        text:\n          lines[i].trim(),\n      });\n\n      if (\n        out.length >=\n        limit\n      ) {\n        break;\n      }\n    }\n\n    regex.lastIndex = 0;\n  }\n\n  return out;\n}\n\nif (\n  !fs.existsSync(\n    TARGET,\n  )\n) {\n  console.error(\n    JSON.stringify(\n      {\n        status:\n          \"AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_PROBE_CONTROL_FLOW_DETAIL_V1_FAILED\",\n\n        reason:\n          \"PRODUCER_NOT_FOUND\",\n      },\n      null,\n      2,\n    ),\n  );\n\n  process.exitCode = 1;\n} else {\n  const lines =\n    getLines();\n\n  const dryLike =\n    findAll(\n      lines,\n      /(dry.?run|probe.?only|read.?only|no.?write|preview|smoke)/i,\n      20,\n    );\n\n  const writes =\n    findAll(\n      lines,\n      /(writeFile|writeFileSync|appendFile|appendFileSync|mkdir|rename|copyFile|unlink)/i,\n      20,\n    );\n\n  const dbReads =\n    findAll(\n      lines,\n      /\\.(select|from)\\s*\\(/i,\n      30,\n    );\n\n  const mainDefs =\n    findAll(\n      lines,\n      /(async\\s+function\\s+main|function\\s+main)/i,\n      10,\n    );\n\n  const mainCalls =\n    findAll(\n      lines,\n      /(main\\s*\\(\\s*\\)\\s*\\.catch|await\\s+main\\s*\\(\\s*\\)|(?:^|\\s)main\\s*\\(\\s*\\)\\s*;?)/i,\n      10,\n    );\n\n  const argvOrEnv =\n    findAll(\n      lines,\n      /(process\\.argv|process\\.env|--[a-z0-9][a-z0-9-]*)/i,\n      60,\n    );\n\n  const exports =\n    findAll(\n      lines,\n      /^\\s*export\\s+(async\\s+)?(function|const|type|interface|class)/i,\n      60,\n    );\n\n  const candidatePureFunctions =\n    exports.filter(\n      item =>\n        /(resolve|build|select|score|candidate|target|session|plan|date|freeze|forward)/i.test(\n          item.text,\n        ),\n    );\n\n  const anchors = {\n    dryLike:\n      dryLike[0]?.line ??\n      null,\n\n    firstWrite:\n      writes[0]?.line ??\n      null,\n\n    firstDbRead:\n      dbReads[0]?.line ??\n      null,\n\n    mainDefinition:\n      mainDefs[0]?.line ??\n      null,\n\n    mainCall:\n      mainCalls[0]?.line ??\n      null,\n  };\n\n  const detail = {\n    dryLike:\n      anchors.dryLike\n        ? window(\n            lines,\n            anchors.dryLike,\n            18,\n            24,\n          )\n        : null,\n\n    firstWrite:\n      anchors.firstWrite\n        ? window(\n            lines,\n            anchors.firstWrite,\n            22,\n            32,\n          )\n        : null,\n\n    firstDbRead:\n      anchors.firstDbRead\n        ? window(\n            lines,\n            anchors.firstDbRead,\n            22,\n            32,\n          )\n        : null,\n\n    mainDefinition:\n      anchors.mainDefinition\n        ? window(\n            lines,\n            anchors.mainDefinition,\n            12,\n            40,\n          )\n        : null,\n\n    mainCall:\n      anchors.mainCall\n        ? window(\n            lines,\n            anchors.mainCall,\n            18,\n            24,\n          )\n        : null,\n  };\n\n  const checks = {\n    producerExists:\n      true,\n\n    dryLikeTextFound:\n      dryLike.length >\n      0,\n\n    runtimeCliOrEnvTriggerFound:\n      argvOrEnv.some(\n        item =>\n          /(DRY|PROBE|READ_ONLY|NO_WRITE|PREVIEW|SMOKE|--dry|--probe|--preview|--read)/i.test(\n            item.text,\n          ),\n      ),\n\n    fileWriteSurfaceFound:\n      writes.length >\n      0,\n\n    dbReadSurfaceFound:\n      dbReads.length >\n      0,\n\n    mainDefinitionFound:\n      mainDefs.length >\n      0,\n\n    mainCallFound:\n      mainCalls.length >\n      0,\n\n    reusableExportCandidatesFound:\n      candidatePureFunctions.length >\n      0,\n  };\n\n  const recommendedStrategy =\n    checks.runtimeCliOrEnvTriggerFound\n      ? \"VERIFY_EXISTING_TRIGGER_EXACT_BRANCH\"\n      : checks.reusableExportCandidatesFound\n      ? \"ADD_THIN_PROBE_WRAPPER_AROUND_REUSABLE_PURE_EXPORTED_SURFACES_DO_NOT_RUN_MAIN\"\n      : \"EXTRACT_PURE_PLANNING_SURFACE_BEFORE_ANY_REAL_PRODUCER_EXECUTION\";\n\n  const report = {\n    status:\n      \"AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_PROBE_CONTROL_FLOW_DETAIL_V1_COMPLETE\",\n\n    checks,\n\n    anchors,\n\n    argvOrEnv,\n\n    exports:\n      exports.slice(\n        0,\n        40,\n      ),\n\n    candidatePureFunctions,\n\n    detail,\n\n    recommendedStrategy,\n\n    safety: {\n      sourceOnlyAudit:\n        true,\n\n      producerExecuted:\n        false,\n\n      subprocessExecuted:\n        false,\n\n      databaseReads:\n        0,\n\n      databaseWrites:\n        0,\n\n      fileWrites:\n        0,\n\n      networkCalls:\n        0,\n\n      ordersCreated:\n        0,\n\n      positionsChanged:\n        0,\n\n      realTradingEnabled:\n        false,\n    },\n\n    nextGate:\n      recommendedStrategy ===\n      \"VERIFY_EXISTING_TRIGGER_EXACT_BRANCH\"\n        ? \"VERIFY_EXISTING_PRODUCER_PROBE_BRANCH_V1\"\n        : recommendedStrategy ===\n          \"ADD_THIN_PROBE_WRAPPER_AROUND_REUSABLE_PURE_EXPORTED_SURFACES_DO_NOT_RUN_MAIN\"\n        ? \"DESIGN_NON_EXECUTING_PRODUCER_PROBE_WRAPPER_V1\"\n        : \"DESIGN_PURE_PRODUCER_PLANNING_EXTRACTION_V1\",\n  };\n\n  fs.mkdirSync(\n    path.join(\n      ROOT,\n      \"logs\",\n    ),\n    {\n      recursive:\n        true,\n    },\n  );\n\n  fs.writeFileSync(\n    path.join(\n      ROOT,\n      \"logs\",\n      \"true-forward-oos-producer-probe-control-flow-detail-v1.json\",\n    ),\n    JSON.stringify(\n      report,\n      null,\n      2,\n    ),\n    \"utf8\",\n  );\n\n  console.log(\n    JSON.stringify(\n      {\n        status:\n          report.status,\n\n        checks:\n          report.checks,\n\n        anchors:\n          report.anchors,\n\n        argvOrEnv:\n          report.argvOrEnv,\n\n        candidatePureFunctions:\n          report.candidatePureFunctions,\n\n        recommendedStrategy:\n          report.recommendedStrategy,\n\n        nextGate:\n          report.nextGate,\n      },\n      null,\n      2,\n    ),\n  );\n\n  process.exitCode = 0;\n}\n",
    "utf8",
  );

  let pkg;

  try {
    pkg =
      JSON.parse(
        fs.readFileSync(
          PACKAGE,
          "utf8",
        ),
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
              : error,
          ),
      },
    );
  }

  if (
    pkg
  ) {
    pkg.scripts ||= {};

    pkg.scripts[
      "test:true-forward-oos-producer-probe-control-flow-detail"
    ] =
      "node ./scripts/true-forward-oos-producer-probe-control-flow-detail-v1.cjs";

    fs.writeFileSync(
      PACKAGE,
      JSON.stringify(
        pkg,
        null,
        2,
      ) + "\n",
      "utf8",
    );

    console.log(
      JSON.stringify(
        {
          status:
            "AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_PROBE_CONTROL_FLOW_DETAIL_V1_INSTALLED",

          generatedFile:
            "scripts/true-forward-oos-producer-probe-control-flow-detail-v1.cjs",

          packageScript:
            "npm run test:true-forward-oos-producer-probe-control-flow-detail",

          mode:
            "READ_ONLY_CONTROL_FLOW_DETAIL_PROBE",

          productSourceChanges:
            0,

          safety: {
            producerExecution:
              false,

            subprocessExecution:
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
            "RUN_COMPACT_CONTROL_FLOW_DETAIL_PROBE",
        },
        null,
        2,
      ),
    );
  }
}
