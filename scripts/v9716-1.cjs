'use strict';

// V9.7.16.1 read-only reference-price continuity probe.
// Verifies whether each CASH_DIVIDEND reference close is truly the immediately
// preceding MARKET trading session, rather than merely the latest sparse DB row.
//
// Reads:
//   corporate_action_events (3 validation cash dividends)
//   market_daily_bars (target-stock rows and market-wide trading dates)
//
// Safety:
//   GET only, no DB writes, no migrations, no coverage promotion.
//
// Run:
//   node --env-file=.env.local .\scripts\v9716-1.cjs

const fs = require('node:fs');
const path = require('node:path');

const VERSION = 'V9_7_16_1_REFERENCE_PRICE_CONTINUITY_PROBE';
const EVENT_TABLE = 'corporate_action_events';
const BAR_TABLE = 'market_daily_bars';
const PROVIDER = 'DART_KRX_CANONICAL';
const EXPECTED_EVENTS = 3;
const PAGE_SIZE = 1000;
const MAX_PAGES = 200;

function safeError(error) {
  const m = error instanceof Error ? error.message : String(error ?? 'UNKNOWN_ERROR');
  return /^[A-Z0-9_]+$/.test(m) ? m : 'V9_7_16_1_FAILED';
}

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
  return { url: url.replace(/\/+$/, ''), key };
}

async function getArray(url, key, range = null) {
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Accept: 'application/json'
  };
  if (range) headers.Range = range;

  const res = await fetch(url, { method: 'GET', headers });
  const text = await res.text();

  let body;
  try { body = JSON.parse(text); }
  catch { throw new Error('INVALID_SUPABASE_JSON_RESPONSE'); }

  if (!res.ok) {
    const code = body?.code ? String(body.code) : `HTTP_${res.status}`;
    throw new Error(code.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase());
  }
  if (!Array.isArray(body)) throw new Error('EXPECTED_ARRAY_RESPONSE');
  return body;
}

async function getAll(url, key) {
  const all = [];
  for (let p = 0; p < MAX_PAGES; p++) {
    const from = p * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const rows = await getArray(url, key, `${from}-${to}`);
    all.push(...rows);
    if (rows.length < PAGE_SIZE) return all;
  }
  throw new Error('PAGINATION_SAFETY_LIMIT_REACHED');
}

async function readEvents(baseUrl, key) {
  const select = [
    'id','stock_code','effective_date','cash_amount','currency',
    'provider_event_id','provider','status','is_validation','production_applied'
  ].join(',');

  const url =
    `${baseUrl}/rest/v1/${EVENT_TABLE}` +
    `?select=${encodeURIComponent(select)}` +
    `&provider=eq.${encodeURIComponent(PROVIDER)}` +
    `&action_type=eq.CASH_DIVIDEND` +
    `&is_validation=eq.true` +
    `&production_applied=eq.false` +
    `&order=effective_date.asc,stock_code.asc`;

  return getArray(url, key);
}

async function readTargetBars(baseUrl, key, stockCode, effectiveDate) {
  const url =
    `${baseUrl}/rest/v1/${BAR_TABLE}` +
    `?select=${encodeURIComponent('stock_code,trading_date,close_price')}` +
    `&stock_code=eq.${encodeURIComponent(stockCode)}` +
    `&trading_date=lt.${encodeURIComponent(effectiveDate)}` +
    `&order=trading_date.desc` +
    `&limit=20`;
  return getArray(url, key);
}

async function readMarketDates(baseUrl, key, startExclusive, endExclusive) {
  // Fetch all stock/date rows in the gap. We only retain date counts.
  const url =
    `${baseUrl}/rest/v1/${BAR_TABLE}` +
    `?select=${encodeURIComponent('stock_code,trading_date')}` +
    `&trading_date=gt.${encodeURIComponent(startExclusive)}` +
    `&trading_date=lt.${encodeURIComponent(endExclusive)}` +
    `&order=trading_date.asc,stock_code.asc`;
  return getAll(url, key);
}

function dateDiffDays(a, b) {
  return Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000
  );
}

function summarizeMarketRows(rows) {
  const byDate = new Map();
  for (const row of rows) {
    const d = row.trading_date;
    if (!d) continue;
    if (!byDate.has(d)) byDate.set(d, new Set());
    byDate.get(d).add(row.stock_code);
  }
  return [...byDate.entries()].map(([tradingDate, stocks]) => ({
    tradingDate,
    stockCount: stocks.size
  }));
}

