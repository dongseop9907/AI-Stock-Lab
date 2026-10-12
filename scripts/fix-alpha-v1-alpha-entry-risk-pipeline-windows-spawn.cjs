#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VERSION =
  'ALPHA_V1_ALPHA_ENTRY_RISK_PIPELINE_WINDOWS_SPAWN_FIX';

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
    text.split(before).length -
    1;

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

  const before = `  const child =
    spawnSync(
      npxExecutable,
      [
        "tsx",
        ALPHA_SCRIPT,
      ],
      {
        cwd:
          process.cwd(),

        env:
          process.env,

        encoding:
          "utf8",

        stdio: [
          "ignore",
          "pipe",
          "pipe",
        ],
      },
    );

  if (
    child.status !==
    0
  ) {
    throw new Error(
      [
        "FRESH_ALPHA_RUN_FAILED",
        \`exit=\${child.status}\`,
        \`stdout=\${String(child.stdout ?? "").slice(-2000)}\`,
        \`stderr=\${String(child.stderr ?? "").slice(-2000)}\`,
      ].join("|"),
    );
  }`;

  const after = `  const child =
    process.platform ===
    "win32"
      ? spawnSync(
          process.env.ComSpec ??
            "C:\\\\Windows\\\\System32\\\\cmd.exe",
          [
            "/d",
            "/s",
            "/c",
            \`"\${npxExecutable}" tsx "\${ALPHA_SCRIPT}"\`,
          ],
          {
            cwd:
              process.cwd(),

            env:
              process.env,

            encoding:
              "utf8",

            stdio: [
              "ignore",
              "pipe",
              "pipe",
            ],
          },
        )
      : spawnSync(
          npxExecutable,
          [
            "tsx",
            ALPHA_SCRIPT,
          ],
          {
            cwd:
              process.cwd(),

            env:
              process.env,

            encoding:
              "utf8",

            stdio: [
              "ignore",
              "pipe",
              "pipe",
            ],
          },
        );

  if (
    child.error
  ) {
    throw new Error(
      [
        "FRESH_ALPHA_SPAWN_FAILED",
        \`name=\${child.error.name}\`,
        \`message=\${child.error.message}\`,
        \`code=\${(child.error as NodeJS.ErrnoException).code ?? "UNKNOWN"}\`,
      ].join("|"),
    );
  }

  if (
    child.status !==
    0
  ) {
    throw new Error(
      [
        "FRESH_ALPHA_RUN_FAILED",
        \`exit=\${child.status}\`,
        \`signal=\${child.signal ?? "NONE"}\`,
        \`stdout=\${String(child.stdout ?? "").slice(-2000)}\`,
        \`stderr=\${String(child.stderr ?? "").slice(-2000)}\`,
      ].join("|"),
    );
  }`;

  code =
    replaceOnce(
      code,
      before,
      after,
      'WINDOWS_SPAWN_BLOCK',
    );

  atomicWrite(
    TARGET,
    code,
  );

  console.log(
    JSON.stringify(
      {
        status:
          'ALPHA_V1_ALPHA_ENTRY_RISK_PIPELINE_WINDOWS_SPAWN_FIX_COMPLETE',

        version:
          VERSION,

        changedFile:
          'scripts/alpha-v1-alpha-entry-risk-read-only-pipeline.ts',

        fix: {
          windows:
            'RUN_NPX_CMD_THROUGH_COMSPEC_CMD_EXE',

          nonWindows:
            'UNCHANGED_DIRECT_NPX_SPAWN',

          spawnErrorDiagnostics:
            'ADDED_CHILD_ERROR_NAME_MESSAGE_CODE',

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
          'ALPHA_V1_ALPHA_ENTRY_RISK_PIPELINE_WINDOWS_SPAWN_FIX_FAILED',

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

  process.exitCode =
    2;
}
