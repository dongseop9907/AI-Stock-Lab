'use strict';

// V9.7.22.1 controlled idempotent refresh for proven stale history.
//
// Scope:
//   stock_code     = 196450
//   effective_date = validation REVERSE_SPLIT event
//   expected DB rows in scope = 24
//
// Default: dry-run
// Apply:   --apply
//
// Apply behavior:
//   1) Re-prove each of the 24 rows is either:
//        - proven stale pre-action history, or
//        - already equal to current KIS mode0 adjusted history
//   2) Build exact KIS mode0 replacement rows for those same 24 dates
//   3) Upsert by UNIQUE(stock_code,trading_date)
//   4) Verify all 24 rows match KIS mode0
//   5) Repeat the identical upsert payload
//   6) Verify idempotency
//
// Never touches:
//   038060, 183300, 215790, 276730
// Never updates:
//   corporate_action_events
//   corporate_action_adjustment_runs
//   corporate_action_adjustment_factors
//
// Run:
//   node --env-file=.env.local .\scripts\v9722-1.cjs
//   node --env-file=.env.local .\scripts\v9722-1.cjs --apply

const fs = require('node:fs');
const path = require('node:path');

const VERSION = 'V9_7_22_1_CONTROLLED_STALE_HISTORY_REFRESH';
const STOCK = '196450';
const ACTION = 'REVERSE_SPLIT';
const EXPECTED_ROWS = 24;
const RUN_VERSION = 'CORPORATE_ACTION_ADJUSTMENT_V9_7_19_VALIDATION';

const KIS_BASE = 'https://openapi.koreainvestment.com:9443';
const KIS_PATH =
  '/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice';
const TR_ID = 'FHKST03010100';

const KIS_MIN_GAP_MS = 1300;
const KIS_MAX_RATE_RETRIES = 6;
const TOKEN_MAX_RETRIES = 6;

let lastKisAt = 0;

function saveJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function firstEnv(names) {
  for (const name of names) {
    const v = process.env[name];
    if (v && String(v).trim()) return { name, value: String(v).trim() };
  }
  return null;
}

function regexEnv(regex, excludes = []) {
  const keys = Object.keys(process.env)
    .filter(k => regex.test(k))
    .filter(k => !excludes.some(rx => rx.test(k)))
    .filter(k => process.env[k] && String(process.env[k]).trim());

  if (keys.length === 1) {
    return { name: keys[0], value: String(process.env[keys[0]]).trim() };
  }
  return null;
}

function credentials() {
  const appKey =
    firstEnv([
      'KIS_APP_KEY','KIS_APPKEY','KIS_REAL_APP_KEY','KIS_REAL_APPKEY',
      'KOREA_INVESTMENT_APP_KEY','KOREA_INVESTMENT_APPKEY'
    ]) ||
    regexEnv(/(?:^|_)KIS(?:_|.*)APP(?:_|)?KEY$/i, [/SECRET/i,/SUPABASE/i]);

  const appSecret =
    firstEnv([
      'KIS_APP_SECRET','KIS_APPSECRET','KIS_REAL_APP_SECRET','KIS_REAL_APPSECRET',
      'KOREA_INVESTMENT_APP_SECRET','KOREA_INVESTMENT_APPSECRET'
    ]) ||
    regexEnv(/(?:^|_)KIS(?:_|.*)APP(?:_|)?SECRET$/i, [/SUPABASE/i]);

  if (!appKey) throw new Error('KIS_APP_KEY_REQUIRED');
  if (!appSecret) throw new Error('KIS_APP_SECRET_REQUIRED');

  return {
    appKey: appKey.value,
    appSecret: appSecret.value
  };
}

function existingToken() {
  return firstEnv([
    'KIS_ACCESS_TOKEN',
    'KIS_TOKEN',
    'KIS_REAL_ACCESS_TOKEN',
    'KOREA_INVESTMENT_ACCESS_TOKEN'
  ]);
}

function supabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error('SUPABASE_URL_REQUIRED');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY_REQUIRED');

  return {
    url: String(url).replace(/\/+$/, ''),
    key: String(key)
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function issueTokenOnce(appKey, appSecret) {
  const res = await fetch(`${KIS_BASE}/oauth2/tokenP`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      appkey: appKey,
      appsecret: appSecret
    })
  });

  const text = await res.text();
  let body;
  try { body = JSON.parse(text); }
  catch { throw new Error('KIS_TOKEN_INVALID_JSON'); }

  if (!res.ok || !body?.access_token) {
    const code = String(
      body?.error_code ||
      body?.error ||
      body?.msg_cd ||
      body?.rt_cd ||
      `HTTP_${res.status}`
    );

    const err = new Error(
      `KIS_TOKEN_${code.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase()}`
    );
    err.kisCode = code;
    throw err;
  }

  return String(body.access_token);
}

async function issueToken(appKey, appSecret) {
  for (let attempt = 0; attempt <= TOKEN_MAX_RETRIES; attempt++) {
    try {
      return await issueTokenOnce(appKey, appSecret);
    } catch (err) {
      if (err?.kisCode !== 'EGW00133' || attempt === TOKEN_MAX_RETRIES) {
        throw err;
      }
      await sleep(11000);
    }
  }

  throw new Error('KIS_TOKEN_RETRY_EXHAUSTED');
}

async function sbRequest(url, key, options = {}) {
  const res = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.prefer ? { Prefer: options.prefer } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const text = await res.text();
  let body = null;

  if (text) {
    try { body = JSON.parse(text); }
    catch { throw new Error('SUPABASE_INVALID_JSON'); }
  }

  if (!res.ok) {
    const code = String(body?.code || `HTTP_${res.status}`);
    const err = new Error(
      `SUPABASE_${code.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase()}`
    );
    err.publicDetail = {
      httpStatus: res.status,
      code: body?.code ?? null,
      message: body?.message ?? null,
      details: body?.details ?? null,
      hint: body?.hint ?? null
    };
    throw err;
  }

  return body;
}

async function sbGet(url, key) {
  const body = await sbRequest(url, key);
  if (!Array.isArray(body)) throw new Error('SUPABASE_EXPECTED_ARRAY');
  return body;
}

function compact(iso) {
  return String(iso).replaceAll('-', '');
}

function addDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

async function waitKisSlot() {
  const elapsed = Date.now() - lastKisAt;
  if (elapsed < KIS_MIN_GAP_MS) {
    await sleep(KIS_MIN_GAP_MS - elapsed);
  }
}

