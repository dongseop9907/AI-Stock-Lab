#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * V9.8.11.13 replay
 *
 * Final V9.8 replay-cycle closure audit at evidence snapshot 2026-10-01.
 *
 * READ ONLY.
 *
 * Important distinction:
 * - The repaired lineage is fully proven for replay.
 * - The physical DB still has ONE intentionally deferred repair:
 *     028080 canonical event provenance + adjustment-run summary provenance.
 * - Therefore this audit may close the V9.8 READ-ONLY REPLAY dependency chain,
 *   but MUST NOT claim that the physical production DB is fully repaired.
 *
 * No DB reads.
 * No DB writes.
 * No KIS calls.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_8_11_13_REPLAY_CORPORATE_ACTION_CYCLE_CLOSURE_AUDIT';

const SNAPSHOT_AS_OF =
  '2026-10-01';

const VERSIONS = {
  snapshotEligibility:
    'V9_8_11_5_1_REPLAY_V3_SNAPSHOT_ASOF_PRODUCTION_ELIGIBILITY_GATE',

  resume:
    'V9_8_11_9_REPLAY_READ_ONLY_VIRTUAL_REPAIRED_128_RUN_121_FACTOR_RESUME_AUDIT',

  refreshManifest:
    'V9_8_11_10_REPLAY_READ_ONLY_POST_PERSISTENCE_VERIFICATION_AND_HISTORY_REFRESH_MANIFEST',

  ratioEligibility:
    'V9_8_11_10_1_REPLAY_RATIO_KIS_REFRESH_ELIGIBILITY_GATE',

  disposition:
    'V9_8_11_10_2_1_REPLAY_RATIO_REFRESH_COVERAGE_DISPOSITION_REPAIR',

  historicalReuse:
    'V9_8_11_11_12_REPLAY_READ_ONLY_HISTORICAL_REFRESH_VENDOR_REUSE_AUDIT',

  repairDryRun:
    'V9_8_11_8_3_3_REPLAY_028080_TWO_ROW_IN_PLACE_REPAIR_DRY_RUN_PREFLIGHT',
};

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

  refreshedStocks: 16,
  vendorVerifiedStocks: 16,
  vendorVerifiedRows: 656,

  futureStructuralDeferred: 30,

  physicalRepairStocks: 1,
  physicalRepairPatchRows: 2,
};

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

function issue(
  issues,
  check,
  actual,
  expected,
) {
  if (actual !== expected) {
    issues.push({
      check,
      actual:
        actual ?? null,
      expected:
        expected ?? null,
    });
  }
}

function sorted(values) {
  return [...values]
    .map(String)
    .sort(
      (a, b) =>
        a.localeCompare(b),
    );
}

