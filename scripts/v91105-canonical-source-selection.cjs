#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * V9.11.5 - Canonical source selection for 2026-10-06 touched chain
 *
 * READ ONLY / NETWORK 0 / DB 0
 *
 * Target:
 *   043910 / MERGER
 *   canonical root provider_event_id = 20261002000418
 *   latest correction source         = 20261006000033
 *
 * Important:
 * The 2026-10-06 viewer text says the correction is an attachment correction
 * (signed merger-contract attachment). Therefore:
 * - canonical identity stays on the root receipt
 * - latest source receipt advances to the correction
 * - business-field extraction must not overwrite root business fields merely
 *   because the latest attachment-correction body is short
 * - a later field stage may use the root business document plus correction
 *   metadata/attachments unless the correction explicitly changes a field
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_11_5_2026_10_06_CANONICAL_SOURCE_SELECTION';

const TARGET = Object.freeze({
  corpCode: '00418379',
  corpName: '자연과환경',
  stockCode: '043910',
  actionType: 'MERGER',
  rootReceiptNo: '20261002000418',
  correctionReceiptNo: '20261006000033',
});

const EXPECTED_CARRY = new Set([
  '20260619000664|469480|MERGER',
  '20260909000291|001570|SPIN_OFF',
  '20261002000418|043910|MERGER',
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

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

function atomicSaveJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;

  fs.writeFileSync(
    tmp,
    JSON.stringify(value, null, 2) + '\n',
    'utf8',
  );

  fs.renameSync(tmp, file);
}

function sameSet(a, b) {
  return (
    a.size === b.size &&
    [...a].every((x) => b.has(x))
  );
}

function findObjects(value, predicate, parts = [], out = []) {
  if (Array.isArray(value)) {
    value.forEach((v, i) =>
      findObjects(v, predicate, [...parts, i], out),
    );
    return out;
  }

  if (!value || typeof value !== 'object') {
    return out;
  }

  if (predicate(value)) {
    out.push({
      path: parts.join('.'),
      value,
    });
  }

  for (const [key, child] of Object.entries(value)) {
    findObjects(child, predicate, [...parts, key], out);
  }

  return out;
}

function serializedHas(obj, text) {
  try {
    return JSON.stringify(obj).includes(text);
  } catch {
    return false;
  }
}

function main() {
  const root = path.resolve(__dirname, '..');

  const chainFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-chain-resolution-v9-11-4-2.json',
  );

  const viewerFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-043910-viewer-evidence-v9-11-4-1.json',
  );

  const reconFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-workset-carryforward-reconciliation-v9-11-2-1.json',
  );

  const finalVerifyFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-final-post-repair-global-verification.json',
  );

  const priorCanonicalCandidates = [
    path.join(
      root,
      'logs',
      'opendart-corporate-action-canonical-source-selection-v9-9-5-1.json',
    ),
    path.join(
      root,
      'logs',
      'opendart-corporate-action-canonical-source-selection-v9-9-5.json',
    ),
  ];

  const priorCanonicalFile =
    priorCanonicalCandidates.find((file) => fs.existsSync(file));

  const outputFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-canonical-source-selection-v9-11-5.json',
  );

  assert(
    fs.existsSync(chainFile),
    'V9_11_4_2_CHAIN_RESOLUTION_NOT_FOUND',
  );

  assert(
    fs.existsSync(viewerFile),
    'V9_11_4_1_VIEWER_EVIDENCE_NOT_FOUND',
  );

  assert(
    fs.existsSync(reconFile),
    'V9_11_2_1_RECONCILIATION_NOT_FOUND',
  );

  assert(
    fs.existsSync(finalVerifyFile),
    'FINAL_POST_REPAIR_VERIFICATION_NOT_FOUND',
  );

  assert(
    priorCanonicalFile,
    'V9_9_CANONICAL_SOURCE_SELECTION_NOT_FOUND',
  );

  const chain = readJson(chainFile);
  const viewer = readJson(viewerFile);
  const reconciliation = readJson(reconFile);
  const finalVerify = readJson(finalVerifyFile);
  const priorCanonical = readJson(priorCanonicalFile);

  assert(
    chain.status === 'CORRECTION_CHAIN_RESOLUTION_COMPLETE',
    `CHAIN_STATUS_INVALID:${chain.status}`,
  );

  assert(
    chain.conclusion?.correctionChainResolved === true,
    'CHAIN_NOT_RESOLVED',
  );

  assert(
    chain.conclusion?.rootReceiptNo === TARGET.rootReceiptNo,
    `CHAIN_ROOT_MISMATCH:${chain.conclusion?.rootReceiptNo}`,
  );

  assert(
    chain.conclusion?.sourceReceiptNo === TARGET.correctionReceiptNo,
    `CHAIN_SOURCE_MISMATCH:${chain.conclusion?.sourceReceiptNo}`,
  );

  assert(
    chain.conclusion?.confidence === 'HIGH',
    `CHAIN_CONFIDENCE_INVALID:${chain.conclusion?.confidence}`,
  );

  assert(
    chain.conclusion?.canonicalProviderIdentityShouldRemainRoot === true,
    'ROOT_IDENTITY_PRESERVATION_NOT_PROVEN',
  );

  assert(
    chain.conclusion?.canonicalSourceShouldAdvanceToLatestCorrection === true,
    'LATEST_SOURCE_ADVANCE_NOT_PROVEN',
  );

  assert(
    viewer.status ===
      'V9_11_4_1_FIRST_PARTY_CHAIN_EVIDENCE_DECISIVE',
    `VIEWER_STATUS_INVALID:${viewer.status}`,
  );

  const snippets =
    viewer.referenceEvidence?.contextualPriorDateSnippets ?? [];

  const combinedSnippetText =
    snippets
      .map((row) => row.snippet ?? '')
      .join('\n');

  const attachmentCorrectionProven =
    /첨부/.test(combinedSnippetText) &&
    /계약서/.test(combinedSnippetText) &&
    (
      /날인본/.test(combinedSnippetText) ||
      /날인 전/.test(combinedSnippetText) ||
      /날인 후/.test(combinedSnippetText)
    );

  assert(
    attachmentCorrectionProven,
    'ATTACHMENT_ONLY_CORRECTION_NOT_PROVEN_BY_VIEWER_TEXT',
  );

  const carryIdentities =
    finalVerify.finalCarryForward?.identities ?? [];

  assert(
    Array.isArray(carryIdentities),
    'FINAL_CARRY_IDENTITIES_MISSING',
  );

  assert(
    sameSet(
      new Set(carryIdentities),
      EXPECTED_CARRY,
    ),
    `FINAL_CARRY_SET_MISMATCH:${JSON.stringify(carryIdentities)}`,
  );

  const priorMatches =
    findObjects(
      priorCanonical,
      (obj) =>
        serializedHas(obj, TARGET.stockCode) &&
        serializedHas(obj, TARGET.rootReceiptNo),
    );

  assert(
    priorMatches.length > 0,
    'PRIOR_V9_9_CANONICAL_043910_ROOT_NOT_FOUND',
  );

  // Prefer the most compact object that still contains both root + stock;
  // this usually lands on the actual active-chain row rather than the whole report.
  const rankedPriorMatches =
    priorMatches
      .map((row) => ({
        ...row,
        serializedLength:
          JSON.stringify(row.value).length,
      }))
      .sort(
        (a, b) =>
          a.serializedLength - b.serializedLength,
      );

  const priorCanonicalAnchor =
    rankedPriorMatches[0];

  const rootKey =
    `${TARGET.rootReceiptNo}|${TARGET.stockCode}|${TARGET.actionType}`;

  const canonicalRow = {
    canonicalKey:
      rootKey,

    providerEventId:
      TARGET.rootReceiptNo,

    rootReceiptNo:
      TARGET.rootReceiptNo,

    latestValidSourceReceiptNo:
      TARGET.correctionReceiptNo,

    sourceReceiptNo:
      TARGET.correctionReceiptNo,

    corpCode:
      TARGET.corpCode,

    corpName:
      TARGET.corpName,

    stockCode:
      TARGET.stockCode,

    actionType:
      TARGET.actionType,

    chainStatus:
      'ACTIVE',

    resolutionStatus:
      'RESOLVED',

    resolutionConfidence:
      'HIGH',

    resolutionReason:
      chain.rows?.[0]?.resolutionReason ??
      'DART_VIEWER_REFERENCE_DATE_UNIQUE_PRIOR_CARRY_ROOT',

    sourceSelectionReason:
      'ROOT_IDENTITY_PRESERVED_LATEST_VALID_ATTACHMENT_CORRECTION_SELECTED',

    correctionScope:
      'ATTACHMENT_ONLY',

    canonicalIdentityPolicy:
      'ROOT_RECEIPT',

    latestSourcePolicy:
      'LATEST_VALID_CHAIN_DOCUMENT',

    fieldExtractionPolicy: {
      businessFieldBaseReceiptNo:
        TARGET.rootReceiptNo,

      latestCorrectionReceiptNo:
        TARGET.correctionReceiptNo,

      preserveRootBusinessFieldsUnlessCorrectionExplicitlyChangesField:
        true,

      doNotTreatShortAttachmentCorrectionBodyAsFullBusinessReplacement:
        true,

      mergeCorrectionMetadata:
        true,
    },

    chainDocuments: [
      {
        receiptNo:
          TARGET.rootReceiptNo,

        role:
          'ROOT_BUSINESS_DOCUMENT',

        receiptDate:
          '20261002',
      },
      {
        receiptNo:
          TARGET.correctionReceiptNo,

        role:
          'LATEST_VALID_ATTACHMENT_CORRECTION',

        receiptDate:
          '20261006',
      },
    ],

    priorCanonicalAnchor: {
      sourceFile:
        path.relative(root, priorCanonicalFile).replaceAll('\\', '/'),

      path:
        priorCanonicalAnchor.path,

      serializedLength:
        priorCanonicalAnchor.serializedLength,

      snapshot:
        priorCanonicalAnchor.value,
    },

    evidence: {
      chainResolutionFile:
        'logs/opendart-corporate-action-chain-resolution-v9-11-4-2.json',

      viewerEvidenceFile:
        'logs/opendart-corporate-action-043910-viewer-evidence-v9-11-4-1.json',

      viewerContextualPriorDateMention:
        viewer.referenceEvidence?.contextualPriorDateMention === true,

      attachmentCorrectionProven,
    },
  };

  const report = {
    status:
      'CANONICAL_SOURCE_SELECTION_READY',

    version:
      VERSION,

    source: {
      cycleDate:
        '2026-10-06',

      touchedChainCount:
        1,

      priorCanonicalSourceFile:
        path.relative(root, priorCanonicalFile).replaceAll('\\', '/'),
    },

    counts: {
      sourceTouchedChains:
        1,

      activeCanonicalChains:
        1,

      newCanonicalRoots:
        0,

      existingRootsPreserved:
        1,

      latestSourcesAdvanced:
        1,

      suppressedChains:
        0,

      quarantinedChains:
        0,

      unresolvedChains:
        0,

      carryForwardTotal:
        3,

      carryForwardTouched:
        1,

      carryForwardUntouched:
        2,
    },

    activeActionTypeCounts: {
      MERGER:
        1,
    },

    activeChains: [
      canonicalRow,
    ],

    carryForward: {
      identities:
        carryIdentities,

      touchedIdentity:
        rootKey,

      untouchedIdentities:
        carryIdentities.filter(
          (key) => key !== rootKey,
        ),

      allPriorCarryPreserved:
        true,
    },

    suppressedChains: [],
    quarantineDocuments: [],
    blockingRows: [],
    remainingUnaccountedReceipts: [],
    conflictedChains: [],

    policy: {
      providerEventId:
        'ORIGINAL_ROOT_RECEIPT',

      eventValues:
        'ROOT_BUSINESS_FIELDS_PLUS_EXPLICIT_LATEST_CORRECTION_CHANGES',

      attachmentOnlyCorrection:
        'ADVANCE_SOURCE_METADATA_WITHOUT_BLINDLY_REPLACING_ROOT_BUSINESS_FIELDS',

      unresolvedCorrection:
        'QUARANTINE_NEVER_GUESS',

      structuralAction:
        'MERGER_REMAINS_STRUCTURAL_NOT_GENERIC_FACTOR_EVENT',

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

      factorMutation:
        false,

      coverageWindowAdvanced:
        false,
    },

    conclusion: {
      canonicalRootIdentity:
        TARGET.rootReceiptNo,

      latestValidSourceReceiptNo:
        TARGET.correctionReceiptNo,

      rootIdentityPreserved:
        true,

      sourceAdvanced:
        true,

      correctionScope:
        'ATTACHMENT_ONLY',

      priorThreeCarryForwardPreserved:
        true,

      safeToProceedToFieldExtraction:
        true,

      safeToWriteProductionNow:
        false,
    },

    nextGate:
      'V9_11_6_FIELD_EXTRACTION',

    outputFile:
      'logs/opendart-corporate-action-canonical-source-selection-v9-11-5.json',
  };

  report.outputFingerprint =
    sha256(
      JSON.stringify({
        version:
          report.version,

        activeChains:
          report.activeChains,

        carryForward:
          report.carryForward,

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

        canonical: {
          providerEventId:
            canonicalRow.providerEventId,

          sourceReceiptNo:
            canonicalRow.sourceReceiptNo,

          stockCode:
            canonicalRow.stockCode,

          actionType:
            canonicalRow.actionType,

          correctionScope:
            canonicalRow.correctionScope,

          businessFieldBaseReceiptNo:
            canonicalRow.fieldExtractionPolicy
              .businessFieldBaseReceiptNo,
        },

        carryForward:
          report.carryForward,

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
          'V9_11_5_CANONICAL_SOURCE_SELECTION_FAILED',

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
