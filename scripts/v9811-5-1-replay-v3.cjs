#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * V9.8.11.5.1 replay v3
 *
 * Standalone snapshot-as-of production eligibility gate.
 *
 * This intentionally does NOT patch historical v9811-5-1.cjs text.
 * It replays the stage's business logic directly against the repaired
 * V9.8.11.5 replay-v2 artifact.
 *
 * Historical deterministic boundary:
 *   SNAPSHOT_AS_OF = 2026-10-01
 *
 * Policy:
 * - Structural events = MERGER, SPIN_OFF
 * - Structural effective_date > SNAPSHOT_AS_OF => deferred
 * - Everything else in the frozen insert payload => eligible
 * - Existing compatible rows remain counted as already production-eligible
 *
 * Repaired/current-state contract:
 * - input insert rows = 31
 * - existing compatible rows = 127
 * - eligible insert rows = 1
 * - eligible non-structural rows = 0
 * - eligible structural rows = 1
 * - deferred future structural rows = 30
 * - total production eligible now = 128
 *
 * Safety:
 * - no network
 * - no DB reads
 * - no DB writes
 * - no production apply
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_8_11_5_1_REPLAY_V3_SNAPSHOT_ASOF_PRODUCTION_ELIGIBILITY_GATE';

const INPUT_VERSION =
  'V9_8_11_5_REPLAY_V2_CURRENT_STATE_CANONICAL_EVENT_BULK_INSERT_DRY_RUN';

const SNAPSHOT_AS_OF =
  '2026-10-01';

const EXPECTED_INPUT_INSERT_ROWS = 31;
const EXPECTED_COMPATIBLE = 127;
const EXPECTED_ELIGIBLE_INSERTS = 1;
const EXPECTED_ELIGIBLE_NON_STRUCTURAL = 0;
const EXPECTED_ELIGIBLE_STRUCTURAL = 1;
const EXPECTED_FUTURE_STRUCTURAL = 30;
const EXPECTED_ELIGIBLE_TOTAL = 128;

const STRUCTURAL = new Set([
  'MERGER',
  'SPIN_OFF',
]);

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

function isIsoDate(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value)
  );
}

function identity(row) {
  return [
    row.provider,
    row.provider_event_id,
    row.is_validation,
  ].join('|');
}

function countBy(rows, keyFn) {
  const out = {};

  for (const row of rows) {
    const key = String(keyFn(row) ?? 'NULL');
    out[key] = (out[key] ?? 0) + 1;
  }

  return Object.fromEntries(
    Object.entries(out).sort(
      ([a], [b]) => a.localeCompare(b),
    ),
  );
}

