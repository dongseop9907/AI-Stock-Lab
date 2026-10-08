const fs = require("fs");
const path = require("path");

const root = process.cwd();

const rel =
  "scripts/alpha-v3-kill-switch-db-rpc-definition-probe-v1.cjs";

const file =
  path.resolve(root, rel);

if (!fs.existsSync(file)) {
  throw new Error(
    "DB_RPC_DEFINITION_PROBE_NOT_FOUND"
  );
}

const before =
  fs.readFileSync(
    file,
    "utf8"
  );

let after = before;

/*
 * Remove the long console dump sections while preserving
 * the full JSON log written to logs/.
 */
after = after.replace(
  /console\.log\(\s*"\\n=== LIKELY CREATE LATEST DEFINITIONS ==="\s*\);[\s\S]*?for\s*\(const item of likelyFill\)\s*\{[\s\S]*?\n\}/m,
  `console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_KILL_SWITCH_DB_RPC_DEFINITION_PROBE_V1_SHORT_SUMMARY",

      likelyCreateFunctions:
        report.likelyCreateFunctions,

      likelyFillFunctions:
        report.likelyFillFunctions,

      logFile:
        report.logFile,

      nextGate:
        report.nextGate
    },
    null,
    2
  )
);`
);

fs.writeFileSync(
  file,
  after,
  "utf8"
);

const checks = {
  fileChanged:
    after !== before,

  fullLogStillWritten:
    after.includes(
      "alpha-v3-kill-switch-db-rpc-definition-probe-v1.json"
    ),

  longCreateDumpRemoved:
    !after.includes(
      "=== LIKELY CREATE LATEST DEFINITIONS ==="
    ),

  longFillDumpRemoved:
    !after.includes(
      "=== LIKELY FILL LATEST DEFINITIONS ==="
    ),

  shortSummaryPresent:
    after.includes(
      "ALPHA_V3_KILL_SWITCH_DB_RPC_DEFINITION_PROBE_V1_SHORT_SUMMARY"
    )
};

const failed =
  Object.entries(checks)
    .filter(([, value]) => !value)
    .map(([key]) => key);

console.log(
  JSON.stringify(
    {
      status:
        failed.length === 0
          ? "ALPHA_V3_KILL_SWITCH_DB_RPC_PROBE_SHORT_OUTPUT_V1_VERIFIED"
          : "ALPHA_V3_KILL_SWITCH_DB_RPC_PROBE_SHORT_OUTPUT_V1_REVIEW",

      patchedFile:
        rel,

      checks,
      failed,

      consolePolicy: {
        fullDetails:
          "logs/alpha-v3-kill-switch-db-rpc-definition-probe-v1.json",

        console:
          "SUMMARY_ONLY"
      },

      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        networkCalls: 0
      },

      nextAction:
        failed.length === 0
          ? "RERUN_DB_RPC_DEFINITION_PROBE"
          : "REVIEW_SHORT_OUTPUT_PATCH"
    },
    null,
    2
  )
);

if (failed.length > 0) {
  process.exitCode = 2;
}
