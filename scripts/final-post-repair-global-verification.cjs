#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * FINAL POST-REPAIR GLOBAL VERIFICATION
 *
 * READ ONLY.
 *
 * Preconditions:
 * - Global replay consistency V2 was proven.
 * - 028080 controlled two-row physical patch was applied and verified.
 *
 * This final audit re-reads the live DB and proves:
 * - target event/run are exactly on desired lineage
 * - UUIDs are preserved
 * - no competing event identity exists
 * - no competing logical run exists
 * - no factor rows reference the structural event/run
 * - no insert/delete/factor mutation was used by the patch artifact
 * - V9.8/V9.9/V9.10 replay closure artifacts remain green
 * - final V9.10 carry-forward remains the same 3 future structural rows
 *
 * No writes.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'FINAL_POST_REPAIR_GLOBAL_VERIFICATION_V9_8_THROUGH_V9_10_AFTER_028080_PHYSICAL_PATCH';

const GLOBAL_STATUS =
  'GLOBAL_REPLAY_CONSISTENCY_PROVEN_PHYSICAL_028080_PATCH_READY_NOT_APPLIED_AFTER_AUDIT_METHOD_FIX';

const APPLY_STATUS =
  'CONTROLLED_028080_TWO_ROW_PHYSICAL_PATCH_APPLIED_AND_VERIFIED';

const V99_STATUS =
  'HISTORICAL_V9_9_11_10_TO_13_COMMON_STOCK_REFRESH_CLOSURE_RESULTS_REUSABLE';

const V910_STATUS =
  'HISTORICAL_V9_10_1_2_2_1_3_COMMON_STOCK_CYCLE_CLOSURE_REUSABLE_AFTER_PRIOR_CARRY_BASELINE_FIX';

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

const EXPECTED_FINAL_CARRY = new Set([
  '20260619000664|469480|MERGER',
  '20260909000291|001570|SPIN_OFF',
  '20261002000418|043910|MERGER',
]);

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

async function getArray(base, key, table, query) {
  const url =
    `${base}/rest/v1/${table}?${query}`;

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
      `INVALID_SUPABASE_JSON:${table}:HTTP_${res.status}`,
    );
  }

  if (!res.ok) {
    throw new Error(
      `SUPABASE_READ_FAILED:${table}:${body?.code ?? `HTTP_${res.status}`}:${body?.message ?? ''}`,
    );
  }

  if (!Array.isArray(body)) {
    throw new Error(
      `EXPECTED_ARRAY_RESPONSE:${table}`,
    );
  }

  return body;
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
    [];

  return Array.isArray(value)
    ? value.map(String)
    : [];
}

function summaryEventIds(run) {
  const value =
    run?.summary?.event_ids ??
    run?.summary?.eventIds ??
    [];

  return Array.isArray(value)
    ? value.map(String)
    : [];
}

function summaryActionTypes(run) {
  const value =
    run?.summary?.action_types ??
    run?.summary?.actionTypes ??
    [];

  return Array.isArray(value)
    ? value.map(String)
    : [];
}

function canonicalValidationStatus(event) {
  return firstNonEmpty(
    event?.metadata?.canonical_validation_status,
    event?.metadata?.canonicalValidationStatus,
  );
}

function sourceReceiptNo(event) {
  return firstNonEmpty(
    event?.metadata?.source_receipt_no,
    event?.metadata?.sourceReceiptNo,
  );
}

function sourceKind(event) {
  return firstNonEmpty(
    event?.metadata?.source_kind,
    event?.metadata?.sourceKind,
  );
}

function factorStatus(event) {
  return firstNonEmpty(
    event?.metadata?.factor_status,
    event?.metadata?.factorStatus,
  );
}

function structuralFactorBlocked(event) {
  const value = firstNonEmpty(
    event?.metadata?.structural_factor_blocked,
    event?.metadata?.structuralFactorBlocked,
  );

  return value === true || value === 'true';
}

