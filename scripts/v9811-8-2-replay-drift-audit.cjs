#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * V9.8.11.8.2 replay - lineage / universe drift audit
 *
 * READ ONLY.
 *
 * Purpose:
 * 1) Count adjustment runs by EXACT provider_event_id reference, not merely stock_code.
 * 2) Identify stale same-stock runs created from pre-repair lineage.
 * 3) Classify the 79 current stock_universe misses:
 *    - whether their repaired target run already exists
 *    - whether factor-ready events already have factors
 *    - whether they are only a current reference-universe drift
 * 4) Inspect all canonical 028080 rows and its stale/current lineage.
 *
 * No writes.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_8_11_8_2_REPLAY_LINEAGE_AND_STOCK_UNIVERSE_DRIFT_AUDIT';

const READINESS_VERSION =
  'V9_8_11_7_REPLAY_VIRTUAL_128_EVENT_READINESS_AND_REAL_UUID_AUDIT';

const PREFLIGHT_VERSION =
  'V9_8_11_8_1_REPLAY_SCHEMA_AWARE_VIRTUAL_128_PERSISTENCE_PREFLIGHT';

const RUN_VERSION =
  'V9_8_11_PRODUCTION_ADJUSTMENT_V1';

const EXPECTED_EVENTS = 128;
const EXPECTED_FACTOR_READY = 121;
const EXPECTED_STRUCTURAL = 7;
const EXPECTED_MISSING_UNIVERSE = 79;

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

function requireEnv() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL;

  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error('SUPABASE_URL_REQUIRED');
  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY_REQUIRED');
  }

  return {
    url: String(url).replace(/\/+$/, ''),
    key: String(key),
  };
}

async function getArray(url, key) {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
    },
  });

  const text = await response.text();

  let body;
  try {
    body = text ? JSON.parse(text) : [];
  } catch {
    throw new Error(
      `INVALID_SUPABASE_JSON_RESPONSE:${response.status}`,
    );
  }

  if (!response.ok) {
    const error = new Error(
      `SUPABASE_READ_FAILED:${body?.code ?? response.status}`,
    );
    error.details = body;
    throw error;
  }

  if (!Array.isArray(body)) {
    throw new Error('EXPECTED_ARRAY_RESPONSE');
  }

  return body;
}

function summaryProviderEventIds(run) {
  const ids = run?.summary?.provider_event_ids;

  if (!Array.isArray(ids)) return [];

  return ids.map(String);
}

function countBy(rows, fn) {
  const out = {};

  for (const row of rows) {
    const key = String(fn(row) ?? 'NULL');
    out[key] = (out[key] ?? 0) + 1;
  }

  return Object.fromEntries(
    Object.entries(out).sort(
      ([a], [b]) => a.localeCompare(b),
    ),
  );
}