async function kisOnce(stock, start, end, mode, token, appKey, appSecret) {
  await waitKisSlot();
  lastKisAt = Date.now();

  const q = new URLSearchParams({
    FID_COND_MRKT_DIV_CODE: 'J',
    FID_INPUT_ISCD: stock,
    FID_INPUT_DATE_1: compact(start),
    FID_INPUT_DATE_2: compact(end),
    FID_PERIOD_DIV_CODE: 'D',
    FID_ORG_ADJ_PRC: mode
  });

  const res = await fetch(`${KIS_BASE}${KIS_PATH}?${q}`, {
    method: 'GET',
    headers: {
      'content-type': 'application/json; charset=utf-8',
      authorization: `Bearer ${token}`,
      appkey: appKey,
      appsecret: appSecret,
      tr_id: TR_ID,
      custtype: 'P'
    }
  });

  const text = await res.text();
  let body;
  try { body = JSON.parse(text); }
  catch { throw new Error('KIS_DAILY_INVALID_JSON'); }

  const ok =
    res.ok &&
    (body?.rt_cd === undefined || String(body.rt_cd) === '0');

  if (!ok) {
    const code = String(
      body?.msg_cd ||
      body?.error_code ||
      body?.rt_cd ||
      `HTTP_${res.status}`
    );

    const err = new Error(
      `KIS_DAILY_${code.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase()}`
    );
    err.kisCode = code;
    throw err;
  }

  const rows = Array.isArray(body?.output2) ? body.output2 : [];

  return rows
    .map(raw => ({
      date: String(raw.stck_bsop_date || ''),
      open: Number(raw.stck_oprc),
      high: Number(raw.stck_hgpr),
      low: Number(raw.stck_lwpr),
      close: Number(raw.stck_clpr),
      volume: Number(raw.acml_vol),
      tradingValue:
        raw.acml_tr_pbmn === '' || raw.acml_tr_pbmn == null
          ? null
          : Number(raw.acml_tr_pbmn),
      raw: {
        mod_yn: raw.mod_yn ?? null,
        acml_vol: raw.acml_vol ?? null,
        prdy_vrss: raw.prdy_vrss ?? null,
        prtt_rate: raw.prtt_rate ?? null,
        stck_clpr: raw.stck_clpr ?? null,
        stck_hgpr: raw.stck_hgpr ?? null,
        stck_lwpr: raw.stck_lwpr ?? null,
        stck_oprc: raw.stck_oprc ?? null,
        acml_tr_pbmn: raw.acml_tr_pbmn ?? null,
        flng_cls_code: raw.flng_cls_code ?? null,
        prdy_vrss_sign: raw.prdy_vrss_sign ?? null,
        revl_issu_reas: raw.revl_issu_reas ?? null,
        stck_bsop_date: raw.stck_bsop_date ?? null
      }
    }))
    .filter(x => x.date >= compact(start) && x.date <= compact(end))
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function kis(stock, start, end, mode, token, appKey, appSecret) {
  for (let attempt = 0; attempt <= KIS_MAX_RATE_RETRIES; attempt++) {
    try {
      return await kisOnce(
        stock, start, end, mode, token, appKey, appSecret
      );
    } catch (err) {
      if (err?.kisCode !== 'EGW00201' || attempt === KIS_MAX_RATE_RETRIES) {
        throw err;
      }
      await sleep(2000 + attempt * 700);
      lastKisAt = 0;
    }
  }

  throw new Error('KIS_RATE_RETRY_EXHAUSTED');
}

async function readFactor(sb) {
  const runs = await sbGet(
    `${sb.url}/rest/v1/corporate_action_adjustment_runs` +
    `?select=${encodeURIComponent('id,stock_code,version,status')}` +
    `&stock_code=eq.${STOCK}` +
    `&version=eq.${encodeURIComponent(RUN_VERSION)}` +
    `&is_validation=eq.true&production_applied=eq.false`,
    sb.key
  );

  if (runs.length !== 1) throw new Error('EXPECTED_ONE_VALIDATION_RUN');

  const rows = await sbGet(
    `${sb.url}/rest/v1/corporate_action_adjustment_factors` +
    `?select=${encodeURIComponent(
      'stock_code,effective_date,action_type,event_price_factor,event_share_factor'
    )}` +
    `&adjustment_run_id=eq.${runs[0].id}` +
    `&stock_code=eq.${STOCK}` +
    `&action_type=eq.${ACTION}` +
    `&is_validation=eq.true&production_applied=eq.false`,
    sb.key
  );

  if (rows.length !== 1) throw new Error('EXPECTED_ONE_VALIDATION_FACTOR');
  return rows[0];
}

async function readDbRows(sb, start, end) {
  return sbGet(
    `${sb.url}/rest/v1/market_daily_bars` +
    `?select=${encodeURIComponent(
      'id,stock_code,trading_date,open_price,high_price,low_price,close_price,volume,trading_value,source,adjusted_price,raw_payload,collected_at,created_at,updated_at'
    )}` +
    `&stock_code=eq.${STOCK}` +
    `&trading_date=gte.${encodeURIComponent(start)}` +
    `&trading_date=lte.${encodeURIComponent(end)}` +
    `&order=trading_date.asc`,
    sb.key
  );
}

function sameOhlcv(db, kisRow) {
  return !!db && !!kisRow &&
    Number(db.open_price) === kisRow.open &&
    Number(db.high_price) === kisRow.high &&
    Number(db.low_price) === kisRow.low &&
    Number(db.close_price) === kisRow.close &&
    Number(db.volume) === kisRow.volume;
}

function nearPrice(a, b) {
  return Math.abs(Number(a) - Number(b)) <= 1;
}

function factorTransforms(db, adjusted, factor) {
  if (!db || !adjusted) return false;

  return (
    nearPrice(Number(db.open_price) * factor, adjusted.open) &&
    nearPrice(Number(db.high_price) * factor, adjusted.high) &&
    nearPrice(Number(db.low_price) * factor, adjusted.low) &&
    nearPrice(Number(db.close_price) * factor, adjusted.close)
  );
}

function timestampBefore(ts, effectiveDate) {
  if (!ts) return false;
  const value = new Date(ts).getTime();
  const limit = new Date(`${effectiveDate}T00:00:00Z`).getTime();
  return Number.isFinite(value) && value < limit;
}

function validOhlcv(row) {
  return (
    row.open > 0 &&
    row.high > 0 &&
    row.low > 0 &&
    row.close > 0 &&
    row.volume >= 0 &&
    row.high >= row.low &&
    row.high >= row.open &&
    row.high >= row.close &&
    row.low <= row.open &&
    row.low <= row.close
  );
}

function stable(v) {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object') {
    return Object.keys(v).sort().reduce((out, k) => {
      out[k] = stable(v[k]);
      return out;
    }, {});
  }
  return v;
}

