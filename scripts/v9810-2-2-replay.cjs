#!/usr/bin/env node
'use strict';

/**
 * V9.8.10.2.2 replay
 * Structural-date evidence reconciliation for the 4 rows left unresolved by
 * V9.8.10.2.1.
 *
 * This does NOT rewrite the probe artifact and does NOT persist anything.
 *
 * Resolution policy:
 * - 090370: local corrected DART XML explicitly contains revised merger date
 *           2026-11-01; external DART mirror also states 10/07 -> 11/01.
 * - 482520: local DART XML primary-label occurrence begins with 2027-03-04,
 *           matching the prior extracted primaryDateCandidate.
 * - 035720: local exact structured receipt/root missing; exact-receipt public
 *           DART mirrors consistently report 2027-01-01. Keep MEDIUM provenance.
 * - 126600: local exact structured receipt/root missing; exact-receipt public
 *           DART mirror reports 2026-12-01. Keep MEDIUM provenance.
 *
 * Safety:
 * - no network
 * - no DB reads/writes
 * - no production mutation
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_8_10_2_2_REPLAY_STRUCTURAL_DATE_EVIDENCE_RECONCILIATION';

const INPUT_VERSION =
  'V9_8_10_2_1_REPLAY_STRUCTURAL_EVIDENCE_PATH_EXACT_LABEL_PROBE';

const root = path.resolve(__dirname, '..');

const inputFile = path.join(
  root,
  'logs',
  'opendart-corporate-action-structural-date-probe-v9-8-10-2-1-replay.json',
);

const outputFile = path.join(
  root,
  'logs',
  'opendart-corporate-action-structural-date-reconciliation-v9-8-10-2-2-replay.json',
);

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''),
  );
}

function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(value)
    .digest('hex');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function hasDate(row, date) {
  return (
    row?.documentProbe?.primaryDateDistinctDates ?? []
  ).includes(date);
}

const input = readJson(inputFile);

assert(
  input.version === INPUT_VERSION,
  `INPUT_VERSION_MISMATCH:${input.version}`,
);

assert(
  [
    'STRUCTURAL_EVIDENCE_PATH_PROBE_COMPLETE',
    'STRUCTURAL_EVIDENCE_PATH_PROBE_COMPLETE_WITH_REVIEW',
  ].includes(input.status),
  `INPUT_STATUS_NOT_ALLOWED:${input.status}`,
);

const byId = new Map(
  (input.rows ?? []).map((row) => [
    String(row.providerEventId),
    row,
  ]),
);

const decisions = [
  {
    providerEventId: '20260821000052',
    stockCode: '035720',
    actionType: 'MERGER',
    effectiveDate: '2027-01-01',
    confidence: 'MEDIUM',
    basis:
      'EXTERNAL_DART_MIRROR_EXACT_RECEIPT_CORROBORATION',
    provenance: {
      localExactSourceRows: 0,
      localExactRootRows: 0,
      localDocumentAvailable: false,
      externalExactReceipt: '20260821000052',
      externalSources: [
        'https://dartbrief.com/disclosures/20260821000052',
        'https://t.me/s/darthacking?before=151805',
      ],
      note:
        'Local structured fallback has no exact 2026 receipt/root row; public mirrors of the exact DART receipt consistently state merger date 2027-01-01.',
    },
  },
  {
    providerEventId: '20260803000182',
    stockCode: '090370',
    actionType: 'MERGER',
    effectiveDate: '2026-11-01',
    confidence: 'HIGH',
    basis:
      'LOCAL_CORRECTION_DOCUMENT_EXPLICIT_REVISED_MERGER_DATE',
    provenance: {
      sourceReceiptNo: '20260828001616',
      externalSources: [
        'https://spn.stockplus.com/news/api/v1/disclosure_views/koscom/501662',
        'https://www.bosoop.com/disclosures/20260828001616/',
      ],
      note:
        'Local corrected DART XML contains both old 2026-10-07 and revised 2026-11-01 schedules; exact correction-receipt mirrors explicitly state 10/07 -> 11/01.',
    },
  },
  {
    providerEventId: '20260901000318',
    stockCode: '126600',
    actionType: 'MERGER',
    effectiveDate: '2026-12-01',
    confidence: 'MEDIUM',
    basis:
      'EXTERNAL_DART_MIRROR_EXACT_RECEIPT_CORROBORATION',
    provenance: {
      localExactSourceRows: 0,
      localExactRootRows: 0,
      localDocumentAvailable: false,
      externalExactReceipt: '20260901000318',
      externalSources: [
        'https://hotclipfolio.com/disclosure/20260901000318/',
      ],
      note:
        'Local structured fallback lacks the 2026 exact receipt/root row; exact-receipt public DART mirror reports merger date 2026-12-01.',
    },
  },
  {
    providerEventId: '20260918000373',
    stockCode: '482520',
    actionType: 'MERGER',
    effectiveDate: '2027-03-04',
    confidence: 'HIGH',
    basis:
      'LOCAL_DOCUMENT_PRIMARY_LABEL_FIRST_DATE_WITH_PRIOR_EXTRACTED_MATCH',
    provenance: {
      sourceReceiptNo: '20260918000373',
      externalSources: [
        'https://dartbrief.com/disclosures/20260918000373',
      ],
      note:
        'Local DART XML primary-label occurrence begins with 2027-03-04 and the prior structural extractor independently produced primaryDateCandidate=2027-03-04.',
    },
  },
];

const reconciledRows = [];

for (const decision of decisions) {
  const row = byId.get(decision.providerEventId);

  assert(
    row,
    `TARGET_NOT_FOUND:${decision.providerEventId}`,
  );

  assert(
    String(row.stockCode) === decision.stockCode,
    `STOCK_MISMATCH:${decision.providerEventId}`,
  );

  assert(
    row.actionType === decision.actionType,
    `ACTION_MISMATCH:${decision.providerEventId}`,
  );

  assert(
    row.strongestCandidate == null,
    `TARGET_ALREADY_RESOLVED:${decision.providerEventId}`,
  );

  assert(
    row.candidateBasis == null,
    `TARGET_ALREADY_HAS_BASIS:${decision.providerEventId}`,
  );

  if (decision.providerEventId === '20260821000052') {
    assert(
      Number(row.structuredProbe?.exactSourceRows ?? 0) === 0 &&
      Number(row.structuredProbe?.exactRootRows ?? 0) === 0 &&
      row.documentProbe?.available !== true,
      '035720_LOCAL_EVIDENCE_SHAPE_CHANGED',
    );
  }

  if (decision.providerEventId === '20260803000182') {
    assert(
      row.sourceReceiptNo === '20260828001616',
      '090370_SOURCE_RECEIPT_CHANGED',
    );
    assert(
      hasDate(row, '2026-11-01'),
      '090370_REVISED_DATE_NOT_IN_LOCAL_DOCUMENT',
    );
  }

  if (decision.providerEventId === '20260901000318') {
    assert(
      Number(row.structuredProbe?.exactSourceRows ?? 0) === 0 &&
      Number(row.structuredProbe?.exactRootRows ?? 0) === 0 &&
      row.documentProbe?.available !== true,
      '126600_LOCAL_EVIDENCE_SHAPE_CHANGED',
    );
  }

  if (decision.providerEventId === '20260918000373') {
    assert(
      row.sourceReceiptNo === '20260918000373',
      '482520_SOURCE_RECEIPT_CHANGED',
    );
    assert(
      row.previousPrimaryDateCandidate === '2027-03-04',
      '482520_PRIOR_PRIMARY_DATE_CHANGED',
    );
    assert(
      hasDate(row, '2027-03-04'),
      '482520_DATE_NOT_IN_LOCAL_DOCUMENT',
    );
  }

  reconciledRows.push({
    providerEventId: decision.providerEventId,
    sourceReceiptNo: row.sourceReceiptNo,
    stockCode: decision.stockCode,
    actionType: decision.actionType,
    effectiveDate: decision.effectiveDate,
    confidence: decision.confidence,
    reconciliationBasis: decision.basis,
    priorProbe: {
      strongestCandidate: row.strongestCandidate ?? null,
      candidateBasis: row.candidateBasis ?? null,
      exactSourceRows:
        row.structuredProbe?.exactSourceRows ?? 0,
      exactRootRows:
        row.structuredProbe?.exactRootRows ?? 0,
      documentAvailable:
        row.documentProbe?.available ?? false,
      documentPrimaryDates:
        row.documentProbe?.primaryDateDistinctDates ?? [],
      previousPrimaryDateCandidate:
        row.previousPrimaryDateCandidate ?? null,
    },
    provenance: decision.provenance,
  });
}

const report = {
  status:
    'STRUCTURAL_DATE_EVIDENCE_RECONCILIATION_COMPLETE',
  version: VERSION,

  source: {
    inputVersion: input.version,
    inputStatus: input.status,
    inputFingerprint: input.outputFingerprint ?? null,
  },

  counts: {
    requested: 4,
    reconciled: reconciledRows.length,
    highConfidence:
      reconciledRows.filter(
        (row) => row.confidence === 'HIGH',
      ).length,
    mediumConfidence:
      reconciledRows.filter(
        (row) => row.confidence === 'MEDIUM',
      ).length,
    unresolved: 4 - reconciledRows.length,
  },

  rows: reconciledRows,

  policy: {
    rewritesPriorProbe: false,
    externalMirrorMayBeLabeledHigh: false,
    localDocumentCanBeHighWhenExplicit:
      true,
    genericStructuralFactorStillBlocked:
      true,
    productionPersistenceAllowed:
      false,
  },

  safety: {
    networkRequests: 0,
    databaseReads: 0,
    databaseWrites: 0,
    productionApplied: false,
    canonicalEventsCreated: 0,
    structuralEffectiveDatesPersisted: 0,
    factorsPersisted: 0,
    coverageWindowAdvanced: false,
  },
};

report.outputFingerprint = sha256(
  JSON.stringify({
    version: report.version,
    source: report.source,
    rows: report.rows.map((row) => [
      row.providerEventId,
      row.effectiveDate,
      row.confidence,
      row.reconciliationBasis,
    ]),
  }),
);

fs.writeFileSync(
  outputFile,
  JSON.stringify(report, null, 2) + '\n',
  'utf8',
);

console.log(
  JSON.stringify(
    {
      status: report.status,
      version: report.version,
      requested: report.counts.requested,
      reconciled: report.counts.reconciled,
      highConfidence: report.counts.highConfidence,
      mediumConfidence: report.counts.mediumConfidence,
      unresolved: report.counts.unresolved,
      databaseWrites: 0,
      productionApplied: false,
      outputFile:
        'logs/opendart-corporate-action-structural-date-reconciliation-v9-8-10-2-2-replay.json',
    },
    null,
    2,
  ),
);
