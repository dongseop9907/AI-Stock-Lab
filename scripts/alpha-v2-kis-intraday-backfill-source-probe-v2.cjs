#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

const roots = [
  path.join(root, 'lib'),
  path.join(root, 'app'),
  path.join(root, 'scripts'),
];

function walk(dir, depth = 0) {
  if (!fs.existsSync(dir) || depth > 6) return [];

  const out = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.name === 'node_modules' ||
      entry.name === '.next' ||
      entry.name === '.git' ||
      entry.name === 'logs'
    ) {
      continue;
    }

    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      out.push(...walk(full, depth + 1));
    } else if (/\.(ts|tsx|js|cjs|mjs)$/i.test(entry.name)) {
      out.push(full);
    }
  }

  return out;
}

const files = roots
  .flatMap((dir) => walk(dir))
  .filter((file, index, arr) => arr.indexOf(file) === index)
  .filter((file) =>
    !file.endsWith('alpha-v2-kis-intraday-backfill-source-probe.cjs') &&
    !file.endsWith('alpha-v2-kis-intraday-backfill-source-probe-v2.cjs')
  );

const patterns = [
  /\/uapi\/domestic-stock\/v1\/quotations\//i,
  /oauth2\/tokenP/i,
  /appkey/i,
  /appsecret/i,
  /tr_id/i,
  /authorization/i,
  /get.*access.*token/i,
  /KIS_/i,
  /KOREA_INVESTMENT/i,
  /한국투자/i,
  /inquire-time/i,
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

  const matchedLines = [];

  for (let i = 0; i < lines.length; i += 1) {
    if (patterns.some((p) => p.test(lines[i]))) {
      matchedLines.push(i);
    }
  }

  if (!matchedLines.length) continue;

  const mergedRanges = [];
  for (const lineIndex of matchedLines) {
    const start = Math.max(0, lineIndex - 8);
    const end = Math.min(lines.length, lineIndex + 18);

    const last = mergedRanges.at(-1);
    if (last && start <= last.end + 2) {
      last.end = Math.max(last.end, end);
    } else {
      mergedRanges.push({ start, end });
    }
  }

  hits.push({
    file: path.relative(root, file).replace(/\\/g, '/'),
    ranges: mergedRanges.slice(0, 12).map((range) => ({
      startLine: range.start + 1,
      endLine: range.end,
      snippet: lines.slice(range.start, range.end).join('\n'),
    })),
  });
}

const syncPath = path.join(root, 'lib', 'market', 'sync-snapshots.ts');
let syncSnapshotsExcerpt = null;

if (fs.existsSync(syncPath)) {
  const source = fs.readFileSync(syncPath, 'utf8');
  const lines = source.split(/\r?\n/);

  syncSnapshotsExcerpt = {
    file: 'lib/market/sync-snapshots.ts',
    first220Lines: lines.slice(0, 220).join('\n'),
    upsertArea: lines.slice(380, 475).join('\n'),
  };
}

console.log(JSON.stringify({
  status: 'ALPHA_V2_KIS_INTRADAY_BACKFILL_SOURCE_PROBE_V2_COMPLETE',
  productionChanged: false,
  databaseWrites: 0,
  ordersCreated: 0,
  searchedFileCount: files.length,
  matchedFileCount: hits.length,
  hits: hits.slice(0, 30),
  syncSnapshotsExcerpt,
  nextGate: 'BUILD_KIS_INTRADAY_BACKFILL_FROM_EXISTING_CLIENT'
}, null, 2));
