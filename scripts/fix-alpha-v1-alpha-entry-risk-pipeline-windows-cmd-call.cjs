#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VERSION =
  'ALPHA_V1_ALPHA_ENTRY_RISK_PIPELINE_WINDOWS_CMD_CALL_FIX';

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

  const before =
    '`"${npxExecutable}" tsx "${ALPHA_SCRIPT}"`';

  const after =
    '`call "${npxExecutable}" tsx "${ALPHA_SCRIPT}"`';

  code =
    replaceOnce(
      code,
      before,
      after,
      'WINDOWS_CMD_CALL',
    );

  atomicWrite(
    TARGET,
    code,
  );

  console.log(
    JSON.stringify(
      {
        status:
          'ALPHA_V1_ALPHA_ENTRY_RISK_PIPELINE_WINDOWS_CMD_CALL_FIX_COMPLETE',

        version:
          VERSION,

        changedFile:
          'scripts/alpha-v1-alpha-entry-risk-read-only-pipeline.ts',

        fix: {
          previous:
            'cmd.exe /c "\\"C:\\\\Program Files\\\\nodejs\\\\npx.cmd\\" tsx ... "',

          current:
            'cmd.exe /c "call \\"C:\\\\Program Files\\\\nodejs\\\\npx.cmd\\" tsx ..."',

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
          'ALPHA_V1_ALPHA_ENTRY_RISK_PIPELINE_WINDOWS_CMD_CALL_FIX_FAILED',

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
