#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * Compare V9.8.4 vs V9.8.4.1 chain-resolution outputs.
 *
 * READ-ONLY:
 * - no network
 * - no DB access
 * - no writes except console output
 */

const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();

const oldFile = path.join(
  root,
  'logs',
  'opendart-corporate-action-chain-resolution-v9-8-4.json',
);

const newFile = path.join(
  root,
  'logs',
  'opendart-corporate-action-chain-resolution-v9-8-4-1.json',
);

function fail(message) {
  console.error(`[COMPARE ERROR] ${message}`);
  process.exit(1);
}

for (const file of [oldFile, newFile]) {
  if (!fs.existsSync(file)) {
    fail(`FILE_NOT_FOUND: ${file}`);
  }
}

const oldReport = JSON.parse(
  fs.readFileSync(oldFile, 'utf8'),
);

const newReport = JSON.parse(
  fs.readFileSync(newFile, 'utf8'),
);

const oldRows = Array.isArray(oldReport.resolutions)
  ? oldReport.resolutions
  : [];

const newRows = Array.isArray(newReport.resolutions)
  ? newReport.resolutions
  : [];

if (oldRows.length === 0 || newRows.length === 0) {
  fail(
    `RESOLUTIONS_MISSING old=${oldRows.length} new=${newRows.length}`,
  );
}

function rowKey(row) {
  return String(
    row.workId ??
    row.receiptNo ??
    '',
  );
}

const oldMap = new Map(
  oldRows.map((row) => [rowKey(row), row]),
);

const newMap = new Map(
  newRows.map((row) => [rowKey(row), row]),
);

const allKeys = new Set([
  ...oldMap.keys(),
  ...newMap.keys(),
]);

function relevantShape(row) {
  if (!row) {
    return null;
  }

  return {
    receiptNo:
      row.receiptNo ?? null,
    receiptDate:
      row.receiptDate ?? null,
    corpCode:
      row.corpCode ?? null,
    stockCode:
      row.stockCode ?? null,
    actionType:
      row.actionType ?? null,
    gate:
      row.gate ?? null,
    correction:
      row.correction ?? null,
    withdrawal:
      row.withdrawal ?? null,
    resolutionStatus:
      row.resolutionStatus ?? null,
    resolutionReason:
      row.resolutionReason ?? null,
    rootReceiptNo:
      row.rootReceiptNo ?? null,
    confidence:
      row.confidence ?? null,
    distanceDays:
      row.distanceDays ?? null,
    plausibleRoots:
      row.plausibleRoots ?? [],
    structuredCandidateReceiptNos:
      row.structuredCandidateReceiptNos ?? [],
  };
}

const changed = [];

for (const key of allKeys) {
  const oldRow = oldMap.get(key);
  const newRow = newMap.get(key);

  const oldShape = relevantShape(oldRow);
  const newShape = relevantShape(newRow);

  if (
    JSON.stringify(oldShape) !==
    JSON.stringify(newShape)
  ) {
    changed.push({
      key,
      old: oldShape,
      new: newShape,
    });
  }
}

const summary = {
  status:
    changed.length > 0
      ? 'DIFF_FOUND'
      : 'NO_DIFF',
  oldVersion:
    oldReport.version ?? null,
  newVersion:
    newReport.version ?? null,
  oldCounts:
    oldReport.counts ?? null,
  newCounts:
    newReport.counts ?? null,
  changedRows:
    changed.length,
};

console.log(
  JSON.stringify(
    {
      ...summary,
      changes:
        changed,
    },
    null,
    2,
  ),
);
