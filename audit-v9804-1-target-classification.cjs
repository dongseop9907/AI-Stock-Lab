#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * V9.8.4.1 target-classification consistency audit
 *
 * READ-ONLY:
 * - no network
 * - no DB access
 * - no file writes
 *
 * Compares the top-level target metadata carried from the input queue
 * against V9.8.4.1's classification of the same receipt in
 * targetHistoryRow.
 */

const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();

const inputFile = path.join(
  root,
  'logs',
  'opendart-corporate-action-chain-resolution-v9-8-4-1.json',
);

function fail(message) {
  console.error(`[AUDIT ERROR] ${message}`);
  process.exit(1);
}

if (!fs.existsSync(inputFile)) {
  fail(`FILE_NOT_FOUND: ${inputFile}`);
}

const report = JSON.parse(
  fs.readFileSync(inputFile, 'utf8'),
);

const rows = Array.isArray(report.resolutions)
  ? report.resolutions
  : [];

if (!rows.length) {
  fail('RESOLUTIONS_MISSING');
}

const mismatches = [];

for (const row of rows) {
  const history =
    row.targetHistoryRow ?? null;

  if (!history) {
    mismatches.push({
      receiptNo: row.receiptNo ?? null,
      corpCode: row.corpCode ?? null,
      stockCode: row.stockCode ?? null,
      type: 'TARGET_HISTORY_ROW_MISSING',
      topLevel: {
        actionType: row.actionType ?? null,
        correction: row.correction ?? null,
        withdrawal: row.withdrawal ?? null,
        otherEntity: row.otherEntity ?? null,
      },
      history: null,
    });

    continue;
  }

  const differences = {};

  const fields = [
    'actionType',
    'correction',
    'withdrawal',
    'otherEntity',
  ];

  for (const field of fields) {
    const topValue =
      row[field] ?? null;

    const historyValue =
      history[field] ?? null;

    if (
      topValue !==
      historyValue
    ) {
      differences[field] = {
        topLevel:
          topValue,
        history:
          historyValue,
      };
    }
  }

  if (
    Object.keys(differences).length >
    0
  ) {
    mismatches.push({
      receiptNo:
        row.receiptNo ?? null,
      receiptDate:
        row.receiptDate ?? null,
      corpCode:
        row.corpCode ?? null,
      stockCode:
        row.stockCode ?? null,
      gate:
        row.gate ?? null,
      reportName:
        history.reportName ?? null,
      resolutionStatus:
        row.resolutionStatus ?? null,
      resolutionReason:
        row.resolutionReason ?? null,
      rootReceiptNo:
        row.rootReceiptNo ?? null,
      differences,
    });
  }
}

const mismatchFieldCounts = {};

for (const row of mismatches) {
  if (!row.differences) {
    mismatchFieldCounts.TARGET_HISTORY_ROW_MISSING =
      (mismatchFieldCounts.TARGET_HISTORY_ROW_MISSING ?? 0) + 1;
    continue;
  }

  for (const field of Object.keys(row.differences)) {
    mismatchFieldCounts[field] =
      (mismatchFieldCounts[field] ?? 0) + 1;
  }
}

console.log(
  JSON.stringify(
    {
      status:
        mismatches.length === 0
          ? 'CLASSIFICATION_CONSISTENT'
          : 'CLASSIFICATION_MISMATCH_FOUND',
      version:
        report.version ?? null,
      totalResolutions:
        rows.length,
      mismatchRows:
        mismatches.length,
      mismatchFieldCounts,
      mismatches,
    },
    null,
    2,
  ),
);
