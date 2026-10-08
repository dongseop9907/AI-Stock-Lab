#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * V9.8.11.10.2.1 replay
 *
 * Coverage disposition repair for unsupported canonical-bar surfaces.
 *
 * READ ONLY.
 * - no DB access
 * - no DB writes
 * - no KIS calls
 * - no market_daily_bars writes
 *
 * Policy correction preserved from historical V9.8.11.10.2.1:
 * Existing canonical-bar refresh is required only when canonical bars exist.
 *
 * Known zero-surface stocks:
 *   900110
 *   900270
 *
 * They are classified as NO_CANONICAL_BAR_SURFACE, not as blockers.
 * Remaining covered stocks must be canonical adjusted-only surfaces.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_8_11_10_2_1_REPLAY_RATIO_REFRESH_COVERAGE_DISPOSITION_REPAIR';

const INPUT_VERSION =
  'V9_8_11_10_2_REPLAY_RATIO_MARKET_DAILY_BAR_COVERAGE_PREFLIGHT';

const EXPECTED_INPUT_ROWS = 18;
const EXPECTED_REFRESHABLE = 16;
const EXPECTED_NO_SURFACE = 2;

const EXPECTED_NO_SURFACE_CODES =
  new Set([
    '900110',
    '900270',
  ]);

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''),
  );
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(value)
    .digest('hex');
}

function atomicSaveJson(file, value) {
  fs.mkdirSync(
    path.dirname(file),
    { recursive: true },
  );

  const tmp =
    `${file}.tmp-${process.pid}-${Date.now()}`;

  fs.writeFileSync(
    tmp,
    JSON.stringify(value, null, 2) + '\n',
    'utf8',
  );

  fs.renameSync(
    tmp,
    file,
  );
}

