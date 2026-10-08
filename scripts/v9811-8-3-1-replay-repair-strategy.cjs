#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * V9.8.11.8.3.1 replay
 * 028080 minimal-repair strategy audit with explicit namespace separation.
 *
 * READ ONLY.
 *
 * Important correction from V9.8.11.8.3:
 * - canonical repair target selection uses ONLY is_validation=false rows.
 * - all-scope rows are still inspected separately for dependency/diagnostic use.
 *
 * No POST/PATCH/DELETE.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_8_11_8_3_1_REPLAY_028080_NAMESPACE_AWARE_MINIMAL_REPAIR_STRATEGY_AUDIT';

const ELIGIBILITY_VERSION =
  'V9_8_11_5_1_REPLAY_V3_SNAPSHOT_ASOF_PRODUCTION_ELIGIBILITY_GATE';

const DRIFT_VERSION =
  'V9_8_11_8_2_REPLAY_LINEAGE_AND_STOCK_UNIVERSE_DRIFT_AUDIT';

const RUN_VERSION =
  'V9_8_11_PRODUCTION_ADJUSTMENT_V1';

const PROVIDER =
  'DART_KRX_CANONICAL';

const OLD_PROVIDER_EVENT_ID =
  '20260630001117';

const NEW_PROVIDER_EVENT_ID =
  '20221013000451';

const STOCK_CODE =
  '028080';

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

function asStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(String);
}

function eventSummary(row) {
  return {
    id: row.id,
    stockCode: row.stock_code,
    actionType: row.action_type,
    effectiveDate: row.effective_date,
    providerEventId: row.provider_event_id,
    sourceFingerprint: row.source_fingerprint,
    isValidation: row.is_validation,
    productionApplied: row.production_applied,
    validationStatus:
      row.metadata
        ?.canonical_validation_status ?? null,
    sourceReceiptNo:
      row.metadata
        ?.source_receipt_no ?? null,
    factorStatus:
      row.metadata
        ?.factor_status ?? null,
    createdAt:
      row.created_at ?? null,
  };
}

