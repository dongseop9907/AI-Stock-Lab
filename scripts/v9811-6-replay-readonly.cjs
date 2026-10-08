#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * V9.8.11.6 replay - READ-ONLY pre-apply verification
 *
 * Historical V9.8.11.6 is a production INSERT stage.
 * This replay intentionally stops BEFORE POST and verifies the exact
 * current DB state implied by repaired lineage.
 *
 * Inputs:
 * - V9.8.11.4 replay v2 preflight
 * - V9.8.11.5.1 replay v3 snapshot eligibility
 *
 * Expected current state:
 * - production namespace rows = 140
 * - current-batch compatible rows = 127
 * - exactly one snapshot-eligible missing row:
 *     providerEventId 20221013000451 / stock 028080 / MERGER / 2026-10-01
 * - 30 future structural rows remain absent
 * - future-pending 478560 row remains absent
 *
 * Safety:
 * - GET only
 * - no POST/PATCH/DELETE
 * - no DB writes
 * - no production mutation
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_8_11_6_REPLAY_READ_ONLY_SINGLE_INSERT_PRE_APPLY_VERIFICATION';

const PREFLIGHT_VERSION =
  'V9_8_11_4_REPLAY_V2_CORRECTED_PRODUCTION_CANONICAL_EVENT_PREFLIGHT_FROM_V9_8_10_3_REPLAY_V3';

const ELIGIBILITY_VERSION =
  'V9_8_11_5_1_REPLAY_V3_SNAPSHOT_ASOF_PRODUCTION_ELIGIBILITY_GATE';

const PROVIDER =
  'DART_KRX_CANONICAL';

const EXPECTED_NAMESPACE_ROWS = 140;
const EXPECTED_COMPATIBLE = 127;
const EXPECTED_ELIGIBLE_MISSING = 1;
const EXPECTED_DEFERRED = 30;
const EXPECTED_FUTURE_PENDING = 1;

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