async function main() {
  const root = path.resolve(__dirname, '..');

  const readinessFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-128-event-readiness-v9-8-11-7-replay.json',
  );

  const preflightFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-adjustment-persistence-preflight-v9-8-11-8-1-replay-virtual.json',
  );

  const outputFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-lineage-universe-drift-audit-v9-8-11-8-2-replay.json',
  );

  assert(
    fs.existsSync(readinessFile),
    `READINESS_NOT_FOUND:${path.basename(readinessFile)}`,
  );

  assert(
    fs.existsSync(preflightFile),
    `PREFLIGHT_NOT_FOUND:${path.basename(preflightFile)}`,
  );

  const readiness = readJson(readinessFile);
  const preflight = readJson(preflightFile);

  assert(
    readiness.version === READINESS_VERSION,
    `READINESS_VERSION_MISMATCH:${readiness.version}`,
  );

  assert(
    readiness.status ===
      'VIRTUAL_128_EVENT_READINESS_PROVEN_FACTOR_PIPELINE_UNBLOCKED',
    `READINESS_NOT_PROVEN:${readiness.status}`,
  );

  assert(
    preflight.version === PREFLIGHT_VERSION,
    `PREFLIGHT_VERSION_MISMATCH:${preflight.version}`,
  );

  assert(
    Array.isArray(readiness.eventMap) &&
      readiness.eventMap.length === EXPECTED_EVENTS,
    `EVENT_MAP_COUNT_MISMATCH:${readiness.eventMap?.length}`,
  );

  assert(
    Array.isArray(preflight.missingStockUniverse) &&
      preflight.missingStockUniverse.length === EXPECTED_MISSING_UNIVERSE,
    `MISSING_UNIVERSE_COUNT_CHANGED:${preflight.missingStockUniverse?.length}`,
  );

  const eventMap = readiness.eventMap;

  const factorReady = eventMap.filter(
    (row) => row.factorDisposition === 'FACTOR_READY',
  );

  const structural = eventMap.filter(
    (row) => row.factorDisposition === 'STRUCTURAL_BLOCKED',
  );

  assert(
    factorReady.length === EXPECTED_FACTOR_READY,
    `FACTOR_READY_COUNT_MISMATCH:${factorReady.length}`,
  );

  assert(
    structural.length === EXPECTED_STRUCTURAL,
    `STRUCTURAL_COUNT_MISMATCH:${structural.length}`,
  );

  const missingUniverseSet =
    new Set(
      preflight.missingStockUniverse.map(String),
    );

  const { url, key } = requireEnv();

  // Current production/non-validation runs.
  const runs = await getArray(
    `${url}/rest/v1/corporate_action_adjustment_runs` +
      `?select=${encodeURIComponent(
        [
          'id',
          'stock_code',
          'version',
          'status',
          'event_count',
          'supported_event_count',
          'unsupported_event_count',
          'factor_count',
          'summary',
          'is_validation',
          'production_applied',
          'started_at',
          'finished_at',
          'error_message',
        ].join(','),
      )}` +
      `&is_validation=eq.false`,
    key,
  );

  // Current production/non-validation factors.
  const factors = await getArray(
    `${url}/rest/v1/corporate_action_adjustment_factors` +
      `?select=${encodeURIComponent(
        [
          'id',
          'adjustment_run_id',
          'stock_code',
          'effective_date',
          'action_event_id',
          'action_type',
          'event_price_factor',
          'event_share_factor',
          'cumulative_price_factor',
          'cumulative_share_factor',
          'metadata',
          'is_validation',
          'production_applied',
          'created_at',
        ].join(','),
      )}` +
      `&is_validation=eq.false`,
    key,
  );

  // Current canonical production namespace.
  const events = await getArray(
    `${url}/rest/v1/corporate_action_events` +
      `?select=${encodeURIComponent(
        [
          'id',
          'stock_code',
          'action_type',
          'effective_date',
          'provider',
          'provider_event_id',
          'source_fingerprint',
          'status',
          'metadata',
          'is_validation',
          'production_applied',
          'created_at',
        ].join(','),
      )}` +
      `&provider=eq.${encodeURIComponent('DART_KRX_CANONICAL')}` +
      `&is_validation=eq.false`,
    key,
  );

  // Current stock-universe list (for audit snapshot only).
  const universeRows = await getArray(
    `${url}/rest/v1/stock_universe_securities` +
      `?select=${encodeURIComponent('stock_code')}`,
    key,
  );

  const currentUniverse =
    new Set(
      universeRows.map(
        (row) => String(row.stock_code),
      ),
    );

  const runsByStock = new Map();

  for (const run of runs) {
    const stock = String(run.stock_code);

    if (!runsByStock.has(stock)) {
      runsByStock.set(stock, []);
    }

    runsByStock.get(stock).push(run);
  }

  const runsByReferencedProviderEventId = new Map();

  for (const run of runs) {
    for (const providerEventId of summaryProviderEventIds(run)) {
      if (!runsByReferencedProviderEventId.has(providerEventId)) {
        runsByReferencedProviderEventId.set(providerEventId, []);
      }

      runsByReferencedProviderEventId
        .get(providerEventId)
        .push(run);
    }
  }

  const factorsByActionEventId = new Map();

  for (const factor of factors) {
    const id = String(factor.action_event_id ?? '');

    if (!factorsByActionEventId.has(id)) {
      factorsByActionEventId.set(id, []);
    }

    factorsByActionEventId.get(id).push(factor);
  }

  const eventsByProviderId = new Map();

  for (const event of events) {
    const id = String(event.provider_event_id ?? '');

    if (!eventsByProviderId.has(id)) {
      eventsByProviderId.set(id, []);
    }

    eventsByProviderId.get(id).push(event);
  }

  const exactTargetRunCoverage = [];
  const missingExactTargetRuns = [];
  const staleSameStockRuns = [];
  const factorCoverage = [];
  const factorCoverageIssues = [];

  for (const target of eventMap) {
    const exactRuns =
      (
        runsByReferencedProviderEventId.get(
          String(target.providerEventId),
        ) ?? []
      ).filter(
        (run) =>
          run.version === RUN_VERSION &&
          String(run.stock_code) ===
            String(target.stockCode),
      );

    if (exactRuns.length === 1) {
      exactTargetRunCoverage.push({
        providerEventId:
          target.providerEventId,

        stockCode:
          target.stockCode,

        factorDisposition:
          target.factorDisposition,

        runId:
          exactRuns[0].id,

        runStatus:
          exactRuns[0].status,

        referencedProviderEventIds:
          summaryProviderEventIds(exactRuns[0]),
      });
    } else {
      const sameStockRuns =
        (runsByStock.get(String(target.stockCode)) ?? [])
          .filter(
            (run) =>
              run.version === RUN_VERSION,
          );

      missingExactTargetRuns.push({
        providerEventId:
          target.providerEventId,

        stockCode:
          target.stockCode,

        factorDisposition:
          target.factorDisposition,

        eventId:
          target.eventId,

        exactRunCount:
          exactRuns.length,

        sameVersionSameStockRuns:
          sameStockRuns.map((run) => ({
            runId:
              run.id,

            status:
              run.status,

            referencedProviderEventIds:
              summaryProviderEventIds(run),

            supportedEventCount:
              run.supported_event_count,

            unsupportedEventCount:
              run.unsupported_event_count,

            factorCount:
              run.factor_count,
          })),
      });

      for (const run of sameStockRuns) {
        const refs =
          summaryProviderEventIds(run);

        if (
          refs.length > 0 &&
          !refs.includes(
            String(target.providerEventId),
          )
        ) {
          staleSameStockRuns.push({
            targetProviderEventId:
              target.providerEventId,

            targetStockCode:
              target.stockCode,

            targetFactorDisposition:
              target.factorDisposition,

            staleRunId:
              run.id,

            staleRunStatus:
              run.status,

            staleReferencedProviderEventIds:
              refs,
          });
        }
      }
    }

    if (target.factorDisposition === 'FACTOR_READY') {
      assert(
        target.eventId,
        `FACTOR_READY_EVENT_ID_MISSING:${target.providerEventId}`,
      );

      const matchingFactors =
        factorsByActionEventId.get(
          String(target.eventId),
        ) ?? [];

      factorCoverage.push({
        providerEventId:
          target.providerEventId,

        stockCode:
          target.stockCode,

        eventId:
          target.eventId,

        factorRows:
          matchingFactors.length,
      });

      if (matchingFactors.length !== 1) {
        factorCoverageIssues.push({
          providerEventId:
            target.providerEventId,

          stockCode:
            target.stockCode,

          eventId:
            target.eventId,

          factorRows:
            matchingFactors.length,
        });
      }
    }
  }

  const missingUniverseDetail =
    eventMap
      .filter(
        (target) =>
          missingUniverseSet.has(
            String(target.stockCode),
          ),
      )
      .map((target) => {
        const exactRuns =
          (
            runsByReferencedProviderEventId.get(
              String(target.providerEventId),
            ) ?? []
          ).filter(
            (run) =>
              run.version === RUN_VERSION &&
              String(run.stock_code) ===
                String(target.stockCode),
          );

        const factorRows =
          target.eventId
            ? (
                factorsByActionEventId.get(
                  String(target.eventId),
                ) ?? []
              )
            : [];

        let persistenceCoverage;

        if (
          target.factorDisposition === 'FACTOR_READY'
        ) {
          persistenceCoverage =
            exactRuns.length === 1 &&
            factorRows.length === 1
              ? 'EXACT_RUN_AND_FACTOR_ALREADY_EXIST'
              : 'INCOMPLETE_OR_CONFLICTING';
        } else {
          persistenceCoverage =
            exactRuns.length === 1
              ? 'EXACT_STRUCTURAL_RUN_ALREADY_EXISTS'
              : 'INCOMPLETE_OR_CONFLICTING';
        }

        return {
          stockCode:
            target.stockCode,

          providerEventId:
            target.providerEventId,

          factorDisposition:
            target.factorDisposition,

          eventId:
            target.eventId,

          currentUniversePresent:
            currentUniverse.has(
              String(target.stockCode),
            ),

          exactRunRows:
            exactRuns.length,

          factorRows:
            factorRows.length,

          persistenceCoverage,
        };
      });

  const missingUniverseCoverageCounts =
    countBy(
      missingUniverseDetail,
      (row) => row.persistenceCoverage,
    );

  const missingUniverseIncomplete =
    missingUniverseDetail.filter(
      (row) =>
        row.persistenceCoverage ===
        'INCOMPLETE_OR_CONFLICTING',
    );

  // 028080 exact audit.
  const rows028080 =
    events
      .filter(
        (row) =>
          String(row.stock_code) ===
          '028080',
      )
      .map((row) => ({
        eventId:
          row.id,

        providerEventId:
          row.provider_event_id,

        actionType:
          row.action_type,

        effectiveDate:
          row.effective_date,

        validationStatus:
          row.metadata
            ?.canonical_validation_status ?? null,

        productionApplied:
          row.production_applied,

        createdAt:
          row.created_at,
      }));

  const runs028080 =
    (runsByStock.get('028080') ?? [])
      .filter(
        (run) =>
          run.version === RUN_VERSION,
      )
      .map((run) => ({
        runId:
          run.id,

        status:
          run.status,

        referencedProviderEventIds:
          summaryProviderEventIds(run),

        eventCount:
          run.event_count,

        supportedEventCount:
          run.supported_event_count,

        unsupportedEventCount:
          run.unsupported_event_count,

        factorCount:
          run.factor_count,

        productionApplied:
          run.production_applied,
      }));

  const oldRootCanonicalRows =
    eventsByProviderId.get(
      '20260630001117',
    ) ?? [];

  const repairedRootCanonicalRows =
    eventsByProviderId.get(
      '20221013000451',
    ) ?? [];

  const blockers = [];

  if (
    exactTargetRunCoverage.length !==
    EXPECTED_EVENTS - 1
  ) {
    blockers.push(
      'EXPECTED_127_EXACT_CURRENT_TARGET_RUNS',
    );
  }

  if (missingExactTargetRuns.length !== 1) {
    blockers.push(
      'EXPECTED_ONE_MISSING_EXACT_TARGET_RUN',
    );
  }

  if (
    missingExactTargetRuns.length === 1 &&
    String(
      missingExactTargetRuns[0]
        .providerEventId,
    ) !== '20221013000451'
  ) {
    blockers.push(
      'UNEXPECTED_MISSING_EXACT_TARGET_ID',
    );
  }

  if (staleSameStockRuns.length !== 1) {
    blockers.push(
      'EXPECTED_ONE_STALE_SAME_STOCK_RUN',
    );
  }

  if (factorCoverageIssues.length > 0) {
    blockers.push(
      'FACTOR_COVERAGE_NOT_EXACT_121',
    );
  }

  if (missingUniverseIncomplete.length > 0) {
    blockers.push(
      'MISSING_UNIVERSE_HAS_INCOMPLETE_PERSISTENCE',
    );
  }

  const factorPipelineReady =
    factorCoverage.length ===
      EXPECTED_FACTOR_READY &&
    factorCoverageIssues.length === 0;

  const universeDriftClassified =
    missingUniverseDetail.length ===
      EXPECTED_MISSING_UNIVERSE &&
    missingUniverseIncomplete.length === 0;

  const downstreamRepairRequired =
    missingExactTargetRuns.length === 1 &&
    staleSameStockRuns.length === 1;

  const status =
    blockers.length === 0
      ? 'LINEAGE_AND_UNIVERSE_DRIFT_AUDIT_COMPLETE'
      : 'LINEAGE_AND_UNIVERSE_DRIFT_AUDIT_BLOCKED';

  const report = {
    status,
    version: VERSION,
    runVersion: RUN_VERSION,

    source: {
      readinessVersion:
        readiness.version,

      readinessFingerprint:
        readiness.outputFingerprint ?? null,

      preflightVersion:
        preflight.version,

      preflightFingerprint:
        preflight.outputFingerprint ?? null,
    },

    counts: {
      targetEvents:
        eventMap.length,

      factorReadyEvents:
        factorReady.length,

      structuralEvents:
        structural.length,

      exactCurrentTargetRuns:
        exactTargetRunCoverage.length,

      missingExactTargetRuns:
        missingExactTargetRuns.length,

      staleSameStockRuns:
        staleSameStockRuns.length,

      factorCoverageRows:
        factorCoverage.length,

      factorCoverageIssueRows:
        factorCoverageIssues.length,

      currentUniverseRowsReturned:
        universeRows.length,

      missingUniverseRows:
        missingUniverseDetail.length,

      missingUniverseIncompleteRows:
        missingUniverseIncomplete.length,

      oldRootCanonicalRows:
        oldRootCanonicalRows.length,

      repairedRootCanonicalRows:
        repairedRootCanonicalRows.length,

      blockers:
        blockers.length,
    },

    conclusions: {
      factorPipelineReady,

      universeDriftClassified,

      downstreamRepairRequired,

      repaired028080CanonicalEventMissing:
        repairedRootCanonicalRows.length === 0,

      old028080CanonicalEventStillPresent:
        oldRootCanonicalRows.length > 0,

      stale028080RunExpectedFromOldLineage:
        staleSameStockRuns.some(
          (row) =>
            row.targetProviderEventId ===
              '20221013000451' &&
            row.staleReferencedProviderEventIds
              .includes('20260630001117'),
        ),

      safeToTreatMissingUniverseAsReadOnlyReferenceDrift:
        universeDriftClassified,

      safeToTreat028080RunAsCurrent:
        false,
    },

    missingUniverseCoverageCounts,

    missingUniverseDetail,

    exactTargetRunCoverage,

    missingExactTargetRuns,

    staleSameStockRuns,

    factorCoverageIssues,

    audit028080: {
      canonicalRows:
        rows028080,

      sameVersionRuns:
        runs028080,

      oldRootProviderEventId:
        '20260630001117',

      oldRootCanonicalRows:
        oldRootCanonicalRows.map(
          (row) => ({
            eventId:
              row.id,
            stockCode:
              row.stock_code,
            actionType:
              row.action_type,
            effectiveDate:
              row.effective_date,
            sourceFingerprint:
              row.source_fingerprint,
          }),
        ),

      repairedRootProviderEventId:
        '20221013000451',

      repairedRootCanonicalRows:
        repairedRootCanonicalRows.map(
          (row) => ({
            eventId:
              row.id,
            stockCode:
              row.stock_code,
            actionType:
              row.action_type,
            effectiveDate:
              row.effective_date,
            sourceFingerprint:
              row.source_fingerprint,
          }),
        ),
    },

    blockers,

    safety: {
      httpMethodsUsed: ['GET'],
      networkRequests: 4,
      databaseReads: 4,
      databaseWrites: 0,
      postRequests: 0,
      patchRequests: 0,
      deleteRequests: 0,
      canonicalEventsModified: 0,
      adjustmentRunsModified: 0,
      factorsModified: 0,
      productionApplied: false,
    },

    nextGate:
      blockers.length === 0
        ? 'BUILD_READ_ONLY_REPAIRED_LINEAGE_RESUME_MAP'
        : 'STOP_AND_REVIEW',

    outputFile:
      'logs/opendart-corporate-action-lineage-universe-drift-audit-v9-8-11-8-2-replay.json',
  };

  report.outputFingerprint =
    sha256(
      JSON.stringify({
        version:
          report.version,

        exactTargetRunCoverage:
          exactTargetRunCoverage.map(
            (row) => [
              row.providerEventId,
              row.stockCode,
              row.runId,
            ],
          ),

        missingExactTargetRuns:
          missingExactTargetRuns,

        staleSameStockRuns:
          staleSameStockRuns,

        missingUniverseCoverageCounts:
          report.missingUniverseCoverageCounts,

        audit028080:
          report.audit028080,
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

        missingUniverseCoverageCounts:
          report.missingUniverseCoverageCounts,

        conclusions:
          report.conclusions,

        missingExactTargetRuns:
          report.missingExactTargetRuns,

        staleSameStockRuns:
          report.staleSameStockRuns,

        audit028080:
          report.audit028080,

        blockers:
          report.blockers,

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

  if (
    status !==
    'LINEAGE_AND_UNIVERSE_DRIFT_AUDIT_COMPLETE'
  ) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status:
          'LINEAGE_AND_UNIVERSE_DRIFT_AUDIT_FAILED',

        version:
          VERSION,

        error:
          String(error?.message ?? error),

        details:
          error?.details ?? null,

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
});
