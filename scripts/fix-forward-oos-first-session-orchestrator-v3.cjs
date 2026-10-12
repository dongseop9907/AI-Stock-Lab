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
  "true-forward-oos-first-session-orchestrator-v3-static-verify.cjs"
);

function fail(reason, extra = {}) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_FORWARD_OOS_FIRST_SESSION_ORCHESTRATOR_V3_REPAIR_FAILED",
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
  {
    recursive: true
  }
);

const backup = path.join(
  backupDir,
  "true-forward-oos-first-session-orchestrator-v1.before-node-tsx-spawn-v3.ts"
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

try {
  const constantsPattern =
    /const NPM =[\s\S]*?const NPX =[\s\S]*?: "npx";/;

  const constantsReplacement =
`const NODE =
  process.execPath;

const TSX_CLI =
  path.join(
    process.cwd(),
    "node_modules",
    "tsx",
    "dist",
    "cli.mjs",
  );

type EnvOverlay =
  Record<
    string,
    string | undefined
  >;`;

  if (
    constantsPattern.test(source)
  ) {
    source =
      source.replace(
        constantsPattern,
        constantsReplacement
      );
  }
  else if (
    !source.includes(
      "const TSX_CLI ="
    )
  ) {
    throw new Error(
      "NODE_TSX_CONSTANTS_ANCHOR_NOT_FOUND"
    );
  }

  source =
    source.replace(
      `  extraEnv: Partial<NodeJS.ProcessEnv> = {},`,
      `  extraEnv: EnvOverlay = {},`
    );

  source =
    source.replace(
      `  extraEnv: NodeJS.ProcessEnv = {},`,
      `  extraEnv: EnvOverlay = {},`
    );

  const runStart =
    source.indexOf(
      "function run("
    );

  const outputStart =
    source.indexOf(
      "\nfunction outputStep(",
      runStart
    );

  if (
    runStart < 0 ||
    outputStart < 0
  ) {
    throw new Error(
      "RUN_FUNCTION_BOUNDARY_NOT_FOUND"
    );
  }

  const runFunction =
`function run(
  step: string,
  command: string,
  args: string[],
  extraEnv: EnvOverlay = {},
): StepResult {
  const result =
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
          false,

        windowsHide:
          true,
      },
    );

  const exitCode =
    typeof result.status ===
      "number"
      ? result.status
      : 1;

  return {
    step,
    command,
    args,
    exitCode,

    stdout:
      result.stdout ??
      "",

    stderr:
      (
        result.stderr ??
        ""
      ) +
      (
        result.error
          ? (
              "\\n" +
              String(
                result.error.message,
              )
            )
          : ""
      ),
  };
}
`;

  source =
    source.slice(
      0,
      runStart
    ) +
    runFunction +
    source.slice(
      outputStart
    );

  source =
    source.replaceAll(
      `      NPX,
      [
        "tsx",
        "--env-file=.env.local",`,
      `      NODE,
      [
        TSX_CLI,
        "--env-file=.env.local",`
    );

  source =
    source.replaceAll(
      `        NPX,
        [
          "tsx",
          "--env-file=.env.local",`,
      `        NODE,
        [
          TSX_CLI,
          "--env-file=.env.local",`
    );

  source =
    source.replaceAll(
      `      NPM,
      [
        "run",
        "test:forward-oos-observability-dashboard",
      ],`,
      `      NODE,
      [
        TSX_CLI,
        "--env-file=.env.local",
        ".\\\\scripts\\\\forward-oos-observability-dashboard-v1-contract-test.ts",
      ],`
    );

  source =
    source.replaceAll(
      `        NPM,
        [
          "run",
          "test:forward-oos-observability-dashboard",
        ],`,
      `        NODE,
        [
          TSX_CLI,
          "--env-file=.env.local",
          ".\\\\scripts\\\\forward-oos-observability-dashboard-v1-contract-test.ts",
        ],`
    );
}
catch (error) {
  fail(
    "SOURCE_PATCH_FAILED",
    {
      error:
        String(
          error instanceof Error
            ? error.message
            : error
        )
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
  envOverlayType:
    source.includes(
      "type EnvOverlay ="
    ) &&
    source.includes(
      "extraEnv: EnvOverlay = {},"
    ),

  localTsxCli:
    source.includes(
      '"node_modules"'
    ) &&
    source.includes(
      '"tsx"'
    ) &&
    source.includes(
      '"dist"'
    ) &&
    source.includes(
      '"cli.mjs"'
    ),

  nodeExecutable:
    source.includes(
      "process.execPath"
    ),

  noNpxConstant:
    !source.includes(
      "const NPX ="
    ),

  noNpmConstant:
    !source.includes(
      "const NPM ="
    ),

  noCmdWrapper:
    !source.includes(
      "process.env.ComSpec"
    ),

  shellFalse:
    source.includes(
      "shell:\n          false"
    ),

  readinessViaLocalTsx:
    source.includes(
      '"FIRST_REAL_SESSION_READINESS"'
    ) &&
    source.includes(
      '".\\\\scripts\\\\true-forward-oos-first-real-session-readiness-v1.ts"'
    ),

  evidenceViaLocalTsx:
    source.includes(
      '".\\\\scripts\\\\true-forward-oos-controlled-producer-evidence-run-v1.ts"'
    ),

  dashboardViaLocalTsx:
    source.includes(
      '".\\\\scripts\\\\forward-oos-observability-dashboard-v1-contract-test.ts"'
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

  normalEvidenceRunOnce:
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
      "shell:\\n          false"
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
      'REAL_TRADING_ENABLED:\\n          "false"'
    ) &&
    source.includes(
      'ENABLE_REAL_TRADING:\\n          "false"'
    ) &&
    source.includes(
      'ENABLE_LIVE_TRADING:\\n          "false"'
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
        "AI_STOCK_LAB_FORWARD_OOS_FIRST_SESSION_ORCHESTRATOR_V3_REPAIRED",

      changedFile:
        "scripts/true-forward-oos-first-session-orchestrator-v1.ts",

      generatedFile:
        "scripts/true-forward-oos-first-session-orchestrator-v3-static-verify.cjs",

      backupFile:
        "scripts/backups/true-forward-oos-first-session-orchestrator-v1.before-node-tsx-spawn-v3.ts",

      repair: {
        childRuntime:
          "NODE_EXEC_PATH_PLUS_LOCAL_TSX_CLI",

        npxCmd:
          "REMOVED",

        npmCmd:
          "REMOVED",

        cmdExeWrapper:
          "REMOVED",

        shell:
          false,

        envOverlayType:
          "Record<string,string|undefined>",

        executeContract:
          "UNCHANGED"
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
        "RUN_STATIC_TYPECHECK_AND_DRY_RUN_ORCHESTRATOR_V3"
    },
    null,
    2
  )
);

process.exitCode = 0;
