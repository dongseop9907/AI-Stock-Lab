const fs = require("fs");
const path = require("path");

const root = process.cwd();

const target =
  path.resolve(
    root,
    "scripts/alpha-v3-committed-risk-db-apply-and-verify.cjs"
  );

const backup =
  path.resolve(
    root,
    "scripts/alpha-v3-committed-risk-db-apply-and-verify.cjs.before-windows-npx-fix-v2.bak"
  );

if (!fs.existsSync(target)) {
  throw new Error(
    "TARGET_SCRIPT_NOT_FOUND:scripts/alpha-v3-committed-risk-db-apply-and-verify.cjs"
  );
}

let text =
  fs.readFileSync(
    target,
    "utf8"
  );

if (!fs.existsSync(backup)) {
  fs.copyFileSync(
    target,
    backup
  );
}

const oldNpxDecl =
`const npxCmd =
  path.join(
    path.dirname(process.execPath),
    "npx.cmd"
  );`;

const newNpxDecl =
`const npxCli =
  path.resolve(
    path.dirname(process.execPath),
    "node_modules/npm/bin/npx-cli.js"
  );`;

if (text.includes(oldNpxDecl)) {
  text =
    text.replace(
      oldNpxDecl,
      newNpxDecl
    );
}

const runCmdAnchor =
`function tail(value, count = 35) {`;

if (!text.includes("function runNodeNpx(")) {
  if (!text.includes(runCmdAnchor)) {
    throw new Error(
      "PATCH_ANCHOR_NOT_FOUND:tail"
    );
  }

  const helper =
`function runNodeNpx(args, timeout = 240000) {
  if (!fs.existsSync(npxCli)) {
    throw new Error(
      \`NPX_CLI_JS_NOT_FOUND:\${npxCli}\`
    );
  }

  return spawnSync(
    process.execPath,
    [
      npxCli,
      ...args,
    ],
    {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      env: process.env,
      timeout,
      maxBuffer: 50 * 1024 * 1024,
    }
  );
}

`;

  text =
    text.replace(
      runCmdAnchor,
      helper + runCmdAnchor
    );
}

const oldAtomicCall =
`  const result =
    runCmd(
      npxCmd,
      [
        "tsx",
        "--env-file=.env.local",
        "./scripts/alpha-v3-committed-risk-atomic-integration-verify.ts",
      ],
      180000
    );`;

const newAtomicCall =
`  const result =
    runNodeNpx(
      [
        "tsx",
        "--env-file=.env.local",
        "./scripts/alpha-v3-committed-risk-atomic-integration-verify.ts",
      ],
      180000
    );`;

if (text.includes(oldAtomicCall)) {
  text =
    text.replace(
      oldAtomicCall,
      newAtomicCall
    );
}

if (/\bnpxCmd\b/.test(text)) {
  throw new Error(
    "WINDOWS_NPX_CMD_REFERENCE_STILL_PRESENT_AFTER_PATCH"
  );
}

if (!/\brunNodeNpx\s*\(/.test(text)) {
  throw new Error(
    "RUN_NODE_NPX_HELPER_NOT_INSTALLED"
  );
}

if (
  !text.includes(
    "node_modules/npm/bin/npx-cli.js"
  )
) {
  throw new Error(
    "NPX_CLI_JS_PATH_NOT_INSTALLED"
  );
}

fs.writeFileSync(
  target,
  text,
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status:
        "ALPHA_V3_COMMITTED_RISK_DB_APPLY_AND_VERIFY_V2_WINDOWS_FIX_INSTALLED",

      patchedFile:
        "scripts/alpha-v3-committed-risk-db-apply-and-verify.cjs",

      backupFile:
        "scripts/alpha-v3-committed-risk-db-apply-and-verify.cjs.before-windows-npx-fix-v2.bak",

      fix:
        "CALL_NODE_EXE_WITH_NPX_CLI_JS_DIRECTLY_INSTEAD_OF_NPX_CMD_THROUGH_CMD_EXE",

      databaseWrites:
        0,

      nextAction:
        "RERUN_DB_APPLY_AND_VERIFY"
    },
    null,
    2
  )
);
