#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

const target = path.join(
  root,
  'scripts',
  'alpha-v2-entry-target-session-coverage.ts',
);

let source = fs.readFileSync(target, 'utf8');

const bad = `      targetSessionSnapshotCount,
      replayable:
        targetSnapshotCount > 0,`;

const good = `      targetSessionSnapshotCount:
        targetSnapshotCount,
      replayable:
        targetSnapshotCount > 0,`;

if (!source.includes(bad)) {
  console.error(JSON.stringify({
    status:
      'ALPHA_V2_ENTRY_TARGET_SESSION_COVERAGE_VAR_FIX_FAILED',
    reason:
      'EXPECTED_BAD_PATTERN_NOT_FOUND',
    file:
      'scripts/alpha-v2-entry-target-session-coverage.ts',
  }, null, 2));

  process.exit(2);
}

source = source.replace(bad, good);

fs.writeFileSync(
  target,
  source,
  'utf8',
);

console.log(JSON.stringify({
  status:
    'ALPHA_V2_ENTRY_TARGET_SESSION_COVERAGE_VAR_FIX_COMPLETE',
  changedFile:
    'scripts/alpha-v2-entry-target-session-coverage.ts',
  fix:
    'targetSessionSnapshotCount -> targetSnapshotCount mapping',
  productionChanged:
    false,
  thresholdsChanged:
    false,
  safety: {
    databaseWrites: 0,
    ordersCreated: 0
  },
  nextAction:
    'RERUN_ENTRY_TARGET_SESSION_COVERAGE'
}, null, 2));
