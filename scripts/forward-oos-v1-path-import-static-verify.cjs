const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const TARGET = path.join(
  ROOT,
  "scripts",
  "true-forward-oos-first-session-orchestrator-v1.ts"
);

const text =
  fs.existsSync(TARGET)
    ? fs.readFileSync(
        TARGET,
        "utf8"
      )
    : "";

const checks = {
  targetExists:
    fs.existsSync(TARGET),

  usesPath:
    /\bpath\./.test(text),

  importsPath:
    /import\s+path\s+from\s+["']node:path["'];?/.test(text) ||
    /import\s+\*\s+as\s+path\s+from\s+["']node:path["'];?/.test(text),

  realTradingEnableNotIntroduced:
    !text.includes(
      "REAL_TRADING_ENABLED=true"
    ) &&
    !text.includes(
      "ENABLE_REAL_TRADING=true"
    ) &&
    !text.includes(
      "ENABLE_LIVE_TRADING=true"
    ),
};

const failed =
  Object.entries(checks)
    .filter(([, ok]) => ok !== true)
    .map(([name]) => name);

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "AI_STOCK_LAB_FORWARD_OOS_V1_PATH_IMPORT_STATIC_PASS"
          : "AI_STOCK_LAB_FORWARD_OOS_V1_PATH_IMPORT_STATIC_FAIL",

      checks,

      safety: {
        readOnlyVerify:
          true,
        databaseWrites:
          0,
        producerExecuted:
          false,
        realTradingEnabled:
          false,
      },

      failed,
    },
    null,
    2
  )
);

process.exitCode =
  failed.length === 0
    ? 0
    : 1;
