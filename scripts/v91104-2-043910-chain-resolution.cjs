#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * V9.11.4.2 - 043910 read-only correction-chain resolution
 *
 * READ ONLY.
 * NETWORK 0.
 * DB reads/writes 0.
 * No canonical persistence.
 *
 * Resolution basis:
 * - correction receipt: 20261006000033
 * - DART public viewer explicitly states first filing date = 2026-10-02
 * - prior carry-forward has exactly one 043910 MERGER root on that date:
 *   20261002000418
 * - receipt-order pairing is NOT used
 * - carry match alone is NOT used
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_11_4_2_043910_READ_ONLY_CORRECTION_CHAIN_RESOLUTION';

const TARGET = Object.freeze({
  corpCode: '00418379',
  stockCode: '043910',
  actionType: 'MERGER',
  correctionReceiptNo: '20261006000033',
  correctionDate: '20261006',
  rootReceiptNo: '20261002000418',
  rootReceiptDate: '20261002',
});

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

  const tmp =
    `${file}.tmp-${process.pid}-${Date.now()}`;

  fs.writeFileSync(
    tmp,
    JSON.stringify(value, null, 2) + '\n',
    'utf8',
  );

  fs.renameSync(tmp, file);
}

function main() {
  const root =
    path.resolve(__dirname, '..');

  const viewerFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-043910-viewer-evidence-v9-11-4-1.json',
    );

  const reconFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-workset-carryforward-reconciliation-v9-11-2-1.json',
    );

  const dispositionFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-detail-evidence-v9-11-3-1.json',
    );

  const outputFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-chain-resolution-v9-11-4-2.json',
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
    fs.existsSync(dispositionFile),
    'V9_11_3_1_DISPOSITION_NOT_FOUND',
  );

  const viewer =
    readJson(viewerFile);

  const reconciliation =
    readJson(reconFile);

  const disposition =
    readJson(dispositionFile);

  assert(
    viewer.status ===
      'V9_11_4_1_FIRST_PARTY_CHAIN_EVIDENCE_DECISIVE',
    `VIEWER_STATUS_INVALID:${viewer.status}`,
  );

  assert(
    viewer.version ===
      'V9_11_4_1_043910_DART_VIEWER_FIRST_PARTY_EVIDENCE_PROBE',
    `VIEWER_VERSION_INVALID:${viewer.version}`,
  );

  assert(
    viewer.decision
      ?.safeToResolveChain === true,
    'VIEWER_NOT_SAFE_TO_RESOLVE_CHAIN',
  );

  assert(
    viewer.decision
      ?.suggestedConfidence === 'HIGH',
    `EXPECTED_HIGH_CONFIDENCE_GOT_${viewer.decision?.suggestedConfidence}`,
  );

  assert(
    viewer.decision
      ?.rootReceiptNo === TARGET.rootReceiptNo,
    `ROOT_RECEIPT_MISMATCH:${viewer.decision?.rootReceiptNo}`,
  );

  assert(
    viewer.decision
      ?.resolutionReason ===
      'DART_VIEWER_REFERENCE_DATE_UNIQUE_PRIOR_CARRY_ROOT',
    `RESOLUTION_REASON_INVALID:${viewer.decision?.resolutionReason}`,
  );

  assert(
    viewer.referenceEvidence
      ?.contextualPriorDateMention === true,
    'CONTEXTUAL_PRIOR_DATE_REFERENCE_REQUIRED',
  );

  assert(
    viewer.decision
      ?.receiptOrderPairingUsed === false,
    'RECEIPT_ORDER_PAIRING_MUST_NOT_BE_USED',
  );

  assert(
    viewer.decision
      ?.carryMatchAloneUsed === false,
    'CARRY_MATCH_ALONE_MUST_NOT_BE_USED',
  );

  assert(
    reconciliation.status ===
      'WORKSET_CARRY_FORWARD_RECONCILIATION_READY',
    `RECONCILIATION_STATUS_INVALID:${reconciliation.status}`,
  );

  assert(
    reconciliation.overlapAnalysis
      ?.stockActionMatches
      ?.includes(
        `${TARGET.rootReceiptNo}|${TARGET.stockCode}|${TARGET.actionType}`,
      ) === true,
    'EXACT_PRIOR_CARRY_ROOT_NOT_PRESENT',
  );

  assert(
    reconciliation.overlapAnalysis
      ?.stockActionMatches
      ?.length === 1,
    'PRIOR_CARRY_ROOT_NOT_UNIQUE',
  );

  assert(
    disposition.status ===
      'PROVIDER_014_DISPOSITION_COMPLETE',
    `DISPOSITION_STATUS_INVALID:${disposition.status}`,
  );

  assert(
    disposition.provider014NeedsChainResolution === 1,
    `EXPECTED_1_CHAIN_RESOLUTION_ROW_GOT_${disposition.provider014NeedsChainResolution}`,
  );

  assert(
    disposition.chainResolutionQueue?.length === 1,
    `EXPECTED_1_CHAIN_QUEUE_ROW_GOT_${disposition.chainResolutionQueue?.length ?? 'MISSING'}`,
  );

  const resolution = {
    workId:
      reconciliation.newCandidate?.workId ??
      null,

    receiptNo:
      TARGET.correctionReceiptNo,

    receiptDate:
      TARGET.correctionDate,

    corpCode:
      TARGET.corpCode,

    corpName:
      reconciliation.newCandidate?.corpName ??
      '자연과환경',

    stockCode:
      TARGET.stockCode,

    actionType:
      TARGET.actionType,

    gate:
      'CORRECTION_REQUIRES_CHAIN_LOOKUP',

    correction:
      true,

    withdrawal:
      false,

    resolutionStatus:
      'RESOLVED',

    resolutionReason:
      'DART_VIEWER_REFERENCE_DATE_UNIQUE_PRIOR_CARRY_ROOT',

    rootReceiptNo:
      TARGET.rootReceiptNo,

    rootReceiptDate:
      TARGET.rootReceiptDate,

    confidence:
      'HIGH',

    evidence: {
      source:
        'DART_PUBLIC_VIEWER_FIRST_PARTY',

      targetViewerStatus:
        viewer.viewer?.correction?.status ??
        null,

      priorViewerStatus:
        viewer.viewer?.prior?.status ??
        null,

      contextualPriorDateMention:
        viewer.referenceEvidence
          ?.contextualPriorDateMention === true,

      explicitPriorReceipt:
        viewer.referenceEvidence
          ?.explicitPriorReceipt === true,

      referencedDate:
        '2026-10-02',

      exactPriorCarryRoot:
        `${TARGET.rootReceiptNo}|${TARGET.stockCode}|${TARGET.actionType}`,

      uniquePriorCarryRoot:
        true,

      similaritySupportive:
        viewer.similarity?.supportive === true,

      similarityScore:
        viewer.similarity?.score ??
        null,

      receiptOrderPairingUsed:
        false,

      carryMatchAloneUsed:
        false,
    },
  };

  const report = {
    status:
      'CORRECTION_CHAIN_RESOLUTION_COMPLETE',

    version:
      VERSION,

    counts: {
      chainTargets:
        1,

      resolved:
        1,

      ambiguous:
        0,

      unresolved:
        0,

      highConfidence:
        1,

      mediumConfidence:
        0,

      lowConfidence:
        0,

      correctionTargets:
        1,

      correctionResolved:
        1,

      withdrawalTargets:
        0,

      withdrawalResolved:
        0,
    },

    resolutionReasonCounts: {
      DART_VIEWER_REFERENCE_DATE_UNIQUE_PRIOR_CARRY_ROOT:
        1,
    },

    confidenceCounts: {
      HIGH:
        1,

      MEDIUM:
        0,

      LOW:
        0,

      NONE:
        0,
    },

    rows: [
      resolution,
    ],

    carryForwardImpact: {
      touchedCarryForward:
        `${TARGET.rootReceiptNo}|${TARGET.stockCode}|${TARGET.actionType}`,

      priorCarryForwardCount:
        3,

      touchedCount:
        1,

      untouchedCount:
        2,

      correctionCreatesNewRoot:
        false,

      rootIdentityPreserved:
        true,

      latestValidSourceReceiptNo:
        TARGET.correctionReceiptNo,
    },

    policy: {
      correctionCanonicalIdentity:
        'ROOT_RECEIPT_IDENTITY',

      latestValidCorrectionDocument:
        'SOURCE_DOCUMENT_ONLY',

      receiptOrderPairing:
        'FORBIDDEN',

      failClosed:
        true,
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
      correctionChainResolved:
        true,

      rootReceiptNo:
        TARGET.rootReceiptNo,

      sourceReceiptNo:
        TARGET.correctionReceiptNo,

      confidence:
        'HIGH',

      canonicalProviderIdentityShouldRemainRoot:
        true,

      canonicalSourceShouldAdvanceToLatestCorrection:
        true,

      safeToProceedToCanonicalSourceSelection:
        true,

      safeToWriteProductionNow:
        false,
    },

    nextGate:
      'V9_11_5_CANONICAL_SOURCE_SELECTION',

    outputFile:
      'logs/opendart-corporate-action-chain-resolution-v9-11-4-2.json',
  };

  report.outputFingerprint =
    sha256(
      JSON.stringify({
        version:
          report.version,

        rows:
          report.rows,

        carryForwardImpact:
          report.carryForwardImpact,

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

        resolved: {
          receiptNo:
            resolution.receiptNo,

          rootReceiptNo:
            resolution.rootReceiptNo,

          stockCode:
            resolution.stockCode,

          actionType:
            resolution.actionType,

          confidence:
            resolution.confidence,

          reason:
            resolution.resolutionReason,
        },

        carryForwardImpact:
          report.carryForwardImpact,

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
          'V9_11_4_2_CHAIN_RESOLUTION_FAILED',

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