function main() {
  const root =
    path.resolve(__dirname, '..');

  const inputFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-bulk-insert-dry-run-v9-8-11-5-replay-v2.json',
    );

  const outputFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-snapshot-eligibility-v9-8-11-5-1-replay-v3.json',
    );

  assert(
    fs.existsSync(inputFile),
    `INPUT_NOT_FOUND:${path.basename(inputFile)}`,
  );

  const input =
    readJson(inputFile);

  assert(
    input.version === INPUT_VERSION,
    `INPUT_VERSION_MISMATCH:${input.version}`,
  );

  assert(
    input.status ===
      'CANONICAL_EVENT_BULK_INSERT_DRY_RUN_READY',
    `INPUT_STATUS_NOT_READY:${input.status}`,
  );

  assert(
    Array.isArray(input.insertPayload),
    'INPUT_INSERT_PAYLOAD_MISSING',
  );

  assert(
    input.insertPayload.length ===
      EXPECTED_INPUT_INSERT_ROWS,
    `INPUT_INSERT_ROW_COUNT_MISMATCH:${input.insertPayload.length}`,
  );

  const compatibleCount =
    Number(
      input.counts?.existingCompatibleRows ??
      input.existingCompatibleRows ??
      0,
    );

  assert(
    compatibleCount === EXPECTED_COMPATIBLE,
    `EXISTING_COMPATIBLE_COUNT_MISMATCH:${compatibleCount}`,
  );

  const duplicateInputIdentityCount =
    input.insertPayload.length -
    new Set(
      input.insertPayload.map(identity),
    ).size;

  assert(
    duplicateInputIdentityCount === 0,
    `DUPLICATE_INPUT_IDENTITIES:${duplicateInputIdentityCount}`,
  );

  const invalidStructuralDates =
    input.insertPayload.filter(
      (row) =>
        STRUCTURAL.has(row.action_type) &&
        !isIsoDate(row.effective_date),
    );

  assert(
    invalidStructuralDates.length === 0,
    `INVALID_STRUCTURAL_DATES:${invalidStructuralDates.length}`,
  );

  const deferredFutureStructural =
    input.insertPayload.filter(
      (row) =>
        STRUCTURAL.has(row.action_type) &&
        row.effective_date > SNAPSHOT_AS_OF,
    );

  const eligibleInsertPayload =
    input.insertPayload.filter(
      (row) =>
        !(
          STRUCTURAL.has(row.action_type) &&
          row.effective_date > SNAPSHOT_AS_OF
        ),
    );

  const eligibleHistoricalOrCurrentStructural =
    eligibleInsertPayload.filter(
      (row) =>
        STRUCTURAL.has(row.action_type),
    );

  const eligibleNonStructural =
    eligibleInsertPayload.filter(
      (row) =>
        !STRUCTURAL.has(row.action_type),
    );

  const duplicateEligibleIdentityCount =
    eligibleInsertPayload.length -
    new Set(
      eligibleInsertPayload.map(identity),
    ).size;

  const duplicateDeferredIdentityCount =
    deferredFutureStructural.length -
    new Set(
      deferredFutureStructural.map(identity),
    ).size;

  const overlap =
    eligibleInsertPayload.filter((eligible) =>
      deferredFutureStructural.some(
        (deferred) =>
          identity(deferred) === identity(eligible),
      ),
    );

  const accountingOkay =
    eligibleInsertPayload.length +
      deferredFutureStructural.length ===
    input.insertPayload.length;

  const eligibleTotal =
    compatibleCount +
    eligibleInsertPayload.length;

  assert(
    eligibleInsertPayload.length ===
      EXPECTED_ELIGIBLE_INSERTS,
    `ELIGIBLE_INSERT_COUNT_MISMATCH:${eligibleInsertPayload.length}`,
  );

  assert(
    eligibleNonStructural.length ===
      EXPECTED_ELIGIBLE_NON_STRUCTURAL,
    `ELIGIBLE_NON_STRUCTURAL_COUNT_MISMATCH:${eligibleNonStructural.length}`,
  );

  assert(
    eligibleHistoricalOrCurrentStructural.length ===
      EXPECTED_ELIGIBLE_STRUCTURAL,
    `ELIGIBLE_STRUCTURAL_COUNT_MISMATCH:${eligibleHistoricalOrCurrentStructural.length}`,
  );

  assert(
    deferredFutureStructural.length ===
      EXPECTED_FUTURE_STRUCTURAL,
    `DEFERRED_FUTURE_STRUCTURAL_COUNT_MISMATCH:${deferredFutureStructural.length}`,
  );

  assert(
    eligibleTotal ===
      EXPECTED_ELIGIBLE_TOTAL,
    `ELIGIBLE_TOTAL_MISMATCH:${eligibleTotal}`,
  );

  assert(
    duplicateEligibleIdentityCount === 0,
    `DUPLICATE_ELIGIBLE_IDENTITIES:${duplicateEligibleIdentityCount}`,
  );

  assert(
    duplicateDeferredIdentityCount === 0,
    `DUPLICATE_DEFERRED_IDENTITIES:${duplicateDeferredIdentityCount}`,
  );

  assert(
    overlap.length === 0,
    `ELIGIBLE_DEFERRED_OVERLAP:${overlap.length}`,
  );

  assert(
    accountingOkay,
    'ELIGIBILITY_ACCOUNTING_FAILED',
  );

  // Exact repaired-lineage gate:
  // only 028080 is eligible among the 31 current insert candidates.
  const eligibleIds =
    eligibleInsertPayload
      .map(
        (row) =>
          String(row.provider_event_id),
      )
      .sort();

  assert(
    eligibleIds.length === 1 &&
      eligibleIds[0] === '20221013000451',
    `REPAIRED_ELIGIBLE_IDENTITY_MISMATCH:${eligibleIds.join(',')}`,
  );

  const eligible028080 =
    eligibleInsertPayload[0];

  assert(
    String(eligible028080.stock_code) ===
      '028080',
    `ELIGIBLE_STOCK_MISMATCH:${eligible028080.stock_code}`,
  );

  assert(
    eligible028080.action_type ===
      'MERGER',
    `ELIGIBLE_ACTION_MISMATCH:${eligible028080.action_type}`,
  );

  assert(
    eligible028080.effective_date ===
      SNAPSHOT_AS_OF,
    `ELIGIBLE_EFFECTIVE_DATE_MISMATCH:${eligible028080.effective_date}`,
  );

  // The false-safe date repair must now place 003580 in deferred.
  const repaired003580 =
    deferredFutureStructural.find(
      (row) =>
        String(row.provider_event_id) ===
          '20260807000649',
    );

  assert(
    repaired003580,
    'REPAIRED_003580_NOT_DEFERRED',
  );

  assert(
    String(repaired003580.stock_code) ===
      '003580',
    `REPAIRED_003580_STOCK_MISMATCH:${repaired003580.stock_code}`,
  );

  assert(
    repaired003580.effective_date ===
      '2026-10-12',
    `REPAIRED_003580_DATE_MISMATCH:${repaired003580.effective_date}`,
  );

  const futureStructuralAtOrBeforeSnapshot =
    deferredFutureStructural.filter(
      (row) =>
        row.effective_date <= SNAPSHOT_AS_OF,
    );

  assert(
    futureStructuralAtOrBeforeSnapshot.length ===
      0,
    `DEFERRED_NOT_ACTUALLY_FUTURE:${futureStructuralAtOrBeforeSnapshot.length}`,
  );

  const report = {
    status:
      'SNAPSHOT_ASOF_ELIGIBILITY_GATE_READY',

    version:
      VERSION,

    source: {
      inputVersion:
        input.version,

      inputFingerprint:
        input.outputFingerprint ?? null,
    },

    policy: {
      evidenceSnapshotAsOf:
        SNAPSHOT_AS_OF,

      structuralFutureRule:
        'DEFER_IF_EFFECTIVE_DATE_AFTER_EVIDENCE_SNAPSHOT',

      reason:
        'FUTURE_STRUCTURAL_ANNOUNCEMENTS_CAN_BE_CORRECTED_BEFORE_EFFECTIVE_DATE',

      futureStructuralPersistence:
        'NOT_PRODUCTION_ELIGIBLE_IN_CURRENT_SNAPSHOT',

      reeligibility:
        'RECHECK_ON_NEXT_INCREMENTAL_DART_REFRESH',
    },

    counts: {
      inputInsertRows:
        input.insertPayload.length,

      existingCompatibleRows:
        compatibleCount,

      eligibleInsertRows:
        eligibleInsertPayload.length,

      eligibleNonStructuralRows:
        eligibleNonStructural.length,

      eligibleHistoricalOrCurrentStructuralRows:
        eligibleHistoricalOrCurrentStructural.length,

      deferredFutureStructuralRows:
        deferredFutureStructural.length,

      totalProductionEligibleNow:
        eligibleTotal,

      duplicateInputIdentities:
        duplicateInputIdentityCount,

      duplicateEligibleIdentities:
        duplicateEligibleIdentityCount,

      duplicateDeferredIdentities:
        duplicateDeferredIdentityCount,

      eligibleDeferredOverlap:
        overlap.length,

      accountingDelta:
        input.insertPayload.length -
        (
          eligibleInsertPayload.length +
          deferredFutureStructural.length
        ),
    },

    eligibleActionTypeCounts:
      countBy(
        eligibleInsertPayload,
        (row) => row.action_type,
      ),

    deferredActionTypeCounts:
      countBy(
        deferredFutureStructural,
        (row) => row.action_type,
      ),

    eligibleInsertPayload,

    deferredFutureStructuralRows:
      deferredFutureStructural.map(
        (row) => ({
          providerEventId:
            row.provider_event_id,

          stockCode:
            row.stock_code,

          actionType:
            row.action_type,

          effectiveDate:
            row.effective_date,

          sourceFingerprint:
            row.source_fingerprint ?? null,

          disposition:
            'DEFER_UNTIL_INCREMENTAL_REFRESH_RECONFIRMS',
        }),
      ),

    repairedLineageChecks: {
      onlyEligibleProviderEventId:
        '20221013000451',

      onlyEligibleStockCode:
        '028080',

      onlyEligibleEffectiveDate:
        '2026-10-01',

      corrected003580ProviderEventId:
        '20260807000649',

      corrected003580EffectiveDate:
        '2026-10-12',

      corrected003580Deferred:
        true,
    },

    safety: {
      networkRequests:
        0,

      databaseReads:
        0,

      databaseWrites:
        0,

      insertRequestsExecuted:
        0,

      canonicalEventsInserted:
        0,

      productionApplied:
        false,

      coverageWindowAdvanced:
        false,
    },

    nextGate:
      'STOP_BEFORE_WRITE_AND_BUILD_READ_ONLY_POST_ELIGIBILITY_REPLAY',

    outputFile:
      'logs/opendart-corporate-action-snapshot-eligibility-v9-8-11-5-1-replay-v3.json',
  };

  report.outputFingerprint =
    sha256(
      JSON.stringify({
        version:
          report.version,

        inputFingerprint:
          report.source.inputFingerprint,

        snapshotAsOf:
          SNAPSHOT_AS_OF,

        eligible:
          eligibleInsertPayload.map(
            (row) => [
              row.provider_event_id,
              row.stock_code,
              row.action_type,
              row.effective_date,
              row.source_fingerprint ?? null,
            ],
          ),

        deferred:
          deferredFutureStructural.map(
            (row) => [
              row.provider_event_id,
              row.stock_code,
              row.action_type,
              row.effective_date,
              row.source_fingerprint ?? null,
            ],
          ),
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

        evidenceSnapshotAsOf:
          SNAPSHOT_AS_OF,

        ...report.counts,

        eligibleActionTypeCounts:
          report.eligibleActionTypeCounts,

        deferredActionTypeCounts:
          report.deferredActionTypeCounts,

        eligibleProviderEventIds:
          eligibleInsertPayload.map(
            (row) =>
              row.provider_event_id,
          ),

        corrected003580Deferred:
          true,

        databaseWrites:
          0,

        productionApplied:
          false,

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
          'SNAPSHOT_ASOF_ELIGIBILITY_GATE_FAILED',

        version:
          VERSION,

        error:
          String(
            error?.message ??
            error,
          ),

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
