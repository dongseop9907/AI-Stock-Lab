#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * V9.11.7 - 043910 structural effective-date reconfirmation
 *
 * READ ONLY / NETWORK 0 / DB 0
 *
 * Expected prior validated structural date:
 *   043910 / MERGER / root 20261002000418
 *   effective_date = 2026-12-31
 *
 * Policy:
 * - Reuse only a prior V9.9 validated/finalized structural date.
 * - Current 2026-10-06 correction is ATTACHMENT_ONLY.
 * - Do not infer a new date from receipt order.
 * - Do not call KIS.
 * - Do not create generic factors for MERGER.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_11_7_043910_STRUCTURAL_EFFECTIVE_DATE_RECONFIRMATION';

const AS_OF_DATE = '2026-10-06';

const TARGET = Object.freeze({
  stockCode: '043910',
  actionType: 'MERGER',
  providerEventId: '20261002000418',
  latestSourceReceiptNo: '20261006000033',
  expectedEffectiveDate: '2026-12-31',
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''),
  );
}

function atomicSaveJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(value)
    .digest('hex');
}

function normalizeStock(value) {
  const s = String(value ?? '').trim();
  return s ? s.padStart(6, '0') : '';
}

function normalizeAction(value) {
  return String(value ?? '').trim().toUpperCase();
}

function isIsoDate(value) {
  const s = String(value ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;

  const d = new Date(`${s}T00:00:00Z`);
  return (
    Number.isFinite(d.getTime()) &&
    d.toISOString().slice(0, 10) === s
  );
}

function collectObjects(root) {
  const out = [];

  function walk(value, parts = []) {
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, [...parts, i]));
      return;
    }

    if (!value || typeof value !== 'object') return;

    out.push({
      path: parts.join('.'),
      value,
    });

    for (const [key, child] of Object.entries(value)) {
      walk(child, [...parts, key]);
    }
  }

  walk(root);
  return out;
}

function getIdentity(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return null;
  }

  const stockCode = normalizeStock(
    obj.stockCode ??
    obj.stock_code ??
    obj.canonicalPreview?.stock_code,
  );

  const actionType = normalizeAction(
    obj.actionType ??
    obj.action_type ??
    obj.canonicalPreview?.action_type,
  );

  const providerEventId = String(
    obj.providerEventId ??
    obj.provider_event_id ??
    obj.rootReceiptNo ??
    obj.canonicalPreview?.provider_event_id ??
    '',
  ).trim();

  return {
    stockCode,
    actionType,
    providerEventId,
  };
}

function extractEffectiveDates(obj) {
  const candidates = [
    obj?.effectiveDate,
    obj?.effective_date,
    obj?.canonicalPreview?.effective_date,
    obj?.effectiveDateResolution?.effectiveDate,
    obj?.finalEffectiveDate,
    obj?.resolvedEffectiveDate,
    obj?.structuralDate?.effectiveDate,
    obj?.structuralDate?.date,
  ]
    .map((x) => String(x ?? '').trim())
    .filter(isIsoDate);

  return [...new Set(candidates)];
}

function findTargetDateEvidence(doc, sourceFile) {
  const rows = [];

  for (const entry of collectObjects(doc)) {
    const identity = getIdentity(entry.value);
    if (!identity) continue;

    const serialized = JSON.stringify(entry.value);

    const identityMatch =
      identity.stockCode === TARGET.stockCode &&
      identity.actionType === TARGET.actionType &&
      (
        identity.providerEventId === TARGET.providerEventId ||
        serialized.includes(TARGET.providerEventId)
      );

    if (!identityMatch) continue;

    const dates = extractEffectiveDates(entry.value);

    if (dates.length === 0 && !serialized.includes(TARGET.expectedEffectiveDate)) {
      continue;
    }

    const allDates = new Set(dates);

    if (serialized.includes(TARGET.expectedEffectiveDate)) {
      allDates.add(TARGET.expectedEffectiveDate);
    }

    rows.push({
      sourceFile,
      path: entry.path,
      identity,
      effectiveDates: [...allDates],
      serializedLength: serialized.length,
      snapshot: entry.value,
    });
  }

  return rows;
}

