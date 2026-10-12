#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * V9.8.4.2 remaining ambiguity diagnostic
 *
 * READ-ONLY:
 * - no network
 * - no DB
 * - no writes
 *
 * Reads:
 *   logs/opendart-corporate-action-chain-resolution-v9-8-4-2.json
 *
 * Prints:
 * - remaining AMBIGUOUS rows
 * - grouped by corp/actionType/chainKey
 * - candidate root history rows
 * - structured candidate receipt numbers
 */

const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();

const inputFile = path.join(
  root,
  'logs',
  'opendart-corporate-action-chain-resolution-v9-8-4-2.json',
);

function fail(message) {
  console.error(`[AMBIGUITY DIAG ERROR] ${message}`);
  process.exit(1);
}

if (!fs.existsSync(inputFile)) {
  fail(`FILE_NOT_FOUND: ${inputFile}`);
}

const report = JSON.parse(
  fs.readFileSync(inputFile, 'utf8'),
);

const resolutions = Array.isArray(report.resolutions)
  ? report.resolutions
  : [];

const ambiguous = resolutions.filter(
  (row) =>
    row.resolutionStatus === 'AMBIGUOUS',
);

function historyMap(row) {
  return new Map(
    (Array.isArray(row.relevantHistory)
      ? row.relevantHistory
      : [])
      .filter((x) => x?.receiptNo)
      .map((x) => [
        String(x.receiptNo),
        x,
      ]),
  );
}

function slimHistory(row) {
  if (!row) {
    return null;
  }

  return {
    receiptNo: row.receiptNo ?? null,
    receiptDate: row.receiptDate ?? null,
    corpName: row.corpName ?? null,
    stockCode: row.stockCode ?? null,
    filerName: row.filerName ?? null,
    reportName: row.reportName ?? null,
    actionType: row.actionType ?? null,
    correction: row.correction ?? null,
    withdrawal: row.withdrawal ?? null,
    otherEntity: row.otherEntity ?? null,
    chainKey: row.chainKey ?? null,
    strictDecision: row.strictDecision ?? null,
    remark: row.remark ?? null,
  };
}

const grouped = new Map();

for (const row of ambiguous) {
  const hm = historyMap(row);

  const candidateRows = (
    Array.isArray(row.plausibleRoots)
      ? row.plausibleRoots
      : []
  ).map(
    (receiptNo) => ({
      receiptNo,
      history:
        slimHistory(
          hm.get(
            String(receiptNo),
          ),
        ),
    }),
  );

  const targetHistory =
    slimHistory(
      row.targetHistoryRow,
    );

  const groupKey = [
    row.corpCode ?? '',
    row.stockCode ?? '',
    row.actionType ?? '',
    targetHistory?.chainKey ?? '',
  ].join('|');

  if (!grouped.has(groupKey)) {
    grouped.set(groupKey, {
      groupKey,
      corpCode:
        row.corpCode ?? null,
      stockCode:
        row.stockCode ?? null,
      actionType:
        row.actionType ?? null,
      chainKey:
        targetHistory?.chainKey ?? null,
      targets: [],
    });
  }

  grouped.get(groupKey).targets.push({
    receiptNo:
      row.receiptNo ?? null,
    receiptDate:
      row.receiptDate ?? null,
    gate:
      row.gate ?? null,
    reportName:
      targetHistory?.reportName ?? null,
    correction:
      row.correction ?? null,
    withdrawal:
      row.withdrawal ?? null,
    otherEntity:
      row.otherEntity ?? null,
    resolutionReason:
      row.resolutionReason ?? null,
    confidence:
      row.confidence ?? null,
    plausibleRoots:
      row.plausibleRoots ?? [],
    candidateRows,
    structuredCandidateReceiptNos:
      row.structuredCandidateReceiptNos ?? [],
  });
}

const groups = [
  ...grouped.values(),
];

console.log(
  JSON.stringify(
    {
      status:
        'AMBIGUITY_DIAGNOSTIC_COMPLETE',
      version:
        report.version ?? null,
      ambiguousRows:
        ambiguous.length,
      ambiguityGroups:
        groups.length,
      groups,
    },
    null,
    2,
  ),
);
