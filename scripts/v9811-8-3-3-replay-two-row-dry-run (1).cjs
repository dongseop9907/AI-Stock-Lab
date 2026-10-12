#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * V9.8.11.8.3.3
 *
 * Two-row in-place repair DRY-RUN preflight for 028080.
 *
 * READ ONLY.
 *
 * Repair target:
 * 1) corporate_action_events
 *    preserve UUID:
 *      16d168c5-069a-44c2-bf5a-e5c57dcb5446
 *
 *    patch only:
 *      provider_event_id
 *      source_fingerprint
 *      metadata (merge/enrichment)
 *
 * 2) corporate_action_adjustment_runs
 *    preserve UUID:
 *      e295cb01-db1f-4a8e-b109-0a464b7869fa
 *
 *    patch only:
 *      summary.provider_event_ids
 *      summary.event_ids kept on same canonical UUID
 *      summary.action_types kept MERGER
 *
 * No factor changes.
 * No POST/PATCH/DELETE.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_8_11_8_3_3_REPLAY_028080_TWO_ROW_IN_PLACE_REPAIR_DRY_RUN_PREFLIGHT';

const INPUT_VERSION =
  'V9_8_11_8_3_2_REPLAY_028080_METADATA_RECLASSIFICATION_AND_MINIMAL_REPAIR_PROOF';

const PROVIDER =
  'DART_KRX_CANONICAL';

const STOCK_CODE =
  '028080';

const OLD_PROVIDER_EVENT_ID =
  '20260630001117';

const NEW_PROVIDER_EVENT_ID =
  '20221013000451';

const EXPECTED_EVENT_ID =
  '16d168c5-069a-44c2-bf5a-e5c57dcb5446';

const EXPECTED_RUN_ID =
  'e295cb01-db1f-4a8e-b109-0a464b7869fa';

const RUN_VERSION =
  'V9_8_11_PRODUCTION_ADJUSTMENT_V1';

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''),
  );
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

function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(value)
    .digest('hex');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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

function normalizeNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : value;
}

function compareValue(
  mismatches,
  field,
  actual,
  expected,
) {
  if (actual !== expected) {
    mismatches.push({
      field,
      actual:
        actual ?? null,
      expected:
        expected ?? null,
    });
  }
}

function compareNumber(
  mismatches,
  field,
  actual,
  expected,
) {
  const a = normalizeNumber(actual);
  const e = normalizeNumber(expected);

  if (a !== e) {
    mismatches.push({
      field,
      actual: a,
      expected: e,
    });
  }
}

function stableClone(value) {
  return JSON.parse(
    JSON.stringify(value),
  );
}

function mainEventShape(row) {
  return {
    id:
      row.id,

    stock_code:
      row.stock_code,

    action_type:
      row.action_type,

    effective_date:
      row.effective_date,

    ratio_from:
      row.ratio_from ?? null,

    ratio_to:
      row.ratio_to ?? null,

    cash_amount:
      row.cash_amount ?? null,

    currency:
      row.currency ?? null,

    provider:
      row.provider,

    provider_event_id:
      row.provider_event_id,

    source_fingerprint:
      row.source_fingerprint,

    status:
      row.status,

    metadata:
      row.metadata ?? {},

    is_validation:
      row.is_validation,

    production_applied:
      row.production_applied,
  };
}

function mainRunShape(row) {
  return {
    id:
      row.id,

    stock_code:
      row.stock_code,

    version:
      row.version,

    status:
      row.status,

    event_count:
      row.event_count,

    supported_event_count:
      row.supported_event_count,

    unsupported_event_count:
      row.unsupported_event_count,

    factor_count:
      row.factor_count,

    summary:
      row.summary ?? {},

    is_validation:
      row.is_validation,

    production_applied:
      row.production_applied,
  };
}

