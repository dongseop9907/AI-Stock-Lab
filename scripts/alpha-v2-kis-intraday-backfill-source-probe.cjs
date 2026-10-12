#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function walk(dir, depth = 0) {
  if (depth > 5 || !fs.existsSync(dir)) return [];

  const out = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (
      entry.name === 'node_modules' ||
      entry.name === '.next' ||
      entry.name === '.git' ||
      entry.name === 'logs'
    ) {
      continue;
    }

    if (entry.isDirectory()) {
      out.push(...walk(full, depth + 1));
    } else if (
      /\.(ts|tsx|js|cjs|mjs|sql)$/i.test(entry.name)
    ) {
      out.push(full);
    }
  }

  return out;
}

const files = [
  ...walk(path.join(root, 'lib')),
  ...walk(path.join(root, 'app')),
  ...walk(path.join(root, 'scripts')),
  ...walk(path.join(root, 'supabase')),
].filter((file, index, arr) => arr.indexOf(file) === index);

const patterns = [
  /inquire-time-dailychartprice/i,
  /FHKST03010230/i,
  /FHKST03010200/i,
  /market_snapshots/i,
  /observed_at/i,
  /access[_-]?token/i,
  /KIS/i,
  /korea.?investment/i,
];

const hits = [];

for (const file of files) {
  let source;

  try {
    source = fs.readFileSync(file, 'utf8');
  } catch {
    continue;
  }

  const lines = source.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    if (patterns.some((pattern) => pattern.test(lines[i]))) {
      const start = Math.max(0, i - 4);
      const end = Math.min(lines.length, i + 10);

      hits.push({
        file: path.relative(root, file).replace(/\\/g, '/'),
        line: i + 1,
        snippet: lines.slice(start, end).join('\n'),
      });
    }
  }
}

const prioritized = hits
  .sort((a, b) => {
    const score = (x) => {
      let s = 0;
      if (/FHKST03010230|inquire-time-dailychartprice/i.test(x.snippet)) s += 100;
      if (/market_snapshots/i.test(x.snippet)) s += 50;
      if (/access[_-]?token|oauth|tokenP/i.test(x.snippet)) s += 20;
      if (/lib\//i.test(x.file)) s += 10;
      return s;
    };

    return score(b) - score(a);
  })
  .slice(0, 40);

console.log(JSON.stringify({
  status: 'ALPHA_V2_KIS_INTRADAY_BACKFILL_SOURCE_PROBE_COMPLETE',
  productionChanged: false,
  databaseWrites: 0,
  ordersCreated: 0,
  searchedFileCount: files.length,
  hitCount: hits.length,
  hits: prioritized,
  nextGate: 'BUILD_KIS_HISTORICAL_INTRADAY_BACKFILL'
}, null, 2));
