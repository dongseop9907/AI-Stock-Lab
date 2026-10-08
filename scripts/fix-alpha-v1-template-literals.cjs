#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VERSION =
  'ALPHA_V1_TEMPLATE_LITERAL_ESCAPE_FIX';

function patchFile(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`FILE_NOT_FOUND:${file}`);
  }

  const before = fs.readFileSync(file, 'utf8');

  const badBackticks =
    (before.match(/\\`/g) ?? []).length;

  const badInterpolations =
    (before.match(/\\\$\{/g) ?? []).length;

  const after = before
    .replace(/\\`/g, '`')
    .replace(/\\\$\{/g, '${');

  fs.writeFileSync(
    file,
    after,
    'utf8',
  );

  return {
    file,
    badBackticksFixed: badBackticks,
    badInterpolationsFixed:
      badInterpolations,
    changed: before !== after,
  };
}

function main() {
  const root =
    path.resolve(__dirname, '..');

  const targets = [
    path.join(
      root,
      'lib',
      'alpha',
      'candidate-scoring.ts',
    ),
    path.join(
      root,
      'scripts',
      'alpha-v1-candidate-scoring-smoke.ts',
    ),
  ];

  const results =
    targets.map(patchFile);

  console.log(
    JSON.stringify(
      {
        status:
          'ALPHA_V1_TEMPLATE_LITERAL_ESCAPE_FIX_COMPLETE',

        version:
          VERSION,

        results,

        safety: {
          databaseReads: 0,
          databaseWrites: 0,
          networkRequests: 0,
          ordersCreated: 0,
        },

        nextAction:
          'RUN_ALPHA_V1_SMOKE_TEST',
      },
      null,
      2,
    ),
  );
}

try {
  main();
} catch (error) {
  console.error(
    JSON.stringify(
      {
        status:
          'ALPHA_V1_TEMPLATE_LITERAL_ESCAPE_FIX_FAILED',

        version:
          VERSION,

        error:
          String(
            error?.message ??
            error,
          ),

        safety: {
          databaseReads: 0,
          databaseWrites: 0,
          networkRequests: 0,
          ordersCreated: 0,
        },
      },
      null,
      2,
    ),
  );

  process.exitCode = 2;
}
