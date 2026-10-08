#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * V9.8.11.10 replay
 *
 * READ-ONLY post-persistence verification + history refresh manifest.
 *
 * Uses the already-fresh V9.8.11.9 replay audit:
 *   - exact 128 runs
 *   - exact 121 factors
 * and overlays the proven 028080 repaired canonical identity.
 *
 * Market-data policy preserved from historical V9.8.11.10:
 * - market_daily_bars are canonical KIS ADJUSTED bars.
 * - NEVER apply corporate-action factors onto already-adjusted bars.
 * - CASH_DIVIDEND: factor retained for audit/research, NO history refresh.
 * - STOCK_SPLIT / REVERSE_SPLIT: re-query KIS adjusted history.
 * - MERGER / SPIN_OFF: generic factor/history adjustment BLOCKED.
 *
 * No DB reads.
 * No DB writes.
 * No KIS calls.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_8_11_10_REPLAY_READ_ONLY_POST_PERSISTENCE_VERIFICATION_AND_HISTORY_REFRESH_MANIFEST';

const RESUME_VERSION =
  'V9_8_11_9_REPLAY_READ_ONLY_VIRTUAL_REPAIRED_128_RUN_121_FACTOR_RESUME_AUDIT';

const READINESS_VERSION =
  'V9_8_11_7_REPLAY_VIRTUAL_128_EVENT_READINESS_AND_REAL_UUID_AUDIT';

const PREFLIGHT_VERSION =
  'V9_8_11_8_1_REPLAY_SCHEMA_AWARE_VIRTUAL_128_PERSISTENCE_PREFLIGHT';

const REPAIR_DRY_RUN_VERSION =
  'V9_8_11_8_3_3_REPLAY_028080_TWO_ROW_IN_PLACE_REPAIR_DRY_RUN_PREFLIGHT';

const EXPECTED_EVENTS = 128;
const EXPECTED_RUNS = 128;
const EXPECTED_FACTORS = 121;
const EXPECTED_CASH = 79;
const EXPECTED_REVERSE = 40;
const EXPECTED_SPLIT = 2;
const EXPECTED_RATIO_REFRESH = 42;
const EXPECTED_STRUCTURAL = 7;

const RATIO_TYPES = new Set([
  'STOCK_SPLIT',
  'REVERSE_SPLIT',
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
      ([a], [b]) =>
        a.localeCompare(b),
    ),
  );
}

