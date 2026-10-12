'use strict';

// V9.7.19 read-only per-stock validation run + factor preview.
//
// Current sample invariant:
//   - 15 validation events
//   - 15 distinct stock_code groups
//   - exactly 1 event per stock
//   - 11 supported factor events
//   - 4 structural exclusions
//
// Because each stock has exactly one event in this validation sample:
//   cumulative_price_factor = event_price_factor
//   cumulative_share_factor = event_share_factor
//
// IMPORTANT:
//   This does NOT define the future multi-event accumulation order.
//   Multi-event production support remains a separate contract gate.
//
// No DB writes.
//
// Run:
//   node --env-file=.env.local .\scripts\v9719.cjs

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION = 'V9_7_19_PER_STOCK_RUN_FACTOR_PREVIEW';
const RUN_VERSION = 'CORPORATE_ACTION_ADJUSTMENT_V9_7_19_VALIDATION';
const PROVIDER = 'DART_KRX_CANONICAL';

const EXPECTED_EVENTS = 15;
const EXPECTED_STOCK_GROUPS = 15;
const EXPECTED_READY_RUNS = 11;
const EXPECTED_BLOCKED_RUNS = 4;
const EXPECTED_FACTOR_ROWS = 11;

const SUPPORTED = new Set([
  'STOCK_SPLIT',
  'REVERSE_SPLIT',
  'STOCK_DIVIDEND',
  'CASH_DIVIDEND'
]);

const STRUCTURAL = new Set([
  'MERGER',
  'SPIN_OFF'
]);

function saveJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function requireEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('SUPABASE_URL_REQUIRED');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY_REQUIRED');
  return { url: String(url).replace(/\/+$/, ''), key: String(key) };
}

async function getArray(url, key) {
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json'
    }
  });

  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error('INVALID_SUPABASE_JSON_RESPONSE');
  }

  if (!res.ok) {
    const code = body?.code || `HTTP_${res.status}`;
    throw new Error(
      String(code).replace(/[^A-Za-z0-9_]/g, '_').toUpperCase()
    );
  }

  if (!Array.isArray(body)) throw new Error('EXPECTED_ARRAY_RESPONSE');
  return body;
}

async function readEvents(base, key) {
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
    'is_validation',
    'production_applied'
  ].join(',');

  return getArray(
    `${base}/rest/v1/corporate_action_events` +
    `?select=${encodeURIComponent(select)}` +
    `&provider=eq.${encodeURIComponent(PROVIDER)}` +
    `&is_validation=eq.true` +
    `&production_applied=eq.false` +
    `&order=stock_code.asc,effective_date.asc,provider_event_id.asc`,
    key
  );
}

async function readPriorBar(base, key, stockCode, effectiveDate) {
  const select =
    'stock_code,trading_date,close_price,source,adjusted_price';

  return getArray(
    `${base}/rest/v1/market_daily_bars` +
    `?select=${encodeURIComponent(select)}` +
    `&stock_code=eq.${encodeURIComponent(stockCode)}` +
    `&trading_date=lt.${encodeURIComponent(effectiveDate)}` +
    `&order=trading_date.desc&limit=1`,
    key
  );
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function roundFactor(v) {
  return Number(Number(v).toPrecision(15));
}

function deterministicUuid(input) {
  const bytes = crypto.createHash('sha256').update(input).digest().subarray(0, 16);

  // RFC-4122 shaped deterministic UUID.
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const h = bytes.toString('hex');
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    h.slice(12, 16),
    h.slice(16, 20),
    h.slice(20)
  ].join('-');
}

function groupEvents(events) {
  const groups = new Map();

  for (const e of events) {
    if (!groups.has(e.stock_code)) groups.set(e.stock_code, []);
    groups.get(e.stock_code).push(e);
  }

  return [...groups.entries()]
    .map(([stockCode, rows]) => ({
      stockCode,
      events: rows.slice().sort((a, b) =>
        `${a.effective_date}|${a.provider_event_id}`
          .localeCompare(`${b.effective_date}|${b.provider_event_id}`)
      )
    }))
    .sort((a, b) => a.stockCode.localeCompare(b.stockCode));
}