function jsonEqual(a, b) {
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}

function matchesExpectedAdjusted(db, adjusted) {
  if (!sameOhlcv(db, adjusted)) return false;

  const dbTradingValue =
    db.trading_value == null ? null : Number(db.trading_value);

  if (dbTradingValue !== adjusted.tradingValue) return false;
  if (db.source !== 'KIS_DAILY_V8_3') return false;
  if (db.adjusted_price !== true) return false;
  if (!jsonEqual(db.raw_payload || {}, adjusted.raw || {})) return false;

  return true;
}

async function upsertBars(sb, rows) {
  const body = await sbRequest(
    `${sb.url}/rest/v1/market_daily_bars` +
    `?on_conflict=${encodeURIComponent('stock_code,trading_date')}`,
    sb.key,
    {
      method: 'POST',
      body: rows,
      prefer: 'resolution=merge-duplicates,return=representation'
    }
  );

  if (!Array.isArray(body)) {
    throw new Error('BAR_UPSERT_RESPONSE_NOT_ARRAY');
  }

  return body;
}

async function inspectState(sb, factorRow, mode0, mode1) {
  const effectiveDate = String(factorRow.effective_date);
  const eventPriceFactor = Number(factorRow.event_price_factor);
  const start = addDays(effectiveDate, -45);
  const end = addDays(effectiveDate, -1);

  const dbRows = await readDbRows(sb, start, end);

  if (dbRows.length !== EXPECTED_ROWS) {
    throw new Error('EXPECTED_24_DB_ROWS_IN_SCOPE');
  }

  const adjustedMap = new Map(mode0.map(x => [x.date, x]));
  const originalMap = new Map(mode1.map(x => [x.date, x]));

  const classifications = [];

  for (const db of dbRows) {
    const date = compact(db.trading_date);
    const adjusted = adjustedMap.get(date) || null;
    const original = originalMap.get(date) || null;

    if (!adjusted || !original) {
      throw new Error('KIS_REFERENCE_ROW_MISSING_FOR_DB_DATE');
    }

    const stale =
      sameOhlcv(db, original) &&
      !sameOhlcv(db, adjusted) &&
      factorTransforms(db, adjusted, eventPriceFactor) &&
      timestampBefore(db.collected_at, effectiveDate) &&
      timestampBefore(db.updated_at, effectiveDate);

    const exactAdjusted =
      matchesExpectedAdjusted(db, adjusted);

    let state = 'CONFLICT';
    if (stale) state = 'PROVEN_STALE';
    else if (exactAdjusted) state = 'ALREADY_REFRESHED';

    classifications.push({
      tradingDate: db.trading_date,
      state,
      adjusted,
      current: db
    });
  }

  return {
    start,
    end,
    dbRows,
    classifications,
    staleRows: classifications.filter(x => x.state === 'PROVEN_STALE'),
    alreadyRefreshedRows:
      classifications.filter(x => x.state === 'ALREADY_REFRESHED'),
    conflictRows: classifications.filter(x => x.state === 'CONFLICT')
  };
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');

  for (const arg of args) {
    if (arg !== '--apply' && !arg.startsWith('--output=')) {
      throw new Error('UNKNOWN_OPTION');
    }
  }

  const outputArg = args.find(a => a.startsWith('--output='));
  const outputFile = outputArg
    ? path.resolve(outputArg.slice('--output='.length))
    : path.join(
        root,
        'logs',
        'controlled-stale-history-refresh-v9-7-22-1.json'
      );

  const sb = supabase();
  const c = credentials();
  const tok = existingToken();
  const accessToken = tok
    ? tok.value
    : await issueToken(c.appKey, c.appSecret);

  const factorRow = await readFactor(sb);

  if (
    factorRow.stock_code !== STOCK ||
    factorRow.action_type !== ACTION
  ) {
    throw new Error('UNEXPECTED_FACTOR_IDENTITY');
  }

  const effectiveDate = String(factorRow.effective_date);
  const eventPriceFactor = Number(factorRow.event_price_factor);
  const start = addDays(effectiveDate, -45);
  const end = addDays(effectiveDate, -1);

  const mode0 = await kis(
    STOCK, start, end, '0',
    accessToken, c.appKey, c.appSecret
  );

  const mode1 = await kis(
    STOCK, start, end, '1',
    accessToken, c.appKey, c.appSecret
  );

  const before = await inspectState(sb, factorRow, mode0, mode1);

  if (before.conflictRows.length > 0) {
    throw new Error('LIVE_SCOPE_CONTAINS_UNPROVEN_CONFLICT_ROWS');
  }

  if (
    before.staleRows.length + before.alreadyRefreshedRows.length !== EXPECTED_ROWS
  ) {
    throw new Error('LIVE_SCOPE_CLASSIFICATION_INVARIANT_FAILED');
  }

  const refreshTimestamp = new Date().toISOString();

  const adjustedMap = new Map(mode0.map(x => [x.date, x]));

  const payload = before.dbRows.map(db => {
    const adjusted = adjustedMap.get(compact(db.trading_date));
    if (!adjusted || !validOhlcv(adjusted)) {
      throw new Error('INVALID_KIS_MODE0_PAYLOAD_ROW');
    }

    return {
      stock_code: STOCK,
      trading_date: db.trading_date,
      open_price: adjusted.open,
      high_price: adjusted.high,
      low_price: adjusted.low,
      close_price: adjusted.close,
      volume: adjusted.volume,
      trading_value: adjusted.tradingValue,
      source: 'KIS_DAILY_V8_3',
      adjusted_price: true,
      raw_payload: adjusted.raw,
      collected_at: db.collected_at,
      updated_at: refreshTimestamp
    };
  });

  const uniqueDates = new Set(payload.map(x => x.trading_date));

  if (
    payload.length !== EXPECTED_ROWS ||
    uniqueDates.size !== EXPECTED_ROWS
  ) {
    throw new Error('REFRESH_PAYLOAD_IDENTITY_INVARIANT_FAILED');
  }

  if (!apply) {
    const report = {
      version: VERSION,
      status:
        before.staleRows.length === 0
          ? 'DRY_RUN_ALREADY_REFRESHED'
          : 'DRY_RUN_READY_FOR_APPLY',
      applyRequested: false,
      scope: {
        stockCode: STOCK,
        actionType: ACTION,
        effectiveDate,
        eventPriceFactor,
        start,
        end
      },
      summary: {
        dbRows: before.dbRows.length,
        provenStaleBefore: before.staleRows.length,
        alreadyRefreshedBefore: before.alreadyRefreshedRows.length,
        conflictsBefore: before.conflictRows.length,
        payloadRows: payload.length,
        uniqueDates: uniqueDates.size
      },
      safety: {
        writesPerformed: 0,
        marketBarsInsertedOrMerged: 0,
        otherStocksTouched: 0,
        adjustmentRowsUpdated: 0,
        coveragePromoted: false
      },
      nextCommand:
        before.staleRows.length > 0
          ? 'node --env-file=.env.local .\\scripts\\v9722-1.cjs --apply'
          : null
    };

    saveJson(outputFile, report);

    console.log(JSON.stringify({
      status: report.status,
      stockCode: STOCK,
      dbRows: report.summary.dbRows,
      provenStaleBefore: report.summary.provenStaleBefore,
      alreadyRefreshedBefore: report.summary.alreadyRefreshedBefore,
      conflictsBefore: report.summary.conflictsBefore,
      payloadRows: report.summary.payloadRows,
      uniqueDates: report.summary.uniqueDates,
      writesPerformed: 0,
      coveragePromoted: false,
      nextCommand: report.nextCommand
    }, null, 2));

    console.log(
      'Upload only this report (never upload .env files): ' + outputFile
    );
    return;
  }

  if (before.staleRows.length === 0) {
    const report = {
      version: VERSION,
      status: 'ALREADY_REFRESHED_NO_WRITE_NEEDED',
      applyRequested: true,
      stockCode: STOCK,
      rowsVerified: before.alreadyRefreshedRows.length,
      conflicts: 0,
      writesPerformed: 0,
      coveragePromoted: false
    };

    saveJson(outputFile, report);
    console.log(JSON.stringify(report, null, 2));
    console.log(
      'Upload only this report (never upload .env files): ' + outputFile
    );
    return;
  }

  if (before.staleRows.length !== EXPECTED_ROWS) {
    throw new Error('PARTIAL_STALE_SCOPE_REFUSES_APPLY');
  }

  const first = await upsertBars(sb, payload);

  const afterFirst = await inspectState(sb, factorRow, mode0, mode1);

  if (
    afterFirst.staleRows.length !== 0 ||
    afterFirst.alreadyRefreshedRows.length !== EXPECTED_ROWS ||
    afterFirst.conflictRows.length !== 0
  ) {
    throw new Error('FIRST_REFRESH_VERIFICATION_FAILED');
  }

  // Repeat exact same payload, including identical updated_at,
  // to prove idempotent upsert behavior.
  const second = await upsertBars(sb, payload);

  const afterSecond = await inspectState(sb, factorRow, mode0, mode1);

  const idempotencyProven =
    afterSecond.staleRows.length === 0 &&
    afterSecond.alreadyRefreshedRows.length === EXPECTED_ROWS &&
    afterSecond.conflictRows.length === 0;

  if (!idempotencyProven) {
    throw new Error('SECOND_REFRESH_IDEMPOTENCY_FAILED');
  }

  const report = {
    version: VERSION,
    status: 'STALE_HISTORY_REFRESH_AND_IDEMPOTENCY_PROVEN',
    applyRequested: true,
    scope: {
      stockCode: STOCK,
      actionType: ACTION,
      effectiveDate,
      eventPriceFactor,
      start,
      end
    },
    before: {
      dbRows: before.dbRows.length,
      provenStale: before.staleRows.length,
      alreadyRefreshed: before.alreadyRefreshedRows.length,
      conflicts: before.conflictRows.length
    },
    firstUpsert: {
      responseRows: first.length,
      staleAfter: afterFirst.staleRows.length,
      refreshedAfter: afterFirst.alreadyRefreshedRows.length,
      conflictsAfter: afterFirst.conflictRows.length
    },
    secondUpsert: {
      responseRows: second.length,
      staleAfter: afterSecond.staleRows.length,
      refreshedAfter: afterSecond.alreadyRefreshedRows.length,
      conflictsAfter: afterSecond.conflictRows.length
    },
    idempotencyProven,
    safety: {
      writesPerformed: 2,
      marketBarUpsertOperations: 2,
      exactRowsInScope: EXPECTED_ROWS,
      otherStocksTouched: 0,
      deleteOperations: 0,
      schemaMigrations: 0,
      adjustmentRowsUpdated: 0,
      productionAppliedRowsUpdated: 0,
      coveragePromoted: false
    },
    nextGate:
      'RE_RUN_ROW_LEVEL_BASIS_AUDIT_AND_THEN_DESIGN_AUTOMATIC_POST_CORPORATE_ACTION_HISTORY_REFRESH_POLICY'
  };

  saveJson(outputFile, report);

  console.log(JSON.stringify({
    status: report.status,
    stockCode: STOCK,
    staleBefore: report.before.provenStale,
    alreadyRefreshedBefore: report.before.alreadyRefreshed,
    firstUpsertResponseRows: report.firstUpsert.responseRows,
    refreshedAfterFirst: report.firstUpsert.refreshedAfter,
    staleAfterFirst: report.firstUpsert.staleAfter,
    secondUpsertResponseRows: report.secondUpsert.responseRows,
    refreshedAfterSecond: report.secondUpsert.refreshedAfter,
    staleAfterSecond: report.secondUpsert.staleAfter,
    conflictsAfterSecond: report.secondUpsert.conflictsAfter,
    idempotencyProven,
    writesPerformed: 2,
    coveragePromoted: false
  }, null, 2));

  console.log(
    'Upload only this report (never upload .env files): ' + outputFile
  );
}

main().catch(err => {
  if (err?.publicDetail) {
    console.error(JSON.stringify({
      error: String(err.message)
        .replace(/[^A-Za-z0-9_]/g, '_')
        .toUpperCase(),
      detail: err.publicDetail
    }, null, 2));
  } else {
    console.error(
      String(err?.message || err)
        .replace(/[^A-Za-z0-9_]/g, '_')
        .toUpperCase()
    );
  }
  process.exitCode = 1;
});
