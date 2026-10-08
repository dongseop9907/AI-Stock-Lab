const fs = require("fs");
const path = require("path");
const { spawnSync } = require("node:child_process");

const root = process.cwd();

const targetRel =
  "scripts/install-alpha-v3-committed-risk-expiry-reconciliation-v1.cjs";

const target =
  path.resolve(root, targetRel);

const backup =
  path.resolve(
    root,
    "scripts/install-alpha-v3-committed-risk-expiry-reconciliation-v1.cjs.before-syntax-fix-v1-2.bak"
  );

if (!fs.existsSync(target)) {
  throw new Error(
    `TARGET_INSTALLER_NOT_FOUND:${targetRel}`
  );
}

if (!fs.existsSync(backup)) {
  fs.copyFileSync(target, backup);
}

const original =
  fs.readFileSync(target, "utf8");

const lines =
  original.split(/\r?\n/);

let replaced = 0;

const patchedLines =
  lines.map((line) => {
    if (
      line.includes("name.replace(") &&
      line.includes("\\\\$&") &&
      line.includes("/g")
    ) {
      replaced += 1;

      return '    name.replace(/[-/\\\\^$*+?.()|[\\]{}]/g, "\\\\$&");';
    }

    return line;
  });

if (replaced < 1) {
  throw new Error(
    "TARGET_REGEX_ESCAPE_LINE_NOT_FOUND"
  );
}

const patched =
  patchedLines.join("\n");

fs.writeFileSync(
  target,
  patched,
  "utf8"
);

const syntaxCheck =
  spawnSync(
    process.execPath,
    [
      "--check",
      target,
    ],
    {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
    }
  );

const syntaxOutput =
  `${syntaxCheck.stdout ?? ""}\n${syntaxCheck.stderr ?? ""}`.trim();

if (syntaxCheck.status !== 0) {
  console.log(
    JSON.stringify(
      {
        status:
          "ALPHA_V3_COMMITTED_RISK_EXPIRY_RECONCILIATION_V1_2_SYNTAX_FIX_REVIEW",

        replacedLines:
          replaced,

        syntaxCheckExitCode:
          syntaxCheck.status,

        syntaxOutput,

        databaseWrites:
          0,

        nextAction:
          "REVIEW_INSTALLER_SYNTAX"
      },
      null,
      2
    )
  );

  process.exitCode = 2;
  return;
}

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_COMMITTED_RISK_EXPIRY_RECONCILIATION_V1_2_SYNTAX_FIX_VERIFIED",

      patchedFile:
        targetRel,

      backupFile:
        "scripts/install-alpha-v3-committed-risk-expiry-reconciliation-v1.cjs.before-syntax-fix-v1-2.bak",

      replacedLines:
        replaced,

      syntaxCheckExitCode:
        syntaxCheck.status,

      databaseWrites:
        0,

      nextAction:
        "RERUN_EXPIRY_RECONCILIATION_INSTALLER"
    },
    null,
    2
  )
);
