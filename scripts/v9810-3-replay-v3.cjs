#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * V9.8.10.3 replay v3
 *
 * Targeted correction for one false-safe structural date:
 *
 *   providerEventId 20260807000649
 *   stockCode       003580
 *   actionType      MERGER
 *
 * Repaired V9.8.10.1 replay accidentally admitted a 2023 merger date from an
 * unrelated historical structured row for the same issuer. The exact 2026
 * DART receipt and the preserved historical V9.8 eligibility artifact identify
 * the canonical merger date as 2026-10-12.
 *
 * This script:
 * - reads the already-complete V9.8.10.3 replay-v2 artifact
 * - fail-closes unless the exact bad state is still present
 * - corrects ONLY this one structural effective date
 * - preserves all other rows semantically unchanged
 * - writes a new replay-v3 artifact
 *
 * No network. No DB reads/writes. No production persistence.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_8_10_3_REPLAY_V3_TARGETED_STRUCTURAL_FALSE_SAFE_DATE_CORRECTION';

const INPUT_VERSION =
  'V9_8_10_3_REPLAY_V2_STRUCTURAL_CANONICAL_DATE_FINALIZATION_WITH_RECONCILIATION';

const TARGET = {
  providerEventId: '20260807000649',
  stockCode: '003580',
  actionType: 'MERGER',
  incorrectEffectiveDate: '2023-07-01',
  correctedEffectiveDate: '2026-10-12',
  correctedBasis:
    'TARGETED_EXACT_DART_RECEIPT_STRUCTURAL_DATE_CORRECTION',
};

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''),
  );
}