function validateEvent(e) {
  if (e.provider !== PROVIDER) throw new Error('UNEXPECTED_PROVIDER');
  if (e.status !== 'RECORDED') throw new Error('UNEXPECTED_EVENT_STATUS');
  if (e.is_validation !== true) throw new Error('NON_VALIDATION_EVENT');
  if (e.production_applied !== false) throw new Error('PRODUCTION_APPLIED_EVENT');
  if (!e.stock_code || !e.effective_date) throw new Error('EVENT_REQUIRED_FIELD_MISSING');
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const args = process.argv.slice(2);
  if (args.some(a => !a.startsWith('--output='))) throw new Error('UNKNOWN_OPTION');

  const outputArg = args.find(a => a.startsWith('--output='));
  const outputFile = outputArg
    ? path.resolve(outputArg.slice('--output='.length))
    : path.join(root, 'logs', 'corporate-action-reference-price-continuity-v9-7-16-1.json');

  const { url, key } = requireEnv();
  const events = await readEvents(url, key);
  if (events.length !== EXPECTED_EVENTS) throw new Error('EXPECTED_3_CASH_DIVIDEND_EVENTS');

  const rows = [];

  for (const event of events) {
    validateEvent(event);

    const targetBars = await readTargetBars(url, key, event.stock_code, event.effective_date);
    if (!targetBars.length) {
      rows.push({
        stockCode: event.stock_code,
        effectiveDate: event.effective_date,
        status: 'UNRESOLVED',
        reason: 'NO_TARGET_PRIOR_BAR'
      });
      continue;
    }

    const reference = targetBars[0];
    const referenceDate = reference.trading_date;
    const calendarGapDays = dateDiffDays(referenceDate, event.effective_date);

    const marketGapRows = await readMarketDates(
      url, key, referenceDate, event.effective_date
    );
    const marketDates = summarizeMarketRows(marketGapRows);

    const targetRowsInsideGap = marketGapRows.filter(
      r => r.stock_code === event.stock_code
    );

    let status;
    let reason;

    if (marketDates.length === 0) {
      status = 'CONFIRMED';
      reason = 'REFERENCE_IS_IMMEDIATELY_PRECEDING_MARKET_SESSION';
    } else if (targetRowsInsideGap.length > 0) {
      status = 'UNRESOLVED';
      reason = 'REFERENCE_SELECTION_BUG_TARGET_HAS_NEWER_BAR';
    } else {
      status = 'REVIEW_REQUIRED';
      reason = 'MARKET_TRADED_BETWEEN_REFERENCE_AND_EFFECTIVE_BUT_TARGET_DID_NOT';
    }

    rows.push({
      stockCode: event.stock_code,
      effectiveDate: event.effective_date,
      providerEventId: event.provider_event_id,
      referenceDate,
      referencePrice: Number(reference.close_price),
      calendarGapDays,
      interveningMarketTradingDates: marketDates,
      interveningMarketTradingDateCount: marketDates.length,
      targetRowsInsideGap: targetRowsInsideGap.length,
      recentTargetBars: targetBars,
      status,
      reason
    });
  }

  const confirmed = rows.filter(r => r.status === 'CONFIRMED').length;
  const review = rows.filter(r => r.status === 'REVIEW_REQUIRED').length;
  const unresolved = rows.filter(r => r.status === 'UNRESOLVED').length;

  const state = {
    version: VERSION,
    status:
      confirmed === EXPECTED_EVENTS
        ? 'ALL_REFERENCE_PRICES_CONTINUITY_CONFIRMED'
        : 'REFERENCE_PRICE_CONTINUITY_REVIEW_REQUIRED',
    summary: {
      events: rows.length,
      confirmed,
      reviewRequired: review,
      unresolved
    },
    rows,
    interpretation: {
      CONFIRMED:
        'No market_daily_bars trading date exists between the selected reference date and the event effective date.',
      REVIEW_REQUIRED:
        'The market has trading sessions in the gap, but the target stock has no bar. Verify trading suspension vs target-data omission before using the factor.',
      UNRESOLVED:
        'The selected reference is internally inconsistent or missing.'
    },
    safety: {
      databaseConnected: true,
      httpMethodsUsed: ['GET'],
      writesPerformed: 0,
      adjustmentRowsInserted: 0,
      eventRowsUpdated: 0,
      coveragePromoted: false
    },
    nextGate:
      confirmed === EXPECTED_EVENTS
        ? 'ACCEPT_3_CASH_REFERENCE_PRICES'
        : 'VERIFY_TARGET_STOCK_SUSPENSION_OR_REPAIR_MARKET_DAILY_BARS_FOR_REVIEW_REQUIRED_EVENTS'
  };

  saveJson(outputFile, state);

  console.log(JSON.stringify({
    status: state.status,
    events: rows.length,
    confirmed,
    reviewRequired: review,
    unresolved,
    rows: rows.map(r => ({
      stockCode: r.stockCode,
      effectiveDate: r.effectiveDate,
      referenceDate: r.referenceDate ?? null,
      calendarGapDays: r.calendarGapDays ?? null,
      interveningMarketTradingDateCount: r.interveningMarketTradingDateCount ?? null,
      status: r.status,
      reason: r.reason
    })),
    writesPerformed: 0,
    adjustmentRowsInserted: 0,
    coveragePromoted: false
  }, null, 2));

  console.log('Upload only this report (never upload .env files): ' + outputFile);

  if (state.status !== 'ALL_REFERENCE_PRICES_CONTINUITY_CONFIRMED') {
    process.exitCode = 2;
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(safeError(error));
    process.exitCode = 1;
  });
}
