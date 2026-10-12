'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VERSION = 'V9_7_17_FULL_15_EVENT_FACTOR_PREVIEW';
const EVENT_TABLE = 'corporate_action_events';
const BAR_TABLE = 'market_daily_bars';
const PROVIDER = 'DART_KRX_CANONICAL';

function saveJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function env() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('SUPABASE_URL_REQUIRED');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY_REQUIRED');
  return { url: url.replace(/\/+$/, ''), key };
}

async function getArray(url, key) {
  const res = await fetch(url, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json'
    }
  });
  const body = await res.json();
  if (!res.ok) throw new Error(String(body?.code || `HTTP_${res.status}`));
  if (!Array.isArray(body)) throw new Error('EXPECTED_ARRAY_RESPONSE');
  return body;
}

async function readEvents(base, key) {
  const select = [
    'id','stock_code','action_type','effective_date','ratio_from','ratio_to',
    'cash_amount','currency','provider','provider_event_id','source_fingerprint',
    'status','is_validation','production_applied'
  ].join(',');
  return getArray(
    `${base}/rest/v1/${EVENT_TABLE}` +
    `?select=${encodeURIComponent(select)}` +
    `&provider=eq.${encodeURIComponent(PROVIDER)}` +
    `&is_validation=eq.true` +
    `&production_applied=eq.false` +
    `&order=effective_date.asc,stock_code.asc`,
    key
  );
}

