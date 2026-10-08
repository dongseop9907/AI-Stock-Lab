#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * V9.8.11.9 replay - READ-ONLY virtual repaired resume audit
 *
 * Historical V9.8.11.9 is a WRITE stage.
 * This replay DOES NOT WRITE.
 *
 * It overlays the proven 028080 two-row in-place repair in memory and verifies
 * the exact state that historical V9.8.11.9 would require after persistence:
 *
 *   exact target runs = 128
 *   exact factors     = 121
 *
 * Important:
 * - 127 runs are read from DB unchanged.
 * - 028080 run is read from DB and virtually patched in memory.
 * - canonical event UUID for 028080 is preserved by the proven repair plan.
 * - 121 factors are read from DB unchanged.
 * - no factor belongs to 028080 because it is STRUCTURAL_BLOCKED.
 *
 * No POST/PATCH/DELETE.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_8_11_9_REPLAY_READ_ONLY_VIRTUAL_REPAIRED_128_RUN_121_FACTOR_RESUME_AUDIT';

const READINESS_VERSION =
  'V9_8_11_7_REPLAY_VIRTUAL_128_EVENT_READINESS_AND_REAL_UUID_AUDIT';

const PREFLIGHT_VERSION =
  'V9_8_11_8_1_REPLAY_SCHEMA_AWARE_VIRTUAL_128_PERSISTENCE_PREFLIGHT';

const DRIFT_VERSION =
  'V9_8_11_8_2_REPLAY_LINEAGE_AND_STOCK_UNIVERSE_DRIFT_AUDIT';

const REPAIR_DRY_RUN_VERSION =
  'V9_8_11_8_3_3_REPLAY_028080_TWO_ROW_IN_PLACE_REPAIR_DRY_RUN_PREFLIGHT';

const RUN_VERSION =
  'V9_8_11_PRODUCTION_ADJUSTMENT_V1';

const EXPECTED_RUNS = 128;
const EXPECTED_FACTORS = 121;
const EXPECTED_STRUCTURAL = 7;
const EXPECTED_FACTOR_READY = 121;

const STOCK_028080 = '028080';
const OLD_PROVIDER_EVENT_ID = '20260630001117';
const NEW_PROVIDER_EVENT_ID = '20221013000451';

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

function requireEnv() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL;

  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error('SUPABASE_URL_REQUIRED');
  }

  if (!key) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY_REQUIRED',
    );
  }

  return {
    url: String(url).replace(/\/+$/, ''),
    key: String(key),
  };
}

async function getArray(url, key) {
  const response =
    await fetch(url, {
      method: 'GET',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
      },
    });

  const text =
    await response.text();

  let body;

  try {
    body =
      text.length > 0
        ? JSON.parse(text)
        : [];
  } catch {
    throw new Error(
      `INVALID_SUPABASE_JSON_RESPONSE:${response.status}`,
    );
  }

  if (!response.ok) {
    const error =
      new Error(
        `SUPABASE_READ_FAILED:${body?.code ?? response.status}`,
      );

    error.details = body;
    throw error;
  }

  if (!Array.isArray(body)) {
    throw new Error(
      'EXPECTED_SUPABASE_ARRAY_RESPONSE',
    );
  }

  return body;
}

function asStringArray(value) {
  return Array.isArray(value)
    ? value.map(String)
    : [];
}

function approximatelyEqual(a, b) {
  const na = Number(a);
  const nb = Number(b);

  if (
    !Number.isFinite(na) ||
    !Number.isFinite(nb)
  ) {
    return false;
  }

  const scale =
    Math.max(
      1,
      Math.abs(na),
      Math.abs(nb),
    );

  return (
    Math.abs(na - nb) <=
    scale * 1e-12
  );
}

function stableClone(value) {
  return JSON.parse(
    JSON.stringify(value),
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
      ([a], [b]) =>
        a.localeCompare(b),
    ),
  );
}

