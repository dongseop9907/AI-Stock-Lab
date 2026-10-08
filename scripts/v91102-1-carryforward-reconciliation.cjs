#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * V9.11.2.1 - 2026-10-06 workset / carry-forward reconciliation
 *
 * READ ONLY.
 * No network.
 * No DB reads.
 * No DB writes.
 *
 * Inputs:
 *   logs/opendart-corporate-action-detail-workset-v9-11-2.json
 *   logs/opendart-corporate-action-final-post-repair-global-verification.json
 *
 * Purpose:
 *   - preserve the 3 authoritative future structural carry-forward rows
 *   - inspect the single 2026-10-06 correction MERGER candidate
 *   - compare exact provider/receipt identity
 *   - compare stockCode + actionType identity
 *   - decide whether this is:
 *       A) correction/reconfirmation touching existing carry-forward
 *       B) a new correction chain unrelated to carry-forward
 *
 * This stage does NOT resolve the correction chain itself.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_11_2_1_INCREMENTAL_WORKSET_CARRY_FORWARD_RECONCILIATION';

const EXPECTED_WORKSET_VERSION =
  'V9_11_2_INCREMENTAL_CORPORATE_ACTION_DETAIL_WORKSET';

const EXPECTED_FINAL_VERIFY_STATUS =
  'FINAL_POST_REPAIR_GLOBAL_VERIFICATION_COMPLETE';

const EXPECTED_CARRY = new Set([
  '20260619000664|469480|MERGER',
  '20260909000291|001570|SPIN_OFF',
  '20261002000418|043910|MERGER',
]);

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''),
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
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

function normalizeReceipt(value) {
  const s = String(value ?? '').trim();
  return /^\d{14}$/.test(s) ? s : '';
}

function normalizeStock(value) {
  const s = String(value ?? '').trim();
  return s ? s.padStart(6, '0') : '';
}

function normalizeAction(value) {
  return String(value ?? '').trim().toUpperCase();
}

function parseCarryKey(key) {
  const [providerEventId, stockCode, actionType] =
    String(key ?? '').split('|');

  if (
    !normalizeReceipt(providerEventId) ||
    !normalizeStock(stockCode) ||
    !normalizeAction(actionType)
  ) {
    return null;
  }

  return {
    providerEventId:
      normalizeReceipt(providerEventId),

    stockCode:
      normalizeStock(stockCode),

    actionType:
      normalizeAction(actionType),

    key:
      [
        normalizeReceipt(providerEventId),
        normalizeStock(stockCode),
        normalizeAction(actionType),
      ].join('|'),
  };
}

function candidateIdentity(row) {
  return {
    workId:
      row?.workId ?? null,

    corpCode:
      row?.corpCode ?? null,

    corpName:
      row?.corpName ?? null,

    stockCode:
      normalizeStock(row?.stockCode),

    market:
      row?.market ?? null,

    receiptNo:
      normalizeReceipt(row?.receiptNo),

    receiptDate:
      row?.receiptDate ?? null,

    reportName:
      row?.reportName ?? null,

    actionType:
      normalizeAction(row?.actionType),

    correction:
      row?.correction === true,

    withdrawal:
      row?.withdrawal === true,

    gate:
      row?.gate ?? null,

    reason:
      row?.reason ?? null,

    autoDetailFetch:
      row?.autoDetailFetch === true,

    needsChainLookup:
      row?.needsChainLookup === true,

    canBecomeProductionEvent:
      row?.canBecomeProductionEvent === true,
  };
}

function sameSet(a, b) {
  return (
    a.size === b.size &&
    [...a].every((x) => b.has(x))
  );
}

