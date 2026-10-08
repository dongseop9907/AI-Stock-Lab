/* eslint-disable no-console */
'use strict';

/**
 * AI Stock Lab
 * V9.8.11.5.1 - Snapshot-as-of eligibility policy gate
 *
 * READ-ONLY. No DB writes.
 *
 * Why this gate exists:
 *   The V9.8 incremental evidence snapshot ends at 2026-10-01.
 *   Structural events (MERGER/SPIN_OFF) can be announced for future dates and
 *   later corrected. A future effective date that is known is not the same as
 *   an event that is production-eligible under the current evidence snapshot.
 *
 * Policy:
 *   - SNAPSHOT_AS_OF = 2026-10-01
 *   - non-structural rows already admitted by V9.8.11.5 stay eligible
 *   - MERGER/SPIN_OFF with effective_date <= snapshot as-of stay eligible
 *   - MERGER/SPIN_OFF with effective_date > snapshot as-of are deferred
 *   - no rows are mutated
 *
 * Expected from current batch:
 *   input insert rows              = 153
 *   future structural deferred     = 30
 *   eligible insert rows           = 123
 *   existing compatible rows       = 5
 *   total production-eligible now  = 128
 *
 * Input:
 *   logs/opendart-corporate-action-bulk-insert-dry-run-v9-8-11-5-replay-v2.json
 *
 * Output:
 *   logs/opendart-corporate-action-snapshot-eligibility-v9-8-11-5-1-replay.json
 *
 * Run:
 *   node .\scripts\v9811-5-1.cjs
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_8_11_5_1_REPLAY_SNAPSHOT_ASOF_PRODUCTION_ELIGIBILITY_GATE';

const INPUT_VERSION =
  'V9_8_11_5_REPLAY_V2_CURRENT_STATE_CANONICAL_EVENT_BULK_INSERT_DRY_RUN';

const SNAPSHOT_AS_OF =
  '2026-10-01';

const EXPECTED_INPUT_INSERTS = 153;
const EXPECTED_COMPATIBLE = 127;
const EXPECTED_FUTURE_STRUCTURAL = 30;
const EXPECTED_ELIGIBLE_INSERTS = 1;
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
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;

  fs.writeFileSync(
    tmp,
    JSON.stringify(value, null, 2),
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

function isIsoDate(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return false;
  }

  const d =
    new Date(`${value}T00:00:00Z`);

  return (
    Number.isFinite(d.getTime()) &&
    d.toISOString().slice(0, 10) === value
  );
}

function countBy(rows, selector) {
  const out = {};

  for (const row of rows) {
    const key =
      String(selector(row) ?? 'NULL');

    out[key] =
      (out[key] ?? 0) + 1;
  }

  return Object.fromEntries(
    Object.entries(out)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

function main() {
  const root =
    path.resolve(
      __dirname,
      '..',
    );

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
      'opendart-corporate-action-snapshot-eligibility-v9-8-11-5-1-replay.json',
    );

  if (
    !fs.existsSync(
      inputFile,
    )
  ) {
    throw new Error(
      `INPUT_NOT_FOUND:${path.basename(inputFile)}`,
    );
  }

  const input =
    readJson(
      inputFile,
    );

  if (
    input.version !==
    INPUT_VERSION
  ) {
    throw new Error(
      'INPUT_VERSION_MISMATCH',
    );
  }

  if (
    input.status !==
    'CANONICAL_EVENT_BULK_INSERT_DRY_RUN_READY'
  ) {
    throw new Error(
      'BULK_INSERT_DRY_RUN_NOT_READY',
    );
  }

  if (
    !Array.isArray(
      input.insertPayload,
    ) ||
    input.insertPayload.length !==
      EXPECTED_INPUT_INSERTS
  ) {
    throw new Error(
      'EXPECTED_153_INSERT_ROWS',
    );
  }

  if (
    input.counts
      ?.existingCompatibleRows !==
      EXPECTED_COMPATIBLE
  ) {
    throw new Error(
      'EXPECTED_5_COMPATIBLE_ROWS',
    );
  }

  if (
    !isIsoDate(
      SNAPSHOT_AS_OF,
    )
  ) {
    throw new Error(
      'INVALID_SNAPSHOT_AS_OF',
    );
  }

  const invalidDates =
    input.insertPayload.filter(
      (row) =>
        !isIsoDate(
          row.effective_date,
        ),
    );

  if (
    invalidDates.length >
    0
  ) {
    throw new Error(
      'INSERT_PAYLOAD_HAS_INVALID_EFFECTIVE_DATE',
    );
  }

  const deferredFutureStructural =
    input.insertPayload.filter(
      (row) =>
        STRUCTURAL.has(
          row.action_type,
        ) &&
        row.effective_date >
          SNAPSHOT_AS_OF,
    );

  const eligibleInsertPayload =
    input.insertPayload.filter(
      (row) =>
        !(
          STRUCTURAL.has(
            row.action_type,
          ) &&
          row.effective_date >
            SNAPSHOT_AS_OF
        ),
    );

  const historicalOrCurrentStructural =
    eligibleInsertPayload.filter(
      (row) =>
        STRUCTURAL.has(
          row.action_type,
        ),
    );

  const eligibleNonStructural =
    eligibleInsertPayload.filter(
      (row) =>
        !STRUCTURAL.has(
          row.action_type,
        ),
    );

  const eligibleTotal =
    eligibleInsertPayload.length +
    EXPECTED_COMPATIBLE;

  const futureStructuralAtOrBeforeSnapshot =
    deferredFutureStructural.filter(
      (row) =>
        row.effective_date <=
        SNAPSHOT_AS_OF,
    );

  const duplicateEligibleIdentityCount =
    eligibleInsertPayload.length -
    new Set(
      eligibleInsertPayload.map(
        (row) =>
          `${row.provider}|${row.provider_event_id}|${row.is_validation}`,
      ),
    ).size;

  const duplicateDeferredIdentityCount =
    deferredFutureStructural.length -
    new Set(
      deferredFutureStructural.map(
        (row) =>
          `${row.provider}|${row.provider_event_id}|${row.is_validation}`,
      ),
    ).size;

  const accountingOkay =
    eligibleInsertPayload.length +
      deferredFutureStructural.length ===
    input.insertPayload.length;


  // Repaired-lineage snapshot guard.
  const repairedEligibleIds =
    eligibleInsertPayload.map(
      (row) => String(row.provider_event_id),
    );

  if (
    repairedEligibleIds.length !== 1 ||
    repairedEligibleIds[0] !== '20221013000451'
  ) {
    throw new Error(
      `REPAIRED_ELIGIBLE_IDENTITY_MISMATCH:${repairedEligibleIds.join(',')}`,
    );
  }

  const repaired003580Deferred =
    deferredFutureStructural.find(
      (row) =>
        String(row.provider_event_id) ===
        '20260807000649',
    );

  if (
    !repaired003580Deferred ||
    repaired003580Deferred.effective_date !==
      '2026-10-12'
  ) {
    throw new Error(
      'REPAIRED_003580_NOT_DEFERRED_AT_2026_10_12',
    );
  }

  const status =
    deferredFutureStructural.length ===
      EXPECTED_FUTURE_STRUCTURAL &&
    eligibleInsertPayload.length ===
      EXPECTED_ELIGIBLE_INSERTS &&
    eligibleTotal ===
      EXPECTED_ELIGIBLE_TOTAL &&
    historicalOrCurrentStructural.length ===
      1 &&
    eligibleNonStructural.length ===
      0 &&
    futureStructuralAtOrBeforeSnapshot.length ===
      0 &&
    duplicateEligibleIdentityCount ===
      0 &&
    duplicateDeferredIdentityCount ===
      0 &&
    accountingOkay
      ? 'SNAPSHOT_ASOF_ELIGIBILITY_GATE_READY'
      : 'SNAPSHOT_ASOF_ELIGIBILITY_GATE_REVIEW';

  const report = {
    version:
      VERSION,

    status,

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
        EXPECTED_COMPATIBLE,

      eligibleInsertRows:
        eligibleInsertPayload.length,

      eligibleNonStructuralRows:
        eligibleNonStructural.length,

      eligibleHistoricalOrCurrentStructuralRows:
        historicalOrCurrentStructural.length,

      deferredFutureStructuralRows:
        deferredFutureStructural.length,

      totalProductionEligibleNow:
        eligibleTotal,

      duplicateEligibleIdentities:
        duplicateEligibleIdentityCount,

      duplicateDeferredIdentities:
        duplicateDeferredIdentityCount,

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
        (row) =>
          row.action_type,
      ),

    deferredActionTypeCounts:
      countBy(
        deferredFutureStructural,
        (row) =>
          row.action_type,
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
            row.source_fingerprint,

          disposition:
            'DEFER_UNTIL_INCREMENTAL_REFRESH_RECONFIRMS',
        }),
      ),

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

      coverageWindowAdvanced:
        false,
    },

    nextGate:
      status ===
      'SNAPSHOT_ASOF_ELIGIBILITY_GATE_READY'
        ? 'STOP_BEFORE_WRITE_AND_BUILD_READ_ONLY_POST_ELIGIBILITY_REPLAY'
        : 'STOP_AND_REVIEW',

    outputFile:
      path
        .relative(
          root,
          outputFile,
        )
        .replaceAll('\\', '/'),
  };

  report.outputFingerprint =
    sha256(
      JSON.stringify({
        version:
          report.version,

        inputFingerprint:
          input.outputFingerprint,

        snapshotAsOf:
          SNAPSHOT_AS_OF,

        eligible:
          eligibleInsertPayload.map(
            (row) => [
              row.provider_event_id,
              row.action_type,
              row.effective_date,
            ],
          ),

        deferred:
          deferredFutureStructural.map(
            (row) => [
              row.provider_event_id,
              row.action_type,
              row.effective_date,
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
          VERSION,

        evidenceSnapshotAsOf:
          SNAPSHOT_AS_OF,

        ...report.counts,

        eligibleActionTypeCounts:
          report.eligibleActionTypeCounts,

        deferredActionTypeCounts:
          report.deferredActionTypeCounts,

        deferredFutureStructuralRows:
          report.deferredFutureStructuralRows,

        databaseWrites:
          0,

        canonicalEventsInserted:
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

  if (
    status !==
    'SNAPSHOT_ASOF_ELIGIBILITY_GATE_READY'
  ) {
    process.exitCode =
      2;
  }
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
      },
      null,
      2,
    ),
  );

  process.exitCode =
    1;
}