function compareRun(
  actual,
  target,
  expectedEventId,
) {
  const mismatches = [];

  const check =
    (field, a, b) => {
      if (a !== b) {
        mismatches.push({
          field,
          actual: a ?? null,
          expected: b ?? null,
        });
      }
    };

  const structural =
    target.factorDisposition ===
    'STRUCTURAL_BLOCKED';

  check(
    'stock_code',
    actual.stock_code,
    target.stockCode,
  );

  check(
    'version',
    actual.version,
    RUN_VERSION,
  );

  check(
    'status',
    actual.status,
    structural
      ? 'BLOCKED_UNSUPPORTED_ACTION'
      : 'READY',
  );

  check(
    'event_count',
    actual.event_count,
    1,
  );

  check(
    'supported_event_count',
    actual.supported_event_count,
    structural ? 0 : 1,
  );

  check(
    'unsupported_event_count',
    actual.unsupported_event_count,
    structural ? 1 : 0,
  );

  check(
    'factor_count',
    actual.factor_count,
    structural ? 0 : 1,
  );

  check(
    'is_validation',
    actual.is_validation,
    false,
  );

  check(
    'production_applied',
    actual.production_applied,
    false,
  );

  const providerIds =
    asStringArray(
      actual.summary
        ?.provider_event_ids,
    );

  const eventIds =
    asStringArray(
      actual.summary
        ?.event_ids,
    );

  const actionTypes =
    asStringArray(
      actual.summary
        ?.action_types,
    );

  if (
    providerIds.length !== 1 ||
    providerIds[0] !==
      String(target.providerEventId)
  ) {
    mismatches.push({
      field:
        'summary.provider_event_ids',
      actual:
        providerIds,
      expected: [
        String(
          target.providerEventId,
        ),
      ],
    });
  }

  if (
    eventIds.length !== 1 ||
    eventIds[0] !==
      String(expectedEventId)
  ) {
    mismatches.push({
      field:
        'summary.event_ids',
      actual:
        eventIds,
      expected: [
        String(
          expectedEventId,
        ),
      ],
    });
  }

  if (
    actionTypes.length !== 1 ||
    actionTypes[0] !==
      String(target.actionType)
  ) {
    mismatches.push({
      field:
        'summary.action_types',
      actual:
        actionTypes,
      expected: [
        String(target.actionType),
      ],
    });
  }

  return mismatches;
}

function compareFactor(
  actual,
  expectedPreview,
  expectedRunId,
) {
  const mismatches = [];

  const check =
    (field, a, b) => {
      if (a !== b) {
        mismatches.push({
          field,
          actual: a ?? null,
          expected: b ?? null,
        });
      }
    };

  check(
    'adjustment_run_id',
    actual.adjustment_run_id,
    expectedRunId,
  );

  check(
    'stock_code',
    actual.stock_code,
    expectedPreview.stock_code,
  );

  check(
    'effective_date',
    actual.effective_date,
    expectedPreview.effective_date,
  );

  check(
    'action_event_id',
    actual.action_event_id,
    expectedPreview.action_event_id,
  );

  check(
    'action_type',
    actual.action_type,
    expectedPreview.action_type,
  );

  for (
    const field of
    [
      'event_price_factor',
      'event_share_factor',
      'cumulative_price_factor',
      'cumulative_share_factor',
    ]
  ) {
    if (
      !approximatelyEqual(
        actual[field],
        expectedPreview[field],
      )
    ) {
      mismatches.push({
        field,
        actual:
          actual[field],
        expected:
          expectedPreview[field],
      });
    }
  }

  check(
    'is_validation',
    actual.is_validation,
    false,
  );

  check(
    'production_applied',
    actual.production_applied,
    false,
  );

  return mismatches;
}

