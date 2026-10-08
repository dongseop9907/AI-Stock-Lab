#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * V9.8.11.7 replay - virtual 128-event readiness + real UUID audit
 *
 * Historical V9.8.11.7 expected a fully persisted 128-event set after
 * V9.8.11.6 apply.
 *
 * Repaired/current state deliberately has not executed the remaining write:
 * - 127 production-eligible events already exist in DB
 * - 1 eligible MERGER (028080 / 20221013000451 / 2026-10-01) is still absent
 *
 * This read-only replay proves:
 * - 128-event target topology is complete
 * - 121 FACTOR_READY events all already have REAL DB UUIDs
 * - 7 STRUCTURAL_BLOCKED events = 6 real DB UUIDs + 1 virtual pending insert
 * - the only missing event is structural, so factor-adjustment lineage does not
 *   depend on performing the write yet
 * - 30 future structural events remain deferred and excluded
 *
 * No synthetic UUID is generated for the missing structural event.
 * No writes.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_8_11_7_REPLAY_VIRTUAL_128_EVENT_READINESS_AND_REAL_UUID_AUDIT';

const FINALIZATION_VERSION =
  'V9_8_10_3_REPLAY_V3_TARGETED_STRUCTURAL_FALSE_SAFE_DATE_CORRECTION';

const PREFLIGHT_VERSION =
  'V9_8_11_4_REPLAY_V2_CORRECTED_PRODUCTION_CANONICAL_EVENT_PREFLIGHT_FROM_V9_8_10_3_REPLAY_V3';

const ELIGIBILITY_VERSION =
  'V9_8_11_5_1_REPLAY_V3_SNAPSHOT_ASOF_PRODUCTION_ELIGIBILITY_GATE';

const PREAPPLY_VERSION =
  'V9_8_11_6_REPLAY_READ_ONLY_SINGLE_INSERT_PRE_APPLY_VERIFICATION';

const PROVIDER = 'DART_KRX_CANONICAL';

const EXPECTED_TARGET_EVENTS = 128;
const EXPECTED_FACTOR_READY = 121;
const EXPECTED_STRUCTURAL = 7;
const EXPECTED_REAL_DB_EVENTS = 127;
const EXPECTED_VIRTUAL_PENDING = 1;
const EXPECTED_DEFERRED = 30;

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
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY_REQUIRED');

  return {
    url: String(url).replace(/\/+$/, ''),
    key: String(key),
  };
}

async function getArray(url, key) {
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
    },
  });

  const text = await res.text();

  let body;
  try {
    body = text ? JSON.parse(text) : [];
  } catch {
    throw new Error(
      `INVALID_SUPABASE_JSON_RESPONSE:${res.status}`,
    );
  }

  if (!res.ok) {
    const e = new Error(
      `SUPABASE_READ_FAILED:${body?.code ?? res.status}`,
    );
    e.details = body;
    throw e;
  }

  if (!Array.isArray(body)) {
    throw new Error('EXPECTED_ARRAY_RESPONSE');
  }

  return body;
}

async function readProductionNamespace(base, key) {
  const select = [
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
  ].join(',');

  return getArray(
    `${base}/rest/v1/corporate_action_events` +
      `?select=${encodeURIComponent(select)}` +
      `&provider=eq.${encodeURIComponent(PROVIDER)}` +
      `&is_validation=eq.false` +
      `&order=stock_code.asc,effective_date.asc,provider_event_id.asc`,
    key,
  );
}