function main() {
  const root =
    path.resolve(__dirname, '..');

  const worksetFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-detail-workset-v9-11-2.json',
    );

  const finalVerifyFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-final-post-repair-global-verification.json',
    );

  const outputFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-workset-carryforward-reconciliation-v9-11-2-1.json',
    );

  assert(
    fs.existsSync(worksetFile),
    'V9_11_2_WORKSET_NOT_FOUND',
  );

  assert(
    fs.existsSync(finalVerifyFile),
    'FINAL_POST_REPAIR_VERIFICATION_NOT_FOUND',
  );

  const workset =
    readJson(worksetFile);

  const finalVerify =
    readJson(finalVerifyFile);

  assert(
    workset.status ===
      'DETAIL_WORKSET_READY',
    `WORKSET_STATUS_INVALID:${workset.status}`,
  );

  assert(
    workset.version ===
      EXPECTED_WORKSET_VERSION,
    `WORKSET_VERSION_INVALID:${workset.version}`,
  );

  assert(
    finalVerify.status ===
      EXPECTED_FINAL_VERIFY_STATUS,
    `FINAL_VERIFY_STATUS_INVALID:${finalVerify.status}`,
  );

  assert(
    finalVerify.conclusion
      ?.readyToCloseRepairIncident ===
      true,
    'REPAIR_INCIDENT_NOT_CLOSED',
  );

  const chainRows =
    Array.isArray(
      workset.chainLookupQueue,
    )
      ? workset.chainLookupQueue
      : [];

  const detailRows =
    Array.isArray(
      workset.detailFetchQueue,
    )
      ? workset.detailFetchQueue
      : [];

  assert(
    chainRows.length === 1,
    `EXPECTED_1_CHAIN_LOOKUP_ROW_GOT_${chainRows.length}`,
  );

  assert(
    detailRows.length === 1,
    `EXPECTED_1_DETAIL_FETCH_ROW_GOT_${detailRows.length}`,
  );

  const candidate =
    candidateIdentity(
      chainRows[0],
    );

  assert(
    candidate.stockCode,
    'CANDIDATE_STOCK_CODE_MISSING',
  );

  assert(
    candidate.receiptNo,
    'CANDIDATE_RECEIPT_NO_MISSING',
  );

  assert(
    candidate.actionType ===
      'MERGER',
    `EXPECTED_MERGER_GOT_${candidate.actionType}`,
  );

  assert(
    candidate.correction === true,
    'EXPECTED_CORRECTION_TRUE',
  );

  assert(
    candidate.withdrawal === false,
    'UNEXPECTED_WITHDRAWAL',
  );

  assert(
    candidate.needsChainLookup === true,
    'CHAIN_LOOKUP_FLAG_REQUIRED',
  );

  assert(
    candidate.canBecomeProductionEvent ===
      false,
    'CORRECTION_MUST_NOT_BE_STANDALONE_PRODUCTION_EVENT',
  );

  const finalCarryKeys =
    Array.isArray(
      finalVerify.finalCarryForward
        ?.identities,
    )
      ? finalVerify.finalCarryForward
          .identities
      : [];

  const finalCarrySet =
    new Set(finalCarryKeys);

  assert(
    sameSet(
      finalCarrySet,
      EXPECTED_CARRY,
    ),
    `FINAL_CARRY_FORWARD_MISMATCH:${JSON.stringify(finalCarryKeys)}`,
  );

  const carryRows =
    finalCarryKeys
      .map(parseCarryKey)
      .filter(Boolean);

  const exactProviderMatches =
    carryRows.filter(
      (row) =>
        row.providerEventId ===
        candidate.receiptNo,
    );

  const stockActionMatches =
    carryRows.filter(
      (row) =>
        row.stockCode ===
          candidate.stockCode &&
        row.actionType ===
          candidate.actionType,
    );

  const sameStockAnyAction =
    carryRows.filter(
      (row) =>
        row.stockCode ===
        candidate.stockCode,
    );

  const touchedCarryForward =
    stockActionMatches.length > 0;

  const classification =
    touchedCarryForward
      ? 'POSSIBLE_CARRY_FORWARD_CORRECTION_OR_RECONFIRMATION'
      : 'NEW_CORRECTION_CHAIN_NOT_MATCHED_TO_CURRENT_CARRY_FORWARD';

  const issues = [];

  if (
    exactProviderMatches.length > 1
  ) {
    issues.push({
      check:
        'multipleExactProviderMatches',

      actual:
        exactProviderMatches.map(
          (x) => x.key,
        ),
    });
  }

  if (
    stockActionMatches.length > 1
  ) {
    issues.push({
      check:
        'multipleStockActionCarryMatches',

      actual:
        stockActionMatches.map(
          (x) => x.key,
        ),
    });
  }

  if (
    candidate.gate !==
    'CORRECTION_REQUIRES_CHAIN_LOOKUP'
  ) {
    issues.push({
      check:
        'candidateGate',

      actual:
        candidate.gate,

      expected:
        'CORRECTION_REQUIRES_CHAIN_LOOKUP',
    });
  }

  const status =
    issues.length === 0
      ? 'WORKSET_CARRY_FORWARD_RECONCILIATION_READY'
      : 'WORKSET_CARRY_FORWARD_RECONCILIATION_BLOCKED';

  const report = {
    status,
    version: VERSION,

    source: {
      worksetVersion:
        workset.version,

      worksetStatus:
        workset.status,

      startDate:
        workset.source?.startDate ??
        '2026-10-06',

      throughDate:
        workset.source?.throughDate ??
        '2026-10-06',

      sourceCandidates:
        workset.counts
          ?.sourceCandidates ??
        1,

      chainLookupQueue:
        chainRows.length,

      detailFetchQueue:
        detailRows.length,
    },

    priorCarryForward: {
      source:
        'FINAL_POST_REPAIR_GLOBAL_VERIFICATION',

      count:
        carryRows.length,

      identities:
        carryRows.map(
          (row) => row.key,
        ),
    },

    newCandidate:
      candidate,

    overlapAnalysis: {
      exactProviderReceiptMatches:
        exactProviderMatches.map(
          (row) => row.key,
        ),

      stockActionMatches:
        stockActionMatches.map(
          (row) => row.key,
        ),

      sameStockAnyActionMatches:
        sameStockAnyAction.map(
          (row) => row.key,
        ),

      touchedCarryForward,

      classification,
    },

    accounting: {
      priorCarryForward:
        carryRows.length,

      newSourceCandidates:
        1,

      newInContractCandidates:
        1,

      standaloneProductionCandidates:
        0,

      correctionChainCandidates:
        1,

      touchedCarryForward:
        touchedCarryForward
          ? 1
          : 0,

      untouchedCarryForward:
        touchedCarryForward
          ? carryRows.length - 1
          : carryRows.length,

      totalCarryForwardPreserved:
        carryRows.length,
    },

    issues,

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

      factorMutation:
        false,

      coverageWindowAdvanced:
        false,
    },

    conclusion: {
      priorThreeCarryForwardPreserved:
        carryRows.length === 3,

      correctionCandidateRequiresChainResolution:
        true,

      candidateTouchesExistingCarryForward:
        touchedCarryForward,

      safeToFetchDetailEvidence:
        issues.length === 0,

      safeToAssignCanonicalProviderIdentity:
        false,

      safeToWriteProduction:
        false,
    },

    nextGate:
      issues.length !== 0
        ? 'STOP_AND_REVIEW'
        : touchedCarryForward
          ? 'FETCH_DETAIL_AND_RESOLVE_CORRECTION_AGAINST_MATCHED_CARRY_FORWARD'
          : 'FETCH_DETAIL_AND_RESOLVE_NEW_CORRECTION_CHAIN',

    outputFile:
      'logs/opendart-corporate-action-workset-carryforward-reconciliation-v9-11-2-1.json',
  };

  report.outputFingerprint =
    sha256(
      JSON.stringify({
        version:
          report.version,

        source:
          report.source,

        priorCarryForward:
          report.priorCarryForward,

        newCandidate:
          report.newCandidate,

        overlapAnalysis:
          report.overlapAnalysis,

        accounting:
          report.accounting,

        issues:
          report.issues,
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

        newCandidate:
          report.newCandidate,

        priorCarryForward:
          report.priorCarryForward,

        overlapAnalysis:
          report.overlapAnalysis,

        accounting:
          report.accounting,

        issues:
          report.issues,

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

  if (issues.length > 0) {
    process.exitCode = 2;
  }
}

try {
  main();
} catch (error) {
  console.error(
    JSON.stringify(
      {
        status:
          'V9_11_2_1_RECONCILIATION_FAILED',

        version:
          VERSION,

        error:
          String(
            error?.message ??
            error,
          ),

        networkRequests:
          0,

        databaseWrites:
          0,
      },
      null,
      2,
    ),
  );

  process.exitCode = 2;
}
