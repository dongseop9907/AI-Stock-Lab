'use strict';

// V9.7.16 read-only cash-dividend reference-price probe.
//
// Reads:
//   - 3 CASH_DIVIDEND validation events from corporate_action_events
//   - prior unadjusted daily closes from market_daily_bars
//
// For each cash dividend:
//   reference_price = latest close_price where trading_date < effective_date
//   event_share_factor = 1
//   event_price_factor = (reference_price - cash_amount) / reference_price
//
// Safety / validation:
//   - GET only
//   - no DB writes
//   - abort/review if duplicate market_daily_bars rows exist for the selected
//     stock_code + reference trading_date
//   - require reference_price > cash_amount >= 0
//   - no coverage promotion
//
// Requires:
//   NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Run:
//   node --env-file=.env.local .\scripts\v9716.cjs

const fs = require('node:fs');
const path = require('node:path');

const VERSION = 'V9_7_16_CASH_DIVIDEND_REFERENCE_PRICE_PROBE';

const EVENT_TABLE = 'corporate_action_events';
const BAR_TABLE = 'market_daily_bars';
const PROVIDER = 'DART_KRX_CANONICAL';

const EXPECTED_CASH_EVENTS = 3;
const BAR_LOOKBACK_LIMIT = 12;

function safeError(error) {
  const m = error instanceof Error ? error.message : String(error ?? 'UNKNOWN_ERROR');
  return /^[A-Z0-9_]+$/.test(m) ? m : 'V9_7_16_FAILED';
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

  return {
    url: url.replace(/\/+$/, ''),
    key
  };
}

async function getJson(url, key) {
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
      Prefer: 'count=exact'
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
    const code = body?.code ? String(body.code) : `HTTP_${res.status}`;
    throw new Error(code.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase());
  }

  if (!Array.isArray(body)) {
    throw new Error('EXPECTED_ARRAY_RESPONSE');
  }

  return body;
}

async function readCashEvents(baseUrl, key) {
  const select = [
    'id',
    'stock_code',
    'action_type',
    'effective_date',
    'cash_amount',
    'currency',
    'provider',
    'provider_event_id',
    'status',
    'is_validation',
    'production_applied'
  ].join(',');

  const url =
    `${baseUrl}/rest/v1/${EVENT_TABLE}` +
    `?select=${encodeURIComponent(select)}` +
    `&provider=eq.${encodeURIComponent(PROVIDER)}` +
    `&action_type=eq.CASH_DIVIDEND` +
    `&is_validation=eq.true` +
    `&production_applied=eq.false` +
    `&order=effective_date.asc,stock_code.asc`;

  return getJson(url, key);
}

