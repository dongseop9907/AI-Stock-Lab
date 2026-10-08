#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

const candidateFiles = [
  path.join(root, 'scripts', 'alpha-v1-alpha-only-historical-replay-read-only.ts'),
  path.join(root, 'lib', 'market', 'market-regime-v7.ts'),
  path.join(root, 'lib', 'market', 'historical-market-regime-v7.ts'),
  path.join(root, 'lib', 'market', 'regime-v7.ts'),
];

const patterns = [
  'calculateMarketRegimeFeatureVectorV7',
  'market_daily_bars',
  'indexBars',
  'stockBars',
  'KOSPI',
  'KOSDAQ',
  'market:',
  'stockCode',
  'activeStocks',
  'stock_master',
  'stocks',
];

const files = [];

for (const file of candidateFiles) {
  if (!fs.existsSync(file)) continue;

  const source = fs.readFileSync(file, 'utf8');
  const lines = source.split(/\r?\n/);

  const matches = [];

  for (let i = 0; i < lines.length; i += 1) {
    if (patterns.some((pattern) => lines[i].includes(pattern))) {
      const start = Math.max(0, i - 18);
      const end = Math.min(lines.length, i + 70);

      matches.push({
        line: i + 1,
        snippet: lines.slice(start, end).join('\n'),
      });
    }
  }

  files.push({
    file: path.relative(root, file).replace(/\\/g, '/'),
    matches: matches.slice(0, 30),
  });
}

console.log(JSON.stringify({
  status: 'ALPHA_V3_EXTENDED_HISTORY_REGIME_SOURCE_PROBE_COMPLETE',
  productionChanged: false,
  databaseWrites: 0,
  ordersCreated: 0,
  files,
  nextGate: 'BUILD_EXTENDED_PRICEVOLUME_TOP1_HISTORY'
}, null, 2));
