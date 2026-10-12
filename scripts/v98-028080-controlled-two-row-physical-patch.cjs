#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * 028080 CONTROLLED TWO-ROW PHYSICAL PATCH
 *
 * DEFAULT MODE: PREPARE ONLY (READ-ONLY)
 * APPLY MODE:   add --apply
 *
 * Safety model:
 * - Requires green global replay V2.
 * - Requires green LIVE precondition V2.
 * - Re-reads LIVE DB immediately before planning/apply.
 * - Exact stale-state contract must still hold.
 * - No INSERT.
 * - No DELETE.
 * - No factor mutation.
 * - Preserves event UUID and run UUID.
 * - CAS filters include current stale values.
 * - PATCH order: run summary first, canonical event second.
 * - If event PATCH fails after run PATCH succeeds, attempts compensating
 *   rollback of the run summary back to its exact stale value.
 * - Post-verifies event/run/factor state.
 *
 * IMPORTANT:
 * PostgREST requests are separate HTTP transactions. This script therefore
 * uses compare-and-swap guards + compensating rollback, not a single SQL
 * transaction.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_8_028080_CONTROLLED_TWO_ROW_UUID_PRESERVING_PHYSICAL_PATCH_V1';

const GLOBAL_STATUS =
  'GLOBAL_REPLAY_CONSISTENCY_PROVEN_PHYSICAL_028080_PATCH_READY_NOT_APPLIED_AFTER_AUDIT_METHOD_FIX';

const LIVE_STATUS =
  'LIVE_PRECONDITION_EXACT_STALE_STATE_READY_FOR_CONTROLLED_PATCH';

const TARGET = Object.freeze({
  stockCode: '028080',
  actionType: 'MERGER',
  effectiveDate: '2026-10-01',

  eventUuid:
    '16d168c5-069a-44c2-bf5a-e5c57dcb5446',

  runUuid:
    'e295cb01-db1f-4a8e-b109-0a464b7869fa',

  oldProviderEventId:
    '20260630001117',

  desiredProviderEventId:
    '20221013000451',

  sourceReceiptNo:
    '20260811000452',

  desiredSourceFingerprint:
    '3e3679a37260de07c69997b00e358936888aa3d68fa564b4e9a4834ec537d793',
});

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

  if (!url) throw new Error('SUPABASE_URL_REQUIRED');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY_REQUIRED');

  return {
    url: String(url).replace(/\/+$/, ''),
    key: String(key),
  };
}

function enc(value) {
  return encodeURIComponent(String(value));
}

function eq(column, value) {
  return `${column}=eq.${enc(value)}`;
}

function jsonEq(column, value) {
  return `${column}=eq.${enc(JSON.stringify(value))}`;
}

