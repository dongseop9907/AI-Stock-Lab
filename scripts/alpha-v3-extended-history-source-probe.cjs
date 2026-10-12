#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

const targets = [
  path.join(root, 'lib', 'alpha', 'daily-market-adapters.ts'),
  path.join(root, 'lib', 'alpha', 'scorer.ts'),
  path.join(root, 'lib', 'alpha', 'index.ts'),
];

const patterns = [
  'buildDailyPriceVolumeEvidence',
  'PriceVolume',
  'priceVolume',
  'scoreAlpha',
  'rank',
  'quality',
  'coverage',
];

const output = [];

for (const file of targets) {
  if (!fs.existsSync(file)) continue;

  const source = fs.readFileSync(file, 'utf8');
  const lines = source.split(/\r?\n/);

  const matches = [];

  for (let i = 0; i < lines.length; i += 1) {
    if (patterns.some((pattern) => lines[i].includes(pattern))) {
      const start = Math.max(0, i - 12);
      const end = Math.min(lines.length, i + 45);

      matches.push({
        line: i + 1,
        snippet: lines.slice(start, end).join('\n'),
      });
    }
  }

  output.push({
    file: path.relative(root, file).replace(/\\/g, '/'),
    matches: matches.slice(0, 20),
  });
}

console.log(JSON.stringify({
  status: 'ALPHA_V3_EXTENDED_HISTORY_SOURCE_PROBE_COMPLETE',
  productionChanged: false,
  databaseWrites: 0,
  ordersCreated: 0,
  files: output,
  nextGate: 'BUILD_EXTENDED_PRICEVOLUME_TOP1_HISTORY'
}, null, 2));
