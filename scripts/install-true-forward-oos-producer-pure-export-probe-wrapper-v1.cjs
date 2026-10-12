const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const PACKAGE =
  path.join(
    ROOT,
    "package.json"
  );

const WRAPPER =
  path.join(
    ROOT,
    "scripts",
    "true-forward-oos-producer-pure-export-probe-wrapper-v1.ts"
  );

const STATIC_VERIFY =
  path.join(
    ROOT,
    "scripts",
    "true-forward-oos-producer-pure-export-probe-wrapper-v1-static-verify.cjs"
  );

function fail(
  reason,
  extra = {},
) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_PURE_EXPORT_PROBE_WRAPPER_V1_INSTALL_FAILED",

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
  const producerSource =
    fs.readFileSync(
      path.join(
        ROOT,
        "scripts",
        "alpha-v3-true-forward-top1-producer-v1.ts",
      ),
      "utf8",
    );

  if (
    !producerSource.includes(
      "export function isTrueForwardTop1DirectExecution("
    ) ||
    !producerSource.includes(
      "if (isTrueForwardTop1DirectExecution())"
    )
  ) {
    fail(
      "PRODUCER_IMPORT_SAFE_GUARD_NOT_PRESENT"
    );
  } else {
    fs.writeFileSync(
      WRAPPER,
      "import {\n  TRUE_FORWARD_TOP1_VERSION,\n  isTrueForwardTop1DirectExecution,\n  nextExpectedKrxOpenDate,\n} from \"./alpha-v3-true-forward-top1-producer-v1\";\n\nasync function main() {\n  const sourceDate =\n    \"2026-10-08\";\n\n  const nextDate =\n    nextExpectedKrxOpenDate(\n      sourceDate,\n      [],\n    );\n\n  const checks = {\n    moduleImportedSafely:\n      true,\n\n    versionExportUsable:\n      typeof TRUE_FORWARD_TOP1_VERSION ===\n        \"string\" &&\n      TRUE_FORWARD_TOP1_VERSION.length >\n        0,\n\n    currentWrapperNotDirectProducer:\n      isTrueForwardTop1DirectExecution(\n        process.argv[1],\n      ) ===\n      false,\n\n    canonicalProducerFilenameRecognized:\n      isTrueForwardTop1DirectExecution(\n        \"C:\\\\repo\\\\scripts\\\\alpha-v3-true-forward-top1-producer-v1.ts\",\n      ) ===\n      true,\n\n    pureCalendarFunctionCallable:\n      nextDate ===\n      \"2026-10-12\",\n  };\n\n  const failed =\n    Object.entries(\n      checks,\n    )\n      .filter(\n        ([, value]) =>\n          value !== true,\n      )\n      .map(\n        ([key]) =>\n          key,\n      );\n\n  console.log(\n    JSON.stringify(\n      {\n        status:\n          failed.length ===\n          0\n            ? \"AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_PURE_EXPORT_PROBE_WRAPPER_V1_VERIFIED\"\n            : \"AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_PURE_EXPORT_PROBE_WRAPPER_V1_FAILED\",\n\n        observation: {\n          version:\n            TRUE_FORWARD_TOP1_VERSION,\n\n          sourceDate,\n\n          nextDate,\n        },\n\n        checks,\n\n        safety: {\n          producerMainExecuted:\n            false,\n\n          producerRuntimeFunctionCalled:\n            false,\n\n          subprocessExecuted:\n            false,\n\n          databaseReads:\n            0,\n\n          databaseWrites:\n            0,\n\n          producerFileWrites:\n            0,\n\n          networkCalls:\n            0,\n\n          ordersCreated:\n            0,\n\n          positionsChanged:\n            0,\n\n          realTradingEnabled:\n            false,\n        },\n\n        failed,\n\n        nextGate:\n          failed.length ===\n          0\n            ? \"DESIGN_EXPLICIT_PRODUCER_PROBE_ONLY_MODE_BEFORE_REAL_SUBPROCESS_V1\"\n            : \"REPAIR_PURE_EXPORT_IMPORT_SURFACE_BEFORE_PRODUCER_PROBE_MODE\",\n      },\n      null,\n      2,\n    ),\n  );\n\n  process.exitCode =\n    failed.length ===\n    0\n      ? 0\n      : 1;\n}\n\nmain().catch(\n  error => {\n    console.error(\n      JSON.stringify(\n        {\n          status:\n            \"AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_PURE_EXPORT_PROBE_WRAPPER_V1_FAILED\",\n\n          error:\n            String(\n              error instanceof Error\n                ? error.message\n                : error,\n            ),\n\n          failed: [\n            \"wrapperRuntime\",\n          ],\n        },\n        null,\n        2,\n      ),\n    );\n\n    process.exitCode = 1;\n  },\n);\n",
      "utf8",
    );

    fs.writeFileSync(
      STATIC_VERIFY,
      "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst ROOT = process.cwd();\n\nconst WRAPPER_REL =\n  \"scripts/true-forward-oos-producer-pure-export-probe-wrapper-v1.ts\";\n\nconst PRODUCER_REL =\n  \"scripts/alpha-v3-true-forward-top1-producer-v1.ts\";\n\nconst wrapperPath =\n  path.join(\n    ROOT,\n    WRAPPER_REL,\n  );\n\nconst producerPath =\n  path.join(\n    ROOT,\n    PRODUCER_REL,\n  );\n\nfunction fail(\n  reason,\n  extra = {},\n) {\n  console.error(\n    JSON.stringify(\n      {\n        status:\n          \"AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_PURE_EXPORT_PROBE_WRAPPER_V1_STATIC_FAILED\",\n\n        reason,\n        ...extra,\n      },\n      null,\n      2,\n    ),\n  );\n\n  process.exitCode = 1;\n}\n\nif (\n  !fs.existsSync(\n    wrapperPath,\n  ) ||\n  !fs.existsSync(\n    producerPath,\n  )\n) {\n  fail(\n    \"REQUIRED_FILE_MISSING\",\n    {\n      wrapperExists:\n        fs.existsSync(\n          wrapperPath,\n        ),\n\n      producerExists:\n        fs.existsSync(\n          producerPath,\n        ),\n    },\n  );\n} else {\n  const wrapper =\n    fs.readFileSync(\n      wrapperPath,\n      \"utf8\",\n    );\n\n  const producer =\n    fs.readFileSync(\n      producerPath,\n      \"utf8\",\n    );\n\n  const checks = {\n    wrapperExists:\n      true,\n\n    producerExists:\n      true,\n\n    importsPureCalendarExport:\n      wrapper.includes(\n        \"nextExpectedKrxOpenDate\",\n      ),\n\n    importsEntrypointGuard:\n      wrapper.includes(\n        \"isTrueForwardTop1DirectExecution\",\n      ),\n\n    doesNotCallProducerRuntime:\n      !/runTrueForwardTop1Producer\\s*\\(/.test(\n        wrapper,\n      ),\n\n    doesNotCallProducerMain:\n      !/\\bmain\\s*\\(\\s*\\)\\s*\\.catch/.test(\n        producer\n          .slice(\n            0,\n            producer.indexOf(\n              \"if (isTrueForwardTop1DirectExecution())\",\n            ),\n          ),\n      ),\n\n    wrapperHasNoDbWriteSurface:\n      !/\\.(insert|update|upsert|delete)\\s*\\(/i.test(\n        wrapper,\n      ),\n\n    wrapperHasNoFileWriteSurface:\n      !/(writeFile|writeFileSync|appendFile|appendFileSync)/i.test(\n        wrapper,\n      ),\n\n    wrapperHasNoNetworkSurface:\n      !/\\bfetch\\s*\\(|axios\\.|https?\\.request/i.test(\n        wrapper,\n      ),\n\n    producerImportGuardStillPresent:\n      producer.includes(\n        \"export function isTrueForwardTop1DirectExecution(\",\n      ) &&\n      producer.includes(\n        \"if (isTrueForwardTop1DirectExecution())\",\n      ),\n  };\n\n  const failed =\n    Object.entries(\n      checks,\n    )\n      .filter(\n        ([, value]) =>\n          value !== true,\n      )\n      .map(\n        ([key]) =>\n          key,\n      );\n\n  console.log(\n    JSON.stringify(\n      {\n        status:\n          failed.length ===\n          0\n            ? \"AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_PURE_EXPORT_PROBE_WRAPPER_V1_STATIC_VERIFIED\"\n            : \"AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_PURE_EXPORT_PROBE_WRAPPER_V1_STATIC_FAILED\",\n\n        checks,\n\n        safety: {\n          sourceOnlyStaticVerify:\n            true,\n\n          producerExecuted:\n            false,\n\n          databaseReads:\n            0,\n\n          databaseWrites:\n            0,\n\n          fileWrites:\n            0,\n\n          networkCalls:\n            0,\n\n          ordersCreated:\n            0,\n\n          positionsChanged:\n            0,\n\n          realTradingEnabled:\n            false,\n        },\n\n        failed,\n\n        nextGate:\n          failed.length ===\n          0\n            ? \"RUN_PURE_EXPORT_PROBE_WRAPPER\"\n            : \"REPAIR_PURE_EXPORT_WRAPPER\",\n      },\n      null,\n      2,\n    ),\n  );\n\n  process.exitCode =\n    failed.length ===\n    0\n      ? 0\n      : 1;\n}\n",
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
        "test:true-forward-oos-producer-pure-export-static"
      ] =
        "node ./scripts/true-forward-oos-producer-pure-export-probe-wrapper-v1-static-verify.cjs";

      pkg.scripts[
        "test:true-forward-oos-producer-pure-export-wrapper"
      ] =
        "tsx --env-file=.env.local ./scripts/true-forward-oos-producer-pure-export-probe-wrapper-v1.ts";

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
              "AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_PURE_EXPORT_PROBE_WRAPPER_V1_INSTALLED",

            generated: [
              "scripts/true-forward-oos-producer-pure-export-probe-wrapper-v1.ts",
              "scripts/true-forward-oos-producer-pure-export-probe-wrapper-v1-static-verify.cjs",
            ],

            packageScripts: [
              "npm run test:true-forward-oos-producer-pure-export-static",
              "npm run test:true-forward-oos-producer-pure-export-wrapper",
            ],

            productSourceChanges:
              0,

            mode:
              "IMPORT_SAFE_PURE_EXPORT_ONLY",

            safety: {
              producerMainExecuted:
                false,

              producerRuntimeFunctionCalled:
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
              "RUN_STATIC_THEN_PURE_EXPORT_WRAPPER",
          },
          null,
          2,
        ),
      );

      process.exitCode = 0;
    }
  }
}