function main() {
  const root =
    path.resolve(__dirname, '..');

  const files = {
    snapshotEligibility:
      path.join(
        root,
        'logs',
        'opendart-corporate-action-snapshot-eligibility-v9-8-11-5-1-replay-v3.json',
      ),

    resume:
      path.join(
        root,
        'logs',
        'opendart-corporate-action-adjustment-persistence-resume-audit-v9-8-11-9-replay.json',
      ),

    refreshManifest:
      path.join(
        root,
        'logs',
        'opendart-corporate-action-post-persistence-refresh-plan-v9-8-11-10-replay.json',
      ),

    ratioEligibility:
      path.join(
        root,
        'logs',
        'opendart-corporate-action-ratio-refresh-eligibility-v9-8-11-10-1-replay.json',
      ),

    disposition:
      path.join(
        root,
        'logs',
        'opendart-corporate-action-ratio-refresh-coverage-disposition-v9-8-11-10-2-1-replay.json',
      ),

    historicalReuse:
      path.join(
        root,
        'logs',
        'opendart-corporate-action-historical-refresh-vendor-reuse-audit-v9-8-11-11-12-replay.json',
      ),

    repairDryRun:
      path.join(
        root,
        'logs',
        'opendart-corporate-action-028080-two-row-repair-dry-run-v9-8-11-8-3-3-replay.json',
      ),
  };

  for (
    const [name, file]
    of Object.entries(files)
  ) {
    assert(
      fs.existsSync(file),
      `INPUT_NOT_FOUND:${name}:${path.basename(file)}`,
    );
  }

  const input =
    Object.fromEntries(
      Object.entries(files)
        .map(
          ([name, file]) => [
            name,
            readJson(file),
          ],
        ),
    );

  for (
    const [name, version]
    of Object.entries(VERSIONS)
  ) {
    assert(
      input[name].version ===
        version,
      `VERSION_MISMATCH:${name}:${input[name].version}`,
    );
  }

  assert(
    input.snapshotEligibility.status ===
      'SNAPSHOT_ASOF_ELIGIBILITY_GATE_READY',
    `SNAPSHOT_ELIGIBILITY_NOT_READY:${input.snapshotEligibility.status}`,
  );

  assert(
    input.resume.status ===
      'V9_8_11_9_VIRTUAL_REPAIRED_RESUME_STATE_COMPLETE',
    `RESUME_NOT_COMPLETE:${input.resume.status}`,
  );

  assert(
    input.refreshManifest.status ===
      'POST_PERSISTENCE_VERIFICATION_AND_REFRESH_MANIFEST_READY',
    `REFRESH_MANIFEST_NOT_READY:${input.refreshManifest.status}`,
  );

  assert(
    input.ratioEligibility.status ===
      'RATIO_KIS_REFRESH_ELIGIBILITY_READY',
    `RATIO_ELIGIBILITY_NOT_READY:${input.ratioEligibility.status}`,
  );

  assert(
    input.disposition.status ===
      'RATIO_REFRESH_COVERAGE_DISPOSITION_READY',
    `DISPOSITION_NOT_READY:${input.disposition.status}`,
  );

  assert(
    input.historicalReuse.status ===
      'HISTORICAL_11_1_12_REFRESH_VENDOR_RESULTS_REUSABLE',
    `HISTORICAL_REUSE_NOT_READY:${input.historicalReuse.status}`,
  );

  assert(
    input.repairDryRun.status ===
      'TWO_ROW_IN_PLACE_REPAIR_DRY_RUN_READY',
    `REPAIR_DRY_RUN_NOT_READY:${input.repairDryRun.status}`,
  );

  const issues = [];

  // ---------------------------------------------------------------------
  // Snapshot canonical/event persistence accounting.
  // ---------------------------------------------------------------------

  const currentBatchEvents =
    Number(
      input.resume.counts
        ?.targetEvents ??
      input.resume.targetEvents,
    );

  const factorReadyEvents =
    Number(
      input.resume.counts
        ?.factorReadyEvents ??
      input.resume.factorReadyEvents,
    );

  const structuralBlockedEvents =
    Number(
      input.resume.counts
        ?.structuralEvents ??
      input.resume.structuralEvents,
    );

  const verifiedRuns =
    Number(
      input.resume.counts
        ?.exactTargetRuns ??
      input.resume.exactTargetRuns,
    );

  const verifiedFactors =
    Number(
      input.resume.counts
        ?.exactTargetFactors ??
      input.resume.exactTargetFactors,
    );

  issue(
    issues,
    'current_batch_events',
    currentBatchEvents,
    EXPECTED.currentBatchEvents,
  );

  issue(
    issues,
    'factor_ready_events',
    factorReadyEvents,
    EXPECTED.factorReadyEvents,
  );

  issue(
    issues,
    'structural_blocked_events',
    structuralBlockedEvents,
    EXPECTED.structuralBlockedEvents,
  );

  issue(
    issues,
    'verified_runs',
    verifiedRuns,
    EXPECTED.runs,
  );

  issue(
    issues,
    'verified_factors',
    verifiedFactors,
    EXPECTED.factors,
  );

  issue(
    issues,
    'run_state',
    input.resume.resumeState
      ?.runState,
    'REUSE_128_EXACT',
  );

  issue(
    issues,
    'factor_state',
    input.resume.resumeState
      ?.factorState,
    'REUSE_121_EXACT',
  );

  // ---------------------------------------------------------------------
  // Ratio refresh accounting.
  // ---------------------------------------------------------------------

  const ratioRefreshCandidates =
    Number(
      input.ratioEligibility.counts
        ?.inputRatioRefreshRows ??
      input.ratioEligibility
        .inputRatioRefreshRows,
    );

  const ratioEligibleAtSnapshot =
    Number(
      input.ratioEligibility.counts
        ?.eligibleNow ??
      input.ratioEligibility
        .eligibleNow,
    );

  const futureRatioDeferred =
    Number(
      input.ratioEligibility.counts
        ?.futureDeferred ??
      input.ratioEligibility
        .futureDeferred,
    );

  const refreshableWithSurface =
    Number(
      input.disposition.counts
        ?.refreshableStocks ??
      (
        Array.isArray(
          input.disposition.refreshablePlan,
        )
          ? input.disposition.refreshablePlan.length
          : NaN
      ),
    );

  const noCanonicalBarSurface =
    Number(
      input.disposition.counts
        ?.noCanonicalBarSurfaceStocks ??
      (
        Array.isArray(
          input.disposition.noCanonicalBarSurface,
        )
          ? input.disposition.noCanonicalBarSurface.length
          : NaN
      ),
    );

  issue(
    issues,
    'ratio_refresh_candidates',
    ratioRefreshCandidates,
    EXPECTED.ratioRefreshCandidates,
  );

  issue(
    issues,
    'ratio_eligible_at_snapshot',
    ratioEligibleAtSnapshot,
    EXPECTED.ratioEligibleAtSnapshot,
  );

  issue(
    issues,
    'future_ratio_deferred',
    futureRatioDeferred,
    EXPECTED.futureRatioDeferred,
  );

  issue(
    issues,
    'refreshable_with_surface',
    refreshableWithSurface,
    EXPECTED.refreshableWithSurface,
  );

  issue(
    issues,
    'no_canonical_bar_surface',
    noCanonicalBarSurface,
    EXPECTED.noCanonicalBarSurface,
  );

  issue(
    issues,
    'ratio_accounting',
    ratioEligibleAtSnapshot +
      futureRatioDeferred,
    EXPECTED.ratioRefreshCandidates,
  );

  issue(
    issues,
    'eligible_surface_accounting',
    refreshableWithSurface +
      noCanonicalBarSurface,
    EXPECTED.ratioEligibleAtSnapshot,
  );

  // ---------------------------------------------------------------------
  // No-surface identity guard.
  // ---------------------------------------------------------------------

  const noSurfaceCodes =
    sorted(
      (
        input.disposition
          .noCanonicalBarSurface ??
        []
      ).map(
        (row) =>
          row.stockCode,
      ),
    );

  issue(
    issues,
    'no_surface_codes',
    JSON.stringify(
      noSurfaceCodes,
    ),
    JSON.stringify([
      '900110',
      '900270',
    ]),
  );

  // ---------------------------------------------------------------------
  // Historical refresh / vendor reuse closure.
  // ---------------------------------------------------------------------

  const refreshedStocks =
    Number(
      input.historicalReuse.counts
        ?.historicalCompletedStocks ??
      input.historicalReuse
        .historicalCompletedStocks,
    );

  const vendorVerifiedStocks =
    Number(
      input.historicalReuse.counts
        ?.historicalClosureVendorVerifiedStocks ??
      input.historicalReuse
        .historicalClosureVendorVerifiedStocks,
    );

  const vendorVerifiedRows =
    Number(
      input.historicalReuse.counts
        ?.historicalClosureVendorRows ??
      input.historicalReuse
        .historicalClosureVendorRows,
    );

  const currentDbDriftStocks =
    Number(
      input.historicalReuse.counts
        ?.currentDbDriftStocks ??
      input.historicalReuse
        .currentDbDriftStocks,
    );

  const currentDbUnadjustedStocks =
    Number(
      input.historicalReuse.counts
        ?.currentDbUnadjustedStocks ??
      input.historicalReuse
        .currentDbUnadjustedStocks,
    );

  const currentDbNonCanonicalSourceStocks =
    Number(
      input.historicalReuse.counts
        ?.currentDbNonCanonicalSourceStocks ??
      input.historicalReuse
        .currentDbNonCanonicalSourceStocks,
    );

  issue(
    issues,
    'refresh_completed_stocks',
    refreshedStocks,
    EXPECTED.refreshedStocks,
  );

  issue(
    issues,
    'vendor_verified_stocks',
    vendorVerifiedStocks,
    EXPECTED.vendorVerifiedStocks,
  );

  issue(
    issues,
    'vendor_verified_rows',
    vendorVerifiedRows,
    EXPECTED.vendorVerifiedRows,
  );

  issue(
    issues,
    'current_db_drift_stocks',
    currentDbDriftStocks,
    0,
  );

  issue(
    issues,
    'current_db_unadjusted_stocks',
    currentDbUnadjustedStocks,
    0,
  );

  issue(
    issues,
    'current_db_noncanonical_source_stocks',
    currentDbNonCanonicalSourceStocks,
    0,
  );

  issue(
    issues,
    'historical_kis_refresh_reusable',
    input.historicalReuse.conclusion
      ?.historicalKisRefreshCanBeReused,
    true,
  );

  issue(
    issues,
    'historical_vendor_verification_reusable',
    input.historicalReuse.conclusion
      ?.historicalVendorVerificationCanBeReused,
    true,
  );

  // ---------------------------------------------------------------------
  // Future structural accounting.
  // ---------------------------------------------------------------------

  const futureStructuralDeferred =
    Number(
      input.snapshotEligibility
        .deferredFutureStructuralRows ??
      input.snapshotEligibility.counts
        ?.deferredFutureStructuralRows,
    );

  issue(
    issues,
    'future_structural_deferred',
    futureStructuralDeferred,
    EXPECTED.futureStructuralDeferred,
  );

  issue(
    issues,
    'corrected_003580_deferred',
    input.snapshotEligibility
      .corrected003580Deferred,
    true,
  );

  // ---------------------------------------------------------------------
  // Physical repair outstanding guard.
  // ---------------------------------------------------------------------

  const repairPlan =
    input.repairDryRun
      .dryRunPatchPlan;

  const plannedPatchRows =
    Number(
      input.repairDryRun.counts
        ?.plannedPatchRows ??
      input.repairDryRun
        .plannedPatchRows,
    );

  const plannedInsertRows =
    Number(
      input.repairDryRun.counts
        ?.plannedInsertRows ??
      input.repairDryRun
        .plannedInsertRows,
    );

  const plannedDeleteRows =
    Number(
      input.repairDryRun.counts
        ?.plannedDeleteRows ??
      input.repairDryRun
        .plannedDeleteRows,
    );

  const plannedFactorChanges =
    Number(
      input.repairDryRun.counts
        ?.plannedFactorChanges ??
      input.repairDryRun
        .plannedFactorChanges,
    );

  issue(
    issues,
    'physical_repair_patch_rows',
    plannedPatchRows,
    EXPECTED.physicalRepairPatchRows,
  );

  issue(
    issues,
    'physical_repair_insert_rows',
    plannedInsertRows,
    0,
  );

  issue(
    issues,
    'physical_repair_delete_rows',
    plannedDeleteRows,
    0,
  );

  issue(
    issues,
    'physical_repair_factor_changes',
    plannedFactorChanges,
    0,
  );

  issue(
    issues,
    'repair_canonical_event_stock',
    input.repairDryRun.identities
      ?.stockCode,
    '028080',
  );

  issue(
    issues,
    'repair_old_provider_event_id',
    input.repairDryRun.identities
      ?.oldProviderEventId,
    '20260630001117',
  );

  issue(
    issues,
    'repair_new_provider_event_id',
    input.repairDryRun.identities
      ?.repairedProviderEventId,
    '20221013000451',
  );

  assert(
    repairPlan
      ?.canonicalEvent &&
    repairPlan
      ?.adjustmentRun,
    'REPAIR_PATCH_PLAN_MISSING',
  );

  // ---------------------------------------------------------------------
  // Cross-artifact ratio identity consistency.
  // ---------------------------------------------------------------------

  const refreshManifestRatioCodes =
    sorted(
      (
        input.refreshManifest
          .ratioRefreshPlan ??
        []
      ).map(
        (row) =>
          row.stockCode,
      ),
    );

  const ratioEligibilityCodes =
    sorted(
      [
        ...(
          input.ratioEligibility
            .eligibleRefreshPlan ??
          []
        ),
        ...(
          input.ratioEligibility
            .futureDeferredPlan ??
          []
        ),
      ].map(
        (row) =>
          row.stockCode,
      ),
    );

  issue(
    issues,
    'ratio_identity_set_consistency',
    JSON.stringify(
      ratioEligibilityCodes,
    ),
    JSON.stringify(
      refreshManifestRatioCodes,
    ),
  );

  // ---------------------------------------------------------------------
  // Closure semantics.
  // ---------------------------------------------------------------------

  const replayDependencyChainClosed =
    issues.length === 0;

  const physicalRepairOutstanding =
    replayDependencyChainClosed &&
    plannedPatchRows === 2;

  const status =
    replayDependencyChainClosed
      ? 'V9_8_REPLAY_CYCLE_CLOSED_AT_2026_10_01_PHYSICAL_REPAIR_PENDING'
      : 'V9_8_REPLAY_CYCLE_CLOSURE_BLOCKED';

  const report = {
    status,
    version: VERSION,

    evidenceSnapshotAsOf:
      SNAPSHOT_AS_OF,

    closure: {
      replayDependencyChainClosed,

      canonicalEventLineageReplayClosed:
        replayDependencyChainClosed,

      adjustmentRunFactorReplayClosed:
        replayDependencyChainClosed,

      ratioHistoryRefreshReplayClosedForEligibleCanonicalSurfaces:
        replayDependencyChainClosed,

      historicalVendorVerificationReuseClosed:
        replayDependencyChainClosed,

      physicalProductionRepairOutstanding:
        physicalRepairOutstanding,

      physicalProductionDatabaseFullyRepaired:
        false,

      globalCoverageMarkerAdvanced:
        false,

      safeCoverageStatement:
        replayDependencyChainClosed
          ? 'V9_8_REPAIRED_LINEAGE_REPLAY_VERIFIED_THROUGH_EVIDENCE_SNAPSHOT_2026_10_01_FOR_CURRENTLY_ELIGIBLE_SUPPORTED_SURFACES'
          : null,

      notClaimed: [
        'PHYSICAL_028080_PROVENANCE_REPAIR_APPLIED',
        'GENERIC_STRUCTURAL_ACTION_FACTORS',
        'CANONICAL_BAR_SUPPORT_FOR_900110_900270',
        'COVERAGE_BEYOND_2026_10_01',
        'GLOBAL_COVERAGE_MARKER_ADVANCEMENT',
      ],
    },

    accounting: {
      currentBatchEvents,
      factorReadyEvents,
      structuralBlockedEvents,

      verifiedRuns,
      verifiedFactors,

      ratioRefreshCandidates,
      ratioEligibleAtSnapshot,
      futureRatioDeferred,

      refreshableCanonicalSurfaces:
        refreshableWithSurface,

      noCanonicalBarSurface,

      refreshedStocks,
      vendorVerifiedStocks,
      vendorVerifiedRows,

      futureStructuralDeferred,

      physicalRepairStocks:
        EXPECTED.physicalRepairStocks,

      physicalRepairPatchRows:
        plannedPatchRows,

      physicalRepairInsertRows:
        plannedInsertRows,

      physicalRepairDeleteRows:
        plannedDeleteRows,

      physicalRepairFactorChanges:
        plannedFactorChanges,
    },

    outstandingPhysicalRepair: {
      stockCode:
        '028080',

      canonicalEventId:
        input.repairDryRun.identities
          ?.canonicalEventId ??
        null,

      adjustmentRunId:
        input.repairDryRun.identities
          ?.adjustmentRunId ??
        null,

      canonicalEventProviderEventId: {
        from:
          '20260630001117',

        to:
          '20221013000451',
      },

      adjustmentRunSummaryProviderEventId: {
        from:
          '20260630001117',

        to:
          '20221013000451',
      },

      patchRows:
        2,

      factorChanges:
        0,

      insertRows:
        0,

      deleteRows:
        0,

      applyNow:
        false,

      carryForwardMode:
        'VIRTUAL_REPAIR_OVERLAY_FOR_READ_ONLY_DOWNSTREAM_REPLAY',
    },

    deferred: {
      futureRatioActions:
        (
          input.ratioEligibility
            .futureDeferredPlan ??
          []
        ).map(
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
        (
          input.disposition
            .noCanonicalBarSurface ??
          []
        ).map(
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
              'DEFER_TO_DEDICATED_OTHER_SECURITY_BACKFILL_PATH',
          }),
        ),
    },

    sourceFingerprints: {
      snapshotEligibility:
        input.snapshotEligibility
          .outputFingerprint ??
        null,

      resume:
        input.resume
          .outputFingerprint ??
        null,

      refreshManifest:
        input.refreshManifest
          .outputFingerprint ??
        null,

      ratioEligibility:
        input.ratioEligibility
          .outputFingerprint ??
        null,

      disposition:
        input.disposition
          .outputFingerprint ??
        null,

      historicalReuse:
        input.historicalReuse
          .outputFingerprint ??
        null,

      repairDryRun:
        input.repairDryRun
          .outputFingerprint ??
        null,
    },

    issues,

    safety: {
      networkRequests:
        0,

      databaseReads:
        0,

      databaseWrites:
        0,

      kisRequests:
        0,

      marketDailyBarsModified:
        0,

      corporateActionRowsModified:
        0,

      adjustmentRunRowsModified:
        0,

      productionApplied:
        false,

      coverageWindowAdvanced:
        false,
    },

    nextGate:
      replayDependencyChainClosed
        ? 'START_V9_9_READ_ONLY_REPLAY_WITH_028080_VIRTUAL_REPAIR_CARRY_FORWARD'
        : 'STOP_AND_REVIEW',

    outputFile:
      'logs/opendart-corporate-action-cycle-closure-v9-8-11-13-replay.json',
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

        closure:
          report.closure,

        accounting:
          report.accounting,

        outstandingPhysicalRepair:
          report.outstandingPhysicalRepair,

        sourceFingerprints:
          report.sourceFingerprints,
      }),
    );

  atomicSaveJson(
    path.join(
      root,
      report.outputFile,
    ),
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
          report.evidenceSnapshotAsOf,

        ...report.accounting,

        replayDependencyChainClosed:
          report.closure
            .replayDependencyChainClosed,

        physicalProductionRepairOutstanding:
          report.closure
            .physicalProductionRepairOutstanding,

        physicalProductionDatabaseFullyRepaired:
          report.closure
            .physicalProductionDatabaseFullyRepaired,

        outstandingPhysicalRepair:
          report.outstandingPhysicalRepair,

        issues:
          report.issues,

        globalCoverageMarkerAdvanced:
          false,

        databaseWrites:
          0,

        kisRequests:
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
    'V9_8_REPLAY_CYCLE_CLOSED_AT_2026_10_01_PHYSICAL_REPAIR_PENDING'
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
          'V9_8_REPLAY_CYCLE_CLOSURE_AUDIT_FAILED',

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

        productionApplied:
          false,
      },
      null,
      2,
    ),
  );

  process.exitCode = 2;
}
