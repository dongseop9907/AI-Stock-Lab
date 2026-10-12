#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VERSION =
  'ALPHA_V1_ALPHA_ENTRY_RISK_PIPELINE_WINDOWS_NPX_CLI_FIX';

const TARGET =
  path.resolve(
    __dirname,
    '..',
    'scripts',
    'alpha-v1-alpha-entry-risk-read-only-pipeline.ts',
  );

function replaceOnce(
  text,
  before,
  after,
  label,
) {
  const count =
    text.split(before).length - 1;

  if (count !== 1) {
    throw new Error(
      `${label}_EXPECTED_ONCE_GOT_${count}`,
    );
  }

  return text.replace(
    before,
    after,
  );
}

function atomicWrite(
  file,
  content,
) {
  const temp =
    `${file}.tmp-${process.pid}-${Date.now()}`;

  fs.writeFileSync(
    temp,
    content,
    'utf8',
  );

  fs.renameSync(
    temp,
    file,
  );
}

try {
  let code =
    fs.readFileSync(
      TARGET,
      'utf8',
    );

  const beforeHeader = `  const npxExecutable =
    process.platform ===
    "win32"
      ? path.join(
          nodeDir,
          "npx.cmd",
        )
      : "npx";

  const child =
    process.platform ===
    "win32"
      ? spawnSync(
          process.env.ComSpec ??
            "C:\\\\Windows\\\\System32\\\\cmd.exe",
          [
            "/d",
            "/s",
            "/c",
            \`call "\${npxExecutable}" tsx "\${ALPHA_SCRIPT}"\`,
          ],`;

  const afterHeader = `  const npxExecutable =
    process.platform ===
    "win32"
      ? path.join(
          nodeDir,
          "npx.cmd",
        )
      : "npx";

  const npxCliJs =
    path.join(
      nodeDir,
      "node_modules",
      "npm",
      "bin",
      "npx-cli.js",
    );

  const child =
    process.platform ===
    "win32"
      ? spawnSync(
          process.execPath,
          [
            npxCliJs,
            "tsx",
            ALPHA_SCRIPT,
          ],`;

  code =
    replaceOnce(
      code,
      beforeHeader,
      afterHeader,
      'WINDOWS_NPX_CLI_HEADER',
    );

  /*
   * Improve diagnostics so a missing npx-cli.js is explicit.
   */
  const beforeDiagnostic = `  if (
    child.error
  ) {
    throw new Error(
      [
        "FRESH_ALPHA_SPAWN_FAILED",`;

  const afterDiagnostic = `  if (
    process.platform ===
      "win32" &&
    !fs.existsSync(
      npxCliJs,
    )
  ) {
    throw new Error(
      \`WINDOWS_NPX_CLI_NOT_FOUND:\${npxCliJs}\`,
    );
  }

  if (
    child.error
  ) {
    throw new Error(
      [
        "FRESH_ALPHA_SPAWN_FAILED",`;

  code =
    replaceOnce(
      code,
      beforeDiagnostic,
      afterDiagnostic,
      'WINDOWS_NPX_CLI_DIAGNOSTIC',
    );

  atomicWrite(
    TARGET,
    code,
  );

  console.log(
    JSON.stringify(
      {
        status:
          'ALPHA_V1_ALPHA_ENTRY_RISK_PIPELINE_WINDOWS_NPX_CLI_FIX_COMPLETE',

        version:
          VERSION,

        changedFile:
          'scripts/alpha-v1-alpha-entry-risk-read-only-pipeline.ts',

        fix: {
          removedWindowsCmdExeDependency:
            true,

          removedCmdQuotingDependency:
            true,

          windowsExecution:
            'node.exe node_modules/npm/bin/npx-cli.js tsx <alpha-script>',

          inheritedEnvFileValues:
            true,

          alphaFormulaChanged:
            false,

          entryFormulaChanged:
            false,

          riskFormulaChanged:
            false,
        },

        safety: {
          databaseWrites:
            0,

          entrySignalWrites:
            0,

          riskDecisionWrites:
            0,

          orderWrites:
            0,

          ordersCreated:
            0,

          positionsChanged:
            0,
        },

        nextAction:
          'RERUN_ALPHA_ENTRY_RISK_READ_ONLY_PIPELINE',
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    JSON.stringify(
      {
        status:
          'ALPHA_V1_ALPHA_ENTRY_RISK_PIPELINE_WINDOWS_NPX_CLI_FIX_FAILED',

        version:
          VERSION,

        error:
          String(
            error?.message ??
            error,
          ),

        databaseWrites:
          0,

        ordersCreated:
          0,
      },
      null,
      2,
    ),
  );

  process.exitCode = 2;
}
