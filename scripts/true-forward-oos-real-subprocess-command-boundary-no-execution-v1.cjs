const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const BINDING_REL =
  "lib/research/run-true-forward-oos-automation-binding-v1.ts";

const EXPECTED = {
  PRODUCE:
    "scripts/alpha-v3-true-forward-top1-producer-v1.ts",

  COLLECT:
    "scripts/alpha-v3-true-entry-forward-oos-collector-v1.ts",

  EVALUATE:
    "scripts/alpha-v3-true-forward-oos-evaluator-v1.ts",

  SUMMARY:
    "scripts/alpha-v3-true-forward-oos-summary.ts",
};

function fail(
  reason,
  extra = {},
) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_TRUE_FORWARD_OOS_REAL_SUBPROCESS_COMMAND_BOUNDARY_NO_EXECUTION_V1_FAILED",

        reason,
        ...extra,
      },
      null,
      2,
    ),
  );

  process.exitCode = 1;
}

const bindingPath =
  path.join(
    ROOT,
    BINDING_REL,
  );

if (
  !fs.existsSync(
    bindingPath,
  )
) {
  fail(
    "BINDING_NOT_FOUND",
  );
} else {
  const source =
    fs.readFileSync(
      bindingPath,
      "utf8",
    );

  const compact =
    source.replace(
      /\s+/g,
      " ",
    );

  const targetExistence =
    Object.fromEntries(
      Object.entries(
        EXPECTED,
      ).map(
        ([step, rel]) => [
          step,
          fs.existsSync(
            path.join(
              ROOT,
              rel,
            ),
          ),
        ],
      ),
    );

  const targetReferences =
    Object.fromEntries(
      Object.entries(
        EXPECTED,
      ).map(
        ([step, rel]) => [
          step,
          source.includes(
            rel,
          ),
        ],
      ),
    );

  const directImports =
    Object.fromEntries(
      Object.entries(
        EXPECTED,
      ).map(
        ([step, rel]) => {
          const escaped =
            rel
              .replace(
                /^scripts\//,
                "",
              )
              .replace(
                /\.ts$/,
                "",
              )
              .replace(
                /[.*+?^${}()|[\]\\]/g,
                "\\$&",
              );

          const re =
            new RegExp(
              `from\\s+["'][^"']*${escaped}["']|require\\s*\\(\\s*["'][^"']*${escaped}["']\\s*\\)`,
              "i",
            );

          return [
            step,
            re.test(
              source,
            ),
          ];
        },
      ),
    );

  const checks = {
    bindingExists:
      true,

    produceTargetExists:
      targetExistence
        .PRODUCE ===
        true,

    collectTargetExists:
      targetExistence
        .COLLECT ===
        true,

    evaluateTargetExists:
      targetExistence
        .EVALUATE ===
        true,

    summaryTargetExists:
      targetExistence
        .SUMMARY ===
        true,

    produceTargetReferenced:
      targetReferences
        .PRODUCE ===
        true,

    collectTargetReferenced:
      targetReferences
        .COLLECT ===
        true,

    evaluateTargetReferenced:
      targetReferences
        .EVALUATE ===
        true,

    summaryTargetReferenced:
      targetReferences
        .SUMMARY ===
        true,

    noDirectCliScriptImport:
      Object.values(
        directImports,
      ).every(
        value =>
          value === false,
      ),

    processExecPathUsed:
      /process\.execPath/.test(
        source,
      ),

    tsxLoaderBoundaryPresent:
      source.includes(
        "--import",
      ) &&
      /\btsx\b/.test(
        source,
      ),

    envFileBoundaryPresent:
      source.includes(
        "--env-file",
      ) &&
      source.includes(
        ".env.local",
      ),

    subprocessPrimitivePresent:
      /\bspawnSync\s*\(|\bspawn\s*\(|\bexecFile\s*\(|\bexecFileSync\s*\(/.test(
        source,
      ),

    injectableRunStepPresent:
      /\brunStep\b/.test(
        source,
      ),

    realTradingFlagForcedOff:
      source.includes(
        "REAL_TRADING_ENABLED",
      ) &&
      source.includes(
        "ENABLE_REAL_TRADING",
      ) &&
      source.includes(
        "ENABLE_LIVE_TRADING",
      ) &&
      /REAL_TRADING_ENABLED[\s\S]{0,200}false/i.test(
        source,
      ) &&
      /ENABLE_REAL_TRADING[\s\S]{0,200}false/i.test(
        source,
      ) &&
      /ENABLE_LIVE_TRADING[\s\S]{0,200}false/i.test(
        source,
      ),

    forwardOosFeatureFlagPresent:
      source.includes(
        "FORWARD_OOS_AUTOMATION_ENABLED",
      ),

    noShellTrueMarker:
      !/shell\s*:\s*true/.test(
        source,
      ),
  };

  const failed =
    Object.entries(
      checks,
    )
      .filter(
        ([, value]) =>
          value !== true,
      )
      .map(
        ([key]) =>
          key,
      );

  const commandBoundary = {
    executable:
      "process.execPath",

    expectedArguments: [
      "--env-file=.env.local OR equivalent split args",
      "--import tsx",
      "<step script path>",
    ],

    expectedTargets:
      EXPECTED,

    forcedEnvironment: {
      REAL_TRADING_ENABLED:
        "false",

      ENABLE_REAL_TRADING:
        "false",

      ENABLE_LIVE_TRADING:
        "false",
    },

    subprocessActuallyExecuted:
      false,
  };

  const report = {
    status:
      failed.length === 0
        ? "AI_STOCK_LAB_TRUE_FORWARD_OOS_REAL_SUBPROCESS_COMMAND_BOUNDARY_NO_EXECUTION_V1_VERIFIED"
        : "AI_STOCK_LAB_TRUE_FORWARD_OOS_REAL_SUBPROCESS_COMMAND_BOUNDARY_NO_EXECUTION_V1_FAILED",

    mode:
      "READ_ONLY_COMMAND_BOUNDARY_VERIFICATION",

    checks,

    targetExistence,

    targetReferences,

    directImports,

    commandBoundary,

    safety: {
      subprocessExecuted:
        false,

      collectorExecuted:
        false,

      evaluatorExecuted:
        false,

      summaryExecuted:
        false,

      producerExecuted:
        false,

      networkCalls:
        0,

      databaseReads:
        0,

      databaseWrites:
        0,

      ordersCreated:
        0,

      positionsChanged:
        0,

      promotionApplied:
        false,

      realTradingEnabled:
        false,
    },

    failed,

    nextGate:
      failed.length === 0
        ? "RUN_FORWARD_OOS_REAL_PRODUCER_SUBPROCESS_PROBE_ONLY_OR_READ_ONLY_BOUNDARY_V1"
        : "REPAIR_SUBPROCESS_COMMAND_BOUNDARY_BEFORE_ANY_REAL_STEP_EXECUTION",
  };

  fs.mkdirSync(
    path.join(
      ROOT,
      "logs",
    ),
    {
      recursive:
        true,
    },
  );

  fs.writeFileSync(
    path.join(
      ROOT,
      "logs",
      "true-forward-oos-real-subprocess-command-boundary-no-execution-v1.json",
    ),
    JSON.stringify(
      report,
      null,
      2,
    ),
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        status:
          report.status,

        checks:
          report.checks,

        commandBoundary:
          report.commandBoundary,

        failed:
          report.failed,

        nextGate:
          report.nextGate,
      },
      null,
      2,
    ),
  );

  process.exitCode =
    failed.length === 0
      ? 0
      : 1;
}
