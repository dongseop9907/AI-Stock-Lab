#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * V9.8.11.10.1 replay
 *
 * Ratio KIS refresh eligibility gate.
 *
 * READ ONLY.
 * - no DB access
 * - no DB writes
 * - no KIS calls
 * - historical evidence snapshot remains 2026-10-01
 *
 * Input:
 *   logs/opendart-corporate-action-post-persistence-refresh-plan-v9-8-11-10-replay.json
 *
 * Expected:
 *   ratio rows      = 42
 *   eligible now    = 18
 *   future deferred = 24
 *
 * Rule:
 *   effectiveDate <= 2026-10-01 -> eligibleRefreshPlan
 *   effectiveDate >  2026-10-01 -> futureDeferredPlan
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_8_11_10_1_REPLAY_RATIO_KIS_REFRESH_ELIGIBILITY_GATE';

const INPUT_VERSION =
  'V9_8_11_10_REPLAY_READ_ONLY_POST_PERSISTENCE_VERIFICATION_AND_HISTORY_REFRESH_MANIFEST';

const SNAPSHOT_AS_OF =
  '2026-10-01';

const EXPECTED_RATIO_ROWS = 42;
const EXPECTED_ELIGIBLE = 18;
const EXPECTED_FUTURE = 24;

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

function isIsoDate(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value)
  );
}

function countDuplicates(values) {
  return (
    values.length -
    new Set(values).size
  );
}