function desiredEventIssues(event) {
  const issues = [];

  if (!event) return ['EVENT_MISSING'];

  const expected = {
    id: TARGET.eventUuid,
    stock_code: TARGET.stockCode,
    action_type: TARGET.actionType,
    effective_date: TARGET.effectiveDate,
    provider_event_id: TARGET.desiredProviderEventId,
    source_fingerprint: TARGET.desiredSourceFingerprint,
    is_validation: false,
    production_applied: false,
  };

  for (const [field, value] of Object.entries(expected)) {
    if (event[field] !== value) {
      issues.push(
        `${field}:actual=${JSON.stringify(event[field])}:expected=${JSON.stringify(value)}`,
      );
    }
  }

  if (
    canonicalValidationStatus(event) !==
    'VALIDATED'
  ) {
    issues.push(
      'metadata.canonical_validation_status!=VALIDATED',
    );
  }

  if (
    sourceReceiptNo(event) !==
    TARGET.sourceReceiptNo
  ) {
    issues.push(
      'metadata.source_receipt_no mismatch',
    );
  }

  if (
    sourceKind(event) !==
    'DOCUMENT_XML_ZIP'
  ) {
    issues.push(
      'metadata.source_kind!=DOCUMENT_XML_ZIP',
    );
  }

  if (
    factorStatus(event) !==
    'STRUCTURAL_BLOCKED'
  ) {
    issues.push(
      'metadata.factor_status!=STRUCTURAL_BLOCKED',
    );
  }

  if (
    structuralFactorBlocked(event) !== true
  ) {
    issues.push(
      'metadata.structural_factor_blocked!=true',
    );
  }

  return issues;
}

function desiredRunIssues(run) {
  const issues = [];

  if (!run) return ['RUN_MISSING'];

  const expected = {
    id: TARGET.runUuid,
    stock_code: TARGET.stockCode,
    status: 'BLOCKED_UNSUPPORTED_ACTION',
    event_count: 1,
    supported_event_count: 0,
    unsupported_event_count: 1,
    factor_count: 0,
    is_validation: false,
    production_applied: false,
  };

  for (const [field, value] of Object.entries(expected)) {
    const actual =
      [
        'event_count',
        'supported_event_count',
        'unsupported_event_count',
        'factor_count',
      ].includes(field)
        ? Number(run[field])
        : run[field];

    if (actual !== value) {
      issues.push(
        `${field}:actual=${JSON.stringify(actual)}:expected=${JSON.stringify(value)}`,
      );
    }
  }

  const providers =
    summaryProviderEventIds(run);

  if (
    providers.length !== 1 ||
    providers[0] !== TARGET.desiredProviderEventId
  ) {
    issues.push(
      `summary.provider_event_ids=${JSON.stringify(providers)}`,
    );
  }

  const eventIds =
    summaryEventIds(run);

  if (
    eventIds.length !== 1 ||
    eventIds[0] !== TARGET.eventUuid
  ) {
    issues.push(
      `summary.event_ids=${JSON.stringify(eventIds)}`,
    );
  }

  const actionTypes =
    summaryActionTypes(run);

  if (
    actionTypes.length !== 1 ||
    actionTypes[0] !== TARGET.actionType
  ) {
    issues.push(
      `summary.action_types=${JSON.stringify(actionTypes)}`,
    );
  }

  return issues;
}

function sameSet(a, b) {
  return (
    a.size === b.size &&
    [...a].every((x) => b.has(x))
  );
}

