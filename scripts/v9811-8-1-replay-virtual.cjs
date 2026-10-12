#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * V9.8.11.8.1 replay - schema-aware virtual-128 persistence preflight
 *
 * READ ONLY.
 *
 * Repaired lineage has:
 * - 128 production-eligible target events
 * - 127 events physically present in corporate_action_events
 * - 1 missing event is STRUCTURAL_BLOCKED only:
 *     028080 / 20221013000451 / MERGER / 2026-10-01
 * - all 121 FACTOR_READY events have real DB UUIDs
 *
 * This stage mirrors the intent of historical V9.8.11.8.1 while allowing the
 * one missing structural event to remain virtual. No synthetic event UUID is
 * created and no DB write is performed.
 *
 * It:
 * - rebuilds 128 run previews
 * - rebuilds 121 factor previews using only REAL action_event_id UUIDs
 * - validates stock-universe coverage
 * - reads existing production adjustment runs/factors
 * - classifies current persistence state as EMPTY, RUNS_ONLY, or COMPLETE
 * - fail-closes on partial/conflicting states
 *
 * Safe resume states:
 *   runs=0,   factors=0   -> EMPTY
 *   runs=128, factors=0   -> RUNS_ONLY
 *   runs=128, factors=121 -> COMPLETE
 *
 * Anything else -> BLOCKED.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_8_11_8_1_REPLAY_SCHEMA_AWARE_VIRTUAL_128_PERSISTENCE_PREFLIGHT';

const READINESS_VERSION =
  'V9_8_11_7_REPLAY_VIRTUAL_128_EVENT_READINESS_AND_REAL_UUID_AUDIT';

const FINALIZATION_VERSION =
  'V9_8_10_3_REPLAY_V3_TARGETED_STRUCTURAL_FALSE_SAFE_DATE_CORRECTION';

const RUN_VERSION =
  'V9_8_11_PRODUCTION_ADJUSTMENT_V1';

const EXPECTED_EVENTS = 128;
const EXPECTED_FACTOR_READY = 121;
const EXPECTED_STRUCTURAL = 7;
const EXPECTED_VIRTUAL_STRUCTURAL = 1;

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''),
  );
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

function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(value)
    .digest('hex');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function requireEnv() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL;

  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error('SUPABASE_URL_REQUIRED');
  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY_REQUIRED');
  }

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
    body = text ? JSON.parse(text) : [];
  } catch {
    throw new Error(
      `INVALID_SUPABASE_JSON_RESPONSE:${response.status}`,
    );
  }

  if (!response.ok) {
    const error = new Error(
      `SUPABASE_READ_FAILED:${body?.code ?? response.status}`,
    );
    error.details = body;
    throw error;
  }

  if (!Array.isArray(body)) {
    throw new Error('EXPECTED_ARRAY_RESPONSE');
  }

  return body;
}

