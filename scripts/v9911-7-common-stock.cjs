/* eslint-disable no-console */
'use strict';

/**
 * AI Stock Lab
 * V9.8.11.7 - Post-insert 128-event canonical verification + UUID map
 *
 * READ-ONLY. No DB writes.
 *
 * Inputs:
 *   logs/opendart-corporate-action-bulk-insert-apply-v9-9-11-6-common-stock-scope.json
 *   logs/opendart-corporate-action-snapshot-eligibility-v9-9-11-5-1-common-stock-scope.json
 *   logs/opendart-corporate-action-production-event-preflight-v9-9-11-4-common-stock-scope.json
 *   logs/opendart-corporate-action-structural-date-finalization-v9-9-10-3-common-stock-scope.json
 *
 * Output:
 *   logs/opendart-corporate-action-2-event-id-map-v9-9-11-7-common-stock-scope.json
 *
 * Expected current-batch production-eligible set:
 *   123 newly inserted
 *   + 5 existing compatible
 *   = 128 canonical events
 *
 * Expected event dispositions:
 *   factor-ready        = 121
 *   structural-blocked = 7
 *
 * This stage also audits stock grouping before adjustment-run persistence:
 *   - distinct factor-ready stocks
 *   - multi-event stocks
 *   - structural/factor overlap
 *
 * Run:
 *   node --env-file=.env.local .\scripts\v9811-7.cjs
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_9_11_7_POST_INSERT_2_EVENT_CANONICAL_VERIFICATION_AND_UUID_MAP';

const APPLY_VERSION =
  'V9_9_11_6_CANONICAL_EVENT_2_ROW_BULK_INSERT_APPLY';

const ELIGIBILITY_VERSION =
  'V9_8_11_5_1_SNAPSHOT_ASOF_PRODUCTION_ELIGIBILITY_GATE';

const PREFLIGHT_VERSION =
  'V9_8_11_4_CORRECTED_PRODUCTION_CANONICAL_EVENT_PREFLIGHT';

const FINALIZATION_VERSION =
  'V9_8_10_3_STRUCTURAL_CANONICAL_DATE_FINALIZATION_PREVIEW';

const PROVIDER =
  'DART_KRX_CANONICAL';

const EXPECTED_TARGET_EVENTS = 2;
const EXPECTED_INSERTED = 2;
const EXPECTED_COMPATIBLE = 0;
const EXPECTED_FACTOR_READY = 2;
const EXPECTED_STRUCTURAL = 0;
const EXPECTED_DEFERRED_STRUCTURAL = 3;

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

function sameNumeric(a, b) {
  const x = num(a);
  const y = num(b);

  if (x === null || y === null) {
    return x === null && y === null;
  }

  return Math.abs(x - y) <= 1e-12;
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

function countBy(rows, selector) {
  const out = {};

  for (const row of rows) {
    const key = String(selector(row) ?? 'NULL');
    out[key] = (out[key] ?? 0) + 1;
  }

  return Object.fromEntries(
    Object.entries(out).sort(([a], [b]) => a.localeCompare(b)),
  );
}

function buildDesiredFromFinal(finalRow) {
  const actionType = finalRow.actionType;

  return {
    stock_code: finalRow.stockCode,
    action_type: actionType,
    effective_date:
      finalRow.canonicalPreview?.effective_date ?? null,
    ratio_from:
      num(finalRow.canonicalPreview?.ratio_from),
    ratio_to:
      num(finalRow.canonicalPreview?.ratio_to),
    cash_amount:
      num(finalRow.canonicalPreview?.cash_amount),
    currency:
      actionType === 'CASH_DIVIDEND'
        ? (
            normalizeCurrency(
              finalRow.canonicalPreview?.currency,
            ) ?? 'KRW'
          )
        : null,
    provider: PROVIDER,
    provider_event_id: finalRow.providerEventId,
    source_fingerprint: finalRow.sourceFingerprint,
    status: 'RECORDED',
    is_validation: false,
    production_applied: false,
  };
}

function compareCanonical(actual, desired) {
  const mismatches = [];

  function check(field, actualValue, desiredValue) {
    if (actualValue !== desiredValue) {
      mismatches.push({
        field,
        actual: actualValue,
        expected: desiredValue,
      });
    }
  }

  check('stock_code', actual.stock_code, desired.stock_code);
  check('action_type', actual.action_type, desired.action_type);
  check('effective_date', actual.effective_date, desired.effective_date);

  if (!sameNumeric(actual.ratio_from, desired.ratio_from)) {
    mismatches.push({
      field: 'ratio_from',
      actual: actual.ratio_from,
      expected: desired.ratio_from,
    });
  }

  if (!sameNumeric(actual.ratio_to, desired.ratio_to)) {
    mismatches.push({
      field: 'ratio_to',
      actual: actual.ratio_to,
      expected: desired.ratio_to,
    });
  }

  if (!sameNumeric(actual.cash_amount, desired.cash_amount)) {
    mismatches.push({
      field: 'cash_amount',
      actual: actual.cash_amount,
      expected: desired.cash_amount,
    });
  }

  check(
    'currency',
    normalizeCurrency(actual.currency),
    normalizeCurrency(desired.currency),
  );

  check('provider', actual.provider, desired.provider);
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
  check('status', actual.status, desired.status);
  check('is_validation', actual.is_validation, false);
  check('production_applied', actual.production_applied, false);

  if (
    actual.metadata?.canonical_validation_status !==
    'VALIDATED'
  ) {
    mismatches.push({
      field: 'metadata.canonical_validation_status',
      actual:
        actual.metadata?.canonical_validation_status ?? null,
      expected: 'VALIDATED',
    });
  }

  return mismatches;
}

async function main() {
  const root = path.resolve(__dirname, '..');

  const applyFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-bulk-insert-apply-v9-9-11-6-common-stock-scope.json',
  );

  const eligibilityFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-snapshot-eligibility-v9-9-11-5-1-common-stock-scope.json',
  );

  const preflightFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-production-event-preflight-v9-9-11-4-common-stock-scope.json',
  );

  const finalizationFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-structural-date-finalization-v9-9-10-3-common-stock-scope.json',
  );

  const outputFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-2-event-id-map-v9-9-11-7-common-stock-scope.json',
  );

  for (const file of [
    applyFile,
    eligibilityFile,
    preflightFile,
    finalizationFile,
  ]) {
    if (!fs.existsSync(file)) {
      throw new Error(`INPUT_NOT_FOUND:${path.basename(file)}`);
    }
  }

  const apply = readJson(applyFile);
  const eligibility = readJson(eligibilityFile);
  const preflight = readJson(preflightFile);
  const finalization = readJson(finalizationFile);

  if (apply.version !== APPLY_VERSION) {
    throw new Error('APPLY_VERSION_MISMATCH');
  }

  if (eligibility.version !== ELIGIBILITY_VERSION) {
    throw new Error('ELIGIBILITY_VERSION_MISMATCH');
  }

  if (preflight.version !== PREFLIGHT_VERSION) {
    throw new Error('PREFLIGHT_VERSION_MISMATCH');
  }

  if (finalization.version !== FINALIZATION_VERSION) {
    throw new Error('FINALIZATION_VERSION_MISMATCH');
  }

  if (
    apply.status !==
    'CANONICAL_EVENT_BULK_INSERT_APPLY_COMPLETE'
  ) {
    throw new Error('BULK_INSERT_APPLY_NOT_COMPLETE');
  }

  if (
    eligibility.status !==
    'SNAPSHOT_ASOF_ELIGIBILITY_GATE_READY'
  ) {
    throw new Error('ELIGIBILITY_GATE_NOT_READY');
  }

  if (
    preflight.status !==
    'CORRECTED_PRODUCTION_EVENT_PREFLIGHT_READY'
  ) {
    throw new Error('CORRECTED_PREFLIGHT_NOT_READY');
  }

  if (
    apply.counts?.eligibleInsertRows !== EXPECTED_INSERTED ||
    apply.counts?.verifiedInsertedRows !== EXPECTED_INSERTED ||
    eligibility.counts?.existingCompatibleRows !== EXPECTED_COMPATIBLE ||
    eligibility.counts?.deferredFutureStructuralRows !==
      EXPECTED_DEFERRED_STRUCTURAL
  ) {
    throw new Error('UPSTREAM_COUNT_CONTRACT_FAILED');
  }

  if (
    !Array.isArray(eligibility.eligibleInsertPayload) ||
    eligibility.eligibleInsertPayload.length !== EXPECTED_INSERTED
  ) {
    throw new Error('EXPECTED_123_ELIGIBLE_INSERT_ROWS');
  }

  if (
    !Array.isArray(preflight.alreadyCompatible) ||
    preflight.alreadyCompatible.length !== EXPECTED_COMPATIBLE
  ) {
    throw new Error('EXPECTED_5_COMPATIBLE_ROWS');
  }

  if (!Array.isArray(finalization.results)) {
    throw new Error('FINALIZATION_RESULTS_MISSING');
  }

  const targetProviderEventIds = [
    ...eligibility.eligibleInsertPayload.map(
      (row) => row.provider_event_id,
    ),
    ...preflight.alreadyCompatible.map(
      (row) => row.providerEventId,
    ),
  ];

  const targetSet = new Set(targetProviderEventIds);

  if (targetSet.size !== EXPECTED_TARGET_EVENTS) {
    throw new Error('EXPECTED_128_UNIQUE_TARGET_IDENTITIES');
  }

  const finalByProviderEventId = new Map(
    finalization.results.map((row) => [
      row.providerEventId,
      row,
    ]),
  );

  const missingFinalRows = targetProviderEventIds.filter(
    (providerEventId) =>
      !finalByProviderEventId.has(providerEventId),
  );

  if (missingFinalRows.length > 0) {
    throw new Error(
      `FINALIZATION_TARGET_ROWS_MISSING:${missingFinalRows.length}`,
    );
  }

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

  const dbRows = await getArray(
    `${url}/rest/v1/corporate_action_events` +
      `?select=${encodeURIComponent(select)}` +
      `&provider=eq.${encodeURIComponent(PROVIDER)}` +
      `&is_validation=eq.false` +
      `&order=provider_event_id.asc`,
    key,
  );

  const currentBatchRows = dbRows.filter(
    (row) => targetSet.has(row.provider_event_id),
  );

  const unrelatedRows = dbRows.filter(
    (row) => !targetSet.has(row.provider_event_id),
  );

  const grouped = new Map();

  for (const row of currentBatchRows) {
    if (!grouped.has(row.provider_event_id)) {
      grouped.set(row.provider_event_id, []);
    }

    grouped.get(row.provider_event_id).push(row);
  }

  const duplicateTargetRows = [...grouped.entries()]
    .filter(([, rows]) => rows.length !== 1)
    .map(([providerEventId, rows]) => ({
      providerEventId,
      rowCount: rows.length,
      ids: rows.map((row) => row.id),
    }));

  const missingTargetRows = targetProviderEventIds.filter(
    (providerEventId) =>
      !grouped.has(providerEventId),
  );

  const mismatches = [];
  const eventMap = [];

  for (const providerEventId of targetProviderEventIds) {
    const matches = grouped.get(providerEventId) ?? [];

    if (matches.length !== 1) {
      continue;
    }

    const actual = matches[0];
    const finalRow = finalByProviderEventId.get(providerEventId);
    const desired = buildDesiredFromFinal(finalRow);
    const rowMismatches = compareCanonical(actual, desired);

    if (rowMismatches.length > 0) {
      mismatches.push({
        providerEventId,
        eventId: actual.id,
        stockCode: actual.stock_code,
        actionType: actual.action_type,
        mismatches: rowMismatches,
      });
    }

    const factorStatus =
      finalRow.factorValidation?.status ?? null;

    eventMap.push({
      eventId: actual.id,
      providerEventId,
      stockCode: actual.stock_code,
      actionType: actual.action_type,
      effectiveDate: actual.effective_date,
      ratioFrom: num(actual.ratio_from),
      ratioTo: num(actual.ratio_to),
      cashAmount: num(actual.cash_amount),
      currency: normalizeCurrency(actual.currency),
      sourceFingerprint: actual.source_fingerprint,
      factorStatus,
      factorValidation: finalRow.factorValidation ?? null,
      sourceReceiptNo: finalRow.sourceReceiptNo ?? null,
      sourceKind: finalRow.sourceKind ?? null,
      isValidation: actual.is_validation,
      productionApplied: actual.production_applied,
      canonicalValidationStatus:
        actual.metadata?.canonical_validation_status ?? null,
    });
  }

  const factorReady = eventMap.filter(
    (row) => row.factorStatus === 'FACTOR_READY',
  );

  const structuralBlocked = eventMap.filter(
    (row) => row.factorStatus === 'STRUCTURAL_BLOCKED',
  );

  const unexpectedStatuses = eventMap.filter(
    (row) =>
      ![
        'FACTOR_READY',
        'STRUCTURAL_BLOCKED',
      ].includes(row.factorStatus),
  );

  const byStock = new Map();

  for (const row of eventMap) {
    if (!byStock.has(row.stockCode)) {
      byStock.set(row.stockCode, []);
    }

    byStock.get(row.stockCode).push(row);
  }

  const multiEventStocks = [...byStock.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([stockCode, rows]) => ({
      stockCode,
      eventCount: rows.length,
      events: rows
        .slice()
        .sort((a, b) =>
          `${a.effectiveDate}|${a.providerEventId}`.localeCompare(
            `${b.effectiveDate}|${b.providerEventId}`,
          ),
        )
        .map((row) => ({
          eventId: row.eventId,
          providerEventId: row.providerEventId,
          actionType: row.actionType,
          effectiveDate: row.effectiveDate,
          factorStatus: row.factorStatus,
        })),
    }))
    .sort((a, b) => a.stockCode.localeCompare(b.stockCode));

  const factorStockSet = new Set(
    factorReady.map((row) => row.stockCode),
  );

  const structuralStockSet = new Set(
    structuralBlocked.map((row) => row.stockCode),
  );

  const factorStructuralOverlapStocks = [
    ...factorStockSet,
  ]
    .filter((stockCode) =>
      structuralStockSet.has(stockCode),
    )
    .sort();

  const duplicateEventIds =
    eventMap.length -
    new Set(eventMap.map((row) => row.eventId)).size;

  const duplicateFingerprints =
    eventMap.length -
    new Set(
      eventMap.map((row) => row.sourceFingerprint),
    ).size;

  const baseVerificationPass =
    currentBatchRows.length === EXPECTED_TARGET_EVENTS &&
    eventMap.length === EXPECTED_TARGET_EVENTS &&
    missingTargetRows.length === 0 &&
    duplicateTargetRows.length === 0 &&
    mismatches.length === 0 &&
    unexpectedStatuses.length === 0 &&
    factorReady.length === EXPECTED_FACTOR_READY &&
    structuralBlocked.length === EXPECTED_STRUCTURAL &&
    duplicateEventIds === 0 &&
    duplicateFingerprints === 0;

  const adjustmentGroupingReady =
    baseVerificationPass &&
    factorReady.length === EXPECTED_FACTOR_READY &&
    new Set(factorReady.map((row) => row.stockCode)).size ===
      EXPECTED_FACTOR_READY;

  const status =
    !baseVerificationPass
      ? 'POST_INSERT_2_EVENT_VERIFICATION_FAILED'
      : adjustmentGroupingReady
        ? 'POST_INSERT_2_EVENT_VERIFICATION_COMPLETE'
        : 'POST_INSERT_2_EVENT_VERIFICATION_COMPLETE_WITH_GROUPING_REVIEW';

  const report = {
    version: VERSION,
    status,

    counts: {
      productionNamespaceRows:
        dbRows.length,

      currentBatchTargetRows:
        currentBatchRows.length,

      unrelatedProductionRows:
        unrelatedRows.length,

      eventMapRows:
        eventMap.length,

      factorReadyEvents:
        factorReady.length,

      structuralBlockedEvents:
        structuralBlocked.length,

      factorReadyDistinctStocks:
        new Set(
          factorReady.map((row) => row.stockCode),
        ).size,

      totalDistinctStocks:
        byStock.size,

      multiEventStocks:
        multiEventStocks.length,

      factorStructuralOverlapStocks:
        factorStructuralOverlapStocks.length,

      missingTargetRows:
        missingTargetRows.length,

      duplicateTargetRows:
        duplicateTargetRows.length,

      canonicalMismatchRows:
        mismatches.length,

      unexpectedFactorStatusRows:
        unexpectedStatuses.length,

      duplicateEventIds,

      duplicateSourceFingerprints:
        duplicateFingerprints,

      deferredFutureStructuralRows:
        eligibility.counts?.deferredFutureStructuralRows ?? null,
    },

    actionTypeCounts:
      countBy(
        eventMap,
        (row) => row.actionType,
      ),

    factorReadyActionTypeCounts:
      countBy(
        factorReady,
        (row) => row.actionType,
      ),

    structuralActionTypeCounts:
      countBy(
        structuralBlocked,
        (row) => row.actionType,
      ),

    checks: {
      baseVerificationPass,
      adjustmentGroupingReady,
      singleEventPerFactorReadyStock:
        new Set(factorReady.map((row) => row.stockCode)).size ===
        factorReady.length,
    },

    missingTargetRows,
    duplicateTargetRows,
    canonicalMismatches: mismatches,
    unexpectedStatuses,
    multiEventStocks,
    factorStructuralOverlapStocks,

    eventMap: eventMap
      .slice()
      .sort((a, b) =>
        `${a.stockCode}|${a.effectiveDate}|${a.providerEventId}`.localeCompare(
          `${b.stockCode}|${b.effectiveDate}|${b.providerEventId}`,
        ),
      ),

    factorReadyEventMap: factorReady
      .slice()
      .sort((a, b) => a.stockCode.localeCompare(b.stockCode)),

    structuralBlockedEventMap: structuralBlocked
      .slice()
      .sort((a, b) =>
        `${a.stockCode}|${a.effectiveDate}`.localeCompare(
          `${b.stockCode}|${b.effectiveDate}`,
        ),
      ),

    safety: {
      networkRequests: 1,
      databaseReads: 1,
      databaseWrites: 0,
      canonicalEventsInserted: 0,
      canonicalEventsUpdated: 0,
      adjustmentRunsInserted: 0,
      factorRowsInserted: 0,
      coverageWindowAdvanced: false,
    },

    nextGate:
      status === 'POST_INSERT_2_EVENT_VERIFICATION_COMPLETE'
        ? 'BUILD_2_ADJUSTMENT_RUN_AND_2_FACTOR_PREFLIGHT'
        : status ===
            'POST_INSERT_2_EVENT_VERIFICATION_COMPLETE_WITH_GROUPING_REVIEW'
          ? 'REVIEW_MULTI_EVENT_GROUPING_BEFORE_ADJUSTMENT_PERSISTENCE'
          : 'STOP_AND_REVIEW',

    outputFile: path
      .relative(root, outputFile)
      .replaceAll('\\', '/'),
  };

  report.outputFingerprint = sha256(
    JSON.stringify({
      version: report.version,
      status: report.status,
      eventMap: report.eventMap.map((row) => [
        row.eventId,
        row.providerEventId,
        row.stockCode,
        row.actionType,
        row.effectiveDate,
        row.factorStatus,
        row.sourceFingerprint,
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
        actionTypeCounts: report.actionTypeCounts,
        factorReadyActionTypeCounts:
          report.factorReadyActionTypeCounts,
        structuralActionTypeCounts:
          report.structuralActionTypeCounts,
        checks: report.checks,
        multiEventStocks: report.multiEventStocks,
        factorStructuralOverlapStocks:
          report.factorStructuralOverlapStocks,
        databaseWrites: 0,
        adjustmentRunsInserted: 0,
        factorRowsInserted: 0,
        nextGate: report.nextGate,
        outputFile: report.outputFile,
      },
      null,
      2,
    ),
  );

  if (
    status === 'POST_INSERT_2_EVENT_VERIFICATION_FAILED'
  ) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status: 'POST_INSERT_2_EVENT_VERIFICATION_ERROR',
        version: VERSION,
        error: String(error?.message ?? error),
        databaseWrites: 0,
      },
      null,
      2,
    ),
  );

  process.exitCode = 1;
});
