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
  "true-forward-oos-first-session-orchestrator-v4-static-verify.cjs"
);

function fail(reason, extra = {}) {
  console.error(
    JSON.stringify(
      {
        status:
          "AI_STOCK_LAB_FORWARD_OOS_FIRST_SESSION_ORCHESTRATOR_V4_REPAIR_FAILED",
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
  "true-forward-oos-first-session-orchestrator-v1.before-path-import-v4.ts"
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

if (
  !source.includes(
    'import path from "node:path";'
  )
) {
  if (
    source.includes(
      'import { spawnSync } from "node:child_process";'
    )
  ) {
    source =
      source.replace(
        'import { spawnSync } from "node:child_process";',
        'import { spawnSync } from "node:child_process";\nimport path from "node:path";'
      );
  }
  else {
    source =
      'import path from "node:path";\n' +
      source;
  }
}

fs.writeFileSync(
  ORCH,
  source,
  "utf8"
);

const checks = {
  pathImportPresent:
    source.includes(
      'import path from "node:path";'
    ),

  pathJoinStillUsed:
    source.includes(
      "path.join("
    ),

  localTsxCliPreserved:
    source.includes(
      '"node_modules"'
    ) &&
    source.includes(
      '"tsx"'
    ) &&
    source.includes(
      '"cli.mjs"'
    ),

  processExecPathPreserved:
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

  noComSpec:
    !source.includes(
      "process.env.ComSpec"
    ),

  shellFalsePreserved:
    source.includes(
      "shell:\n          false"
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

  pathImportPresent:
    source.includes(
      'import path from "node:path";'
    ),

  pathJoinUsed:
    source.includes(
      "path.join("
    ),

  processExecPath:
    source.includes(
      "process.execPath"
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
          ? "AI_STOCK_LAB_FORWARD_OOS_FIRST_SESSION_ORCHESTRATOR_V4_STATIC_VERIFIED"
          : "AI_STOCK_LAB_FORWARD_OOS_FIRST_SESSION_ORCHESTRATOR_V4_STATIC_FAILED",

      checks,

      repaired: {
        missingImport:
          'import path from "node:path";',

        childRuntime:
          "process.execPath + local tsx/dist/cli.mjs",

        windowsShell:
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
          ? "RUN_ORCHESTRATOR_TSC_AND_DRY_RUN_V4"
          : "REPAIR_ORCHESTRATOR_V4"
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
        "AI_STOCK_LAB_FORWARD_OOS_FIRST_SESSION_ORCHESTRATOR_V4_REPAIRED",

      changedFile:
        "scripts/true-forward-oos-first-session-orchestrator-v1.ts",

      generatedFile:
        "scripts/true-forward-oos-first-session-orchestrator-v4-static-verify.cjs",

      backupFile:
        "scripts/backups/true-forward-oos-first-session-orchestrator-v1.before-path-import-v4.ts",

      repair: {
        missingPathImport:
          "ADDED",

        childRuntime:
          "NODE_EXEC_PATH_PLUS_LOCAL_TSX_CLI",

        shell:
          false,

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
        "RUN_STATIC_TYPECHECK_AND_DRY_RUN_ORCHESTRATOR_V4"
    },
    null,
    2
  )
);

process.exitCode = 0;