async function readPriorBars(baseUrl, key, stockCode, effectiveDate) {
  const select = [
    'stock_code',
    'trading_date',
    'close_price'
  ].join(',');

  const url =
    `${baseUrl}/rest/v1/${BAR_TABLE}` +
    `?select=${encodeURIComponent(select)}` +
    `&stock_code=eq.${encodeURIComponent(stockCode)}` +
    `&trading_date=lt.${encodeURIComponent(effectiveDate)}` +
    `&order=trading_date.desc` +
    `&limit=${BAR_LOOKBACK_LIMIT}`;

  return getJson(url, key);
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function roundFactor(v) {
  return Number(Number(v).toPrecision(15));
}

function analyzeBars(event, bars) {
  if (!Array.isArray(bars) || bars.length === 0) {
    return {
      status: 'UNRESOLVED',
      reason: 'NO_PRIOR_MARKET_DAILY_BAR',
      reference: null,
      factor: null
    };
  }

  const topDate = bars[0]?.trading_date ?? null;
  if (!topDate) {
    return {
      status: 'UNRESOLVED',
      reason: 'PRIOR_BAR_MISSING_TRADING_DATE',
      reference: null,
      factor: null
    };
  }

  const sameDateRows = bars.filter(r => r.trading_date === topDate);

  if (sameDateRows.length !== 1) {
    return {
      status: 'UNRESOLVED',
      reason: 'DUPLICATE_REFERENCE_DATE_ROWS',
      reference: {
        trading_date: topDate,
        duplicateRows: sameDateRows
      },
      factor: null
    };
  }

  const ref = sameDateRows[0];
  const referencePrice = num(ref.close_price);
  const cashAmount = num(event.cash_amount);

  if (!(referencePrice > 0)) {
    return {
      status: 'UNRESOLVED',
      reason: 'INVALID_REFERENCE_CLOSE_PRICE',
      reference: ref,
      factor: null
    };
  }

  if (!(cashAmount >= 0)) {
    return {
      status: 'UNRESOLVED',
      reason: 'INVALID_CASH_AMOUNT_PER_SHARE',
      reference: ref,
      factor: null
    };
  }

  if (!(referencePrice > cashAmount)) {
    return {
      status: 'UNRESOLVED',
      reason: 'REFERENCE_PRICE_NOT_GREATER_THAN_CASH_DIVIDEND',
      reference: ref,
      factor: null
    };
  }

  const rawFactor = (referencePrice - cashAmount) / referencePrice;

  if (!(rawFactor > 0 && rawFactor <= 1)) {
    return {
      status: 'UNRESOLVED',
      reason: 'DERIVED_PRICE_FACTOR_OUT_OF_RANGE',
      reference: ref,
      factor: null
    };
  }

  return {
    status: 'RESOLVED',
    reason: 'LATEST_PRIOR_UNADJUSTED_CLOSE_BEFORE_EX_DIVIDEND_DATE',
    reference: {
      stock_code: ref.stock_code,
      trading_date: ref.trading_date,
      close_price: referencePrice
    },
    factor: {
      event_price_factor: roundFactor(rawFactor),
      event_share_factor: 1,
      formula: '(reference_price - cash_amount_per_share) / reference_price',
      reference_price: referencePrice,
      cash_amount_per_share: cashAmount,
      currency: event.currency || 'KRW'
    }
  };
}

function validateEvent(event) {
  if (event.provider !== PROVIDER) throw new Error('UNEXPECTED_PROVIDER');
  if (event.action_type !== 'CASH_DIVIDEND') {
    throw new Error('UNEXPECTED_ACTION_TYPE');
  }
  if (event.is_validation !== true) {
    throw new Error('NON_VALIDATION_EVENT');
  }
  if (event.production_applied !== false) {
    throw new Error('PRODUCTION_APPLIED_EVENT_FOUND');
  }
  if (event.status !== 'RECORDED') {
    throw new Error('UNEXPECTED_EVENT_STATUS');
  }
  if (!event.stock_code || !event.effective_date) {
    throw new Error('CASH_EVENT_REQUIRED_FIELD_MISSING');
  }
  if (!/^\d{14}$/.test(event.provider_event_id ?? '')) {
    throw new Error('INVALID_PROVIDER_EVENT_ID');
  }
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const args = process.argv.slice(2);

  const allowed = ['--output='];
  if (args.some(a => !allowed.some(p => a.startsWith(p)))) {
    throw new Error('UNKNOWN_OPTION');
  }

  const outputArg = args.find(a => a.startsWith('--output='));
  const outputFile = outputArg
    ? path.resolve(outputArg.slice('--output='.length))
    : path.join(
        root,
        'logs',
        'corporate-action-cash-reference-price-probe-v9-7-16.json'
      );

  const { url, key } = requireEnv();

  const events = await readCashEvents(url, key);

  if (events.length !== EXPECTED_CASH_EVENTS) {
    throw new Error('EXPECTED_3_CASH_DIVIDEND_EVENTS');
  }

  const seenIdentity = new Set();
  const analyzed = [];

  for (const event of events) {
    validateEvent(event);

    const identity =
      `${event.provider}|${event.provider_event_id}|${event.is_validation}`;

    if (seenIdentity.has(identity)) {
      throw new Error('DUPLICATE_CASH_EVENT_IDENTITY');
    }
    seenIdentity.add(identity);

    const bars = await readPriorBars(
      url,
      key,
      event.stock_code,
      event.effective_date
    );

    analyzed.push({
      event: {
        id: event.id,
        stock_code: event.stock_code,
        effective_date: event.effective_date,
        cash_amount_per_share: num(event.cash_amount),
        currency: event.currency || 'KRW',
        provider_event_id: event.provider_event_id
      },
      priorBarsExamined: bars,
      resolution: analyzeBars(event, bars)
    });
  }

  const resolved = analyzed.filter(
    x => x.resolution.status === 'RESOLVED'
  );

  const unresolved = analyzed.filter(
    x => x.resolution.status !== 'RESOLVED'
  );

  const duplicateReferenceDates = analyzed.filter(
    x => x.resolution.reason === 'DUPLICATE_REFERENCE_DATE_ROWS'
  );

  const factorsInRange = resolved.every(x => {
    const f = x.resolution.factor?.event_price_factor;
    return typeof f === 'number' && f > 0 && f <= 1;
  });

  const closed =
    events.length === EXPECTED_CASH_EVENTS &&
    resolved.length === EXPECTED_CASH_EVENTS &&
    unresolved.length === 0 &&
    duplicateReferenceDates.length === 0 &&
    factorsInRange;

  const state = {
    version: VERSION,
    status: closed
      ? 'CASH_DIVIDEND_REFERENCE_PRICES_RESOLVED'
      : 'CASH_DIVIDEND_REFERENCE_PRICE_REVIEW_REQUIRED',
    source: {
      eventTable: EVENT_TABLE,
      barTable: BAR_TABLE,
      provider: PROVIDER,
      barStockColumn: 'stock_code',
      barDateColumn: 'trading_date',
      barCloseColumn: 'close_price',
      referenceRule:
        'latest market_daily_bars.close_price where trading_date < effective_date'
    },
    summary: {
      cashDividendEvents: events.length,
      referencePricesResolved: resolved.length,
      referencePricesUnresolved: unresolved.length,
      duplicateReferenceDateEvents: duplicateReferenceDates.length,
      factorsInValidRange: factorsInRange
    },
    rows: analyzed,
    factorPolicy: {
      cashAmountMeaning: 'CASH_DIVIDEND_AMOUNT_PER_SHARE',
      eventShareFactor: 1,
      eventPriceFactor:
        '(reference_price - cash_amount_per_share) / reference_price',
      referencePrice:
        'unadjusted close_price from the latest prior trading date before the ex-dividend effective_date'
    },
    safety: {
      databaseConnected: true,
      httpMethodsUsed: ['GET'],
      writesPerformed: 0,
      adjustmentRowsInserted: 0,
      eventRowsUpdated: 0,
      coveragePromoted: false
    },
    nextGate: closed
      ? 'BUILD_READ_ONLY_FULL_15_EVENT_FACTOR_PREVIEW_WITH_8_RATIO_FACTORS_PLUS_3_CASH_FACTORS_AND_4_STRUCTURAL_EXCLUSIONS'
      : 'RESOLVE_MISSING_OR_DUPLICATE_MARKET_DAILY_BAR_REFERENCE_DATA'
  };

  saveJson(outputFile, state);

  console.log(JSON.stringify({
    status: state.status,
    cashDividendEvents: state.summary.cashDividendEvents,
    referencePricesResolved: state.summary.referencePricesResolved,
    referencePricesUnresolved: state.summary.referencePricesUnresolved,
    duplicateReferenceDateEvents:
      state.summary.duplicateReferenceDateEvents,
    factorsInValidRange: state.summary.factorsInValidRange,
    resolved: analyzed.map(x => ({
      stockCode: x.event.stock_code,
      effectiveDate: x.event.effective_date,
      referenceDate: x.resolution.reference?.trading_date ?? null,
      referencePrice: x.resolution.reference?.close_price ?? null,
      cashAmountPerShare: x.event.cash_amount_per_share,
      eventPriceFactor:
        x.resolution.factor?.event_price_factor ?? null,
      status: x.resolution.status,
      reason: x.resolution.reason
    })),
    writesPerformed: 0,
    adjustmentRowsInserted: 0,
    coveragePromoted: false
  }, null, 2));

  console.log(
    'Upload only this report (never upload .env files): ' +
    outputFile
  );

  if (!closed) process.exitCode = 2;
}

if (require.main === module) {
  main().catch(error => {
    console.error(safeError(error));
    process.exitCode = 1;
  });
}