function mainArtifactChecks({
  global,
  apply,
  v99,
  v910,
}) {
  const issues = [];

  if (global.status !== GLOBAL_STATUS) {
    issues.push({
      check: 'globalReplay.status',
      actual: global.status,
      expected: GLOBAL_STATUS,
    });
  }

  if (
    global.conclusion
      ?.downstreamReplayGloballyConsistent !==
    true
  ) {
    issues.push({
      check:
        'globalReplay.downstreamReplayGloballyConsistent',
      actual:
        global.conclusion
          ?.downstreamReplayGloballyConsistent ??
        null,
      expected: true,
    });
  }

  if (apply.status !== APPLY_STATUS) {
    issues.push({
      check: 'patchApply.status',
      actual: apply.status,
      expected: APPLY_STATUS,
    });
  }

  if (
    apply.conclusion
      ?.physical028080PatchApplied !== true ||
    apply.conclusion
      ?.physical028080PatchVerified !== true
  ) {
    issues.push({
      check: 'patchApply.conclusion',
      actual: apply.conclusion,
      expected:
        'physical028080PatchApplied=true and physical028080PatchVerified=true',
    });
  }

  if (
    Number(apply.applied?.runPatchRows) !== 1 ||
    Number(apply.applied?.eventPatchRows) !== 1 ||
    Number(apply.applied?.insertRows) !== 0 ||
    Number(apply.applied?.deleteRows) !== 0 ||
    Number(apply.applied?.factorMutations) !== 0
  ) {
    issues.push({
      check: 'patchApply.exactTwoRowContract',
      actual: apply.applied,
    });
  }

  if (v99.status !== V99_STATUS) {
    issues.push({
      check: 'v99Closure.status',
      actual: v99.status,
      expected: V99_STATUS,
    });
  }

  if (v910.status !== V910_STATUS) {
    issues.push({
      check: 'v910Closure.status',
      actual: v910.status,
      expected: V910_STATUS,
    });
  }

  if (
    v910.conclusion
      ?.safeToDeclareHistoricalReplayThroughV9_10_0_3Closed !==
    true
  ) {
    issues.push({
      check:
        'v910Closure.safeToDeclareHistoricalReplayThroughV9_10_0_3Closed',
      actual:
        v910.conclusion
          ?.safeToDeclareHistoricalReplayThroughV9_10_0_3Closed ??
        null,
      expected: true,
    });
  }

  const finalCarry =
    new Set(
      v910.closure103
        ?.carryForwardIdentities ??
      [],
    );

  if (
    !sameSet(
      finalCarry,
      EXPECTED_FINAL_CARRY,
    )
  ) {
    issues.push({
      check: 'v910Closure.finalCarryForward',
      actual: [...finalCarry].sort(),
      expected:
        [...EXPECTED_FINAL_CARRY].sort(),
    });
  }

  return issues;
}