function main() {
  const root =
    path.resolve(__dirname, '..');

  const resumeFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-adjustment-persistence-resume-audit-v9-8-11-9-replay.json',
    );

  const readinessFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-128-event-readiness-v9-8-11-7-replay.json',
    );

  const preflightFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-adjustment-persistence-preflight-v9-8-11-8-1-replay-virtual.json',
    );

  const repairFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-028080-two-row-repair-dry-run-v9-8-11-8-3-3-replay.json',
    );

  const outputFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-post-persistence-refresh-plan-v9-8-11-10-replay.json',
    );

  for (
    const file of
    [
      resumeFile,
      readinessFile,
      preflightFile,
      repairFile,
    ]
  ) {
    assert(
      fs.existsSync(file),
      `INPUT_NOT_FOUND:${path.basename(file)}`,
    );
  }

  const resume =
    readJson(resumeFile);

  const readiness =
    readJson(readinessFile);

  const preflight =
    readJson(preflightFile);

  const repair =
    readJson(repairFile);

  assert(
    resume.version ===
      RESUME_VERSION,
    `RESUME_VERSION_MISMATCH:${resume.version}`,
  );

  assert(
    resume.status ===
      'V9_8_11_9_VIRTUAL_REPAIRED_RESUME_STATE_COMPLETE',
    `RESUME_NOT_COMPLETE:${resume.status}`,
  );

  assert(
    resume.resumeState
      ?.runState ===
      'REUSE_128_EXACT',
    `RUN_STATE_NOT_EXACT:${resume.resumeState?.runState}`,
  );

  assert(
    resume.resumeState
      ?.factorState ===
      'REUSE_121_EXACT',
    `FACTOR_STATE_NOT_EXACT:${resume.resumeState?.factorState}`,
  );

  assert(
    readiness.version ===
      READINESS_VERSION,
    `READINESS_VERSION_MISMATCH:${readiness.version}`,
  );

  assert(
    readiness.status ===
      'VIRTUAL_128_EVENT_READINESS_PROVEN_FACTOR_PIPELINE_UNBLOCKED',
    `READINESS_NOT_PROVEN:${readiness.status}`,
  );

  assert(
    preflight.version ===
      PREFLIGHT_VERSION,
    `PREFLIGHT_VERSION_MISMATCH:${preflight.version}`,
  );

  assert(
    repair.version ===
      REPAIR_DRY_RUN_VERSION,
    `REPAIR_VERSION_MISMATCH:${repair.version}`,
  );

  assert(
    repair.status ===
      'TWO_ROW_IN_PLACE_REPAIR_DRY_RUN_READY',
    `REPAIR_DRY_RUN_NOT_READY:${repair.status}`,
  );

  assert(
    Array.isArray(
      readiness.eventMap,
    ) &&
      readiness.eventMap.length ===
        EXPECTED_EVENTS,
    `EVENT_MAP_COUNT:${readiness.eventMap?.length}`,
  );

  assert(
    Array.isArray(
      resume.exactRunMap,
    ) &&
      resume.exactRunMap.length ===
        EXPECTED_RUNS,
    `EXACT_RUN_MAP_COUNT:${resume.exactRunMap?.length}`,
  );

  assert(
    Array.isArray(
      resume.exactFactorMap,
    ) &&
      resume.exactFactorMap.length ===
        EXPECTED_FACTORS,
    `EXACT_FACTOR_MAP_COUNT:${resume.exactFactorMap?.length}`,
  );

  assert(
    Array.isArray(
      preflight.factorPreview,
    ) &&
      preflight.factorPreview.length ===
        EXPECTED_FACTORS,
    `FACTOR_PREVIEW_COUNT:${preflight.factorPreview?.length}`,
  );

  const repairedEvent =
    repair.simulatedPostState
      ?.canonicalEvent;

  assert(
    repairedEvent,
    'REPAIRED_EVENT_OVERLAY_MISSING',
  );

  // Build the fully repaired 128-event logical map.
  const repairedEventMap =
    readiness.eventMap.map(
      (row) => {
        if (
          String(row.stockCode) !==
          '028080'
        ) {
          return {
            ...row,
            persistenceStatus:
              'REAL_DB_EVENT',
          };
        }

        return {
          ...row,

          eventId:
            repairedEvent.id,

          providerEventId:
            repairedEvent.provider_event_id,

          actionType:
            repairedEvent.action_type,

          effectiveDate:
            repairedEvent.effective_date,

          factorDisposition:
            'STRUCTURAL_BLOCKED',

          persistenceStatus:
            'VIRTUAL_REPAIR_OVERLAY',
        };
      },
    );

  assert(
    repairedEventMap.length ===
      EXPECTED_EVENTS,
    'REPAIRED_EVENT_MAP_COUNT_MISMATCH',
  );

  assert(
    repairedEventMap.every(
      (row) =>
        typeof row.eventId ===
          'string' &&
        row.eventId.length > 0,
    ),
    'REPAIRED_EVENT_MAP_HAS_NULL_UUID',
  );

  const runByProviderId =
    new Map(
      resume.exactRunMap.map(
        (row) => [
          String(row.providerEventId),
          row,
        ],
      ),
    );

  const factorMapByEventId =
    new Map(
      resume.exactFactorMap.map(
        (row) => [
          String(row.actionEventId),
          row,
        ],
      ),
    );

  const factorPreviewByEventId =
    new Map(
      preflight.factorPreview.map(
        (row) => [
          String(row.action_event_id),
          row,
        ],
      ),
    );

  const cashRows =
    repairedEventMap.filter(
      (row) =>
        row.actionType ===
        'CASH_DIVIDEND',
    );

  const reverseRows =
    repairedEventMap.filter(
      (row) =>
        row.actionType ===
        'REVERSE_SPLIT',
    );

  const splitRows =
    repairedEventMap.filter(
      (row) =>
        row.actionType ===
        'STOCK_SPLIT',
    );

  const ratioRows =
    repairedEventMap.filter(
      (row) =>
        RATIO_TYPES.has(
          row.actionType,
        ),
    );

  const structuralRows =
    repairedEventMap.filter(
      (row) =>
        row.factorDisposition ===
        'STRUCTURAL_BLOCKED',
    );

  const factorReadyRows =
    repairedEventMap.filter(
      (row) =>
        row.factorDisposition ===
        'FACTOR_READY',
    );

  const rowIssues = [];
  const missingRefreshReferences = [];

  for (const event of repairedEventMap) {
    const run =
      runByProviderId.get(
        String(event.providerEventId),
      );

    if (!run) {
      rowIssues.push({
        providerEventId:
          event.providerEventId,

        stockCode:
          event.stockCode,

        issue:
          'EXACT_RUN_REFERENCE_MISSING',
      });
      continue;
    }

    if (
      String(run.actionEventId) !==
      String(event.eventId)
    ) {
      rowIssues.push({
        providerEventId:
          event.providerEventId,

        stockCode:
          event.stockCode,

        issue:
          'RUN_ACTION_EVENT_ID_MISMATCH',

        runActionEventId:
          run.actionEventId,

        eventId:
          event.eventId,
      });
    }

    if (
      event.factorDisposition ===
      'FACTOR_READY'
    ) {
      const factor =
        factorMapByEventId.get(
          String(event.eventId),
        );

      if (!factor) {
        rowIssues.push({
          providerEventId:
            event.providerEventId,

          stockCode:
            event.stockCode,

          issue:
            'EXACT_FACTOR_REFERENCE_MISSING',
        });
      }
    }
  }

  const ratioRefreshPlan =
    ratioRows
      .map(
        (event) => {
          const run =
            runByProviderId.get(
              String(
                event.providerEventId,
              ),
            );

          const factor =
            factorMapByEventId.get(
              String(event.eventId),
            );

          const preview =
            factorPreviewByEventId.get(
              String(event.eventId),
            );

          if (
            !run ||
            !factor ||
            !preview
          ) {
            missingRefreshReferences.push({
              stockCode:
                event.stockCode,

              providerEventId:
                event.providerEventId,

              eventId:
                event.eventId,

              hasRun:
                Boolean(run),

              hasFactor:
                Boolean(factor),

              hasFactorPreview:
                Boolean(preview),
            });
          }

          return {
            stockCode:
              event.stockCode,

            eventId:
              event.eventId,

            providerEventId:
              event.providerEventId,

            actionType:
              event.actionType,

            effectiveDate:
              event.effectiveDate,

            adjustmentRunId:
              run?.runId ?? null,

            adjustmentFactorId:
              factor?.factorId ?? null,

            eventPriceFactor:
              preview
                ?.event_price_factor ??
              null,

            eventShareFactor:
              preview
                ?.event_share_factor ??
              null,

            cumulativePriceFactor:
              preview
                ?.cumulative_price_factor ??
              null,

            cumulativeShareFactor:
              preview
                ?.cumulative_share_factor ??
              null,

            refreshPolicy:
              'REQUERY_KIS_ADJUSTED_HISTORY',

            applyStoredFactorToCanonicalBars:
              false,

            reason:
              'CANONICAL_BARS_ARE_ALREADY_KIS_ADJUSTED',
          };
        },
      )
      .sort(
        (a, b) =>
          `${a.effectiveDate}|${a.stockCode}`
            .localeCompare(
              `${b.effectiveDate}|${b.stockCode}`,
            ),
      );

  const cashNoRefresh =
    cashRows
      .map(
        (event) => {
          const run =
            runByProviderId.get(
              String(
                event.providerEventId,
              ),
            );

          const factor =
            factorMapByEventId.get(
              String(event.eventId),
            );

          return {
            stockCode:
              event.stockCode,

            eventId:
              event.eventId,

            providerEventId:
              event.providerEventId,

            actionType:
              event.actionType,

            effectiveDate:
              event.effectiveDate,

            adjustmentRunId:
              run?.runId ?? null,

            adjustmentFactorId:
              factor?.factorId ?? null,

            refreshPolicy:
              'NO_HISTORY_REFRESH',

            factorRetentionPolicy:
              'AUDIT_AND_RESEARCH_ONLY',

            applyStoredFactorToCanonicalBars:
              false,
          };
        },
      )
      .sort(
        (a, b) =>
          `${a.effectiveDate}|${a.stockCode}`
            .localeCompare(
              `${b.effectiveDate}|${b.stockCode}`,
            ),
      );

  const structuralBlockedPlan =
    structuralRows
      .map(
        (event) => {
          const run =
            runByProviderId.get(
              String(
                event.providerEventId,
              ),
            );

          return {
            stockCode:
              event.stockCode,

            eventId:
              event.eventId,

            providerEventId:
              event.providerEventId,

            actionType:
              event.actionType,

            effectiveDate:
              event.effectiveDate,

            adjustmentRunId:
              run?.runId ?? null,

            refreshPolicy:
              'GENERIC_HISTORY_REFRESH_BLOCKED',

            genericFactorApplication:
              false,

            factorExpected:
              false,

            persistenceSource:
              event.persistenceStatus,
          };
        },
      )
      .sort(
        (a, b) =>
          `${a.effectiveDate}|${a.stockCode}`
            .localeCompare(
              `${b.effectiveDate}|${b.stockCode}`,
            ),
      );

  const ratioDistinctStocks =
    new Set(
      ratioRefreshPlan.map(
        (row) => row.stockCode,
      ),
    ).size;

  const blockers = [];

  if (
    repairedEventMap.length !==
    EXPECTED_EVENTS
  ) {
    blockers.push(
      'EXPECTED_128_EVENTS',
    );
  }

  if (
    resume.exactRunMap.length !==
    EXPECTED_RUNS
  ) {
    blockers.push(
      'EXPECTED_128_EXACT_RUNS',
    );
  }

  if (
    resume.exactFactorMap.length !==
    EXPECTED_FACTORS
  ) {
    blockers.push(
      'EXPECTED_121_EXACT_FACTORS',
    );
  }

  if (
    factorReadyRows.length !==
    EXPECTED_FACTORS
  ) {
    blockers.push(
      'EXPECTED_121_FACTOR_READY',
    );
  }

  if (
    cashRows.length !==
    EXPECTED_CASH
  ) {
    blockers.push(
      'EXPECTED_79_CASH_DIVIDENDS',
    );
  }

  if (
    reverseRows.length !==
    EXPECTED_REVERSE
  ) {
    blockers.push(
      'EXPECTED_40_REVERSE_SPLITS',
    );
  }

  if (
    splitRows.length !==
    EXPECTED_SPLIT
  ) {
    blockers.push(
      'EXPECTED_2_STOCK_SPLITS',
    );
  }

  if (
    ratioRefreshPlan.length !==
    EXPECTED_RATIO_REFRESH
  ) {
    blockers.push(
      'EXPECTED_42_RATIO_REFRESH_CANDIDATES',
    );
  }

  if (
    ratioDistinctStocks !==
    EXPECTED_RATIO_REFRESH
  ) {
    blockers.push(
      'EXPECTED_42_DISTINCT_RATIO_STOCKS',
    );
  }

  if (
    structuralRows.length !==
    EXPECTED_STRUCTURAL
  ) {
    blockers.push(
      'EXPECTED_7_STRUCTURAL_BLOCKED',
    );
  }

  if (
    rowIssues.length > 0
  ) {
    blockers.push(
      'EVENT_RUN_FACTOR_REFERENCE_ISSUES',
    );
  }

  if (
    missingRefreshReferences.length > 0
  ) {
    blockers.push(
      'MISSING_RATIO_REFRESH_REFERENCES',
    );
  }

  const structuralFactorLeak =
    structuralRows.filter(
      (event) =>
        factorMapByEventId.has(
          String(event.eventId),
        ),
    );

  if (
    structuralFactorLeak.length > 0
  ) {
    blockers.push(
      'STRUCTURAL_EVENT_FACTOR_LEAK',
    );
  }

  const status =
    blockers.length === 0
      ? 'POST_PERSISTENCE_VERIFICATION_AND_REFRESH_MANIFEST_READY'
      : 'POST_PERSISTENCE_VERIFICATION_AND_REFRESH_MANIFEST_BLOCKED';

  const report = {
    status,
    version: VERSION,

    source: {
      resumeVersion:
        resume.version,

      resumeFingerprint:
        resume.outputFingerprint ?? null,

      readinessVersion:
        readiness.version,

      readinessFingerprint:
        readiness.outputFingerprint ?? null,

      preflightVersion:
        preflight.version,

      preflightFingerprint:
        preflight.outputFingerprint ?? null,

      repairDryRunVersion:
        repair.version,

      repairDryRunFingerprint:
        repair.outputFingerprint ?? null,
    },

    counts: {
      totalEvents:
        repairedEventMap.length,

      exactRuns:
        resume.exactRunMap.length,

      exactFactors:
        resume.exactFactorMap.length,

      factorReady:
        factorReadyRows.length,

      cashNoRefresh:
        cashNoRefresh.length,

      reverseSplitRefresh:
        reverseRows.length,

      stockSplitRefresh:
        splitRows.length,

      ratioRefreshCandidates:
        ratioRefreshPlan.length,

      ratioDistinctStocks,

      structuralBlocked:
        structuralBlockedPlan.length,

      rowIssueRows:
        rowIssues.length,

      missingRefreshReferences:
        missingRefreshReferences.length,

      structuralFactorLeakRows:
        structuralFactorLeak.length,

      blockers:
        blockers.length,
    },

    actionTypeCounts:
      countBy(
        repairedEventMap,
        (row) =>
          row.actionType,
      ),

    factorDispositionCounts:
      countBy(
        repairedEventMap,
        (row) =>
          row.factorDisposition,
      ),

    blockers,
    rowIssues,
    missingRefreshReferences,

    marketDataPolicy: {
      canonicalSource:
        'KIS_ADJUSTED_DAILY_BARS',

      adjustedPrice:
        true,

      doubleAdjustment:
        'PROHIBITED',

      cashDividend:
        'NO_HISTORY_REFRESH_FACTOR_AUDIT_ONLY',

      stockSplitReverseSplit:
        'REQUERY_KIS_ADJUSTED_HISTORY',

      mergerSpinOff:
        'GENERIC_HISTORY_REFRESH_BLOCKED',
    },

    ratioRefreshPlan,
    cashNoRefresh,
    structuralBlockedPlan,

    virtualRepairContext: {
      appliedInMemoryOnly:
        true,

      stockCode:
        '028080',

      providerEventId:
        repairedEvent.provider_event_id,

      eventId:
        repairedEvent.id,

      actionType:
        repairedEvent.action_type,

      effectiveDate:
        repairedEvent.effective_date,

      physicalDatabaseRepairStillOutstanding:
        true,
    },

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

      productionApplied:
        false,
    },

    nextGate:
      status ===
      'POST_PERSISTENCE_VERIFICATION_AND_REFRESH_MANIFEST_READY'
        ? 'BUILD_V9_8_11_10_1_RATIO_REFRESH_ELIGIBILITY_REPLAY'
        : 'STOP_AND_REVIEW',

    outputFile:
      'logs/opendart-corporate-action-post-persistence-refresh-plan-v9-8-11-10-replay.json',
  };

  report.outputFingerprint =
    sha256(
      JSON.stringify({
        version:
          report.version,

        source:
          report.source,

        status:
          report.status,

        ratioRefreshPlan:
          ratioRefreshPlan.map(
            (row) => [
              row.stockCode,
              row.providerEventId,
              row.actionType,
              row.effectiveDate,
              row.adjustmentRunId,
              row.adjustmentFactorId,
            ],
          ),

        cashNoRefresh:
          cashNoRefresh.map(
            (row) => [
              row.stockCode,
              row.providerEventId,
              row.effectiveDate,
            ],
          ),

        structuralBlocked:
          structuralBlockedPlan.map(
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

        actionTypeCounts:
          report.actionTypeCounts,

        factorDispositionCounts:
          report.factorDispositionCounts,

        virtualRepairContext:
          report.virtualRepairContext,

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
    'POST_PERSISTENCE_VERIFICATION_AND_REFRESH_MANIFEST_READY'
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
          'POST_PERSISTENCE_VERIFICATION_AND_REFRESH_MANIFEST_FAILED',

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
