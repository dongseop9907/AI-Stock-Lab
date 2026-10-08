'use strict';

// V9.7.20.1 read-only live run conflict inspector.
// No writes.
//
// Run:
//   node --env-file=.env.local .\scripts\v9720-1.cjs

const crypto = require('node:crypto');

const PROVIDER = 'DART_KRX_CANONICAL';
const RUN_VERSION = 'CORPORATE_ACTION_ADJUSTMENT_V9_7_19_VALIDATION';

function env() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('SUPABASE_URL_REQUIRED');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY_REQUIRED');
  return { url: url.replace(/\/+$/, ''), key };
}

async function getArray(url, key) {
  const r = await fetch(url, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json'
    }
  });
  const t = await r.text();
  const b = t ? JSON.parse(t) : [];
  if (!r.ok) throw new Error(String(b?.code || `HTTP_${r.status}`));
  if (!Array.isArray(b)) throw new Error('EXPECTED_ARRAY');
  return b;
}

function uuid(input) {
  const b = crypto.createHash('sha256').update(input).digest().subarray(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}

async function main() {
  const { url, key } = env();

  const events = await getArray(
    `${url}/rest/v1/corporate_action_events` +
    `?select=${encodeURIComponent('id,stock_code,action_type,effective_date,provider_event_id,status,is_validation,production_applied')}` +
    `&provider=eq.${encodeURIComponent(PROVIDER)}` +
    `&is_validation=eq.true&production_applied=eq.false` +
    `&order=stock_code.asc,effective_date.asc,provider_event_id.asc`,
    key
  );

  if (events.length !== 15) throw new Error('EXPECTED_15_EVENTS');

  const expected = events.map(e => {
    const identity = `${RUN_VERSION}|${e.stock_code}|VALIDATION|${e.id}`;
    const supported = ['STOCK_SPLIT','REVERSE_SPLIT','STOCK_DIVIDEND','CASH_DIVIDEND'].includes(e.action_type);

    return {
      id: uuid(identity),
      stock_code: e.stock_code,
      version: RUN_VERSION,
      expected_status: supported ? 'READY' : 'BLOCKED_UNSUPPORTED_ACTION',
      expected_event_count: 1,
      expected_supported_event_count: supported ? 1 : 0,
      expected_unsupported_event_count: supported ? 0 : 1,
      expected_factor_count: supported ? 1 : 0,
      expected_is_validation: true,
      expected_production_applied: false,
      event_id: e.id,
      action_type: e.action_type,
      deterministic_run_identity: identity
    };
  });

  const ids = expected.map(x => x.id).join(',');
  const live = await getArray(
    `${url}/rest/v1/corporate_action_adjustment_runs` +
    `?select=${encodeURIComponent('id,stock_code,version,status,event_count,supported_event_count,unsupported_event_count,factor_count,summary,is_validation,production_applied,started_at,finished_at,error_message')}` +
    `&id=in.(${ids})&order=stock_code.asc`,
    key
  );

  const liveById = new Map(live.map(x => [x.id, x]));
  const comparisons = expected.map(e => {
    const l = liveById.get(e.id);
    if (!l) return { stock_code: e.stock_code, id: e.id, state: 'MISSING' };

    const diffs = {};
    const check = (name, actual, wanted) => {
      if (actual !== wanted) diffs[name] = { actual, expected: wanted };
    };

    check('stock_code', l.stock_code, e.stock_code);
    check('version', l.version, e.version);
    check('status', l.status, e.expected_status);
    check('event_count', Number(l.event_count), e.expected_event_count);
    check('supported_event_count', Number(l.supported_event_count), e.expected_supported_event_count);
    check('unsupported_event_count', Number(l.unsupported_event_count), e.expected_unsupported_event_count);
    check('factor_count', Number(l.factor_count), e.expected_factor_count);
    check('is_validation', l.is_validation, true);
    check('production_applied', l.production_applied, false);

    const summary = l.summary || {};
    check(
      'summary.validation_contract_version',
      summary.validation_contract_version ?? null,
      'V9_7_20_CONTROLLED_VALIDATION_ADJUSTMENT_PERSISTENCE'
    );
    check(
      'summary.deterministic_run_identity',
      summary.deterministic_run_identity ?? null,
      e.deterministic_run_identity
    );

    return {
      stock_code: e.stock_code,
      action_type: e.action_type,
      id: e.id,
      state: Object.keys(diffs).length ? 'CONFLICT' : 'CORE_MATCH',
      diffs,
      live_started_at: l.started_at,
      live_finished_at: l.finished_at,
      live_error_message: l.error_message,
      live_summary: l.summary
    };
  });

  const conflicts = comparisons.filter(x => x.state === 'CONFLICT');
  const coreMatches = comparisons.filter(x => x.state === 'CORE_MATCH');
  const missing = comparisons.filter(x => x.state === 'MISSING');

  console.log(JSON.stringify({
    status: conflicts.length ? 'LIVE_RUN_CONFLICTS_IDENTIFIED' : 'NO_CORE_RUN_CONFLICTS',
    expectedRuns: expected.length,
    liveRowsFound: live.length,
    coreMatches: coreMatches.length,
    conflicts: conflicts.length,
    missing: missing.length,
    conflictRows: conflicts,
    coreMatchRows: coreMatches.map(x => ({
      stock_code: x.stock_code,
      action_type: x.action_type,
      id: x.id,
      started_at: x.live_started_at
    })),
    writesPerformed: 0
  }, null, 2));
}

main().catch(e => {
  console.error(String(e?.message || e).replace(/[^A-Za-z0-9_]/g, '_').toUpperCase());
  process.exitCode = 1;
});
