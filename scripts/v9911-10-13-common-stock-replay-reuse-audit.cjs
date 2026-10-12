#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * V9.9.11.10 -> 11.13 common-stock historical reuse audit
 *
 * READ ONLY / LOCAL ARTIFACTS ONLY.
 *
 * Historical write stages are NEVER executed here:
 *   - V9.9.11.9 run/factor persistence apply
 *   - V9.9.11.11.1 ratio-refresh direct apply
 *
 * Those artifacts are read only as historical evidence.
 *
 * Expected incremental business topology:
 *   2 production-eligible events
 *     - 032080 REVERSE_SPLIT -> ratio history refresh candidate
 *     - 039830 CASH_DIVIDEND -> no history refresh
 *
 * Therefore:
 *   ratio refresh candidates = 1
 *   ratio eligible at 2026-10-04 = 1
 *   expected refreshable surface = 1
 *   expected no-surface = 0
 *
 * This audit also requires:
 *   - vendor verification complete
 *   - V9.9 cycle closure at evidence snapshot 2026-10-04
 *   - coverage marker NOT advanced
 *   - no corporate-action factor multiplication into canonical KIS-adjusted bars
 *
 * No network.
 * No DB reads.
 * No DB writes.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_9_11_10_TO_13_REPLAY_READ_ONLY_COMMON_STOCK_REFRESH_CLOSURE_REUSE_AUDIT';

const UPSTREAM_VERSION =
  'V9_9_11_7_8_8_1_REPLAY_READ_ONLY_POST_PERSISTENCE_REUSE_AUDIT';

const UPSTREAM_STATUS =
  'HISTORICAL_V9_9_11_7_8_1_TWO_EVENT_POST_PERSISTENCE_RESULTS_REUSABLE';

const SNAPSHOT_AS_OF = '2026-10-04';

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

  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;

  fs.writeFileSync(
    tmp,
    JSON.stringify(value, null, 2) + '\n',
    'utf8',
  );

  fs.renameSync(tmp, file);
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (
      value !== undefined &&
      value !== null &&
      String(value).trim() !== ''
    ) {
      return value;
    }
  }

  return null;
}

function countField(doc, ...names) {
  for (const name of names) {
    const values = [
      doc?.[name],
      doc?.counts?.[name],
      doc?.accounting?.[name],
      doc?.summary?.[name],
      doc?.closure?.[name],
    ];

    for (const value of values) {
      if (value !== undefined && value !== null) {
        const n = Number(value);
        if (Number.isFinite(n)) return n;
      }
    }
  }

  return null;
}

function arrayField(doc, ...names) {
  for (const name of names) {
    const values = [
      doc?.[name],
      doc?.plan?.[name],
      doc?.coverage?.[name],
      doc?.disposition?.[name],
      doc?.results?.[name],
    ];

    for (const value of values) {
      if (Array.isArray(value)) return value;
    }
  }

  return [];
}

function boolField(doc, ...names) {
  for (const name of names) {
    const values = [
      doc?.[name],
      doc?.safety?.[name],
      doc?.closure?.[name],
      doc?.policy?.[name],
    ];

    for (const value of values) {
      if (typeof value === 'boolean') return value;
    }
  }

  return null;
}

function normalizedStatus(doc) {
  return String(doc?.status ?? '');
}

function statusHas(doc, token) {
  return normalizedStatus(doc)
    .toUpperCase()
    .includes(String(token).toUpperCase());
}

function reportedIssues(doc) {
  const out = [];

  for (const key of [
    'issues',
    'blockers',
    'errors',
    'failures',
    'rowIssues',
    'invalidRows',
  ]) {
    if (Array.isArray(doc?.[key]) && doc[key].length > 0) {
      out.push({
        field: key,
        count: doc[key].length,
        sample: doc[key].slice(0, 3),
      });
    }
  }

  return out;
}

function stockCodeOf(row) {
  return String(
    firstNonEmpty(
      row?.stockCode,
      row?.stock_code,
      row?.symbol,
    ) ?? '',
  ).padStart(6, '0');
}