function finite(v) {
  if (v === null || v === undefined || v === '') {
    return null;
  }

  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function firstFinite(...values) {
  for (const value of values) {
    const n = finite(value);
    if (n !== null) return n;
  }
  return null;
}

function approximatelyEqual(a, b) {
  const na = Number(a);
  const nb = Number(b);

  if (!Number.isFinite(na) || !Number.isFinite(nb)) {
    return false;
  }

  const scale = Math.max(1, Math.abs(na), Math.abs(nb));
  return Math.abs(na - nb) <= scale * 1e-12;
}

function extractFactorValues(event) {
  const fv = event.factorValidation ?? {};
  const actionType = event.actionType;

  let eventPriceFactor = firstFinite(
    fv.eventPriceFactor,
    fv.event_price_factor,
    fv.priceFactor,
    fv.price_factor,
    fv.factor?.price,
    fv.factor?.priceFactor,
    fv.factor?.eventPriceFactor,
    fv.factors?.price,
    fv.factors?.eventPriceFactor,
  );

  let eventShareFactor = firstFinite(
    fv.eventShareFactor,
    fv.event_share_factor,
    fv.shareFactor,
    fv.share_factor,
    fv.factor?.share,
    fv.factor?.shareFactor,
    fv.factor?.eventShareFactor,
    fv.factors?.share,
    fv.factors?.eventShareFactor,
  );

  if (
    eventPriceFactor === null ||
    eventShareFactor === null
  ) {
    if (
      actionType === 'STOCK_SPLIT' ||
      actionType === 'REVERSE_SPLIT'
    ) {
      const from = firstFinite(
        event.ratioFrom,
        event.ratio_from,
        event.canonicalPreview?.ratio_from,
      );

      const to = firstFinite(
        event.ratioTo,
        event.ratio_to,
        event.canonicalPreview?.ratio_to,
      );

      if (
        from !== null &&
        to !== null &&
        from > 0 &&
        to > 0
      ) {
        eventPriceFactor =
          eventPriceFactor ?? (from / to);

        eventShareFactor =
          eventShareFactor ?? (to / from);
      }
    }

    if (
      actionType === 'CASH_DIVIDEND' ||
      actionType === 'CASH'
    ) {
      eventPriceFactor =
        eventPriceFactor ??
        firstFinite(
          fv.cashPriceFactor,
          fv.cash_price_factor,
          fv.factor,
          fv.eventFactor,
          fv.event_factor,
        );

      eventShareFactor =
        eventShareFactor ?? 1;
    }

    if (actionType === 'STOCK_DIVIDEND') {
      eventPriceFactor =
        eventPriceFactor ??
        firstFinite(
          fv.stockDividendPriceFactor,
          fv.stock_dividend_price_factor,
          fv.factor,
          fv.eventFactor,
          fv.event_factor,
        );

      eventShareFactor =
        eventShareFactor ??
        firstFinite(
          fv.stockDividendShareFactor,
          fv.stock_dividend_share_factor,
        );
    }
  }

  return {
    eventPriceFactor,
    eventShareFactor,
  };
}

function buildRunPreview(event) {
  const factorReady =
    event.factorStatus === 'FACTOR_READY';

  const structural =
    event.factorStatus === 'STRUCTURAL_BLOCKED';

  assert(
    factorReady || structural,
    `UNEXPECTED_FACTOR_STATUS:${event.providerEventId}:${event.factorStatus}`,
  );

  const eventIds =
    event.eventId ? [event.eventId] : [];

  return {
    stock_code: event.stockCode,
    version: RUN_VERSION,

    status:
      factorReady
        ? 'READY'
        : 'BLOCKED_UNSUPPORTED_ACTION',

    event_count: 1,

    supported_event_count:
      factorReady ? 1 : 0,

    unsupported_event_count:
      structural ? 1 : 0,

    factor_count:
      factorReady ? 1 : 0,

    summary: {
      pipeline_version: 'V9_8',
      persistence_version: VERSION,
      provider: 'DART_KRX_CANONICAL',
      event_ids: eventIds,
      provider_event_ids: [
        event.providerEventId,
      ],
      action_types: [
        event.actionType,
      ],
      factor_status:
        event.factorStatus,
      canonical_adjusted_bar_policy:
        'DO_NOT_DOUBLE_ADJUST',
      production_namespace_contract:
        'IS_VALIDATION_FALSE_WITH_PRODUCTION_APPLIED_FALSE',

      virtual_structural_event:
        event.eventId === null,

      virtual_persistence_policy:
        event.eventId === null
          ? 'DO_NOT_PERSIST_RUN_UNTIL_CANONICAL_EVENT_EXISTS'
          : null,
    },

    is_validation: false,
    production_applied: false,
  };
}

function buildFactorPreview(event) {
  assert(
    event.factorStatus === 'FACTOR_READY',
    `FACTOR_PREVIEW_REQUIRES_FACTOR_READY:${event.providerEventId}`,
  );

  assert(
    typeof event.eventId === 'string' &&
      event.eventId.length > 0,
    `FACTOR_READY_EVENT_ID_REQUIRED:${event.providerEventId}`,
  );

  const {
    eventPriceFactor,
    eventShareFactor,
  } = extractFactorValues(event);

  return {
    adjustment_run_id: null,
    stock_code: event.stockCode,
    effective_date: event.effectiveDate,
    action_event_id: event.eventId,
    action_type: event.actionType,
    event_price_factor: eventPriceFactor,
    event_share_factor: eventShareFactor,

    // Current V9.8 eligible factor-ready set is one event per stock.
    cumulative_price_factor:
      eventPriceFactor,

    cumulative_share_factor:
      eventShareFactor,

    metadata: {
      pipeline_version: 'V9_8',
      persistence_version: VERSION,
      provider_event_id:
        event.providerEventId,
      source_fingerprint:
        event.sourceFingerprint,
      factor_status:
        event.factorStatus,
      cumulative_rule:
        'SINGLE_EVENT_STOCK_CUMULATIVE_EQUALS_EVENT_FACTOR',
      canonical_adjusted_bar_policy:
        'DO_NOT_DOUBLE_ADJUST',
    },

    is_validation: false,
    production_applied: false,
  };
}

function validateRun(row) {
  const issues = [];

  if (!row.stock_code) issues.push('STOCK_CODE_REQUIRED');
  if (!row.version) issues.push('VERSION_REQUIRED');

  if (
    ![
      'RUNNING',
      'READY',
      'BLOCKED_UNSUPPORTED_ACTION',
      'FAILED',
    ].includes(row.status)
  ) {
    issues.push('RUN_STATUS_INVALID');
  }

  for (const field of [
    'event_count',
    'supported_event_count',
    'unsupported_event_count',
    'factor_count',
  ]) {
    if (
      !Number.isInteger(row[field]) ||
      row[field] < 0
    ) {
      issues.push(
        `${field.toUpperCase()}_INVALID`,
      );
    }
  }

  if (row.is_validation !== false) {
    issues.push('RUN_IS_VALIDATION_MUST_BE_FALSE');
  }

  if (row.production_applied !== false) {
    issues.push(
      'RUN_PRODUCTION_APPLIED_MUST_BE_FALSE',
    );
  }

  return issues;
}

function validateFactor(row) {
  const issues = [];

  for (const field of [
    'event_price_factor',
    'event_share_factor',
    'cumulative_price_factor',
    'cumulative_share_factor',
  ]) {
    const value = Number(row[field]);

    if (
      !Number.isFinite(value) ||
      value <= 0
    ) {
      issues.push(
        `${field.toUpperCase()}_NOT_POSITIVE`,
      );
    }
  }

  if (!row.adjustment_run_id) {
    // This is intentionally unresolved in preflight preview.
  }

  if (!row.stock_code) {
    issues.push('FACTOR_STOCK_CODE_REQUIRED');
  }

  if (!row.effective_date) {
    issues.push('FACTOR_EFFECTIVE_DATE_REQUIRED');
  }

  if (!row.action_event_id) {
    issues.push('FACTOR_ACTION_EVENT_ID_REQUIRED');
  }

  if (!row.action_type) {
    issues.push('FACTOR_ACTION_TYPE_REQUIRED');
  }

  if (row.is_validation !== false) {
    issues.push(
      'FACTOR_IS_VALIDATION_MUST_BE_FALSE',
    );
  }

  if (row.production_applied !== false) {
    issues.push(
      'FACTOR_PRODUCTION_APPLIED_MUST_BE_FALSE',
    );
  }

  return issues;
}

function sameStringArray(actual, expectedValue) {
  const arr = Array.isArray(actual)
    ? actual.map(String)
    : [];

  return arr.includes(String(expectedValue));
}

function compareExistingRun(actual, expected, event) {
  const mismatches = [];

  const check = (field, a, b) => {
    if (a !== b) {
      mismatches.push({
        field,
        actual: a ?? null,
        expected: b ?? null,
      });
    }
  };

  check('stock_code', actual.stock_code, expected.stock_code);
  check('version', actual.version, expected.version);
  check('status', actual.status, expected.status);
  check('event_count', actual.event_count, expected.event_count);
  check(
    'supported_event_count',
    actual.supported_event_count,
    expected.supported_event_count,
  );
  check(
    'unsupported_event_count',
    actual.unsupported_event_count,
    expected.unsupported_event_count,
  );
  check(
    'factor_count',
    actual.factor_count,
    expected.factor_count,
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

  if (
    !sameStringArray(
      actual.summary?.provider_event_ids,
      event.providerEventId,
    )
  ) {
    mismatches.push({
      field: 'summary.provider_event_ids',
      actual:
        actual.summary?.provider_event_ids ?? null,
      expectedContains:
        event.providerEventId,
    });
  }

  if (
    !sameStringArray(
      actual.summary?.action_types,
      event.actionType,
    )
  ) {
    mismatches.push({
      field: 'summary.action_types',
      actual:
        actual.summary?.action_types ?? null,
      expectedContains:
        event.actionType,
    });
  }

  return mismatches;
}

function compareExistingFactor(
  actual,
  expected,
  expectedRunId,
) {
  const mismatches = [];

  const check = (field, a, b) => {
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
    expected.stock_code,
  );

  check(
    'effective_date',
    actual.effective_date,
    expected.effective_date,
  );

  check(
    'action_event_id',
    actual.action_event_id,
    expected.action_event_id,
  );

  check(
    'action_type',
    actual.action_type,
    expected.action_type,
  );

  for (const field of [
    'event_price_factor',
    'event_share_factor',
    'cumulative_price_factor',
    'cumulative_share_factor',
  ]) {
    if (
      !approximatelyEqual(
        actual[field],
        expected[field],
      )
    ) {
      mismatches.push({
        field,
        actual: actual[field],
        expected: expected[field],
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

  const finalizationFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-structural-date-finalization-v9-8-10-3-replay-v3.json',
    );

  const outputFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-adjustment-persistence-preflight-v9-8-11-8-1-replay-virtual.json',
    );

  assert(
    fs.existsSync(readinessFile),
    `READINESS_NOT_FOUND:${path.basename(readinessFile)}`,
  );

  assert(
    fs.existsSync(finalizationFile),
    `FINALIZATION_NOT_FOUND:${path.basename(finalizationFile)}`,
  );

  const readiness =
    readJson(readinessFile);

  const finalization =
    readJson(finalizationFile);

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
    finalization.version ===
      FINALIZATION_VERSION,
    `FINALIZATION_VERSION_MISMATCH:${finalization.version}`,
  );

  assert(
    Array.isArray(readiness.eventMap) &&
      readiness.eventMap.length ===
        EXPECTED_EVENTS,
    `READINESS_EVENT_MAP_COUNT:${readiness.eventMap?.length}`,
  );

  assert(
    Array.isArray(finalization.results) &&
      finalization.results.length === 159,
    'FINALIZATION_RESULTS_INVALID',
  );

  const finalById =
    new Map(
      finalization.results.map((row) => [
        String(row.providerEventId),
        row,
      ]),
    );

  const eventMap =
    readiness.eventMap.map((mapped) => {
      const finalRow =
        finalById.get(
          String(mapped.providerEventId),
        );

      assert(
        finalRow,
        `FINAL_ROW_MISSING:${mapped.providerEventId}`,
      );

      return {
        eventId:
          mapped.eventId ?? null,

        providerEventId:
          String(mapped.providerEventId),

        stockCode:
          String(mapped.stockCode),

        actionType:
          mapped.actionType,

        effectiveDate:
          mapped.effectiveDate,

        ratioFrom:
          firstFinite(
            finalRow.canonicalPreview?.ratio_from,
            finalRow.ratioFrom,
            finalRow.ratio_from,
          ),

        ratioTo:
          firstFinite(
            finalRow.canonicalPreview?.ratio_to,
            finalRow.ratioTo,
            finalRow.ratio_to,
          ),

        cashAmount:
          firstFinite(
            finalRow.canonicalPreview?.cash_amount,
            finalRow.cashAmount,
            finalRow.cash_amount,
          ),

        currency:
          finalRow.canonicalPreview?.currency ??
          finalRow.currency ??
          null,

        sourceFingerprint:
          finalRow.canonicalPreview
            ?.source_fingerprint ??
          finalRow.sourceFingerprint ??
          null,

        factorStatus:
          finalRow.factorValidation?.status ??
          mapped.factorDisposition ??
          null,

        factorValidation:
          finalRow.factorValidation ?? null,

        canonicalPreview:
          finalRow.canonicalPreview ?? null,

        persistenceStatus:
          mapped.persistenceStatus,
      };
    });

  const factorReady =
    eventMap.filter(
      (row) =>
        row.factorStatus === 'FACTOR_READY',
    );

  const structural =
    eventMap.filter(
      (row) =>
        row.factorStatus ===
        'STRUCTURAL_BLOCKED',
    );

  assert(
    factorReady.length ===
      EXPECTED_FACTOR_READY,
    `FACTOR_READY_COUNT:${factorReady.length}`,
  );

  assert(
    structural.length === EXPECTED_STRUCTURAL,
    `STRUCTURAL_COUNT:${structural.length}`,
  );

  const virtualStructural =
    structural.filter(
      (row) => row.eventId === null,
    );

  assert(
    virtualStructural.length ===
      EXPECTED_VIRTUAL_STRUCTURAL,
    `VIRTUAL_STRUCTURAL_COUNT:${virtualStructural.length}`,
  );

  assert(
    virtualStructural[0].providerEventId ===
      '20221013000451',
    `VIRTUAL_STRUCTURAL_ID:${virtualStructural[0]?.providerEventId}`,
  );

  assert(
    factorReady.every(
      (row) =>
        typeof row.eventId === 'string' &&
        row.eventId.length > 0,
    ),
    'FACTOR_READY_REAL_UUID_CONTRACT_FAILED',
  );

  const stockCodes =
    [...new Set(
      eventMap.map((row) => row.stockCode),
    )];

  assert(
    stockCodes.length === EXPECTED_EVENTS,
    `MULTI_EVENT_STOCKS_DETECTED:${stockCodes.length}`,
  );

  const runPreview =
    eventMap.map(buildRunPreview);

  const factorPreview =
    factorReady.map(buildFactorPreview);

  const runIssues =
    runPreview
      .map((row, index) => ({
        providerEventId:
          eventMap[index].providerEventId,
        issues: validateRun(row),
      }))
      .filter((row) => row.issues.length > 0);

  const factorIssues =
    factorPreview
      .map((row, index) => ({
        providerEventId:
          factorReady[index].providerEventId,
        issues: validateFactor(row),
      }))
      .filter((row) => row.issues.length > 0);

  const uniqueFactorEventIds =
    new Set(
      factorPreview.map(
        (row) => row.action_event_id,
      ),
    );

  const uniqueFactorStocks =
    new Set(
      factorPreview.map(
        (row) => row.stock_code,
      ),
    );

  assert(
    factorPreview.length ===
      EXPECTED_FACTOR_READY,
    `FACTOR_PREVIEW_COUNT:${factorPreview.length}`,
  );

  assert(
    uniqueFactorEventIds.size ===
      EXPECTED_FACTOR_READY,
    `FACTOR_EVENT_ID_DUPLICATION:${uniqueFactorEventIds.size}`,
  );

  assert(
    uniqueFactorStocks.size ===
      EXPECTED_FACTOR_READY,
    `FACTOR_STOCK_DUPLICATION:${uniqueFactorStocks.size}`,
  );

  const {
    url,
    key,
  } = requireEnv();

  // 1) Stock-universe coverage.
  const stockRows =
    await getArray(
      `${url}/rest/v1/stock_universe_securities` +
        `?select=${encodeURIComponent('stock_code')}`,
      key,
    );

  const existingStocks =
    new Set(
      stockRows.map(
        (row) => String(row.stock_code),
      ),
    );

  const missingStockUniverse =
    stockCodes.filter(
      (stockCode) =>
        !existingStocks.has(stockCode),
    );

  // 2) Existing non-validation adjustment runs.
  const existingRuns =
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
        `&is_validation=eq.false`,
      key,
    );

  // 3) Existing non-validation factors.
  const existingFactors =
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

  const targetStocks =
    new Set(stockCodes);

  const targetEventIds =
    new Set(
      factorReady.map(
        (row) => row.eventId,
      ),
    );

  const sameVersionTargetRuns =
    existingRuns.filter(
      (run) =>
        run.version === RUN_VERSION &&
        targetStocks.has(
          String(run.stock_code),
        ),
    );

  const factorsForTargetEvents =
    existingFactors.filter(
      (row) =>
        targetEventIds.has(
          String(row.action_event_id),
        ),
    );

  const runByStock =
    new Map();

  for (const run of sameVersionTargetRuns) {
    const stockCode =
      String(run.stock_code);

    if (!runByStock.has(stockCode)) {
      runByStock.set(stockCode, []);
    }

    runByStock.get(stockCode).push(run);
  }

  const runMismatches = [];

  if (sameVersionTargetRuns.length > 0) {
    for (let i = 0; i < eventMap.length; i += 1) {
      const event = eventMap[i];
      const expected = runPreview[i];

      const matches =
        runByStock.get(
          event.stockCode,
        ) ?? [];

      if (matches.length !== 1) {
        runMismatches.push({
          providerEventId:
            event.providerEventId,
          stockCode:
            event.stockCode,
          reason:
            'EXPECTED_EXACTLY_ONE_SAME_VERSION_RUN',
          rowCount:
            matches.length,
        });
        continue;
      }

      const mismatches =
        compareExistingRun(
          matches[0],
          expected,
          event,
        );

      if (mismatches.length > 0) {
        runMismatches.push({
          providerEventId:
            event.providerEventId,
          stockCode:
            event.stockCode,
          runId:
            matches[0].id,
          mismatches,
        });
      }
    }
  }

  const factorByEventId =
    new Map();

  for (const factor of factorsForTargetEvents) {
    const eventId =
      String(factor.action_event_id);

    if (!factorByEventId.has(eventId)) {
      factorByEventId.set(eventId, []);
    }

    factorByEventId.get(eventId).push(factor);
  }

  const eventById =
    new Map(
      factorReady.map((event) => [
        event.eventId,
        event,
      ]),
    );

  const runIdByStock =
    new Map();

  for (const run of sameVersionTargetRuns) {
    const stockCode =
      String(run.stock_code);

    if (
      !runIdByStock.has(stockCode) &&
      (runByStock.get(stockCode)?.length ?? 0) === 1
    ) {
      runIdByStock.set(
        stockCode,
        run.id,
      );
    }
  }

  const factorMismatches = [];

  if (factorsForTargetEvents.length > 0) {
    for (
      let i = 0;
      i < factorReady.length;
      i += 1
    ) {
      const event = factorReady[i];
      const expected = factorPreview[i];

      const matches =
        factorByEventId.get(
          event.eventId,
        ) ?? [];

      if (matches.length !== 1) {
        factorMismatches.push({
          providerEventId:
            event.providerEventId,
          actionEventId:
            event.eventId,
          reason:
            'EXPECTED_EXACTLY_ONE_FACTOR_FOR_EVENT',
          rowCount:
            matches.length,
        });
        continue;
      }

      const expectedRunId =
        runIdByStock.get(
          event.stockCode,
        );

      if (!expectedRunId) {
        factorMismatches.push({
          providerEventId:
            event.providerEventId,
          actionEventId:
            event.eventId,
          reason:
            'EXPECTED_RUN_ID_NOT_RESOLVABLE',
        });
        continue;
      }

      const mismatches =
        compareExistingFactor(
          matches[0],
          expected,
          expectedRunId,
        );

      if (mismatches.length > 0) {
        factorMismatches.push({
          providerEventId:
            event.providerEventId,
          factorId:
            matches[0].id,
          mismatches,
        });
      }
    }
  }

  const productionAppliedViolations = [
    ...sameVersionTargetRuns
      .filter(
        (row) =>
          row.production_applied !== false,
      )
      .map((row) => ({
        table:
          'corporate_action_adjustment_runs',
        id: row.id,
        productionApplied:
          row.production_applied,
      })),

    ...factorsForTargetEvents
      .filter(
        (row) =>
          row.production_applied !== false,
      )
      .map((row) => ({
        table:
          'corporate_action_adjustment_factors',
        id: row.id,
        productionApplied:
          row.production_applied,
      })),
  ];

  let persistenceState =
    'PARTIAL_OR_CONFLICTING';

  if (
    sameVersionTargetRuns.length === 0 &&
    factorsForTargetEvents.length === 0
  ) {
    persistenceState = 'EMPTY';
  } else if (
    sameVersionTargetRuns.length === 128 &&
    factorsForTargetEvents.length === 0
  ) {
    persistenceState = 'RUNS_ONLY';
  } else if (
    sameVersionTargetRuns.length === 128 &&
    factorsForTargetEvents.length === 121
  ) {
    persistenceState = 'COMPLETE';
  }

  const blockers = [];

  if (missingStockUniverse.length > 0) {
    blockers.push(
      'MISSING_STOCK_UNIVERSE_ROWS',
    );
  }

  if (runIssues.length > 0) {
    blockers.push(
      'RUN_PREVIEW_CONTRACT_FAILED',
    );
  }

  if (factorIssues.length > 0) {
    blockers.push(
      'FACTOR_PREVIEW_CONTRACT_FAILED',
    );
  }

  if (
    persistenceState ===
    'PARTIAL_OR_CONFLICTING'
  ) {
    blockers.push(
      'PARTIAL_OR_CONFLICTING_PERSISTENCE_STATE',
    );
  }

  if (runMismatches.length > 0) {
    blockers.push(
      'EXISTING_RUN_CANONICAL_MISMATCH',
    );
  }

  if (factorMismatches.length > 0) {
    blockers.push(
      'EXISTING_FACTOR_CANONICAL_MISMATCH',
    );
  }

  if (
    productionAppliedViolations.length > 0
  ) {
    blockers.push(
      'PRODUCTION_APPLIED_CONTRACT_VIOLATION',
    );
  }

  // Even if EMPTY/RUNS_ONLY, the virtual structural run must not be written
  // before the missing canonical event exists. This is a write-policy block,
  // not a factor-pipeline block.
  const virtualWriteGuard = {
    providerEventId:
      virtualStructural[0].providerEventId,
    stockCode:
      virtualStructural[0].stockCode,
    eventId:
      null,
    runPersistenceAllowed:
      false,
    factorPersistenceRelevant:
      false,
    reason:
      'CANONICAL_STRUCTURAL_EVENT_NOT_PERSISTED',
  };

  const factorPipelineReady =
    blockers.every(
      (blocker) =>
        blocker !==
          'FACTOR_PREVIEW_CONTRACT_FAILED' &&
        blocker !==
          'EXISTING_FACTOR_CANONICAL_MISMATCH' &&
        blocker !==
          'MISSING_STOCK_UNIVERSE_ROWS' &&
        blocker !==
          'PRODUCTION_APPLIED_CONTRACT_VIOLATION',
    );

  const status =
    blockers.length === 0
      ? (
          persistenceState === 'COMPLETE'
            ? 'ADJUSTMENT_PERSISTENCE_PREFLIGHT_REUSE_COMPLETE'
            : 'ADJUSTMENT_PERSISTENCE_PREFLIGHT_READY_READ_ONLY'
        )
      : 'ADJUSTMENT_PERSISTENCE_PREFLIGHT_BLOCKED';

  const factorValues =
    factorPreview.flatMap((row) => [
      row.event_price_factor,
      row.event_share_factor,
      row.cumulative_price_factor,
      row.cumulative_share_factor,
    ]).map(Number);

  const report = {
    status,
    version: VERSION,
    runVersion: RUN_VERSION,

    source: {
      readinessVersion:
        readiness.version,
      readinessFingerprint:
        readiness.outputFingerprint ?? null,
      finalizationVersion:
        finalization.version,
      finalizationFingerprint:
        finalization.outputFingerprint ?? null,
    },

    counts: {
      targetEvents:
        eventMap.length,

      factorReadyEvents:
        factorReady.length,

      structuralBlockedEvents:
        structural.length,

      virtualStructuralEvents:
        virtualStructural.length,

      distinctTargetStocks:
        stockCodes.length,

      runPreviewRows:
        runPreview.length,

      factorPreviewRows:
        factorPreview.length,

      missingStockUniverseRows:
        missingStockUniverse.length,

      existingNonValidationRuns:
        existingRuns.length,

      existingNonValidationFactors:
        existingFactors.length,

      sameVersionTargetStockRuns:
        sameVersionTargetRuns.length,

      targetEventExistingFactorRows:
        factorsForTargetEvents.length,

      runMismatchRows:
        runMismatches.length,

      factorMismatchRows:
        factorMismatches.length,

      runIssueRows:
        runIssues.length,

      factorIssueRows:
        factorIssues.length,

      productionAppliedContractViolations:
        productionAppliedViolations.length,

      blockers:
        blockers.length,
    },

    persistenceState,

    factorValueRanges: {
      min:
        factorValues.length
          ? Math.min(...factorValues)
          : null,

      max:
        factorValues.length
          ? Math.max(...factorValues)
          : null,
    },

    factorPipelineReadiness: {
      ready:
        factorPipelineReady,

      all121FactorReadyEventsHaveRealActionEventIds:
        factorReady.every(
          (row) => Boolean(row.eventId),
        ),

      factorPreviewRows:
        factorPreview.length,

      missingFactorReadyEventIds:
        factorReady.filter(
          (row) => !row.eventId,
        ).length,

      virtualStructuralBlocksFactorPipeline:
        false,
    },

    virtualWriteGuard,

    missingStockUniverse,
    runIssues,
    factorIssues,
    runMismatches,
    factorMismatches,
    productionAppliedViolations,
    blockers,

    runPreview,
    factorPreview,

    safety: {
      httpMethodsUsed: ['GET'],
      networkRequests: 3,
      databaseReads: 3,
      databaseWrites: 0,
      runRowsInserted: 0,
      factorRowsInserted: 0,
      postRequests: 0,
      patchRequests: 0,
      deleteRequests: 0,
      syntheticEventUuidsGenerated: 0,
      productionApplied: false,
    },

    nextGate:
      blockers.length > 0
        ? 'STOP_AND_REVIEW'
        : persistenceState === 'COMPLETE'
          ? 'BUILD_V9_8_11_9_READ_ONLY_RESUME_AUDIT'
          : 'STOP_BEFORE_WRITE_AND_AUDIT_V9_8_11_9_RESUME_STATE',

    outputFile:
      'logs/opendart-corporate-action-adjustment-persistence-preflight-v9-8-11-8-1-replay-virtual.json',
  };

  report.outputFingerprint = sha256(
    JSON.stringify({
      version: report.version,
      runVersion: report.runVersion,
      source: report.source,
      persistenceState:
        report.persistenceState,
      runPreview:
        runPreview.map((row) => [
          row.stock_code,
          row.version,
          row.status,
          row.event_count,
          row.supported_event_count,
          row.unsupported_event_count,
          row.factor_count,
          row.summary?.provider_event_ids?.[0] ?? null,
        ]),
      factorPreview:
        factorPreview.map((row) => [
          row.stock_code,
          row.effective_date,
          row.action_event_id,
          row.action_type,
          row.event_price_factor,
          row.event_share_factor,
          row.cumulative_price_factor,
          row.cumulative_share_factor,
        ]),
    }),
  );

  atomicSaveJson(outputFile, report);

  console.log(
    JSON.stringify(
      {
        status:
          report.status,

        version:
          report.version,

        runVersion:
          RUN_VERSION,

        targetEvents:
          report.counts.targetEvents,

        factorReadyEvents:
          report.counts.factorReadyEvents,

        structuralBlockedEvents:
          report.counts.structuralBlockedEvents,

        virtualStructuralEvents:
          report.counts.virtualStructuralEvents,

        runPreviewRows:
          report.counts.runPreviewRows,

        factorPreviewRows:
          report.counts.factorPreviewRows,

        missingStockUniverseRows:
          report.counts.missingStockUniverseRows,

        sameVersionTargetStockRuns:
          report.counts.sameVersionTargetStockRuns,

        targetEventExistingFactorRows:
          report.counts.targetEventExistingFactorRows,

        runMismatchRows:
          report.counts.runMismatchRows,

        factorMismatchRows:
          report.counts.factorMismatchRows,

        runIssueRows:
          report.counts.runIssueRows,

        factorIssueRows:
          report.counts.factorIssueRows,

        productionAppliedContractViolations:
          report.counts.productionAppliedContractViolations,

        persistenceState:
          report.persistenceState,

        factorPipelineReadiness:
          report.factorPipelineReadiness,

        virtualWriteGuard:
          report.virtualWriteGuard,

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
    report.status ===
    'ADJUSTMENT_PERSISTENCE_PREFLIGHT_BLOCKED'
  ) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status:
          'ADJUSTMENT_PERSISTENCE_PREFLIGHT_FAILED',

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
