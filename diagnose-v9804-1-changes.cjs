#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * Diagnose why V9.8.4 -> V9.8.4.1 changed specific chain resolutions.
 *
 * READ-ONLY:
 * - no network
 * - no DB access
 * - no file writes
 *
 * Compares:
 *   logs/opendart-corporate-action-chain-resolution-v9-8-4.json
 *   logs/opendart-corporate-action-chain-resolution-v9-8-4-1.json
 *
 * For changed resolution rows, prints:
 * - old/new resolution summary
 * - targetHistoryRow old/new classification
 * - relevantHistory rows whose classification/presence changed
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
  console.error(`[DIAGNOSE ERROR] ${message}`);
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

const oldRows =
  Array.isArray(oldReport.resolutions)
    ? oldReport.resolutions
    : [];

const newRows =
  Array.isArray(newReport.resolutions)
    ? newReport.resolutions
    : [];

if (!oldRows.length || !newRows.length) {
  fail(
    `RESOLUTIONS_MISSING old=${oldRows.length} new=${newRows.length}`,
  );
}

function keyOf(row) {
  return String(
    row.workId ??
    row.receiptNo ??
    '',
  );
}

const oldMap = new Map(
  oldRows.map(
    (row) => [
      keyOf(row),
      row,
    ],
  ),
);

const newMap = new Map(
  newRows.map(
    (row) => [
      keyOf(row),
      row,
    ],
  ),
);

function resolutionShape(row) {
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
    topLevelCorrection:
      row.correction ?? null,
    topLevelWithdrawal:
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

function historyShape(row) {
  if (!row) {
    return null;
  }

  return {
    receiptNo:
      row.receiptNo ?? null,
    receiptDate:
      row.receiptDate ?? null,
    reportName:
      row.reportName ?? null,
    remark:
      row.remark ?? null,
    actionType:
      row.actionType ?? null,
    correction:
      row.correction ?? null,
    withdrawal:
      row.withdrawal ?? null,
    otherEntity:
      row.otherEntity ?? null,
    chainKey:
      row.chainKey ?? null,
    strictDecision:
      row.strictDecision ?? null,
  };
}

function historyMap(rows) {
  return new Map(
    (Array.isArray(rows) ? rows : [])
      .filter(
        (row) =>
          row &&
          row.receiptNo,
      )
      .map(
        (row) => [
          String(row.receiptNo),
          row,
        ],
      ),
  );
}

function changedResolution(oldRow, newRow) {
  return (
    JSON.stringify(
      resolutionShape(oldRow),
    ) !==
    JSON.stringify(
      resolutionShape(newRow),
    )
  );
}

const changed = [];

for (const [key, newRow] of newMap.entries()) {
  const oldRow =
    oldMap.get(key);

  if (
    oldRow &&
    changedResolution(
      oldRow,
      newRow,
    )
  ) {
    changed.push({
      key,
      oldRow,
      newRow,
    });
  }
}

const diagnostics =
  changed.map(
    ({
      key,
      oldRow,
      newRow,
    }) => {
      const oldHist =
        historyMap(
          oldRow.relevantHistory,
        );

      const newHist =
        historyMap(
          newRow.relevantHistory,
        );

      const receiptNos =
        new Set([
          ...oldHist.keys(),
          ...newHist.keys(),
        ]);

      const historyChanges = [];

      for (const receiptNo of receiptNos) {
        const oldHistoryRow =
          oldHist.get(receiptNo) ??
          null;

        const newHistoryRow =
          newHist.get(receiptNo) ??
          null;

        const oldShape =
          historyShape(
            oldHistoryRow,
          );

        const newShape =
          historyShape(
            newHistoryRow,
          );

        if (
          JSON.stringify(oldShape) !==
          JSON.stringify(newShape)
        ) {
          historyChanges.push({
            receiptNo,
            old:
              oldShape,
            new:
              newShape,
          });
        }
      }

      return {
        key,

        resolution: {
          old:
            resolutionShape(
              oldRow,
            ),
          new:
            resolutionShape(
              newRow,
            ),
        },

        targetHistoryRow: {
          old:
            historyShape(
              oldRow.targetHistoryRow,
            ),
          new:
            historyShape(
              newRow.targetHistoryRow,
            ),
        },

        historyChanges,
      };
    },
  );

console.log(
  JSON.stringify(
    {
      status:
        'DIAGNOSTIC_COMPLETE',
      changedRows:
        diagnostics.length,
      diagnostics,
    },
    null,
    2,
  ),
);
