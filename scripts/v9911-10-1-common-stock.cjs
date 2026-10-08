/* eslint-disable no-console */
'use strict';

/**
 * AI Stock Lab
 * V9.8.11.10.1
 * Ratio-action KIS refresh eligibility gate
 *
 * READ-ONLY.
 * - no DB access
 * - no KIS calls
 * - no market_daily_bars writes
 *
 * Input:
 *   logs/opendart-corporate-action-post-persistence-refresh-plan-v9-9-11-10-common-stock-scope.json
 *
 * Output:
 *   logs/opendart-corporate-action-ratio-refresh-eligibility-v9-9-11-10-1-common-stock-scope.json
 *
 * Policy:
 *   evidence snapshot as-of = 2026-10-01
 *
 * Ratio corporate actions are allowed to remain persisted as announced
 * canonical events/factors, but KIS adjusted-history refresh is only eligible
 * after the effective date is at or before the evidence snapshot.
 *
 * Future ratio actions are NOT refreshed yet because KIS may not have
 * retroactively adjusted its historical series before the action becomes
 * effective.
 *
 * Run:
 *   node .\scripts\v9811-10-1.cjs
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_9_11_10_1_RATIO_KIS_REFRESH_ELIGIBILITY_GATE';

const INPUT_VERSION =
  'V9_9_11_10_POST_PERSISTENCE_VERIFICATION_AND_HISTORY_REFRESH_MANIFEST';

const SNAPSHOT_AS_OF =
  '2026-10-04';

const EXPECTED_RATIO_ROWS =
  1;

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''),
  );
}

function atomicSaveJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const tmp =
    `${file}.tmp`;

  fs.writeFileSync(
    tmp,
    JSON.stringify(value, null, 2),
    'utf8',
  );

  fs.renameSync(
    tmp,
    file,
  );
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

  const date =
    new Date(
      `${value}T00:00:00Z`,
    );

  return (
    Number.isFinite(
      date.getTime(),
    ) &&
    date
      .toISOString()
      .slice(0, 10) ===
      value
  );
}

function countBy(
  rows,
  selector,
) {
  const out = {};

  for (const row of rows) {
    const key =
      String(
        selector(row) ??
        'NULL',
      );

    out[key] =
      (out[key] ?? 0) + 1;
  }

  return Object.fromEntries(
    Object.entries(out)
      .sort(
        ([a], [b]) =>
          a.localeCompare(b),
      ),
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
      'opendart-corporate-action-post-persistence-refresh-plan-v9-9-11-10-common-stock-scope.json',
    );

  const outputFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-ratio-refresh-eligibility-v9-9-11-10-1-common-stock-scope.json',
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
    'POST_PERSISTENCE_VERIFICATION_AND_REFRESH_MANIFEST_READY'
  ) {
    throw new Error(
      'REFRESH_MANIFEST_NOT_READY',
    );
  }

  if (
    !Array.isArray(
      input.ratioRefreshPlan,
    ) ||
    input.ratioRefreshPlan.length !==
      EXPECTED_RATIO_ROWS
  ) {
    throw new Error(
      'EXPECTED_1_RATIO_REFRESH_ROW',
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
    input.ratioRefreshPlan.filter(
      (row) =>
        !isIsoDate(
          row.effectiveDate,
        ),
    );

  if (
    invalidDates.length >
    0
  ) {
    throw new Error(
      `INVALID_EFFECTIVE_DATES:${invalidDates.length}`,
    );
  }

  const eligibleNow =
    input.ratioRefreshPlan.filter(
      (row) =>
        row.effectiveDate <=
        SNAPSHOT_AS_OF,
    );

  const futureDeferred =
    input.ratioRefreshPlan.filter(
      (row) =>
        row.effectiveDate >
        SNAPSHOT_AS_OF,
    );

  const duplicateStocks =
    eligibleNow.length -
    new Set(
      eligibleNow.map(
        (row) =>
          row.stockCode,
      ),
    ).size;

  const futureDuplicateStocks =
    futureDeferred.length -
    new Set(
      futureDeferred.map(
        (row) =>
          row.stockCode,
      ),
    ).size;

  const accountingDelta =
    EXPECTED_RATIO_ROWS -
    (
      eligibleNow.length +
      futureDeferred.length
    );

  const status =
    invalidDates.length === 0 &&
    duplicateStocks === 0 &&
    futureDuplicateStocks === 0 &&
    accountingDelta === 0
      ? 'RATIO_KIS_REFRESH_ELIGIBILITY_READY'
      : 'RATIO_KIS_REFRESH_ELIGIBILITY_REVIEW';

  const report = {
    version:
      VERSION,

    status,

    source: {
      inputVersion:
        input.version,

      inputFingerprint:
        input.outputFingerprint,
    },

    policy: {
      evidenceSnapshotAsOf:
        SNAPSHOT_AS_OF,

      canonicalEventPersistence:
        'ANNOUNCED_RATIO_EVENT_MAY_REMAIN_PERSISTED',

      factorPersistence:
        'ANNOUNCED_RATIO_FACTOR_MAY_REMAIN_PERSISTED',

      kisHistoryRefresh:
        'ONLY_IF_EFFECTIVE_DATE_LTE_EVIDENCE_SNAPSHOT',

      futureRatioAction:
        'DEFER_KIS_REFRESH_UNTIL_NEXT_INCREMENTAL_REFRESH_RECONFIRMS_EVENT_AFTER_EFFECTIVE_DATE',

      canonicalBarPolicy:
        'REQUERY_KIS_ADJUSTED_HISTORY_NEVER_MULTIPLY_FACTOR_INTO_CANONICAL_ADJUSTED_BARS',
    },

    counts: {
      inputRatioRefreshRows:
        input.ratioRefreshPlan.length,

      eligibleNow:
        eligibleNow.length,

      futureDeferred:
        futureDeferred.length,

      eligibleDistinctStocks:
        new Set(
          eligibleNow.map(
            (row) =>
              row.stockCode,
          ),
        ).size,

      futureDeferredDistinctStocks:
        new Set(
          futureDeferred.map(
            (row) =>
              row.stockCode,
          ),
        ).size,

      eligibleReverseSplits:
        eligibleNow.filter(
          (row) =>
            row.actionType ===
            'REVERSE_SPLIT',
        ).length,

      eligibleStockSplits:
        eligibleNow.filter(
          (row) =>
            row.actionType ===
            'STOCK_SPLIT',
        ).length,

      futureReverseSplits:
        futureDeferred.filter(
          (row) =>
            row.actionType ===
            'REVERSE_SPLIT',
        ).length,

      futureStockSplits:
        futureDeferred.filter(
          (row) =>
            row.actionType ===
            'STOCK_SPLIT',
        ).length,

      duplicateEligibleStocks:
        duplicateStocks,

      duplicateFutureStocks:
        futureDuplicateStocks,

      accountingDelta,
    },

    eligibleActionTypeCounts:
      countBy(
        eligibleNow,
        (row) =>
          row.actionType,
      ),

    futureActionTypeCounts:
      countBy(
        futureDeferred,
        (row) =>
          row.actionType,
      ),

    eligibleRefreshPlan:
      eligibleNow
        .slice()
        .sort(
          (a, b) =>
            `${a.effectiveDate}|${a.stockCode}`
              .localeCompare(
                `${b.effectiveDate}|${b.stockCode}`,
              ),
        ),

    futureDeferredPlan:
      futureDeferred
        .slice()
        .sort(
          (a, b) =>
            `${a.effectiveDate}|${a.stockCode}`
              .localeCompare(
                `${b.effectiveDate}|${b.stockCode}`,
              ),
        )
        .map(
          (row) => ({
            ...row,

            disposition:
              'DEFER_KIS_REFRESH_UNTIL_EFFECTIVE_AND_RECONFIRMED',
          }),
        ),

    safety: {
      databaseReads:
        0,

      databaseWrites:
        0,

      kisRequests:
        0,

      marketDailyBarsModified:
        0,

      corporateActionFactorsAppliedToCanonicalBars:
        0,

      coverageWindowAdvanced:
        false,
    },

    nextGate:
      status ===
      'RATIO_KIS_REFRESH_ELIGIBILITY_READY'
        ? 'BUILD_EXISTING_MARKET_DAILY_BAR_COVERAGE_PREFLIGHT_FOR_ELIGIBLE_RATIO_STOCKS'
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

        snapshotAsOf:
          SNAPSHOT_AS_OF,

        inputFingerprint:
          report.source
            .inputFingerprint,

        eligible:
          report.eligibleRefreshPlan
            .map(
              (row) => [
                row.stockCode,
                row.providerEventId,
                row.actionType,
                row.effectiveDate,
              ],
            ),

        future:
          report.futureDeferredPlan
            .map(
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
          VERSION,

        evidenceSnapshotAsOf:
          SNAPSHOT_AS_OF,

        ...report.counts,

        eligibleActionTypeCounts:
          report.eligibleActionTypeCounts,

        futureActionTypeCounts:
          report.futureActionTypeCounts,

        futureDeferredPlan:
          report.futureDeferredPlan
            .map(
              (row) => ({
                stockCode:
                  row.stockCode,

                providerEventId:
                  row.providerEventId,

                actionType:
                  row.actionType,

                effectiveDate:
                  row.effectiveDate,

                disposition:
                  row.disposition,
              }),
            ),

        databaseWrites:
          0,

        kisRequests:
          0,

        marketDailyBarsModified:
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
    'RATIO_KIS_REFRESH_ELIGIBILITY_READY'
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
      },
      null,
      2,
    ),
  );

  process.exitCode =
    1;
}