async function requestArray({
  base,
  key,
  method,
  table,
  query,
  body,
}) {
  const url =
    `${base}/rest/v1/${table}?${query}`;

  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Accept: 'application/json',
  };

  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    headers.Prefer = 'return=representation';
  }

  const res = await fetch(url, {
    method,
    headers,
    body:
      body === undefined
        ? undefined
        : JSON.stringify(body),
  });

  const text = await res.text();

  let parsed;

  try {
    parsed = text ? JSON.parse(text) : [];
  } catch {
    throw new Error(
      `INVALID_SUPABASE_JSON:${method}:${table}:HTTP_${res.status}`,
    );
  }

  if (!res.ok) {
    throw new Error(
      `SUPABASE_${method}_FAILED:${table}:${parsed?.code ?? `HTTP_${res.status}`}:${parsed?.message ?? ''}`,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error(
      `EXPECTED_ARRAY_RESPONSE:${method}:${table}`,
    );
  }

  return parsed;
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

function summaryProviderEventIds(run) {
  const value =
    run?.summary?.provider_event_ids ??
    run?.summary?.providerEventIds ??
    null;

  return Array.isArray(value)
    ? value.map(String)
    : null;
}

function summaryEventIds(run) {
  const value =
    run?.summary?.event_ids ??
    run?.summary?.eventIds ??
    null;

  return Array.isArray(value)
    ? value.map(String)
    : null;
}

function summaryActionTypes(run) {
  const value =
    run?.summary?.action_types ??
    run?.summary?.actionTypes ??
    null;

  return Array.isArray(value)
    ? value.map(String)
    : null;
}

function canonicalValidationStatus(event) {
  return firstNonEmpty(
    event?.metadata?.canonical_validation_status,
    event?.metadata?.canonicalValidationStatus,
  );
}

function buildDesiredMetadata(current) {
  const metadata =
    current && typeof current === 'object' && !Array.isArray(current)
      ? { ...current }
      : {};

  metadata.canonical_validation_status = 'VALIDATED';
  metadata.source_receipt_no = TARGET.sourceReceiptNo;
  metadata.source_kind = 'DOCUMENT_XML_ZIP';
  metadata.factor_status = 'STRUCTURAL_BLOCKED';
  metadata.structural_factor_blocked = true;

  return metadata;
}

function buildDesiredRunSummary(current) {
  assert(
    current &&
      typeof current === 'object' &&
      !Array.isArray(current),
    'RUN_SUMMARY_OBJECT_REQUIRED',
  );

  const summary = { ...current };

  if (Array.isArray(summary.provider_event_ids)) {
    assert(
      summary.provider_event_ids.length === 1 &&
        String(summary.provider_event_ids[0]) ===
          TARGET.oldProviderEventId,
      'RUN_SUMMARY_PROVIDER_EVENT_IDS_NOT_EXACT_STALE',
    );

    summary.provider_event_ids = [
      TARGET.desiredProviderEventId,
    ];

    return summary;
  }

  if (Array.isArray(summary.providerEventIds)) {
    assert(
      summary.providerEventIds.length === 1 &&
        String(summary.providerEventIds[0]) ===
          TARGET.oldProviderEventId,
      'RUN_SUMMARY_PROVIDER_EVENT_IDS_NOT_EXACT_STALE',
    );

    summary.providerEventIds = [
      TARGET.desiredProviderEventId,
    ];

    return summary;
  }

  throw new Error(
    'RUN_SUMMARY_PROVIDER_EVENT_IDS_FIELD_NOT_FOUND',
  );
}

function eventSemanticIssues(event) {
  const issues = [];

  if (!event) return ['EVENT_MISSING'];

  if (event.id !== TARGET.eventUuid)
    issues.push('EVENT_UUID_MISMATCH');

  if (event.stock_code !== TARGET.stockCode)
    issues.push('EVENT_STOCK_MISMATCH');

  if (event.action_type !== TARGET.actionType)
    issues.push('EVENT_ACTION_MISMATCH');

  if (event.effective_date !== TARGET.effectiveDate)
    issues.push('EVENT_EFFECTIVE_DATE_MISMATCH');

  if (event.is_validation !== false)
    issues.push('EVENT_IS_VALIDATION_MUST_BE_FALSE');

  if (event.production_applied !== false)
    issues.push('EVENT_PRODUCTION_APPLIED_MUST_BE_FALSE');

  if (
    canonicalValidationStatus(event) !==
    'VALIDATED'
  ) {
    issues.push(
      'EVENT_CANONICAL_VALIDATION_STATUS_MUST_BE_VALIDATED',
    );
  }

  return issues;
}

function runSemanticIssues(run) {
  const issues = [];

  if (!run) return ['RUN_MISSING'];

  if (run.id !== TARGET.runUuid)
    issues.push('RUN_UUID_MISMATCH');

  if (run.stock_code !== TARGET.stockCode)
    issues.push('RUN_STOCK_MISMATCH');

  if (run.status !== 'BLOCKED_UNSUPPORTED_ACTION')
    issues.push('RUN_STATUS_MISMATCH');

  if (Number(run.event_count) !== 1)
    issues.push('RUN_EVENT_COUNT_MISMATCH');

  if (Number(run.supported_event_count) !== 0)
    issues.push('RUN_SUPPORTED_EVENT_COUNT_MISMATCH');

  if (Number(run.unsupported_event_count) !== 1)
    issues.push('RUN_UNSUPPORTED_EVENT_COUNT_MISMATCH');

  if (Number(run.factor_count) !== 0)
    issues.push('RUN_FACTOR_COUNT_MISMATCH');

  if (run.is_validation !== false)
    issues.push('RUN_IS_VALIDATION_MUST_BE_FALSE');

  if (run.production_applied !== false)
    issues.push('RUN_PRODUCTION_APPLIED_MUST_BE_FALSE');

  const eventIds = summaryEventIds(run);

  if (
    !eventIds ||
    eventIds.length !== 1 ||
    eventIds[0] !== TARGET.eventUuid
  ) {
    issues.push('RUN_SUMMARY_EVENT_IDS_MISMATCH');
  }

  const actionTypes = summaryActionTypes(run);

  if (
    !actionTypes ||
    actionTypes.length !== 1 ||
    actionTypes[0] !== TARGET.actionType
  ) {
    issues.push('RUN_SUMMARY_ACTION_TYPES_MISMATCH');
  }

  const providers =
    summaryProviderEventIds(run);

  if (
    !providers ||
    providers.length !== 1
  ) {
    issues.push('RUN_SUMMARY_PROVIDER_EVENT_IDS_INVALID');
  }

  return issues;
}

function staleLineageExact(event, run, expectedOldFingerprint) {
  return (
    event?.provider_event_id === TARGET.oldProviderEventId &&
    event?.source_fingerprint === expectedOldFingerprint &&
    summaryProviderEventIds(run)?.length === 1 &&
    summaryProviderEventIds(run)[0] === TARGET.oldProviderEventId
  );
}

function desiredLineageExact(event, run) {
  const metadata = event?.metadata ?? {};

  return (
    event?.provider_event_id === TARGET.desiredProviderEventId &&
    event?.source_fingerprint === TARGET.desiredSourceFingerprint &&
    canonicalValidationStatus(event) === 'VALIDATED' &&
    metadata.source_receipt_no === TARGET.sourceReceiptNo &&
    metadata.source_kind === 'DOCUMENT_XML_ZIP' &&
    metadata.factor_status === 'STRUCTURAL_BLOCKED' &&
    metadata.structural_factor_blocked === true &&
    summaryProviderEventIds(run)?.length === 1 &&
    summaryProviderEventIds(run)[0] === TARGET.desiredProviderEventId
  );
}

async function readLive({
  base,
  key,
  eventSelect,
  runSelect,
  factorSelect,
}) {
  let reads = 0;

  async function get(table, query) {
    reads += 1;

    return requestArray({
      base,
      key,
      method: 'GET',
      table,
      query,
    });
  }

  const targetEvents = await get(
    'corporate_action_events',
    [
      `select=${eventSelect}`,
      eq('id', TARGET.eventUuid),
    ].join('&'),
  );

  const targetRuns = await get(
    'corporate_action_adjustment_runs',
    [
      `select=${runSelect}`,
      eq('id', TARGET.runUuid),
    ].join('&'),
  );

  const surfaceEvents = await get(
    'corporate_action_events',
    [
      `select=${eventSelect}`,
      eq('stock_code', TARGET.stockCode),
      eq('action_type', TARGET.actionType),
      eq('effective_date', TARGET.effectiveDate),
      'is_validation=eq.false',
    ].join('&'),
  );

  const desiredEvents = await get(
    'corporate_action_events',
    [
      `select=${eventSelect}`,
      eq('provider_event_id', TARGET.desiredProviderEventId),
      'is_validation=eq.false',
    ].join('&'),
  );

  const stockRuns = await get(
    'corporate_action_adjustment_runs',
    [
      `select=${runSelect}`,
      eq('stock_code', TARGET.stockCode),
      'is_validation=eq.false',
    ].join('&'),
  );

  const eventFactors = await get(
    'corporate_action_adjustment_factors',
    [
      `select=${factorSelect}`,
      eq('action_event_id', TARGET.eventUuid),
      'is_validation=eq.false',
    ].join('&'),
  );

  const runFactors = await get(
    'corporate_action_adjustment_factors',
    [
      `select=${factorSelect}`,
      eq('adjustment_run_id', TARGET.runUuid),
      'is_validation=eq.false',
    ].join('&'),
  );

  return {
    reads,

    targetEvents,
    targetRuns,
    surfaceEvents,
    desiredEvents,
    stockRuns,
    eventFactors,
    runFactors,
  };
}

function evaluateLive(live, expectedOldFingerprint) {
  const issues = [];

  if (live.targetEvents.length !== 1) {
    issues.push({
      check: 'targetEventRows',
      actual: live.targetEvents.length,
      expected: 1,
    });
  }

  if (live.targetRuns.length !== 1) {
    issues.push({
      check: 'targetRunRows',
      actual: live.targetRuns.length,
      expected: 1,
    });
  }

  const event = live.targetEvents[0] ?? null;
  const run = live.targetRuns[0] ?? null;

  const eventIssues = eventSemanticIssues(event);
  const runIssues = runSemanticIssues(run);

  if (eventIssues.length) {
    issues.push({
      check: 'eventSemanticContract',
      issues: eventIssues,
    });
  }

  if (runIssues.length) {
    issues.push({
      check: 'runSemanticContract',
      issues: runIssues,
    });
  }

  const competingSurfaceEvents =
    live.surfaceEvents.filter(
      (row) => row.id !== TARGET.eventUuid,
    );

  if (competingSurfaceEvents.length !== 0) {
    issues.push({
      check: 'competingSurfaceEvents',
      actual: competingSurfaceEvents.length,
      expected: 0,
    });
  }

  const competingDesiredEvents =
    live.desiredEvents.filter(
      (row) => row.id !== TARGET.eventUuid,
    );

  if (competingDesiredEvents.length !== 0) {
    issues.push({
      check: 'competingDesiredEvents',
      actual: competingDesiredEvents.length,
      expected: 0,
    });
  }

  const logicalCompetingRuns =
    live.stockRuns.filter((row) => {
      if (row.id === TARGET.runUuid) return false;

      const eventIds =
        summaryEventIds(row) ?? [];

      const providers =
        summaryProviderEventIds(row) ?? [];

      return (
        eventIds.includes(TARGET.eventUuid) ||
        providers.includes(TARGET.oldProviderEventId) ||
        providers.includes(TARGET.desiredProviderEventId)
      );
    });

  if (logicalCompetingRuns.length !== 0) {
    issues.push({
      check: 'logicalCompetingRuns',
      actual: logicalCompetingRuns.length,
      expected: 0,
    });
  }

  if (live.eventFactors.length !== 0) {
    issues.push({
      check: 'eventFactorRows',
      actual: live.eventFactors.length,
      expected: 0,
    });
  }

  if (live.runFactors.length !== 0) {
    issues.push({
      check: 'runFactorRows',
      actual: live.runFactors.length,
      expected: 0,
    });
  }

  const stale =
    event &&
    run &&
    staleLineageExact(
      event,
      run,
      expectedOldFingerprint,
    );

  const desired =
    event &&
    run &&
    desiredLineageExact(
      event,
      run,
    );

  return {
    event,
    run,
    competingSurfaceEvents,
    competingDesiredEvents,
    logicalCompetingRuns,
    issues,
    stale,
    desired,
  };
}

function buildRunCasQuery(run) {
  return [
    eq('id', TARGET.runUuid),
    eq('stock_code', TARGET.stockCode),
    eq('version', run.version),
    eq('status', 'BLOCKED_UNSUPPORTED_ACTION'),
    eq('event_count', 1),
    eq('supported_event_count', 0),
    eq('unsupported_event_count', 1),
    eq('factor_count', 0),
    'is_validation=eq.false',
    'production_applied=eq.false',
    jsonEq('summary', run.summary),
  ].join('&');
}

function buildEventCasQuery(event, oldFingerprint) {
  return [
    eq('id', TARGET.eventUuid),
    eq('stock_code', TARGET.stockCode),
    eq('action_type', TARGET.actionType),
    eq('effective_date', TARGET.effectiveDate),
    eq('provider_event_id', TARGET.oldProviderEventId),
    eq('source_fingerprint', oldFingerprint),
    eq('status', event.status),
    'is_validation=eq.false',
    'production_applied=eq.false',
    jsonEq('metadata', event.metadata ?? {}),
  ].join('&');
}

function buildRunDesiredCasQuery(run, desiredSummary) {
  return [
    eq('id', TARGET.runUuid),
    eq('stock_code', TARGET.stockCode),
    eq('version', run.version),
    eq('status', 'BLOCKED_UNSUPPORTED_ACTION'),
    eq('event_count', 1),
    eq('supported_event_count', 0),
    eq('unsupported_event_count', 1),
    eq('factor_count', 0),
    'is_validation=eq.false',
    'production_applied=eq.false',
    jsonEq('summary', desiredSummary),
  ].join('&');
}

async function main() {
  const apply =
    process.argv.includes('--apply');

  const root =
    path.resolve(__dirname, '..');

  const logs =
    path.join(root, 'logs');

  const globalFile =
    path.join(
      logs,
      'opendart-corporate-action-global-replay-consistency-before-028080-patch-v2.json',
    );

  const preconditionFile =
    path.join(
      logs,
      'opendart-corporate-action-028080-live-precondition-before-physical-patch-v2.json',
    );

  const outputFile =
    path.join(
      logs,
      apply
        ? 'opendart-corporate-action-028080-controlled-physical-patch-apply.json'
        : 'opendart-corporate-action-028080-controlled-physical-patch-plan.json',
    );

  assert(
    fs.existsSync(globalFile),
    'GLOBAL_REPLAY_V2_REPORT_NOT_FOUND',
  );

  assert(
    fs.existsSync(preconditionFile),
    'LIVE_PRECONDITION_V2_REPORT_NOT_FOUND',
  );

  const global =
    readJson(globalFile);

  const priorPrecondition =
    readJson(preconditionFile);

  assert(
    global.status === GLOBAL_STATUS,
    `GLOBAL_STATUS_NOT_GREEN:${global.status}`,
  );

  assert(
    priorPrecondition.status === LIVE_STATUS,
    `PRIOR_LIVE_PRECONDITION_NOT_READY:${priorPrecondition.status}`,
  );

  assert(
    global.conclusion
      ?.safeToPrepareControlled028080PhysicalPatch === true,
    'GLOBAL_GATE_NOT_READY',
  );

  assert(
    priorPrecondition.conclusion
      ?.safeToGenerateControlledPatchScript === true,
    'LIVE_PRECONDITION_GATE_NOT_READY',
  );

  const expectedOldFingerprint =
    priorPrecondition
      ?.liveState
      ?.targetEvent
      ?.source_fingerprint;

  assert(
    typeof expectedOldFingerprint === 'string' &&
      /^[0-9a-f]{64}$/i.test(expectedOldFingerprint),
    'OLD_SOURCE_FINGERPRINT_NOT_PROVEN',
  );

  assert(
    expectedOldFingerprint !==
      TARGET.desiredSourceFingerprint,
    'OLD_AND_DESIRED_FINGERPRINT_MUST_DIFFER',
  );

  const { url, key } = requireEnv();

  const eventSelect = encodeURIComponent([
    'id',
    'stock_code',
    'action_type',
    'effective_date',
    'ratio_from',
    'ratio_to',
    'cash_amount',
    'currency',
    'provider',
    'provider_event_id',
    'source_fingerprint',
    'status',
    'metadata',
    'is_validation',
    'production_applied',
    'created_at',
  ].join(','));

  const runSelect = encodeURIComponent([
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
  ].join(','));

  const factorSelect = encodeURIComponent([
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
  ].join(','));

  let databaseReads = 0;
  let databaseWrites = 0;

  const live = await readLive({
    base: url,
    key,
    eventSelect,
    runSelect,
    factorSelect,
  });

  databaseReads += live.reads;

  const evaluated =
    evaluateLive(
      live,
      expectedOldFingerprint,
    );

  // Idempotency: if already fully repaired, never write.
  if (
    evaluated.desired &&
    evaluated.issues.length === 0
  ) {
    const report = {
      status:
        'CONTROLLED_PATCH_ALREADY_APPLIED_NO_WRITE_NEEDED',

      version: VERSION,
      mode: apply ? 'APPLY' : 'PREPARE',

      target: TARGET,

      live: {
        lineage: 'DESIRED',
        issues: evaluated.issues,
      },

      conclusion: {
        alreadyRepaired: true,
        databaseWriteRequired: false,
        databaseWriteExecutedNow: false,
      },

      safety: {
        databaseReadsNow: databaseReads,
        databaseWritesNow: 0,
      },

      nextGate:
        'POST_REPAIR_VERIFICATION_ONLY',

      outputFile:
        path.relative(root, outputFile)
          .replaceAll('\\', '/'),
    };

    report.outputFingerprint =
      sha256(JSON.stringify(report));

    atomicSaveJson(
      outputFile,
      report,
    );

    console.log(
      JSON.stringify(report, null, 2),
    );

    return;
  }

  assert(
    evaluated.issues.length === 0,
    `LIVE_PRE_APPLY_DRIFT:${JSON.stringify(evaluated.issues)}`,
  );

  assert(
    evaluated.stale === true,
    'LIVE_STATE_NOT_EXACT_STALE',
  );

  const event =
    evaluated.event;

  const run =
    evaluated.run;

  const desiredMetadata =
    buildDesiredMetadata(
      event.metadata,
    );

  const desiredRunSummary =
    buildDesiredRunSummary(
      run.summary,
    );

  const eventPayload = {
    provider_event_id:
      TARGET.desiredProviderEventId,

    source_fingerprint:
      TARGET.desiredSourceFingerprint,

    metadata:
      desiredMetadata,
  };

  const runPayload = {
    summary:
      desiredRunSummary,
  };

  const plan = {
    event: {
      table:
        'corporate_action_events',

      id:
        TARGET.eventUuid,

      cas: {
        stock_code:
          TARGET.stockCode,

        action_type:
          TARGET.actionType,

        effective_date:
          TARGET.effectiveDate,

        provider_event_id:
          TARGET.oldProviderEventId,

        source_fingerprint:
          expectedOldFingerprint,

        status:
          event.status,

        is_validation:
          false,

        production_applied:
          false,

        metadata:
          event.metadata ?? {},
      },

      patch:
        eventPayload,
    },

    run: {
      table:
        'corporate_action_adjustment_runs',

      id:
        TARGET.runUuid,

      cas: {
        stock_code:
          TARGET.stockCode,

        version:
          run.version,

        status:
          'BLOCKED_UNSUPPORTED_ACTION',

        event_count:
          1,

        supported_event_count:
          0,

        unsupported_event_count:
          1,

        factor_count:
          0,

        is_validation:
          false,

        production_applied:
          false,

        summary:
          run.summary,
      },

      patch:
        runPayload,
    },

    factors: {
      mutation:
        'NONE',

      currentEventRefs:
        live.eventFactors.length,

      currentRunRefs:
        live.runFactors.length,
    },
  };

  if (!apply) {
    const report = {
      status:
        'CONTROLLED_028080_TWO_ROW_PATCH_READY_APPLY_FLAG_REQUIRED',

      version: VERSION,
      mode: 'PREPARE',

      target: TARGET,

      livePreApply: {
        exactStaleState:
          true,

        issues:
          [],

        databaseReads:
          databaseReads,
      },

      plan,

      conclusion: {
        exactTwoRowPatchReady:
          true,

        runPatchRows:
          1,

        eventPatchRows:
          1,

        insertRows:
          0,

        deleteRows:
          0,

        factorMutations:
          0,

        eventUuidPreserved:
          true,

        runUuidPreserved:
          true,

        databaseWriteExecutedNow:
          false,

        applyRequiresExplicitFlag:
          true,
      },

      safety: {
        databaseReadsNow:
          databaseReads,

        databaseWritesNow:
          0,

        productionAppliedFieldChanged:
          false,
      },

      nextGate:
        'EXPLICITLY_RUN_SAME_SCRIPT_WITH_--apply',

      outputFile:
        path.relative(root, outputFile)
          .replaceAll('\\', '/'),
    };

    report.outputFingerprint =
      sha256(JSON.stringify(report));

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

          target:
            report.target,

          livePreApply:
            report.livePreApply,

          plannedChanges: {
            run: {
              id:
                TARGET.runUuid,

              provider_event_ids: {
                from:
                  summaryProviderEventIds(
                    run,
                  ),

                to: [
                  TARGET.desiredProviderEventId,
                ],
              },
            },

            event: {
              id:
                TARGET.eventUuid,

              provider_event_id: {
                from:
                  event.provider_event_id,

                to:
                  TARGET.desiredProviderEventId,
              },

              source_fingerprint: {
                from:
                  event.source_fingerprint,

                to:
                  TARGET.desiredSourceFingerprint,
              },

              metadataMerge: {
                source_receipt_no:
                  TARGET.sourceReceiptNo,

                source_kind:
                  'DOCUMENT_XML_ZIP',

                factor_status:
                  'STRUCTURAL_BLOCKED',

                structural_factor_blocked:
                  true,

                canonical_validation_status:
                  'VALIDATED',
              },
            },

            factorMutations:
              0,
          },

          conclusion:
            report.conclusion,

          databaseReadsNow:
            databaseReads,

          databaseWritesNow:
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

    return;
  }

  // ----------------------------------------------------------------
  // APPLY MODE
  // ----------------------------------------------------------------

  // Run first. This is the less canonical row and can be compensating-rolled
  // back if the event CAS fails.
  const runPatchRows =
    await requestArray({
      base: url,
      key,
      method: 'PATCH',
      table:
        'corporate_action_adjustment_runs',

      query:
        buildRunCasQuery(run),

      body:
        runPayload,
    });

  databaseWrites +=
    runPatchRows.length;

  if (runPatchRows.length !== 1) {
    throw new Error(
      `RUN_CAS_PATCH_EXPECTED_1_ROW_GOT_${runPatchRows.length}`,
    );
  }

  let eventPatchRows;

  try {
    eventPatchRows =
      await requestArray({
        base: url,
        key,
        method: 'PATCH',
        table:
          'corporate_action_events',

        query:
          buildEventCasQuery(
            event,
            expectedOldFingerprint,
          ),

        body:
          eventPayload,
      });

    databaseWrites +=
      eventPatchRows.length;

    if (eventPatchRows.length !== 1) {
      throw new Error(
        `EVENT_CAS_PATCH_EXPECTED_1_ROW_GOT_${eventPatchRows.length}`,
      );
    }
  } catch (eventError) {
    // Best-effort compensating rollback of run.
    let rollbackRows = [];
    let rollbackError = null;

    try {
      rollbackRows =
        await requestArray({
          base: url,
          key,
          method: 'PATCH',
          table:
            'corporate_action_adjustment_runs',

          query:
            buildRunDesiredCasQuery(
              run,
              desiredRunSummary,
            ),

          body: {
            summary:
              run.summary,
          },
        });

      databaseWrites +=
        rollbackRows.length;
    } catch (error) {
      rollbackError =
        String(
          error?.message ??
          error,
        );
    }

    throw new Error(
      [
        'EVENT_PATCH_FAILED_AFTER_RUN_PATCH',
        `eventError=${String(eventError?.message ?? eventError)}`,
        `runRollbackRows=${rollbackRows.length}`,
        `runRollbackError=${rollbackError ?? 'NONE'}`,
      ].join('|'),
    );
  }

  // ----------------------------------------------------------------
  // POST VERIFY
  // ----------------------------------------------------------------

  const after =
    await readLive({
      base: url,
      key,
      eventSelect,
      runSelect,
      factorSelect,
    });

  databaseReads +=
    after.reads;

  const afterEval =
    evaluateLive(
      after,
      expectedOldFingerprint,
    );

  const afterEvent =
    after.targetEvents[0] ?? null;

  const afterRun =
    after.targetRuns[0] ?? null;

  const postIssues = [];

  if (
    !afterEvent ||
    !afterRun ||
    !desiredLineageExact(
      afterEvent,
      afterRun,
    )
  ) {
    postIssues.push(
      'DESIRED_LINEAGE_NOT_EXACT_AFTER_PATCH',
    );
  }

  if (
    afterEval.competingSurfaceEvents.length !==
    0
  ) {
    postIssues.push(
      'COMPETING_SURFACE_EVENT_AFTER_PATCH',
    );
  }

  if (
    afterEval.competingDesiredEvents.length !==
    0
  ) {
    postIssues.push(
      'COMPETING_DESIRED_IDENTITY_AFTER_PATCH',
    );
  }

  if (
    afterEval.logicalCompetingRuns.length !==
    0
  ) {
    postIssues.push(
      'LOGICAL_COMPETING_RUN_AFTER_PATCH',
    );
  }

  if (
    after.eventFactors.length !== 0 ||
    after.runFactors.length !== 0
  ) {
    postIssues.push(
      'FACTOR_REFERENCE_APPEARED_AFTER_PATCH',
    );
  }

  if (
    afterEvent?.id !== TARGET.eventUuid ||
    afterRun?.id !== TARGET.runUuid
  ) {
    postIssues.push(
      'UUID_CHANGED_AFTER_PATCH',
    );
  }

  const success =
    postIssues.length === 0;

  const report = {
    status: success
      ? 'CONTROLLED_028080_TWO_ROW_PHYSICAL_PATCH_APPLIED_AND_VERIFIED'
      : 'CONTROLLED_028080_PATCH_APPLIED_BUT_POST_VERIFY_BLOCKED',

    version: VERSION,
    mode: 'APPLY',

    target: TARGET,

    preApply: {
      exactStaleState:
        true,

      oldSourceFingerprint:
        expectedOldFingerprint,
    },

    applied: {
      runPatchRows:
        runPatchRows.length,

      eventPatchRows:
        eventPatchRows.length,

      insertRows:
        0,

      deleteRows:
        0,

      factorMutations:
        0,

      eventUuidPreserved:
        afterEvent?.id ===
        TARGET.eventUuid,

      runUuidPreserved:
        afterRun?.id ===
        TARGET.runUuid,
    },

    postVerify: {
      desiredLineageExact:
        Boolean(
          afterEvent &&
          afterRun &&
          desiredLineageExact(
            afterEvent,
            afterRun,
          ),
        ),

      providerEventId:
        afterEvent?.provider_event_id ??
        null,

      sourceFingerprint:
        afterEvent?.source_fingerprint ??
        null,

      runProviderEventIds:
        afterRun
          ? summaryProviderEventIds(
              afterRun,
            )
          : null,

      factorRowsReferencingEvent:
        after.eventFactors.length,

      factorRowsReferencingRun:
        after.runFactors.length,

      competingSurfaceEvents:
        afterEval.competingSurfaceEvents.length,

      competingDesiredEvents:
        afterEval.competingDesiredEvents.length,

      logicalCompetingRuns:
        afterEval.logicalCompetingRuns.length,

      issues:
        postIssues,
    },

    conclusion: {
      physical028080PatchApplied:
        true,

      physical028080PatchVerified:
        success,

      exactTwoBusinessRowsChanged:
        runPatchRows.length === 1 &&
        eventPatchRows.length === 1,

      insertPerformed:
        false,

      deletePerformed:
        false,

      factorMutationPerformed:
        false,

      eventUuidPreserved:
        afterEvent?.id ===
        TARGET.eventUuid,

      runUuidPreserved:
        afterRun?.id ===
        TARGET.runUuid,

      safeToAdvanceToFinalPostRepairGlobalVerification:
        success,
    },

    safety: {
      databaseReadsNow:
        databaseReads,

      // Counts rows returned/modified by successful PATCH requests.
      databaseWriteRowsNow:
        databaseWrites,

      patchRequestsNow:
        2,

      insertRequestsNow:
        0,

      deleteRequestsNow:
        0,

      opendartRequestsNow:
        0,

      kisRequestsNow:
        0,

      productionAppliedFlagChanged:
        false,
    },

    nextGate: success
      ? 'FINAL_POST_REPAIR_GLOBAL_VERIFICATION'
      : 'STOP_AND_REVIEW_POST_PATCH_STATE',

    outputFile:
      path.relative(root, outputFile)
        .replaceAll('\\', '/'),
  };

  report.outputFingerprint =
    sha256(JSON.stringify(report));

  atomicSaveJson(
    outputFile,
    report,
  );

  console.log(
    JSON.stringify(report, null, 2),
  );

  if (!success) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status:
          'CONTROLLED_028080_TWO_ROW_PATCH_FAILED',

        version: VERSION,

        mode:
          process.argv.includes('--apply')
            ? 'APPLY'
            : 'PREPARE',

        error:
          String(
            error?.message ??
            error,
          ),

        insertRequestsNow: 0,
        deleteRequestsNow: 0,
        factorMutationIntended: false,
      },
      null,
      2,
    ),
  );

  process.exitCode = 2;
});