async function readProductionNamespace(base, key) {
  const select = [
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

  const url =
    `${base}/rest/v1/corporate_action_events` +
    `?select=${encodeURIComponent(select)}` +
    `&provider=eq.${encodeURIComponent(PROVIDER)}` +
    `&is_validation=eq.false` +
    `&order=stock_code.asc,effective_date.asc,provider_event_id.asc`;

  return getArray(url, key);
}

function groupByProviderEventId(rows) {
  const map = new Map();

  for (const row of rows) {
    const id =
      String(row.provider_event_id ?? '');

    if (!map.has(id)) {
      map.set(id, []);
    }

    map.get(id).push(row);
  }

  return map;
}

function sameNullableNumber(a, b) {
  const na =
    a === null || a === undefined || a === ''
      ? null
      : Number(a);

  const nb =
    b === null || b === undefined || b === ''
      ? null
      : Number(b);

  if (na === null || nb === null) {
    return na === nb;
  }

  return (
    Number.isFinite(na) &&
    Number.isFinite(nb) &&
    na === nb
  );
}

function compareEligibleDesired(actual, desired) {
  const mismatches = [];

  function check(field, a, b) {
    if (a !== b) {
      mismatches.push({
        field,
        actual: a ?? null,
        expected: b ?? null,
      });
    }
  }

  check(
    'stock_code',
    actual.stock_code,
    desired.stock_code,
  );

  check(
    'action_type',
    actual.action_type,
    desired.action_type,
  );

  check(
    'effective_date',
    actual.effective_date,
    desired.effective_date,
  );

  check(
    'provider',
    actual.provider,
    desired.provider,
  );

  check(
    'provider_event_id',
    actual.provider_event_id,
    desired.provider_event_id,
  );

  check(
    'source_fingerprint',
    actual.source_fingerprint,
    desired.source_fingerprint,
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

  check(
    'metadata.canonical_validation_status',
    actual.metadata?.canonical_validation_status ?? null,
    'VALIDATED',
  );

  if (
    !sameNullableNumber(
      actual.ratio_from,
      desired.ratio_from,
    )
  ) {
    mismatches.push({
      field: 'ratio_from',
      actual: actual.ratio_from ?? null,
      expected: desired.ratio_from ?? null,
    });
  }

  if (
    !sameNullableNumber(
      actual.ratio_to,
      desired.ratio_to,
    )
  ) {
    mismatches.push({
      field: 'ratio_to',
      actual: actual.ratio_to ?? null,
      expected: desired.ratio_to ?? null,
    });
  }

  if (
    !sameNullableNumber(
      actual.cash_amount,
      desired.cash_amount,
    )
  ) {
    mismatches.push({
      field: 'cash_amount',
      actual: actual.cash_amount ?? null,
      expected: desired.cash_amount ?? null,
    });
  }

  check(
    'currency',
    actual.currency ?? null,
    desired.currency ?? null,
  );

  return mismatches;
}

async function main() {
  const root =
    path.resolve(__dirname, '..');

  const preflightFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-production-event-preflight-v9-8-11-4-replay-v2.json',
    );

  const eligibilityFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-snapshot-eligibility-v9-8-11-5-1-replay-v3.json',
    );

  const outputFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-pre-apply-read-only-v9-8-11-6-replay.json',
    );

  assert(
    fs.existsSync(preflightFile),
    `PREFLIGHT_NOT_FOUND:${path.basename(preflightFile)}`,
  );

  assert(
    fs.existsSync(eligibilityFile),
    `ELIGIBILITY_NOT_FOUND:${path.basename(eligibilityFile)}`,
  );

  const preflight =
    readJson(preflightFile);

  const eligibility =
    readJson(eligibilityFile);

  assert(
    preflight.version === PREFLIGHT_VERSION,
    `PREFLIGHT_VERSION_MISMATCH:${preflight.version}`,
  );

  assert(
    preflight.status ===
      'CORRECTED_PRODUCTION_EVENT_PREFLIGHT_READY',
    `PREFLIGHT_NOT_READY:${preflight.status}`,
  );

  assert(
    eligibility.version === ELIGIBILITY_VERSION,
    `ELIGIBILITY_VERSION_MISMATCH:${eligibility.version}`,
  );

  assert(
    eligibility.status ===
      'SNAPSHOT_ASOF_ELIGIBILITY_GATE_READY',
    `ELIGIBILITY_NOT_READY:${eligibility.status}`,
  );

  assert(
    Array.isArray(preflight.alreadyCompatible),
    'PREFLIGHT_ALREADY_COMPATIBLE_MISSING',
  );

  assert(
    preflight.alreadyCompatible.length ===
      EXPECTED_COMPATIBLE,
    `PREFLIGHT_COMPATIBLE_COUNT_MISMATCH:${preflight.alreadyCompatible.length}`,
  );

  assert(
    Array.isArray(
      eligibility.eligibleInsertPayload,
    ),
    'ELIGIBLE_INSERT_PAYLOAD_MISSING',
  );

  assert(
    eligibility.eligibleInsertPayload.length ===
      EXPECTED_ELIGIBLE_MISSING,
    `ELIGIBLE_INSERT_COUNT_MISMATCH:${eligibility.eligibleInsertPayload.length}`,
  );

  assert(
    Array.isArray(
      eligibility.deferredFutureStructuralRows,
    ),
    'DEFERRED_STRUCTURAL_ROWS_MISSING',
  );

  assert(
    eligibility.deferredFutureStructuralRows.length ===
      EXPECTED_DEFERRED,
    `DEFERRED_COUNT_MISMATCH:${eligibility.deferredFutureStructuralRows.length}`,
  );

  const futurePendingRows =
    Array.isArray(preflight.futurePendingRows)
      ? preflight.futurePendingRows
      : [];

  assert(
    futurePendingRows.length ===
      EXPECTED_FUTURE_PENDING,
    `FUTURE_PENDING_COUNT_MISMATCH:${futurePendingRows.length}`,
  );

  const eligible =
    eligibility.eligibleInsertPayload[0];

  assert(
    String(eligible.provider_event_id) ===
      '20221013000451',
    `ELIGIBLE_ID_UNEXPECTED:${eligible.provider_event_id}`,
  );

  assert(
    String(eligible.stock_code) ===
      '028080',
    `ELIGIBLE_STOCK_UNEXPECTED:${eligible.stock_code}`,
  );

  assert(
    eligible.action_type ===
      'MERGER',
    `ELIGIBLE_ACTION_UNEXPECTED:${eligible.action_type}`,
  );

  assert(
    eligible.effective_date ===
      '2026-10-01',
    `ELIGIBLE_DATE_UNEXPECTED:${eligible.effective_date}`,
  );

  const {
    url,
    key,
  } = requireEnv();

  const namespaceRows =
    await readProductionNamespace(
      url,
      key,
    );

  const byId =
    groupByProviderEventId(
      namespaceRows,
    );

  const duplicateProviderEventIds =
    [...byId.entries()]
      .filter(([, rows]) => rows.length > 1)
      .map(([providerEventId, rows]) => ({
        providerEventId,
        rowCount: rows.length,
        eventIds: rows.map((row) => row.id),
      }));

  const compatibleDrift = [];

  for (
    const expected of
    preflight.alreadyCompatible
  ) {
    const matches =
      byId.get(
        String(expected.providerEventId),
      ) ?? [];

    if (matches.length !== 1) {
      compatibleDrift.push({
        providerEventId:
          expected.providerEventId,
        reason:
          'EXPECTED_EXACTLY_ONE_COMPATIBLE_ROW',
        rowCount:
          matches.length,
      });
      continue;
    }

    const actual = matches[0];
    const mismatches = [];

    function check(field, actualValue, expectedValue) {
      if (actualValue !== expectedValue) {
        mismatches.push({
          field,
          actual: actualValue ?? null,
          expected: expectedValue ?? null,
        });
      }
    }

    check(
      'id',
      actual.id,
      expected.existingEventId,
    );

    check(
      'stock_code',
      actual.stock_code,
      expected.stockCode,
    );

    check(
      'action_type',
      actual.action_type,
      expected.actionType,
    );

    check(
      'effective_date',
      actual.effective_date,
      expected.effectiveDate,
    );

    check(
      'production_applied',
      actual.production_applied,
      false,
    );

    check(
      'metadata.canonical_validation_status',
      actual.metadata?.canonical_validation_status ?? null,
      'VALIDATED',
    );

    if (mismatches.length > 0) {
      compatibleDrift.push({
        providerEventId:
          expected.providerEventId,
        eventId:
          actual.id,
        mismatches,
      });
    }
  }

  const eligibleMatches =
    byId.get(
      String(eligible.provider_event_id),
    ) ?? [];

  const eligibleFingerprintMatches =
    namespaceRows.filter(
      (row) =>
        row.source_fingerprint ===
        eligible.source_fingerprint,
    );

  const deferredPersisted = [];
  const deferredFingerprintCollisions = [];

  for (
    const row of
    eligibility.deferredFutureStructuralRows
  ) {
    const matches =
      byId.get(
        String(row.providerEventId),
      ) ?? [];

    if (matches.length > 0) {
      deferredPersisted.push({
        providerEventId:
          row.providerEventId,
        stockCode:
          row.stockCode,
        effectiveDate:
          row.effectiveDate,
        rows:
          matches.map((match) => ({
            id: match.id,
            stockCode:
              match.stock_code,
            actionType:
              match.action_type,
            effectiveDate:
              match.effective_date,
          })),
      });
    }

    if (row.sourceFingerprint) {
      const fingerprintMatches =
        namespaceRows.filter(
          (actual) =>
            actual.source_fingerprint ===
            row.sourceFingerprint,
        );

      if (fingerprintMatches.length > 0) {
        deferredFingerprintCollisions.push({
          providerEventId:
            row.providerEventId,
          sourceFingerprint:
            row.sourceFingerprint,
          matchedProviderEventIds:
            fingerprintMatches.map(
              (actual) =>
                actual.provider_event_id,
            ),
        });
      }
    }
  }

  const pendingPersisted = [];

  for (const pending of futurePendingRows) {
    const matches =
      byId.get(
        String(pending.providerEventId),
      ) ?? [];

    if (matches.length > 0) {
      pendingPersisted.push({
        providerEventId:
          pending.providerEventId,
        rowCount:
          matches.length,
      });
    }
  }

  const blockers = [];

  if (
    namespaceRows.length !==
    EXPECTED_NAMESPACE_ROWS
  ) {
    blockers.push(
      'PRODUCTION_NAMESPACE_COUNT_DRIFT',
    );
  }

  if (
    duplicateProviderEventIds.length > 0
  ) {
    blockers.push(
      'DUPLICATE_PRODUCTION_PROVIDER_EVENT_ID',
    );
  }

  if (compatibleDrift.length > 0) {
    blockers.push(
      'EXISTING_COMPATIBLE_ROW_DRIFT',
    );
  }

  if (eligibleMatches.length > 0) {
    blockers.push(
      'ELIGIBLE_TARGET_ALREADY_EXISTS',
    );
  }

  if (
    eligibleFingerprintMatches.length > 0
  ) {
    blockers.push(
      'ELIGIBLE_SOURCE_FINGERPRINT_COLLISION',
    );
  }

  if (deferredPersisted.length > 0) {
    blockers.push(
      'DEFERRED_STRUCTURAL_ALREADY_PERSISTED',
    );
  }

  if (
    deferredFingerprintCollisions.length > 0
  ) {
    blockers.push(
      'DEFERRED_SOURCE_FINGERPRINT_COLLISION',
    );
  }

  if (pendingPersisted.length > 0) {
    blockers.push(
      'FUTURE_PENDING_ALREADY_PERSISTED',
    );
  }

  const status =
    blockers.length === 0
      ? 'SINGLE_INSERT_PRE_APPLY_READ_ONLY_READY'
      : 'SINGLE_INSERT_PRE_APPLY_READ_ONLY_BLOCKED';

  const report = {
    status,
    version: VERSION,

    source: {
      preflightVersion:
        preflight.version,
      preflightFingerprint:
        preflight.outputFingerprint ?? null,

      eligibilityVersion:
        eligibility.version,
      eligibilityFingerprint:
        eligibility.outputFingerprint ?? null,
    },

    expected: {
      productionNamespaceRows:
        EXPECTED_NAMESPACE_ROWS,

      compatibleRows:
        EXPECTED_COMPATIBLE,

      eligibleMissingRows:
        EXPECTED_ELIGIBLE_MISSING,

      deferredRows:
        EXPECTED_DEFERRED,

      futurePendingRows:
        EXPECTED_FUTURE_PENDING,
    },

    counts: {
      productionNamespaceRows:
        namespaceRows.length,

      compatibleRowsExpected:
        preflight.alreadyCompatible.length,

      compatibleDriftRows:
        compatibleDrift.length,

      duplicateProviderEventIds:
        duplicateProviderEventIds.length,

      eligibleTargetExistingRows:
        eligibleMatches.length,

      eligibleFingerprintCollisionRows:
        eligibleFingerprintMatches.length,

      deferredPersistedRows:
        deferredPersisted.length,

      deferredFingerprintCollisionRows:
        deferredFingerprintCollisions.length,

      futurePendingPersistedRows:
        pendingPersisted.length,

      blockers:
        blockers.length,
    },

    eligibleMissingTarget: {
      providerEventId:
        eligible.provider_event_id,

      stockCode:
        eligible.stock_code,

      actionType:
        eligible.action_type,

      effectiveDate:
        eligible.effective_date,

      sourceFingerprint:
        eligible.source_fingerprint,

      currentDbRows:
        eligibleMatches.length,

      currentFingerprintMatches:
        eligibleFingerprintMatches.length,

      desiredCanonicalCheck:
        eligibleMatches.length === 1
          ? compareEligibleDesired(
              eligibleMatches[0],
              eligible,
            )
          : [],
    },

    compatibleDrift,
    duplicateProviderEventIds,
    deferredPersisted,
    deferredFingerprintCollisions,
    pendingPersisted,
    blockers,

    safety: {
      httpMethodsUsed: ['GET'],
      networkRequests: 1,
      databaseReads: 1,
      databaseWrites: 0,
      postRequests: 0,
      patchRequests: 0,
      deleteRequests: 0,
      canonicalEventsInserted: 0,
      productionApplied: false,
      coverageWindowAdvanced: false,
    },

    nextGate:
      status ===
      'SINGLE_INSERT_PRE_APPLY_READ_ONLY_READY'
        ? 'STOP_BEFORE_PRODUCTION_WRITE_SINGLE_ELIGIBLE_EVENT_REMAINS'
        : 'STOP_AND_REVIEW_DB_DRIFT',

    outputFile:
      'logs/opendart-corporate-action-pre-apply-read-only-v9-8-11-6-replay.json',
  };

  report.outputFingerprint =
    sha256(
      JSON.stringify({
        version:
          report.version,

        preflightFingerprint:
          report.source.preflightFingerprint,

        eligibilityFingerprint:
          report.source.eligibilityFingerprint,

        status:
          report.status,

        namespaceRows:
          namespaceRows.map((row) => [
            row.id,
            row.provider_event_id,
            row.stock_code,
            row.action_type,
            row.effective_date,
            row.source_fingerprint,
            row.production_applied,
            row.metadata?.canonical_validation_status ?? null,
          ]),

        missingTarget:
          report.eligibleMissingTarget,
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

        productionNamespaceRows:
          report.counts.productionNamespaceRows,

        compatibleRowsExpected:
          report.counts.compatibleRowsExpected,

        compatibleDriftRows:
          report.counts.compatibleDriftRows,

        eligibleTargetExistingRows:
          report.counts.eligibleTargetExistingRows,

        eligibleFingerprintCollisionRows:
          report.counts.eligibleFingerprintCollisionRows,

        deferredPersistedRows:
          report.counts.deferredPersistedRows,

        deferredFingerprintCollisionRows:
          report.counts.deferredFingerprintCollisionRows,

        futurePendingPersistedRows:
          report.counts.futurePendingPersistedRows,

        blockers:
          report.blockers,

        missingEligibleTarget:
          {
            providerEventId:
              report.eligibleMissingTarget.providerEventId,
            stockCode:
              report.eligibleMissingTarget.stockCode,
            actionType:
              report.eligibleMissingTarget.actionType,
            effectiveDate:
              report.eligibleMissingTarget.effectiveDate,
          },

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
    'SINGLE_INSERT_PRE_APPLY_READ_ONLY_READY'
  ) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status:
          'SINGLE_INSERT_PRE_APPLY_READ_ONLY_FAILED',

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
