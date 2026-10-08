'use strict';

// V9.7.22 read-only dry-run for proven stale-history refresh.
//
// Scope is intentionally narrow:
//   stock_code      = 196450
//   action_type     = REVERSE_SPLIT
//   effective_date  = 2026-08-25 (read from validation factor/event state)
//   expected stale rows = 24
//
// A row is eligible ONLY if all of these are true:
//   1) DB OHLCV exactly matches current KIS mode 1 (original price)
//   2) DB does NOT match current KIS mode 0 (adjusted price)
//   3) DB OHLC * event_price_factor matches mode 0 within <= 1 KRW rounding
//   4) collected_at and updated_at both predate the effective date
//
// Replacement preview is sourced directly from KIS mode 0.
// No DB writes.
//
// Run:
//   node --env-file=.env.local .\scripts\v9722.cjs

const fs = require('node:fs');
const path = require('node:path');

const VERSION = 'V9_7_22_PROVEN_STALE_HISTORY_REFRESH_DRY_RUN';
const STOCK = '196450';
const ACTION = 'REVERSE_SPLIT';
const EXPECTED_STALE_ROWS = 24;
const RUN_VERSION = 'CORPORATE_ACTION_ADJUSTMENT_V9_7_19_VALIDATION';

const KIS_BASE = 'https://openapi.koreainvestment.com:9443';
const KIS_PATH =
  '/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice';
const TR_ID = 'FHKST03010100';

const MIN_GAP_MS = 1300;
const MAX_RATE_RETRIES = 6;
let lastKisRequestAt = 0;

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
      'KIS_APP_KEY', 'KIS_APPKEY',
      'KIS_REAL_APP_KEY', 'KIS_REAL_APPKEY',
      'KOREA_INVESTMENT_APP_KEY', 'KOREA_INVESTMENT_APPKEY'
    ]) ||
    regexEnv(/(?:^|_)KIS(?:_|.*)APP(?:_|)?KEY$/i, [/SECRET/i, /SUPABASE/i]);

  const appSecret =
    firstEnv([
      'KIS_APP_SECRET', 'KIS_APPSECRET',
      'KIS_REAL_APP_SECRET', 'KIS_REAL_APPSECRET',
      'KOREA_INVESTMENT_APP_SECRET', 'KOREA_INVESTMENT_APPSECRET'
    ]) ||
    regexEnv(/(?:^|_)KIS(?:_|.*)APP(?:_|)?SECRET$/i, [/SUPABASE/i]);

  if (!appKey) throw new Error('KIS_APP_KEY_REQUIRED');
  if (!appSecret) throw new Error('KIS_APP_SECRET_REQUIRED');

  return { appKey: appKey.value, appSecret: appSecret.value };
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

async function issueToken(appKey, appSecret) {
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
    const code =
      body?.error_code ||
      body?.error ||
      body?.msg_cd ||
      body?.rt_cd ||
      `HTTP_${res.status}`;

    throw new Error(
      `KIS_TOKEN_${String(code).replace(/[^A-Za-z0-9_]/g, '_').toUpperCase()}`
    );
  }

  return String(body.access_token);
}

async function sbGet(url, key) {
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
  try { body = text ? JSON.parse(text) : []; }
  catch { throw new Error('SUPABASE_INVALID_JSON'); }

  if (!res.ok) {
    const code = body?.code || `HTTP_${res.status}`;
    throw new Error(
      `SUPABASE_${String(code).replace(/[^A-Za-z0-9_]/g, '_').toUpperCase()}`
    );
  }

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
  const elapsed = Date.now() - lastKisRequestAt;
  if (elapsed < MIN_GAP_MS) {
    await sleep(MIN_GAP_MS - elapsed);
  }
}