function atomicSaveJson(file, value) {
  fs.mkdirSync(path.dirname(file), {
    recursive: true,
  });

  const tmp =
    `${file}.tmp-${process.pid}-${Date.now()}`;

  fs.writeFileSync(
    tmp,
    JSON.stringify(value, null, 2) + '\n',
    'utf8',
  );

  fs.renameSync(tmp, file);
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

function countBy(rows, keyFn) {
  const out = {};

  for (const row of rows) {
    const key = keyFn(row) ?? 'NULL';
    out[key] = (out[key] ?? 0) + 1;
  }

  return Object.fromEntries(
    Object.entries(out).sort(
      ([a], [b]) => a.localeCompare(b),
    ),
  );
}

const root = path.resolve(__dirname, '..');

const inputFile = path.join(
  root,
  'logs',
  'opendart-corporate-action-structural-date-finalization-v9-8-10-3-replay-v2.json',
);

const outputFile = path.join(
  root,
  'logs',
  'opendart-corporate-action-structural-date-finalization-v9-8-10-3-replay-v3.json',
);

const historicalAuditFile = path.join(
  root,
  'logs',
  'opendart-corporate-action-structural-date-audit-v9-8-10-1.json',
);

const historicalEligibilityFile = path.join(
  root,
  'logs',
  'opendart-corporate-action-snapshot-eligibility-v9-8-11-5-1.json',
);

assert(
  fs.existsSync(inputFile),
  `INPUT_NOT_FOUND:${path.basename(inputFile)}`,
);

const input = readJson(inputFile);

assert(
  input.version === INPUT_VERSION,
  `INPUT_VERSION_MISMATCH:${input.version}`,
);

assert(
  input.status ===
    'STRUCTURAL_CANONICAL_DATE_FINALIZATION_PREVIEW_COMPLETE',
  `INPUT_STATUS_NOT_COMPLETE:${input.status}`,
);

assert(
  Array.isArray(input.results),
  'INPUT_RESULTS_MISSING',
);

const targetIndexes = [];

for (let i = 0; i < input.results.length; i += 1) {
  if (
    String(input.results[i]?.providerEventId) ===
    TARGET.providerEventId
  ) {
    targetIndexes.push(i);
  }
}

assert(
  targetIndexes.length === 1,
  `TARGET_RESULT_COUNT:${targetIndexes.length}`,
);

const targetIndex = targetIndexes[0];
const before = input.results[targetIndex];

assert(
  String(before.stockCode) === TARGET.stockCode,
  `TARGET_STOCK_MISMATCH:${before.stockCode}`,
);

assert(
  before.actionType === TARGET.actionType,
  `TARGET_ACTION_MISMATCH:${before.actionType}`,
);

assert(
  before.factorValidation?.status ===
    'STRUCTURAL_BLOCKED',
  `TARGET_FACTOR_STATUS_UNEXPECTED:${before.factorValidation?.status}`,
);

assert(
  before.canonicalPreview?.effective_date ===
    TARGET.incorrectEffectiveDate,
  `TARGET_BAD_DATE_STATE_CHANGED:${before.canonicalPreview?.effective_date}`,
);

assert(
  before.effectiveDateResolution?.reason ===
    'AUDIT_SAFE_PRIMARY_STRUCTURAL_DATE',
  `TARGET_BAD_BASIS_STATE_CHANGED:${before.effectiveDateResolution?.reason}`,
);

let historicalAuditCorroborated = false;

if (fs.existsSync(historicalAuditFile)) {
  const oldAudit = readJson(historicalAuditFile);

  const oldReview =
    Array.isArray(oldAudit.reviewQueue)
      ? oldAudit.reviewQueue.find(
          (row) =>
            String(row.providerEventId) ===
            TARGET.providerEventId,
        )
      : null;

  assert(
    oldReview,
    'HISTORICAL_AUDIT_TARGET_NOT_IN_REVIEW_QUEUE',
  );

  assert(
    oldReview.primaryDateCandidate == null,
    `HISTORICAL_AUDIT_TARGET_WAS_NOT_UNRESOLVED:${oldReview.primaryDateCandidate}`,
  );

  historicalAuditCorroborated = true;
}

let historicalEligibilityCorroborated = false;

if (fs.existsSync(historicalEligibilityFile)) {
  const oldEligibility =
    readJson(historicalEligibilityFile);

  const oldDeferred =
    Array.isArray(
      oldEligibility.deferredFutureStructuralRows,
    )
      ? oldEligibility.deferredFutureStructuralRows.find(
          (row) =>
            String(row.providerEventId) ===
            TARGET.providerEventId,
        )
      : null;

  assert(
    oldDeferred,
    'HISTORICAL_ELIGIBILITY_TARGET_NOT_DEFERRED',
  );

  assert(
    oldDeferred.effectiveDate ===
      TARGET.correctedEffectiveDate,
    `HISTORICAL_ELIGIBILITY_DATE_MISMATCH:${oldDeferred.effectiveDate}`,
  );

  historicalEligibilityCorroborated = true;
}

const results = input.results.map((row, index) => {
  if (index !== targetIndex) {
    return row;
  }

  return {
    ...row,

    effectiveDateResolution: {
      ...row.effectiveDateResolution,

      status:
        'STRUCTURAL_DATE_RESOLVED_FACTOR_BLOCKED',

      reason:
        TARGET.correctedBasis,

      effectiveDate:
        TARGET.correctedEffectiveDate,

      evidence: {
        correctionType:
          'FALSE_SAFE_STRUCTURED_ROW_CROSS_EVENT_CONTAMINATION',

        priorResolution:
          row.effectiveDateResolution,

        exactProviderEventId:
          TARGET.providerEventId,

        correctedEffectiveDate:
          TARGET.correctedEffectiveDate,

        historicalAuditCorroborated,
        historicalEligibilityCorroborated,

        externalExactReceiptEvidence: [
          {
            source:
              'DARTBRIEF_EXACT_RECEIPT_MIRROR',
            receiptNo:
              '20260807000649',
            mergerDate:
              '2026-10-12',
            url:
              'https://dartbrief.com/disclosures/20260807000649',
          },
          {
            source:
              'AWAKE_DART_EXACT_RECEIPT_MIRROR',
            receiptNo:
              '20260807000649',
            mergerDate:
              '2026-10-12',
            url:
              'https://t.me/s/darthacking/148886',
          },
        ],

        correctionPolicy:
          'EXACT_2026_RECEIPT_OVERRIDES_UNRELATED_2023_STRUCTURED_ROW',
      },
    },

    canonicalPreview: {
      ...row.canonicalPreview,

      effective_date:
        TARGET.correctedEffectiveDate,

      event_insert_allowed:
        false,
    },

    nextStage: {
      ...row.nextStage,

      structuralEffectiveDateResolved:
        true,

      structuralFactorBlocked:
        true,
    },

    v98103Disposition:
      'STRUCTURAL_DATE_FINALIZED_PREVIEW_TARGETED_CORRECTION',
  };
});

const after = results[targetIndex];

assert(
  after.canonicalPreview?.effective_date ===
    TARGET.correctedEffectiveDate,
  'TARGET_CORRECTION_FAILED',
);

assert(
  after.factorValidation?.status ===
    'STRUCTURAL_BLOCKED',
  'TARGET_FACTOR_BLOCK_CHANGED',
);

const nonTargetRowsChanged =
  results.reduce(
    (count, row, index) => {
      if (index === targetIndex) return count;

      return (
        count +
        (
          JSON.stringify(row) ===
          JSON.stringify(input.results[index])
            ? 0
            : 1
        )
      );
    },
    0,
  );

assert(
  nonTargetRowsChanged === 0,
  `NON_TARGET_ROWS_CHANGED:${nonTargetRowsChanged}`,
);

const structuralRows =
  results.filter(
    (row) =>
      row.factorValidation?.status ===
      'STRUCTURAL_BLOCKED',
  );

const structuralCanonicalNulls =
  structuralRows.filter(
    (row) =>
      typeof row.canonicalPreview?.effective_date !==
        'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(
        row.canonicalPreview.effective_date,
      ),
  );

