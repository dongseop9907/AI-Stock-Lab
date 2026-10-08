#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * V9.8.11.8.3 replay - 028080 minimal-repair strategy audit
 *
 * READ ONLY.
 *
 * Goal:
 * Decide whether the stale 028080 lineage can be repaired safely IN PLACE,
 * preserving the existing canonical-event UUID and adjustment-run UUID.
 *
 * Required current state:
 * - old canonical event exists:
 *     028080 / 20260630001117 / MERGER / 2026-10-01
 * - repaired canonical event is absent:
 *     028080 / 20221013000451 / MERGER / 2026-10-01
 * - one stale V9.8 production adjustment run refers to old provider_event_id
 * - event is STRUCTURAL_BLOCKED, so it should have NO factor rows
 *
 * We compare:
 * 1) old DB canonical row vs repaired desired payload
 * 2) stale DB run vs repaired desired structural-run contract
 * 3) all factor/FK dependencies
 * 4) desired provider_event_id/source_fingerprint collision state
 *
 * No POST/PATCH/DELETE.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_8_11_8_3_REPLAY_028080_MINIMAL_REPAIR_STRATEGY_AUDIT';

const ELIGIBILITY_VERSION =
  'V9_8_11_5_1_REPLAY_V3_SNAPSHOT_ASOF_PRODUCTION_ELIGIBILITY_GATE';

const DRIFT_VERSION =
  'V9_8_11_8_2_REPLAY_LINEAGE_AND_STOCK_UNIVERSE_DRIFT_AUDIT';

const RUN_VERSION =
  'V9_8_11_PRODUCTION_ADJUSTMENT_V1';

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

  const text = await response.text();

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
      'opendart-corporate-action-028080-minimal-repair-strategy-v9-8-11-8-3-replay.json',
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

  const oldEvents =
    await getArray(
      `${url}/rest/v1/corporate_action_events` +
        `?select=${encodeURIComponent(eventSelect)}` +
        `&provider=eq.${encodeURIComponent('DART_KRX_CANONICAL')}` +
        `&provider_event_id=eq.${encodeURIComponent(OLD_PROVIDER_EVENT_ID)}`,
      key,
    );

  const newEvents =
    await getArray(
      `${url}/rest/v1/corporate_action_events` +
        `?select=${encodeURIComponent(eventSelect)}` +
        `&provider=eq.${encodeURIComponent('DART_KRX_CANONICAL')}` +
        `&provider_event_id=eq.${encodeURIComponent(NEW_PROVIDER_EVENT_ID)}`,
      key,
    );

  assert(
    oldEvents.length === 1,
    `OLD_EVENT_COUNT:${oldEvents.length}`,
  );

  assert(
    newEvents.length === 0,
    `REPAIRED_EVENT_ALREADY_EXISTS:${newEvents.length}`,
  );

  const oldEvent =
    oldEvents[0];

  const oldEventId =
    String(oldEvent.id);

  const desiredFingerprintMatches =
    desired.source_fingerprint
      ? await getArray(
          `${url}/rest/v1/corporate_action_events` +
            `?select=${encodeURIComponent('id,stock_code,provider_event_id,source_fingerprint,is_validation')}` +
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

  // ALL scopes, not only is_validation=false.
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
    desiredFingerprintMatches.length > 0
  ) {
    dependencyBlockers.push(
      'DESIRED_SOURCE_FINGERPRINT_ALREADY_EXISTS',
    );
  }

  if (
    allRuns028080.filter(
      (row) =>
        row.version === RUN_VERSION &&
        row.is_validation === false,
    ).length !== 1
  ) {
    dependencyBlockers.push(
      '028080_PRODUCTION_RUN_CARDINALITY_UNEXPECTED',
    );
  }

  const inPlaceRepairSafe =
    coreEventMismatches.length === 0 &&
    runCoreMismatches.length === 0 &&
    dependencyBlockers.length === 0 &&
    oldProviderIdPresent &&
    provenanceDifferences.length >= 1 &&
    runProvenanceDifferences.length === 1;

  const recommendedRepairMode =
    inPlaceRepairSafe
      ? 'IN_PLACE_PRESERVE_EVENT_AND_RUN_UUIDS'
      : 'BLOCKED_REQUIRES_DEEPER_REPAIR';

  const exactPatchPlan =
    inPlaceRepairSafe
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

  const blockers = [
    ...dependencyBlockers,

    ...(coreEventMismatches.length > 0
      ? ['CANONICAL_BUSINESS_FIELDS_DIFFER']
      : []),

    ...(runCoreMismatches.length > 0
      ? ['RUN_BUSINESS_CONTRACT_DIFFERS']
      : []),
  ];

  const status =
    blockers.length === 0 &&
    inPlaceRepairSafe
      ? 'MINIMAL_IN_PLACE_REPAIR_STRATEGY_PROVEN'
      : 'MINIMAL_REPAIR_STRATEGY_BLOCKED';

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
      oldCanonicalRows:
        oldEvents.length,

      repairedCanonicalRows:
        newEvents.length,

      desiredFingerprintExistingRows:
        desiredFingerprintMatches.length,

      factorRowsReferencingOldEvent:
        factorsByOldEvent.length,

      factorRowsReferencingStaleRun:
        factorsByStaleRun.length,

      allRunsFor028080:
        allRuns028080.length,

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

    currentCanonicalEvent:
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
      desiredFingerprintMatches,
    },

    conclusion: {
      inPlaceRepairSafe,

      recommendedRepairMode,

      preserveCanonicalEventUuid:
        inPlaceRepairSafe,

      preserveAdjustmentRunUuid:
        inPlaceRepairSafe,

      factorChangesRequired:
        inPlaceRepairSafe
          ? 0
          : null,

      insertNewCanonicalEventRequired:
        inPlaceRepairSafe
          ? false
          : null,

      deleteOldCanonicalEventRequired:
        inPlaceRepairSafe
          ? false
          : null,

      insertNewAdjustmentRunRequired:
        inPlaceRepairSafe
          ? false
          : null,

      deleteOldAdjustmentRunRequired:
        inPlaceRepairSafe
          ? false
          : null,
    },

    exactPatchPlan,

    blockers,

    safety: {
      httpMethodsUsed: ['GET'],
      networkRequests:
        desired.source_fingerprint
          ? 7
          : 6,

      databaseReads:
        desired.source_fingerprint
          ? 7
          : 6,

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
        : 'STOP_AND_REVIEW',

    outputFile:
      'logs/opendart-corporate-action-028080-minimal-repair-strategy-v9-8-11-8-3-replay.json',
  };

  report.outputFingerprint =
    sha256(
      JSON.stringify({
        version:
          report.version,

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

        dependencies: {
          factorsByOldEvent:
            factorsByOldEvent.map(
              (row) => row.id,
            ),

          factorsByStaleRun:
            factorsByStaleRun.map(
              (row) => row.id,
            ),

          desiredFingerprintMatches:
            desiredFingerprintMatches.map(
              (row) => row.id,
            ),
        },

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
    status !==
    'MINIMAL_IN_PLACE_REPAIR_STRATEGY_PROVEN'
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
