#!/usr/bin/env node
'use strict';

/**
 * Compare current V9.8.4.2 ambiguous receipts against legacy V9.8.5 output.
 *
 * READ-ONLY:
 * - no network
 * - no DB
 * - no writes
 *
 * Inputs:
 *   logs/opendart-corporate-action-chain-resolution-v9-8-4-2.json
 *   logs/opendart-corporate-action-canonical-source-selection-v9-8-5.json
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

const currentFile = path.join(
  root,
  'logs',
  'opendart-corporate-action-chain-resolution-v9-8-4-2.json',
);

const legacyFile = path.join(
  root,
  'logs',
  'opendart-corporate-action-canonical-source-selection-v9-8-5.json',
);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function findReceiptReferences(value, receiptNo, currentPath = '$', out = [], seen = new Set()) {
  if (value == null) return out;

  if (typeof value !== 'object') {
    if (String(value) === receiptNo) {
      out.push({
        path: currentPath,
        matchType: 'SCALAR',
        context: value,
      });
    }
    return out;
  }

  if (seen.has(value)) return out;
  seen.add(value);

  if (!Array.isArray(value)) {
    const directFields = [
      'receiptNo',
      'targetReceiptNo',
      'rootReceiptNo',
      'sourceReceiptNo',
      'providerEventId',
    ];

    const matchedFields = directFields.filter(
      (key) => value[key] != null && String(value[key]) === receiptNo,
    );

    if (matchedFields.length > 0) {
      out.push({
        path: currentPath,
        matchType: 'OBJECT',
        matchedFields,
        context: {
          receiptNo: value.receiptNo ?? null,
          targetReceiptNo: value.targetReceiptNo ?? null,
          rootReceiptNo: value.rootReceiptNo ?? null,
          sourceReceiptNo: value.sourceReceiptNo ?? null,
          providerEventId: value.providerEventId ?? null,
          resolutionStatus: value.resolutionStatus ?? null,
          resolutionReason: value.resolutionReason ?? null,
          confidence: value.confidence ?? null,
          actionType: value.actionType ?? null,
          stockCode: value.stockCode ?? null,
          corpCode: value.corpCode ?? null,
          reportName: value.reportName ?? null,
          gate: value.gate ?? null,
          sourceStage: value.sourceStage ?? null,
          reason: value.reason ?? null,
        },
      });
    }
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      findReceiptReferences(
        item,
        receiptNo,
        `${currentPath}[${index}]`,
        out,
        seen,
      );
    });
  } else {
    for (const [key, child] of Object.entries(value)) {
      findReceiptReferences(
        child,
        receiptNo,
        `${currentPath}.${key}`,
        out,
        seen,
      );
    }
  }

  return out;
}

const current = readJson(currentFile);
const legacy = readJson(legacyFile);

const ambiguous = (current.resolutions ?? []).filter(
  (row) => row.resolutionStatus === 'AMBIGUOUS',
);

const rows = ambiguous.map((target) => {
  const refs = findReceiptReferences(
    legacy,
    String(target.receiptNo),
  );

  const activeChainRefs = refs.filter(
    (ref) => ref.path.startsWith('$.activeChains'),
  );

  const quarantineRefs = refs.filter(
    (ref) =>
      /quarant/i.test(ref.path) ||
      /unresolved/i.test(ref.path) ||
      /ambiguous/i.test(ref.path),
  );

  const otherEntityRefs = refs.filter(
    (ref) => /otherEntity/i.test(ref.path),
  );

  return {
    receiptNo: target.receiptNo,
    receiptDate: target.receiptDate,
    stockCode: target.stockCode,
    corpCode: target.corpCode,
    actionType: target.actionType,
    gate: target.gate,
    currentPlausibleRoots: target.plausibleRoots ?? [],
    legacyReferenceCount: refs.length,
    legacyClassification:
      activeChainRefs.length > 0
        ? 'ACTIVE_CHAIN_REFERENCE'
        : quarantineRefs.length > 0
          ? 'QUARANTINE_OR_UNRESOLVED_REFERENCE'
          : otherEntityRefs.length > 0
            ? 'OTHER_ENTITY_REFERENCE'
            : refs.length > 0
              ? 'OTHER_REFERENCE'
              : 'NOT_FOUND',
    references: refs,
  };
});

const counts = rows.reduce((acc, row) => {
  acc[row.legacyClassification] =
    (acc[row.legacyClassification] ?? 0) + 1;
  return acc;
}, {});

console.log(JSON.stringify({
  status: 'LEGACY_V985_CURRENT_AMBIGUITY_CROSSCHECK_COMPLETE',
  currentVersion: current.version ?? null,
  legacyVersion: legacy.version ?? null,
  legacyFinalPrecisionVersion:
    legacy.source?.finalPrecisionVersion ?? null,
  currentAmbiguousRows: rows.length,
  legacyCounts: legacy.counts ?? null,
  classificationCounts: counts,
  rows,
}, null, 2));
