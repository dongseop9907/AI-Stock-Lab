const fs = require("fs");
const path = require("path");

const ROOT =
  process.cwd();

const PRODUCER =
  path.join(
    ROOT,
    "scripts",
    "alpha-v3-true-forward-top1-producer-v1.ts"
  );

const PACKAGE =
  path.join(
    ROOT,
    "package.json"
  );

const BACKUP =
  path.join(
    ROOT,
    "scripts",
    "backups",
    "alpha-v3-true-forward-top1-producer-v1.before-probe-only-v1.ts"
  );

const STATIC_VERIFY =
  path.join(
    ROOT,
    "scripts",
    "true-forward-oos-producer-probe-only-v1-static-verify.cjs"
  );

const SUBPROCESS_SMOKE =
  path.join(
    ROOT,
    "scripts",
    "true-forward-oos-producer-probe-only-real-subprocess-v1.cjs"
  );

function fail(
  reason,
  extra = {}
) {
  console.error(JSON.stringify({
    status:
      "AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_PROBE_ONLY_V1_INSTALL_FAILED",

    reason,
    ...extra,
  }, null, 2));

  process.exitCode = 1;
}

if (
  !fs.existsSync(
    PRODUCER
  ) ||
  !fs.existsSync(
    PACKAGE
  )
) {
  fail(
    "REQUIRED_FILES_MISSING",
    {
      producerExists:
        fs.existsSync(
          PRODUCER
        ),

      packageExists:
        fs.existsSync(
          PACKAGE
        ),
    }
  );
} else {
  let source =
    fs.readFileSync(
      PRODUCER,
      "utf8"
    );

  if (
    !source.includes(
      "export function isTrueForwardTop1DirectExecution("
    ) ||
    !source.includes(
      "if (isTrueForwardTop1DirectExecution())"
    )
  ) {
    fail(
      "IMPORT_SAFE_ENTRYPOINT_GUARD_REQUIRED_FIRST"
    );
  } else {
    fs.mkdirSync(
      path.dirname(
        BACKUP
      ),
      {
        recursive:
          true,
      }
    );

    if (
      !fs.existsSync(
        BACKUP
      )
    ) {
      fs.copyFileSync(
        PRODUCER,
        BACKUP
      );
    }

    let probeFunctionAdded =
      false;

    let probeBranchAdded =
      false;

    const probeFunctionMarker =
      "export function isTrueForwardTop1ProbeOnly(";

    if (
      !source.includes(
        probeFunctionMarker
      )
    ) {
      const mainMarker =
        "async function main() {";

      const mainIndex =
        source.indexOf(
          mainMarker
        );

      if (
        mainIndex < 0
      ) {
        fail(
          "MAIN_DEFINITION_NOT_FOUND"
        );
      } else {
        const probeFunction = `export function isTrueForwardTop1ProbeOnly(
  argv:
    string[] =
      process.argv.slice(2),
) {
  return argv.includes(
    "--probe-only",
  );
}

`;

        source =
          source.slice(
            0,
            mainIndex
          ) +
          probeFunction +
          source.slice(
            mainIndex
          );

        probeFunctionAdded =
          true;
      }
    }

    if (
      process.exitCode !== 1 &&
      !source.includes(
        "if (isTrueForwardTop1ProbeOnly())"
      )
    ) {
      const mainMarker =
        "async function main() {";

      const mainIndex =
        source.indexOf(
          mainMarker
        );

      if (
        mainIndex < 0
      ) {
        fail(
          "MAIN_DEFINITION_NOT_FOUND_AFTER_PROBE_FUNCTION_INSERT"
        );
      } else {
        const insertionIndex =
          mainIndex +
          mainMarker.length;

        const probeBranch = `

  /*
   * ALPHA_V3_TRUE_FORWARD_TOP1_PRODUCER_PROBE_ONLY_V1
   *
   * Direct CLI smoke boundary.
   * Must return before runTrueForwardTop1Producer(),
   * which owns DB reads and forward-session file writes.
   */
  if (isTrueForwardTop1ProbeOnly()) {
    console.log(
      JSON.stringify(
        {
          status:
            "ALPHA_V3_TRUE_FORWARD_TOP1_PRODUCER_V1_PROBE_ONLY",

          probeOnly:
            true,

          version:
            TRUE_FORWARD_TOP1_VERSION,

          safety: {
            producerRuntimeCalled:
              false,

            databaseReads:
              0,

            databaseWrites:
              0,

            fileWrites:
              0,

            ordersCreated:
              0,

            positionsChanged:
              0,

            realTradingEnabled:
              false,
          },

          nextGate:
            "VERIFY_AUTOMATION_SUBPROCESS_CAN_REACH_PRODUCER_PROBE_ONLY_BOUNDARY",
        },
        null,
        2,
      ),
    );

    return;
  }
`;

        source =
          source.slice(
            0,
            insertionIndex
          ) +
          probeBranch +
          source.slice(
            insertionIndex
          );

        probeBranchAdded =
          true;
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
        STATIC_VERIFY,
        "const fs = require(\"fs\");\nconst path = require(\"path\");\n\nconst ROOT = process.cwd();\n\nconst TARGET =\n  path.join(\n    ROOT,\n    \"scripts\",\n    \"alpha-v3-true-forward-top1-producer-v1.ts\"\n  );\n\nif (!fs.existsSync(TARGET)) {\n  console.error(JSON.stringify({\n    status:\n      \"AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_PROBE_ONLY_V1_STATIC_FAILED\",\n    failed: [\n      \"producerExists\",\n    ],\n  }, null, 2));\n\n  process.exitCode = 1;\n} else {\n  const source =\n    fs.readFileSync(\n      TARGET,\n      \"utf8\"\n    );\n\n  const mainIndex =\n    source.indexOf(\n      \"async function main() {\"\n    );\n\n  const probeFnIndex =\n    source.indexOf(\n      \"export function isTrueForwardTop1ProbeOnly(\"\n    );\n\n  const probeBranchIndex =\n    source.indexOf(\n      \"if (isTrueForwardTop1ProbeOnly())\",\n      Math.max(\n        0,\n        mainIndex\n      )\n    );\n\n  const runtimeCallIndex =\n    source.indexOf(\n      \"runTrueForwardTop1Producer(\",\n      Math.max(\n        0,\n        mainIndex\n      )\n    );\n\n  const firstReturnAfterProbe =\n    source.indexOf(\n      \"return;\",\n      Math.max(\n        0,\n        probeBranchIndex\n      )\n    );\n\n  const checks = {\n    producerExists:\n      true,\n\n    probeFunctionExported:\n      probeFnIndex >= 0,\n\n    probeFunctionUsesProcessArgv:\n      /isTrueForwardTop1ProbeOnly[\\s\\S]{0,700}process\\.argv/.test(\n        source\n      ),\n\n    probeOnlyFlagPresent:\n      source.includes(\n        \"--probe-only\"\n      ),\n\n    mainFound:\n      mainIndex >= 0,\n\n    probeBranchInsideMain:\n      mainIndex >= 0 &&\n      probeBranchIndex >\n        mainIndex,\n\n    probeReturnPresent:\n      firstReturnAfterProbe >\n      probeBranchIndex,\n\n    producerRuntimeCallFound:\n      runtimeCallIndex >= 0,\n\n    probeBeforeProducerRuntime:\n      probeBranchIndex >= 0 &&\n      runtimeCallIndex >= 0 &&\n      probeBranchIndex <\n        runtimeCallIndex,\n\n    returnBeforeProducerRuntime:\n      firstReturnAfterProbe >= 0 &&\n      runtimeCallIndex >= 0 &&\n      firstReturnAfterProbe <\n        runtimeCallIndex,\n\n    importSafeGuardStillPresent:\n      source.includes(\n        \"export function isTrueForwardTop1DirectExecution(\"\n      ) &&\n      source.includes(\n        \"if (isTrueForwardTop1DirectExecution())\"\n      ),\n\n    noTradingEnableSurfaceAdded:\n      !/PROBE_ONLY_V1[\\s\\S]{0,1200}(REAL_TRADING_ENABLED\\s*=\\s*[\"']true[\"']|ENABLE_REAL_TRADING\\s*=\\s*[\"']true[\"']|ENABLE_LIVE_TRADING\\s*=\\s*[\"']true[\"'])/i.test(\n        source\n      ),\n  };\n\n  const failed =\n    Object.entries(\n      checks\n    )\n      .filter(\n        ([, value]) =>\n          value !== true\n      )\n      .map(\n        ([key]) =>\n          key\n      );\n\n  console.log(JSON.stringify({\n    status:\n      failed.length === 0\n        ? \"AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_PROBE_ONLY_V1_STATIC_VERIFIED\"\n        : \"AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_PROBE_ONLY_V1_STATIC_FAILED\",\n\n    checks,\n\n    failed,\n\n    nextGate:\n      failed.length === 0\n        ? \"RUN_REAL_PRODUCER_SUBPROCESS_WITH_PROBE_ONLY\"\n        : \"REPAIR_PROBE_ONLY_EARLY_RETURN_BOUNDARY\",\n  }, null, 2));\n\n  process.exitCode =\n    failed.length === 0\n      ? 0\n      : 1;\n}\n",
        "utf8"
      );

      fs.writeFileSync(
        SUBPROCESS_SMOKE,
        "const fs = require(\"fs\");\nconst path = require(\"path\");\nconst {\n  spawnSync,\n} = require(\"child_process\");\n\nconst ROOT = process.cwd();\n\nconst TARGET =\n  path.join(\n    ROOT,\n    \"scripts\",\n    \"alpha-v3-true-forward-top1-producer-v1.ts\"\n  );\n\nfunction fail(\n  reason,\n  extra = {}\n) {\n  console.error(JSON.stringify({\n    status:\n      \"AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_PROBE_ONLY_REAL_SUBPROCESS_V1_FAILED\",\n    reason,\n    ...extra,\n  }, null, 2));\n\n  process.exitCode = 1;\n}\n\nif (!fs.existsSync(TARGET)) {\n  fail(\"PRODUCER_NOT_FOUND\");\n} else {\n  const env = {\n    ...process.env,\n\n    FORWARD_OOS_AUTOMATION_ENABLED:\n      \"false\",\n\n    REAL_TRADING_ENABLED:\n      \"false\",\n\n    ENABLE_REAL_TRADING:\n      \"false\",\n\n    ENABLE_LIVE_TRADING:\n      \"false\",\n  };\n\n  const args = [\n    \"--env-file=.env.local\",\n    \"--import\",\n    \"tsx\",\n    TARGET,\n    \"--probe-only\",\n  ];\n\n  const result =\n    spawnSync(\n      process.execPath,\n      args,\n      {\n        cwd:\n          ROOT,\n\n        env,\n\n        encoding:\n          \"utf8\",\n\n        shell:\n          false,\n\n        timeout:\n          15000,\n      }\n    );\n\n  const stdout =\n    String(\n      result.stdout ??\n      \"\"\n    ).trim();\n\n  const stderr =\n    String(\n      result.stderr ??\n      \"\"\n    ).trim();\n\n  let payload = null;\n\n  try {\n    payload =\n      stdout\n        ? JSON.parse(\n            stdout\n          )\n        : null;\n  } catch {\n    payload = null;\n  }\n\n  const checks = {\n    spawnErrorAbsent:\n      !result.error,\n\n    exitedZero:\n      result.status ===\n      0,\n\n    jsonPayloadParsed:\n      payload !==\n      null,\n\n    probeOnlyAcknowledged:\n      payload\n        ?.probeOnly ===\n      true,\n\n    expectedStatus:\n      payload\n        ?.status ===\n      \"ALPHA_V3_TRUE_FORWARD_TOP1_PRODUCER_V1_PROBE_ONLY\",\n\n    producerRuntimeNotCalled:\n      payload\n        ?.safety\n        ?.producerRuntimeCalled ===\n      false,\n\n    databaseReadsZero:\n      payload\n        ?.safety\n        ?.databaseReads ===\n      0,\n\n    databaseWritesZero:\n      payload\n        ?.safety\n        ?.databaseWrites ===\n      0,\n\n    fileWritesZero:\n      payload\n        ?.safety\n        ?.fileWrites ===\n      0,\n\n    ordersCreatedZero:\n      payload\n        ?.safety\n        ?.ordersCreated ===\n      0,\n\n    positionsChangedZero:\n      payload\n        ?.safety\n        ?.positionsChanged ===\n      0,\n\n    realTradingDisabled:\n      payload\n        ?.safety\n        ?.realTradingEnabled ===\n      false,\n  };\n\n  const failed =\n    Object.entries(\n      checks\n    )\n      .filter(\n        ([, value]) =>\n          value !== true\n      )\n      .map(\n        ([key]) =>\n          key\n      );\n\n  console.log(JSON.stringify({\n    status:\n      failed.length === 0\n        ? \"AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_PROBE_ONLY_REAL_SUBPROCESS_V1_VERIFIED\"\n        : \"AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_PROBE_ONLY_REAL_SUBPROCESS_V1_FAILED\",\n\n    command: {\n      executable:\n        \"process.execPath\",\n\n      args: [\n        \"--env-file=.env.local\",\n        \"--import\",\n        \"tsx\",\n        \"scripts/alpha-v3-true-forward-top1-producer-v1.ts\",\n        \"--probe-only\",\n      ],\n    },\n\n    subprocess: {\n      exitCode:\n        result.status,\n\n      signal:\n        result.signal,\n\n      spawnError:\n        result.error\n          ? String(\n              result.error.message ??\n              result.error\n            )\n          : null,\n\n      stderrTail:\n        stderr\n          .split(/\\r?\\n/)\n          .slice(\n            -10\n          ),\n    },\n\n    payload,\n\n    checks,\n\n    safety: {\n      normalProducerExecution:\n        false,\n\n      probeOnlyExecution:\n        true,\n\n      databaseReads:\n        payload\n          ?.safety\n          ?.databaseReads ??\n        null,\n\n      databaseWrites:\n        payload\n          ?.safety\n          ?.databaseWrites ??\n        null,\n\n      fileWrites:\n        payload\n          ?.safety\n          ?.fileWrites ??\n        null,\n\n      ordersCreated:\n        payload\n          ?.safety\n          ?.ordersCreated ??\n        null,\n\n      positionsChanged:\n        payload\n          ?.safety\n          ?.positionsChanged ??\n        null,\n\n      realTradingEnabled:\n        false,\n    },\n\n    failed,\n\n    nextGate:\n      failed.length === 0\n        ? \"RERUN_PRODUCER_IMPORT_AND_FORWARD_OOS_REGRESSION_THEN_VERIFY_AUTOMATION_PROBE_COMMAND\"\n        : \"DO_NOT_RUN_NORMAL_PRODUCER_REPAIR_PROBE_ONLY_BOUNDARY\",\n  }, null, 2));\n\n  process.exitCode =\n    failed.length === 0\n      ? 0\n      : 1;\n}\n",
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
          "test:true-forward-oos-producer-probe-only-static"
        ] =
          "node ./scripts/true-forward-oos-producer-probe-only-v1-static-verify.cjs";

        pkg.scripts[
          "test:true-forward-oos-producer-probe-only-subprocess"
        ] =
          "node ./scripts/true-forward-oos-producer-probe-only-real-subprocess-v1.cjs";

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
            "AI_STOCK_LAB_TRUE_FORWARD_OOS_PRODUCER_PROBE_ONLY_V1_INSTALLED",

          changed:
            probeFunctionAdded ||
            probeBranchAdded,

          target:
            "scripts/alpha-v3-true-forward-top1-producer-v1.ts",

          backup:
            "scripts/backups/alpha-v3-true-forward-top1-producer-v1.before-probe-only-v1.ts",

          changes: {
            probeFunctionAdded,
            probeBranchAdded,
          },

          generated: [
            "scripts/true-forward-oos-producer-probe-only-v1-static-verify.cjs",
            "scripts/true-forward-oos-producer-probe-only-real-subprocess-v1.cjs",
          ],

          contract: {
            flag:
              "--probe-only",

            entry:
              "DIRECT_CLI_ONLY",

            returnsBefore:
              "runTrueForwardTop1Producer",

            normalCliBehavior:
              "UNCHANGED_WITHOUT_PROBE_FLAG",
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
            "RUN_STATIC_AND_REAL_PROBE_ONLY_SUBPROCESS",
        }, null, 2));

        process.exitCode = 0;
      }
    }
  }
}