function countBy(rows, fn) {
  const out = {};

  for (const row of rows) {
    const key =
      String(fn(row) ?? 'NULL');

    out[key] =
      (out[key] ?? 0) + 1;
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
      'opendart-corporate-action-post-persistence-refresh-plan-v9-8-11-10-replay.json',
    );

  const outputFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-ratio-refresh-eligibility-v9-8-11-10-1-replay.json',
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
      'POST_PERSISTENCE_VERIFICATION_AND_REFRESH_MANIFEST_READY',
    `INPUT_STATUS_NOT_READY:${input.status}`,
  );

  assert(
    Array.isArray(input.ratioRefreshPlan),
    'RATIO_REFRESH_PLAN_MISSING',
  );

  assert(
    input.ratioRefreshPlan.length ===
      EXPECTED_RATIO_ROWS,
    `EXPECTED_42_RATIO_REFRESH_ROWS:${input.ratioRefreshPlan.length}`,
  );

  const invalidDates =
    input.ratioRefreshPlan.filter(
      (row) =>
        !isIsoDate(
          row.effectiveDate,
        ),
    );

  const invalidActionTypes =
    input.ratioRefreshPlan.filter(
      (row) =>
        ![
          'STOCK_SPLIT',
          'REVERSE_SPLIT',
        ].includes(
          row.actionType,
        ),
    );

  const eligibleNow =
    input.ratioRefreshPlan
      .filter(
        (row) =>
          row.effectiveDate <=
          SNAPSHOT_AS_OF,
      )
      .map(
        (row) => ({
          ...row,

          eligibility:
            'ELIGIBLE_AT_EVIDENCE_SNAPSHOT',

          evidenceSnapshotAsOf:
            SNAPSHOT_AS_OF,

          refreshEnd:
            SNAPSHOT_AS_OF,
        }),
      )
      .sort(
        (a, b) =>
          `${a.effectiveDate}|${a.stockCode}`
            .localeCompare(
              `${b.effectiveDate}|${b.stockCode}`,
            ),
      );

  const futureDeferred =
    input.ratioRefreshPlan
      .filter(
        (row) =>
          row.effectiveDate >
          SNAPSHOT_AS_OF,
      )
      .map(
        (row) => ({
          ...row,

          eligibility:
            'DEFER_FUTURE_EFFECTIVE_DATE',

          evidenceSnapshotAsOf:
            SNAPSHOT_AS_OF,

          recheckPolicy:
            'RECHECK_ON_NEXT_INCREMENTAL_REFRESH',
        }),
      )
      .sort(
        (a, b) =>
          `${a.effectiveDate}|${a.stockCode}`
            .localeCompare(
              `${b.effectiveDate}|${b.stockCode}`,
            ),
      );

  const allStocks =
    input.ratioRefreshPlan.map(
      (row) =>
        String(row.stockCode),
    );

  const eligibleStocks =
    eligibleNow.map(
      (row) =>
        String(row.stockCode),
    );

  const futureStocks =
    futureDeferred.map(
      (row) =>
        String(row.stockCode),
    );

  const duplicateStocks =
    countDuplicates(
      allStocks,
    );

  const eligibleDuplicateStocks =
    countDuplicates(
      eligibleStocks,
    );

  const futureDuplicateStocks =
    countDuplicates(
      futureStocks,
    );

  const eligibleFutureOverlap =
    eligibleStocks.filter(
      (stock) =>
        new Set(
          futureStocks,
        ).has(stock),
    );

  const accountingDelta =
    EXPECTED_RATIO_ROWS -
    (
      eligibleNow.length +
      futureDeferred.length
    );

  const blockers = [];

  if (invalidDates.length > 0) {
    blockers.push(
      'INVALID_EFFECTIVE_DATES',
    );
  }

  if (
    invalidActionTypes.length > 0
  ) {
    blockers.push(
      'INVALID_RATIO_ACTION_TYPES',
    );
  }

  if (duplicateStocks !== 0) {
    blockers.push(
      'DUPLICATE_RATIO_STOCKS',
    );
  }

  if (
    eligibleDuplicateStocks !== 0
  ) {
    blockers.push(
      'DUPLICATE_ELIGIBLE_STOCKS',
    );
  }

  if (
    futureDuplicateStocks !== 0
  ) {
    blockers.push(
      'DUPLICATE_FUTURE_STOCKS',
    );
  }

  if (
    eligibleFutureOverlap.length > 0
  ) {
    blockers.push(
      'ELIGIBLE_FUTURE_STOCK_OVERLAP',
    );
  }

  if (
    eligibleNow.length !==
    EXPECTED_ELIGIBLE
  ) {
    blockers.push(
      `EXPECTED_18_ELIGIBLE_REFRESH_ROWS_GOT_${eligibleNow.length}`,
    );
  }

  if (
    futureDeferred.length !==
    EXPECTED_FUTURE
  ) {
    blockers.push(
      `EXPECTED_24_FUTURE_DEFERRED_ROWS_GOT_${futureDeferred.length}`,
    );
  }

  if (accountingDelta !== 0) {
    blockers.push(
      `ACCOUNTING_DELTA_${accountingDelta}`,
    );
  }

  const status =
    blockers.length === 0
      ? 'RATIO_KIS_REFRESH_ELIGIBILITY_READY'
      : 'RATIO_KIS_REFRESH_ELIGIBILITY_BLOCKED';

  const report = {
    status,
    version: VERSION,

    source: {
      inputVersion:
        input.version,

      inputFingerprint:
        input.outputFingerprint ?? null,
    },

    policy: {
      evidenceSnapshotAsOf:
        SNAPSHOT_AS_OF,

      eligibleRule:
        'EFFECTIVE_DATE_ON_OR_BEFORE_SNAPSHOT',

      deferredRule:
        'EFFECTIVE_DATE_AFTER_SNAPSHOT',

      canonicalMarketData:
        'KIS_ADJUSTED_DAILY_BARS',

      applyStoredFactorToCanonicalBars:
        false,
    },

    counts: {
      inputRatioRefreshRows:
        input.ratioRefreshPlan.length,

      eligibleNow:
        eligibleNow.length,

      futureDeferred:
        futureDeferred.length,

      invalidDates:
        invalidDates.length,

      invalidActionTypes:
        invalidActionTypes.length,

      duplicateStocks,

      eligibleDuplicateStocks,

      futureDuplicateStocks,

      eligibleFutureOverlap:
        eligibleFutureOverlap.length,

      accountingDelta,

      blockers:
        blockers.length,
    },

    eligibleActionTypeCounts:
      countBy(
        eligibleNow,
        (row) => row.actionType,
      ),

    futureActionTypeCounts:
      countBy(
        futureDeferred,
        (row) => row.actionType,
      ),

    eligibleRefreshPlan:
      eligibleNow,

    futureDeferredPlan:
      futureDeferred,

    invalidDates,
    invalidActionTypes,
    eligibleFutureOverlap,
    blockers,

    safety: {
      networkRequests: 0,
      databaseReads: 0,
      databaseWrites: 0,
      kisRequests: 0,
      marketDailyBarsModified: 0,
      productionApplied: false,
    },

    nextGate:
      status ===
      'RATIO_KIS_REFRESH_ELIGIBILITY_READY'
        ? 'BUILD_V9_8_11_10_2_MARKET_DAILY_BAR_COVERAGE_PREFLIGHT_REPLAY'
        : 'STOP_AND_REVIEW',

    outputFile:
      'logs/opendart-corporate-action-ratio-refresh-eligibility-v9-8-11-10-1-replay.json',
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
          eligibleNow.map(
            (row) => [
              row.stockCode,
              row.providerEventId,
              row.actionType,
              row.effectiveDate,
              row.eventId,
              row.adjustmentRunId,
              row.adjustmentFactorId,
            ],
          ),

        future:
          futureDeferred.map(
            (row) => [
              row.stockCode,
              row.providerEventId,
              row.actionType,
              row.effectiveDate,
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

        futureActionTypeCounts:
          report.futureActionTypeCounts,

        eligibleStocks:
          eligibleNow.map(
            (row) =>
              row.stockCode,
          ),

        blockers:
          report.blockers,

        databaseWrites:
          0,

        kisRequests:
          0,

        marketDailyBarsModified:
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

  if (
    status !==
    'RATIO_KIS_REFRESH_ELIGIBILITY_READY'
  ) {
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
          'RATIO_KIS_REFRESH_ELIGIBILITY_FAILED',

        version:
          VERSION,

        error:
          String(
            error?.message ??
            error,
          ),

        databaseWrites:
          0,

        kisRequests:
          0,

        marketDailyBarsModified:
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
