'use strict';

// V9.7.20.2 read-only exact live-state inspector.
// Compares current live validation runs/factors against v9.7.20 expected rows,
// including summary/metadata differences.
//
// No writes.
//
// Run:
//   node --env-file=.env.local .\scripts\v9720-2.cjs

const crypto = require('node:crypto');

const PROVIDER = 'DART_KRX_CANONICAL';
const RUN_VERSION = 'CORPORATE_ACTION_ADJUSTMENT_V9_7_19_VALIDATION';
const CONTRACT_VERSION = 'V9_7_20_CONTROLLED_VALIDATION_ADJUSTMENT_PERSISTENCE';

const SUPPORTED = new Set([
  'STOCK_SPLIT', 'REVERSE_SPLIT', 'STOCK_DIVIDEND', 'CASH_DIVIDEND'
]);
const STRUCTURAL = new Set(['MERGER', 'SPIN_OFF']);

function env() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('SUPABASE_URL_REQUIRED');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY_REQUIRED');
  return { url: String(url).replace(/\/+$/, ''), key: String(key) };
}

async function request(url, key) {
  const r = await fetch(url, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json'
    }
  });
  const t = await r.text();
  let b;
  try { b = t ? JSON.parse(t) : []; }
  catch { throw new Error('INVALID_JSON'); }
  if (!r.ok) throw new Error(String(b?.code || `HTTP_${r.status}`));
  if (!Array.isArray(b)) throw new Error('EXPECTED_ARRAY');
  return b;
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round(v) {
  return Number(Number(v).toPrecision(15));
}

function uuid(input) {
  const b = crypto.createHash('sha256').update(input).digest().subarray(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}

async function priorBar(base, key, stockCode, effectiveDate) {
  return request(
    `${base}/rest/v1/market_daily_bars` +
    `?select=${encodeURIComponent('stock_code,trading_date,close_price,source,adjusted_price')}` +
    `&stock_code=eq.${encodeURIComponent(stockCode)}` +
    `&trading_date=lt.${encodeURIComponent(effectiveDate)}` +
    `&order=trading_date.desc&limit=1`,
    key
  );
}

async function factorFor(e, base, key) {
  const rf = num(e.ratio_from);
  const rt = num(e.ratio_to);
  const cash = num(e.cash_amount);

  if (['STOCK_SPLIT','REVERSE_SPLIT','STOCK_DIVIDEND'].includes(e.action_type)) {
    return {
      event_price_factor: round(rf / rt),
      event_share_factor: round(rt / rf),
      metadata: {
        factor_source: 'EXPLICIT_EVENT_RATIO',
        ratio_from: rf,
        ratio_to: rt,
        ratio_contract: 'PRE_ACTION_UNITS_TO_POST_ACTION_UNITS',
        validation_contract_version: CONTRACT_VERSION,
        cumulative_rule: 'SINGLE_EVENT_GROUP_CUMULATIVE_EQUALS_EVENT_FACTOR'
      }
    };
  }

  if (e.action_type === 'CASH_DIVIDEND') {
    const bars = await priorBar(base, key, e.stock_code, e.effective_date);
    if (bars.length !== 1) throw new Error('CASH_REFERENCE_BAR_REQUIRED');
    const p = num(bars[0].close_price);
    return {
      event_price_factor: round((p - cash) / p),
      event_share_factor: 1,
      metadata: {
        factor_source: 'LATEST_PRIOR_MARKET_CLOSE',
        reference_trading_date: bars[0].trading_date,
        reference_close_price: p,
        reference_source: bars[0].source,
        reference_adjusted_price_flag: bars[0].adjusted_price,
        cash_amount_per_share: cash,
        currency: e.currency || 'KRW',
        validation_contract_version: CONTRACT_VERSION,
        cumulative_rule: 'SINGLE_EVENT_GROUP_CUMULATIVE_EQUALS_EVENT_FACTOR'
      }
    };
  }

  return null;
}

function stable(v) {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object') {
    return Object.keys(v).sort().reduce((o, k) => {
      o[k] = stable(v[k]);
      return o;
    }, {});
  }
  return v;
}

function equal(a, b) {
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}