async function main() {
  const root =
    path.resolve(__dirname, '..');

  const eligibilityFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-snapshot-eligibility-v9-8-11-5-1-replay-v3.json',
    );

  const driftFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-lineage-universe-drift-audit-v9-8-11-8-2-replay.json',
    );

  const outputFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-028080-minimal-repair-strategy-v9-8-11-8-3-1-replay.json',
    );

  assert(
    fs.existsSync(eligibilityFile),
    `ELIGIBILITY_NOT_FOUND:${path.basename(eligibilityFile)}`,
  );

  assert(
    fs.existsSync(driftFile),
    `DRIFT_AUDIT_NOT_FOUND:${path.basename(driftFile)}`,
  );

  const eligibility =
    readJson(eligibilityFile);

  const drift =
    readJson(driftFile);

  assert(
    eligibility.version ===
      ELIGIBILITY_VERSION,
    `ELIGIBILITY_VERSION_MISMATCH:${eligibility.version}`,
  );

  assert(
    eligibility.status ===
      'SNAPSHOT_ASOF_ELIGIBILITY_GATE_READY',
    `ELIGIBILITY_NOT_READY:${eligibility.status}`,
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
    Array.isArray(
      eligibility.eligibleInsertPayload,
    ) &&
      eligibility.eligibleInsertPayload.length === 1,
    'EXPECTED_ONE_ELIGIBLE_REPAIRED_PAYLOAD',
  );

  const desired =
    eligibility.eligibleInsertPayload[0];

  assert(
    String(desired.provider_event_id) ===
      NEW_PROVIDER_EVENT_ID,
    `DESIRED_PROVIDER_EVENT_ID_MISMATCH:${desired.provider_event_id}`,
  );

  assert(
    String(desired.stock_code) ===
      STOCK_CODE,
    `DESIRED_STOCK_MISMATCH:${desired.stock_code}`,
  );

  assert(
    desired.action_type ===
      'MERGER',
    `DESIRED_ACTION_MISMATCH:${desired.action_type}`,
  );

  assert(
    desired.effective_date ===
      '2026-10-01',
    `DESIRED_EFFECTIVE_DATE_MISMATCH:${desired.effective_date}`,
  );

  const stale =
    drift.staleSameStockRuns?.[0];

  assert(
    stale &&
      stale.staleRunId,
    'STALE_RUN_ID_MISSING',
  );

  const staleRunId =
    String(stale.staleRunId);

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

  const baseEventUrl =
    `${url}/rest/v1/corporate_action_events` +
    `?select=${encodeURIComponent(eventSelect)}` +
    `&provider=eq.${encodeURIComponent(PROVIDER)}`;

  // Production namespace: authoritative repair target.
  const oldProductionEvents =
    await getArray(
      baseEventUrl +
        `&provider_event_id=eq.${encodeURIComponent(OLD_PROVIDER_EVENT_ID)}` +
        `&is_validation=eq.false`,
      key,
    );

  const newProductionEvents =
    await getArray(
      baseEventUrl +
        `&provider_event_id=eq.${encodeURIComponent(NEW_PROVIDER_EVENT_ID)}` +
        `&is_validation=eq.false`,
      key,
    );

  // All scopes: diagnostics only.
  const oldAllScopeEvents =
    await getArray(
      baseEventUrl +
        `&provider_event_id=eq.${encodeURIComponent(OLD_PROVIDER_EVENT_ID)}`,
      key,
    );

  const newAllScopeEvents =
    await getArray(
      baseEventUrl +
        `&provider_event_id=eq.${encodeURIComponent(NEW_PROVIDER_EVENT_ID)}`,
      key,
    );

  assert(
    oldProductionEvents.length === 1,
    `OLD_PRODUCTION_EVENT_COUNT:${oldProductionEvents.length}`,
  );

  assert(
    newProductionEvents.length === 0,
    `REPAIRED_PRODUCTION_EVENT_ALREADY_EXISTS:${newProductionEvents.length}`,
  );

  const oldEvent =
    oldProductionEvents[0];

  const oldEventId =
    String(oldEvent.id);

  // Fingerprint collision audit is split into production and all-scope views.
  const desiredFingerprintProductionMatches =
    desired.source_fingerprint
      ? await getArray(
          `${url}/rest/v1/corporate_action_events` +
            `?select=${encodeURIComponent(
              'id,stock_code,provider_event_id,source_fingerprint,is_validation,production_applied',
            )}` +
            `&source_fingerprint=eq.${encodeURIComponent(desired.source_fingerprint)}` +
            `&is_validation=eq.false`,
          key,
        )
      : [];

  const desiredFingerprintAllScopeMatches =
    desired.source_fingerprint
      ? await getArray(
          `${url}/rest/v1/corporate_action_events` +
            `?select=${encodeURIComponent(
              'id,stock_code,provider_event_id,source_fingerprint,is_validation,production_applied',
            )}` +
            `&source_fingerprint=eq.${encodeURIComponent(desired.source_fingerprint)}`,
          key,
        )
      : [];

  const staleRuns =
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
        `&id=eq.${encodeURIComponent(staleRunId)}`,
      key,
    );

  assert(
    staleRuns.length === 1,
    `STALE_RUN_COUNT:${staleRuns.length}`,
  );

  const staleRun =
    staleRuns[0];

  // Dependencies are audited across ALL scopes.
  const factorsByOldEvent =
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
            'is_validation',
            'production_applied',
          ].join(','),
        )}` +
        `&action_event_id=eq.${encodeURIComponent(oldEventId)}`,
      key,
    );

  const factorsByStaleRun =
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
            'is_validation',
            'production_applied',
          ].join(','),
        )}` +
        `&adjustment_run_id=eq.${encodeURIComponent(staleRunId)}`,
      key,
    );

  const allRuns028080 =
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
          ].join(','),
        )}` +
        `&stock_code=eq.${encodeURIComponent(STOCK_CODE)}`,
      key,
    );

  // -----------------------------------------------------------------------
  // Compare canonical business state.
  // -----------------------------------------------------------------------

  const coreEventMismatches = [];

  compareValue(
    coreEventMismatches,
    'stock_code',
    oldEvent.stock_code,
    desired.stock_code,
  );

  compareValue(
    coreEventMismatches,
    'action_type',
    oldEvent.action_type,
    desired.action_type,
  );

  compareValue(
    coreEventMismatches,
    'effective_date',
    oldEvent.effective_date,
    desired.effective_date,
  );

  compareNumber(
    coreEventMismatches,
    'ratio_from',
    oldEvent.ratio_from,
    desired.ratio_from,
  );

  compareNumber(
    coreEventMismatches,
    'ratio_to',
    oldEvent.ratio_to,
    desired.ratio_to,
  );

  compareNumber(
    coreEventMismatches,
    'cash_amount',
    oldEvent.cash_amount,
    desired.cash_amount,
  );

  compareValue(
    coreEventMismatches,
    'currency',
    oldEvent.currency ?? null,
    desired.currency ?? null,
  );

  compareValue(
    coreEventMismatches,
    'provider',
    oldEvent.provider,
    desired.provider,
  );

  compareValue(
    coreEventMismatches,
    'status',
    oldEvent.status,
    desired.status,
  );

  compareValue(
    coreEventMismatches,
    'is_validation',
    oldEvent.is_validation,
    false,
  );

  compareValue(
    coreEventMismatches,
    'production_applied',
    oldEvent.production_applied,
    false,
  );

  compareValue(
    coreEventMismatches,
    'metadata.canonical_validation_status',
    oldEvent.metadata
      ?.canonical_validation_status ?? null,
    desired.metadata
      ?.canonical_validation_status ?? null,
  );

  compareValue(
    coreEventMismatches,
    'metadata.factor_status',
    oldEvent.metadata
      ?.factor_status ?? null,
    desired.metadata
      ?.factor_status ?? null,
  );

  compareValue(
    coreEventMismatches,
    'metadata.structural_factor_blocked',
    oldEvent.metadata
      ?.structural_factor_blocked ?? null,
    desired.metadata
      ?.structural_factor_blocked ?? null,
  );

  // Provenance-only differences are expected.
  const provenanceDifferences = [];

  compareValue(
    provenanceDifferences,
    'provider_event_id',
    oldEvent.provider_event_id,
    desired.provider_event_id,
  );

  compareValue(
    provenanceDifferences,
    'source_fingerprint',
    oldEvent.source_fingerprint,
    desired.source_fingerprint,
  );

  compareValue(
    provenanceDifferences,
    'metadata.source_receipt_no',
    oldEvent.metadata
      ?.source_receipt_no ?? null,
    desired.metadata
      ?.source_receipt_no ?? null,
  );

  compareValue(
    provenanceDifferences,
    'metadata.source_kind',
    oldEvent.metadata
      ?.source_kind ?? null,
    desired.metadata
      ?.source_kind ?? null,
  );

  // -----------------------------------------------------------------------
  // Compare stale structural run business state.
  // -----------------------------------------------------------------------

  const runCoreMismatches = [];

  compareValue(
    runCoreMismatches,
    'stock_code',
    staleRun.stock_code,
    STOCK_CODE,
  );

  compareValue(
    runCoreMismatches,
    'version',
    staleRun.version,
    RUN_VERSION,
  );

  compareValue(
    runCoreMismatches,
    'status',
    staleRun.status,
    'BLOCKED_UNSUPPORTED_ACTION',
  );

  compareNumber(
    runCoreMismatches,
    'event_count',
    staleRun.event_count,
    1,
  );

  compareNumber(
    runCoreMismatches,
    'supported_event_count',
    staleRun.supported_event_count,
    0,
  );

  compareNumber(
    runCoreMismatches,
    'unsupported_event_count',
    staleRun.unsupported_event_count,
    1,
  );

  compareNumber(
    runCoreMismatches,
    'factor_count',
    staleRun.factor_count,
    0,
  );

  compareValue(
    runCoreMismatches,
    'is_validation',
    staleRun.is_validation,
    false,
  );

  compareValue(
    runCoreMismatches,
    'production_applied',
    staleRun.production_applied,
    false,
  );

  const actualEventIds =
    asStringArray(
      staleRun.summary?.event_ids,
    );

  const actualProviderIds =
    asStringArray(
      staleRun.summary
        ?.provider_event_ids,
    );

  const actualActionTypes =
    asStringArray(
      staleRun.summary
        ?.action_types,
    );

  if (
    !actualEventIds.includes(
      oldEventId,
    )
  ) {
    runCoreMismatches.push({
      field:
        'summary.event_ids',
      actual:
        actualEventIds,
      expectedContains:
        oldEventId,
    });
  }

  if (
    !actualActionTypes.includes(
      'MERGER',
    )
  ) {
    runCoreMismatches.push({
      field:
        'summary.action_types',
      actual:
        actualActionTypes,
      expectedContains:
        'MERGER',
    });
  }

  const runProvenanceDifferences = [];

  if (
    !actualProviderIds.includes(
      NEW_PROVIDER_EVENT_ID,
    )
  ) {
    runProvenanceDifferences.push({
      field:
        'summary.provider_event_ids',
      actual:
        actualProviderIds,
      expectedContains:
        NEW_PROVIDER_EVENT_ID,
    });
  }

  const oldProviderIdPresent =
    actualProviderIds.includes(
      OLD_PROVIDER_EVENT_ID,
    );

  // -----------------------------------------------------------------------
  // Safety classification.
  // -----------------------------------------------------------------------

  const dependencyBlockers = [];

  if (factorsByOldEvent.length > 0) {
    dependencyBlockers.push(
      'OLD_CANONICAL_EVENT_HAS_FACTOR_REFERENCES',
    );
  }

  if (factorsByStaleRun.length > 0) {
    dependencyBlockers.push(
      'STALE_RUN_HAS_FACTOR_CHILDREN',
    );
  }

  if (
    desiredFingerprintProductionMatches.length > 0
  ) {
    dependencyBlockers.push(
      'DESIRED_SOURCE_FINGERPRINT_EXISTS_IN_PRODUCTION',
    );
  }

  const productionRuns028080 =
    allRuns028080.filter(
      (row) =>
        row.version === RUN_VERSION &&
        row.is_validation === false,
    );

  if (
    productionRuns028080.length !== 1
  ) {
    dependencyBlockers.push(
      '028080_PRODUCTION_RUN_CARDINALITY_UNEXPECTED',
    );
  }

  // All-scope same fingerprint does not automatically block this read-only
  // strategy audit, but it is surfaced because DB uniqueness may be global.
  const validationFingerprintMatches =
    desiredFingerprintAllScopeMatches.filter(
      (row) =>
        row.is_validation === true,
    );

  const requiresFingerprintConstraintReview =
    desiredFingerprintProductionMatches.length === 0 &&
    validationFingerprintMatches.length > 0;

  const inPlaceRepairBusinessSafe =
    coreEventMismatches.length === 0 &&
    runCoreMismatches.length === 0 &&
    dependencyBlockers.length === 0 &&
    oldProviderIdPresent &&
    provenanceDifferences.length >= 1 &&
    runProvenanceDifferences.length === 1;

  const inPlaceRepairFullyProven =
    inPlaceRepairBusinessSafe &&
    !requiresFingerprintConstraintReview;

  let recommendedRepairMode;

  if (inPlaceRepairFullyProven) {
    recommendedRepairMode =
      'IN_PLACE_PRESERVE_EVENT_AND_RUN_UUIDS';
  } else if (
    inPlaceRepairBusinessSafe &&
    requiresFingerprintConstraintReview
  ) {
    recommendedRepairMode =
      'BUSINESS_SAFE_BUT_REVIEW_SOURCE_FINGERPRINT_UNIQUE_CONSTRAINT';
  } else {
    recommendedRepairMode =
      'BLOCKED_REQUIRES_DEEPER_REPAIR';
  }

  const blockers = [
    ...dependencyBlockers,

    ...(coreEventMismatches.length > 0
      ? [
          'CANONICAL_BUSINESS_FIELDS_DIFFER',
        ]
      : []),

    ...(runCoreMismatches.length > 0
      ? [
          'RUN_BUSINESS_CONTRACT_DIFFERS',
        ]
      : []),
  ];

  const status =
    blockers.length > 0
      ? 'MINIMAL_REPAIR_STRATEGY_BLOCKED'
      : inPlaceRepairFullyProven
        ? 'MINIMAL_IN_PLACE_REPAIR_STRATEGY_PROVEN'
        : 'MINIMAL_IN_PLACE_REPAIR_BUSINESS_SAFE_CONSTRAINT_REVIEW_REQUIRED';

  const exactPatchPlan =
    inPlaceRepairBusinessSafe
      ? {
          canonicalEvent: {
            table:
              'corporate_action_events',

            rowId:
              oldEventId,

            preserveId:
              true,

            patchFields: {
              provider_event_id:
                desired.provider_event_id,

              source_fingerprint:
                desired.source_fingerprint,

              metadata: {
                ...oldEvent.metadata,
                ...desired.metadata,
              },
            },
          },

          adjustmentRun: {
            table:
              'corporate_action_adjustment_runs',

            rowId:
              staleRunId,

            preserveId:
              true,

            patchSummaryOnly:
              true,

            patchFields: {
              summary: {
                ...staleRun.summary,

                event_ids: [
                  oldEventId,
                ],

                provider_event_ids: [
                  NEW_PROVIDER_EVENT_ID,
                ],

                action_types: [
                  'MERGER',
                ],
              },
            },
          },

          factors: {
            changesRequired:
              0,
          },
        }
      : null;

  const report = {
    status,
    version: VERSION,

    source: {
      eligibilityVersion:
        eligibility.version,

      eligibilityFingerprint:
        eligibility.outputFingerprint ?? null,

      driftAuditVersion:
        drift.version,

      driftAuditFingerprint:
        drift.outputFingerprint ?? null,
    },

    namespaceAudit: {
      oldProviderEventId:
        OLD_PROVIDER_EVENT_ID,

      newProviderEventId:
        NEW_PROVIDER_EVENT_ID,

      oldProductionRows:
        oldProductionEvents.map(
          eventSummary,
        ),

      oldAllScopeRows:
        oldAllScopeEvents.map(
          eventSummary,
        ),

      newProductionRows:
        newProductionEvents.map(
          eventSummary,
        ),

      newAllScopeRows:
        newAllScopeEvents.map(
          eventSummary,
        ),

      desiredFingerprintProductionMatches,
      desiredFingerprintAllScopeMatches,

      validationFingerprintMatches,
    },

    identities: {
      stockCode:
        STOCK_CODE,

      oldProviderEventId:
        OLD_PROVIDER_EVENT_ID,

      repairedProviderEventId:
        NEW_PROVIDER_EVENT_ID,

      canonicalEventIdPreserved:
        oldEventId,

      adjustmentRunIdPreserved:
        staleRunId,
    },

    counts: {
      oldProductionCanonicalRows:
        oldProductionEvents.length,

      oldAllScopeCanonicalRows:
        oldAllScopeEvents.length,

      repairedProductionCanonicalRows:
        newProductionEvents.length,

      repairedAllScopeCanonicalRows:
        newAllScopeEvents.length,

      desiredFingerprintProductionRows:
        desiredFingerprintProductionMatches.length,

      desiredFingerprintAllScopeRows:
        desiredFingerprintAllScopeMatches.length,

      desiredFingerprintValidationRows:
        validationFingerprintMatches.length,

      factorRowsReferencingOldEvent:
        factorsByOldEvent.length,

      factorRowsReferencingStaleRun:
        factorsByStaleRun.length,

      allRunsFor028080:
        allRuns028080.length,

      productionRunsFor028080:
        productionRuns028080.length,

      canonicalBusinessFieldMismatches:
        coreEventMismatches.length,

      canonicalProvenanceDifferences:
        provenanceDifferences.length,

      runBusinessContractMismatches:
        runCoreMismatches.length,

      runProvenanceDifferences:
        runProvenanceDifferences.length,

      blockers:
        blockers.length,
    },

    currentProductionCanonicalEvent:
      oldEvent,

    desiredCanonicalPayload:
      desired,

    canonicalBusinessFieldMismatches:
      coreEventMismatches,

    canonicalProvenanceDifferences:
      provenanceDifferences,

    currentAdjustmentRun:
      staleRun,

    runBusinessContractMismatches:
      runCoreMismatches,

    runProvenanceDifferences,

    dependencies: {
      factorsByOldEvent,
      factorsByStaleRun,
      allRuns028080,
    },

    conclusion: {
      inPlaceRepairBusinessSafe,

      inPlaceRepairFullyProven,

      requiresFingerprintConstraintReview,

      recommendedRepairMode,

      preserveCanonicalEventUuid:
        inPlaceRepairBusinessSafe,

      preserveAdjustmentRunUuid:
        inPlaceRepairBusinessSafe,

      factorChangesRequired:
        inPlaceRepairBusinessSafe
          ? 0
          : null,

      insertNewCanonicalEventRequired:
        inPlaceRepairBusinessSafe
          ? false
          : null,

      deleteOldCanonicalEventRequired:
        inPlaceRepairBusinessSafe
          ? false
          : null,

      insertNewAdjustmentRunRequired:
        inPlaceRepairBusinessSafe
          ? false
          : null,

      deleteOldAdjustmentRunRequired:
        inPlaceRepairBusinessSafe
          ? false
          : null,
    },

    exactPatchPlan,

    blockers,

    safety: {
      httpMethodsUsed: ['GET'],

      networkRequests:
        desired.source_fingerprint
          ? 10
          : 8,

      databaseReads:
        desired.source_fingerprint
          ? 10
          : 8,

      databaseWrites: 0,
      postRequests: 0,
      patchRequests: 0,
      deleteRequests: 0,
      productionApplied: false,
    },

    nextGate:
      status ===
      'MINIMAL_IN_PLACE_REPAIR_STRATEGY_PROVEN'
        ? 'BUILD_DRY_RUN_TWO_ROW_PROVENANCE_REPAIR'
        : status ===
          'MINIMAL_IN_PLACE_REPAIR_BUSINESS_SAFE_CONSTRAINT_REVIEW_REQUIRED'
          ? 'AUDIT_CORPORATE_ACTION_EVENT_UNIQUE_CONSTRAINTS'
          : 'STOP_AND_REVIEW',

    outputFile:
      'logs/opendart-corporate-action-028080-minimal-repair-strategy-v9-8-11-8-3-1-replay.json',
  };

  report.outputFingerprint =
    sha256(
      JSON.stringify({
        version:
          report.version,

        namespaceAudit:
          report.namespaceAudit,

        identities:
          report.identities,

        canonicalBusinessFieldMismatches:
          report.canonicalBusinessFieldMismatches,

        canonicalProvenanceDifferences:
          report.canonicalProvenanceDifferences,

        runBusinessContractMismatches:
          report.runBusinessContractMismatches,

        runProvenanceDifferences:
          report.runProvenanceDifferences,

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

        ...report.counts,

        namespaceSummary: {
          oldProductionRows:
            report.counts
              .oldProductionCanonicalRows,

          oldAllScopeRows:
            report.counts
              .oldAllScopeCanonicalRows,

          repairedProductionRows:
            report.counts
              .repairedProductionCanonicalRows,

          repairedAllScopeRows:
            report.counts
              .repairedAllScopeCanonicalRows,

          desiredFingerprintProductionRows:
            report.counts
              .desiredFingerprintProductionRows,

          desiredFingerprintValidationRows:
            report.counts
              .desiredFingerprintValidationRows,
        },

        identities:
          report.identities,

        canonicalBusinessFieldMismatches:
          report.canonicalBusinessFieldMismatches,

        canonicalProvenanceDifferences:
          report.canonicalProvenanceDifferences,

        runBusinessContractMismatches:
          report.runBusinessContractMismatches,

        runProvenanceDifferences:
          report.runProvenanceDifferences,

        conclusion:
          report.conclusion,

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
    status ===
    'MINIMAL_REPAIR_STRATEGY_BLOCKED'
  ) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status:
          'MINIMAL_REPAIR_STRATEGY_AUDIT_FAILED',

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
