#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const target = path.join(
  root,
  'lib',
  'trading',
  'generate-entry-signals.ts',
);

const source = fs.readFileSync(target, 'utf8');

const importLines = source
  .split(/\r?\n/)
  .filter((line) =>
    line.includes('getActiveEntryThreshold') ||
    line.includes('calculateEntrySignal') ||
    line.includes('SnapshotRecord') ||
    line.includes('PredictionCandidate')
  );

const startMarker = 'export function calculateEntrySignal';
const start = source.indexOf(startMarker);

if (start < 0) {
  console.error(JSON.stringify({
    status: 'ALPHA_V2_ENTRY_SOURCE_PROBE_FAILED',
    reason: 'CALCULATE_ENTRY_SIGNAL_NOT_FOUND',
    file: 'lib/trading/generate-entry-signals.ts',
  }, null, 2));
  process.exit(2);
}

const nextExport = source.indexOf(
  '\nexport ',
  start + startMarker.length,
);

const functionSource = source
  .slice(
    start,
    nextExport > start ? nextExport : source.length,
  )
  .trim();

console.log(JSON.stringify({
  status: 'ALPHA_V2_ENTRY_SOURCE_PROBE_COMPLETE',
  file: 'lib/trading/generate-entry-signals.ts',
  productionChanged: false,
  databaseWrites: 0,
  ordersCreated: 0,
}, null, 2));

console.log('\n----- RELEVANT IMPORTS -----\n');
console.log(importLines.join('\n'));

console.log('\n----- CALCULATE ENTRY SIGNAL -----\n');
console.log(functionSource);

console.log('\n----- END -----');