async function kisOnce(stock, start, end, mode, token, appKey, appSecret) {
  await waitKisSlot();
  lastKisRequestAt = Date.now();

  const params = new URLSearchParams({
    FID_COND_MRKT_DIV_CODE: 'J',
    FID_INPUT_ISCD: stock,
    FID_INPUT_DATE_1: compact(start),
    FID_INPUT_DATE_2: compact(end),
    FID_PERIOD_DIV_CODE: 'D',
    FID_ORG_ADJ_PRC: mode
  });

  const res = await fetch(`${KIS_BASE}${KIS_PATH}?${params}`, {
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
  for (let attempt = 0; attempt <= MAX_RATE_RETRIES; attempt++) {
    try {
      return await kisOnce(
        stock, start, end, mode, token, appKey, appSecret
      );
    } catch (err) {
      if (err?.kisCode !== 'EGW00201' || attempt === MAX_RATE_RETRIES) {
        throw err;
      }

      await sleep(2000 + attempt * 700);
      lastKisRequestAt = 0;
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
    `&is_validation=eq.true` +
    `&production_applied=eq.false`,
    sb.key
  );

  if (runs.length !== 1) throw new Error('EXPECTED_ONE_VALIDATION_RUN');

  const factors = await sbGet(
    `${sb.url}/rest/v1/corporate_action_adjustment_factors` +
    `?select=${encodeURIComponent(
      'adjustment_run_id,stock_code,effective_date,action_event_id,action_type,event_price_factor,event_share_factor'
    )}` +
    `&adjustment_run_id=eq.${runs[0].id}` +
    `&stock_code=eq.${STOCK}` +
    `&action_type=eq.${ACTION}` +
    `&is_validation=eq.true` +
    `&production_applied=eq.false`,
    sb.key
  );

  if (factors.length !== 1) throw new Error('EXPECTED_ONE_VALIDATION_FACTOR');
  return factors[0];
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
        'proven-stale-history-refresh-dry-run-v9-7-22.json'
      );

  const sb = supabase();
  const c = credentials();
  const tok = existingToken();
  const accessToken = tok
    ? tok.value
    : await issueToken(c.appKey, c.appSecret);

  const factorRow = await readFactor(sb);

  if (factorRow.stock_code !== STOCK || factorRow.action_type !== ACTION) {
    throw new Error('UNEXPECTED_FACTOR_IDENTITY');
  }

  const effectiveDate = String(factorRow.effective_date);
  const eventPriceFactor = Number(factorRow.event_price_factor);

  if (!(eventPriceFactor > 0)) {
    throw new Error('INVALID_EVENT_PRICE_FACTOR');
  }

  // Exact provenance-audit window used in v9.7.21.3.1.
  const start = addDays(effectiveDate, -45);
  const end = addDays(effectiveDate, -1);

  const dbRows = await readDbRows(sb, start, end);

  const mode0 = await kis(
    STOCK, start, end, '0',
    accessToken, c.appKey, c.appSecret
  );

  const mode1 = await kis(
    STOCK, start, end, '1',
    accessToken, c.appKey, c.appSecret
  );

  const adjustedMap = new Map(mode0.map(x => [x.date, x]));
  const originalMap = new Map(mode1.map(x => [x.date, x]));

  const classifications = [];
  const replacementRows = [];

  for (const db of dbRows) {
    const date = compact(db.trading_date);
    const adjusted = adjustedMap.get(date) || null;
    const original = originalMap.get(date) || null;

    const matchesOriginal = sameOhlcv(db, original);
    const matchesAdjusted = sameOhlcv(db, adjusted);
    const transformsToAdjusted =
      factorTransforms(db, adjusted, eventPriceFactor);

    const collectedBefore =
      timestampBefore(db.collected_at, effectiveDate);
    const updatedBefore =
      timestampBefore(db.updated_at, effectiveDate);

    const provenStale =
      matchesOriginal &&
      !matchesAdjusted &&
      transformsToAdjusted &&
      collectedBefore &&
      updatedBefore;

    classifications.push({
      tradingDate: db.trading_date,
      provenStale,
      matchesCurrentOriginalMode1: matchesOriginal,
      matchesCurrentAdjustedMode0: matchesAdjusted,
      eventFactorTransformsToMode0: transformsToAdjusted,
      collectedBeforeEffectiveDate: collectedBefore,
      updatedBeforeEffectiveDate: updatedBefore,
      current: {
        open: Number(db.open_price),
        high: Number(db.high_price),
        low: Number(db.low_price),
        close: Number(db.close_price),
        volume: Number(db.volume),
        tradingValue:
          db.trading_value == null ? null : Number(db.trading_value),
        source: db.source,
        adjusted_price: db.adjusted_price,
        collected_at: db.collected_at,
        updated_at: db.updated_at
      },
      proposed: adjusted ? {
        open: adjusted.open,
        high: adjusted.high,
        low: adjusted.low,
        close: adjusted.close,
        volume: adjusted.volume,
        tradingValue: adjusted.tradingValue
      } : null
    });

    if (!provenStale) continue;

    if (!adjusted || !validOhlcv(adjusted)) {
      throw new Error('INVALID_MODE0_REPLACEMENT_ROW');
    }

    replacementRows.push({
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
      // Preserve original collection provenance; only an eventual apply
      // should advance updated_at.
      collected_at: db.collected_at
    });
  }

  const provenStaleRows =
    classifications.filter(x => x.provenStale);

  const nonStaleRows =
    classifications.filter(x => !x.provenStale);

  const uniqueReplacementDates =
    new Set(replacementRows.map(x => x.trading_date));

  const allReplacementRowsDifferFromLive =
    provenStaleRows.every(x => {
      const p = x.proposed;
      const c = x.current;
      return !!p && (
        p.open !== c.open ||
        p.high !== c.high ||
        p.low !== c.low ||
        p.close !== c.close ||
        p.volume !== c.volume
      );
    });

  const allReplacementRowsValid =
    replacementRows.every(r =>
      validOhlcv({
        open: r.open_price,
        high: r.high_price,
        low: r.low_price,
        close: r.close_price,
        volume: r.volume
      })
    );

  const ready =
    dbRows.length === EXPECTED_STALE_ROWS &&
    provenStaleRows.length === EXPECTED_STALE_ROWS &&
    nonStaleRows.length === 0 &&
    replacementRows.length === EXPECTED_STALE_ROWS &&
    uniqueReplacementDates.size === EXPECTED_STALE_ROWS &&
    allReplacementRowsDifferFromLive &&
    allReplacementRowsValid;

  const report = {
    version: VERSION,
    status: ready
      ? 'PROVEN_STALE_HISTORY_REFRESH_DRY_RUN_READY'
      : 'PROVEN_STALE_HISTORY_REFRESH_REVIEW_REQUIRED',
    scope: {
      stockCode: STOCK,
      actionType: ACTION,
      effectiveDate,
      eventPriceFactor,
      start,
      end
    },
    summary: {
      dbRowsInScope: dbRows.length,
      kisAdjustedMode0Rows: mode0.length,
      kisOriginalMode1Rows: mode1.length,
      provenStaleRows: provenStaleRows.length,
      nonStaleRows: nonStaleRows.length,
      replacementRows: replacementRows.length,
      uniqueReplacementDates: uniqueReplacementDates.size,
      allReplacementRowsDifferFromLive,
      allReplacementRowsValid,
      falseAdjustedFlagsToRepair:
        provenStaleRows.filter(
          x => x.current.adjusted_price === true
        ).length
    },
    classifications,
    replacementPreview: replacementRows,
    policy: {
      refreshSource: 'KIS_MODE_0_ADJUSTED_PRICE',
      conflictIdentity: 'UNIQUE(stock_code,trading_date)',
      preserveCollectedAt: true,
      eventualApplyUpdatesUpdatedAt: true,
      doNotTouchStocks: ['038060', '183300', '215790', '276730'],
      doNotApplyCorporateActionFactorToAlreadyAdjustedRows: true
    },
    safety: {
      databaseHttpMethods: ['GET'],
      kisHttpMethods: tok ? ['GET'] : ['POST_TOKEN', 'GET'],
      writesPerformed: 0,
      marketBarsUpdated: 0,
      marketBarsInserted: 0,
      adjustmentRowsUpdated: 0,
      coveragePromoted: false,
      secretsWrittenToReport: false
    },
    nextGate: ready
      ? 'BUILD_CONTROLLED_IDEMPOTENT_APPLY_FOR_THESE_EXACT_24_ROWS'
      : 'REVIEW_SCOPE_OR_PROVENANCE_BEFORE_ANY_WRITE'
  };

  saveJson(outputFile, report);

  console.log(JSON.stringify({
    status: report.status,
    stockCode: STOCK,
    effectiveDate,
    eventPriceFactor,
    dbRowsInScope: report.summary.dbRowsInScope,
    kisAdjustedMode0Rows: report.summary.kisAdjustedMode0Rows,
    kisOriginalMode1Rows: report.summary.kisOriginalMode1Rows,
    provenStaleRows: report.summary.provenStaleRows,
    nonStaleRows: report.summary.nonStaleRows,
    replacementRows: report.summary.replacementRows,
    uniqueReplacementDates: report.summary.uniqueReplacementDates,
    allReplacementRowsDifferFromLive:
      report.summary.allReplacementRowsDifferFromLive,
    allReplacementRowsValid:
      report.summary.allReplacementRowsValid,
    falseAdjustedFlagsToRepair:
      report.summary.falseAdjustedFlagsToRepair,
    writesPerformed: 0,
    coveragePromoted: false
  }, null, 2));

  console.log(
    'Upload only this report (never upload .env files): ' + outputFile
  );

  if (!ready) process.exitCode = 2;
}

main().catch(err => {
  console.error(
    String(err?.message || err)
      .replace(/[^A-Za-z0-9_]/g, '_')
      .toUpperCase()
  );
  process.exitCode = 1;
});