async function main() {
  const root =
    path.resolve(__dirname, '..');

  const proofFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-028080-minimal-repair-proof-v9-8-11-8-3-2-replay.json',
    );

  const outputFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-028080-two-row-repair-dry-run-v9-8-11-8-3-3-replay.json',
    );

  assert(
    fs.existsSync(proofFile),
    `PROOF_NOT_FOUND:${path.basename(proofFile)}`,
  );

  const proof =
    readJson(proofFile);

  assert(
    proof.version === INPUT_VERSION,
    `INPUT_VERSION_MISMATCH:${proof.version}`,
  );

  assert(
    proof.status ===
      'MINIMAL_IN_PLACE_REPAIR_STRATEGY_PROVEN_AFTER_METADATA_RECLASSIFICATION',
    `INPUT_STATUS_NOT_PROVEN:${proof.status}`,
  );

  assert(
    proof.conclusion
      ?.inPlaceRepairFullyProven === true,
    'IN_PLACE_REPAIR_NOT_FULLY_PROVEN',
  );

  const patchPlan =
    proof.exactPatchPlan;

  assert(
    patchPlan,
    'PATCH_PLAN_MISSING',
  );

  assert(
    String(
      patchPlan.canonicalEvent
        ?.rowId,
    ) === EXPECTED_EVENT_ID,
    `EVENT_ID_CHANGED:${patchPlan.canonicalEvent?.rowId}`,
  );

  assert(
    String(
      patchPlan.adjustmentRun
        ?.rowId,
    ) === EXPECTED_RUN_ID,
    `RUN_ID_CHANGED:${patchPlan.adjustmentRun?.rowId}`,
  );

  const desiredEventPatch =
    patchPlan.canonicalEvent
      .patchFields;

  const desiredRunPatch =
    patchPlan.adjustmentRun
      .patchFields;

  assert(
    desiredEventPatch
      ?.provider_event_id ===
      NEW_PROVIDER_EVENT_ID,
    `DESIRED_EVENT_IDENTITY_CHANGED:${desiredEventPatch?.provider_event_id}`,
  );

  assert(
    desiredRunPatch
      ?.summary
      ?.provider_event_ids
      ?.[0] ===
      NEW_PROVIDER_EVENT_ID,
    'DESIRED_RUN_PROVIDER_ID_CHANGED',
  );

  const {
    url,
    key,
  } = requireEnv();

  const eventSelect =
    [
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
    ].join(',');

  const currentEventRows =
    await getArray(
      `${url}/rest/v1/corporate_action_events` +
        `?select=${encodeURIComponent(eventSelect)}` +
        `&id=eq.${encodeURIComponent(EXPECTED_EVENT_ID)}`,
      key,
    );

  assert(
    currentEventRows.length === 1,
    `CURRENT_EVENT_ROW_COUNT:${currentEventRows.length}`,
  );

  const currentEvent =
    currentEventRows[0];

  const competingNewIdentityRows =
    await getArray(
      `${url}/rest/v1/corporate_action_events` +
        `?select=${encodeURIComponent(
          'id,stock_code,provider_event_id,source_fingerprint,is_validation,production_applied',
        )}` +
        `&provider=eq.${encodeURIComponent(PROVIDER)}` +
        `&provider_event_id=eq.${encodeURIComponent(NEW_PROVIDER_EVENT_ID)}`,
      key,
    );

  const competingFingerprintRows =
    await getArray(
      `${url}/rest/v1/corporate_action_events` +
        `?select=${encodeURIComponent(
          'id,stock_code,provider_event_id,source_fingerprint,is_validation,production_applied',
        )}` +
        `&source_fingerprint=eq.${encodeURIComponent(
          desiredEventPatch.source_fingerprint,
        )}`,
      key,
    );

  const runSelect =
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
    ].join(',');

  const currentRunRows =
    await getArray(
      `${url}/rest/v1/corporate_action_adjustment_runs` +
        `?select=${encodeURIComponent(runSelect)}` +
        `&id=eq.${encodeURIComponent(EXPECTED_RUN_ID)}`,
      key,
    );

  assert(
    currentRunRows.length === 1,
    `CURRENT_RUN_ROW_COUNT:${currentRunRows.length}`,
  );

  const currentRun =
    currentRunRows[0];

  // All-scope factor dependency checks.
  const factorsByEvent =
    await getArray(
      `${url}/rest/v1/corporate_action_adjustment_factors` +
        `?select=${encodeURIComponent(
          'id,adjustment_run_id,action_event_id,stock_code,is_validation,production_applied',
        )}` +
        `&action_event_id=eq.${encodeURIComponent(EXPECTED_EVENT_ID)}`,
      key,
    );

  const factorsByRun =
    await getArray(
      `${url}/rest/v1/corporate_action_adjustment_factors` +
        `?select=${encodeURIComponent(
          'id,adjustment_run_id,action_event_id,stock_code,is_validation,production_applied',
        )}` +
        `&adjustment_run_id=eq.${encodeURIComponent(EXPECTED_RUN_ID)}`,
      key,
    );

  // Recheck pre-state exactly.
  const preStateMismatches = [];

  compareValue(
    preStateMismatches,
    'event.id',
    currentEvent.id,
    EXPECTED_EVENT_ID,
  );

  compareValue(
    preStateMismatches,
    'event.stock_code',
    currentEvent.stock_code,
    STOCK_CODE,
  );

  compareValue(
    preStateMismatches,
    'event.action_type',
    currentEvent.action_type,
    'MERGER',
  );

  compareValue(
    preStateMismatches,
    'event.effective_date',
    currentEvent.effective_date,
    '2026-10-01',
  );

  compareValue(
    preStateMismatches,
    'event.provider',
    currentEvent.provider,
    PROVIDER,
  );

  compareValue(
    preStateMismatches,
    'event.provider_event_id',
    currentEvent.provider_event_id,
    OLD_PROVIDER_EVENT_ID,
  );

  compareValue(
    preStateMismatches,
    'event.is_validation',
    currentEvent.is_validation,
    false,
  );

  compareValue(
    preStateMismatches,
    'event.production_applied',
    currentEvent.production_applied,
    false,
  );

  compareValue(
    preStateMismatches,
    'event.metadata.canonical_validation_status',
    currentEvent.metadata
      ?.canonical_validation_status ?? null,
    'VALIDATED',
  );

  compareValue(
    preStateMismatches,
    'run.id',
    currentRun.id,
    EXPECTED_RUN_ID,
  );

  compareValue(
    preStateMismatches,
    'run.stock_code',
    currentRun.stock_code,
    STOCK_CODE,
  );

  compareValue(
    preStateMismatches,
    'run.version',
    currentRun.version,
    RUN_VERSION,
  );

  compareValue(
    preStateMismatches,
    'run.status',
    currentRun.status,
    'BLOCKED_UNSUPPORTED_ACTION',
  );

  compareNumber(
    preStateMismatches,
    'run.event_count',
    currentRun.event_count,
    1,
  );

  compareNumber(
    preStateMismatches,
    'run.supported_event_count',
    currentRun.supported_event_count,
    0,
  );

  compareNumber(
    preStateMismatches,
    'run.unsupported_event_count',
    currentRun.unsupported_event_count,
    1,
  );

  compareNumber(
    preStateMismatches,
    'run.factor_count',
    currentRun.factor_count,
    0,
  );

  compareValue(
    preStateMismatches,
    'run.is_validation',
    currentRun.is_validation,
    false,
  );

  compareValue(
    preStateMismatches,
    'run.production_applied',
    currentRun.production_applied,
    false,
  );

  const currentRunProviderIds =
    Array.isArray(
      currentRun.summary
        ?.provider_event_ids,
    )
      ? currentRun.summary.provider_event_ids
          .map(String)
      : [];

  if (
    currentRunProviderIds.length !== 1 ||
    currentRunProviderIds[0] !==
      OLD_PROVIDER_EVENT_ID
  ) {
    preStateMismatches.push({
      field:
        'run.summary.provider_event_ids',
      actual:
        currentRunProviderIds,
      expected: [
        OLD_PROVIDER_EVENT_ID,
      ],
    });
  }

  const blockers = [];

  if (preStateMismatches.length > 0) {
    blockers.push(
      'CURRENT_DB_STATE_DRIFTED_FROM_PROVEN_REPAIR_PRESTATE',
    );
  }

  if (
    competingNewIdentityRows.length > 0
  ) {
    blockers.push(
      'REPAIRED_PROVIDER_EVENT_ID_ALREADY_EXISTS',
    );
  }

  if (
    competingFingerprintRows.length > 0
  ) {
    blockers.push(
      'REPAIRED_SOURCE_FINGERPRINT_ALREADY_EXISTS',
    );
  }

  if (factorsByEvent.length > 0) {
    blockers.push(
      'CANONICAL_EVENT_HAS_FACTOR_DEPENDENCIES',
    );
  }

  if (factorsByRun.length > 0) {
    blockers.push(
      'ADJUSTMENT_RUN_HAS_FACTOR_DEPENDENCIES',
    );
  }

  // ---------------------------------------------------------------------
  // Simulate PATCH in memory.
  // ---------------------------------------------------------------------

  const simulatedEvent =
    stableClone(
      mainEventShape(currentEvent),
    );

  simulatedEvent.provider_event_id =
    desiredEventPatch.provider_event_id;

  simulatedEvent.source_fingerprint =
    desiredEventPatch.source_fingerprint;

  simulatedEvent.metadata =
    stableClone(
      desiredEventPatch.metadata,
    );

  const simulatedRun =
    stableClone(
      mainRunShape(currentRun),
    );

  simulatedRun.summary =
    stableClone(
      desiredRunPatch.summary,
    );

  // ---------------------------------------------------------------------
  // Validate simulated post-state.
  // ---------------------------------------------------------------------

  const postStateMismatches = [];

  const expectedUnchangedEvent =
    patchPlan.canonicalEvent
      .expectedUnchangedBusinessFields;

  compareValue(
    postStateMismatches,
    'event.id',
    simulatedEvent.id,
    EXPECTED_EVENT_ID,
  );

  compareValue(
    postStateMismatches,
    'event.stock_code',
    simulatedEvent.stock_code,
    expectedUnchangedEvent.stock_code,
  );

  compareValue(
    postStateMismatches,
    'event.action_type',
    simulatedEvent.action_type,
    expectedUnchangedEvent.action_type,
  );

  compareValue(
    postStateMismatches,
    'event.effective_date',
    simulatedEvent.effective_date,
    expectedUnchangedEvent.effective_date,
  );

  compareNumber(
    postStateMismatches,
    'event.ratio_from',
    simulatedEvent.ratio_from,
    expectedUnchangedEvent.ratio_from,
  );

  compareNumber(
    postStateMismatches,
    'event.ratio_to',
    simulatedEvent.ratio_to,
    expectedUnchangedEvent.ratio_to,
  );

  compareNumber(
    postStateMismatches,
    'event.cash_amount',
    simulatedEvent.cash_amount,
    expectedUnchangedEvent.cash_amount,
  );

  compareValue(
    postStateMismatches,
    'event.currency',
    simulatedEvent.currency,
    expectedUnchangedEvent.currency,
  );

  compareValue(
    postStateMismatches,
    'event.provider',
    simulatedEvent.provider,
    expectedUnchangedEvent.provider,
  );

  compareValue(
    postStateMismatches,
    'event.status',
    simulatedEvent.status,
    expectedUnchangedEvent.status,
  );

  compareValue(
    postStateMismatches,
    'event.is_validation',
    simulatedEvent.is_validation,
    false,
  );

  compareValue(
    postStateMismatches,
    'event.production_applied',
    simulatedEvent.production_applied,
    false,
  );

  compareValue(
    postStateMismatches,
    'event.provider_event_id',
    simulatedEvent.provider_event_id,
    NEW_PROVIDER_EVENT_ID,
  );

  compareValue(
    postStateMismatches,
    'event.source_fingerprint',
    simulatedEvent.source_fingerprint,
    desiredEventPatch.source_fingerprint,
  );

  compareValue(
    postStateMismatches,
    'event.metadata.canonical_validation_status',
    simulatedEvent.metadata
      ?.canonical_validation_status ?? null,
    'VALIDATED',
  );

  compareValue(
    postStateMismatches,
    'event.metadata.factor_status',
    simulatedEvent.metadata
      ?.factor_status ?? null,
    'STRUCTURAL_BLOCKED',
  );

  compareValue(
    postStateMismatches,
    'event.metadata.structural_factor_blocked',
    simulatedEvent.metadata
      ?.structural_factor_blocked ?? null,
    true,
  );

  compareValue(
    postStateMismatches,
    'event.metadata.source_receipt_no',
    simulatedEvent.metadata
      ?.source_receipt_no ?? null,
    '20260811000452',
  );

  const expectedUnchangedRun =
    patchPlan.adjustmentRun
      .expectedUnchangedBusinessFields;

  compareValue(
    postStateMismatches,
    'run.id',
    simulatedRun.id,
    EXPECTED_RUN_ID,
  );

  compareValue(
    postStateMismatches,
    'run.stock_code',
    simulatedRun.stock_code,
    expectedUnchangedRun.stock_code,
  );

  compareValue(
    postStateMismatches,
    'run.version',
    simulatedRun.version,
    expectedUnchangedRun.version,
  );

  compareValue(
    postStateMismatches,
    'run.status',
    simulatedRun.status,
    expectedUnchangedRun.status,
  );

  compareNumber(
    postStateMismatches,
    'run.event_count',
    simulatedRun.event_count,
    expectedUnchangedRun.event_count,
  );

  compareNumber(
    postStateMismatches,
    'run.supported_event_count',
    simulatedRun.supported_event_count,
    expectedUnchangedRun.supported_event_count,
  );

  compareNumber(
    postStateMismatches,
    'run.unsupported_event_count',
    simulatedRun.unsupported_event_count,
    expectedUnchangedRun.unsupported_event_count,
  );

  compareNumber(
    postStateMismatches,
    'run.factor_count',
    simulatedRun.factor_count,
    expectedUnchangedRun.factor_count,
  );

  compareValue(
    postStateMismatches,
    'run.is_validation',
    simulatedRun.is_validation,
    false,
  );

  compareValue(
    postStateMismatches,
    'run.production_applied',
    simulatedRun.production_applied,
    false,
  );

  const simulatedProviderIds =
    Array.isArray(
      simulatedRun.summary
        ?.provider_event_ids,
    )
      ? simulatedRun.summary.provider_event_ids
          .map(String)
      : [];

  const simulatedEventIds =
    Array.isArray(
      simulatedRun.summary
        ?.event_ids,
    )
      ? simulatedRun.summary.event_ids
          .map(String)
      : [];

  const simulatedActionTypes =
    Array.isArray(
      simulatedRun.summary
        ?.action_types,
    )
      ? simulatedRun.summary.action_types
          .map(String)
      : [];

  if (
    simulatedProviderIds.length !== 1 ||
    simulatedProviderIds[0] !==
      NEW_PROVIDER_EVENT_ID
  ) {
    postStateMismatches.push({
      field:
        'run.summary.provider_event_ids',
      actual:
        simulatedProviderIds,
      expected: [
        NEW_PROVIDER_EVENT_ID,
      ],
    });
  }

  if (
    simulatedEventIds.length !== 1 ||
    simulatedEventIds[0] !==
      EXPECTED_EVENT_ID
  ) {
    postStateMismatches.push({
      field:
        'run.summary.event_ids',
      actual:
        simulatedEventIds,
      expected: [
        EXPECTED_EVENT_ID,
      ],
    });
  }

  if (
    simulatedActionTypes.length !== 1 ||
    simulatedActionTypes[0] !==
      'MERGER'
  ) {
    postStateMismatches.push({
      field:
        'run.summary.action_types',
      actual:
        simulatedActionTypes,
      expected: [
        'MERGER',
      ],
    });
  }

  if (postStateMismatches.length > 0) {
    blockers.push(
      'SIMULATED_POST_STATE_CONTRACT_FAILED',
    );
  }

  const status =
    blockers.length === 0
      ? 'TWO_ROW_IN_PLACE_REPAIR_DRY_RUN_READY'
      : 'TWO_ROW_IN_PLACE_REPAIR_DRY_RUN_BLOCKED';

  const report = {
    status,
    version: VERSION,

    source: {
      proofVersion:
        proof.version,

      proofFingerprint:
        proof.outputFingerprint ?? null,
    },

    identities: {
      stockCode:
        STOCK_CODE,

      canonicalEventId:
        EXPECTED_EVENT_ID,

      adjustmentRunId:
        EXPECTED_RUN_ID,

      oldProviderEventId:
        OLD_PROVIDER_EVENT_ID,

      repairedProviderEventId:
        NEW_PROVIDER_EVENT_ID,
    },

    counts: {
      currentEventRows:
        currentEventRows.length,

      currentRunRows:
        currentRunRows.length,

      competingRepairedIdentityRows:
        competingNewIdentityRows.length,

      competingRepairedFingerprintRows:
        competingFingerprintRows.length,

      factorRowsReferencingEvent:
        factorsByEvent.length,

      factorRowsReferencingRun:
        factorsByRun.length,

      preStateMismatchRows:
        preStateMismatches.length,

      postStateMismatchRows:
        postStateMismatches.length,

      plannedPatchRows:
        2,

      plannedInsertRows:
        0,

      plannedDeleteRows:
        0,

      plannedFactorChanges:
        0,

      blockers:
        blockers.length,
    },

    preStateMismatches,
    postStateMismatches,

    dryRunPatchPlan: {
      canonicalEvent: {
        method:
          'PATCH',

        table:
          'corporate_action_events',

        filter: {
          id:
            `eq.${EXPECTED_EVENT_ID}`,
          is_validation:
            'eq.false',
          provider:
            `eq.${PROVIDER}`,
          provider_event_id:
            `eq.${OLD_PROVIDER_EVENT_ID}`,
        },

        payload:
          desiredEventPatch,

        expectedRowsAffected:
          1,
      },

      adjustmentRun: {
        method:
          'PATCH',

        table:
          'corporate_action_adjustment_runs',

        filter: {
          id:
            `eq.${EXPECTED_RUN_ID}`,
          is_validation:
            'eq.false',
          version:
            `eq.${RUN_VERSION}`,
          stock_code:
            `eq.${STOCK_CODE}`,
        },

        payload:
          desiredRunPatch,

        expectedRowsAffected:
          1,
      },

      factors: {
        changesRequired:
          0,
      },
    },

    simulatedPostState: {
      canonicalEvent:
        simulatedEvent,

      adjustmentRun:
        simulatedRun,
    },

    blockers,

    safety: {
      httpMethodsUsed: [
        'GET',
      ],

      networkRequests:
        6,

      databaseReads:
        6,

      databaseWrites:
        0,

      patchRequests:
        0,

      postRequests:
        0,

      deleteRequests:
        0,

      canonicalEventsModified:
        0,

      adjustmentRunsModified:
        0,

      factorsModified:
        0,

      productionApplied:
        false,
    },

    nextGate:
      status ===
      'TWO_ROW_IN_PLACE_REPAIR_DRY_RUN_READY'
        ? 'BUILD_EXPLICIT_TWO_ROW_REPAIR_APPLY_WITH_POST_VERIFY_BUT_DO_NOT_RUN_YET'
        : 'STOP_AND_REVIEW',

    outputFile:
      'logs/opendart-corporate-action-028080-two-row-repair-dry-run-v9-8-11-8-3-3-replay.json',
  };

  report.outputFingerprint =
    sha256(
      JSON.stringify({
        version:
          report.version,

        source:
          report.source,

        identities:
          report.identities,

        counts:
          report.counts,

        dryRunPatchPlan:
          report.dryRunPatchPlan,

        simulatedPostState:
          report.simulatedPostState,
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

        identities:
          report.identities,

        preStateMismatches:
          report.preStateMismatches,

        postStateMismatches:
          report.postStateMismatches,

        dryRunPatchSummary: {
          canonicalEventFields:
            Object.keys(
              desiredEventPatch,
            ),

          adjustmentRunFields:
            Object.keys(
              desiredRunPatch,
            ),

          factorsModified:
            0,
        },

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
    'TWO_ROW_IN_PLACE_REPAIR_DRY_RUN_READY'
  ) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status:
          'TWO_ROW_IN_PLACE_REPAIR_DRY_RUN_FAILED',

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
