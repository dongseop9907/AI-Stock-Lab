const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const ORCH = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-first-session-orchestrator-v1.ts"
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

  processEnvTypeSafe:
    source.includes(
      "Partial<NodeJS.ProcessEnv>"
    ),

  windowsComSpec:
    source.includes(
      "process.env.ComSpec"
    ),

  noShellTrue:
    !source.includes(
      "shell: true"
    ) &&
    !source.includes(
      "shell:\n          process.platform ==="
    ),

  cmdWrapper:
    source.includes(
      '"/d"'
    ) &&
    source.includes(
      '"/s"'
    ) &&
    source.includes(
      '"/c"'
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

  maxNormalRunOne:
    (
      source.match(
        /"CONTROLLED_NORMAL_EVIDENCE_RUN"/g
      ) ?? []
    ).length === 1,

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

  noDirectOrderApi:
    !source.includes(
      "/api/orders/"
    ),

  noPromotion:
    !source.includes(
      "/api/models/promotion/apply"
    ),
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
          ? "AI_STOCK_LAB_FORWARD_OOS_FIRST_SESSION_ORCHESTRATOR_V2_STATIC_VERIFIED"
          : "AI_STOCK_LAB_FORWARD_OOS_FIRST_SESSION_ORCHESTRATOR_V2_STATIC_FAILED",

      checks,

      repaired: {
        processEnv:
          "NodeJS.ProcessEnv -> Partial<NodeJS.ProcessEnv> for overlay env only",

        windowsSpawn:
          "cmd.exe /d /s /c with explicit quoted executable path",

        shellTrue:
          false,

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
          ? "RUN_ORCHESTRATOR_TSC_AND_DRY_RUN"
          : "REPAIR_ORCHESTRATOR_V2"
    },
    null,
    2
  )
);

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
