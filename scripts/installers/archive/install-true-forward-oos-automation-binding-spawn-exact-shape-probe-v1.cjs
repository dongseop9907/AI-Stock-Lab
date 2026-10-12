const fs = require("fs");
const path = require("path");

const ROOT =
  process.cwd();

const TARGET =
  path.join(
    ROOT,
    "scripts",
    "true-forward-oos-automation-binding-spawn-exact-shape-probe-v1.cjs"
  );

const PACKAGE =
  path.join(
    ROOT,
    "package.json"
  );

function fail(
  reason,
  extra = {}
) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_BINDING_SPAWN_EXACT_SHAPE_PROBE_V1_INSTALL_FAILED",

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
    "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst ROOT = process.cwd();\n\nconst TARGET_REL =\n  \"lib/research/run-true-forward-oos-automation-binding-v1.ts\";\n\nconst TARGET =\n  path.join(\n    ROOT,\n    TARGET_REL\n  );\n\nfunction collectMatches(\n  lines,\n  regex,\n  before = 8,\n  after = 14,\n  limit = 20\n) {\n  const out = [];\n\n  for (\n    let i = 0;\n    i < lines.length;\n    i++\n  ) {\n    if (!regex.test(lines[i])) {\n      continue;\n    }\n\n    const start =\n      Math.max(\n        0,\n        i - before\n      );\n\n    const end =\n      Math.min(\n        lines.length - 1,\n        i + after\n      );\n\n    const snippet = [];\n\n    for (\n      let n = start;\n      n <= end;\n      n++\n    ) {\n      snippet.push({\n        line:\n          n + 1,\n\n        text:\n          lines[n],\n      });\n    }\n\n    out.push({\n      matchLine:\n        i + 1,\n\n      matchText:\n        lines[i],\n\n      snippet,\n    });\n\n    if (\n      out.length >=\n      limit\n    ) {\n      break;\n    }\n  }\n\n  return out;\n}\n\nif (!fs.existsSync(TARGET)) {\n  console.error(\n    JSON.stringify(\n      {\n        status:\n          \"AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_BINDING_SPAWN_EXACT_SHAPE_PROBE_V1_FAILED\",\n\n        reason:\n          \"BINDING_NOT_FOUND\",\n      },\n      null,\n      2\n    )\n  );\n\n  process.exitCode = 1;\n} else {\n  const source =\n    fs.readFileSync(\n      TARGET,\n      \"utf8\"\n    );\n\n  const lines =\n    source.split(/\\r?\\n/);\n\n  const result = {\n    status:\n      \"AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_BINDING_SPAWN_EXACT_SHAPE_PROBE_V1_COMPLETE\",\n\n    matches: {\n      spawnSync:\n        collectMatches(\n          lines,\n          /spawnSync/\n        ),\n\n      processExecPath:\n        collectMatches(\n          lines,\n          /process\\.execPath/\n        ),\n\n      runStep:\n        collectMatches(\n          lines,\n          /\\brunStep\\b/\n        ),\n\n      producerTarget:\n        collectMatches(\n          lines,\n          /alpha-v3-true-forward-top1-producer-v1\\.ts/\n        ),\n\n      envFile:\n        collectMatches(\n          lines,\n          /--env-file/\n        ),\n\n      tsxLoader:\n        collectMatches(\n          lines,\n          /--import|tsx/\n        ),\n    },\n\n    safety: {\n      sourceOnly:\n        true,\n\n      automationExecuted:\n        false,\n\n      producerExecuted:\n        false,\n\n      subprocessExecuted:\n        false,\n\n      databaseReads:\n        0,\n\n      databaseWrites:\n        0,\n\n      fileWrites:\n        0,\n\n      ordersCreated:\n        0,\n\n      positionsChanged:\n        0,\n\n      realTradingEnabled:\n        false,\n    },\n\n    nextGate:\n      \"PATCH_USING_EXACT_SPAWN_SHAPE_FROM_THIS_OUTPUT\",\n  };\n\n  fs.mkdirSync(\n    path.join(\n      ROOT,\n      \"logs\"\n    ),\n    {\n      recursive:\n        true,\n    }\n  );\n\n  fs.writeFileSync(\n    path.join(\n      ROOT,\n      \"logs\",\n      \"true-forward-oos-automation-binding-spawn-exact-shape-probe-v1.json\"\n    ),\n    JSON.stringify(\n      result,\n      null,\n      2\n    ),\n    \"utf8\"\n  );\n\n  console.log(\n    JSON.stringify(\n      result,\n      null,\n      2\n    )\n  );\n\n  process.exitCode = 0;\n}\n",
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

  if (pkg) {
    pkg.scripts ||= {};

    pkg.scripts[
      "test:true-forward-oos-automation-binding-spawn-exact-shape"
    ] =
      "node ./scripts/true-forward-oos-automation-binding-spawn-exact-shape-probe-v1.cjs";

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
            "AI_STOCK_LAB_TRUE_FORWARD_OOS_AUTOMATION_BINDING_SPAWN_EXACT_SHAPE_PROBE_V1_INSTALLED",

          generatedFile:
            "scripts/true-forward-oos-automation-binding-spawn-exact-shape-probe-v1.cjs",

          packageScript:
            "npm run test:true-forward-oos-automation-binding-spawn-exact-shape",

          mode:
            "READ_ONLY_EXACT_SPAWN_SHAPE",

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
            "RUN_AND_RETURN_OUTPUT",
        },
        null,
        2
      )
    );

    process.exitCode = 0;
  }
}
