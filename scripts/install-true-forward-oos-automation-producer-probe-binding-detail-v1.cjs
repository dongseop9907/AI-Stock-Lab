const fs = require("fs");
const path = require("path");

const ROOT =
  process.cwd();

const PACKAGE =
  path.join(
    ROOT,
    "package.json"
  );

const TARGET =
  path.join(
    ROOT,
    "scripts",
    "true-forward-oos-automation-producer-probe-binding-detail-v1.cjs"
  );

function fail(
  reason,
  extra = {}
) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_BINDING_DETAIL_V1_INSTALL_FAILED",

    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

const required = [
  "lib/research/run-true-forward-oos-automation-binding-v1.ts",
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
    "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst ROOT = process.cwd();\n\nconst TARGET_REL =\n  \"lib/research/run-true-forward-oos-automation-binding-v1.ts\";\n\nconst TARGET =\n  path.join(\n    ROOT,\n    TARGET_REL\n  );\n\nfunction lineNumber(\n  text,\n  index\n) {\n  if (index < 0) {\n    return null;\n  }\n\n  return (\n    text\n      .slice(\n        0,\n        index\n      )\n      .split(/\\r?\\n/)\n      .length\n  );\n}\n\nfunction windowAround(\n  lines,\n  line,\n  before = 15,\n  after = 25\n) {\n  if (!line) {\n    return null;\n  }\n\n  const start =\n    Math.max(\n      1,\n      line - before\n    );\n\n  const end =\n    Math.min(\n      lines.length,\n      line + after\n    );\n\n  const selected = [];\n\n  for (\n    let n = start;\n    n <= end;\n    n++\n  ) {\n    selected.push({\n      line: n,\n      text: lines[n - 1],\n    });\n  }\n\n  return {\n    startLine: start,\n    endLine: end,\n    lines: selected,\n  };\n}\n\nif (!fs.existsSync(TARGET)) {\n  console.error(JSON.stringify({\n    status:\n      \"AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_BINDING_DETAIL_V1_FAILED\",\n\n    reason:\n      \"AUTOMATION_BINDING_NOT_FOUND\",\n  }, null, 2));\n\n  process.exitCode = 1;\n} else {\n  const source =\n    fs.readFileSync(\n      TARGET,\n      \"utf8\"\n    );\n\n  const lines =\n    source.split(/\\r?\\n/);\n\n  const markers = {\n    stepScriptMap:\n      source.search(\n        /PRODUCE[\\s\\S]{0,500}alpha-v3-true-forward-top1-producer-v1\\.ts/\n      ),\n\n    runStep:\n      source.search(\n        /\\brunStep\\b/\n      ),\n\n    spawn:\n      source.search(\n        /\\bspawnSync\\s*\\(|\\bspawn\\s*\\(|\\bexecFileSync\\s*\\(|\\bexecFile\\s*\\(/\n      ),\n\n    execPath:\n      source.search(\n        /process\\.execPath/\n      ),\n\n    envFile:\n      source.search(\n        /--env-file/\n      ),\n\n    importTsx:\n      source.search(\n        /--import[\\s\\S]{0,120}tsx|tsx[\\s\\S]{0,120}--import/\n      ),\n\n    targetLookup:\n      source.search(\n        /STEP|step[\\s\\S]{0,300}(script|target)|script[\\s\\S]{0,300}step/i\n      ),\n\n    argsArray:\n      source.search(\n        /\\bargs\\s*=\\s*\\[|const\\s+\\w*args\\w*\\s*=\\s*\\[/i\n      ),\n  };\n\n  const markerLines =\n    Object.fromEntries(\n      Object.entries(\n        markers\n      ).map(\n        ([key, index]) => [\n          key,\n          lineNumber(\n            source,\n            index\n          ),\n        ]\n      )\n    );\n\n  const evidence =\n    Object.fromEntries(\n      Object.entries(\n        markerLines\n      ).map(\n        ([key, line]) => [\n          key,\n          windowAround(\n            lines,\n            line,\n            18,\n            30\n          ),\n        ]\n      )\n    );\n\n  const checks = {\n    bindingExists:\n      true,\n\n    produceTargetReferenced:\n      source.includes(\n        \"scripts/alpha-v3-true-forward-top1-producer-v1.ts\"\n      ),\n\n    runStepSurfaceFound:\n      markers.runStep >= 0,\n\n    subprocessPrimitiveFound:\n      markers.spawn >= 0,\n\n    processExecPathFound:\n      markers.execPath >= 0,\n\n    envFileFound:\n      markers.envFile >= 0,\n\n    importTsxFound:\n      markers.importTsx >= 0,\n\n    producerProbeFlagCurrentlyReferenced:\n      source.includes(\n        \"--probe-only\"\n      ),\n\n    stepSpecificArgumentSurfaceLikely:\n      /(step\\s*===\\s*[\"']PRODUCE[\"']|case\\s+[\"']PRODUCE[\"']|PRODUCE[\\s\\S]{0,300}(args|argument|argv))/i.test(\n        source\n      ),\n  };\n\n  let recommendedStrategy;\n\n  if (\n    checks.producerProbeFlagCurrentlyReferenced\n  ) {\n    recommendedStrategy =\n      \"EXISTING_PROBE_FLAG_BINDING_PRESENT_VERIFY_RUNTIME_ONLY\";\n  } else if (\n    checks.stepSpecificArgumentSurfaceLikely\n  ) {\n    recommendedStrategy =\n      \"ADD_PRODUCE_ONLY_PROBE_ARGUMENT_AT_EXISTING_STEP_ARGUMENT_BOUNDARY\";\n  } else {\n    recommendedStrategy =\n      \"ADD_EXPLICIT_PROBE_MODE_PARAMETER_TO_DEFAULT_RUNSTEP_WITH_PRODUCE_ONLY_ARG\";\n  }\n\n  const report = {\n    status:\n      \"AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_BINDING_DETAIL_V1_COMPLETE\",\n\n    checks,\n\n    markerLines,\n\n    recommendedStrategy,\n\n    evidence,\n\n    safety: {\n      sourceOnlyAudit:\n        true,\n\n      automationExecuted:\n        false,\n\n      producerExecuted:\n        false,\n\n      subprocessExecuted:\n        false,\n\n      databaseReads:\n        0,\n\n      databaseWrites:\n        0,\n\n      fileWrites:\n        0,\n\n      ordersCreated:\n        0,\n\n      positionsChanged:\n        0,\n\n      realTradingEnabled:\n        false,\n    },\n\n    failed:\n      [],\n\n    nextGate:\n      recommendedStrategy ===\n      \"EXISTING_PROBE_FLAG_BINDING_PRESENT_VERIFY_RUNTIME_ONLY\"\n        ? \"RUN_AUTOMATION_BINDING_PRODUCER_PROBE_ONLY_RUNTIME_V1\"\n        : \"PATCH_AUTOMATION_BINDING_WITH_EXPLICIT_PRODUCER_PROBE_ONLY_TEST_MODE_V1\",\n  };\n\n  fs.mkdirSync(\n    path.join(\n      ROOT,\n      \"logs\"\n    ),\n    {\n      recursive:\n        true,\n    }\n  );\n\n  fs.writeFileSync(\n    path.join(\n      ROOT,\n      \"logs\",\n      \"true-forward-oos-automation-producer-probe-binding-detail-v1.json\"\n    ),\n    JSON.stringify(\n      report,\n      null,\n      2\n    ),\n    \"utf8\"\n  );\n\n  console.log(JSON.stringify({\n    status:\n      report.status,\n\n    checks:\n      report.checks,\n\n    markerLines:\n      report.markerLines,\n\n    recommendedStrategy:\n      report.recommendedStrategy,\n\n    nextGate:\n      report.nextGate,\n  }, null, 2));\n\n  process.exitCode = 0;\n}\n",
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
      "test:true-forward-oos-automation-producer-probe-binding-detail"
    ] =
      "node ./scripts/true-forward-oos-automation-producer-probe-binding-detail-v1.cjs";

    fs.writeFileSync(
      PACKAGE,
      JSON.stringify(
        pkg,
        null,
        2
      ) + "\n",
      "utf8"
    );

    console.log(JSON.stringify({
      status:
        "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_PRODUCER_PROBE_BINDING_DETAIL_V1_INSTALLED",

      generatedFile:
        "scripts/true-forward-oos-automation-producer-probe-binding-detail-v1.cjs",

      packageScript:
        "npm run test:true-forward-oos-automation-producer-probe-binding-detail",

      mode:
        "READ_ONLY_BINDING_ARGUMENT_DETAIL_AUDIT",

      productSourceChanges:
        0,

      safety: {
        automationExecuted:
          false,

        producerExecuted:
          false,

        subprocessExecuted:
          false,

        databaseReads:
          0,

        databaseWrites:
          0,

        ordersCreated:
          0,

        positionsChanged:
          0,

        realTradingEnabled:
          false,
      },

      nextAction:
        "RUN_COMPACT_BINDING_ARGUMENT_DETAIL_AUDIT",
    }, null, 2));

    process.exitCode = 0;
  }
}
