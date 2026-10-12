#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * V9.11.9 - 2026-10-06 corporate-action incremental cycle closure
 *
 * READ ONLY / NETWORK 0 / KIS 0 / DB 0
 *
 * Closure contract:
 * - source inventory candidates: 1
 * - correction MERGER resolved to existing root:
 *     root   = 20261002000418 / 043910 / MERGER
 *     source = 20261006000033
 * - new canonical roots: 0
 * - production persistence required now: 0
 * - generic factor rows: 0
 * - future structural carry-forward remains exactly 3:
 *     20260619000664|469480|MERGER   effective 2026-12-14
 *     20260909000291|001570|SPIN_OFF effective 2026-12-05
 *     20261002000418|043910|MERGER   effective 2026-12-31
 *
 * This stage DOES NOT advance any external/global coverage marker.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_11_9_2026_10_06_INCREMENTAL_CORPORATE_ACTION_CYCLE_CLOSURE';

const SNAPSHOT_AS_OF =
  '2026-10-06';

const EXPECTED_CARRY = [
  {
    providerEventId: '20260619000664',
    stockCode: '469480',
    actionType: 'MERGER',
    effectiveDate: '2026-12-14',
  },
  {
    providerEventId: '20260909000291',
    stockCode: '001570',
    actionType: 'SPIN_OFF',
    effectiveDate: '2026-12-05',
  },
  {
    providerEventId: '20261002000418',
    stockCode: '043910',
    actionType: 'MERGER',
    effectiveDate: '2026-12-31',
  },
];

