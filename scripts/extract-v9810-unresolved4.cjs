#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

const inputFile = path.join(
  root,
  'logs',
  'opendart-corporate-action-structural-date-probe-v9-8-10-2-1-replay.json',
);

const outputFile = path.join(
  root,
  'logs',
  'v9810-structural-unresolved-4-detail.json',
);

const ids = new Set([
  '20260821000052',
  '20260803000182',
  '20260901000318',
  '20260918000373',
]);

const raw = fs
  .readFileSync(inputFile, 'utf8')
  .replace(/^\uFEFF/, '');

const data = JSON.parse(raw);

const rows = (data.rows ?? [])
  .filter((row) => ids.has(String(row.providerEventId)))
  .map((row) => ({
    providerEventId: row.providerEventId,
    sourceReceiptNo: row.sourceReceiptNo,
    stockCode: row.stockCode,
    actionType: row.actionType,
    previousPrimaryDateCandidate:
      row.previousPrimaryDateCandidate ?? null,
    previousChronologyWarnings:
      row.previousChronologyWarnings ?? [],
    strongestCandidate:
      row.strongestCandidate ?? null,
    candidateBasis:
      row.candidateBasis ?? null,
    structured: {
      exactSourceRows:
        row.structuredProbe?.exactSourceRows ?? 0,
      exactRootRows:
        row.structuredProbe?.exactRootRows ?? 0,
      sourcePrimaryDateConsensus:
        row.structuredProbe?.sourcePrimaryDateConsensus ?? null,
      rootPrimaryDateConsensus:
        row.structuredProbe?.rootPrimaryDateConsensus ?? null,
      allPrimaryDateConsensus:
        row.structuredProbe?.allPrimaryDateConsensus ?? null,
      allPrimaryDateFields:
        row.structuredProbe?.allPrimaryDateFields ?? [],
      allRowsCompact:
        row.structuredProbe?.allRowsCompact ?? [],
    },
    document: {
      available:
        row.documentProbe?.available ?? false,
      primaryDateDistinctDates:
        row.documentProbe?.primaryDateDistinctDates ?? [],
      registrationDistinctDates:
        row.documentProbe?.registrationDistinctDates ?? [],
      listingDistinctDates:
        row.documentProbe?.listingDistinctDates ?? [],
      primaryDateOccurrences:
        row.documentProbe?.primaryDateOccurrences ?? [],
    },
  }));

if (rows.length !== 4) {
  throw new Error(`EXPECTED_4_ROWS_GOT_${rows.length}`);
}

const report = {
  status: 'V9_8_10_STRUCTURAL_UNRESOLVED_4_DETAIL_EXTRACTED',
  sourceVersion: data.version,
  sourceStatus: data.status,
  sourceOutputFingerprint: data.outputFingerprint ?? null,
  rows,
};

fs.writeFileSync(
  outputFile,
  JSON.stringify(report, null, 2) + '\n',
  'utf8',
);

console.log(JSON.stringify({
  status: report.status,
  rows: rows.length,
  outputFile:
    'logs/v9810-structural-unresolved-4-detail.json',
}, null, 2));
