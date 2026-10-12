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
    "true-forward-oos-producer-explicit-probe-contract-v1.cjs"
  );

function fail(
  reason,
  extra = {},
) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_EXPLICIT_PROBE_CONTRACT_V1_INSTALL_FAILED",

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
    "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst ROOT = process.cwd();\n\nconst TARGET_REL =\n  \"scripts/alpha-v3-true-forward-top1-producer-v1.ts\";\n\nconst TARGET =\n  path.join(\n    ROOT,\n    TARGET_REL,\n  );\n\nfunction lineNumberFromIndex(\n  text,\n  index,\n) {\n  if (index < 0) {\n    return null;\n  }\n\n  return (\n    text\n      .slice(\n        0,\n        index,\n      )\n      .split(/\\r?\\n/)\n      .length\n  );\n}\n\nfunction collectMatches(\n  text,\n  regex,\n  limit = 50,\n) {\n  const lines =\n    text.split(/\\r?\\n/);\n\n  const out = [];\n\n  for (\n    let i = 0;\n    i < lines.length;\n    i++\n  ) {\n    if (\n      regex.test(\n        lines[i],\n      )\n    ) {\n      out.push({\n        line:\n          i + 1,\n\n        text:\n          lines[i].trim(),\n      });\n\n      if (\n        out.length >=\n        limit\n      ) {\n        break;\n      }\n    }\n\n    regex.lastIndex = 0;\n  }\n\n  return out;\n}\n\nfunction contextsFor(\n  text,\n  matches,\n  radius = 5,\n) {\n  const lines =\n    text.split(/\\r?\\n/);\n\n  return matches\n    .slice(\n      0,\n      20,\n    )\n    .map(\n      match => {\n        const start =\n          Math.max(\n            0,\n            match.line - 1 - radius,\n          );\n\n        const end =\n          Math.min(\n            lines.length,\n            match.line + radius,\n          );\n\n        return {\n          anchorLine:\n            match.line,\n\n          snippet:\n            lines\n              .slice(\n                start,\n                end,\n              )\n              .map(\n                (\n                  line,\n                  offset,\n                ) => ({\n                  line:\n                    start +\n                    offset +\n                    1,\n\n                  text:\n                    line,\n                }),\n              ),\n        };\n      },\n    );\n}\n\nif (\n  !fs.existsSync(\n    TARGET,\n  )\n) {\n  console.error(\n    JSON.stringify(\n      {\n        status:\n          \"AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_EXPLICIT_PROBE_CONTRACT_V1_FAILED\",\n\n        reason:\n          \"PRODUCER_NOT_FOUND\",\n      },\n      null,\n      2,\n    ),\n  );\n\n  process.exitCode = 1;\n} else {\n  const source =\n    fs.readFileSync(\n      TARGET,\n      \"utf8\",\n    );\n\n  const dryRunMatches =\n    collectMatches(\n      source,\n      /(dry.?run|probe.?only|read.?only|no.?write|preview|smoke)/i,\n    );\n\n  const argvMatches =\n    collectMatches(\n      source,\n      /process\\.argv|argv|--[a-z0-9][a-z0-9-]*/i,\n      80,\n    );\n\n  const envMatches =\n    collectMatches(\n      source,\n      /process\\.env|[A-Z][A-Z0-9_]{4,}/,\n      80,\n    );\n\n  const returnMatches =\n    collectMatches(\n      source,\n      /\\breturn\\b/,\n      80,\n    );\n\n  const writeMatches =\n    collectMatches(\n      source,\n      /(writeFile|writeFileSync|appendFile|appendFileSync|mkdir|rename|copyFile|unlink)/i,\n      40,\n    );\n\n  const dbReadMatches =\n    collectMatches(\n      source,\n      /\\.(select|from)\\s*\\(/i,\n      40,\n    );\n\n  const mainMatches =\n    collectMatches(\n      source,\n      /(async\\s+function\\s+main|function\\s+main|main\\s*\\(\\s*\\)|main\\s*\\(\\s*\\)\\s*\\.catch|await\\s+main)/i,\n      40,\n    );\n\n  const firstDryLine =\n    dryRunMatches[0]\n      ?.line ??\n    null;\n\n  const firstWriteLine =\n    writeMatches[0]\n      ?.line ??\n    null;\n\n  const firstDbReadLine =\n    dbReadMatches[0]\n      ?.line ??\n    null;\n\n  const firstMainCallLine =\n    mainMatches\n      .filter(\n        item =>\n          /main\\s*\\(\\s*\\)/i.test(\n            item.text,\n          ),\n      )[0]\n      ?.line ??\n    null;\n\n  const explicitCliFlagCandidates =\n    argvMatches.filter(\n      item =>\n        /--[a-z0-9][a-z0-9-]*/i.test(\n          item.text,\n        ),\n    );\n\n  const explicitEnvFlagCandidates =\n    envMatches.filter(\n      item =>\n        /(DRY|PROBE|READ_ONLY|NO_WRITE|PREVIEW|SMOKE)/i.test(\n          item.text,\n        ),\n    );\n\n  const hasExplicitTrigger =\n    explicitCliFlagCandidates.length >\n      0 ||\n    explicitEnvFlagCandidates.length >\n      0;\n\n  const dryBeforeWrites =\n    firstDryLine !==\n      null &&\n    (\n      firstWriteLine ===\n        null ||\n      firstDryLine <\n        firstWriteLine\n    );\n\n  const dryBeforeDbReads =\n    firstDryLine !==\n      null &&\n    (\n      firstDbReadLine ===\n        null ||\n      firstDryLine <\n        firstDbReadLine\n    );\n\n  const possibleEarlyReturnNearDry =\n    dryRunMatches.some(\n      match =>\n        returnMatches.some(\n          ret =>\n            ret.line >=\n              match.line &&\n            ret.line <=\n              match.line +\n                20,\n        ),\n    );\n\n  const readiness =\n    hasExplicitTrigger &&\n    dryBeforeWrites &&\n    possibleEarlyReturnNearDry\n      ? \"EXPLICIT_PROBE_TRIGGER_WITH_POSSIBLE_EARLY_RETURN_BEFORE_FILE_WRITE\"\n      : hasExplicitTrigger\n      ? \"EXPLICIT_PROBE_TRIGGER_FOUND_BUT_EARLY_RETURN_SAFETY_NOT_YET_PROVEN\"\n      : \"DRY_RUN_LIKE_TEXT_FOUND_BUT_NO_CLEAR_RUNTIME_TRIGGER\";\n\n  const report = {\n    status:\n      \"AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_EXPLICIT_PROBE_CONTRACT_V1_COMPLETE\",\n\n    readiness,\n\n    checks: {\n      producerExists:\n        true,\n\n      dryRunLikeSurfaceFound:\n        dryRunMatches.length >\n        0,\n\n      explicitCliFlagCandidateFound:\n        explicitCliFlagCandidates.length >\n        0,\n\n      explicitEnvFlagCandidateFound:\n        explicitEnvFlagCandidates.length >\n        0,\n\n      explicitRuntimeTriggerFound:\n        hasExplicitTrigger,\n\n      drySurfaceBeforeFirstFileWrite:\n        dryBeforeWrites,\n\n      drySurfaceBeforeFirstDbRead:\n        dryBeforeDbReads,\n\n      possibleEarlyReturnNearDrySurface:\n        possibleEarlyReturnNearDry,\n\n      fileWriteSurfacePresent:\n        writeMatches.length >\n        0,\n\n      dbReadSurfacePresent:\n        dbReadMatches.length >\n        0,\n\n      autoMainCallSurfacePresent:\n        firstMainCallLine !==\n        null,\n    },\n\n    positions: {\n      firstDryLikeLine:\n        firstDryLine,\n\n      firstFileWriteLine:\n        firstWriteLine,\n\n      firstDbReadLine:\n        firstDbReadLine,\n\n      firstMainCallLine,\n    },\n\n    candidates: {\n      cliFlags:\n        explicitCliFlagCandidates,\n\n      envFlags:\n        explicitEnvFlagCandidates,\n    },\n\n    evidence: {\n      dryRunContexts:\n        contextsFor(\n          source,\n          dryRunMatches,\n          8,\n        ),\n\n      argvContexts:\n        contextsFor(\n          source,\n          explicitCliFlagCandidates,\n          5,\n        ),\n\n      envContexts:\n        contextsFor(\n          source,\n          explicitEnvFlagCandidates,\n          5,\n        ),\n\n      firstWriteContexts:\n        contextsFor(\n          source,\n          writeMatches.slice(\n            0,\n            5,\n          ),\n          5,\n        ),\n\n      mainContexts:\n        contextsFor(\n          source,\n          mainMatches.slice(\n            0,\n            5,\n          ),\n          5,\n        ),\n    },\n\n    safety: {\n      sourceOnlyAudit:\n        true,\n\n      producerExecuted:\n        false,\n\n      subprocessExecuted:\n        false,\n\n      networkCalls:\n        0,\n\n      databaseReads:\n        0,\n\n      databaseWrites:\n        0,\n\n      filesWrittenByProducer:\n        0,\n\n      ordersCreated:\n        0,\n\n      positionsChanged:\n        0,\n\n      realTradingEnabled:\n        false,\n    },\n\n    nextGate:\n      readiness ===\n      \"EXPLICIT_PROBE_TRIGGER_WITH_POSSIBLE_EARLY_RETURN_BEFORE_FILE_WRITE\"\n        ? \"VERIFY_EXACT_PROBE_BRANCH_CONTROL_FLOW_AND_OUTPUT_CONTRACT_V1\"\n        : \"DO_NOT_EXECUTE_REAL_PRODUCER_INSPECT_EXPLICIT_PROBE_TRIGGER_CONTROL_FLOW\",\n  };\n\n  fs.mkdirSync(\n    path.join(\n      ROOT,\n      \"logs\",\n    ),\n    {\n      recursive:\n        true,\n    },\n  );\n\n  fs.writeFileSync(\n    path.join(\n      ROOT,\n      \"logs\",\n      \"true-forward-oos-producer-explicit-probe-contract-v1.json\",\n    ),\n    JSON.stringify(\n      report,\n      null,\n      2,\n    ),\n    \"utf8\",\n  );\n\n  console.log(\n    JSON.stringify(\n      {\n        status:\n          report.status,\n\n        readiness:\n          report.readiness,\n\n        checks:\n          report.checks,\n\n        positions:\n          report.positions,\n\n        candidates:\n          report.candidates,\n\n        nextGate:\n          report.nextGate,\n      },\n      null,\n      2,\n    ),\n  );\n\n  process.exitCode = 0;\n}\n",
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
      "test:true-forward-oos-producer-explicit-probe-contract"
    ] =
      "node ./scripts/true-forward-oos-producer-explicit-probe-contract-v1.cjs";

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
            "AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_EXPLICIT_PROBE_CONTRACT_V1_INSTALLED",

          generatedFile:
            "scripts/true-forward-oos-producer-explicit-probe-contract-v1.cjs",

          packageScript:
            "npm run test:true-forward-oos-producer-explicit-probe-contract",

          mode:
            "READ_ONLY_PRODUCER_PROBE_CONTRACT_AUDIT",

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
            "RUN_COMPACT_EXPLICIT_PROBE_CONTRACT_AUDIT",
        },
        null,
        2,
      ),
    );
  }
}
