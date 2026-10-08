#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * V9.11.6 - 2026-10-06 field extraction / structural carry-forward refresh
 *
 * READ ONLY / NETWORK 0 / DB 0
 *
 * Strategy:
 * - Reuse the already-validated V9.9 common-stock field-extraction row for
 *   043910 / MERGER / root receipt 20261002000418.
 * - The 2026-10-06 correction is ATTACHMENT_ONLY (signed merger contract).
 * - Therefore preserve parsed business fields and canonicalPreview exactly.
 * - Advance source lineage only:
 *     sourceReceiptNo   -> 20261006000033
 *     sourceReceiptDate -> 20261006
 *     sourceIsCorrection -> true
 * - Do NOT invent a new business-field fingerprint.
 * - Preserve the previous business-field source fingerprint and add a separate
 *   lineage fingerprint for this incremental refresh.
 *
 * Output:
 *   logs/opendart-corporate-action-field-extraction-v9-11-6.json
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_11_6_2026_10_06_ATTACHMENT_ONLY_STRUCTURAL_FIELD_CARRY_FORWARD';

const TARGET = Object.freeze({
  stockCode: '043910',
  actionType: 'MERGER',
  rootReceiptNo: '20261002000418',
  correctionReceiptNo: '20261006000033',
  correctionReceiptDate: '20261006',
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

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeStock(value) {
  const s = String(value ?? '').trim();
  return s ? s.padStart(6, '0') : '';
}

function normalizeAction(value) {
  return String(value ?? '').trim().toUpperCase();
}

function objectIdentity(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return null;
  }

  const stockCode =
    normalizeStock(
      obj.stockCode ??
      obj.stock_code ??
      obj.canonicalPreview?.stock_code,
    );

  const actionType =
    normalizeAction(
      obj.actionType ??
      obj.action_type ??
      obj.canonicalPreview?.action_type,
    );

  const providerEventId =
    String(
      obj.providerEventId ??
      obj.provider_event_id ??
      obj.rootReceiptNo ??
      obj.canonicalPreview?.provider_event_id ??
      '',
    ).trim();

  const sourceReceiptNo =
    String(
      obj.sourceReceiptNo ??
      obj.source_receipt_no ??
      obj.metadata?.source_receipt_no ??
      '',
    ).trim();

  return {
    stockCode,
    actionType,
    providerEventId,
    sourceReceiptNo,
  };
}

function collectObjects(root) {
  const out = [];

  function walk(value, parts = []) {
    if (Array.isArray(value)) {
      value.forEach((child, i) =>
        walk(child, [...parts, i]),
      );
      return;
    }

    if (!value || typeof value !== 'object') {
      return;
    }

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

function findTargetRows(doc) {
  return collectObjects(doc)
    .map((entry) => ({
      ...entry,
      identity: objectIdentity(entry.value),
      serializedLength:
        JSON.stringify(entry.value).length,
    }))
    .filter((entry) => {
      const id = entry.identity;

      if (!id) return false;

      return (
        id.stockCode === TARGET.stockCode &&
        id.actionType === TARGET.actionType &&
        (
          id.providerEventId === TARGET.rootReceiptNo ||
          JSON.stringify(entry.value)
            .includes(TARGET.rootReceiptNo)
        )
      );
    })
    .sort(
      (a, b) =>
        a.serializedLength - b.serializedLength,
    );
}

function directResultRow(entry) {
  const v = entry?.value;

  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v)
  ) {
    return false;
  }

  return (
    normalizeStock(v.stockCode) === TARGET.stockCode &&
    normalizeAction(v.actionType) === TARGET.actionType &&
    String(v.providerEventId ?? '') === TARGET.rootReceiptNo &&
    v.canonicalPreview &&
    typeof v.canonicalPreview === 'object'
  );
}

function main() {
  const root =
    path.resolve(__dirname, '..');

  const canonicalFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-canonical-source-selection-v9-11-5.json',
    );

  const viewerFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-043910-viewer-evidence-v9-11-4-1.json',
    );

  const priorCandidates = [
    path.join(
      root,
      'logs',
      'opendart-corporate-action-field-extraction-v9-9-6-3-common-stock-scope.json',
    ),
    path.join(
      root,
      'logs',
      'opendart-corporate-action-field-extraction-v9-9-6-3.json',
    ),
    path.join(
      root,
      'logs',
      'opendart-corporate-action-field-extraction-v9-9-6-1-common-stock-scope.json',
    ),
    path.join(
      root,
      'logs',
      'opendart-corporate-action-field-extraction-v9-9-6-1.json',
    ),
  ];

  const outputFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-field-extraction-v9-11-6.json',
    );

  assert(
    fs.existsSync(canonicalFile),
    'V9_11_5_CANONICAL_SOURCE_SELECTION_NOT_FOUND',
  );

  assert(
    fs.existsSync(viewerFile),
    'V9_11_4_1_VIEWER_EVIDENCE_NOT_FOUND',
  );

  const canonical =
    readJson(canonicalFile);

  const viewer =
    readJson(viewerFile);

  assert(
    canonical.status ===
      'CANONICAL_SOURCE_SELECTION_READY',
    `CANONICAL_STATUS_INVALID:${canonical.status}`,
  );

  assert(
    canonical.conclusion
      ?.canonicalRootIdentity === TARGET.rootReceiptNo,
    'CANONICAL_ROOT_MISMATCH',
  );

  assert(
    canonical.conclusion
      ?.latestValidSourceReceiptNo === TARGET.correctionReceiptNo,
    'CANONICAL_SOURCE_MISMATCH',
  );

  assert(
    canonical.conclusion
      ?.correctionScope === 'ATTACHMENT_ONLY',
    `EXPECTED_ATTACHMENT_ONLY_GOT_${canonical.conclusion?.correctionScope}`,
  );

  assert(
    canonical.conclusion
      ?.safeToProceedToFieldExtraction === true,
    'FIELD_EXTRACTION_NOT_ALLOWED',
  );

  assert(
    viewer.status ===
      'V9_11_4_1_FIRST_PARTY_CHAIN_EVIDENCE_DECISIVE',
    `VIEWER_STATUS_INVALID:${viewer.status}`,
  );

  const snippets =
    viewer.referenceEvidence
      ?.contextualPriorDateSnippets ?? [];

  const snippetText =
    snippets
      .map((row) => row.snippet ?? '')
      .join('\n');

  assert(
    /첨부/.test(snippetText) &&
    /계약서/.test(snippetText),
    'ATTACHMENT_CORRECTION_EVIDENCE_MISSING',
  );

  let priorFile = null;
  let priorDoc = null;
  let selected = null;
  let allMatches = [];

  for (const file of priorCandidates) {
    if (!fs.existsSync(file)) continue;

    const doc = readJson(file);
    const matches = findTargetRows(doc);

    allMatches.push(
      ...matches.map((row) => ({
        file,
        path: row.path,
        serializedLength:
          row.serializedLength,
        directResultRow:
          directResultRow(row),
      })),
    );

    const direct =
      matches.find(directResultRow);

    if (direct) {
      priorFile = file;
      priorDoc = doc;
      selected = direct;
      break;
    }
  }

  assert(
    selected,
    `PRIOR_VALIDATED_043910_FIELD_ROW_NOT_FOUND:${JSON.stringify(allMatches)}`,
  );

  const previous =
    selected.value;

  const previousIdentity =
    objectIdentity(previous);

  assert(
    previousIdentity.stockCode === TARGET.stockCode,
    'PRIOR_STOCK_MISMATCH',
  );

  assert(
    previousIdentity.actionType === TARGET.actionType,
    'PRIOR_ACTION_MISMATCH',
  );

  assert(
    previousIdentity.providerEventId === TARGET.rootReceiptNo,
    `PRIOR_PROVIDER_ROOT_MISMATCH:${previousIdentity.providerEventId}`,
  );

  assert(
    previous.canonicalPreview &&
    previous.canonicalPreview.stock_code === TARGET.stockCode &&
    previous.canonicalPreview.action_type === TARGET.actionType &&
    previous.canonicalPreview.provider_event_id === TARGET.rootReceiptNo,
    'PRIOR_CANONICAL_PREVIEW_IDENTITY_INVALID',
  );

  // Structural MERGER should not carry generic split/dividend economics.
  assert(
    previous.canonicalPreview.ratio_from == null &&
    previous.canonicalPreview.ratio_to == null &&
    previous.canonicalPreview.cash_amount == null,
    'STRUCTURAL_MERGER_HAS_UNEXPECTED_GENERIC_FACTOR_FIELDS',
  );

  const refreshed =
    deepClone(previous);

  const previousBusinessFieldFingerprint =
    String(
      previous.sourceFingerprint ??
      previous.canonicalPreview?.source_fingerprint ??
      '',
    ) || null;

  // Preserve root identity.
  refreshed.providerEventId =
    TARGET.rootReceiptNo;

  refreshed.rootReceiptNo =
    TARGET.rootReceiptNo;

  // Advance latest valid source lineage.
  refreshed.sourceReceiptNo =
    TARGET.correctionReceiptNo;

  refreshed.sourceReceiptDate =
    TARGET.correctionReceiptDate;

  refreshed.sourceIsCorrection =
    true;

  // Do NOT pretend the short attachment correction is a new full business
  // document. Keep sourceKind compatible with business-field origin, and
  // explicitly describe the correction overlay.
  refreshed.businessFieldSourceReceiptNo =
    TARGET.rootReceiptNo;

  refreshed.latestValidSourceReceiptNo =
    TARGET.correctionReceiptNo;

  refreshed.correctionScope =
    'ATTACHMENT_ONLY';

  refreshed.fieldCarryForward =
    {
      status:
        'BUSINESS_FIELDS_PRESERVED_FROM_PRIOR_VALIDATED_ROOT',

      reason:
        'LATEST_CORRECTION_CHANGES_ATTACHMENT_SIGNING_STATE_NOT_CANONICAL_BUSINESS_FIELDS',

      priorFieldExtractionFile:
        path
          .relative(root, priorFile)
          .replaceAll('\\', '/'),

      priorFieldExtractionPath:
        selected.path,

      businessFieldSourceReceiptNo:
        TARGET.rootReceiptNo,

      latestCorrectionReceiptNo:
        TARGET.correctionReceiptNo,

      previousBusinessFieldFingerprint,

      businessFieldsMutated:
        false,

      canonicalPreviewMutated:
        false,
    };

  // canonicalPreview remains semantically identical to the prior validated
  // V9.9 row. Root provider identity must remain unchanged.
  refreshed.canonicalPreview =
    deepClone(previous.canonicalPreview);

  refreshed.canonicalPreview.provider_event_id =
    TARGET.rootReceiptNo;

  refreshed.incrementalLineage =
    {
      cycleDate:
        '2026-10-06',

      canonicalSourceSelectionVersion:
        canonical.version,

      correctionChainResolutionVersion:
        'V9_11_4_2_043910_READ_ONLY_CORRECTION_CHAIN_RESOLUTION_V2',

      latestValidSourceReceiptNo:
        TARGET.correctionReceiptNo,

      correctionScope:
        'ATTACHMENT_ONLY',

      rootIdentityPreserved:
        true,
    };

  refreshed.lineageFingerprint =
    sha256(
      JSON.stringify({
        providerEventId:
          TARGET.rootReceiptNo,

        previousBusinessFieldFingerprint,

        latestValidSourceReceiptNo:
          TARGET.correctionReceiptNo,

        correctionScope:
          'ATTACHMENT_ONLY',

        businessFieldsMutated:
          false,
      }),
    );

  const parseStatus =
    String(
      refreshed.parseStatus ??
      'STRUCTURAL_FIELDS_READY_FACTOR_BLOCKED',
    );

  const structuralReady =
    /STRUCTURAL|READY|RESOLVED/i
      .test(parseStatus) ||
    refreshed.nextStage
      ?.structuralFactorBlocked === true;

  assert(
    structuralReady,
    `PRIOR_STRUCTURAL_ROW_NOT_READY:${parseStatus}`,
  );

  const report = {
    status:
      'FIELD_EXTRACTION_COMPLETE',

    version:
      VERSION,

    source: {
      canonicalSourceVersion:
        canonical.version,

      priorFieldExtractionFile:
        path
          .relative(root, priorFile)
          .replaceAll('\\', '/'),

      priorFieldExtractionPath:
        selected.path,

      method:
        'VALIDATED_BUSINESS_FIELD_CARRY_FORWARD_WITH_ATTACHMENT_ONLY_SOURCE_ADVANCE',
    },

    counts: {
      activeCanonicalChains:
        1,

      extractedRows:
        1,

      reusedValidatedBusinessFieldRows:
        1,

      reparsedRows:
        0,

      businessFieldsMutated:
        0,

      sourceLineageAdvanced:
        1,

      structuralFieldsReady:
        1,

      structuralFieldsIncomplete:
        0,

      duplicateCanonicalIdentities:
        0,

      reviewQueue:
        0,
    },

    actionTypeCounts: {
      MERGER:
        1,
    },

    parseStatusCounts: {
      [parseStatus]:
        1,
    },

    policy: {
      attachmentOnlyCorrection:
        'PRESERVE_VALIDATED_ROOT_BUSINESS_FIELDS',

      providerEventId:
        'ROOT_RECEIPT_IDENTITY',

      latestValidSource:
        'ADVANCE_TO_20261006000033',

      businessFieldFingerprint:
        'PRESERVE_PRIOR_VALIDATED_FIELD_SOURCE_FINGERPRINT',

      lineageFingerprint:
        'SEPARATE_FROM_BUSINESS_FIELD_SOURCE_FINGERPRINT',

      structuralFactor:
        'BLOCK_GENERIC_FACTOR_FOR_MERGER',

      receiptOrderPairing:
        'FORBIDDEN',
    },

    safety: {
      networkRequests:
        0,

      databaseReads:
        0,

      databaseWrites:
        0,

      productionApplied:
        false,

      canonicalEventsCreated:
        0,

      providerEventIdsPersisted:
        0,

      marketFactorsComputed:
        0,

      coverageWindowAdvanced:
        false,
    },

    repairedRows: [],
    reviewQueue: [],

    results: [
      refreshed,
    ],

    conclusion: {
      rootProviderEventId:
        TARGET.rootReceiptNo,

      latestValidSourceReceiptNo:
        TARGET.correctionReceiptNo,

      businessFieldSourceReceiptNo:
        TARGET.rootReceiptNo,

      attachmentOnlyCorrection:
        true,

      businessFieldsPreserved:
        true,

      canonicalPreviewPreserved:
        true,

      structuralFieldsReady:
        true,

      genericFactorMustRemainBlocked:
        true,

      safeToProceedToEffectiveDateReconfirmation:
        true,

      safeToWriteProductionNow:
        false,
    },

    nextGate:
      'V9_11_7_EFFECTIVE_DATE_RECONFIRMATION',

    outputFile:
      'logs/opendart-corporate-action-field-extraction-v9-11-6.json',
  };

  report.outputFingerprint =
    sha256(
      JSON.stringify({
        version:
          report.version,

        source:
          report.source,

        results:
          report.results,

        conclusion:
          report.conclusion,
      }),
    );

  atomicSaveJson(
    outputFile,
    report,
  );

  console.log(
    JSON.stringify(
      {
        status:
          report.status,

        version:
          report.version,

        counts:
          report.counts,

        row: {
          providerEventId:
            refreshed.providerEventId,

          sourceReceiptNo:
            refreshed.sourceReceiptNo,

          businessFieldSourceReceiptNo:
            refreshed.businessFieldSourceReceiptNo,

          stockCode:
            refreshed.stockCode,

          actionType:
            refreshed.actionType,

          parseStatus:
            refreshed.parseStatus,

          canonicalPreview:
            refreshed.canonicalPreview,

          correctionScope:
            refreshed.correctionScope,

          lineageFingerprint:
            refreshed.lineageFingerprint,
        },

        conclusion:
          report.conclusion,

        networkRequests:
          0,

        databaseWrites:
          0,

        nextGate:
          report.nextGate,

        outputFile:
          report.outputFile,
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
        status:
          'V9_11_6_FIELD_EXTRACTION_FAILED',

        version:
          VERSION,

        error:
          String(error?.message ?? error),

        networkRequests:
          0,

        databaseWrites:
          0,

        productionApplied:
          false,
      },
      null,
      2,
    ),
  );

  process.exitCode = 2;
}