function diffObject(actual, expected, prefix = '') {
  const out = [];
  const keys = new Set([
    ...Object.keys(actual || {}),
    ...Object.keys(expected || {})
  ]);

  for (const k of [...keys].sort()) {
    const p = prefix ? `${prefix}.${k}` : k;
    const av = actual?.[k];
    const ev = expected?.[k];

    if (
      av && ev &&
      typeof av === 'object' &&
      typeof ev === 'object' &&
      !Array.isArray(av) &&
      !Array.isArray(ev)
    ) {
      out.push(...diffObject(av, ev, p));
    } else if (!equal(av, ev)) {
      out.push({ field: p, actual: av ?? null, expected: ev ?? null });
    }
  }
  return out;
}

async function main() {
  const { url, key } = env();

  const events = await request(
    `${url}/rest/v1/corporate_action_events` +
    `?select=${encodeURIComponent(
      'id,stock_code,action_type,effective_date,ratio_from,ratio_to,cash_amount,currency,provider_event_id'
    )}` +
    `&provider=eq.${encodeURIComponent(PROVIDER)}` +
    `&is_validation=eq.true&production_applied=eq.false` +
    `&order=stock_code.asc,effective_date.asc,provider_event_id.asc`,
    key
  );

  if (events.length !== 15) throw new Error('EXPECTED_15_EVENTS');

  const expectedRuns = [];
  const expectedFactors = [];

  for (const e of events) {
    const runIdentity = `${RUN_VERSION}|${e.stock_code}|VALIDATION|${e.id}`;
    const runId = uuid(runIdentity);

    if (SUPPORTED.has(e.action_type)) {
      expectedRuns.push({
        id: runId,
        stock_code: e.stock_code,
        version: RUN_VERSION,
        status: 'READY',
        event_count: 1,
        supported_event_count: 1,
        unsupported_event_count: 0,
        factor_count: 1,
        summary: {
          validation_contract_version: CONTRACT_VERSION,
          deterministic_run_identity: runIdentity,
          event_ids: [e.id],
          provider_event_ids: [e.provider_event_id],
          action_types: [e.action_type],
          single_event_cumulative_rule: 'CUMULATIVE_EQUALS_EVENT_FACTOR',
          multi_event_accumulation_policy: 'NOT_PROVEN'
        },
        is_validation: true,
        production_applied: false,
        finished_at: null,
        error_message: null
      });

      const f = await factorFor(e, url, key);
      expectedFactors.push({
        adjustment_run_id: runId,
        stock_code: e.stock_code,
        effective_date: e.effective_date,
        action_event_id: e.id,
        action_type: e.action_type,
        event_price_factor: f.event_price_factor,
        event_share_factor: f.event_share_factor,
        cumulative_price_factor: f.event_price_factor,
        cumulative_share_factor: f.event_share_factor,
        metadata: f.metadata,
        is_validation: true,
        production_applied: false
      });
    } else if (STRUCTURAL.has(e.action_type)) {
      expectedRuns.push({
        id: runId,
        stock_code: e.stock_code,
        version: RUN_VERSION,
        status: 'BLOCKED_UNSUPPORTED_ACTION',
        event_count: 1,
        supported_event_count: 0,
        unsupported_event_count: 1,
        factor_count: 0,
        summary: {
          validation_contract_version: CONTRACT_VERSION,
          deterministic_run_identity: runIdentity,
          event_ids: [e.id],
          provider_event_ids: [e.provider_event_id],
          action_types: [e.action_type],
          block_reason:
            e.action_type === 'MERGER'
              ? 'MERGER_SECURITY_CONTINUITY_POLICY_REQUIRED'
              : 'SPIN_OFF_VALUE_ALLOCATION_POLICY_REQUIRED',
          factor_rows_suppressed: true,
          multi_event_accumulation_policy: 'NOT_PROVEN'
        },
        is_validation: true,
        production_applied: false,
        finished_at: null,
        error_message: null
      });
    } else {
      throw new Error('UNEXPECTED_ACTION_TYPE');
    }
  }

  const runIds = expectedRuns.map(x => x.id).join(',');

  const liveRuns = await request(
    `${url}/rest/v1/corporate_action_adjustment_runs` +
    `?select=${encodeURIComponent(
      'id,stock_code,version,status,event_count,supported_event_count,unsupported_event_count,factor_count,summary,is_validation,production_applied,started_at,finished_at,error_message'
    )}` +
    `&id=in.(${runIds})&order=stock_code.asc`,
    key
  );

  const liveFactors = await request(
    `${url}/rest/v1/corporate_action_adjustment_factors` +
    `?select=${encodeURIComponent(
      'adjustment_run_id,stock_code,effective_date,action_event_id,action_type,event_price_factor,event_share_factor,cumulative_price_factor,cumulative_share_factor,metadata,is_validation,production_applied,created_at'
    )}` +
    `&adjustment_run_id=in.(${runIds})&order=stock_code.asc,effective_date.asc`,
    key
  );

  const runMap = new Map(liveRuns.map(r => [r.id, r]));
  const factorKey = r => `${r.adjustment_run_id}|${r.action_event_id}`;
  const factorMap = new Map(liveFactors.map(r => [factorKey(r), r]));

  const runDiffs = [];
  let exactRuns = 0;

  for (const e of expectedRuns) {
    const live = runMap.get(e.id);
    if (!live) {
      runDiffs.push({ stock_code: e.stock_code, id: e.id, state: 'MISSING' });
      continue;
    }

    const comparable = {
      id: live.id,
      stock_code: live.stock_code,
      version: live.version,
      status: live.status,
      event_count: Number(live.event_count),
      supported_event_count: Number(live.supported_event_count),
      unsupported_event_count: Number(live.unsupported_event_count),
      factor_count: Number(live.factor_count),
      summary: live.summary || {},
      is_validation: live.is_validation,
      production_applied: live.production_applied,
      finished_at: live.finished_at ?? null,
      error_message: live.error_message ?? null
    };

    const diffs = diffObject(comparable, e);
    if (!diffs.length) exactRuns++;
    else {
      runDiffs.push({
        stock_code: e.stock_code,
        id: e.id,
        state: 'DIFF',
        started_at: live.started_at,
        differences: diffs
      });
    }
  }

  const factorDiffs = [];
  let exactFactors = 0;

  for (const e of expectedFactors) {
    const live = factorMap.get(factorKey(e));
    if (!live) {
      factorDiffs.push({
        stock_code: e.stock_code,
        key: factorKey(e),
        state: 'MISSING'
      });
      continue;
    }

    const comparable = {
      adjustment_run_id: live.adjustment_run_id,
      stock_code: live.stock_code,
      effective_date: live.effective_date,
      action_event_id: live.action_event_id,
      action_type: live.action_type,
      event_price_factor: Number(live.event_price_factor),
      event_share_factor: Number(live.event_share_factor),
      cumulative_price_factor: Number(live.cumulative_price_factor),
      cumulative_share_factor: Number(live.cumulative_share_factor),
      metadata: live.metadata || {},
      is_validation: live.is_validation,
      production_applied: live.production_applied
    };

    const diffs = diffObject(comparable, e);
    if (!diffs.length) exactFactors++;
    else {
      factorDiffs.push({
        stock_code: e.stock_code,
        key: factorKey(e),
        state: 'DIFF',
        created_at: live.created_at,
        differences: diffs
      });
    }
  }

  const unexpectedFactors = liveFactors.filter(
    r => !expectedFactors.some(e => factorKey(e) === factorKey(r))
  );

  console.log(JSON.stringify({
    status: 'LIVE_ADJUSTMENT_STATE_INSPECTED',
    expectedRuns: expectedRuns.length,
    liveRuns: liveRuns.length,
    exactRuns,
    runDifferences: runDiffs.length,
    runDiffRows: runDiffs,
    expectedFactors: expectedFactors.length,
    liveFactors: liveFactors.length,
    exactFactors,
    factorDifferences: factorDiffs.length,
    factorDiffRows: factorDiffs,
    unexpectedFactors: unexpectedFactors.length,
    writesPerformed: 0
  }, null, 2));
}

main().catch(e => {
  console.error(String(e?.message || e).replace(/[^A-Za-z0-9_]/g, '_').toUpperCase());
  process.exitCode = 1;
});