async function main() {
  const root =
    path.resolve(__dirname, '..');

  const logs =
    path.join(root, 'logs');

  const files = {
    global: path.join(
      logs,
      'opendart-corporate-action-global-replay-consistency-before-028080-patch-v2.json',
    ),

    apply: path.join(
      logs,
      'opendart-corporate-action-028080-controlled-physical-patch-apply.json',
    ),

    v99: path.join(
      logs,
      'opendart-corporate-action-refresh-closure-reuse-v9-9-11-10-to-13-common-stock-replay.json',
    ),

    v910: path.join(
      logs,
      'opendart-corporate-action-v9-10-replay-closure-audit-v2.json',
    ),
  };

  const outputFile =
    path.join(
      logs,
      'opendart-corporate-action-final-post-repair-global-verification.json',
    );

  for (const [name, file] of Object.entries(files)) {
    assert(
      fs.existsSync(file),
      `INPUT_NOT_FOUND:${name}:${path.basename(file)}`,
    );
  }

  const docs =
    Object.fromEntries(
      Object.entries(files).map(
        ([name, file]) => [
          name,
          readJson(file),
        ],
      ),
    );

  const issues =
    mainArtifactChecks({
      global: docs.global,
      apply: docs.apply,
      v99: docs.v99,
      v910: docs.v910,
    });

  const { url, key } =
    requireEnv();

  let databaseReads = 0;

  async function read(table, query) {
    databaseReads += 1;

    return getArray(
      url,
      key,
      table,
      query,
    );
  }

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

  const targetEvents = await read(
    'corporate_action_events',
    [
      `select=${eventSelect}`,
      eq('id', TARGET.eventUuid),
    ].join('&'),
  );

  const targetRuns = await read(
    'corporate_action_adjustment_runs',
    [
      `select=${runSelect}`,
      eq('id', TARGET.runUuid),
    ].join('&'),
  );

  const surfaceEvents = await read(
    'corporate_action_events',
    [
      `select=${eventSelect}`,
      eq('stock_code', TARGET.stockCode),
      eq('action_type', TARGET.actionType),
      eq('effective_date', TARGET.effectiveDate),
      'is_validation=eq.false',
    ].join('&'),
  );

  const desiredProviderEvents = await read(
    'corporate_action_events',
    [
      `select=${eventSelect}`,
      eq(
        'provider_event_id',
        TARGET.desiredProviderEventId,
      ),
      'is_validation=eq.false',
    ].join('&'),
  );

  const staleProviderEvents = await read(
    'corporate_action_events',
    [
      `select=${eventSelect}`,
      eq(
        'provider_event_id',
        TARGET.oldProviderEventId,
      ),
      'is_validation=eq.false',
    ].join('&'),
  );

  const stockRuns = await read(
    'corporate_action_adjustment_runs',
    [
      `select=${runSelect}`,
      eq('stock_code', TARGET.stockCode),
      'is_validation=eq.false',
    ].join('&'),
  );

  const eventFactors = await read(
    'corporate_action_adjustment_factors',
    [
      `select=${factorSelect}`,
      eq(
        'action_event_id',
        TARGET.eventUuid,
      ),
      'is_validation=eq.false',
    ].join('&'),
  );

  const runFactors = await read(
    'corporate_action_adjustment_factors',
    [
      `select=${factorSelect}`,
      eq(
        'adjustment_run_id',
        TARGET.runUuid,
      ),
      'is_validation=eq.false',
    ].join('&'),
  );

  if (targetEvents.length !== 1) {
    issues.push({
      check: 'live.targetEventRows',
      actual: targetEvents.length,
      expected: 1,
    });
  }

  if (targetRuns.length !== 1) {
    issues.push({
      check: 'live.targetRunRows',
      actual: targetRuns.length,
      expected: 1,
    });
  }

  const event =
    targetEvents[0] ?? null;

  const run =
    targetRuns[0] ?? null;

  const eventIssues =
    desiredEventIssues(event);

  const runIssues =
    desiredRunIssues(run);

  if (eventIssues.length > 0) {
    issues.push({
      check: 'live.targetEventDesiredContract',
      issues: eventIssues,
    });
  }

  if (runIssues.length > 0) {
    issues.push({
      check: 'live.targetRunDesiredContract',
      issues: runIssues,
    });
  }

  const competingSurfaceEvents =
    surfaceEvents.filter(
      (row) =>
        row.id !== TARGET.eventUuid,
    );

  if (
    competingSurfaceEvents.length !==
    0
  ) {
    issues.push({
      check: 'live.competingSurfaceEvents',
      actual:
        competingSurfaceEvents.length,
      expected: 0,
      ids:
        competingSurfaceEvents.map(
          (x) => x.id,
        ),
    });
  }

  const competingDesiredProviderEvents =
    desiredProviderEvents.filter(
      (row) =>
        row.id !== TARGET.eventUuid,
    );

  if (
    competingDesiredProviderEvents.length !==
    0
  ) {
    issues.push({
      check:
        'live.competingDesiredProviderEvents',
      actual:
        competingDesiredProviderEvents.length,
      expected: 0,
      ids:
        competingDesiredProviderEvents.map(
          (x) => x.id,
        ),
    });
  }

  if (staleProviderEvents.length !== 0) {
    issues.push({
      check:
        'live.staleProviderIdentityStillPresent',
      actual:
        staleProviderEvents.length,
      expected: 0,
      ids:
        staleProviderEvents.map(
          (x) => x.id,
        ),
    });
  }

  const logicalCompetingRuns =
    stockRuns.filter((row) => {
      if (row.id === TARGET.runUuid) {
        return false;
      }

      const providers =
        summaryProviderEventIds(row);

      const eventIds =
        summaryEventIds(row);

      return (
        providers.includes(
          TARGET.oldProviderEventId,
        ) ||
        providers.includes(
          TARGET.desiredProviderEventId,
        ) ||
        eventIds.includes(
          TARGET.eventUuid,
        )
      );
    });

  if (logicalCompetingRuns.length !== 0) {
    issues.push({
      check:
        'live.logicalCompetingRuns',
      actual:
        logicalCompetingRuns.length,
      expected: 0,
      ids:
        logicalCompetingRuns.map(
          (x) => x.id,
        ),
    });
  }

  if (eventFactors.length !== 0) {
    issues.push({
      check:
        'live.factorRowsReferencingEvent',
      actual:
        eventFactors.length,
      expected: 0,
    });
  }

  if (runFactors.length !== 0) {
    issues.push({
      check:
        'live.factorRowsReferencingRun',
      actual:
        runFactors.length,
      expected: 0,
    });
  }

  const repairedLiveState =
    eventIssues.length === 0 &&
    runIssues.length === 0 &&
    targetEvents.length === 1 &&
    targetRuns.length === 1 &&
    competingSurfaceEvents.length === 0 &&
    competingDesiredProviderEvents.length === 0 &&
    staleProviderEvents.length === 0 &&
    logicalCompetingRuns.length === 0 &&
    eventFactors.length === 0 &&
    runFactors.length === 0;

  const success =
    issues.length === 0 &&
    repairedLiveState;

  const report = {
    status: success
      ? 'FINAL_POST_REPAIR_GLOBAL_VERIFICATION_COMPLETE'
      : 'FINAL_POST_REPAIR_GLOBAL_VERIFICATION_BLOCKED',

    version: VERSION,

    replayRange: {
      repairedUpstream:
        'V9.8.4.x',

      replayClosedThrough:
        'V9.10.0.3',

      physicalRepairTarget:
        TARGET.stockCode,
    },

    target: TARGET,

    patchEvidence: {
      applyArtifactStatus:
        docs.apply.status,

      runPatchRows:
        docs.apply.applied
          ?.runPatchRows ??
        null,

      eventPatchRows:
        docs.apply.applied
          ?.eventPatchRows ??
        null,

      insertRows:
        docs.apply.applied
          ?.insertRows ??
        null,

      deleteRows:
        docs.apply.applied
          ?.deleteRows ??
        null,

      factorMutations:
        docs.apply.applied
          ?.factorMutations ??
        null,

      eventUuidPreserved:
        docs.apply.applied
          ?.eventUuidPreserved ??
        null,

      runUuidPreserved:
        docs.apply.applied
          ?.runUuidPreserved ??
        null,
    },

    liveCounts: {
      targetEventRows:
        targetEvents.length,

      targetRunRows:
        targetRuns.length,

      semanticSurfaceEvents:
        surfaceEvents.length,

      desiredProviderEvents:
        desiredProviderEvents.length,

      staleProviderEvents:
        staleProviderEvents.length,

      productionRunsForStock:
        stockRuns.length,

      competingSurfaceEvents:
        competingSurfaceEvents.length,

      competingDesiredProviderEvents:
        competingDesiredProviderEvents.length,

      logicalCompetingRuns:
        logicalCompetingRuns.length,

      factorRowsReferencingEvent:
        eventFactors.length,

      factorRowsReferencingRun:
        runFactors.length,
    },

    liveDesiredState: {
      repairedLiveState,

      event: event
        ? {
            id:
              event.id,

            stock_code:
              event.stock_code,

            action_type:
              event.action_type,

            effective_date:
              event.effective_date,

            provider_event_id:
              event.provider_event_id,

            source_fingerprint:
              event.source_fingerprint,

            canonical_validation_status:
              canonicalValidationStatus(
                event,
              ),

            source_receipt_no:
              sourceReceiptNo(event),

            source_kind:
              sourceKind(event),

            factor_status:
              factorStatus(event),

            structural_factor_blocked:
              structuralFactorBlocked(
                event,
              ),

            is_validation:
              event.is_validation,

            production_applied:
              event.production_applied,
          }
        : null,

      run: run
        ? {
            id:
              run.id,

            stock_code:
              run.stock_code,

            status:
              run.status,

            event_count:
              run.event_count,

            supported_event_count:
              run.supported_event_count,

            unsupported_event_count:
              run.unsupported_event_count,

            factor_count:
              run.factor_count,

            provider_event_ids:
              summaryProviderEventIds(
                run,
              ),

            event_ids:
              summaryEventIds(
                run,
              ),

            action_types:
              summaryActionTypes(
                run,
              ),

            is_validation:
              run.is_validation,

            production_applied:
              run.production_applied,
          }
        : null,
    },

    finalCarryForward: {
      count:
        docs.v910.closure103
          ?.carryForwardIdentityCount ??
        null,

      identities:
        docs.v910.closure103
          ?.carryForwardIdentities ??
        [],
    },

    issues,

    conclusion: {
      historicalReplayV98ThroughV910RemainsValid:
        success,

      physical028080RepairApplied:
        success,

      physical028080RepairVerifiedLive:
        success,

      physicalProductionDatabaseFullyRepairedForKnown028080Lineage:
        success,

      exactTwoBusinessRowsWerePatched:
        success &&
        Number(
          docs.apply.applied
            ?.runPatchRows,
        ) === 1 &&
        Number(
          docs.apply.applied
            ?.eventPatchRows,
        ) === 1,

      noInsertPerformed:
        success &&
        Number(
          docs.apply.applied
            ?.insertRows,
        ) === 0,

      noDeletePerformed:
        success &&
        Number(
          docs.apply.applied
            ?.deleteRows,
        ) === 0,

      noFactorMutationPerformed:
        success &&
        Number(
          docs.apply.applied
            ?.factorMutations,
        ) === 0,

      eventUuidPreserved:
        success &&
        event?.id ===
        TARGET.eventUuid,

      runUuidPreserved:
        success &&
        run?.id ===
        TARGET.runUuid,

      oldProviderIdentityRemovedFromProduction:
        success &&
        staleProviderEvents.length === 0,

      desiredProviderIdentityUnique:
        success &&
        desiredProviderEvents.length === 1,

      finalThreeFutureStructuralCarryForwardPreserved:
        success &&
        sameSet(
          new Set(
            docs.v910.closure103
              ?.carryForwardIdentities ??
            [],
          ),
          EXPECTED_FINAL_CARRY,
        ),

      downstreamReplayAndPhysicalRepairComplete:
        success,

      additionalPhysicalRepairRequiredNow:
        false,

      databaseWriteRequiredNow:
        false,

      opendartRefetchRequiredNow:
        false,

      kisRefetchRequiredNow:
        false,

      readyToCloseRepairIncident:
        success,
    },

    safety: {
      databaseReadsNow:
        databaseReads,

      databaseWritesNow:
        0,

      patchRequestsNow:
        0,

      insertRequestsNow:
        0,

      deleteRequestsNow:
        0,

      opendartRequestsNow:
        0,

      kisRequestsNow:
        0,

      productionAppliedFlagChangedNow:
        false,

      coverageWindowAdvancedNow:
        false,
    },

    nextGate: success
      ? 'REPAIR_INCIDENT_CLOSED_RESUME_NORMAL_INCREMENTAL_PIPELINE'
      : 'STOP_AND_REVIEW',

    outputFile:
      'logs/opendart-corporate-action-final-post-repair-global-verification.json',
  };

  report.outputFingerprint =
    sha256(
      JSON.stringify({
        version:
          report.version,

        replayRange:
          report.replayRange,

        target:
          report.target,

        patchEvidence:
          report.patchEvidence,

        liveCounts:
          report.liveCounts,

        liveDesiredState:
          report.liveDesiredState,

        finalCarryForward:
          report.finalCarryForward,

        issues:
          report.issues,

        conclusion:
          report.conclusion,
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

        patchEvidence:
          report.patchEvidence,

        liveCounts:
          report.liveCounts,

        liveDesiredState:
          report.liveDesiredState,

        finalCarryForward:
          report.finalCarryForward,

        issues:
          report.issues,

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

  if (!success) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status:
          'FINAL_POST_REPAIR_GLOBAL_VERIFICATION_FAILED',

        version: VERSION,

        error:
          String(
            error?.message ??
            error,
          ),

        databaseWritesNow:
          0,

        opendartRequestsNow:
          0,

        kisRequestsNow:
          0,
      },
      null,
      2,
    ),
  );

  process.exitCode = 2;
});