function main() {
  const root = path.resolve(__dirname, '..');

  const fieldFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-field-extraction-v9-11-6.json',
  );

  const canonicalFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-canonical-source-selection-v9-11-5.json',
  );

  const priorCandidates = [
    'logs/opendart-corporate-action-structural-date-finalization-v9-9-10-3-common-stock-scope.json',
    'logs/opendart-corporate-action-effective-date-finalization-v9-9-7-2-common-stock-scope.json',
    'logs/opendart-corporate-action-market-effective-date-v9-9-7-common-stock-scope.json',
    'logs/opendart-corporate-action-factor-validation-v9-9-8-common-stock-scope.json',
    'logs/opendart-corporate-action-structural-date-probe-v9-9-10-2-1-common-stock-scope.json',
    'logs/opendart-corporate-action-structural-date-audit-v9-9-10-1-common-stock-scope.json',
  ];

  const outputFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-effective-date-reconfirmation-v9-11-7.json',
  );

  assert(fs.existsSync(fieldFile), 'V9_11_6_FIELD_EXTRACTION_NOT_FOUND');
  assert(fs.existsSync(canonicalFile), 'V9_11_5_CANONICAL_SOURCE_NOT_FOUND');

  const field = readJson(fieldFile);
  const canonical = readJson(canonicalFile);

  assert(
    field.status === 'FIELD_EXTRACTION_COMPLETE',
    `FIELD_STATUS_INVALID:${field.status}`,
  );

  assert(
    field.conclusion?.rootProviderEventId === TARGET.providerEventId,
    'FIELD_ROOT_PROVIDER_ID_MISMATCH',
  );

  assert(
    field.conclusion?.latestValidSourceReceiptNo === TARGET.latestSourceReceiptNo,
    'FIELD_LATEST_SOURCE_MISMATCH',
  );

  assert(
    field.conclusion?.attachmentOnlyCorrection === true &&
    field.conclusion?.businessFieldsPreserved === true &&
    field.conclusion?.canonicalPreviewPreserved === true,
    'ATTACHMENT_ONLY_FIELD_PRESERVATION_NOT_PROVEN',
  );

  assert(
    canonical.conclusion?.correctionScope === 'ATTACHMENT_ONLY',
    'CANONICAL_CORRECTION_SCOPE_NOT_ATTACHMENT_ONLY',
  );

  const priorEvidence = [];

  for (const rel of priorCandidates) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) continue;

    const doc = readJson(abs);
    priorEvidence.push(
      ...findTargetDateEvidence(doc, rel),
    );
  }

  assert(
    priorEvidence.length > 0,
    'NO_PRIOR_V9_9_043910_STRUCTURAL_DATE_EVIDENCE_FOUND',
  );

  const exactDateEvidence = priorEvidence.filter(
    (row) =>
      row.effectiveDates.includes(TARGET.expectedEffectiveDate),
  );

  assert(
    exactDateEvidence.length > 0,
    `EXPECTED_EFFECTIVE_DATE_NOT_FOUND:${TARGET.expectedEffectiveDate}`,
  );

  const conflictingDates = [
    ...new Set(
      priorEvidence.flatMap((row) => row.effectiveDates),
    ),
  ].filter((date) => date !== TARGET.expectedEffectiveDate);

  assert(
    conflictingDates.length === 0,
    `CONFLICTING_PRIOR_EFFECTIVE_DATES:${JSON.stringify(conflictingDates)}`,
  );

  const sourcePriority = [
    'structural-date-finalization-v9-9-10-3-common-stock-scope',
    'effective-date-finalization-v9-9-7-2-common-stock-scope',
    'factor-validation-v9-9-8-common-stock-scope',
    'structural-date-probe-v9-9-10-2-1-common-stock-scope',
    'structural-date-audit-v9-9-10-1-common-stock-scope',
    'market-effective-date-v9-9-7-common-stock-scope',
  ];

  function priority(row) {
    const idx = sourcePriority.findIndex(
      (needle) => row.sourceFile.includes(needle),
    );
    return idx >= 0 ? idx : 999;
  }

  exactDateEvidence.sort(
    (a, b) =>
      priority(a) - priority(b) ||
      a.serializedLength - b.serializedLength,
  );

  const strongest = exactDateEvidence[0];

  const previousRow = field.results?.[0];

  assert(previousRow, 'V9_11_6_RESULT_ROW_MISSING');

  const refreshed = JSON.parse(JSON.stringify(previousRow));

  assert(
    refreshed.canonicalPreview?.effective_date == null,
    `EXPECTED_PRE_RECONFIRMATION_EFFECTIVE_DATE_NULL_GOT_${refreshed.canonicalPreview?.effective_date}`,
  );

  refreshed.canonicalPreview.effective_date =
    TARGET.expectedEffectiveDate;

  refreshed.effectiveDateResolution = {
    status: 'RECONFIRMED',
    reason:
      'PRIOR_VALIDATED_V9_9_STRUCTURAL_DATE_PRESERVED_AFTER_ATTACHMENT_ONLY_CORRECTION',
    effectiveDate: TARGET.expectedEffectiveDate,
    asOfDate: AS_OF_DATE,
    source: {
      file: strongest.sourceFile,
      path: strongest.path,
    },
    evidence: {
      priorValidatedDate: TARGET.expectedEffectiveDate,
      attachmentOnlyCorrection: true,
      businessFieldsPreserved: true,
      conflictingPriorDates: [],
      latestSourceReceiptNo: TARGET.latestSourceReceiptNo,
    },
  };

  refreshed.nextStage = {
    ...(refreshed.nextStage ?? {}),
    marketEffectiveDateResolutionRequired: false,
    effectiveDateResolved: true,
    structuralFactorBlocked: true,
    futureStructuralPending:
      TARGET.expectedEffectiveDate > AS_OF_DATE,
  };

  refreshed.v9117Disposition = {
    status:
      TARGET.expectedEffectiveDate > AS_OF_DATE
        ? 'FUTURE_STRUCTURAL_DATE_RECONFIRMED'
        : 'STRUCTURAL_DATE_RECONFIRMED',
    effectiveDate: TARGET.expectedEffectiveDate,
    factorPolicy: 'STRUCTURAL_BLOCKED',
    persistencePolicy:
      TARGET.expectedEffectiveDate > AS_OF_DATE
        ? 'DEFER_UNTIL_EFFECTIVE_DATE_RECONFIRMATION_CYCLE'
        : 'ELIGIBLE_FOR_PERSISTENCE_PREFLIGHT',
  };

  const report = {
    status:
      TARGET.expectedEffectiveDate > AS_OF_DATE
        ? 'EFFECTIVE_DATE_RECONFIRMATION_COMPLETE_WITH_FUTURE_PENDING'
        : 'EFFECTIVE_DATE_RECONFIRMATION_COMPLETE',

    version: VERSION,
    asOfDate: AS_OF_DATE,

    source: {
      fieldExtractionVersion: field.version,
      canonicalSourceVersion: canonical.version,
      priorEvidenceFilesScanned:
        priorCandidates.filter((rel) =>
          fs.existsSync(path.join(root, rel)),
        ),
    },

    counts: {
      targetRows: 1,
      reconfirmed: 1,
      unresolved: 0,
      conflicting: 0,
      futurePending:
        TARGET.expectedEffectiveDate > AS_OF_DATE ? 1 : 0,
      structuralBlocked: 1,
      genericFactorReady: 0,
    },

    priorEvidence: {
      matches: priorEvidence.map((row) => ({
        sourceFile: row.sourceFile,
        path: row.path,
        effectiveDates: row.effectiveDates,
      })),
      strongest: {
        sourceFile: strongest.sourceFile,
        path: strongest.path,
        effectiveDate: TARGET.expectedEffectiveDate,
      },
      conflictingDates: [],
    },

    results: [refreshed],

    safety: {
      networkRequests: 0,
      kisRequests: 0,
      databaseReads: 0,
      databaseWrites: 0,
      productionApplied: false,
      factorMutation: false,
      coverageWindowAdvanced: false,
    },

    policy: {
      attachmentOnlyCorrection:
        'DO_NOT_CHANGE_PRIOR_VALIDATED_STRUCTURAL_DATE_WITHOUT_EXPLICIT_DATE_CHANGE_EVIDENCE',
      structuralAction:
        'MERGER_GENERIC_FACTOR_BLOCKED',
      futureEvent:
        'DEFER_PERSISTENCE_KIS_REFRESH_UNTIL_EFFECTIVE_DATE_CYCLE',
      receiptOrderPairing: 'FORBIDDEN',
    },

    conclusion: {
      providerEventId: TARGET.providerEventId,
      latestValidSourceReceiptNo: TARGET.latestSourceReceiptNo,
      effectiveDate: TARGET.expectedEffectiveDate,
      effectiveDateReconfirmed: true,
      attachmentOnlyCorrectionDidNotChangeEffectiveDate: true,
      futureStructuralPending:
        TARGET.expectedEffectiveDate > AS_OF_DATE,
      genericFactorMustRemainBlocked: true,
      kisRefreshRequiredNow: false,
      safeToProceedToFactorValidation: true,
      safeToWriteProductionNow: false,
    },

    nextGate:
      'V9_11_8_STRUCTURAL_FACTOR_VALIDATION',

    outputFile:
      'logs/opendart-corporate-action-effective-date-reconfirmation-v9-11-7.json',
  };

  report.outputFingerprint =
    sha256(
      JSON.stringify({
        version: report.version,
        priorEvidence: report.priorEvidence,
        results: report.results,
        conclusion: report.conclusion,
      }),
    );

  atomicSaveJson(outputFile, report);

  console.log(
    JSON.stringify(
      {
        status: report.status,
        version: report.version,
        asOfDate: report.asOfDate,
        counts: report.counts,
        target: {
          providerEventId: TARGET.providerEventId,
          stockCode: TARGET.stockCode,
          actionType: TARGET.actionType,
          latestValidSourceReceiptNo: TARGET.latestSourceReceiptNo,
          effectiveDate: TARGET.expectedEffectiveDate,
        },
        priorEvidence: report.priorEvidence,
        conclusion: report.conclusion,
        networkRequests: 0,
        kisRequests: 0,
        databaseWrites: 0,
        nextGate: report.nextGate,
        outputFile: report.outputFile,
      },
      null,
      2,
    ),
  );
}

try {
  main();
} catch (error) {
  console.error(
    JSON.stringify(
      {
        status: 'V9_11_7_EFFECTIVE_DATE_RECONFIRMATION_FAILED',
        version: VERSION,
        error: String(error?.message ?? error),
        networkRequests: 0,
        kisRequests: 0,
        databaseWrites: 0,
        productionApplied: false,
      },
      null,
      2,
    ),
  );

  process.exitCode = 2;
}