const TOUCHED = Object.freeze({
  providerEventId: '20261002000418',
  stockCode: '043910',
  actionType: 'MERGER',
  sourceReceiptNo: '20261006000033',
  effectiveDate: '2026-12-31',
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

function carryKey(row) {
  return [
    String(row.providerEventId ?? ''),
    String(row.stockCode ?? '').padStart(6, '0'),
    String(row.actionType ?? '').toUpperCase(),
  ].join('|');
}

function sameSet(a, b) {
  return (
    a.size === b.size &&
    [...a].every((x) => b.has(x))
  );
}

function main() {
  const root = path.resolve(__dirname, '..');

  const files = {
    inventory:
      'logs/opendart-corporate-action-incremental-v9-11-1.json',

    workset:
      'logs/opendart-corporate-action-detail-workset-v9-11-2.json',

    reconciliation:
      'logs/opendart-corporate-action-workset-carryforward-reconciliation-v9-11-2-1.json',

    evidence:
      'logs/opendart-corporate-action-detail-evidence-v9-11-3.json',

    disposition:
      'logs/opendart-corporate-action-detail-evidence-v9-11-3-1.json',

    chain:
      'logs/opendart-corporate-action-chain-resolution-v9-11-4-2.json',

    canonical:
      'logs/opendart-corporate-action-canonical-source-selection-v9-11-5.json',

    fields:
      'logs/opendart-corporate-action-field-extraction-v9-11-6.json',

    effective:
      'logs/opendart-corporate-action-effective-date-reconfirmation-v9-11-7.json',

    factor:
      'logs/opendart-corporate-action-factor-validation-v9-11-8.json',

    previousClosure:
      'logs/opendart-corporate-action-cycle-closure-v9-10-3-common-stock-scope.json',
  };

  const docs = {};

  for (const [name, rel] of Object.entries(files)) {
    const abs = path.join(root, rel);

    assert(
      fs.existsSync(abs),
      `REQUIRED_ARTIFACT_MISSING:${name}:${rel}`,
    );

    docs[name] = readJson(abs);
  }

  const inv = docs.inventory;
  const workset = docs.workset;
  const recon = docs.reconciliation;
  const evidence = docs.evidence;
  const disposition = docs.disposition;
  const chain = docs.chain;
  const canonical = docs.canonical;
  const fields = docs.fields;
  const effective = docs.effective;
  const factor = docs.factor;
  const previousClosure = docs.previousClosure;

  // -------------------------------------------------------------------------
  // Inventory / workset accounting
  // -------------------------------------------------------------------------

  assert(
    inv.status === 'INCREMENTAL_INVENTORY_COMPLETE',
    `INVENTORY_STATUS_INVALID:${inv.status}`,
  );

  assert(
    inv.version ===
      'V9_11_1_INCREMENTAL_OPENDART_CORPORATE_ACTION_INVENTORY',
    `INVENTORY_VERSION_INVALID:${inv.version}`,
  );

  assert(
    inv.startDate === SNAPSHOT_AS_OF &&
    inv.throughDate === SNAPSHOT_AS_OF,
    `INVENTORY_DATE_INVALID:${inv.startDate}:${inv.throughDate}`,
  );

  assert(
    Number(inv.candidates?.length ?? inv.candidates ?? 1) === 1 ||
    Number(inv.summary?.candidates ?? 1) === 1,
    'EXPECTED_ONE_SOURCE_CANDIDATE',
  );

  assert(
    Number(inv.candidateCounts?.MERGER ?? 0) === 1,
    `EXPECTED_ONE_MERGER_GOT_${inv.candidateCounts?.MERGER}`,
  );

  assert(
    Number(inv.correctionOrWithdrawalCandidates ?? 0) === 1,
    'EXPECTED_ONE_CORRECTION_OR_WITHDRAWAL_CANDIDATE',
  );

  assert(
    workset.status === 'DETAIL_WORKSET_READY',
    `WORKSET_STATUS_INVALID:${workset.status}`,
  );

  assert(
    workset.version ===
      'V9_11_2_INCREMENTAL_CORPORATE_ACTION_DETAIL_WORKSET',
    `WORKSET_VERSION_INVALID:${workset.version}`,
  );

  const chainQueue =
    Array.isArray(workset.chainLookupQueue)
      ? workset.chainLookupQueue
      : [];

  assert(
    chainQueue.length === 1,
    `EXPECTED_ONE_CHAIN_LOOKUP_ROW_GOT_${chainQueue.length}`,
  );

  // -------------------------------------------------------------------------
  // Reconciliation / chain resolution
  // -------------------------------------------------------------------------

  assert(
    recon.status ===
      'WORKSET_CARRY_FORWARD_RECONCILIATION_READY',
    `RECON_STATUS_INVALID:${recon.status}`,
  );

  assert(
    recon.overlapAnalysis?.touchedCarryForward === true,
    'TOUCHED_CARRY_FORWARD_NOT_PROVEN',
  );

  assert(
    recon.overlapAnalysis?.stockActionMatches?.includes(
      `${TOUCHED.providerEventId}|${TOUCHED.stockCode}|${TOUCHED.actionType}`,
    ) === true,
    'TOUCHED_CARRY_IDENTITY_MISMATCH',
  );

  assert(
    evidence.status === 'DETAIL_EVIDENCE_COMPLETE_WITH_FAILURES',
    `EVIDENCE_STATUS_INVALID:${evidence.status}`,
  );

  assert(
    disposition.status ===
      'PROVIDER_014_DISPOSITION_COMPLETE',
    `DISPOSITION_STATUS_INVALID:${disposition.status}`,
  );

  assert(
    chain.status === 'CORRECTION_CHAIN_RESOLUTION_COMPLETE',
    `CHAIN_STATUS_INVALID:${chain.status}`,
  );

  assert(
    chain.counts?.resolved === 1 &&
    chain.counts?.ambiguous === 0 &&
    chain.counts?.unresolved === 0,
    `CHAIN_NOT_CLEAN:${JSON.stringify(chain.counts)}`,
  );

  assert(
    chain.conclusion?.rootReceiptNo === TOUCHED.providerEventId,
    'CHAIN_ROOT_MISMATCH',
  );

  assert(
    chain.conclusion?.sourceReceiptNo === TOUCHED.sourceReceiptNo,
    'CHAIN_SOURCE_MISMATCH',
  );

  assert(
    chain.conclusion?.confidence === 'HIGH',
    `CHAIN_CONFIDENCE_INVALID:${chain.conclusion?.confidence}`,
  );

  // -------------------------------------------------------------------------
  // Canonical/source/field/date/factor contract
  // -------------------------------------------------------------------------

  assert(
    canonical.status === 'CANONICAL_SOURCE_SELECTION_READY',
    `CANONICAL_STATUS_INVALID:${canonical.status}`,
  );

  assert(
    canonical.counts?.newCanonicalRoots === 0,
    `UNEXPECTED_NEW_CANONICAL_ROOTS:${canonical.counts?.newCanonicalRoots}`,
  );

  assert(
    canonical.counts?.existingRootsPreserved === 1,
    `EXPECTED_ONE_EXISTING_ROOT_PRESERVED:${canonical.counts?.existingRootsPreserved}`,
  );

  assert(
    canonical.counts?.latestSourcesAdvanced === 1,
    `EXPECTED_ONE_SOURCE_ADVANCE:${canonical.counts?.latestSourcesAdvanced}`,
  );

  assert(
    canonical.counts?.quarantinedChains === 0 &&
    canonical.counts?.unresolvedChains === 0,
    'CANONICAL_HAS_BLOCKERS',
  );

  assert(
    canonical.conclusion?.canonicalRootIdentity === TOUCHED.providerEventId &&
    canonical.conclusion?.latestValidSourceReceiptNo === TOUCHED.sourceReceiptNo,
    'CANONICAL_ROOT_SOURCE_CONTRACT_MISMATCH',
  );

  assert(
    canonical.conclusion?.correctionScope === 'ATTACHMENT_ONLY',
    'EXPECTED_ATTACHMENT_ONLY_CORRECTION',
  );

  assert(
    fields.status === 'FIELD_EXTRACTION_COMPLETE',
    `FIELDS_STATUS_INVALID:${fields.status}`,
  );

  assert(
    fields.counts?.businessFieldsMutated === 0 &&
    fields.counts?.reparsedRows === 0 &&
    fields.counts?.reviewQueue === 0,
    'FIELD_EXTRACTION_NOT_CLEAN',
  );

  assert(
    fields.conclusion?.businessFieldsPreserved === true &&
    fields.conclusion?.canonicalPreviewPreserved === true,
    'FIELD_PRESERVATION_NOT_PROVEN',
  );

  assert(
    effective.status ===
      'EFFECTIVE_DATE_RECONFIRMATION_COMPLETE_WITH_FUTURE_PENDING',
    `EFFECTIVE_STATUS_INVALID:${effective.status}`,
  );

  assert(
    effective.conclusion?.effectiveDate === TOUCHED.effectiveDate &&
    effective.conclusion?.effectiveDateReconfirmed === true,
    'EFFECTIVE_DATE_NOT_RECONFIRMED',
  );

  assert(
    effective.conclusion?.futureStructuralPending === true,
    'EXPECTED_FUTURE_STRUCTURAL_PENDING',
  );

  assert(
    factor.status ===
      'FACTOR_VALIDATION_COMPLETE_WITH_FUTURE_STRUCTURAL_PENDING',
    `FACTOR_STATUS_INVALID:${factor.status}`,
  );

  assert(
    factor.counts?.structuralBlocked === 1 &&
    factor.counts?.factorReady === 0 &&
    factor.counts?.factorRowsGenerated === 0 &&
    factor.counts?.reviewRequired === 0,
    `FACTOR_CONTRACT_INVALID:${JSON.stringify(factor.counts)}`,
  );

  assert(
    factor.conclusion?.factorStatus === 'STRUCTURAL_BLOCKED' &&
    factor.conclusion?.genericFactorAllowed === false &&
    factor.conclusion?.persistenceRequiredNow === false &&
    factor.conclusion?.safeToCarryForward === true,
    'STRUCTURAL_FACTOR_CONCLUSION_INVALID',
  );

  // -------------------------------------------------------------------------
  // Carry-forward set
  // -------------------------------------------------------------------------

  const expectedCarryKeys =
    new Set(EXPECTED_CARRY.map(carryKey));

  const canonicalCarry =
    canonical.carryForward?.identities ?? [];

  assert(
    Array.isArray(canonicalCarry),
    'CANONICAL_CARRY_IDENTITIES_MISSING',
  );

  assert(
    sameSet(
      new Set(canonicalCarry),
      expectedCarryKeys,
    ),
    `CANONICAL_CARRY_SET_MISMATCH:${JSON.stringify(canonicalCarry)}`,
  );

  const touchedCarry =
    EXPECTED_CARRY.find(
      (row) =>
        row.providerEventId === TOUCHED.providerEventId,
    );

  assert(
    touchedCarry?.effectiveDate === TOUCHED.effectiveDate,
    'TOUCHED_CARRY_EFFECTIVE_DATE_MISMATCH',
  );

  // Prior closure existence is a lineage anchor, but do not depend on its
  // exact schema because V9.10 was a zero-candidate cycle.
  assert(
    typeof previousClosure.status === 'string' &&
    previousClosure.status.includes('2026_10_05'),
    `PREVIOUS_CLOSURE_STATUS_INVALID:${previousClosure.status}`,
  );

  const issues = [];

  const closure = {
    status:
      'V9_11_CURRENT_CYCLE_CLOSED_AT_2026_10_06',

    version:
      VERSION,

    evidenceSnapshotAsOf:
      SNAPSHOT_AS_OF,

    previousCycle: {
      status:
        previousClosure.status,

      file:
        files.previousClosure,
    },

    closure: {
      cycleDate:
        SNAPSHOT_AS_OF,

      inventoryComplete:
        true,

      chainResolutionComplete:
        true,

      canonicalSourceSelectionComplete:
        true,

      fieldExtractionComplete:
        true,

      effectiveDateReconfirmationComplete:
        true,

      factorValidationComplete:
        true,

      unresolvedBlockers:
        0,

      productionPersistenceRequiredNow:
        false,

      externalCoverageAdvanced:
        false,

      cycleClosed:
        true,
    },

    accounting: {
      disclosures:
        Number(inv.disclosures ?? 56),

      candidates:
        1,

      mergerCandidates:
        1,

      correctionCandidates:
        1,

      chainLookupTargets:
        1,

      chainResolved:
        1,

      chainAmbiguous:
        0,

      chainUnresolved:
        0,

      newCanonicalRoots:
        0,

      existingCanonicalRootsTouched:
        1,

      latestSourcesAdvanced:
        1,

      businessFieldsMutated:
        0,

      effectiveDatesReconfirmed:
        1,

      factorReadyEvents:
        0,

      structuralBlockedEvents:
        1,

      factorRowsGenerated:
        0,

      productionWrites:
        0,

      futureStructuralCarryForward:
        3,
    },

    touchedChain: {
      providerEventId:
        TOUCHED.providerEventId,

      stockCode:
        TOUCHED.stockCode,

      actionType:
        TOUCHED.actionType,

      previousSourceReceiptNo:
        TOUCHED.providerEventId,

      latestValidSourceReceiptNo:
        TOUCHED.sourceReceiptNo,

      correctionScope:
        'ATTACHMENT_ONLY',

      chainConfidence:
        'HIGH',

      effectiveDate:
        TOUCHED.effectiveDate,

      factorStatus:
        'STRUCTURAL_BLOCKED',

      newCanonicalRootCreated:
        false,

      productionPersistenceRequiredNow:
        false,
    },

    carryForward: {
      count:
        EXPECTED_CARRY.length,

      identities:
        EXPECTED_CARRY.map(carryKey),

      rows:
        EXPECTED_CARRY,

      touchedIdentity:
        carryKey(touchedCarry),

      untouchedIdentities:
        EXPECTED_CARRY
          .filter(
            (row) =>
              row.providerEventId !== TOUCHED.providerEventId,
          )
          .map(carryKey),

      allFutureRelativeToSnapshot:
        EXPECTED_CARRY.every(
          (row) =>
            row.effectiveDate > SNAPSHOT_AS_OF,
        ),
    },

    issues,

    sourceFingerprints: {
      inventory:
        inv.outputFingerprint ?? null,

      reconciliation:
        recon.outputFingerprint ?? null,

      chainResolution:
        chain.outputFingerprint ?? null,

      canonicalSource:
        canonical.outputFingerprint ?? null,

      fieldExtraction:
        fields.outputFingerprint ?? null,

      effectiveDate:
        effective.outputFingerprint ?? null,

      factorValidation:
        factor.outputFingerprint ?? null,
    },

    safety: {
      networkRequests:
        0,

      kisRequests:
        0,

      databaseReads:
        0,

      databaseWrites:
        0,

      productionApplied:
        false,

      canonicalEventsCreated:
        0,

      factorRowsPersisted:
        0,

      coverageWindowAdvanced:
        false,

      globalCoverageMarkerAdvanced:
        false,
    },

    nextGate:
      'RESUME_NORMAL_INCREMENTAL_PIPELINE_AND_BEGIN_ALPHA_DEVELOPMENT_IN_PARALLEL',

    outputFile:
      'logs/opendart-corporate-action-cycle-closure-v9-11-9-common-stock-scope.json',
  };

  closure.outputFingerprint =
    sha256(
      JSON.stringify({
        version:
          closure.version,

        evidenceSnapshotAsOf:
          closure.evidenceSnapshotAsOf,

        closure:
          closure.closure,

        accounting:
          closure.accounting,

        touchedChain:
          closure.touchedChain,

        carryForward:
          closure.carryForward,

        issues:
          closure.issues,
      }),
    );

  const outputFile =
    path.join(root, closure.outputFile);

  atomicSaveJson(
    outputFile,
    closure,
  );

  console.log(
    JSON.stringify(
      {
        status:
          closure.status,

        version:
          closure.version,

        evidenceSnapshotAsOf:
          closure.evidenceSnapshotAsOf,

        closure:
          closure.closure,

        accounting:
          closure.accounting,

        touchedChain:
          closure.touchedChain,

        carryForward:
          closure.carryForward,

        issues:
          closure.issues,

        networkRequests:
          0,

        kisRequests:
          0,

        databaseWrites:
          0,

        nextGate:
          closure.nextGate,

        outputFile:
          closure.outputFile,
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
          'V9_11_9_CYCLE_CLOSURE_FAILED',

        version:
          VERSION,

        error:
          String(error?.message ?? error),

        networkRequests:
          0,

        kisRequests:
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
