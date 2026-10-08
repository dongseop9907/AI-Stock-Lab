/* eslint-disable no-console */
'use strict';

/**
 * AI Stock Lab
 * V9.8.11.13 - Corporate-action cycle closure audit
 *
 * READ-ONLY.
 * - no DB writes
 * - no KIS calls
 *
 * Inputs:
 *   logs/opendart-corporate-action-128-event-id-map-v9-8-11-7.json
 *   logs/opendart-corporate-action-adjustment-persistence-apply-v9-8-11-9.json
 *   logs/opendart-corporate-action-ratio-refresh-eligibility-v9-8-11-10-1.json
 *   logs/opendart-corporate-action-ratio-refresh-coverage-disposition-v9-8-11-10-2-1.json
 *   logs/opendart-corporate-action-ratio-refresh-direct-apply-v9-8-11-11-1.json
 *   logs/opendart-corporate-action-post-refresh-vendor-verification-v9-8-11-12.json
 *
 * Output:
 *   logs/opendart-corporate-action-cycle-closure-v9-8-11-13.json
 *
 * Purpose:
 *   Close the current production-eligible v9.8 corporate-action cycle at
 *   evidence snapshot 2026-10-01 without advancing any external/global
 *   coverage marker yet.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_8_11_13_CORPORATE_ACTION_CYCLE_CLOSURE_AUDIT';

const SNAPSHOT_AS_OF =
  '2026-10-01';

const EXPECTED = {
  currentBatchEvents: 128,
  factorReadyEvents: 121,
  structuralBlockedEvents: 7,
  runs: 128,
  factors: 121,
  ratioRefreshCandidates: 42,
  ratioEligibleAtSnapshot: 18,
  futureRatioDeferred: 24,
  refreshableWithSurface: 16,
  noCanonicalBarSurface: 2,
  vendorVerifiedStocks: 16,
  vendorVerifiedRows: 656,
};

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''),
  );
}

function atomicSaveJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(value)
    .digest('hex');
}

function requireFile(root, relative) {
  const file = path.join(root, relative);

  if (!fs.existsSync(file)) {
    throw new Error(`INPUT_NOT_FOUND:${relative}`);
  }

  return readJson(file);
}

function pick(obj, paths, fallback = null) {
  for (const candidate of paths) {
    let value = obj;
    let ok = true;

    for (const key of candidate.split('.')) {
      if (
        value === null ||
        value === undefined ||
        !(key in Object(value))
      ) {
        ok = false;
        break;
      }

      value = value[key];
    }

    if (ok && value !== undefined) {
      return value;
    }
  }

  return fallback;
}

function assertEq(actual, expected, label, issues) {
  if (actual !== expected) {
    issues.push({
      check: label,
      actual,
      expected,
    });
  }
}

function main() {
  const root = path.resolve(__dirname, '..');

  const files = {
    eventMap: requireFile(
      root,
      'logs/opendart-corporate-action-128-event-id-map-v9-8-11-7.json',
    ),

    persistence: requireFile(
      root,
      'logs/opendart-corporate-action-adjustment-persistence-apply-v9-8-11-9.json',
    ),

    eligibility: requireFile(
      root,
      'logs/opendart-corporate-action-ratio-refresh-eligibility-v9-8-11-10-1.json',
    ),

    disposition: requireFile(
      root,
      'logs/opendart-corporate-action-ratio-refresh-coverage-disposition-v9-8-11-10-2-1.json',
    ),

    refreshApply: requireFile(
      root,
      'logs/opendart-corporate-action-ratio-refresh-direct-apply-v9-8-11-11-1.json',
    ),

    vendorVerification: requireFile(
      root,
      'logs/opendart-corporate-action-post-refresh-vendor-verification-v9-8-11-12.json',
    ),
  };

  const outputFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-cycle-closure-v9-8-11-13.json',
  );

  const issues = [];

  // ---- Status/version closure.
  assertEq(
    files.eventMap.status,
    'POST_INSERT_128_EVENT_VERIFICATION_COMPLETE',
    'event_map_status',
    issues,
  );

  assertEq(
    files.persistence.status,
    'ADJUSTMENT_PERSISTENCE_APPLY_COMPLETE',
    'persistence_status',
    issues,
  );

  assertEq(
    files.eligibility.status,
    'RATIO_KIS_REFRESH_ELIGIBILITY_READY',
    'ratio_eligibility_status',
    issues,
  );

  assertEq(
    files.disposition.status,
    'RATIO_REFRESH_COVERAGE_DISPOSITION_READY',
    'coverage_disposition_status',
    issues,
  );

  assertEq(
    files.refreshApply.status,
    'DIRECT_KIS_ADJUSTED_HISTORY_REFRESH_APPLY_COMPLETE',
    'refresh_apply_status',
    issues,
  );

  assertEq(
    files.vendorVerification.status,
    'POST_REFRESH_VENDOR_ADJUSTED_VERIFICATION_COMPLETE',
    'vendor_verification_status',
    issues,
  );

  // ---- Event/run/factor accounting.
  const currentBatchEvents =
    pick(
      files.eventMap,
      [
        'counts.currentBatchTargetRows',
        'currentBatchTargetRows',
        'counts.eventMapRows',
        'eventMapRows',
      ],
    );

  const factorReadyEvents =
    pick(
      files.eventMap,
      [
        'counts.factorReadyEvents',
        'factorReadyEvents',
      ],
    );

  const structuralBlockedEvents =
    pick(
      files.eventMap,
      [
        'counts.structuralBlockedEvents',
        'structuralBlockedEvents',
      ],
    );

  const verifiedRuns =
    pick(
      files.persistence,
      [
        'counts.verifiedRuns',
        'verifiedRuns',
      ],
    );

  const verifiedFactors =
    pick(
      files.persistence,
      [
        'counts.verifiedFactors',
        'verifiedFactors',
      ],
    );

  assertEq(
    Number(currentBatchEvents),
    EXPECTED.currentBatchEvents,
    'current_batch_events',
    issues,
  );

  assertEq(
    Number(factorReadyEvents),
    EXPECTED.factorReadyEvents,
    'factor_ready_events',
    issues,
  );

  assertEq(
    Number(structuralBlockedEvents),
    EXPECTED.structuralBlockedEvents,
    'structural_blocked_events',
    issues,
  );

  assertEq(
    Number(verifiedRuns),
    EXPECTED.runs,
    'verified_runs',
    issues,
  );

  assertEq(
    Number(verifiedFactors),
    EXPECTED.factors,
    'verified_factors',
    issues,
  );

  // ---- Ratio refresh disposition.
  const inputRatioRows =
    pick(
      files.eligibility,
      [
        'counts.inputRatioRefreshRows',
        'inputRatioRefreshRows',
      ],
    );

  const eligibleNow =
    pick(
      files.eligibility,
      [
        'counts.eligibleNow',
        'eligibleNow',
      ],
    );

  const futureDeferred =
    pick(
      files.eligibility,
      [
        'counts.futureDeferred',
        'futureDeferred',
      ],
    );

  const refreshableStocks =
    pick(
      files.disposition,
      [
        'counts.refreshableStocks',
        'refreshableStocks',
      ],
    );

  const noSurfaceStocks =
    pick(
      files.disposition,
      [
        'counts.noCanonicalBarSurfaceStocks',
        'noCanonicalBarSurfaceStocks',
      ],
    );

  assertEq(
    Number(inputRatioRows),
    EXPECTED.ratioRefreshCandidates,
    'ratio_refresh_candidates',
    issues,
  );

  assertEq(
    Number(eligibleNow),
    EXPECTED.ratioEligibleAtSnapshot,
    'ratio_eligible_at_snapshot',
    issues,
  );

  assertEq(
    Number(futureDeferred),
    EXPECTED.futureRatioDeferred,
    'future_ratio_deferred',
    issues,
  );

  assertEq(
    Number(refreshableStocks),
    EXPECTED.refreshableWithSurface,
    'refreshable_with_surface',
    issues,
  );

  assertEq(
    Number(noSurfaceStocks),
    EXPECTED.noCanonicalBarSurface,
    'no_canonical_bar_surface',
    issues,
  );

  // ---- Refresh application closure.
  const completedStocks =
    pick(
      files.refreshApply,
      [
        'safety.completedStocks',
        'counts.completedStocks',
      ],
      Array.isArray(files.refreshApply.completed)
        ? files.refreshApply.completed.length
        : null,
    );

  const refreshedUnadjusted =
    Array.isArray(files.refreshApply.completed)
      ? files.refreshApply.completed.filter(
          (row) =>
            Number(row?.after?.unadjustedCount ?? 0) !== 0,
        ).length
      : null;

  assertEq(
    Number(completedStocks),
    EXPECTED.refreshableWithSurface,
    'refresh_completed_stocks',
    issues,
  );

  assertEq(
    Number(refreshedUnadjusted),
    0,
    'post_refresh_unadjusted_stocks',
    issues,
  );

  // ---- Vendor verification closure.
  const verifiedStocks =
    pick(
      files.vendorVerification,
      [
        'counts.stocks',
        'stocks',
      ],
    );

  const matchedStocks =
    pick(
      files.vendorVerification,
      [
        'counts.matchedStocks',
        'matchedStocks',
      ],
    );

  const mismatchedStocks =
    pick(
      files.vendorVerification,
      [
        'counts.mismatchedStocks',
        'mismatchedStocks',
      ],
    );

  const totalVendorRows =
    pick(
      files.vendorVerification,
      [
        'counts.totalVendorRows',
        'totalVendorRows',
      ],
    );

  const totalCanonicalRows =
    pick(
      files.vendorVerification,
      [
        'counts.totalCanonicalRows',
        'totalCanonicalRows',
      ],
    );

  const missingInDb =
    pick(
      files.vendorVerification,
      [
        'counts.missingInDb',
        'missingInDb',
      ],
    );

  const missingAtVendor =
    pick(
      files.vendorVerification,
      [
        'counts.missingAtVendor',
        'missingAtVendor',
      ],
    );

  const valueMismatches =
    pick(
      files.vendorVerification,
      [
        'counts.valueMismatches',
        'valueMismatches',
      ],
    );

  const sourceMismatches =
    pick(
      files.vendorVerification,
      [
        'counts.sourceMismatches',
        'sourceMismatches',
      ],
    );

  const adjustedFlagMismatches =
    pick(
      files.vendorVerification,
      [
        'counts.adjustedFlagMismatches',
        'adjustedFlagMismatches',
      ],
    );

  assertEq(
    Number(verifiedStocks),
    EXPECTED.vendorVerifiedStocks,
    'vendor_verified_stocks',
    issues,
  );

  assertEq(
    Number(matchedStocks),
    EXPECTED.vendorVerifiedStocks,
    'vendor_matched_stocks',
    issues,
  );

  assertEq(
    Number(mismatchedStocks),
    0,
    'vendor_mismatched_stocks',
    issues,
  );

  assertEq(
    Number(totalVendorRows),
    EXPECTED.vendorVerifiedRows,
    'vendor_rows',
    issues,
  );

  assertEq(
    Number(totalCanonicalRows),
    EXPECTED.vendorVerifiedRows,
    'canonical_verified_rows',
    issues,
  );

  for (const [label, value] of [
    ['missing_in_db', missingInDb],
    ['missing_at_vendor', missingAtVendor],
    ['value_mismatches', valueMismatches],
    ['source_mismatches', sourceMismatches],
    ['adjusted_flag_mismatches', adjustedFlagMismatches],
  ]) {
    assertEq(
      Number(value),
      0,
      label,
      issues,
    );
  }

  // ---- Deferred work to carry into the next incremental cycle.
  const futureRatioPlan =
    Array.isArray(files.eligibility.futureDeferredPlan)
      ? files.eligibility.futureDeferredPlan
      : [];

  const noSurfacePlan =
    Array.isArray(files.disposition.noCanonicalBarSurface)
      ? files.disposition.noCanonicalBarSurface
      : [];

  assertEq(
    futureRatioPlan.length,
    EXPECTED.futureRatioDeferred,
    'future_ratio_plan_rows',
    issues,
  );

  assertEq(
    noSurfacePlan.length,
    EXPECTED.noCanonicalBarSurface,
    'no_surface_plan_rows',
    issues,
  );

  const snapshotEligibleClosure =
    issues.length === 0;

  const status =
    snapshotEligibleClosure
      ? 'V9_8_CURRENT_CYCLE_CLOSED_AT_2026_10_01'
      : 'V9_8_CURRENT_CYCLE_CLOSURE_BLOCKED';

  const report = {
    version: VERSION,
    status,

    evidenceSnapshotAsOf:
      SNAPSHOT_AS_OF,

    closure: {
      currentProductionEligibleBatchClosed:
        snapshotEligibleClosure,

      canonicalEventPersistenceClosed:
        snapshotEligibleClosure,

      adjustmentRunFactorPersistenceClosed:
        snapshotEligibleClosure,

      ratioHistoryRefreshClosedForEligibleCanonicalSurfaces:
        snapshotEligibleClosure,

      vendorAdjustedVerificationClosed:
        snapshotEligibleClosure,

      globalCoverageMarkerAdvanced:
        false,

      safeCoverageStatement:
        snapshotEligibleClosure
          ? 'CORPORATE_ACTION_PIPELINE_PROCESSED_AND_VERIFIED_THROUGH_EVIDENCE_SNAPSHOT_2026_10_01_FOR_CURRENTLY_ELIGIBLE_SUPPORTED_SURFACES'
          : null,

      notClaimed:
        [
          'GLOBAL_HISTORICAL_UNIFORMITY',
          'FUTURE_ACTION_FINALITY',
          'GENERIC_STRUCTURAL_ACTION_FACTORS',
          'CANONICAL_BAR_SUPPORT_FOR_900110_900270',
          'COVERAGE_BEYOND_2026_10_01',
        ],
    },

    accounting: {
      currentBatchEvents:
        Number(currentBatchEvents),

      factorReadyEvents:
        Number(factorReadyEvents),

      structuralBlockedEvents:
        Number(structuralBlockedEvents),

      adjustmentRuns:
        Number(verifiedRuns),

      adjustmentFactors:
        Number(verifiedFactors),

      ratioRefreshCandidates:
        Number(inputRatioRows),

      ratioEligibleAtSnapshot:
        Number(eligibleNow),

      futureRatioDeferred:
        Number(futureDeferred),

      refreshableCanonicalSurfaces:
        Number(refreshableStocks),

      noCanonicalBarSurface:
        Number(noSurfaceStocks),

      refreshedStocks:
        Number(completedStocks),

      vendorVerifiedStocks:
        Number(verifiedStocks),

      vendorVerifiedRows:
        Number(totalVendorRows),
    },

    carryForward: {
      futureRatioActions:
        futureRatioPlan.map(
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
              'RECONFIRM_AFTER_EFFECTIVE_DATE_BEFORE_KIS_REFRESH',
          }),
        ),

      noCanonicalBarSurface:
        noSurfacePlan.map(
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
              'DEFER_UNTIL_OTHER_SECURITY_CANONICAL_BAR_PATH_EXISTS',
          }),
        ),

      futureStructuralActions:
        {
          count:
            30,

          disposition:
            'RECONFIRM_IN_NEXT_INCREMENTAL_DART_CYCLE_BEFORE_PRODUCTION_ELIGIBILITY',
        },

      futureCashDividend:
        {
          stockCode:
            '478560',

          status:
            'FUTURE_PENDING',

          disposition:
            'REVISIT_WHEN_RECORD_DATE_AND_EFFECTIVE_TRADING_DATE_ARE_REACHED',
        },
    },

    issues,

    sourceFingerprints: {
      eventMap:
        files.eventMap.outputFingerprint ?? null,

      persistence:
        files.persistence.outputFingerprint ?? null,

      eligibility:
        files.eligibility.outputFingerprint ?? null,

      disposition:
        files.disposition.outputFingerprint ?? null,

      refreshApply:
        files.refreshApply.outputFingerprint ?? null,

      vendorVerification:
        files.vendorVerification.outputFingerprint ?? null,
    },

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
      snapshotEligibleClosure
        ? 'START_NEXT_INCREMENTAL_DART_CYCLE_FROM_2026_10_02_WITH_CARRY_FORWARD_RECONFIRMATION'
        : 'STOP_AND_REVIEW',

    outputFile:
      path
        .relative(root, outputFile)
        .replaceAll('\\', '/'),
  };

  report.outputFingerprint =
    sha256(
      JSON.stringify({
        version:
          report.version,

        status:
          report.status,

        evidenceSnapshotAsOf:
          report.evidenceSnapshotAsOf,

        accounting:
          report.accounting,

        futureRatioActions:
          report.carryForward.futureRatioActions.map(
            (row) => [
              row.stockCode,
              row.providerEventId,
              row.effectiveDate,
            ],
          ),

        noCanonicalBarSurface:
          report.carryForward.noCanonicalBarSurface.map(
            (row) => [
              row.stockCode,
              row.providerEventId,
            ],
          ),
      }),
    );

  atomicSaveJson(outputFile, report);

  console.log(
    JSON.stringify(
      {
        status:
          report.status,

        version:
          VERSION,

        evidenceSnapshotAsOf:
          SNAPSHOT_AS_OF,

        ...report.accounting,

        futureStructuralDeferred:
          report.carryForward.futureStructuralActions.count,

        futureCashDividendPending:
          report.carryForward.futureCashDividend.stockCode,

        issues:
          report.issues,

        globalCoverageMarkerAdvanced:
          false,

        databaseWrites:
          0,

        kisRequests:
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

  if (!snapshotEligibleClosure) {
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
          'V9_8_CURRENT_CYCLE_CLOSURE_FAILED',

        version:
          VERSION,

        error:
          String(error?.message ?? error),

        databaseWrites:
          0,

        kisRequests:
          0,

        coverageWindowAdvanced:
          false,
      },
      null,
      2,
    ),
  );

  process.exitCode = 1;
}
