const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const ORCH = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-first-session-orchestrator-v1.ts"
);

const STATIC = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-first-session-orchestrator-v2-static-verify.cjs"
);

function fail(reason, extra = {}) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_FORWARD_OOS_FIRST_SESSION_ORCHESTRATOR_V2_REPAIR_FAILED",
        reason,
        ...extra,
      },
      null,
      2
    )
  );

  process.exitCode = 1;
}

if (!fs.existsSync(ORCH)) {
  fail("ORCHESTRATOR_NOT_FOUND");
  return;
}

const backupDir = path.join(
  ROOT,
  "scripts",
  "backups"
);

fs.mkdirSync(
  backupDir,
  { recursive: true }
);

const backup = path.join(
  backupDir,
  "true-forward-oos-first-session-orchestrator-v1.before-windows-spawn-fix-v2.ts"
);

if (!fs.existsSync(backup)) {
  fs.copyFileSync(
    ORCH,
    backup
  );
}

let source =
  fs.readFileSync(
    ORCH,
    "utf8"
  );

source = source.replace(
  `  extraEnv: NodeJS.ProcessEnv = {},`,
  `  extraEnv: Partial<NodeJS.ProcessEnv> = {},`
);

const oldSpawn = `  const result =
    spawnSync(
      command,
      args,
      {
        cwd:
          process.cwd(),
        env: {
          ...process.env,
          ...extraEnv,
        },
        encoding:
          "utf8",
        shell:
          process.platform ===
          "win32",
      },
    );`;

const newSpawn = `  const result =
    process.platform ===
    "win32"
      ? (() => {
          const comspec =
            process.env.ComSpec ??
            "C:\\\\Windows\\\\System32\\\\cmd.exe";

          const quote =
            (value: string) =>
              "\\"" +
              value.replaceAll(
                "\\"",
                "\\"\\"",
              ) +
              "\\"";

          const commandLine =
            "\\"" +
            [
              command,
              ...args,
            ]
              .map(quote)
              .join(" ") +
            "\\"";

          return spawnSync(
            comspec,
            [
              "/d",
              "/s",
              "/c",
              commandLine,
            ],
            {
              cwd:
                process.cwd(),
              env: {
                ...process.env,
                ...extraEnv,
              },
              encoding:
                "utf8",
              shell:
                false,
            },
          );
        })()
      : spawnSync(
          command,
          args,
          {
            cwd:
              process.cwd(),
            env: {
              ...process.env,
              ...extraEnv,
            },
            encoding:
              "utf8",
            shell:
              false,
          },
        );`;

if (
  !source.includes(
    `Partial<NodeJS.ProcessEnv>`
  )
) {
  fail(
    "PROCESS_ENV_TYPE_REPAIR_NOT_APPLIED"
  );
  return;
}

if (
  source.includes(oldSpawn)
) {
  source =
    source.replace(
      oldSpawn,
      newSpawn
    );
}
else if (
  !source.includes(
    `process.env.ComSpec`
  )
) {
  fail(
    "SPAWN_BLOCK_NOT_FOUND",
    {
      hint:
        "Orchestrator source no longer matches V1 spawn block."
    }
  );
  return;
}

fs.writeFileSync(
  ORCH,
  source,
  "utf8"
);

const checks = {
  partialProcessEnv:
    source.includes(
      "extraEnv: Partial<NodeJS.ProcessEnv> = {},"
    ),

  windowsUsesComSpec:
    source.includes(
      "process.env.ComSpec"
    ),

  windowsCmdWrapper:
    source.includes(
      '"/d"'
    ) &&
    source.includes(
      '"/s"'
    ) &&
    source.includes(
      '"/c"'
    ),

  shellTrueRemoved:
    !source.includes(
      "shell:\n          process.platform ==="
    ) &&
    !source.includes(
      "shell: true"
    ),

  shellFalsePresent:
    source.includes(
      "shell:\n                false"
    ) ||
    source.includes(
      "shell:\n              false"
    ),

  executeGuardPreserved:
    source.includes(
      '"2026-10-12"'
    ) &&
    source.includes(
      '"08:45"'
    ) &&
    source.includes(
      '"08:59"'
    ) &&
    source.includes(
      '"RUN_TRUE_FORWARD_OOS_NORMAL_PRODUCER"'
    ),

  realTradingOffPreserved:
    source.includes(
      'REAL_TRADING_ENABLED:\n          "false"'
    ) &&
    source.includes(
      'ENABLE_REAL_TRADING:\n          "false"'
    ) &&
    source.includes(
      'ENABLE_LIVE_TRADING:\n          "false"'
    ),

  maxNormalEvidenceRunPreserved:
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

if (failed.length > 0) {
  fail(
    "POST_REPAIR_CHECK_FAILED",
    {
      checks,
      failed
    }
  );
  return;
}

const staticSource = `const fs = require("fs");
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
      "shell:\\n          process.platform ==="
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
      'REAL_TRADING_ENABLED:\\n          "false"'
    ) &&
    source.includes(
      'ENABLE_REAL_TRADING:\\n          "false"'
    ) &&
    source.includes(
      'ENABLE_LIVE_TRADING:\\n          "false"'
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
`;

fs.writeFileSync(
  STATIC,
  staticSource,
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "AI_STOCK_LAB_FORWARD_OOS_FIRST_SESSION_ORCHESTRATOR_V2_REPAIRED",

      changedFile:
        "scripts/true-forward-oos-first-session-orchestrator-v1.ts",

      generatedFile:
        "scripts/true-forward-oos-first-session-orchestrator-v2-static-verify.cjs",

      backupFile:
        "scripts/backups/true-forward-oos-first-session-orchestrator-v1.before-windows-spawn-fix-v2.ts",

      repair: {
        processEnvOverlayType:
          "Partial<NodeJS.ProcessEnv>",

        windowsExecution:
          "COMSPEC_CMD_WRAPPER",

        shellTrueRemoved:
          true,

        targetDate:
          "2026-10-12",

        executeWindowKst:
          "08:45-08:59",

        executeConfirmation:
          "RUN_TRUE_FORWARD_OOS_NORMAL_PRODUCER",

        realTrading:
          "FORCED_OFF"
      },

      checks,

      safety: {
        runtimeExecution:
          false,
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

      failed: [],

      nextAction:
        "RUN_STATIC_TYPECHECK_AND_DRY_RUN_ORCHESTRATOR_V2"
    },
    null,
    2
  )
);

process.exitCode = 0;
