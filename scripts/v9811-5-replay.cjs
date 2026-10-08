/* eslint-disable no-console */
'use strict';

/**
 * AI Stock Lab
 * V9.8.11.5 - 153-row canonical event bulk-insert dry-run
 *
 * READ-ONLY. No DB writes.
 *
 * Input:
 *   logs/opendart-corporate-action-production-event-preflight-v9-8-11-4-replay.json
 *
 * Output:
 *   logs/opendart-corporate-action-bulk-insert-dry-run-v9-8-11-5-replay.json
 *
 * Purpose:
 *   Freeze and validate the exact 153-row INSERT payload before production write.
 *
 * Safety contract:
 *   - expected insert rows = 153
 *   - expected already-compatible rows = 5
 *   - future pending row remains excluded
 *   - production namespace = is_validation=false
 *   - production_applied MUST remain false
 *   - no target identity may have appeared since V9.8.11.4
 *   - no conflicting source fingerprint may exist in production namespace
 *   - remote CHECK constraints are modeled locally
 *   - no POST/PATCH/DELETE
 *
 * Intended apply strategy after this stage:
 *   ONE bulk POST of all 153 rows with return=representation.
 *   PostgREST inserts the JSON array in one SQL statement, so a constraint
 *   failure aborts the statement rather than intentionally applying rows
 *   one-by-one.
 *
 * Run:
 *   node --env-file=.env.local .\scripts\v9811-5.cjs
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_8_11_5_REPLAY_CURRENT_STATE_CANONICAL_EVENT_BULK_INSERT_DRY_RUN';

const INPUT_VERSION =
  'V9_8_11_4_REPLAY_CORRECTED_PRODUCTION_CANONICAL_EVENT_PREFLIGHT';

const PROVIDER =
  'DART_KRX_CANONICAL';

const EXPECTED_INSERT_ROWS = 31;
const EXPECTED_COMPATIBLE_ROWS = 127;
const EXPECTED_PERSISTABLE = 158;
const EXPECTED_FUTURE_PENDING = 1;

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''),
  );
}

function atomicSaveJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(value)
    .digest('hex');
}

function num(value) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeCurrency(value) {
  const text = String(value ?? '').trim().toUpperCase();
  return text || null;
}

function isIsoDate(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return false;
  }

  const date = new Date(`${value}T00:00:00Z`);

  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
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
    body = JSON.parse(text);
  } catch {
    throw new Error('INVALID_SUPABASE_JSON_RESPONSE');
  }

  if (!response.ok) {
    throw new Error(
      `SUPABASE_READ_FAILED:${body?.code ?? response.status}`,
    );
  }

  if (!Array.isArray(body)) {
    throw new Error('SUPABASE_ARRAY_RESPONSE_REQUIRED');
  }

  return body;
}

function sameNumeric(a, b) {
  const x = num(a);
  const y = num(b);

  if (x === null || y === null) {
    return x === null && y === null;
  }

  return Math.abs(x - y) <= 1e-12;
}

function compareExisting(existing, desired) {
  const mismatches = [];

  function check(field, actual, expected) {
    if (actual !== expected) {
      mismatches.push({
        field,
        actual,
        expected,
      });
    }
  }

  check('stock_code', existing.stock_code, desired.stock_code);
  check('action_type', existing.action_type, desired.action_type);
  check('effective_date', existing.effective_date, desired.effective_date);

  if (!sameNumeric(existing.ratio_from, desired.ratio_from)) {
    mismatches.push({
      field: 'ratio_from',
      actual: existing.ratio_from,
      expected: desired.ratio_from,
    });
  }

  if (!sameNumeric(existing.ratio_to, desired.ratio_to)) {
    mismatches.push({
      field: 'ratio_to',
      actual: existing.ratio_to,
      expected: desired.ratio_to,
    });
  }

  if (!sameNumeric(existing.cash_amount, desired.cash_amount)) {
    mismatches.push({
      field: 'cash_amount',
      actual: existing.cash_amount,
      expected: desired.cash_amount,
    });
  }

  check(
    'currency',
    normalizeCurrency(existing.currency),
    normalizeCurrency(desired.currency),
  );

  check('provider', existing.provider, desired.provider);
  check(
    'provider_event_id',
    existing.provider_event_id,
    desired.provider_event_id,
  );
  check(
    'source_fingerprint',
    existing.source_fingerprint,
    desired.source_fingerprint,
  );
  check('status', existing.status, 'RECORDED');
  check('is_validation', existing.is_validation, false);
  check('production_applied', existing.production_applied, false);

  check(
    'metadata.canonical_validation_status',
    existing.metadata?.canonical_validation_status ?? null,
    'VALIDATED',
  );

  return mismatches;
}

function validateRemoteChecks(row) {
  const issues = [];

  if (!row.stock_code) {
    issues.push('STOCK_CODE_REQUIRED');
  }

  if (!row.provider_event_id) {
    issues.push('PROVIDER_EVENT_ID_REQUIRED');
  }

  if (!row.source_fingerprint) {
    issues.push('SOURCE_FINGERPRINT_REQUIRED');
  }

  if (!isIsoDate(row.effective_date)) {
    issues.push('EFFECTIVE_DATE_REQUIRED');
  }

  if (row.provider !== PROVIDER) {
    issues.push('PROVIDER_MISMATCH');
  }

  // corporate_action_events_production_check
  if (row.production_applied !== false) {
    issues.push('PRODUCTION_APPLIED_MUST_BE_FALSE');
  }

  // corporate_action_events_status_check
  if (
    ![
      'RECORDED',
      'SUPPORTED',
      'UNSUPPORTED',
      'INVALID',
    ].includes(row.status)
  ) {
    issues.push('STATUS_CHECK_FAILED');
  }

  // corporate_action_events_type_check
  if (
    ![
      'STOCK_SPLIT',
      'REVERSE_SPLIT',
      'CASH_DIVIDEND',
      'STOCK_DIVIDEND',
      'RIGHTS_ISSUE',
      'SPIN_OFF',
      'MERGER',
      'OTHER',
    ].includes(row.action_type)
  ) {
    issues.push('TYPE_CHECK_FAILED');
  }

  // corporate_action_events_split_ratio_check
  if (
    row.action_type === 'STOCK_SPLIT' ||
    row.action_type === 'REVERSE_SPLIT'
  ) {
    if (!(num(row.ratio_from) > 0) || !(num(row.ratio_to) > 0)) {
      issues.push('SPLIT_RATIO_CHECK_FAILED');
    }
  }

  if (
    row.action_type === 'CASH_DIVIDEND'
  ) {
    if (!(num(row.cash_amount) >= 0)) {
      issues.push('CASH_AMOUNT_REQUIRED');
    }

    if (
      normalizeCurrency(row.currency) !== 'KRW'
    ) {
      issues.push('CASH_CURRENCY_NOT_KRW');
    }

    if (
      num(row.ratio_from) !== null ||
      num(row.ratio_to) !== null
    ) {
      issues.push('CASH_RATIO_MUST_BE_NULL');
    }
  }

  if (
    row.action_type === 'MERGER' ||
    row.action_type === 'SPIN_OFF'
  ) {
    if (
      num(row.ratio_from) !== null ||
      num(row.ratio_to) !== null ||
      num(row.cash_amount) !== null
    ) {
      issues.push('STRUCTURAL_NUMERIC_FIELDS_MUST_BE_NULL');
    }
  }

  if (
    row.metadata?.canonical_validation_status !== 'VALIDATED'
  ) {
    issues.push('CANONICAL_VALIDATION_METADATA_REQUIRED');
  }

  return issues;
}

async function main() {
  const root = path.resolve(__dirname, '..');

  const inputFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-production-event-preflight-v9-8-11-4-replay.json',
  );

  const outputFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-bulk-insert-dry-run-v9-8-11-5-replay.json',
  );

  if (!fs.existsSync(inputFile)) {
    throw new Error(
      `INPUT_NOT_FOUND:${path.basename(inputFile)}`,
    );
  }

  const input = readJson(inputFile);

  if (input.version !== INPUT_VERSION) {
    throw new Error('INPUT_VERSION_MISMATCH');
  }

  if (
    input.status !==
    'CORRECTED_PRODUCTION_EVENT_PREFLIGHT_READY'
  ) {
    throw new Error('CORRECTED_PREFLIGHT_NOT_READY');
  }

  if (
    input.counts?.wouldInsert !== EXPECTED_INSERT_ROWS ||
    input.counts?.alreadyCompatible !== EXPECTED_COMPATIBLE_ROWS ||
    input.counts?.persistableNow !== EXPECTED_PERSISTABLE ||
    input.counts?.futurePending !== EXPECTED_FUTURE_PENDING ||
    input.counts?.conflicts !== 0
  ) {
    throw new Error('INPUT_COUNT_CONTRACT_FAILED');
  }

  if (
    !Array.isArray(input.insertPreview) ||
    input.insertPreview.length !== EXPECTED_INSERT_ROWS
  ) {
    throw new Error('EXPECTED_31_INSERT_PREVIEW_ROWS');
  }

  if (
    !Array.isArray(input.alreadyCompatible) ||
    input.alreadyCompatible.length !== EXPECTED_COMPATIBLE_ROWS
  ) {
    throw new Error('EXPECTED_5_COMPATIBLE_ROWS');
  }

  const payload = input.insertPreview.map((row) => ({
    stock_code: row.stock_code,
    action_type: row.action_type,
    effective_date: row.effective_date,
    ratio_from: num(row.ratio_from),
    ratio_to: num(row.ratio_to),
    cash_amount: num(row.cash_amount),
    currency: normalizeCurrency(row.currency),
    provider: row.provider,
    provider_event_id: row.provider_event_id,
    source_fingerprint: row.source_fingerprint,
    status: row.status,
    metadata: row.metadata ?? {},
    is_validation: row.is_validation,
    production_applied: row.production_applied,
  }));

  const payloadIssues = payload
    .map((row) => ({
      providerEventId: row.provider_event_id,
      issues: validateRemoteChecks(row),
    }))
    .filter((row) => row.issues.length > 0);

  const uniqueIdentities = new Set(
    payload.map(
      (row) =>
        `${row.provider}|${row.provider_event_id}|${row.is_validation}`,
    ),
  );

  const uniqueFingerprints = new Set(
    payload.map((row) => row.source_fingerprint),
  );

  const { url, key } = requireEnv();

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

  const existing = await getArray(
    `${url}/rest/v1/corporate_action_events` +
      `?select=${encodeURIComponent(select)}` +
      `&provider=eq.${encodeURIComponent(PROVIDER)}` +
      `&is_validation=eq.false` +
      `&order=provider_event_id.asc`,
    key,
  );

  const byProviderEventId = new Map();

  for (const row of existing) {
    if (!byProviderEventId.has(row.provider_event_id)) {
      byProviderEventId.set(row.provider_event_id, []);
    }

    byProviderEventId
      .get(row.provider_event_id)
      .push(row);
  }

  const newlyAppearedTargets = [];

  for (const row of payload) {
    const matches =
      byProviderEventId.get(row.provider_event_id) ?? [];

    if (matches.length > 0) {
      newlyAppearedTargets.push({
        providerEventId: row.provider_event_id,
        existingRows: matches.map((match) => ({
          id: match.id,
          stockCode: match.stock_code,
          actionType: match.action_type,
          effectiveDate: match.effective_date,
          sourceFingerprint: match.source_fingerprint,
          productionApplied: match.production_applied,
        })),
      });
    }
  }

  const compatibleDrift = [];

  for (const compatible of input.alreadyCompatible) {
    const matches =
      byProviderEventId.get(compatible.providerEventId) ?? [];

    if (matches.length !== 1) {
      compatibleDrift.push({
        providerEventId: compatible.providerEventId,
        reason: 'EXPECTED_EXACTLY_ONE_EXISTING_COMPATIBLE_ROW',
        rowCount: matches.length,
      });
      continue;
    }

    // Reconstruct desired row from V9.8.11.4 semantics using the existing
    // compatible summary plus current DB row. The canonical semantic fields
    // were already proven by V9.8.11.4; here we ensure that same DB row still
    // exists and lifecycle/validation metadata have not drifted.
    const current = matches[0];

    if (
      current.id !== compatible.existingEventId ||
      current.stock_code !== compatible.stockCode ||
      current.action_type !== compatible.actionType ||
      current.effective_date !== compatible.effectiveDate ||
      current.is_validation !== false ||
      current.production_applied !== false ||
      current.metadata?.canonical_validation_status !== 'VALIDATED'
    ) {
      compatibleDrift.push({
        providerEventId: compatible.providerEventId,
        reason: 'COMPATIBLE_ROW_DRIFTED',
        current: {
          id: current.id,
          stockCode: current.stock_code,
          actionType: current.action_type,
          effectiveDate: current.effective_date,
          isValidation: current.is_validation,
          productionApplied: current.production_applied,
          canonicalValidationStatus:
            current.metadata?.canonical_validation_status ?? null,
        },
        expected: compatible,
      });
    }
  }

  const existingFingerprintMap = new Map();

  for (const row of existing) {
    if (!existingFingerprintMap.has(row.source_fingerprint)) {
      existingFingerprintMap.set(row.source_fingerprint, []);
    }

    existingFingerprintMap
      .get(row.source_fingerprint)
      .push(row);
  }

  const productionFingerprintCollisions = [];

  for (const row of payload) {
    const matches =
      existingFingerprintMap.get(row.source_fingerprint) ?? [];

    if (matches.length > 0) {
      productionFingerprintCollisions.push({
        providerEventId: row.provider_event_id,
        sourceFingerprint: row.source_fingerprint,
        existingRows: matches.map((match) => ({
          id: match.id,
          providerEventId: match.provider_event_id,
          stockCode: match.stock_code,
          actionType: match.action_type,
        })),
      });
    }
  }

  const duplicateExistingIdentities = [...byProviderEventId.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([providerEventId, rows]) => ({
      providerEventId,
      rowCount: rows.length,
      ids: rows.map((row) => row.id),
    }));

  const blockers = [];

  if (payloadIssues.length > 0) {
    blockers.push('INSERT_PAYLOAD_CONSTRAINT_MODEL_FAILED');
  }

  if (uniqueIdentities.size !== payload.length) {
    blockers.push('DUPLICATE_INSERT_CANONICAL_IDENTITY');
  }

  if (uniqueFingerprints.size !== payload.length) {
    blockers.push('DUPLICATE_INSERT_SOURCE_FINGERPRINT');
  }

  if (newlyAppearedTargets.length > 0) {
    blockers.push('TARGET_IDENTITY_APPEARED_SINCE_PREFLIGHT');
  }

  if (compatibleDrift.length > 0) {
    blockers.push('EXISTING_COMPATIBLE_ROW_DRIFT');
  }

  if (productionFingerprintCollisions.length > 0) {
    blockers.push('PRODUCTION_SOURCE_FINGERPRINT_COLLISION');
  }

  if (duplicateExistingIdentities.length > 0) {
    blockers.push('EXISTING_DUPLICATE_PROVIDER_EVENT_ID');
  }

  const status =
    blockers.length === 0
      ? 'CANONICAL_EVENT_BULK_INSERT_DRY_RUN_READY'
      : 'CANONICAL_EVENT_BULK_INSERT_DRY_RUN_BLOCKED';

  const actionTypeCounts = Object.fromEntries(
    Object.entries(
      payload.reduce((acc, row) => {
        acc[row.action_type] = (acc[row.action_type] ?? 0) + 1;
        return acc;
      }, {}),
    ).sort(([a], [b]) => a.localeCompare(b)),
  );

  const report = {
    version: VERSION,
    status,

    source: {
      inputVersion: input.version,
      inputFingerprint: input.outputFingerprint,
    },

    counts: {
      insertRows: payload.length,
      existingCompatibleRows: input.alreadyCompatible.length,
      existingProductionNamespaceRows: existing.length,
      uniqueInsertIdentities: uniqueIdentities.size,
      uniqueInsertSourceFingerprints: uniqueFingerprints.size,
      payloadConstraintIssueRows: payloadIssues.length,
      newlyAppearedTargetRows: newlyAppearedTargets.length,
      compatibleDriftRows: compatibleDrift.length,
      productionFingerprintCollisionRows:
        productionFingerprintCollisions.length,
      existingDuplicateProviderEventIds:
        duplicateExistingIdentities.length,
      futurePendingExcluded:
        input.futurePendingRows?.length ?? 0,
    },

    actionTypeCounts,

    blockers,
    payloadIssues,
    newlyAppearedTargets,
    compatibleDrift,
    productionFingerprintCollisions,
    duplicateExistingIdentities,

    insertPayload: payload,

    remoteDbContract: {
      productionNamespace: 'is_validation=false',
      productionAppliedCheck: 'production_applied=false',
      statusCheck: 'RECORDED|SUPPORTED|UNSUPPORTED|INVALID',
      splitRatioCheck:
        'STOCK_SPLIT/REVERSE_SPLIT require positive ratio_from and ratio_to',
      canonicalValidity:
        'metadata.canonical_validation_status=VALIDATED',
    },

    applyContract: {
      strategy: 'ONE_BULK_POST_JSON_ARRAY',
      expectedRows: EXPECTED_INSERT_ROWS,
      onConflict: 'NONE_FAIL_CLOSED',
      returnRepresentation: true,
      requireReturnedRows: EXPECTED_INSERT_ROWS,
      postInsertVerification:
        'RE_READ_ALL_31_IDENTITIES_AND_COMPARE_EXACT_CANONICAL_FIELDS',
      failureBehavior:
        'DO_NOT_FALL_BACK_TO_ROW_BY_ROW_INSERT',
    },

    safety: {
      httpMethodsUsed: ['GET'],
      databaseReads: 1,
      databaseWrites: 0,
      insertRequestsExecuted: 0,
      canonicalEventsInserted: 0,
      coverageWindowAdvanced: false,
    },

    nextGate:
      status === 'CANONICAL_EVENT_BULK_INSERT_DRY_RUN_READY'
        ? 'BUILD_V9_8_11_5_1_REPLAY_SNAPSHOT_ELIGIBILITY_GATE'
        : 'STOP_AND_REVIEW',

    outputFile: path
      .relative(root, outputFile)
      .replaceAll('\\', '/'),
  };

  report.outputFingerprint = sha256(
    JSON.stringify({
      version: report.version,
      inputFingerprint: report.source.inputFingerprint,
      status: report.status,
      payload: payload.map((row) => [
        row.provider_event_id,
        row.stock_code,
        row.action_type,
        row.effective_date,
        row.ratio_from,
        row.ratio_to,
        row.cash_amount,
        row.currency,
        row.source_fingerprint,
        row.production_applied,
      ]),
    }),
  );

  atomicSaveJson(outputFile, report);

  console.log(
    JSON.stringify(
      {
        status: report.status,
        version: VERSION,
        ...report.counts,
        actionTypeCounts,
        blockers,
        databaseWrites: 0,
        insertRequestsExecuted: 0,
        canonicalEventsInserted: 0,
        nextGate: report.nextGate,
        outputFile: report.outputFile,
      },
      null,
      2,
    ),
  );

  if (status !== 'CANONICAL_EVENT_BULK_INSERT_DRY_RUN_READY') {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status: 'CANONICAL_EVENT_BULK_INSERT_DRY_RUN_FAILED',
        version: VERSION,
        error: String(error?.message ?? error),
        databaseWrites: 0,
        insertRequestsExecuted: 0,
      },
      null,
      2,
    ),
  );

  process.exitCode = 1;
});