async function main() {
  const root =
    path.resolve(__dirname, '..');

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

  const driftFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-lineage-universe-drift-audit-v9-8-11-8-2-replay.json',
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
      'opendart-corporate-action-adjustment-persistence-resume-audit-v9-8-11-9-replay.json',
    );

  for (
    const file of
    [
      readinessFile,
      preflightFile,
      driftFile,
      repairFile,
    ]
  ) {
    assert(
      fs.existsSync(file),
      `INPUT_NOT_FOUND:${path.basename(file)}`,
    );
  }

  const readiness =
    readJson(readinessFile);

  const preflight =
    readJson(preflightFile);

  const drift =
    readJson(driftFile);

  const repair =
    readJson(repairFile);

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
    drift.version ===
      DRIFT_VERSION,
    `DRIFT_VERSION_MISMATCH:${drift.version}`,
  );

  assert(
    drift.status ===
      'LINEAGE_AND_UNIVERSE_DRIFT_AUDIT_COMPLETE',
    `DRIFT_AUDIT_NOT_COMPLETE:${drift.status}`,
  );

  assert(
    drift.conclusions
      ?.universeDriftClassified === true,
    'UNIVERSE_DRIFT_NOT_CLASSIFIED',
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
        EXPECTED_RUNS,
    `EVENT_MAP_COUNT:${readiness.eventMap?.length}`,
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

  const repairedRun =
    repair.simulatedPostState
      ?.adjustmentRun;

  assert(
    repairedEvent &&
      repairedRun,
    'SIMULATED_REPAIR_STATE_MISSING',
  );

  assert(
    repairedEvent.stock_code ===
      STOCK_028080,
    `REPAIRED_EVENT_STOCK:${repairedEvent.stock_code}`,
  );

  assert(
    repairedEvent.provider_event_id ===
      NEW_PROVIDER_EVENT_ID,
    `REPAIRED_EVENT_PROVIDER_ID:${repairedEvent.provider_event_id}`,
  );

  assert(
    repairedRun.stock_code ===
      STOCK_028080,
    `REPAIRED_RUN_STOCK:${repairedRun.stock_code}`,
  );

  const virtualEventMap =
    readiness.eventMap.map(
      (row) => {
        if (
          String(row.stockCode) !==
          STOCK_028080
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
            NEW_PROVIDER_EVENT_ID,

          stockCode:
            STOCK_028080,

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

  const factorReadyTargets =
    virtualEventMap.filter(
      (row) =>
        row.factorDisposition ===
        'FACTOR_READY',
    );

  const structuralTargets =
    virtualEventMap.filter(
      (row) =>
        row.factorDisposition ===
        'STRUCTURAL_BLOCKED',
    );

  assert(
    factorReadyTargets.length ===
      EXPECTED_FACTOR_READY,
    `FACTOR_READY_TARGET_COUNT:${factorReadyTargets.length}`,
  );

  assert(
    structuralTargets.length ===
      EXPECTED_STRUCTURAL,
    `STRUCTURAL_TARGET_COUNT:${structuralTargets.length}`,
  );

  assert(
    virtualEventMap.every(
      (row) =>
        typeof row.eventId ===
          'string' &&
        row.eventId.length > 0,
    ),
    'VIRTUAL_EVENT_MAP_HAS_NULL_UUID',
  );

  const {
    url,
    key,
  } = requireEnv();

  const runs =
    await getArray(
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
        `&version=eq.${encodeURIComponent(RUN_VERSION)}` +
        `&is_validation=eq.false`,
      key,
    );

  const factors =
    await getArray(
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

  const runsByStock =
    new Map();

  for (const run of runs) {
    const stock =
      String(run.stock_code);

    if (!runsByStock.has(stock)) {
      runsByStock.set(stock, []);
    }

    runsByStock
      .get(stock)
      .push(run);
  }

  const virtualRuns = [];

  for (const run of runs) {
    if (
      String(run.id) ===
      String(repairedRun.id)
    ) {
      virtualRuns.push(
        stableClone(repairedRun),
      );
    } else {
      virtualRuns.push(run);
    }
  }

  const virtualRunsByStock =
    new Map();

  for (const run of virtualRuns) {
    const stock =
      String(run.stock_code);

    if (!virtualRunsByStock.has(stock)) {
      virtualRunsByStock.set(
        stock,
        [],
      );
    }

    virtualRunsByStock
      .get(stock)
      .push(run);
  }

  const exactRunMap = [];
  const runMismatchRows = [];
  const runCardinalityRows = [];

  for (const target of virtualEventMap) {
    const matches =
      (
        virtualRunsByStock.get(
          String(target.stockCode),
        ) ?? []
      ).filter(
        (run) =>
          run.version ===
          RUN_VERSION,
      );

    if (matches.length !== 1) {
      runCardinalityRows.push({
        stockCode:
          target.stockCode,

        providerEventId:
          target.providerEventId,

        rowCount:
          matches.length,

        runIds:
          matches.map(
            (run) => run.id,
          ),
      });
      continue;
    }

    const run =
      matches[0];

    const mismatches =
      compareRun(
        run,
        target,
        target.eventId,
      );

    if (mismatches.length > 0) {
      runMismatchRows.push({
        stockCode:
          target.stockCode,

        providerEventId:
          target.providerEventId,

        runId:
          run.id,

        mismatches,
      });
      continue;
    }

    exactRunMap.push({
      stockCode:
        target.stockCode,

      providerEventId:
        target.providerEventId,

      actionEventId:
        target.eventId,

      factorDisposition:
        target.factorDisposition,

      runId:
        run.id,

      runStatus:
        run.status,

      persistenceSource:
        target.stockCode ===
          STOCK_028080
          ? 'VIRTUAL_REPAIR_OVERLAY'
          : 'REAL_DB',
    });
  }

  const exactRunByStock =
    new Map(
      exactRunMap.map(
        (row) => [
          String(row.stockCode),
          row,
        ],
      ),
    );

  const factorsByEventId =
    new Map();

  for (const factor of factors) {
    const eventId =
      String(
        factor.action_event_id ??
        '',
      );

    if (
      !factorsByEventId.has(
        eventId,
      )
    ) {
      factorsByEventId.set(
        eventId,
        [],
      );
    }

    factorsByEventId
      .get(eventId)
      .push(factor);
  }

  const previewByEventId =
    new Map(
      preflight.factorPreview.map(
        (row) => [
          String(
            row.action_event_id,
          ),
          row,
        ],
      ),
    );

  const exactFactorMap = [];
  const factorMismatchRows = [];
  const factorCardinalityRows = [];

  for (
    const target of
    factorReadyTargets
  ) {
    const matches =
      factorsByEventId.get(
        String(target.eventId),
      ) ?? [];

    if (matches.length !== 1) {
      factorCardinalityRows.push({
        stockCode:
          target.stockCode,

        providerEventId:
          target.providerEventId,

        actionEventId:
          target.eventId,

        rowCount:
          matches.length,

        factorIds:
          matches.map(
            (row) => row.id,
          ),
      });
      continue;
    }

    const run =
      exactRunByStock.get(
        String(target.stockCode),
      );

    if (!run) {
      factorMismatchRows.push({
        stockCode:
          target.stockCode,

        providerEventId:
          target.providerEventId,

        reason:
          'EXACT_RUN_NOT_AVAILABLE',
      });
      continue;
    }

    const preview =
      previewByEventId.get(
        String(target.eventId),
      );

    if (!preview) {
      factorMismatchRows.push({
        stockCode:
          target.stockCode,

        providerEventId:
          target.providerEventId,

        actionEventId:
          target.eventId,

        reason:
          'FACTOR_PREVIEW_NOT_FOUND',
      });
      continue;
    }

    const factor =
      matches[0];

    const mismatches =
      compareFactor(
        factor,
        preview,
        run.runId,
      );

    if (mismatches.length > 0) {
      factorMismatchRows.push({
        stockCode:
          target.stockCode,

        providerEventId:
          target.providerEventId,

        factorId:
          factor.id,

        mismatches,
      });
      continue;
    }

    exactFactorMap.push({
      stockCode:
        target.stockCode,

      providerEventId:
        target.providerEventId,

      actionEventId:
        target.eventId,

      runId:
        run.runId,

      factorId:
        factor.id,

      actionType:
        factor.action_type,

      effectiveDate:
        factor.effective_date,
    });
  }

  const structuralFactorRows =
    structuralTargets.flatMap(
      (target) => {
        const matches =
          factorsByEventId.get(
            String(target.eventId),
          ) ?? [];

        return matches.map(
          (factor) => ({
            stockCode:
              target.stockCode,

            providerEventId:
              target.providerEventId,

            actionEventId:
              target.eventId,

            factorId:
              factor.id,
          }),
        );
      },
    );

  const exactRunIds =
    new Set(
      exactRunMap.map(
        (row) => row.runId,
      ),
    );

  const exactFactorIds =
    new Set(
      exactFactorMap.map(
        (row) => row.factorId,
      ),
    );

  const blockers = [];

  if (
    runCardinalityRows.length > 0
  ) {
    blockers.push(
      'TARGET_RUN_CARDINALITY_MISMATCH',
    );
  }

  if (
    runMismatchRows.length > 0
  ) {
    blockers.push(
      'TARGET_RUN_CONTRACT_MISMATCH',
    );
  }

  if (
    exactRunMap.length !==
    EXPECTED_RUNS
  ) {
    blockers.push(
      'EXACT_TARGET_RUN_COUNT_NOT_128',
    );
  }

  if (
    exactRunIds.size !==
    EXPECTED_RUNS
  ) {
    blockers.push(
      'EXACT_RUN_UUID_COUNT_NOT_128',
    );
  }

  if (
    factorCardinalityRows.length > 0
  ) {
    blockers.push(
      'TARGET_FACTOR_CARDINALITY_MISMATCH',
    );
  }

  if (
    factorMismatchRows.length > 0
  ) {
    blockers.push(
      'TARGET_FACTOR_CONTRACT_MISMATCH',
    );
  }

  if (
    exactFactorMap.length !==
    EXPECTED_FACTORS
  ) {
    blockers.push(
      'EXACT_TARGET_FACTOR_COUNT_NOT_121',
    );
  }

  if (
    exactFactorIds.size !==
    EXPECTED_FACTORS
  ) {
    blockers.push(
      'EXACT_FACTOR_UUID_COUNT_NOT_121',
    );
  }

  if (
    structuralFactorRows.length > 0
  ) {
    blockers.push(
      'STRUCTURAL_EVENT_HAS_FACTOR_ROWS',
    );
  }

  const status =
    blockers.length === 0
      ? 'V9_8_11_9_VIRTUAL_REPAIRED_RESUME_STATE_COMPLETE'
      : 'V9_8_11_9_VIRTUAL_REPAIRED_RESUME_STATE_BLOCKED';

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

      driftVersion:
        drift.version,

      driftFingerprint:
        drift.outputFingerprint ?? null,

      repairDryRunVersion:
        repair.version,

      repairDryRunFingerprint:
        repair.outputFingerprint ?? null,
    },

    counts: {
      targetEvents:
        virtualEventMap.length,

      factorReadyEvents:
        factorReadyTargets.length,

      structuralEvents:
        structuralTargets.length,

      exactTargetRuns:
        exactRunMap.length,

      exactRunUuids:
        exactRunIds.size,

      runCardinalityIssueRows:
        runCardinalityRows.length,

      runMismatchRows:
        runMismatchRows.length,

      exactTargetFactors:
        exactFactorMap.length,

      exactFactorUuids:
        exactFactorIds.size,

      factorCardinalityIssueRows:
        factorCardinalityRows.length,

      factorMismatchRows:
        factorMismatchRows.length,

      structuralFactorRows:
        structuralFactorRows.length,

      virtualRepairOverlayRuns:
        exactRunMap.filter(
          (row) =>
            row.persistenceSource ===
            'VIRTUAL_REPAIR_OVERLAY',
        ).length,

      databaseRunRowsRead:
        runs.length,

      databaseFactorRowsRead:
        factors.length,

      blockers:
        blockers.length,
    },

    resumeState: {
      historicalPolicy:
        {
          exact128Runs:
            'REUSE',

          exact121Factors:
            'REUSE',

          partialOrConflicting:
            'FAIL_CLOSED',
        },

      virtualRepairApplied:
        true,

      actualDatabaseWritesPerformed:
        false,

      runState:
        exactRunMap.length ===
          EXPECTED_RUNS &&
        runMismatchRows.length === 0 &&
        runCardinalityRows.length === 0
          ? 'REUSE_128_EXACT'
          : 'BLOCKED',

      factorState:
        exactFactorMap.length ===
          EXPECTED_FACTORS &&
        factorMismatchRows.length === 0 &&
        factorCardinalityRows.length === 0
          ? 'REUSE_121_EXACT'
          : 'BLOCKED',

      persistenceApplyNeededForRuns:
        false,

      persistenceApplyNeededForFactors:
        false,

      onlyOutstandingPhysicalRepair:
        {
          stockCode:
            STOCK_028080,

          canonicalEventProviderEventId:
            {
              from:
                OLD_PROVIDER_EVENT_ID,

              to:
                NEW_PROVIDER_EVENT_ID,
            },

          adjustmentRunSummaryProviderEventId:
            {
              from:
                OLD_PROVIDER_EVENT_ID,

              to:
                NEW_PROVIDER_EVENT_ID,
            },

          factorChanges:
            0,
        },
    },

    persistenceStatusCounts:
      countBy(
        exactRunMap,
        (row) =>
          row.persistenceSource,
      ),

    exactRunMap,
    exactFactorMap,

    runCardinalityRows,
    runMismatchRows,
    factorCardinalityRows,
    factorMismatchRows,
    structuralFactorRows,

    blockers,

    safety: {
      httpMethodsUsed: [
        'GET',
      ],

      networkRequests:
        2,

      databaseReads:
        2,

      databaseWrites:
        0,

      postRequests:
        0,

      patchRequests:
        0,

      deleteRequests:
        0,

      syntheticUuidsGenerated:
        0,

      productionApplied:
        false,
    },

    nextGate:
      status ===
      'V9_8_11_9_VIRTUAL_REPAIRED_RESUME_STATE_COMPLETE'
        ? 'BUILD_V9_8_11_10_READ_ONLY_POST_PERSISTENCE_REFRESH_PLAN_REPLAY'
        : 'STOP_AND_REVIEW',

    outputFile:
      'logs/opendart-corporate-action-adjustment-persistence-resume-audit-v9-8-11-9-replay.json',
  };

  report.outputFingerprint =
    sha256(
      JSON.stringify({
        version:
          report.version,

        source:
          report.source,

        counts:
          report.counts,

        resumeState:
          report.resumeState,

        exactRunMap:
          exactRunMap.map(
            (row) => [
              row.stockCode,
              row.providerEventId,
              row.actionEventId,
              row.runId,
              row.persistenceSource,
            ],
          ),

        exactFactorMap:
          exactFactorMap.map(
            (row) => [
              row.stockCode,
              row.providerEventId,
              row.actionEventId,
              row.runId,
              row.factorId,
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

        resumeState:
          report.resumeState,

        persistenceStatusCounts:
          report.persistenceStatusCounts,

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
    'V9_8_11_9_VIRTUAL_REPAIRED_RESUME_STATE_COMPLETE'
  ) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status:
          'V9_8_11_9_VIRTUAL_REPAIRED_RESUME_AUDIT_FAILED',

        version:
          VERSION,

        error:
          String(
            error?.message ??
            error,
          ),

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
