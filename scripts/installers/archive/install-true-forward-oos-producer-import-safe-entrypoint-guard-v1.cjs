const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const PRODUCER = path.join(
  ROOT,
  "scripts",
  "alpha-v3-true-forward-top1-producer-v1.ts"
);

const PACKAGE = path.join(
  ROOT,
  "package.json"
);

const BACKUP = path.join(
  ROOT,
  "scripts",
  "backups",
  "alpha-v3-true-forward-top1-producer-v1.before-import-safe-entrypoint-guard-v1.ts"
);

const IMPORT_SMOKE = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-producer-import-safe-entrypoint-guard-v1-import-smoke.ts"
);

const STATIC_VERIFY = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-producer-import-safe-entrypoint-guard-v1-static-verify.cjs"
);

function fail(reason, extra = {}) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_IMPORT_SAFE_ENTRYPOINT_GUARD_V1_INSTALL_FAILED",

    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

if (
  !fs.existsSync(PRODUCER) ||
  !fs.existsSync(PACKAGE)
) {
  fail(
    "REQUIRED_FILES_MISSING",
    {
      producerExists:
        fs.existsSync(PRODUCER),

      packageExists:
        fs.existsSync(PACKAGE),
    }
  );
} else {
  let source =
    fs.readFileSync(
      PRODUCER,
      "utf8"
    );

  fs.mkdirSync(
    path.dirname(BACKUP),
    {
      recursive:
        true,
    }
  );

  if (
    !fs.existsSync(BACKUP)
  ) {
    fs.copyFileSync(
      PRODUCER,
      BACKUP
    );
  }

  const guardMarker =
    "export function isTrueForwardTop1DirectExecution(";

  let guardAdded =
    false;

  let mainWrapped =
    false;

  if (
    !source.includes(
      guardMarker
    )
  ) {
    const mainDefinition =
      "async function main() {";

    const mainIndex =
      source.indexOf(
        mainDefinition
      );

    if (
      mainIndex < 0
    ) {
      fail(
        "MAIN_DEFINITION_NOT_FOUND"
      );
    } else {
      const guard = `export function isTrueForwardTop1DirectExecution(
  argv1:
    string | undefined =
      process.argv[1],
) {
  if (!argv1) {
    return false;
  }

  return (
    path.basename(
      argv1,
    ) ===
    "alpha-v3-true-forward-top1-producer-v1.ts"
  );
}

`;

      source =
        source.slice(
          0,
          mainIndex
        ) +
        guard +
        source.slice(
          mainIndex
        );

      guardAdded =
        true;
    }
  }

  if (
    process.exitCode !== 1
  ) {
    if (
      !source.includes(
        "if (isTrueForwardTop1DirectExecution())"
      )
    ) {
      const mainCall =
        "main().catch(";

      const mainCallIndex =
        source.lastIndexOf(
          mainCall
        );

      if (
        mainCallIndex < 0
      ) {
        fail(
          "MAIN_INVOCATION_NOT_FOUND"
        );
      } else {
        const before =
          source.slice(
            0,
            mainCallIndex
          );

        const tail =
          source.slice(
            mainCallIndex
          );

        if (
          tail.length >
          5000
        ) {
          fail(
            "MAIN_INVOCATION_NOT_NEAR_FILE_END",
            {
              tailLength:
                tail.length,
            }
          );
        } else {
          source =
            before +
            "if (isTrueForwardTop1DirectExecution()) {\n  " +
            tail.replace(
              /\n/g,
              "\n  "
            ).replace(
              /\s+$/,
              ""
            ) +
            "\n}\n";

          mainWrapped =
            true;
        }
      }
    }

    if (
      process.exitCode !== 1
    ) {
      fs.writeFileSync(
        PRODUCER,
        source,
        "utf8"
      );

      fs.writeFileSync(
        IMPORT_SMOKE,
        "import {\n  TRUE_FORWARD_TOP1_VERSION,\n  isTrueForwardTop1DirectExecution,\n  nextExpectedKrxOpenDate,\n} from \"./alpha-v3-true-forward-top1-producer-v1\";\n\nasync function main() {\n  const sourceDate =\n    \"2026-10-08\";\n\n  const nextDate =\n    nextExpectedKrxOpenDate(\n      sourceDate,\n      [],\n    );\n\n  const checks = {\n    moduleImported:\n      true,\n\n    versionExportAvailable:\n      typeof TRUE_FORWARD_TOP1_VERSION ===\n      \"string\",\n\n    importedContextNotDirect:\n      isTrueForwardTop1DirectExecution(\n        process.argv[1],\n      ) ===\n      false,\n\n    producerFilenameRecognizedAsDirect:\n      isTrueForwardTop1DirectExecution(\n        \"C:\\\\temp\\\\scripts\\\\alpha-v3-true-forward-top1-producer-v1.ts\",\n      ) ===\n      true,\n\n    otherFilenameRejected:\n      isTrueForwardTop1DirectExecution(\n        \"C:\\\\temp\\\\scripts\\\\some-wrapper.ts\",\n      ) ===\n      false,\n\n    pureCalendarExportCallable:\n      nextDate ===\n      \"2026-10-12\",\n  };\n\n  const failed =\n    Object.entries(\n      checks,\n    )\n      .filter(\n        ([, value]) =>\n          value !== true,\n      )\n      .map(\n        ([key]) =>\n          key,\n      );\n\n  console.log(\n    JSON.stringify(\n      {\n        status:\n          failed.length === 0\n            ? \"AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_IMPORT_SAFE_ENTRYPOINT_GUARD_V1_IMPORT_SMOKE_VERIFIED\"\n            : \"AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_IMPORT_SAFE_ENTRYPOINT_GUARD_V1_IMPORT_SMOKE_FAILED\",\n\n        checks,\n\n        observation: {\n          sourceDate,\n          nextDate,\n        },\n\n        safety: {\n          producerMainExpectedToRun:\n            false,\n\n          producerSubprocessExecuted:\n            false,\n\n          intendedDatabaseReads:\n            0,\n\n          intendedDatabaseWrites:\n            0,\n\n          intendedFileWrites:\n            0,\n\n          ordersCreated:\n            0,\n\n          positionsChanged:\n            0,\n\n          realTradingEnabled:\n            false,\n        },\n\n        failed,\n\n        nextGate:\n          failed.length === 0\n            ? \"RERUN_FORWARD_OOS_PIPELINE_CONTRACT_AND_STATIC_REGRESSION\"\n            : \"REPAIR_ENTRYPOINT_GUARD_BEFORE_ANY_REAL_PRODUCER_EXECUTION\",\n      },\n      null,\n      2,\n    ),\n  );\n\n  process.exitCode =\n    failed.length === 0\n      ? 0\n      : 1;\n}\n\nmain().catch(\n  error => {\n    console.error(\n      JSON.stringify(\n        {\n          status:\n            \"AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_IMPORT_SAFE_ENTRYPOINT_GUARD_V1_IMPORT_SMOKE_FAILED\",\n\n          error:\n            String(\n              error instanceof Error\n                ? error.message\n                : error,\n            ),\n\n          failed: [\n            \"importSmokeRuntime\",\n          ],\n        },\n        null,\n        2,\n      ),\n    );\n\n    process.exitCode = 1;\n  },\n);\n",
        "utf8"
      );

      fs.writeFileSync(
        STATIC_VERIFY,
        "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst ROOT = process.cwd();\n\nconst TARGET_REL =\n  \"scripts/alpha-v3-true-forward-top1-producer-v1.ts\";\n\nconst TARGET =\n  path.join(\n    ROOT,\n    TARGET_REL,\n  );\n\nif (!fs.existsSync(TARGET)) {\n  console.error(JSON.stringify({\n    status:\n      \"AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_IMPORT_SAFE_ENTRYPOINT_GUARD_V1_STATIC_FAILED\",\n    failed: [\n      \"producerExists\",\n    ],\n  }, null, 2));\n\n  process.exitCode = 1;\n} else {\n  const source =\n    fs.readFileSync(\n      TARGET,\n      \"utf8\",\n    );\n\n  const guardIndex =\n    source.indexOf(\n      \"export function isTrueForwardTop1DirectExecution(\"\n    );\n\n  const mainDefinitionIndex =\n    source.indexOf(\n      \"async function main()\"\n    );\n\n  const guardedMainIndex =\n    source.indexOf(\n      \"if (isTrueForwardTop1DirectExecution())\"\n    );\n\n  const mainCallIndex =\n    source.indexOf(\n      \"main().catch(\",\n      Math.max(\n        0,\n        guardedMainIndex,\n      ),\n    );\n\n  const checks = {\n    producerExists:\n      true,\n\n    guardExportPresent:\n      guardIndex >= 0,\n\n    guardUsesArgv1:\n      /isTrueForwardTop1DirectExecution[\\s\\S]{0,500}process\\.argv\\s*\\[\\s*1\\s*\\]/.test(\n        source,\n      ),\n\n    guardUsesProducerFilename:\n      source.includes(\n        \"alpha-v3-true-forward-top1-producer-v1.ts\"\n      ),\n\n    guardUsesPathBasename:\n      /path\\.basename\\s*\\(/.test(\n        source,\n      ),\n\n    guardBeforeMainDefinition:\n      guardIndex >= 0 &&\n      mainDefinitionIndex >= 0 &&\n      guardIndex <\n        mainDefinitionIndex,\n\n    directExecutionIfPresent:\n      guardedMainIndex >= 0,\n\n    mainCallInsideGuardOrder:\n      guardedMainIndex >= 0 &&\n      mainCallIndex >= 0 &&\n      guardedMainIndex <\n        mainCallIndex,\n\n    oldNakedMainPatternGone:\n      !/\\nmain\\(\\)\\.catch\\(/.test(\n        source,\n      ),\n\n    pureCalendarExportStillPresent:\n      source.includes(\n        \"export function nextExpectedKrxOpenDate(\"\n      ),\n\n    producerRuntimeExportStillPresent:\n      source.includes(\n        \"export async function runTrueForwardTop1Producer(\"\n      ),\n  };\n\n  const failed =\n    Object.entries(\n      checks,\n    )\n      .filter(\n        ([, value]) =>\n          value !== true,\n      )\n      .map(\n        ([key]) =>\n          key,\n      );\n\n  console.log(JSON.stringify({\n    status:\n      failed.length === 0\n        ? \"AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_IMPORT_SAFE_ENTRYPOINT_GUARD_V1_STATIC_VERIFIED\"\n        : \"AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_IMPORT_SAFE_ENTRYPOINT_GUARD_V1_STATIC_FAILED\",\n\n    checks,\n\n    failed,\n\n    nextGate:\n      failed.length === 0\n        ? \"RUN_IMPORT_SMOKE_AND_FORWARD_OOS_REGRESSIONS\"\n        : \"REPAIR_ENTRYPOINT_GUARD\",\n  }, null, 2));\n\n  process.exitCode =\n    failed.length === 0\n      ? 0\n      : 1;\n}\n",
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
          "test:true-forward-oos-producer-entrypoint-static"
        ] =
          "node ./scripts/true-forward-oos-producer-import-safe-entrypoint-guard-v1-static-verify.cjs";

        pkg.scripts[
          "test:true-forward-oos-producer-entrypoint-import-smoke"
        ] =
          "tsx --env-file=.env.local ./scripts/true-forward-oos-producer-import-safe-entrypoint-guard-v1-import-smoke.ts";

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
            "AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_IMPORT_SAFE_ENTRYPOINT_GUARD_V1_INSTALLED",

          changed:
            guardAdded ||
            mainWrapped,

          target:
            "scripts/alpha-v3-true-forward-top1-producer-v1.ts",

          backup:
            "scripts/backups/alpha-v3-true-forward-top1-producer-v1.before-import-safe-entrypoint-guard-v1.ts",

          changes: {
            guardAdded,
            mainWrapped,
          },

          generated: [
            "scripts/true-forward-oos-producer-import-safe-entrypoint-guard-v1-static-verify.cjs",
            "scripts/true-forward-oos-producer-import-safe-entrypoint-guard-v1-import-smoke.ts",
          ],

          semantics: {
            directCliExecution:
              "PRESERVED_WHEN_ARGV1_BASENAME_MATCHES_PRODUCER_FILENAME",

            importedModuleExecution:
              "MAIN_NOT_EXECUTED",

            pureExports:
              "IMPORTABLE",
          },

          safety: {
            installerExecutedProducer:
              false,

            databaseReads:
              0,

            databaseWrites:
              0,

            producerFileWritesDuringInstaller:
              0,

            ordersCreated:
              0,

            positionsChanged:
              0,

            realTradingEnabled:
              false,
          },

          nextAction:
            "RUN_STATIC_IMPORT_SMOKE_AND_FORWARD_OOS_CONTRACT_REGRESSION",
        }, null, 2));

        process.exitCode = 0;
      }
    }
  }
}
