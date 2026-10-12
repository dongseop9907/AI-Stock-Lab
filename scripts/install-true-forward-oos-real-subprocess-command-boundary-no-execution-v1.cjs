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
    "true-forward-oos-real-subprocess-command-boundary-no-execution-v1.cjs"
  );

function fail(
  reason,
  extra = {},
) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_REAL_SUBPROCESS_COMMAND_BOUNDARY_NO_EXECUTION_V1_INSTALL_FAILED",

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
  "lib/research/run-true-forward-oos-automation-binding-v1.ts",
  "scripts/alpha-v3-true-forward-top1-producer-v1.ts",
  "scripts/alpha-v3-true-entry-forward-oos-collector-v1.ts",
  "scripts/alpha-v3-true-forward-oos-evaluator-v1.ts",
  "scripts/alpha-v3-true-forward-oos-summary.ts",
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
    "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst ROOT = process.cwd();\n\nconst BINDING_REL =\n  \"lib/research/run-true-forward-oos-automation-binding-v1.ts\";\n\nconst EXPECTED = {\n  PRODUCE:\n    \"scripts/alpha-v3-true-forward-top1-producer-v1.ts\",\n\n  COLLECT:\n    \"scripts/alpha-v3-true-entry-forward-oos-collector-v1.ts\",\n\n  EVALUATE:\n    \"scripts/alpha-v3-true-forward-oos-evaluator-v1.ts\",\n\n  SUMMARY:\n    \"scripts/alpha-v3-true-forward-oos-summary.ts\",\n};\n\nfunction fail(\n  reason,\n  extra = {},\n) {\n  console.error(\n    JSON.stringify(\n      {\n        status:\n          \"AI_STOCK_LAB_TRUE_FORWARD_OOS_REAL_SUBPROCESS_COMMAND_BOUNDARY_NO_EXECUTION_V1_FAILED\",\n\n        reason,\n        ...extra,\n      },\n      null,\n      2,\n    ),\n  );\n\n  process.exitCode = 1;\n}\n\nconst bindingPath =\n  path.join(\n    ROOT,\n    BINDING_REL,\n  );\n\nif (\n  !fs.existsSync(\n    bindingPath,\n  )\n) {\n  fail(\n    \"BINDING_NOT_FOUND\",\n  );\n} else {\n  const source =\n    fs.readFileSync(\n      bindingPath,\n      \"utf8\",\n    );\n\n  const compact =\n    source.replace(\n      /\\s+/g,\n      \" \",\n    );\n\n  const targetExistence =\n    Object.fromEntries(\n      Object.entries(\n        EXPECTED,\n      ).map(\n        ([step, rel]) => [\n          step,\n          fs.existsSync(\n            path.join(\n              ROOT,\n              rel,\n            ),\n          ),\n        ],\n      ),\n    );\n\n  const targetReferences =\n    Object.fromEntries(\n      Object.entries(\n        EXPECTED,\n      ).map(\n        ([step, rel]) => [\n          step,\n          source.includes(\n            rel,\n          ),\n        ],\n      ),\n    );\n\n  const directImports =\n    Object.fromEntries(\n      Object.entries(\n        EXPECTED,\n      ).map(\n        ([step, rel]) => {\n          const escaped =\n            rel\n              .replace(\n                /^scripts\\//,\n                \"\",\n              )\n              .replace(\n                /\\.ts$/,\n                \"\",\n              )\n              .replace(\n                /[.*+?^${}()|[\\]\\\\]/g,\n                \"\\\\$&\",\n              );\n\n          const re =\n            new RegExp(\n              `from\\\\s+[\"'][^\"']*${escaped}[\"']|require\\\\s*\\\\(\\\\s*[\"'][^\"']*${escaped}[\"']\\\\s*\\\\)`,\n              \"i\",\n            );\n\n          return [\n            step,\n            re.test(\n              source,\n            ),\n          ];\n        },\n      ),\n    );\n\n  const checks = {\n    bindingExists:\n      true,\n\n    produceTargetExists:\n      targetExistence\n        .PRODUCE ===\n        true,\n\n    collectTargetExists:\n      targetExistence\n        .COLLECT ===\n        true,\n\n    evaluateTargetExists:\n      targetExistence\n        .EVALUATE ===\n        true,\n\n    summaryTargetExists:\n      targetExistence\n        .SUMMARY ===\n        true,\n\n    produceTargetReferenced:\n      targetReferences\n        .PRODUCE ===\n        true,\n\n    collectTargetReferenced:\n      targetReferences\n        .COLLECT ===\n        true,\n\n    evaluateTargetReferenced:\n      targetReferences\n        .EVALUATE ===\n        true,\n\n    summaryTargetReferenced:\n      targetReferences\n        .SUMMARY ===\n        true,\n\n    noDirectCliScriptImport:\n      Object.values(\n        directImports,\n      ).every(\n        value =>\n          value === false,\n      ),\n\n    processExecPathUsed:\n      /process\\.execPath/.test(\n        source,\n      ),\n\n    tsxLoaderBoundaryPresent:\n      source.includes(\n        \"--import\",\n      ) &&\n      /\\btsx\\b/.test(\n        source,\n      ),\n\n    envFileBoundaryPresent:\n      source.includes(\n        \"--env-file\",\n      ) &&\n      source.includes(\n        \".env.local\",\n      ),\n\n    subprocessPrimitivePresent:\n      /\\bspawnSync\\s*\\(|\\bspawn\\s*\\(|\\bexecFile\\s*\\(|\\bexecFileSync\\s*\\(/.test(\n        source,\n      ),\n\n    injectableRunStepPresent:\n      /\\brunStep\\b/.test(\n        source,\n      ),\n\n    realTradingFlagForcedOff:\n      source.includes(\n        \"REAL_TRADING_ENABLED\",\n      ) &&\n      source.includes(\n        \"ENABLE_REAL_TRADING\",\n      ) &&\n      source.includes(\n        \"ENABLE_LIVE_TRADING\",\n      ) &&\n      /REAL_TRADING_ENABLED[\\s\\S]{0,200}false/i.test(\n        source,\n      ) &&\n      /ENABLE_REAL_TRADING[\\s\\S]{0,200}false/i.test(\n        source,\n      ) &&\n      /ENABLE_LIVE_TRADING[\\s\\S]{0,200}false/i.test(\n        source,\n      ),\n\n    forwardOosFeatureFlagPresent:\n      source.includes(\n        \"FORWARD_OOS_AUTOMATION_ENABLED\",\n      ),\n\n    noShellTrueMarker:\n      !/shell\\s*:\\s*true/.test(\n        source,\n      ),\n  };\n\n  const failed =\n    Object.entries(\n      checks,\n    )\n      .filter(\n        ([, value]) =>\n          value !== true,\n      )\n      .map(\n        ([key]) =>\n          key,\n      );\n\n  const commandBoundary = {\n    executable:\n      \"process.execPath\",\n\n    expectedArguments: [\n      \"--env-file=.env.local OR equivalent split args\",\n      \"--import tsx\",\n      \"<step script path>\",\n    ],\n\n    expectedTargets:\n      EXPECTED,\n\n    forcedEnvironment: {\n      REAL_TRADING_ENABLED:\n        \"false\",\n\n      ENABLE_REAL_TRADING:\n        \"false\",\n\n      ENABLE_LIVE_TRADING:\n        \"false\",\n    },\n\n    subprocessActuallyExecuted:\n      false,\n  };\n\n  const report = {\n    status:\n      failed.length === 0\n        ? \"AI_STOCK_LAB_TRUE_FORWARD_OOS_REAL_SUBPROCESS_COMMAND_BOUNDARY_NO_EXECUTION_V1_VERIFIED\"\n        : \"AI_STOCK_LAB_TRUE_FORWARD_OOS_REAL_SUBPROCESS_COMMAND_BOUNDARY_NO_EXECUTION_V1_FAILED\",\n\n    mode:\n      \"READ_ONLY_COMMAND_BOUNDARY_VERIFICATION\",\n\n    checks,\n\n    targetExistence,\n\n    targetReferences,\n\n    directImports,\n\n    commandBoundary,\n\n    safety: {\n      subprocessExecuted:\n        false,\n\n      collectorExecuted:\n        false,\n\n      evaluatorExecuted:\n        false,\n\n      summaryExecuted:\n        false,\n\n      producerExecuted:\n        false,\n\n      networkCalls:\n        0,\n\n      databaseReads:\n        0,\n\n      databaseWrites:\n        0,\n\n      ordersCreated:\n        0,\n\n      positionsChanged:\n        0,\n\n      promotionApplied:\n        false,\n\n      realTradingEnabled:\n        false,\n    },\n\n    failed,\n\n    nextGate:\n      failed.length === 0\n        ? \"RUN_FORWARD_OOS_REAL_PRODUCER_SUBPROCESS_PROBE_ONLY_OR_READ_ONLY_BOUNDARY_V1\"\n        : \"REPAIR_SUBPROCESS_COMMAND_BOUNDARY_BEFORE_ANY_REAL_STEP_EXECUTION\",\n  };\n\n  fs.mkdirSync(\n    path.join(\n      ROOT,\n      \"logs\",\n    ),\n    {\n      recursive:\n        true,\n    },\n  );\n\n  fs.writeFileSync(\n    path.join(\n      ROOT,\n      \"logs\",\n      \"true-forward-oos-real-subprocess-command-boundary-no-execution-v1.json\",\n    ),\n    JSON.stringify(\n      report,\n      null,\n      2,\n    ),\n    \"utf8\",\n  );\n\n  console.log(\n    JSON.stringify(\n      {\n        status:\n          report.status,\n\n        checks:\n          report.checks,\n\n        commandBoundary:\n          report.commandBoundary,\n\n        failed:\n          report.failed,\n\n        nextGate:\n          report.nextGate,\n      },\n      null,\n      2,\n    ),\n  );\n\n  process.exitCode =\n    failed.length === 0\n      ? 0\n      : 1;\n}\n",
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
      "test:true-forward-oos-real-subprocess-command-boundary"
    ] =
      "node ./scripts/true-forward-oos-real-subprocess-command-boundary-no-execution-v1.cjs";

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
            "AI_STOCK_LAB_TRUE_FORWARD_OOS_REAL_SUBPROCESS_COMMAND_BOUNDARY_NO_EXECUTION_V1_INSTALLED",

          generatedFile:
            "scripts/true-forward-oos-real-subprocess-command-boundary-no-execution-v1.cjs",

          packageScript:
            "npm run test:true-forward-oos-real-subprocess-command-boundary",

          mode:
            "READ_ONLY_COMMAND_BOUNDARY_VERIFICATION",

          productSourceChanges:
            0,

          safety: {
            subprocessExecution:
              false,

            producerExecution:
              false,

            collectorExecution:
              false,

            evaluatorExecution:
              false,

            summaryExecution:
              false,

            networkCalls:
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
            "RUN_REAL_SUBPROCESS_COMMAND_BOUNDARY_NO_EXECUTION_VERIFY",
        },
        null,
        2,
      ),
    );
  }
}
