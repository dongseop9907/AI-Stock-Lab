/* eslint-disable no-console */
'use strict';

/**
 * AI Stock Lab
 * V9.8.10.3 - Structural canonical-date finalization preview
 *
 * READ-ONLY. No network. No DB writes.
 *
 * Inputs:
 *   logs/opendart-corporate-action-factor-validation-v9-8-8-replay.json
 *   logs/opendart-corporate-action-structural-date-audit-v9-8-10-1-replay.json
 *   logs/opendart-corporate-action-structural-date-probe-v9-8-10-2-1-replay.json
 *
 * Output:
 *   logs/opendart-corporate-action-structural-date-finalization-v9-8-10-3-replay-v2.json
 *
 * Policy:
 *   - 22 audit-safe structural rows:
 *       use V9.8.10.1 primaryDateCandidate.
 *
 *   - 15 review rows:
 *       use V9.8.10.2.1 strongestCandidate only when basis is
 *       STRUCTURED_EXACT_SOURCE_RECEIPT or
 *       STRUCTURED_EXACT_CANONICAL_ROOT_RECEIPT.
 *
 *   - Exact SOURCE receipt outranks older dates coexisting in corrected XML.
 *   - Exact canonical ROOT receipt is used when latest source receipt has no
 *     exact structured row but the root receipt does.
 *
 *   - MERGER / SPIN_OFF remain generic-factor blocked.
 *
 * No production persistence happens here.
 *
 * Run:
 *   node .\scripts\v9810-3.cjs
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_8_10_3_REPLAY_V2_STRUCTURAL_CANONICAL_DATE_FINALIZATION_WITH_RECONCILIATION';

const FACTOR_VERSION =
  'V9_8_8_REPLAY_PER_EVENT_FACTOR_REFERENCE_VALIDATION';

const AUDIT_VERSION =
  'V9_8_10_1_REPLAY_STRUCTURAL_CANONICAL_DATE_AUDIT';

const PROBE_VERSION =
  'V9_8_10_2_1_REPLAY_STRUCTURAL_EVIDENCE_PATH_EXACT_LABEL_PROBE';

const RECONCILIATION_VERSION =
  'V9_8_10_2_2_REPLAY_STRUCTURAL_DATE_EVIDENCE_RECONCILIATION';

const EXPECTED_STRUCTURAL = 37;
const EXPECTED_MERGER = 33;
const EXPECTED_SPIN_OFF = 4;
const EXPECTED_AUDIT_SAFE = 22;
const EXPECTED_REVIEW_TOTAL = 15;
const EXPECTED_PROBE_RESOLVED = 11;
const EXPECTED_RECONCILED = 4;

const ALLOWED_PROBE_BASES = new Set([
  'STRUCTURED_EXACT_SOURCE_RECEIPT',
  'STRUCTURED_EXACT_CANONICAL_ROOT_RECEIPT',
]);

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''),
  );
}

function atomicSaveJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(value)
    .digest('hex');
}

function isIsoDate(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return false;
  }

  const date = new Date(`${value}T00:00:00Z`);

  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

function countBy(rows, selector) {
  const out = {};

  for (const row of rows) {
    const key = String(selector(row) ?? 'NULL');
    out[key] = (out[key] ?? 0) + 1;
  }

  return Object.fromEntries(
    Object.entries(out).sort(([a], [b]) => a.localeCompare(b)),
  );
}

function main() {
  const root = path.resolve(__dirname, '..');

  const factorFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-factor-validation-v9-8-8-replay.json',
  );

  const auditFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-structural-date-audit-v9-8-10-1-replay.json',
  );

  const probeFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-structural-date-probe-v9-8-10-2-1-replay.json',
  );

  const reconciliationFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-structural-date-reconciliation-v9-8-10-2-2-replay.json',
  );

  const outputFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-structural-date-finalization-v9-8-10-3-replay-v2.json',
  );

  for (const file of [
    factorFile,
    auditFile,
    probeFile,
    reconciliationFile,
  ]) {
    if (!fs.existsSync(file)) {
      throw new Error(`INPUT_NOT_FOUND:${path.basename(file)}`);
    }
  }

  const factor = readJson(factorFile);
  const audit = readJson(auditFile);
  const probe = readJson(probeFile);
  const reconciliation = readJson(reconciliationFile);

  if (factor.version !== FACTOR_VERSION) {
    throw new Error('FACTOR_VERSION_MISMATCH');
  }

  if (audit.version !== AUDIT_VERSION) {
    throw new Error('AUDIT_VERSION_MISMATCH');
  }

  if (probe.version !== PROBE_VERSION) {
    throw new Error('PROBE_VERSION_MISMATCH');
  }

  if (reconciliation.version !== RECONCILIATION_VERSION) {
    throw new Error('RECONCILIATION_VERSION_MISMATCH');
  }

  if (
    reconciliation.status !==
    'STRUCTURAL_DATE_EVIDENCE_RECONCILIATION_COMPLETE'
  ) {
    throw new Error('RECONCILIATION_STAGE_STATUS_UNEXPECTED');
  }

  if (!Array.isArray(reconciliation.rows)) {
    throw new Error('RECONCILIATION_ROWS_MISSING');
  }

  if (reconciliation.rows.length !== EXPECTED_RECONCILED) {
    throw new Error('RECONCILIATION_ROW_COUNT_MISMATCH');
  }

  if (Number(reconciliation.counts?.unresolved ?? 0) !== 0) {
    throw new Error('RECONCILIATION_STILL_UNRESOLVED');
  }

  if (factor.status !== 'PER_EVENT_FACTOR_VALIDATION_COMPLETE') {
    throw new Error('FACTOR_STAGE_NOT_COMPLETE');
  }

  if (
    audit.status !==
    'STRUCTURAL_DATE_AUDIT_COMPLETE_WITH_REVIEW'
  ) {
    throw new Error('AUDIT_STAGE_STATUS_UNEXPECTED');
  }

  if (
    ![
      'STRUCTURAL_EVIDENCE_PATH_PROBE_COMPLETE',
      'STRUCTURAL_EVIDENCE_PATH_PROBE_COMPLETE_WITH_REVIEW',
    ].includes(probe.status)
  ) {
    throw new Error('PROBE_STAGE_STATUS_UNEXPECTED');
  }

  if (!Array.isArray(factor.results)) {
    throw new Error('FACTOR_RESULTS_MISSING');
  }

  const structuralRows = factor.results.filter(
    (row) =>
      row.factorValidation?.status === 'STRUCTURAL_BLOCKED',
  );

  if (structuralRows.length !== EXPECTED_STRUCTURAL) {
    throw new Error('STRUCTURAL_ROW_COUNT_MISMATCH');
  }

  const auditById = new Map(
    audit.rows.map((row) => [row.providerEventId, row]),
  );

  const probeById = new Map(
    probe.rows.map((row) => [row.providerEventId, row]),
  );

  const reconciliationById = new Map(
    reconciliation.rows.map((row) => [
      row.providerEventId,
      row,
    ]),
  );

  if (reconciliationById.size !== EXPECTED_RECONCILED) {
    throw new Error('RECONCILIATION_DUPLICATE_PROVIDER_EVENT_IDS');
  }

  const reviewIds = new Set(
    audit.reviewQueue.map((row) => row.providerEventId),
  );

  if (reviewIds.size !== EXPECTED_REVIEW_TOTAL) {
    throw new Error('AUDIT_REVIEW_SET_COUNT_MISMATCH');
  }

  for (const reconciliationRow of reconciliation.rows) {
    if (!reviewIds.has(reconciliationRow.providerEventId)) {
      throw new Error(
        `RECONCILIATION_TARGET_NOT_IN_REVIEW_SET:${reconciliationRow.providerEventId}`,
      );
    }

    const probeRow =
      probeById.get(reconciliationRow.providerEventId);

    if (!probeRow) {
      throw new Error(
        `RECONCILIATION_PROBE_ROW_MISSING:${reconciliationRow.providerEventId}`,
      );
    }

    if (
      probeRow.strongestCandidate != null ||
      probeRow.candidateBasis != null
    ) {
      throw new Error(
        `RECONCILIATION_TARGET_ALREADY_PROBE_RESOLVED:${reconciliationRow.providerEventId}`,
      );
    }
  }

  const finalized = [];

  for (const row of structuralRows) {
    const auditRow = auditById.get(row.providerEventId);

    if (!auditRow) {
      throw new Error(
        `AUDIT_ROW_MISSING:${row.providerEventId}`,
      );
    }

    let effectiveDate = null;
    let resolutionBasis = null;
    let evidence = null;

    if (reviewIds.has(row.providerEventId)) {
      const probeRow = probeById.get(row.providerEventId);

      if (!probeRow) {
        throw new Error(
          `PROBE_ROW_MISSING:${row.providerEventId}`,
        );
      }

      if (
        ALLOWED_PROBE_BASES.has(
          probeRow.candidateBasis,
        )
      ) {
        if (!isIsoDate(probeRow.strongestCandidate)) {
          throw new Error(
            `PROBE_DATE_INVALID:${row.providerEventId}`,
          );
        }

        effectiveDate = probeRow.strongestCandidate;
        resolutionBasis = probeRow.candidateBasis;

        evidence = {
          resolutionSource:
            'V9_8_10_2_1_EXACT_PROBE',

          previousPrimaryDateCandidate:
            probeRow.previousPrimaryDateCandidate ?? null,

          previousChronologyWarnings:
            probeRow.previousChronologyWarnings ?? [],

          structuredSourceConsensus:
            probeRow.structuredProbe
              ?.sourcePrimaryDateConsensus ?? null,

          structuredRootConsensus:
            probeRow.structuredProbe
              ?.rootPrimaryDateConsensus ?? null,

          xmlPrimaryDateDistinctDates:
            probeRow.documentProbe
              ?.primaryDateDistinctDates ?? [],

          sourceReceiptNo:
            row.sourceReceiptNo,
        };
      } else {
        const reconciliationRow =
          reconciliationById.get(row.providerEventId);

        if (!reconciliationRow) {
          throw new Error(
            `RECONCILIATION_ROW_MISSING_FOR_UNRESOLVED_PROBE:${row.providerEventId}`,
          );
        }

        if (!isIsoDate(reconciliationRow.effectiveDate)) {
          throw new Error(
            `RECONCILIATION_DATE_INVALID:${row.providerEventId}`,
          );
        }

        if (
          !['HIGH', 'MEDIUM'].includes(
            reconciliationRow.confidence,
          )
        ) {
          throw new Error(
            `RECONCILIATION_CONFIDENCE_NOT_ALLOWED:${row.providerEventId}`,
          );
        }

        effectiveDate = reconciliationRow.effectiveDate;
        resolutionBasis =
          `RECONCILIATION_${reconciliationRow.reconciliationBasis}`;

        evidence = {
          resolutionSource:
            'V9_8_10_2_2_RECONCILIATION',

          reconciliationConfidence:
            reconciliationRow.confidence,

          reconciliationBasis:
            reconciliationRow.reconciliationBasis,

          reconciliationProvenance:
            reconciliationRow.provenance ?? null,

          priorProbe:
            reconciliationRow.priorProbe ?? null,

          sourceReceiptNo:
            row.sourceReceiptNo,
        };
      }
    } else {
      if (auditRow.safeToPromoteInNextStage !== true) {
        throw new Error(
          `AUDIT_ROW_NOT_SAFE_AND_NOT_REVIEWED:${row.providerEventId}`,
        );
      }

      if (!isIsoDate(auditRow.primaryDateCandidate)) {
        throw new Error(
          `AUDIT_DATE_INVALID:${row.providerEventId}`,
        );
      }

      effectiveDate = auditRow.primaryDateCandidate;
      resolutionBasis =
        'AUDIT_SAFE_PRIMARY_STRUCTURAL_DATE';

      evidence = {
        primaryDateField:
          auditRow.primaryDateField,

        sourceKind:
          auditRow.sourceKind,

        parserStatus:
          auditRow.parserStatus,

        chronologyWarnings:
          auditRow.chronologyWarnings,

        sourceReceiptNo:
          row.sourceReceiptNo,

        providerEventId:
          row.providerEventId,
      };
    }

    finalized.push({
      providerEventId:
        row.providerEventId,

      sourceReceiptNo:
        row.sourceReceiptNo,

      stockCode:
        row.stockCode,

      actionType:
        row.actionType,

      effectiveDate,

      resolutionBasis,

      factorStatus:
        row.factorValidation?.status,

      factorBlockReason:
        row.factorValidation?.reason,

      evidence,
    });

    console.log(
      [
        'STRUCTURAL_FINALIZE',
        `${finalized.length}/${structuralRows.length}`,
        `root=${row.providerEventId}`,
        `stock=${row.stockCode}`,
        `action=${row.actionType}`,
        `effective=${effectiveDate}`,
        `basis=${resolutionBasis}`,
      ].join(' '),
    );
  }

  const mergerRows = finalized.filter(
    (row) => row.actionType === 'MERGER',
  );

  const spinRows = finalized.filter(
    (row) => row.actionType === 'SPIN_OFF',
  );

  const auditSafeRows = finalized.filter(
    (row) =>
      row.resolutionBasis ===
      'AUDIT_SAFE_PRIMARY_STRUCTURAL_DATE',
  );

  const probeResolvedRows = finalized.filter(
    (row) => ALLOWED_PROBE_BASES.has(row.resolutionBasis),
  );

  const reconciliationResolvedRows = finalized.filter(
    (row) =>
      String(row.resolutionBasis ?? '').startsWith(
        'RECONCILIATION_',
      ),
  );

  const invalidDates = finalized.filter(
    (row) => !isIsoDate(row.effectiveDate),
  );

  const duplicateIdentities =
    finalized.length -
    new Set(
      finalized.map(
        (row) => row.providerEventId,
      ),
    ).size;

  const factorStillBlocked = structuralRows.every(
    (row) =>
      row.factorValidation?.status ===
      'STRUCTURAL_BLOCKED',
  );

  const finalizedById = new Map(
    finalized.map(
      (row) => [row.providerEventId, row],
    ),
  );

  const results = factor.results.map((row) => {
    const finalRow =
      finalizedById.get(row.providerEventId);

    if (!finalRow) {
      return {
        ...row,
        v98103Disposition:
          'UNCHANGED_NON_STRUCTURAL',
      };
    }

    return {
      ...row,

      effectiveDateResolution: {
        status:
          'STRUCTURAL_DATE_RESOLVED_FACTOR_BLOCKED',

        reason:
          finalRow.resolutionBasis,

        effectiveDate:
          finalRow.effectiveDate,

        evidence:
          finalRow.evidence,
      },

      canonicalPreview: {
        ...row.canonicalPreview,

        effective_date:
          finalRow.effectiveDate,

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
        'STRUCTURAL_DATE_FINALIZED_PREVIEW',
    };
  });

  const duplicateCanonicalIdentities =
    results.length -
    new Set(
      results.map(
        (row) =>
          `${row.provider}|${row.providerEventId}`,
      ),
    ).size;

  const structuralCanonicalNulls =
    results.filter(
      (row) =>
        row.factorValidation?.status ===
          'STRUCTURAL_BLOCKED' &&
        !isIsoDate(
          row.canonicalPreview?.effective_date,
        ),
    );

  const status =
    finalized.length === EXPECTED_STRUCTURAL &&
    mergerRows.length === EXPECTED_MERGER &&
    spinRows.length === EXPECTED_SPIN_OFF &&
    auditSafeRows.length === EXPECTED_AUDIT_SAFE &&
    probeResolvedRows.length === EXPECTED_PROBE_RESOLVED &&
    reconciliationResolvedRows.length === EXPECTED_RECONCILED &&
    invalidDates.length === 0 &&
    duplicateIdentities === 0 &&
    duplicateCanonicalIdentities === 0 &&
    structuralCanonicalNulls.length === 0 &&
    factorStillBlocked
      ? 'STRUCTURAL_CANONICAL_DATE_FINALIZATION_PREVIEW_COMPLETE'
      : 'STRUCTURAL_CANONICAL_DATE_FINALIZATION_PREVIEW_INVALID';

  const report = {
    version: VERSION,
    status,

    source: {
      factorVersion:
        factor.version,
      factorFingerprint:
        factor.outputFingerprint,
      auditVersion:
        audit.version,
      auditFingerprint:
        audit.outputFingerprint,
      probeVersion:
        probe.version,
      probeFingerprint:
        probe.outputFingerprint,

      reconciliationVersion:
        reconciliation.version,
      reconciliationFingerprint:
        reconciliation.outputFingerprint,
    },

    counts: {
      structuralRows:
        finalized.length,

      mergerRows:
        mergerRows.length,

      spinOffRows:
        spinRows.length,

      auditSafePromotedPreview:
        auditSafeRows.length,

      precisionProbePromotedPreview:
        probeResolvedRows.length,

      reconciliationPromotedPreview:
        reconciliationResolvedRows.length,

      invalidDates:
        invalidDates.length,

      duplicateStructuralIdentities:
        duplicateIdentities,

      duplicateCanonicalIdentities,

      structuralCanonicalNulls:
        structuralCanonicalNulls.length,

      nonStructuralRowsPreserved:
        results.length -
        finalized.length,

      totalRows:
        results.length,
    },

    resolutionBasisCounts:
      countBy(
        finalized,
        (row) => row.resolutionBasis,
      ),

    actionTypeCounts:
      countBy(
        finalized,
        (row) => row.actionType,
      ),

    finalizedStructuralRows:
      finalized,

    results,

    safety: {
      networkRequests: 0,
      databaseReads: 0,
      databaseWrites: 0,
      productionApplied: false,
      canonicalEventsCreated: 0,
      structuralEffectiveDatesPersisted: 0,
      factorsPersisted: 0,
      canonicalAdjustedBarsMutated: false,
      coverageWindowAdvanced: false,
      eventInsertAllowed: false,
    },

    policy: {
      auditSafeRows:
        'USE_V9_8_10_1_PRIMARY_DATE_CANDIDATE',

      reviewRows:
        'USE_EXACT_PROBE_OR_EXPLICIT_RECONCILIATION_WITH_PROVENANCE',

      reconciliationRows:
        '4_ROWS_ONLY_FROM_V9_8_10_2_2_RECONCILIATION_HIGH_OR_MEDIUM_PROVENANCE',

      correctedXml:
        'EXACT_STRUCTURED_SOURCE_RECEIPT_OUTRANKS_OLDER_DATES_COEXISTING_IN_XML',

      genericStructuralFactor:
        'REMAINS_BLOCKED',

      persistence:
        'NO_WRITES_IN_V9_8_10_3',
    },

    outputFile: path
      .relative(root, outputFile)
      .replaceAll('\\', '/'),
  };

  report.outputFingerprint = sha256(
    JSON.stringify({
      version: report.version,
      factorFingerprint:
        report.source.factorFingerprint,
      auditFingerprint:
        report.source.auditFingerprint,
      probeFingerprint:
        report.source.probeFingerprint,
      reconciliationFingerprint:
        report.source.reconciliationFingerprint,
      rows: finalized.map(
        (row) => [
          row.providerEventId,
          row.stockCode,
          row.actionType,
          row.effectiveDate,
          row.resolutionBasis,
        ],
      ),
    }),
  );

  atomicSaveJson(outputFile, report);

  console.log(
    JSON.stringify(
      {
        status: report.status,
        version: VERSION,
        ...report.counts,
        resolutionBasisCounts:
          report.resolutionBasisCounts,
        actionTypeCounts:
          report.actionTypeCounts,
        networkRequests: 0,
        databaseWrites: 0,
        productionApplied: false,
        canonicalEventsCreated: 0,
        structuralEffectiveDatesPersisted: 0,
        factorsPersisted: 0,
        coverageWindowAdvanced: false,
        outputFile: report.outputFile,
      },
      null,
      2,
    ),
  );

  if (
    status ===
    'STRUCTURAL_CANONICAL_DATE_FINALIZATION_PREVIEW_INVALID'
  ) {
    process.exitCode = 2;
  }
}

try {
  main();
} catch (error) {
  console.error(
    String(error?.message ?? error),
  );

  process.exitCode = 1;
}
