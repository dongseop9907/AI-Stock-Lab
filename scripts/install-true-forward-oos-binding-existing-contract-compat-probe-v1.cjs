const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const SCRIPTS =
  path.join(
    ROOT,
    "scripts"
  );

const PACKAGE =
  path.join(
    ROOT,
    "package.json"
  );

const TARGET =
  path.join(
    SCRIPTS,
    "true-forward-oos-binding-existing-contract-compat-probe-v1.cjs"
  );

function fail(reason, extra = {}) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_BINDING_EXISTING_CONTRACT_COMPAT_PROBE_V1_INSTALL_FAILED",
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
  "scripts/true-forward-oos-automation-binding-v1-contract-test.ts",
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
    "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst ROOT = process.cwd();\n\nconst CONTRACT =\n  path.join(\n    ROOT,\n    \"scripts\",\n    \"true-forward-oos-automation-binding-v1-contract-test.ts\"\n  );\n\nfunction fail(reason, extra = {}) {\n  console.error(\n    JSON.stringify(\n      {\n        status:\n          \"AI_STOCK_LAB_TRUE_FORWARD_OOS_BINDING_EXISTING_CONTRACT_COMPAT_PROBE_V1_FAILED\",\n        reason,\n        ...extra,\n      },\n      null,\n      2\n    )\n  );\n\n  process.exitCode = 1;\n}\n\nif (!fs.existsSync(CONTRACT)) {\n  fail(\"CONTRACT_TEST_NOT_FOUND\");\n} else {\n  const text =\n    fs.readFileSync(\n      CONTRACT,\n      \"utf8\"\n    );\n\n  const lines =\n    text.split(/\\r?\\n/);\n\n  const dateLines = [];\n  const joinLines = [];\n  const statusLines = [];\n  const runCalls = [];\n\n  for (\n    let i = 0;\n    i < lines.length;\n    i++\n  ) {\n    const line = lines[i];\n\n    if (\n      /\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}/.test(\n        line\n      )\n    ) {\n      dateLines.push({\n        line: i + 1,\n        text: line.trim(),\n      });\n    }\n\n    if (\n      /\\.join\\s*\\(/.test(\n        line\n      )\n    ) {\n      joinLines.push({\n        line: i + 1,\n        text: line.trim(),\n      });\n    }\n\n    if (\n      /status\\s*===|status\\s*!==|\\.status/.test(\n        line\n      )\n    ) {\n      statusLines.push({\n        line: i + 1,\n        text: line.trim(),\n      });\n    }\n\n    if (\n      /runTrueForwardOosAutomationBindingV1\\s*\\(/.test(\n        line\n      )\n    ) {\n      runCalls.push({\n        line: i + 1,\n        text: line.trim(),\n      });\n    }\n  }\n\n  const report = {\n    status:\n      \"AI_STOCK_LAB_TRUE_FORWARD_OOS_BINDING_EXISTING_CONTRACT_COMPAT_PROBE_V1_COMPLETE\",\n\n    dateLines:\n      dateLines.slice(0, 30),\n\n    joinLines:\n      joinLines.slice(0, 30),\n\n    statusLines:\n      statusLines.slice(0, 40),\n\n    runCalls:\n      runCalls.slice(0, 20),\n\n    safety: {\n      readOnly:\n        true,\n      filesModified:\n        0,\n      databaseReads:\n        0,\n      databaseWrites:\n        0,\n      ordersCreated:\n        0,\n      positionsChanged:\n        0,\n      realTradingEnabled:\n        false,\n    },\n\n    nextGate:\n      \"REPAIR_EXISTING_BINDING_CONTRACT_FOR_CANONICAL_KRX_GUARD\",\n  };\n\n  fs.mkdirSync(\n    path.join(\n      ROOT,\n      \"logs\"\n    ),\n    {\n      recursive: true\n    }\n  );\n\n  fs.writeFileSync(\n    path.join(\n      ROOT,\n      \"logs\",\n      \"true-forward-oos-binding-existing-contract-compat-probe-v1.json\"\n    ),\n    JSON.stringify(\n      report,\n      null,\n      2\n    ),\n    \"utf8\"\n  );\n\n  console.log(\n    JSON.stringify(\n      {\n        status:\n          report.status,\n\n        dateLines:\n          report.dateLines,\n\n        joinLines:\n          report.joinLines,\n\n        statusLines:\n          report.statusLines.slice(\n            0,\n            20\n          ),\n\n        nextGate:\n          report.nextGate,\n      },\n      null,\n      2\n    )\n  );\n\n  process.exitCode = 0;\n}\n",
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
  } catch (error) {
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

  if (pkg) {
    if (
      !pkg.scripts ||
      typeof pkg.scripts !==
        "object"
    ) {
      pkg.scripts = {};
    }

    pkg.scripts[
      "test:true-forward-oos-binding-existing-contract-compat"
    ] =
      "node ./scripts/true-forward-oos-binding-existing-contract-compat-probe-v1.cjs";

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
            "AI_STOCK_LAB_TRUE_FORWARD_OOS_BINDING_EXISTING_CONTRACT_COMPAT_PROBE_V1_INSTALLED",

          generatedFile:
            "scripts/true-forward-oos-binding-existing-contract-compat-probe-v1.cjs",

          packageScript:
            "npm run test:true-forward-oos-binding-existing-contract-compat",

          mode:
            "READ_ONLY_CONTRACT_FIXTURE_PROBE",

          safety: {
            productSourceChanges:
              0,
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
            "RUN_COMPACT_EXISTING_CONTRACT_COMPAT_PROBE",
        },
        null,
        2
      )
    );
  }
}