function main() {
  const root =
    path.resolve(__dirname, '..');

  const inputFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-ratio-refresh-coverage-preflight-v9-8-11-10-2-replay.json',
    );

  const outputFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-ratio-refresh-coverage-disposition-v9-8-11-10-2-1-replay.json',
    );

  assert(
    fs.existsSync(inputFile),
    `INPUT_NOT_FOUND:${path.basename(inputFile)}`,
  );

  const input =
    readJson(inputFile);

  assert(
    input.version ===
      INPUT_VERSION,
    `INPUT_VERSION_MISMATCH:${input.version}`,
  );

  assert(
    [
      'RATIO_MARKET_DAILY_BAR_COVERAGE_PREFLIGHT_READY',
      'RATIO_MARKET_DAILY_BAR_COVERAGE_PREFLIGHT_BLOCKED',
    ].includes(input.status),
    `INPUT_STATUS_UNEXPECTED:${input.status}`,
  );

  assert(
    Array.isArray(
      input.refreshPlan,
    ),
    'REFRESH_PLAN_MISSING',
  );

  assert(
    input.refreshPlan.length ===
      EXPECTED_INPUT_ROWS,
    `EXPECTED_18_REFRESH_PLAN_ROWS:${input.refreshPlan.length}`,
  );

  const refreshable =
    input.refreshPlan.filter(
      (row) =>
        Number(
          row.totalRowsThroughSnapshot,
        ) > 0 &&
        Boolean(
          row.refreshStart,
        ) &&
        Boolean(
          row.refreshEnd,
        ),
    );

  const noSurface =
    input.refreshPlan.filter(
      (row) =>
        Number(
          row.totalRowsThroughSnapshot,
        ) === 0,
    );

  const unexpectedNoSurface =
    noSurface.filter(
      (row) =>
        !EXPECTED_NO_SURFACE_CODES.has(
          String(row.stockCode),
        ),
    );

  const missingExpectedNoSurface =
    [...EXPECTED_NO_SURFACE_CODES]
      .filter(
        (stockCode) =>
          !noSurface.some(
            (row) =>
              String(row.stockCode) ===
              stockCode,
          ),
      );

  const coveredWithUnadjusted =
    refreshable.filter(
      (row) =>
        Number(
          row.unadjustedRowsThroughSnapshot ??
          0,
        ) > 0 ||
        Number(
          row.nullAdjustedFlagRowsThroughSnapshot ??
          0,
        ) > 0 ||
        Number(
          row.adjustedRowsThroughSnapshot ??
          0,
        ) !==
        Number(
          row.totalRowsThroughSnapshot ??
          0,
        ),
    );

  const invalidRefreshableRanges =
    refreshable.filter(
      (row) =>
        !row.refreshStart ||
        !row.refreshEnd ||
        row.refreshStart >
          row.refreshEnd,
    );

  const duplicateRefreshableStocks =
    refreshable.length -
    new Set(
      refreshable.map(
        (row) =>
          String(row.stockCode),
      ),
    ).size;

  const duplicateNoSurfaceStocks =
    noSurface.length -
    new Set(
      noSurface.map(
        (row) =>
          String(row.stockCode),
      ),
    ).size;

  const accountingDelta =
    EXPECTED_INPUT_ROWS -
    (
      refreshable.length +
      noSurface.length
    );

  const estimatedKisRequests =
    refreshable.reduce(
      (sum, row) =>
        sum +
        Number(
          row.estimatedKisRequests ??
          0,
        ),
      0,
    );

  const blockers = [];

  if (
    refreshable.length !==
    EXPECTED_REFRESHABLE
  ) {
    blockers.push(
      'EXPECTED_16_REFRESHABLE_STOCKS',
    );
  }

  if (
    noSurface.length !==
    EXPECTED_NO_SURFACE
  ) {
    blockers.push(
      'EXPECTED_2_NO_CANONICAL_BAR_SURFACE_STOCKS',
    );
  }

  if (
    unexpectedNoSurface.length > 0
  ) {
    blockers.push(
      'UNEXPECTED_NO_CANONICAL_BAR_SURFACE_STOCK',
    );
  }

  if (
    missingExpectedNoSurface.length > 0
  ) {
    blockers.push(
      'EXPECTED_NO_SURFACE_STOCK_MISSING',
    );
  }

  if (
    coveredWithUnadjusted.length > 0
  ) {
    blockers.push(
      'REFRESHABLE_CANONICAL_WINDOW_CONTAINS_UNADJUSTED_ROWS',
    );
  }

  if (
    invalidRefreshableRanges.length > 0
  ) {
    blockers.push(
      'INVALID_REFRESHABLE_RANGE',
    );
  }

  if (
    duplicateRefreshableStocks !== 0 ||
    duplicateNoSurfaceStocks !== 0
  ) {
    blockers.push(
      'DUPLICATE_COVERAGE_DISPOSITION_STOCKS',
    );
  }

  if (
    accountingDelta !== 0
  ) {
    blockers.push(
      `ACCOUNTING_DELTA_${accountingDelta}`,
    );
  }

  const originalInputBlockers =
    Array.isArray(input.blockers)
      ? input.blockers
      : [];

  const expectedRawBlockerOnly =
    input.status ===
      'RATIO_MARKET_DAILY_BAR_COVERAGE_PREFLIGHT_BLOCKED' &&
    originalInputBlockers.length === 1 &&
    originalInputBlockers[0] ===
      'NO_EXISTING_CANONICAL_MARKET_DAILY_BARS';

  if (
    input.status ===
      'RATIO_MARKET_DAILY_BAR_COVERAGE_PREFLIGHT_BLOCKED' &&
    !expectedRawBlockerOnly
  ) {
    blockers.push(
      'INPUT_BLOCKED_FOR_UNEXPECTED_REASON',
    );
  }

  const status =
    blockers.length === 0
      ? 'RATIO_REFRESH_COVERAGE_DISPOSITION_READY'
      : 'RATIO_REFRESH_COVERAGE_DISPOSITION_BLOCKED';

  const refreshablePlan =
    refreshable
      .slice()
      .sort(
        (a, b) =>
          `${a.refreshStart}|${a.stockCode}`
            .localeCompare(
              `${b.refreshStart}|${b.stockCode}`,
            ),
      );

  const noCanonicalBarSurface =
    noSurface
      .slice()
      .sort(
        (a, b) =>
          String(a.stockCode)
            .localeCompare(
              String(b.stockCode),
            ),
      )
      .map(
        (row) => ({
          stockCode:
            row.stockCode,

          providerEventId:
            row.providerEventId,

          eventId:
            row.eventId,

          actionType:
            row.actionType,

          effectiveDate:
            row.effectiveDate,

          totalRowsThroughSnapshot:
            row.totalRowsThroughSnapshot,

          disposition:
            'NO_CANONICAL_BAR_SURFACE',

          refreshRequired:
            false,

          reason:
            'NO_EXISTING_MARKET_DAILY_BARS_TO_REFRESH',

          futureHandling:
            'DEFER_TO_DEDICATED_OTHER_SECURITY_BACKFILL_PATH',
        }),
      );

  const report = {
    status,
    version: VERSION,

    source: {
      inputVersion:
        input.version,

      inputFingerprint:
        input.outputFingerprint ?? null,

      inputStatus:
        input.status,

      expectedRawBlockerOnly,
    },

    policy: {
      existingCanonicalHistory:
        'REFRESH_REQUIRED',

      noCanonicalBarSurface:
        'NO_REFRESH_REQUIRED_BECAUSE_THERE_IS_NO_EXISTING_CANONICAL_HISTORY_TO_REVISE',

      noSurfaceFutureHandling:
        'DEFER_TO_DEDICATED_OTHER_SECURITY_BACKFILL_PATH',

      canonicalBarsMustBeAdjusted:
        true,

      applyCorporateActionFactorToCanonicalBars:
        false,
    },

    counts: {
      inputRows:
        input.refreshPlan.length,

      refreshableStocks:
        refreshablePlan.length,

      noCanonicalBarSurfaceStocks:
        noCanonicalBarSurface.length,

      refreshableStocksWithUnadjustedRows:
        coveredWithUnadjusted.length,

      invalidRefreshableRanges:
        invalidRefreshableRanges.length,

      duplicateRefreshableStocks,

      duplicateNoSurfaceStocks,

      accountingDelta,

      estimatedKisRequests,

      blockers:
        blockers.length,
    },

    refreshablePlan,

    noCanonicalBarSurface,

    diagnostics: {
      unexpectedNoSurface:
        unexpectedNoSurface.map(
          (row) =>
            row.stockCode,
        ),

      missingExpectedNoSurface,

      coveredWithUnadjusted:
        coveredWithUnadjusted.map(
          (row) => ({
            stockCode:
              row.stockCode,

            totalRowsThroughSnapshot:
              row.totalRowsThroughSnapshot,

            adjustedRowsThroughSnapshot:
              row.adjustedRowsThroughSnapshot,

            unadjustedRowsThroughSnapshot:
              row.unadjustedRowsThroughSnapshot,

            nullAdjustedFlagRowsThroughSnapshot:
              row.nullAdjustedFlagRowsThroughSnapshot,
          }),
        ),

      invalidRefreshableRanges:
        invalidRefreshableRanges.map(
          (row) => ({
            stockCode:
              row.stockCode,

            refreshStart:
              row.refreshStart,

            refreshEnd:
              row.refreshEnd,
          }),
        ),
    },

    blockers,

    safety: {
      networkRequests: 0,
      databaseReads: 0,
      databaseWrites: 0,
      kisRequests: 0,
      marketDailyBarsModified: 0,
      corporateActionFactorsAppliedToCanonicalBars:
        0,
      productionApplied:
        false,
    },

    nextGate:
      status ===
      'RATIO_REFRESH_COVERAGE_DISPOSITION_READY'
        ? 'INSPECT_NEXT_HISTORICAL_STAGE_BEFORE_ANY_KIS_REFRESH_APPLY'
        : 'STOP_AND_REVIEW',

    outputFile:
      'logs/opendart-corporate-action-ratio-refresh-coverage-disposition-v9-8-11-10-2-1-replay.json',
  };

  report.outputFingerprint =
    sha256(
      JSON.stringify({
        version:
          report.version,

        status:
          report.status,

        inputFingerprint:
          report.source.inputFingerprint,

        refreshable:
          refreshablePlan.map(
            (row) => [
              row.stockCode,
              row.providerEventId,
              row.actionType,
              row.effectiveDate,
              row.refreshStart,
              row.refreshEnd,
              row.totalRowsThroughSnapshot,
              row.estimatedKisRequests,
            ],
          ),

        noSurface:
          noCanonicalBarSurface.map(
            (row) => [
              row.stockCode,
              row.providerEventId,
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

        ...report.counts,

        refreshableStocks:
          refreshablePlan.map(
            (row) =>
              row.stockCode,
          ),

        noCanonicalBarSurface:
          report.noCanonicalBarSurface,

        diagnostics:
          report.diagnostics,

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
    'RATIO_REFRESH_COVERAGE_DISPOSITION_READY'
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
          'RATIO_REFRESH_COVERAGE_DISPOSITION_FAILED',

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
