#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

const sourceFile = path.join(
  root,
  'scripts',
  'alpha-v1-5-date-full-historical-replay-read-only.ts',
);

const targetFile = path.join(
  root,
  'scripts',
  'alpha-v1-full-window-historical-replay-read-only.ts',
);

let source = fs.readFileSync(sourceFile, 'utf8');

source = source
  .replace(
    'ALPHA_V1_5_DATE_FULL_HISTORICAL_REPLAY_READ_ONLY',
    'ALPHA_V1_FULL_WINDOW_HISTORICAL_REPLAY_READ_ONLY',
  )
  .replace(
    'const TARGET_DATE_COUNT =\n  5;',
    'const TARGET_DATE_COUNT =\n  44;',
  )
  .replace(
    'alpha-v1-5-date-full-historical-replay-read-only.json',
    'alpha-v1-full-window-historical-replay-read-only.json',
  )
  .replace(
    '"ALPHA_V1_5_DATE_FULL_HISTORICAL_REPLAY_READ_ONLY_COMPLETE"',
    '"ALPHA_V1_FULL_WINDOW_HISTORICAL_REPLAY_READ_ONLY_COMPLETE"',
  )
  .replace(
    '"ALPHA_V1_5_DATE_FULL_HISTORICAL_REPLAY_READ_ONLY_FAILED"',
    '"ALPHA_V1_FULL_WINDOW_HISTORICAL_REPLAY_READ_ONLY_FAILED"',
  );

fs.writeFileSync(
  targetFile,
  source,
  'utf8',
);

console.log(JSON.stringify({
  status: 'ALPHA_V1_FULL_WINDOW_HISTORICAL_REPLAY_INSTALLED',
  generatedFile: 'scripts/alpha-v1-full-window-historical-replay-read-only.ts',
  safety: {
    databaseWrites: 0,
    ordersCreated: 0,
    positionsChanged: 0
  },
  nextAction: 'RUN_FULL_WINDOW_HISTORICAL_REPLAY'
}, null, 2));
