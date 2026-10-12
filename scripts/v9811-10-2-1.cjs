/* eslint-disable no-console */
'use strict';

/**
 * AI Stock Lab
 * V9.8.11.10.2.1
 * Coverage disposition repair for unsupported canonical-bar surfaces
 *
 * READ-ONLY.
 * - no DB access
 * - no KIS calls
 * - no market_daily_bars writes
 *
 * Inputs:
 *   logs/opendart-corporate-action-ratio-refresh-coverage-preflight-v9-8-11-10-2.json
 *
 * Output:
 *   logs/opendart-corporate-action-ratio-refresh-coverage-disposition-v9-8-11-10-2-1.json
 *
 * Policy correction:
 *   Existing canonical-bar refresh is only required when canonical bars exist.
 *
 *   If a corporate-action stock has:
 *     - totalRowsThroughSnapshot = 0
 *     - no refreshStart
 *
 *   then there is no canonical market_daily_bars history to refresh.
 *   Such stocks are classified as NO_CANONICAL_BAR_SURFACE, not as a blocker
 *   for refreshing the remaining covered stocks.
 *
 * Current known unsupported/no-surface stocks:
 *   900110
 *   900270
 *
 * These remain deferred for any future dedicated OTHER-security backfill path.
 *
 * Run:
 *   node .\scripts\v9811-10-2-1.cjs
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_8_11_10_2_1_RATIO_REFRESH_COVERAGE_DISPOSITION_REPAIR';

const INPUT_VERSION =
  'V9_8_11_10_2_RATIO_MARKET_DAILY_BAR_COVERAGE_PREFLIGHT';

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

function main() {
  const root =
    path.resolve(__dirname, '..');

  const inputFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-ratio-refresh-coverage-preflight-v9-8-11-10-2.json',
    );

  const outputFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-ratio-refresh-coverage-disposition-v9-8-11-10-2-1.json',
    );

  if (!fs.existsSync(inputFile)) {
    throw new Error(
      `INPUT_NOT_FOUND:${path.basename(inputFile)}`,
    );
  }

  const input =
    readJson(inputFile);

  if (input.version !== INPUT_VERSION) {
    throw new Error(
      'INPUT_VERSION_MISMATCH',
    );
  }

  if (
    !Array.isArray(input.refreshPlan) ||
    input.refreshPlan.length !== EXPECTED_INPUT_ROWS
  ) {
    throw new Error(
      'EXPECTED_18_REFRESH_PLAN_ROWS',
    );
  }

  const noSurface =
    input.refreshPlan.filter(
      (row) =>
        row.totalRowsThroughSnapshot === 0 &&
        row.refreshStart === null &&
        row.refreshEnd === null,
    );

  const refreshable =
    input.refreshPlan.filter(
      (row) =>
        row.totalRowsThroughSnapshot > 0 &&
        typeof row.refreshStart === 'string' &&
        typeof row.refreshEnd === 'string',
    );

  const unexpectedNoSurface =
    noSurface.filter(
      (row) =>
        !EXPECTED_NO_SURFACE_CODES.has(row.stockCode),
    );

  const missingExpectedNoSurface =
    [...EXPECTED_NO_SURFACE_CODES]
      .filter(
        (stockCode) =>
          !noSurface.some(
            (row) =>
              row.stockCode === stockCode,
          ),
      );

  const coveredWithUnadjusted =
    refreshable.filter(
      (row) =>
        row.unadjustedRowsThroughSnapshot > 0,
    );

  const duplicateRefreshableStocks =
    refreshable.length -
    new Set(
      refreshable.map(
        (row) => row.stockCode,
      ),
    ).size;

  const duplicateNoSurfaceStocks =
    noSurface.length -
    new Set(
      noSurface.map(
        (row) => row.stockCode,
      ),
    ).size;

  const accountingDelta =
    input.refreshPlan.length -
    (
      refreshable.length +
      noSurface.length
    );

  const estimatedKisRequests =
    refreshable.reduce(
      (sum, row) =>
        sum +
        Number(row.estimatedKisRequests ?? 0),
      0,
    );

  const blockers = [];

  if (
    refreshable.length !== EXPECTED_REFRESHABLE
  ) {
    blockers.push(
      'EXPECTED_16_REFRESHABLE_STOCKS',
    );
  }

  if (
    noSurface.length !== EXPECTED_NO_SURFACE
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
    duplicateRefreshableStocks !== 0 ||
    duplicateNoSurfaceStocks !== 0
  ) {
    blockers.push(
      'DUPLICATE_STOCK_DISPOSITION',
    );
  }

  if (accountingDelta !== 0) {
    blockers.push(
      'DISPOSITION_ACCOUNTING_MISMATCH',
    );
  }

  const status =
    blockers.length === 0
      ? 'RATIO_REFRESH_COVERAGE_DISPOSITION_READY'
      : 'RATIO_REFRESH_COVERAGE_DISPOSITION_BLOCKED';

  const report = {
    version: VERSION,
    status,

    source: {
      inputVersion:
        input.version,

      inputFingerprint:
        input.outputFingerprint,
    },

    policy: {
      existingCanonicalBarsRequiredForRefresh:
        true,

      noCanonicalBarSurface:
        'NO_REFRESH_REQUIRED_BECAUSE_THERE_IS_NO_EXISTING_CANONICAL_HISTORY_TO_REVISE',

      noSurfaceFutureHandling:
        'DEFER_TO_DEDICATED_OTHER_SECURITY_BACKFILL_OR_FUTURE_SUPPORTED_MARKET_DATA_PATH',

      canonicalBarPolicy:
        'KIS_ADJUSTED_ONLY_NEVER_MULTIPLY_CORPORATE_ACTION_FACTOR',
    },

    counts: {
      inputStocks:
        input.refreshPlan.length,

      refreshableStocks:
        refreshable.length,

      noCanonicalBarSurfaceStocks:
        noSurface.length,

      refreshableStocksWithUnadjustedRows:
        coveredWithUnadjusted.length,

      duplicateRefreshableStocks,

      duplicateNoSurfaceStocks,

      accountingDelta,

      estimatedKisRequests,
    },

    blockers,

    refreshablePlan:
      refreshable
        .slice()
        .sort(
          (a, b) =>
            `${a.effectiveDate}|${a.stockCode}`
              .localeCompare(
                `${b.effectiveDate}|${b.stockCode}`,
              ),
        ),

    noCanonicalBarSurface:
      noSurface
        .slice()
        .sort(
          (a, b) =>
            a.stockCode.localeCompare(
              b.stockCode,
            ),
        )
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

            totalRowsThroughSnapshot:
              row.totalRowsThroughSnapshot,

            disposition:
              'NO_CANONICAL_BAR_SURFACE_DEFER',

            reason:
              'NO_EXISTING_MARKET_DAILY_BARS_TO_REFRESH',
          }),
        ),

    diagnostics: {
      unexpectedNoSurface:
        unexpectedNoSurface.map(
          (row) => row.stockCode,
        ),

      missingExpectedNoSurface,

      coveredWithUnadjusted:
        coveredWithUnadjusted.map(
          (row) => row.stockCode,
        ),
    },

    safety: {
      databaseReads: 0,
      databaseWrites: 0,
      kisRequests: 0,
      marketDailyBarsModified: 0,
      corporateActionFactorsAppliedToCanonicalBars: 0,
      coverageWindowAdvanced: false,
    },

    nextGate:
      status ===
      'RATIO_REFRESH_COVERAGE_DISPOSITION_READY'
        ? 'BUILD_16_STOCK_KIS_ADJUSTED_HISTORY_REFRESH_APPLY'
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

        status:
          report.status,

        inputFingerprint:
          report.source.inputFingerprint,

        refreshable:
          report.refreshablePlan.map(
            (row) => [
              row.stockCode,
              row.providerEventId,
              row.actionType,
              row.effectiveDate,
              row.refreshStart,
              row.refreshEnd,
            ],
          ),

        noSurface:
          report.noCanonicalBarSurface.map(
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
          VERSION,

        ...report.counts,

        blockers:
          report.blockers,

        noCanonicalBarSurface:
          report.noCanonicalBarSurface,

        databaseWrites: 0,
        kisRequests: 0,
        marketDailyBarsModified: 0,

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

        databaseWrites: 0,
        kisRequests: 0,
      },
      null,
      2,
    ),
  );

  process.exitCode = 1;
}