function main() {
  const root = path.resolve(__dirname, '..');

  const files = {
    upstream: path.join(
      root,
      'logs',
      'opendart-corporate-action-post-persistence-reuse-v9-9-11-7-8-8-1-common-stock-replay.json',
    ),

    persistenceApply119: path.join(
      root,
      'logs',
      'opendart-corporate-action-adjustment-persistence-apply-v9-9-11-9-common-stock-scope.json',
    ),

    refreshPlan1110: path.join(
      root,
      'logs',
      'opendart-corporate-action-post-persistence-refresh-plan-v9-9-11-10-common-stock-scope.json',
    ),

    eligibility11101: path.join(
      root,
      'logs',
      'opendart-corporate-action-ratio-refresh-eligibility-v9-9-11-10-1-common-stock-scope.json',
    ),

    coverage11102: path.join(
      root,
      'logs',
      'opendart-corporate-action-ratio-refresh-coverage-preflight-v9-9-11-10-2-common-stock-scope.json',
    ),

    disposition111021: path.join(
      root,
      'logs',
      'opendart-corporate-action-ratio-refresh-coverage-disposition-v9-9-11-10-2-1-common-stock-scope.json',
    ),

    directApply11111: path.join(
      root,
      'logs',
      'opendart-corporate-action-ratio-refresh-direct-apply-v9-9-11-11-1-common-stock-scope.json',
    ),

    vendor1112: path.join(
      root,
      'logs',
      'opendart-corporate-action-post-refresh-vendor-verification-v9-9-11-12-common-stock-scope.json',
    ),

    closure1113: path.join(
      root,
      'logs',
      'opendart-corporate-action-cycle-closure-v9-9-11-13-common-stock-scope.json',
    ),
  };

  const outputFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-refresh-closure-reuse-v9-9-11-10-to-13-common-stock-replay.json',
  );

  for (const [name, file] of Object.entries(files)) {
    assert(
      fs.existsSync(file),
      `INPUT_NOT_FOUND:${name}:${path.basename(file)}`,
    );
  }

  const docs = Object.fromEntries(
    Object.entries(files).map(
      ([name, file]) => [name, readJson(file)],
    ),
  );

  assert(
    docs.upstream.version === UPSTREAM_VERSION,
    `UPSTREAM_VERSION_MISMATCH:${docs.upstream.version}`,
  );

  assert(
    docs.upstream.status === UPSTREAM_STATUS,
    `UPSTREAM_STATUS_MISMATCH:${docs.upstream.status}`,
  );

  assert(
    docs.upstream.conclusion
      ?.safeToAdvanceToHistoricalV9_9_11_10PlusReadOnlyReplay === true,
    'UPSTREAM_NOT_READY',
  );

  const issues = [];

  // ----------------------------------------------------------------
  // Historical V9.9.11.9 write artifact is evidence only.
  // ----------------------------------------------------------------

  const persistenceApply = {
    version: docs.persistenceApply119.version ?? null,
    status: docs.persistenceApply119.status ?? null,

    runs:
      countField(
        docs.persistenceApply119,
        'runs',
        'runRows',
        'targetRuns',
        'persistedRuns',
      ),

    factors:
      countField(
        docs.persistenceApply119,
        'factors',
        'factorRows',
        'targetFactors',
        'persistedFactors',
      ),

    historicalArtifactOnly: true,
    executedNow: false,
  };

  if (
    !statusHas(docs.persistenceApply119, 'COMPLETE')
  ) {
    issues.push({
      check: 'persistenceApply119.status',
      actual: persistenceApply.status,
      expectedContains: 'COMPLETE',
    });
  }

  if (
    persistenceApply.runs !== null &&
    persistenceApply.runs !== 2
  ) {
    issues.push({
      check: 'persistenceApply119.runs',
      actual: persistenceApply.runs,
      expected: 2,
    });
  }

  if (
    persistenceApply.factors !== null &&
    persistenceApply.factors !== 2
  ) {
    issues.push({
      check: 'persistenceApply119.factors',
      actual: persistenceApply.factors,
      expected: 2,
    });
  }

  // ----------------------------------------------------------------
  // 11.10 refresh manifest.
  // ----------------------------------------------------------------

  const planCounts = {
    cashNoRefresh:
      countField(
        docs.refreshPlan1110,
        'cashNoRefresh',
      ),

    ratioRefreshCandidates:
      countField(
        docs.refreshPlan1110,
        'ratioRefreshCandidates',
      ),

    ratioRefreshDistinctStocks:
      countField(
        docs.refreshPlan1110,
        'ratioRefreshDistinctStocks',
      ),

    reverseSplitRefresh:
      countField(
        docs.refreshPlan1110,
        'reverseSplitRefresh',
      ),

    stockSplitRefresh:
      countField(
        docs.refreshPlan1110,
        'stockSplitRefresh',
      ),

    structuralBlocked:
      countField(
        docs.refreshPlan1110,
        'structuralBlocked',
      ),

    missingRefreshReferences:
      countField(
        docs.refreshPlan1110,
        'missingRefreshReferences',
      ),
  };

  const expectedPlan = {
    cashNoRefresh: 1,
    ratioRefreshCandidates: 1,
    ratioRefreshDistinctStocks: 1,
    reverseSplitRefresh: 1,
    stockSplitRefresh: 0,
    structuralBlocked: 0,
    missingRefreshReferences: 0,
  };

  if (
    docs.refreshPlan1110.status !==
    'POST_PERSISTENCE_VERIFICATION_AND_REFRESH_MANIFEST_READY'
  ) {
    issues.push({
      check: 'refreshPlan1110.status',
      actual: docs.refreshPlan1110.status ?? null,
      expected:
        'POST_PERSISTENCE_VERIFICATION_AND_REFRESH_MANIFEST_READY',
    });
  }

  for (const [field, expected] of Object.entries(expectedPlan)) {
    const actual = planCounts[field];

    if (actual !== null && actual !== expected) {
      issues.push({
        check: `refreshPlan1110.${field}`,
        actual,
        expected,
      });
    }
  }

  const planReportedIssues =
    reportedIssues(docs.refreshPlan1110);

  if (planReportedIssues.length > 0) {
    issues.push({
      check: 'refreshPlan1110.reportedIssues',
      details: planReportedIssues,
    });
  }

  // ----------------------------------------------------------------
  // 11.10.1 snapshot eligibility.
  // ----------------------------------------------------------------

  const eligibilitySnapshot =
    String(
      firstNonEmpty(
        docs.eligibility11101.evidenceSnapshotAsOf,
        docs.eligibility11101.snapshotAsOf,
        docs.eligibility11101.policy?.evidenceSnapshotAsOf,
      ) ?? '',
    );

  const eligibilityCounts = {
    inputRatioRows:
      countField(
        docs.eligibility11101,
        'inputRatioRows',
        'ratioRefreshCandidates',
      ),

    eligibleNow:
      countField(
        docs.eligibility11101,
        'eligibleNow',
        'eligibleAtSnapshot',
        'ratioEligibleAtSnapshot',
      ),

    futureDeferred:
      countField(
        docs.eligibility11101,
        'futureDeferred',
        'futureRatioDeferred',
      ),

    invalidEffectiveDates:
      countField(
        docs.eligibility11101,
        'invalidEffectiveDates',
      ),
  };

  if (
    docs.eligibility11101.status !==
    'RATIO_KIS_REFRESH_ELIGIBILITY_READY'
  ) {
    issues.push({
      check: 'eligibility11101.status',
      actual: docs.eligibility11101.status ?? null,
      expected: 'RATIO_KIS_REFRESH_ELIGIBILITY_READY',
    });
  }

  if (
    eligibilitySnapshot &&
    eligibilitySnapshot !== SNAPSHOT_AS_OF
  ) {
    issues.push({
      check: 'eligibility11101.snapshotAsOf',
      actual: eligibilitySnapshot,
      expected: SNAPSHOT_AS_OF,
    });
  }

  const expectedEligibility = {
    inputRatioRows: 1,
    eligibleNow: 1,
    futureDeferred: 0,
    invalidEffectiveDates: 0,
  };

  for (
    const [field, expected]
    of Object.entries(expectedEligibility)
  ) {
    const actual = eligibilityCounts[field];

    if (actual !== null && actual !== expected) {
      issues.push({
        check: `eligibility11101.${field}`,
        actual,
        expected,
      });
    }
  }

  // ----------------------------------------------------------------
  // 11.10.2 / 10.2.1 surface coverage.
  // ----------------------------------------------------------------

  const coverageStatus =
    docs.coverage11102.status ?? null;

  if (
    coverageStatus !==
    'RATIO_MARKET_DAILY_BAR_COVERAGE_PREFLIGHT_READY'
  ) {
    issues.push({
      check: 'coverage11102.status',
      actual: coverageStatus,
      expected:
        'RATIO_MARKET_DAILY_BAR_COVERAGE_PREFLIGHT_READY',
    });
  }

  const dispositionStatus =
    docs.disposition111021.status ?? null;

  if (
    dispositionStatus !==
    'RATIO_REFRESH_COVERAGE_DISPOSITION_READY'
  ) {
    issues.push({
      check: 'disposition111021.status',
      actual: dispositionStatus,
      expected:
        'RATIO_REFRESH_COVERAGE_DISPOSITION_READY',
    });
  }

  const dispositionCounts = {
    inputRows:
      countField(
        docs.disposition111021,
        'inputRows',
        'inputRatioRows',
      ),

    refreshable:
      countField(
        docs.disposition111021,
        'refreshable',
        'refreshableRows',
        'refreshableCanonicalSurfaces',
      ),

    noSurface:
      countField(
        docs.disposition111021,
        'noSurface',
        'noSurfaceRows',
        'noCanonicalBarSurface',
      ),

    unadjusted:
      countField(
        docs.disposition111021,
        'unadjusted',
        'unadjustedRows',
      ),

    invalid:
      countField(
        docs.disposition111021,
        'invalid',
        'invalidRows',
      ),
  };

  const expectedDisposition = {
    inputRows: 1,
    refreshable: 1,
    noSurface: 0,
    unadjusted: 0,
    invalid: 0,
  };

  for (
    const [field, expected]
    of Object.entries(expectedDisposition)
  ) {
    const actual = dispositionCounts[field];

    if (actual !== null && actual !== expected) {
      issues.push({
        check: `disposition111021.${field}`,
        actual,
        expected,
      });
    }
  }

  const dispositionProblems =
    reportedIssues(docs.disposition111021);

  if (dispositionProblems.length > 0) {
    issues.push({
      check: 'disposition111021.reportedIssues',
      details: dispositionProblems,
    });
  }

  // Attempt to prove 032080 is the refreshable stock if the row array is exposed.
  const refreshableRows = arrayField(
    docs.disposition111021,
    'refreshableRows',
    'refreshable',
    'refreshPlan',
  );

  if (refreshableRows.length > 0) {
    const stocks =
      [...new Set(
        refreshableRows
          .map(stockCodeOf)
          .filter(Boolean),
      )];

    if (
      stocks.length !== 1 ||
      stocks[0] !== '032080'
    ) {
      issues.push({
        check: 'disposition111021.refreshableStockSet',
        actual: stocks,
        expected: ['032080'],
      });
    }
  }

  // ----------------------------------------------------------------
  // 11.11.1 historical direct market-bar APPLY artifact.
  // Never execute. Only verify it is a completed 1-stock historical record.
  // ----------------------------------------------------------------

  const directApply = {
    version: docs.directApply11111.version ?? null,
    status: docs.directApply11111.status ?? null,

    plannedStocks:
      countField(
        docs.directApply11111,
        'plannedStocks',
        'targetStocks',
      ),

    completedStocks:
      countField(
        docs.directApply11111,
        'completedStocks',
        'refreshedStocks',
      ),

    failedStocks:
      countField(
        docs.directApply11111,
        'failedStocks',
      ),

    resumeSafe:
      boolField(
        docs.directApply11111,
        'resumeSafe',
      ),

    executedNow: false,
    historicalArtifactOnly: true,
  };

  if (!statusHas(docs.directApply11111, 'COMPLETE')) {
    issues.push({
      check: 'directApply11111.status',
      actual: directApply.status,
      expectedContains: 'COMPLETE',
    });
  }

  if (
    directApply.plannedStocks !== null &&
    directApply.plannedStocks !== 1
  ) {
    issues.push({
      check: 'directApply11111.plannedStocks',
      actual: directApply.plannedStocks,
      expected: 1,
    });
  }

  if (
    directApply.completedStocks !== null &&
    directApply.completedStocks !== 1
  ) {
    issues.push({
      check: 'directApply11111.completedStocks',
      actual: directApply.completedStocks,
      expected: 1,
    });
  }

  if (
    directApply.failedStocks !== null &&
    directApply.failedStocks !== 0
  ) {
    issues.push({
      check: 'directApply11111.failedStocks',
      actual: directApply.failedStocks,
      expected: 0,
    });
  }

  // ----------------------------------------------------------------
  // 11.12 vendor-adjusted verification.
  // Historical artifact may contain KIS read calls; current audit does not.
  // ----------------------------------------------------------------

  if (
    docs.vendor1112.status !==
    'POST_REFRESH_VENDOR_ADJUSTED_VERIFICATION_COMPLETE'
  ) {
    issues.push({
      check: 'vendor1112.status',
      actual: docs.vendor1112.status ?? null,
      expected:
        'POST_REFRESH_VENDOR_ADJUSTED_VERIFICATION_COMPLETE',
    });
  }

  const vendorCounts = {
    verifiedStocks:
      countField(
        docs.vendor1112,
        'verifiedStocks',
        'vendorVerifiedStocks',
        'completedStocks',
      ),

    failedStocks:
      countField(
        docs.vendor1112,
        'failedStocks',
      ),

    mismatches:
      countField(
        docs.vendor1112,
        'mismatches',
        'mismatchRows',
      ),

    verifiedRows:
      countField(
        docs.vendor1112,
        'verifiedRows',
        'vendorVerifiedRows',
      ),
  };

  if (
    vendorCounts.verifiedStocks !== null &&
    vendorCounts.verifiedStocks !== 1
  ) {
    issues.push({
      check: 'vendor1112.verifiedStocks',
      actual: vendorCounts.verifiedStocks,
      expected: 1,
    });
  }

  if (
    vendorCounts.failedStocks !== null &&
    vendorCounts.failedStocks !== 0
  ) {
    issues.push({
      check: 'vendor1112.failedStocks',
      actual: vendorCounts.failedStocks,
      expected: 0,
    });
  }

  if (
    vendorCounts.mismatches !== null &&
    vendorCounts.mismatches !== 0
  ) {
    issues.push({
      check: 'vendor1112.mismatches',
      actual: vendorCounts.mismatches,
      expected: 0,
    });
  }

  const vendorProblems =
    reportedIssues(docs.vendor1112);

  if (vendorProblems.length > 0) {
    issues.push({
      check: 'vendor1112.reportedIssues',
      details: vendorProblems,
    });
  }

  const vendorWrites =
    countField(
      docs.vendor1112,
      'databaseWrites',
      'marketDailyBarsModified',
      'corporateActionFactorsAppliedToCanonicalBars',
    );

  if (
    vendorWrites !== null &&
    vendorWrites !== 0
  ) {
    issues.push({
      check: 'vendor1112.readOnlyVerification',
      actual: vendorWrites,
      expected: 0,
    });
  }

  // ----------------------------------------------------------------
  // 11.13 closure.
  // ----------------------------------------------------------------

  const closureSnapshot =
    String(
      firstNonEmpty(
        docs.closure1113.evidenceSnapshotAsOf,
        docs.closure1113.snapshotAsOf,
      ) ?? '',
    );

  if (
    closureSnapshot &&
    closureSnapshot !== SNAPSHOT_AS_OF
  ) {
    issues.push({
      check: 'closure1113.snapshotAsOf',
      actual: closureSnapshot,
      expected: SNAPSHOT_AS_OF,
    });
  }

  if (!statusHas(docs.closure1113, 'CLOSED')) {
    issues.push({
      check: 'closure1113.status',
      actual: docs.closure1113.status ?? null,
      expectedContains: 'CLOSED',
    });
  }

  const closureCounts = {
    currentBatchEvents:
      countField(
        docs.closure1113,
        'currentBatchEvents',
      ),

    factorReadyEvents:
      countField(
        docs.closure1113,
        'factorReadyEvents',
      ),

    structuralBlockedEvents:
      countField(
        docs.closure1113,
        'structuralBlockedEvents',
      ),

    runs:
      countField(
        docs.closure1113,
        'runs',
        'verifiedRuns',
      ),

    factors:
      countField(
        docs.closure1113,
        'factors',
        'verifiedFactors',
      ),

    ratioRefreshCandidates:
      countField(
        docs.closure1113,
        'ratioRefreshCandidates',
      ),

    ratioEligibleAtSnapshot:
      countField(
        docs.closure1113,
        'ratioEligibleAtSnapshot',
      ),

    futureRatioDeferred:
      countField(
        docs.closure1113,
        'futureRatioDeferred',
      ),

    refreshableCanonicalSurfaces:
      countField(
        docs.closure1113,
        'refreshableCanonicalSurfaces',
        'refreshableWithSurface',
      ),

    noCanonicalBarSurface:
      countField(
        docs.closure1113,
        'noCanonicalBarSurface',
      ),

    refreshedStocks:
      countField(
        docs.closure1113,
        'refreshedStocks',
      ),

    vendorVerifiedStocks:
      countField(
        docs.closure1113,
        'vendorVerifiedStocks',
      ),
  };

  const closureExpected = {
    currentBatchEvents: 2,
    factorReadyEvents: 2,
    structuralBlockedEvents: 0,
    runs: 2,
    factors: 2,
    ratioRefreshCandidates: 1,
    ratioEligibleAtSnapshot: 1,
    futureRatioDeferred: 0,
    refreshableCanonicalSurfaces: 1,
    noCanonicalBarSurface: 0,
    refreshedStocks: 1,
    vendorVerifiedStocks: 1,
  };

  for (
    const [field, expected]
    of Object.entries(closureExpected)
  ) {
    const actual = closureCounts[field];

    if (actual !== null && actual !== expected) {
      issues.push({
        check: `closure1113.${field}`,
        actual,
        expected,
      });
    }
  }

  const closureIssues =
    Array.isArray(docs.closure1113.issues)
      ? docs.closure1113.issues
      : [];

  if (closureIssues.length > 0) {
    issues.push({
      check: 'closure1113.issues',
      details: closureIssues,
    });
  }

  const coverageAdvanced =
    firstNonEmpty(
      docs.closure1113.closure?.globalCoverageMarkerAdvanced,
      docs.closure1113.safety?.coverageWindowAdvanced,
      docs.closure1113.globalCoverageMarkerAdvanced,
    );

  if (coverageAdvanced === true) {
    issues.push({
      check: 'closure1113.coverageMarkerMustNotAdvance',
      actual: true,
      expected: false,
    });
  }

  const factorAppliedToCanonicalBars =
    firstNonEmpty(
      docs.closure1113.safety
        ?.corporateActionFactorsAppliedToCanonicalBars,
      docs.vendor1112.safety
        ?.corporateActionFactorsAppliedToCanonicalBars,
    );

  if (
    Number(factorAppliedToCanonicalBars ?? 0) !== 0
  ) {
    issues.push({
      check:
        'canonicalBarsMustNotBeDoubleAdjustedByCorporateActionFactors',
      actual:
        factorAppliedToCanonicalBars,
      expected: 0,
    });
  }

  // 028080 stays outside this incremental branch.
  const serialized =
    JSON.stringify([
      docs.refreshPlan1110,
      docs.eligibility11101,
      docs.disposition111021,
      docs.vendor1112,
      docs.closure1113.accounting ?? {},
    ]);

  // Avoid treating carry-forward narrative as injection. Only flag 028080
  // if the current-cycle accounting unexpectedly says >2 events.
  if (
    serialized.includes('028080') &&
    closureCounts.currentBatchEvents !== null &&
    closureCounts.currentBatchEvents > 2
  ) {
    issues.push({
      check: '028080UnexpectedlyInjectedIntoCurrentV99RefreshCycle',
      currentBatchEvents: closureCounts.currentBatchEvents,
    });
  }

  const reusable =
    issues.length === 0;

  const status =
    reusable
      ? 'HISTORICAL_V9_9_11_10_TO_13_COMMON_STOCK_REFRESH_CLOSURE_RESULTS_REUSABLE'
      : 'HISTORICAL_V9_9_11_10_TO_13_COMMON_STOCK_REFRESH_CLOSURE_REUSE_BLOCKED';

  const report = {
    status,
    version: VERSION,
    evidenceSnapshotAsOf: SNAPSHOT_AS_OF,

    historicalWriteStages: {
      v9911_9PersistenceApply: {
        ...persistenceApply,
        mustNotExecuteDuringReplay: true,
      },

      v9911_11_1RatioRefreshDirectApply: {
        ...directApply,
        mustNotExecuteDuringReplay: true,
      },
    },

    refreshPlan1110: {
      status: docs.refreshPlan1110.status ?? null,
      counts: planCounts,
    },

    eligibility11101: {
      status: docs.eligibility11101.status ?? null,
      snapshotAsOf: eligibilitySnapshot || null,
      counts: eligibilityCounts,
    },

    coverage11102: {
      status: coverageStatus,
    },

    disposition111021: {
      status: dispositionStatus,
      counts: dispositionCounts,
      refreshableStocks:
        refreshableRows
          .map(stockCodeOf)
          .filter(Boolean),
    },

    vendor1112: {
      status: docs.vendor1112.status ?? null,
      counts: vendorCounts,
    },

    closure1113: {
      status: docs.closure1113.status ?? null,
      snapshotAsOf: closureSnapshot || null,
      counts: closureCounts,
      globalCoverageMarkerAdvanced:
        coverageAdvanced === true,
    },

    issues,

    conclusion: {
      historicalV9911_10RefreshManifestReusable:
        reusable,

      historicalV9911_10_1EligibilityReusable:
        reusable,

      historicalV9911_10_2CoveragePreflightReusable:
        reusable,

      historicalV9911_10_2_1CoverageDispositionReusable:
        reusable,

      historicalV9911_11_1ApplyArtifactReusableWithoutReexecution:
        reusable,

      historicalV9911_12VendorVerificationReusable:
        reusable,

      historicalV9911_13CycleClosureReusable:
        reusable,

      exactlyOneRatioRefreshCandidate032080:
        reusable,

      cashDividend039830RequiresNoHistoryRefresh:
        reusable,

      v99CycleClosedAt2026_10_04:
        reusable,

      globalCoverageMarkerAdvanced:
        false,

      historicalV9911_9ApplyMustNotBeExecuted:
        true,

      historicalV9911_11_1ApplyMustNotBeExecuted:
        true,

      canonicalAdjustedBarsNeverDoubleAdjusted:
        reusable,

      physical028080RepairStillSeparate:
        true,

      safeToAdvanceToV9_10Replay:
        reusable,
    },

    safety: {
      networkRequestsNow: 0,
      databaseReadsNow: 0,
      databaseWritesNow: 0,
      kisRequestsNow: 0,
      productionAppliedNow: false,
      marketDailyBarsModifiedNow: 0,
      coverageWindowAdvancedNow: false,
    },

    nextGate:
      reusable
        ? 'AUDIT_V9_10_1_2_2_1_3_COMMON_STOCK_REPLAY_CLOSURE'
        : 'STOP_AND_REVIEW',

    outputFile:
      'logs/opendart-corporate-action-refresh-closure-reuse-v9-9-11-10-to-13-common-stock-replay.json',
  };

  report.outputFingerprint =
    sha256(
      JSON.stringify({
        version: report.version,
        evidenceSnapshotAsOf: report.evidenceSnapshotAsOf,
        refreshPlan1110: report.refreshPlan1110,
        eligibility11101: report.eligibility11101,
        disposition111021: report.disposition111021,
        vendor1112: report.vendor1112,
        closure1113: report.closure1113,
        issues: report.issues,
        conclusion: report.conclusion,
      }),
    );

  atomicSaveJson(outputFile, report);

  // Keep console compact. Full detail is in outputFile.
  console.log(
    JSON.stringify(
      {
        status: report.status,
        version: report.version,
        evidenceSnapshotAsOf: report.evidenceSnapshotAsOf,

        refreshPlan: report.refreshPlan1110,
        eligibility: report.eligibility11101,
        disposition: report.disposition111021,
        vendorVerification: report.vendor1112,
        cycleClosure: report.closure1113,

        historicalWriteStagesExecutedNow: false,
        issues: report.issues,

        conclusion: report.conclusion,

        networkRequestsNow: 0,
        databaseReadsNow: 0,
        databaseWritesNow: 0,
        kisRequestsNow: 0,

        nextGate: report.nextGate,
        outputFile: report.outputFile,
      },
      null,
      2,
    ),
  );

  if (!reusable) {
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
          'HISTORICAL_V9_9_11_10_TO_13_COMMON_STOCK_REUSE_AUDIT_FAILED',

        version: VERSION,

        error:
          String(
            error?.message ??
            error,
          ),

        historicalWriteStagesExecutedNow: false,
        networkRequestsNow: 0,
        databaseReadsNow: 0,
        databaseWritesNow: 0,
        kisRequestsNow: 0,
        productionAppliedNow: false,
      },
      null,
      2,
    ),
  );

  process.exitCode = 2;
}