async function priorBar(base, key, stockCode, effectiveDate) {
  const select = 'stock_code,trading_date,close_price,source,adjusted_price';
  return getArray(
    `${base}/rest/v1/${BAR_TABLE}` +
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

function round(v) {
  return Number(Number(v).toPrecision(15));
}

async function factorFor(row, base, key) {
  const rf = num(row.ratio_from);
  const rt = num(row.ratio_to);
  const cash = num(row.cash_amount);

  if (['STOCK_SPLIT','REVERSE_SPLIT','STOCK_DIVIDEND'].includes(row.action_type)) {
    if (!(rf > 0) || !(rt > 0)) return { factorClass: 'INVALID', reason: 'BAD_RATIO' };
    const pf = rf / rt;
    const sf = rt / rf;
    return {
      factorClass: 'RATIO_FACTOR',
      supportedForGenericAdjustment: true,
      event_price_factor: round(pf),
      event_share_factor: round(sf),
      inverseInvariantProduct: round(pf * sf),
      provenance: { ratio_from: rf, ratio_to: rt }
    };
  }

  if (row.action_type === 'CASH_DIVIDEND') {
    const bars = await priorBar(base, key, row.stock_code, row.effective_date);
    if (!bars.length) return { factorClass: 'INVALID', reason: 'NO_PRIOR_BAR' };
    const p = num(bars[0].close_price);
    if (!(p > cash) || !(cash >= 0)) {
      return { factorClass: 'INVALID', reason: 'BAD_CASH_REFERENCE' };
    }
    return {
      factorClass: 'CASH_FACTOR',
      supportedForGenericAdjustment: true,
      event_price_factor: round((p - cash) / p),
      event_share_factor: 1,
      provenance: {
        reference_trading_date: bars[0].trading_date,
        reference_close_price: p,
        reference_source: bars[0].source,
        reference_adjusted_price_flag: bars[0].adjusted_price,
        cash_amount_per_share: cash,
        currency: row.currency || 'KRW'
      }
    };
  }

  if (row.action_type === 'MERGER') {
    return {
      factorClass: 'STRUCTURAL_EXCLUSION',
      supportedForGenericAdjustment: false,
      event_price_factor: null,
      event_share_factor: null,
      reason: 'MERGER_REQUIRES_SECURITY_CONTINUITY_POLICY'
    };
  }

  if (row.action_type === 'SPIN_OFF') {
    return {
      factorClass: 'STRUCTURAL_EXCLUSION',
      supportedForGenericAdjustment: false,
      event_price_factor: null,
      event_share_factor: null,
      reason: 'SPIN_OFF_REQUIRES_VALUE_ALLOCATION_POLICY'
    };
  }

  return { factorClass: 'INVALID', reason: 'UNEXPECTED_ACTION_TYPE' };
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const outputArg = process.argv.slice(2).find(a => a.startsWith('--output='));
  const outputFile = outputArg
    ? path.resolve(outputArg.slice(9))
    : path.join(root, 'logs', 'corporate-action-full-factor-preview-v9-7-17.json');

  const { url, key } = env();
  const events = await readEvents(url, key);
  if (events.length !== 15) throw new Error('EXPECTED_15_VALIDATION_EVENTS');

  const seen = new Set();
  const rows = [];

  for (const e of events) {
    if (e.status !== 'RECORDED' || e.is_validation !== true || e.production_applied !== false) {
      throw new Error('INVALID_EVENT_LIFECYCLE_STATE');
    }
    const identity = `${e.provider}|${e.provider_event_id}|${e.is_validation}`;
    if (seen.has(identity)) throw new Error('DUPLICATE_EVENT_IDENTITY');
    seen.add(identity);

    rows.push({
      event: {
        id: e.id,
        stock_code: e.stock_code,
        action_type: e.action_type,
        effective_date: e.effective_date,
        provider_event_id: e.provider_event_id,
        source_fingerprint: e.source_fingerprint
      },
      factor: await factorFor(e, url, key)
    });
  }

  const ratio = rows.filter(x => x.factor.factorClass === 'RATIO_FACTOR');
  const cash = rows.filter(x => x.factor.factorClass === 'CASH_FACTOR');
  const structural = rows.filter(x => x.factor.factorClass === 'STRUCTURAL_EXCLUSION');
  const invalid = rows.filter(x => x.factor.factorClass === 'INVALID');

  const ratioFail = ratio.filter(
    x => Math.abs((x.factor.inverseInvariantProduct ?? 0) - 1) > 1e-10
  ).length;
  const cashFail = cash.filter(
    x => !(x.factor.event_price_factor > 0 && x.factor.event_price_factor <= 1)
  ).length;

  const ok =
    rows.length === 15 &&
    ratio.length === 8 &&
    cash.length === 3 &&
    structural.length === 4 &&
    invalid.length === 0 &&
    ratioFail === 0 &&
    cashFail === 0 &&
    structural.every(x =>
      x.factor.event_price_factor === null &&
      x.factor.event_share_factor === null &&
      x.factor.supportedForGenericAdjustment === false
    );

  const report = {
    version: VERSION,
    status: ok
      ? 'FULL_15_EVENT_FACTOR_PREVIEW_PROVEN'
      : 'FULL_15_EVENT_FACTOR_PREVIEW_REVIEW_REQUIRED',
    summary: {
      totalEvents: rows.length,
      ratioFactors: ratio.length,
      cashFactors: cash.length,
      structuralExclusions: structural.length,
      invalid: invalid.length,
      genericAdjustmentSupportedEvents: ratio.length + cash.length,
      genericAdjustmentExcludedEvents: structural.length,
      ratioInvariantFailures: ratioFail,
      cashFactorRangeFailures: cashFail
    },
    rows,
    safety: {
      databaseConnected: true,
      httpMethodsUsed: ['GET'],
      writesPerformed: 0,
      adjustmentRowsInserted: 0,
      eventRowsUpdated: 0,
      productionAppliedRows: 0,
      coveragePromoted: false
    },
    nextGate: ok
      ? 'INSPECT_ADJUSTMENT_RUN_AND_FACTOR_TABLE_WRITE_CONTRACT'
      : 'REVIEW_FACTOR_PREVIEW_FAILURES'
  };

  saveJson(outputFile, report);

  console.log(JSON.stringify({
    status: report.status,
    ...report.summary,
    writesPerformed: 0,
    adjustmentRowsInserted: 0,
    coveragePromoted: false
  }, null, 2));

  console.log('Upload only this report (never upload .env files): ' + outputFile);
  if (!ok) process.exitCode = 2;
}

main().catch(err => {
  console.error(String(err?.message || err).replace(/[^A-Za-z0-9_]/g, '_').toUpperCase());
  process.exitCode = 1;
});