assert(
  structuralRows.length === 37,
  `STRUCTURAL_ROW_COUNT_CHANGED:${structuralRows.length}`,
);

assert(
  structuralCanonicalNulls.length === 0,
  `STRUCTURAL_CANONICAL_NULLS:${structuralCanonicalNulls.length}`,
);

const resolutionBasisCounts =
  countBy(
    structuralRows,
    (row) =>
      row.effectiveDateResolution?.reason ?? null,
  );

const report = {
  ...input,

  version: VERSION,

  source: {
    ...(input.source ?? {}),

    priorFinalizationVersion:
      input.version,

    priorFinalizationFingerprint:
      input.outputFingerprint ?? null,
  },

  targetedCorrection: {
    providerEventId:
      TARGET.providerEventId,

    stockCode:
      TARGET.stockCode,

    actionType:
      TARGET.actionType,

    priorEffectiveDate:
      TARGET.incorrectEffectiveDate,

    correctedEffectiveDate:
      TARGET.correctedEffectiveDate,

    priorBasis:
      before.effectiveDateResolution?.reason ?? null,

    correctedBasis:
      TARGET.correctedBasis,

    historicalAuditCorroborated,
    historicalEligibilityCorroborated,

    rationale:
      'REPAIRED_AUDIT_SELECTED_2023_STRUCTURED_ROW_FROM_DIFFERENT_MERGER_EVENT_FOR_2026_RECEIPT',
  },

  counts: {
    ...(input.counts ?? {}),

    auditSafePromotedPreview:
      structuralRows.filter(
        (row) =>
          row.effectiveDateResolution?.reason ===
          'AUDIT_SAFE_PRIMARY_STRUCTURAL_DATE',
      ).length,

    targetedFalseSafeCorrections:
      1,

    structuralCanonicalNulls:
      structuralCanonicalNulls.length,
  },

  resolutionBasisCounts,

  results,

  safety: {
    ...(input.safety ?? {}),

    networkRequests: 0,
    databaseWrites: 0,
    productionApplied: false,
    canonicalEventsCreated: 0,
    structuralEffectiveDatesPersisted: 0,
    factorsPersisted: 0,
    coverageWindowAdvanced: false,
  },

  outputFile:
    'logs/opendart-corporate-action-structural-date-finalization-v9-8-10-3-replay-v3.json',
};

report.outputFingerprint = sha256(
  JSON.stringify({
    version:
      report.version,

    priorFingerprint:
      input.outputFingerprint ?? null,

    correction:
      report.targetedCorrection,

    structural:
      structuralRows.map((row) => [
        row.providerEventId,
        row.stockCode,
        row.actionType,
        row.canonicalPreview?.effective_date ?? null,
        row.effectiveDateResolution?.reason ?? null,
      ]),
  }),
);

atomicSaveJson(outputFile, report);

console.log(
  JSON.stringify(
    {
      status:
        'STRUCTURAL_FALSE_SAFE_TARGETED_CORRECTION_COMPLETE',

      version:
        VERSION,

      providerEventId:
        TARGET.providerEventId,

      stockCode:
        TARGET.stockCode,

      priorEffectiveDate:
        TARGET.incorrectEffectiveDate,

      correctedEffectiveDate:
        TARGET.correctedEffectiveDate,

      priorBasis:
        before.effectiveDateResolution?.reason ?? null,

      correctedBasis:
        TARGET.correctedBasis,

      historicalAuditCorroborated,
      historicalEligibilityCorroborated,

      structuralRows:
        structuralRows.length,

      auditSafePromotedPreview:
        report.counts.auditSafePromotedPreview,

      targetedFalseSafeCorrections:
        1,

      structuralCanonicalNulls:
        structuralCanonicalNulls.length,

      nonTargetRowsChanged:
        nonTargetRowsChanged,

      databaseWrites:
        0,

      productionApplied:
        false,

      outputFile:
        report.outputFile,
    },
    null,
    2,
  ),
);