function countBy(rows, fn) {
  const out = {};
  for (const row of rows) {
    const k = String(fn(row) ?? 'NULL');
    out[k] = (out[k] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(out).sort(([a], [b]) => a.localeCompare(b)),
  );
}

async function main() {
  const root = path.resolve(__dirname, '..');

  const finalizationFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-structural-date-finalization-v9-8-10-3-replay-v3.json',
  );

  const preflightFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-production-event-preflight-v9-8-11-4-replay-v2.json',
  );

  const eligibilityFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-snapshot-eligibility-v9-8-11-5-1-replay-v3.json',
  );

  const preapplyFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-pre-apply-read-only-v9-8-11-6-replay.json',
  );

  const outputFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-128-event-readiness-v9-8-11-7-replay.json',
  );

  for (const file of [
    finalizationFile,
    preflightFile,
    eligibilityFile,
    preapplyFile,
  ]) {
    assert(
      fs.existsSync(file),
      `INPUT_NOT_FOUND:${path.basename(file)}`,
    );
  }

  const finalization = readJson(finalizationFile);
  const preflight = readJson(preflightFile);
  const eligibility = readJson(eligibilityFile);
  const preapply = readJson(preapplyFile);

  assert(
    finalization.version === FINALIZATION_VERSION,
    `FINALIZATION_VERSION_MISMATCH:${finalization.version}`,
  );

  assert(
    preflight.version === PREFLIGHT_VERSION,
    `PREFLIGHT_VERSION_MISMATCH:${preflight.version}`,
  );

  assert(
    eligibility.version === ELIGIBILITY_VERSION,
    `ELIGIBILITY_VERSION_MISMATCH:${eligibility.version}`,
  );

  assert(
    preapply.version === PREAPPLY_VERSION,
    `PREAPPLY_VERSION_MISMATCH:${preapply.version}`,
  );

  assert(
    preflight.status ===
      'CORRECTED_PRODUCTION_EVENT_PREFLIGHT_READY',
    `PREFLIGHT_NOT_READY:${preflight.status}`,
  );

  assert(
    eligibility.status ===
      'SNAPSHOT_ASOF_ELIGIBILITY_GATE_READY',
    `ELIGIBILITY_NOT_READY:${eligibility.status}`,
  );

  assert(
    preapply.status ===
      'SINGLE_INSERT_PRE_APPLY_READ_ONLY_READY',
    `PREAPPLY_NOT_READY:${preapply.status}`,
  );

  assert(
    Array.isArray(finalization.results) &&
      finalization.results.length === 159,
    'FINALIZATION_RESULTS_COUNT_MISMATCH',
  );

  assert(
    Array.isArray(preflight.alreadyCompatible) &&
      preflight.alreadyCompatible.length === 127,
    'COMPATIBLE_COUNT_MISMATCH',
  );

  assert(
    Array.isArray(eligibility.eligibleInsertPayload) &&
      eligibility.eligibleInsertPayload.length === 1,
    'ELIGIBLE_INSERT_COUNT_MISMATCH',
  );

  assert(
    Array.isArray(eligibility.deferredFutureStructuralRows) &&
      eligibility.deferredFutureStructuralRows.length ===
        EXPECTED_DEFERRED,
    'DEFERRED_COUNT_MISMATCH',
  );

  const eligibleMissing = eligibility.eligibleInsertPayload[0];

  assert(
    String(eligibleMissing.provider_event_id) ===
      '20221013000451',
    'MISSING_TARGET_ID_CHANGED',
  );

  const targetIds = new Set([
    ...preflight.alreadyCompatible.map((row) =>
      String(row.providerEventId),
    ),
    String(eligibleMissing.provider_event_id),
  ]);

  assert(
    targetIds.size === EXPECTED_TARGET_EVENTS,
    `TARGET_ID_COUNT_MISMATCH:${targetIds.size}`,
  );

  const sourceById = new Map(
    finalization.results.map((row) => [
      String(row.providerEventId),
      row,
    ]),
  );

  const targetSourceRows = [...targetIds].map((id) => {
    const row = sourceById.get(id);
    assert(row, `TARGET_SOURCE_ROW_MISSING:${id}`);
    return row;
  });

  const factorReady = targetSourceRows.filter(
    (row) =>
      row.factorValidation?.status === 'FACTOR_READY',
  );

  const structural = targetSourceRows.filter(
    (row) =>
      row.factorValidation?.status === 'STRUCTURAL_BLOCKED',
  );

  const otherDisposition = targetSourceRows.filter(
    (row) =>
      !['FACTOR_READY', 'STRUCTURAL_BLOCKED'].includes(
        row.factorValidation?.status,
      ),
  );

  assert(
    factorReady.length === EXPECTED_FACTOR_READY,
    `FACTOR_READY_COUNT_MISMATCH:${factorReady.length}`,
  );

  assert(
    structural.length === EXPECTED_STRUCTURAL,
    `STRUCTURAL_COUNT_MISMATCH:${structural.length}`,
  );

  assert(
    otherDisposition.length === 0,
    `OTHER_DISPOSITION_ROWS:${otherDisposition.length}`,
  );

  const {
    url,
    key,
  } = requireEnv();

  const productionRows =
    await readProductionNamespace(url, key);

  const dbById = new Map();

  for (const row of productionRows) {
    const id = String(row.provider_event_id ?? '');
    if (!dbById.has(id)) dbById.set(id, []);
    dbById.get(id).push(row);
  }

  const eventMap = [];
  const realFactorReady = [];
  const missingFactorReady = [];
  const realStructural = [];
  const missingStructural = [];
  const canonicalMismatchRows = [];

  for (const source of targetSourceRows) {
    const providerEventId = String(source.providerEventId);
    const dbRows = dbById.get(providerEventId) ?? [];
    const disposition = source.factorValidation?.status;

    if (dbRows.length > 1) {
      canonicalMismatchRows.push({
        providerEventId,
        reason: 'DUPLICATE_DB_PROVIDER_EVENT_ID',
        rowCount: dbRows.length,
      });
      continue;
    }

    if (dbRows.length === 1) {
      const db = dbRows[0];

      const mismatches = [];

      if (String(db.stock_code) !== String(source.stockCode)) {
        mismatches.push('STOCK_CODE');
      }

      if (db.action_type !== source.actionType) {
        mismatches.push('ACTION_TYPE');
      }

      if (
        db.effective_date !==
        source.canonicalPreview?.effective_date
      ) {
        mismatches.push('EFFECTIVE_DATE');
      }

      if (db.is_validation !== false) {
        mismatches.push('IS_VALIDATION');
      }

      if (db.production_applied !== false) {
        mismatches.push('PRODUCTION_APPLIED');
      }

      if (
        db.metadata?.canonical_validation_status !==
        'VALIDATED'
      ) {
        mismatches.push(
          'CANONICAL_VALIDATION_STATUS',
        );
      }

      if (mismatches.length > 0) {
        canonicalMismatchRows.push({
          providerEventId,
          eventId: db.id,
          mismatches,
        });
      }

      const mapped = {
        providerEventId,
        eventId: db.id,
        stockCode: db.stock_code,
        actionType: db.action_type,
        effectiveDate: db.effective_date,
        factorDisposition: disposition,
        persistenceStatus: 'REAL_DB_EVENT',
      };

      eventMap.push(mapped);

      if (disposition === 'FACTOR_READY') {
        realFactorReady.push(mapped);
      } else {
        realStructural.push(mapped);
      }
    } else {
      const virtual = {
        providerEventId,
        eventId: null,
        stockCode: source.stockCode,
        actionType: source.actionType,
        effectiveDate:
          source.canonicalPreview?.effective_date ?? null,
        factorDisposition: disposition,
        persistenceStatus:
          'VIRTUAL_PENDING_ELIGIBLE_INSERT',
      };

      eventMap.push(virtual);

      if (disposition === 'FACTOR_READY') {
        missingFactorReady.push(virtual);
      } else {
        missingStructural.push(virtual);
      }
    }
  }

  assert(
    canonicalMismatchRows.length === 0,
    `CANONICAL_DB_MISMATCH_ROWS:${canonicalMismatchRows.length}`,
  );

  assert(
    realFactorReady.length === EXPECTED_FACTOR_READY,
    `REAL_FACTOR_READY_UUID_COUNT_MISMATCH:${realFactorReady.length}`,
  );

  assert(
    missingFactorReady.length === 0,
    `MISSING_FACTOR_READY_EVENTS:${missingFactorReady.length}`,
  );

  assert(
    realStructural.length ===
      EXPECTED_STRUCTURAL - EXPECTED_VIRTUAL_PENDING,
    `REAL_STRUCTURAL_COUNT_MISMATCH:${realStructural.length}`,
  );

  assert(
    missingStructural.length === EXPECTED_VIRTUAL_PENDING,
    `MISSING_STRUCTURAL_COUNT_MISMATCH:${missingStructural.length}`,
  );

  assert(
    missingStructural[0].providerEventId ===
      '20221013000451',
    `UNEXPECTED_MISSING_STRUCTURAL:${missingStructural[0]?.providerEventId}`,
  );

  assert(
    eventMap.length === EXPECTED_TARGET_EVENTS,
    `EVENT_MAP_COUNT_MISMATCH:${eventMap.length}`,
  );

  const realDbEvents = eventMap.filter(
    (row) => row.eventId !== null,
  );

  assert(
    realDbEvents.length === EXPECTED_REAL_DB_EVENTS,
    `REAL_DB_EVENT_COUNT_MISMATCH:${realDbEvents.length}`,
  );

  const uniqueRealUuids = new Set(
    realDbEvents.map((row) => row.eventId),
  );

  assert(
    uniqueRealUuids.size === realDbEvents.length,
    `DUPLICATE_REAL_UUIDS:${realDbEvents.length - uniqueRealUuids.size}`,
  );

  const deferredIds = new Set(
    eligibility.deferredFutureStructuralRows.map((row) =>
      String(row.providerEventId),
    ),
  );

  const targetDeferredOverlap = [...targetIds].filter((id) =>
    deferredIds.has(id),
  );

  assert(
    targetDeferredOverlap.length === 0,
    `TARGET_DEFERRED_OVERLAP:${targetDeferredOverlap.length}`,
  );

  const status =
    'VIRTUAL_128_EVENT_READINESS_PROVEN_FACTOR_PIPELINE_UNBLOCKED';

  const report = {
    status,
    version: VERSION,

    source: {
      finalizationVersion: finalization.version,
      finalizationFingerprint:
        finalization.outputFingerprint ?? null,

      preflightVersion: preflight.version,
      preflightFingerprint:
        preflight.outputFingerprint ?? null,

      eligibilityVersion: eligibility.version,
      eligibilityFingerprint:
        eligibility.outputFingerprint ?? null,

      preapplyVersion: preapply.version,
      preapplyFingerprint:
        preapply.outputFingerprint ?? null,
    },

    counts: {
      targetEvents: eventMap.length,
      realDbEvents: realDbEvents.length,
      virtualPendingEvents: missingStructural.length,
      factorReadyEvents: factorReady.length,
      factorReadyRealDbEvents: realFactorReady.length,
      factorReadyMissingEvents: missingFactorReady.length,
      structuralEvents: structural.length,
      structuralRealDbEvents: realStructural.length,
      structuralVirtualPendingEvents:
        missingStructural.length,
      deferredFutureStructuralRows:
        eligibility.deferredFutureStructuralRows.length,
      canonicalMismatchRows:
        canonicalMismatchRows.length,
      uniqueRealEventUuids:
        uniqueRealUuids.size,
    },

    actionTypeCounts:
      countBy(eventMap, (row) => row.actionType),

    factorDispositionCounts:
      countBy(eventMap, (row) => row.factorDisposition),

    persistenceStatusCounts:
      countBy(eventMap, (row) => row.persistenceStatus),

    virtualPendingEvent:
      missingStructural[0],

    factorPipelineReadiness: {
      allFactorReadyEventsHaveRealDbUuid: true,
      factorReadyEventCount: EXPECTED_FACTOR_READY,
      missingFactorReadyEvents: 0,
      structuralMissingEventBlocksFactorPipeline: false,
      canContinueReadOnlyFactorAdjustmentReplay: true,
    },

    eventMap,

    deferredProviderEventIds:
      [...deferredIds].sort(),

    canonicalMismatchRows,

    safety: {
      httpMethodsUsed: ['GET'],
      networkRequests: 1,
      databaseReads: 1,
      databaseWrites: 0,
      postRequests: 0,
      patchRequests: 0,
      deleteRequests: 0,
      syntheticUuidsGenerated: 0,
      productionApplied: false,
      canonicalEventsInserted: 0,
    },

    nextGate:
      'CONTINUE_READ_ONLY_FACTOR_ADJUSTMENT_REPLAY_WITH_121_REAL_EVENT_UUIDS',

    outputFile:
      'logs/opendart-corporate-action-128-event-readiness-v9-8-11-7-replay.json',
  };

  report.outputFingerprint = sha256(
    JSON.stringify({
      version: report.version,
      source: report.source,
      eventMap: eventMap.map((row) => [
        row.providerEventId,
        row.eventId,
        row.stockCode,
        row.actionType,
        row.effectiveDate,
        row.factorDisposition,
        row.persistenceStatus,
      ]),
      deferred:
        report.deferredProviderEventIds,
    }),
  );

  atomicSaveJson(outputFile, report);

  console.log(
    JSON.stringify(
      {
        status: report.status,
        version: report.version,
        targetEvents: report.counts.targetEvents,
        realDbEvents: report.counts.realDbEvents,
        virtualPendingEvents:
          report.counts.virtualPendingEvents,
        factorReadyEvents:
          report.counts.factorReadyEvents,
        factorReadyRealDbEvents:
          report.counts.factorReadyRealDbEvents,
        factorReadyMissingEvents:
          report.counts.factorReadyMissingEvents,
        structuralEvents:
          report.counts.structuralEvents,
        structuralRealDbEvents:
          report.counts.structuralRealDbEvents,
        structuralVirtualPendingEvents:
          report.counts.structuralVirtualPendingEvents,
        deferredFutureStructuralRows:
          report.counts.deferredFutureStructuralRows,
        canonicalMismatchRows:
          report.counts.canonicalMismatchRows,
        virtualPendingEvent:
          report.virtualPendingEvent,
        factorPipelineReadiness:
          report.factorPipelineReadiness,
        databaseWrites: 0,
        productionApplied: false,
        nextGate: report.nextGate,
        outputFile: report.outputFile,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status:
          'VIRTUAL_128_EVENT_READINESS_FAILED',
        version: VERSION,
        error:
          String(error?.message ?? error),
        details:
          error?.details ?? null,
        databaseWrites: 0,
        productionApplied: false,
      },
      null,
      2,
    ),
  );

  process.exitCode = 2;
});