async function computeFactor(event, base, key) {
  const rf = num(event.ratio_from);
  const rt = num(event.ratio_to);
  const cash = num(event.cash_amount);

  if (
    event.action_type === 'STOCK_SPLIT' ||
    event.action_type === 'REVERSE_SPLIT' ||
    event.action_type === 'STOCK_DIVIDEND'
  ) {
    if (!(rf > 0) || !(rt > 0)) {
      throw new Error('RATIO_EVENT_MISSING_POSITIVE_RATIO');
    }

    return {
      eventPriceFactor: roundFactor(rf / rt),
      eventShareFactor: roundFactor(rt / rf),
      metadata: {
        factor_source: 'EXPLICIT_EVENT_RATIO',
        ratio_from: rf,
        ratio_to: rt,
        ratio_contract: 'PRE_ACTION_UNITS_TO_POST_ACTION_UNITS'
      }
    };
  }

  if (event.action_type === 'CASH_DIVIDEND') {
    const bars = await readPriorBar(
      base,
      key,
      event.stock_code,
      event.effective_date
    );

    if (bars.length !== 1) throw new Error('CASH_REFERENCE_BAR_REQUIRED');

    const reference = bars[0];
    const p = num(reference.close_price);

    if (!(cash >= 0) || !(p > cash)) {
      throw new Error('INVALID_CASH_REFERENCE_FACTOR_INPUT');
    }

    return {
      eventPriceFactor: roundFactor((p - cash) / p),
      eventShareFactor: 1,
      metadata: {
        factor_source: 'LATEST_PRIOR_MARKET_CLOSE',
        reference_trading_date: reference.trading_date,
        reference_close_price: p,
        reference_source: reference.source,
        reference_adjusted_price_flag: reference.adjusted_price,
        cash_amount_per_share: cash,
        currency: event.currency || 'KRW'
      }
    };
  }

  throw new Error('FACTOR_REQUESTED_FOR_UNSUPPORTED_ACTION');
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const args = process.argv.slice(2);

  if (args.some(a => !a.startsWith('--output='))) {
    throw new Error('UNKNOWN_OPTION');
  }

  const outputArg = args.find(a => a.startsWith('--output='));
  const outputFile = outputArg
    ? path.resolve(outputArg.slice('--output='.length))
    : path.join(
        root,
        'logs',
        'adjustment-per-stock-run-factor-preview-v9-7-19.json'
      );

  const { url, key } = requireEnv();
  const events = await readEvents(url, key);

  if (events.length !== EXPECTED_EVENTS) {
    throw new Error('EXPECTED_15_VALIDATION_EVENTS');
  }

  for (const e of events) {
    if (
      e.provider !== PROVIDER ||
      e.status !== 'RECORDED' ||
      e.is_validation !== true ||
      e.production_applied !== false
    ) {
      throw new Error('INVALID_EVENT_LIFECYCLE_STATE');
    }
  }

  const groups = groupEvents(events);

  if (groups.length !== EXPECTED_STOCK_GROUPS) {
    throw new Error('EXPECTED_15_STOCK_GROUPS');
  }

  if (groups.some(g => g.events.length !== 1)) {
    throw new Error('MULTI_EVENT_GROUP_REQUIRES_SEPARATE_ACCUMULATION_CONTRACT');
  }

  const runRows = [];
  const factorRows = [];

  for (const group of groups) {
    const event = group.events[0];

    const eventSetKey = group.events
      .map(e => e.id)
      .sort()
      .join(',');

    const runIdentity =
      `${RUN_VERSION}|${group.stockCode}|VALIDATION|${eventSetKey}`;

    const runId = deterministicUuid(runIdentity);

    if (SUPPORTED.has(event.action_type)) {
      const factor = await computeFactor(event, url, key);

      runRows.push({
        id: runId,
        stock_code: group.stockCode,
        version: RUN_VERSION,
        status: 'READY',
        event_count: 1,
        supported_event_count: 1,
        unsupported_event_count: 0,
        factor_count: 1,
        summary: {
          validation_contract_version: VERSION,
          deterministic_run_identity: runIdentity,
          event_ids: [event.id],
          provider_event_ids: [event.provider_event_id],
          action_types: [event.action_type],
          single_event_cumulative_rule:
            'CUMULATIVE_EQUALS_EVENT_FACTOR',
          multi_event_accumulation_policy:
            'NOT_PROVEN_IN_V9_7_19'
        },
        is_validation: true,
        production_applied: false
      });

      factorRows.push({
        adjustment_run_id: runId,
        stock_code: event.stock_code,
        effective_date: event.effective_date,
        action_event_id: event.id,
        action_type: event.action_type,
        event_price_factor: factor.eventPriceFactor,
        event_share_factor: factor.eventShareFactor,
        cumulative_price_factor: factor.eventPriceFactor,
        cumulative_share_factor: factor.eventShareFactor,
        metadata: {
          ...factor.metadata,
          validation_contract_version: VERSION,
          cumulative_rule:
            'SINGLE_EVENT_GROUP_CUMULATIVE_EQUALS_EVENT_FACTOR'
        },
        is_validation: true,
        production_applied: false
      });

      continue;
    }

    if (STRUCTURAL.has(event.action_type)) {
      runRows.push({
        id: runId,
        stock_code: group.stockCode,
        version: RUN_VERSION,
        status: 'BLOCKED_UNSUPPORTED_ACTION',
        event_count: 1,
        supported_event_count: 0,
        unsupported_event_count: 1,
        factor_count: 0,
        summary: {
          validation_contract_version: VERSION,
          deterministic_run_identity: runIdentity,
          event_ids: [event.id],
          provider_event_ids: [event.provider_event_id],
          action_types: [event.action_type],
          block_reason:
            event.action_type === 'MERGER'
              ? 'MERGER_SECURITY_CONTINUITY_POLICY_REQUIRED'
              : 'SPIN_OFF_VALUE_ALLOCATION_POLICY_REQUIRED',
          factor_rows_suppressed: true
        },
        is_validation: true,
        production_applied: false
      });

      continue;
    }

    throw new Error('UNEXPECTED_ACTION_TYPE');
  }

  const readyRuns =
    runRows.filter(r => r.status === 'READY').length;
  const blockedRuns =
    runRows.filter(r => r.status === 'BLOCKED_UNSUPPORTED_ACTION').length;

  const uniqueRunIds = new Set(runRows.map(r => r.id));
  const uniqueFactorIdentities = new Set(
    factorRows.map(r => `${r.adjustment_run_id}|${r.action_event_id}`)
  );

  const factorPositive = factorRows.every(r =>
    r.event_price_factor > 0 &&
    r.event_share_factor > 0 &&
    r.cumulative_price_factor > 0 &&
    r.cumulative_share_factor > 0
  );

  const cumulativeEqualsEvent = factorRows.every(r =>
    r.event_price_factor === r.cumulative_price_factor &&
    r.event_share_factor === r.cumulative_share_factor
  );

  const ok =
    runRows.length === 15 &&
    readyRuns === EXPECTED_READY_RUNS &&
    blockedRuns === EXPECTED_BLOCKED_RUNS &&
    factorRows.length === EXPECTED_FACTOR_ROWS &&
    uniqueRunIds.size === runRows.length &&
    uniqueFactorIdentities.size === factorRows.length &&
    factorPositive &&
    cumulativeEqualsEvent;

  const report = {
    version: VERSION,
    status: ok
      ? 'PER_STOCK_VALIDATION_RUN_FACTOR_PREVIEW_PROVEN'
      : 'PER_STOCK_VALIDATION_RUN_FACTOR_PREVIEW_REVIEW_REQUIRED',
    summary: {
      validationEvents: events.length,
      stockGroups: groups.length,
      runRows: runRows.length,
      readyRuns,
      blockedUnsupportedRuns: blockedRuns,
      factorRows: factorRows.length,
      uniqueRunIds: uniqueRunIds.size,
      uniqueFactorIdentities: uniqueFactorIdentities.size,
      allFactorsPositive: factorPositive,
      cumulativeEqualsEventForAllCurrentFactors:
        cumulativeEqualsEvent
    },
    runRows,
    factorRows,
    contract: {
      runGranularity: 'ONE_VALIDATION_RUN_PER_STOCK_CODE',
      runIdempotency:
        'DETERMINISTIC_UUID_FROM_VERSION_STOCK_CODE_VALIDATION_EVENT_SET',
      supportedRunStatus: 'READY',
      structuralRunStatus: 'BLOCKED_UNSUPPORTED_ACTION',
      factorIdentity:
        'UNIQUE(adjustment_run_id, action_event_id)',
      currentSampleCumulativeRule:
        'EACH_STOCK_HAS_ONE_EVENT_SO_CUMULATIVE_EQUALS_EVENT_FACTOR',
      futureMultiEventRule:
        'NOT_YET_PROVEN_DO_NOT_PROMOTE_TO_PRODUCTION'
    },
    safety: {
      databaseConnected: true,
      httpMethodsUsed: ['GET'],
      writesPerformed: 0,
      adjustmentRunsInserted: 0,
      adjustmentFactorsInserted: 0,
      eventRowsUpdated: 0,
      productionAppliedRows: 0,
      coveragePromoted: false
    },
    nextGate: ok
      ? 'BUILD_CONTROLLED_DRY_RUN_AND_APPLY_FOR_15_VALIDATION_RUNS_AND_11_FACTORS'
      : 'REVIEW_PER_STOCK_RUN_OR_FACTOR_MAPPING'
  };

  saveJson(outputFile, report);

  console.log(JSON.stringify({
    status: report.status,
    validationEvents: report.summary.validationEvents,
    stockGroups: report.summary.stockGroups,
    runRows: report.summary.runRows,
    readyRuns: report.summary.readyRuns,
    blockedUnsupportedRuns:
      report.summary.blockedUnsupportedRuns,
    factorRows: report.summary.factorRows,
    uniqueRunIds: report.summary.uniqueRunIds,
    uniqueFactorIdentities:
      report.summary.uniqueFactorIdentities,
    allFactorsPositive:
      report.summary.allFactorsPositive,
    cumulativeEqualsEventForAllCurrentFactors:
      report.summary.cumulativeEqualsEventForAllCurrentFactors,
    writesPerformed: 0,
    adjustmentRunsInserted: 0,
    adjustmentFactorsInserted: 0,
    coveragePromoted: false
  }, null, 2));

  console.log(
    'Upload only this report (never upload .env files): ' + outputFile
  );

  if (!ok) process.exitCode = 2;
}

main().catch(err => {
  console.error(
    String(err?.message || err)
      .replace(/[^A-Za-z0-9_]/g, '_')
      .toUpperCase()
  );
  process.exitCode = 1;
});
