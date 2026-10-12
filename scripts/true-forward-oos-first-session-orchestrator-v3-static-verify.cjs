const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const ORCH = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-first-session-orchestrator-v1.ts"
);

const TSX_CLI = path.join(
  ROOT,
  "node_modules",
  "tsx",
  "dist",
  "cli.mjs"
);

const source =
  fs.existsSync(ORCH)
    ? fs.readFileSync(
        ORCH,
        "utf8"
      )
    : "";

const checks = {
  orchestratorExists:
    Boolean(source),

  tsxCliExists:
    fs.existsSync(
      TSX_CLI
    ),

  envOverlayType:
    source.includes(
      "type EnvOverlay ="
    ) &&
    source.includes(
      "extraEnv: EnvOverlay = {},"
    ),

  nodeExecPath:
    source.includes(
      "process.execPath"
    ),

  localTsxCli:
    source.includes(
      '"cli.mjs"'
    ),

  noNpxCmd:
    !source.includes(
      "npx.cmd"
    ) &&
    !source.includes(
      "const NPX ="
    ),

  noNpmCmd:
    !source.includes(
      "npm.cmd"
    ) &&
    !source.includes(
      "const NPM ="
    ),

  noComSpec:
    !source.includes(
      "process.env.ComSpec"
    ),

  shellFalse:
    source.includes(
      "shell:\n          false"
    ),

  readinessPresent:
    source.includes(
      "true-forward-oos-first-real-session-readiness-v1.ts"
    ),

  evidencePresent:
    source.includes(
      "true-forward-oos-controlled-producer-evidence-run-v1.ts"
    ),

  dashboardContractPresent:
    source.includes(
      "forward-oos-observability-dashboard-v1-contract-test.ts"
    ),

  targetDatePreserved:
    source.includes(
      '"2026-10-12"'
    ),

  executeWindowPreserved:
    source.includes(
      '"08:45"'
    ) &&
    source.includes(
      '"08:59"'
    ),

  confirmationPreserved:
    source.includes(
      '"RUN_TRUE_FORWARD_OOS_NORMAL_PRODUCER"'
    ),

  realTradingForcedOff:
    source.includes(
      'REAL_TRADING_ENABLED:\n          "false"'
    ) &&
    source.includes(
      'ENABLE_REAL_TRADING:\n          "false"'
    ) &&
    source.includes(
      'ENABLE_LIVE_TRADING:\n          "false"'
    ),

  maxNormalRunOne:
    (
      source.match(
        /"CONTROLLED_NORMAL_EVIDENCE_RUN"/g
      ) ?? []
    ).length === 1,
};

const failed =
  Object.entries(checks)
    .filter(
      ([, value]) =>
        value !== true
    )
    .map(
      ([key]) =>
        key
    );

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "AI_STOCK_LAB_FORWARD_OOS_FIRST_SESSION_ORCHESTRATOR_V3_STATIC_VERIFIED"
          : "AI_STOCK_LAB_FORWARD_OOS_FIRST_SESSION_ORCHESTRATOR_V3_STATIC_FAILED",

      checks,

      repaired: {
        childRuntime:
          "process.execPath + local tsx/dist/cli.mjs",

        windowsShell:
          false,

        npxCmd:
          "REMOVED",

        npmCmd:
          "REMOVED",

        cmdExeWrapper:
          "REMOVED",

        envOverlay:
          "Record<string, string | undefined>",

        executeContract:
          "UNCHANGED"
      },

      safety: {
        sourceOnly:
          true,
        producerExecuted:
          false,
        databaseWrites:
          0,
        ordersCreated:
          0,
        positionsChanged:
          0,
        promotionExecuted:
          false,
        realTradingEnabled:
          false
      },

      failed,

      nextGate:
        failed.length === 0
          ? "RUN_ORCHESTRATOR_TSC_AND_DRY_RUN_V3"
          : "REPAIR_ORCHESTRATOR_V3"
    },
    null,
    2
  )
);

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
