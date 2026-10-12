#!/usr/bin/env node
'use strict';

/**
 * Extract blockers from:
 * logs/opendart-corporate-action-adjustment-persistence-preflight-v9-8-11-8-1-replay-virtual.json
 *
 * READ ONLY.
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

const inputFile = path.join(
  root,
  'logs',
  'opendart-corporate-action-adjustment-persistence-preflight-v9-8-11-8-1-replay-virtual.json',
);

const outputFile = path.join(
  root,
  'logs',
  'v9811-8-1-replay-blocker-detail.json',
);

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''),
  );
}

if (!fs.existsSync(inputFile)) {
  throw new Error(
    `INPUT_NOT_FOUND:${path.basename(inputFile)}`,
  );
}

const input = readJson(inputFile);

const report = {
  status:
    'V9_8_11_8_1_REPLAY_BLOCKER_DETAIL_EXTRACTED',

  sourceStatus:
    input.status,

  sourceVersion:
    input.version,

  persistenceState:
    input.persistenceState,

  counts: {
    missingStockUniverseRows:
      Array.isArray(input.missingStockUniverse)
        ? input.missingStockUniverse.length
        : 0,

    runMismatchRows:
      Array.isArray(input.runMismatches)
        ? input.runMismatches.length
        : 0,

    factorMismatchRows:
      Array.isArray(input.factorMismatches)
        ? input.factorMismatches.length
        : 0,

    blockers:
      Array.isArray(input.blockers)
        ? input.blockers.length
        : 0,
  },

  missingStockUniverse:
    input.missingStockUniverse ?? [],

  runMismatches:
    input.runMismatches ?? [],

  factorMismatches:
    input.factorMismatches ?? [],

  blockers:
    input.blockers ?? [],

  factorPipelineReadiness:
    input.factorPipelineReadiness ?? null,

  virtualWriteGuard:
    input.virtualWriteGuard ?? null,

  safety: {
    databaseReads: 0,
    databaseWrites: 0,
    productionApplied: false,
  },
};

fs.writeFileSync(
  outputFile,
  JSON.stringify(report, null, 2) + '\n',
  'utf8',
);

console.log(
  JSON.stringify(report, null, 2),
);
