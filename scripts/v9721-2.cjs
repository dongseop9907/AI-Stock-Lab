'use strict';

// V9.7.21.2 read-only row-level KIS price-basis classifier.
//
// Exact endpoint contract used by this project:
//   /uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice
//   FID_ORG_ADJ_PRC=0 -> adjusted price (수정주가)
//   FID_ORG_ADJ_PRC=1 -> original price (원주가)
//
// Goal:
//   For the 5 validation STOCK_SPLIT / REVERSE_SPLIT events:
//   - fetch DB bars around the event
//   - fetch KIS mode 0 and mode 1 for same window
//   - classify each overlapping DB row:
//       ADJUSTED_MODE_0
//       ORIGINAL_MODE_1
//       BOTH_MODES_IDENTICAL
//       NEITHER
//   - expose DB source / adjusted_price / raw_payload.mod_yn
//
// No DB writes.
//
// Run:
//   node --env-file=.env.local .\scripts\v9721-2.cjs

const fs = require('node:fs');
const path = require('node:path');

const VERSION = 'V9_7_21_2_ROW_LEVEL_PRICE_BASIS_CLASSIFIER';
const KIS_BASE = 'https://openapi.koreainvestment.com:9443';
const KIS_PATH =
  '/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice';
const TR_ID = 'FHKST03010100';
const RUN_VERSION = 'CORPORATE_ACTION_ADJUSTMENT_V9_7_19_VALIDATION';

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

  return {
    appKey: appKey.value,
    appSecret: appSecret.value,
    appKeyEnvName: appKey.name,
    appSecretEnvName: appSecret.name
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
  return { url: String(url).replace(/\/+$/, ''), key: String(key) };
}

async function tokenP(appKey, appSecret) {
  const r = await fetch(`${KIS_BASE}/oauth2/tokenP`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      appkey: appKey,
      appsecret: appSecret
    })
  });

  const t = await r.text();
  let b;
  try { b = JSON.parse(t); }
  catch { throw new Error('KIS_TOKEN_INVALID_JSON'); }

  if (!r.ok || !b?.access_token) {
    const code =
      b?.error_code || b?.error || b?.msg_cd || b?.rt_cd || `HTTP_${r.status}`;
    throw new Error(
      `KIS_TOKEN_${String(code).replace(/[^A-Za-z0-9_]/g, '_').toUpperCase()}`
    );
  }

  return String(b.access_token);
}

async function sbGet(url, key) {
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
  catch { throw new Error('SUPABASE_INVALID_JSON'); }
  if (!r.ok) {
    throw new Error(
      `SUPABASE_${String(b?.code || `HTTP_${r.status}`)
        .replace(/[^A-Za-z0-9_]/g, '_').toUpperCase()}`
    );
  }
  if (!Array.isArray(b)) throw new Error('SUPABASE_EXPECTED_ARRAY');
  return b;
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

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

async function splitFactors(sb) {
  const runs = await sbGet(
    `${sb.url}/rest/v1/corporate_action_adjustment_runs` +
    `?select=${encodeURIComponent('id')}` +
    `&version=eq.${encodeURIComponent(RUN_VERSION)}` +
    `&is_validation=eq.true&production_applied=eq.false`,
    sb.key
  );

  if (runs.length !== 15) throw new Error('EXPECTED_15_VALIDATION_RUNS');

  const ids = runs.map(x => x.id).join(',');
  const factors = await sbGet(
    `${sb.url}/rest/v1/corporate_action_adjustment_factors` +
    `?select=${encodeURIComponent(
      'adjustment_run_id,stock_code,effective_date,action_type,event_price_factor,event_share_factor'
    )}` +
    `&adjustment_run_id=in.(${ids})` +
    `&action_type=in.(STOCK_SPLIT,REVERSE_SPLIT)` +
    `&is_validation=eq.true&production_applied=eq.false` +
    `&order=stock_code.asc`,
    sb.key
  );

  if (factors.length !== 5) throw new Error('EXPECTED_5_SPLIT_FACTORS');
  return factors;
}

async function dbBars(sb, stock, start, end) {
  return sbGet(
    `${sb.url}/rest/v1/market_daily_bars` +
    `?select=${encodeURIComponent(
      'stock_code,trading_date,open_price,high_price,low_price,close_price,volume,trading_value,source,adjusted_price,raw_payload'
    )}` +
    `&stock_code=eq.${encodeURIComponent(stock)}` +
    `&trading_date=gte.${encodeURIComponent(start)}` +
    `&trading_date=lte.${encodeURIComponent(end)}` +
    `&order=trading_date.asc`,
    sb.key
  );
}

async function kisBars(stock, start, end, mode, token, appKey, appSecret) {
  const q = new URLSearchParams({
    FID_COND_MRKT_DIV_CODE: 'J',
    FID_INPUT_ISCD: stock,
    FID_INPUT_DATE_1: compact(start),
    FID_INPUT_DATE_2: compact(end),
    FID_PERIOD_DIV_CODE: 'D',
    FID_ORG_ADJ_PRC: mode
  });

  const r = await fetch(`${KIS_BASE}${KIS_PATH}?${q}`, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      authorization: `Bearer ${token}`,
      appkey: appKey,
      appsecret: appSecret,
      tr_id: TR_ID,
      custtype: 'P'
    }
  });

  const t = await r.text();
  let b;
  try { b = JSON.parse(t); }
  catch { throw new Error('KIS_DAILY_INVALID_JSON'); }

  if (!r.ok || (b?.rt_cd !== undefined && String(b.rt_cd) !== '0')) {
    const code = b?.msg_cd || b?.error_code || b?.rt_cd || `HTTP_${r.status}`;
    throw new Error(
      `KIS_DAILY_${String(code).replace(/[^A-Za-z0-9_]/g, '_').toUpperCase()}`
    );
  }

  const rows = Array.isArray(b?.output2) ? b.output2 : [];
  return rows.map(x => ({
    date: String(x.stck_bsop_date || ''),
    open: Number(x.stck_oprc),
    high: Number(x.stck_hgpr),
    low: Number(x.stck_lwpr),
    close: Number(x.stck_clpr),
    volume: Number(x.acml_vol),
    tradingValue:
      x.acml_tr_pbmn === '' || x.acml_tr_pbmn == null
        ? null
        : Number(x.acml_tr_pbmn),
    modYn: x.mod_yn ?? null,
    revisionReason: x.revl_issu_reas ?? null
  })).filter(x => x.date >= compact(start) && x.date <= compact(end))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function dbComparable(x) {
  return {
    date: compact(x.trading_date),
    open: Number(x.open_price),
    high: Number(x.high_price),
    low: Number(x.low_price),
    close: Number(x.close_price),
    volume: Number(x.volume)
  };
}

function kisComparable(x) {
  return {
    date: x.date,
    open: x.open,
    high: x.high,
    low: x.low,
    close: x.close,
    volume: x.volume
  };
}

function sameOhlcv(a, b) {
  return !!a && !!b &&
    a.date === b.date &&
    a.open === b.open &&
    a.high === b.high &&
    a.low === b.low &&
    a.close === b.close &&
    a.volume === b.volume;
}

function classifyRow(db, m0, m1) {
  const d = dbComparable(db);
  const z = m0 ? kisComparable(m0) : null;
  const o = m1 ? kisComparable(m1) : null;
  const eq0 = sameOhlcv(d, z);
  const eq1 = sameOhlcv(d, o);

  if (eq0 && eq1) return 'BOTH_MODES_IDENTICAL';
  if (eq0) return 'ADJUSTED_MODE_0';
  if (eq1) return 'ORIGINAL_MODE_1';
  return 'NEITHER';
}

function counts(rows) {
  const out = {};
  for (const r of rows) out[r.classification] = (out[r.classification] || 0) + 1;
  return out;
}

async function sleep(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
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
    : path.join(root, 'logs', 'row-level-price-basis-v9-7-21-2.json');

  const sb = supabase();
  const c = credentials();
  const tokenEnv = existingToken();
  const token = tokenEnv
    ? tokenEnv.value
    : await tokenP(c.appKey, c.appSecret);

  const factors = await splitFactors(sb);
  const targets = [];

  for (const f of factors) {
    const start = addDays(String(f.effective_date), -30);
    const requestedEnd = addDays(String(f.effective_date), 14);
    const end = requestedEnd < todayIso() ? requestedEnd : todayIso();

    const [db, mode0, mode1] = await Promise.all([
      dbBars(sb, f.stock_code, start, end),
      kisBars(f.stock_code, start, end, '0', token, c.appKey, c.appSecret),
      kisBars(f.stock_code, start, end, '1', token, c.appKey, c.appSecret)
    ]);

    await sleep(450);

    const m0 = new Map(mode0.map(x => [x.date, x]));
    const m1 = new Map(mode1.map(x => [x.date, x]));

    const classified = db.map(row => {
      const date = compact(row.trading_date);
      const a = m0.get(date) || null;
      const b = m1.get(date) || null;
      return {
        tradingDate: row.trading_date,
        classification: classifyRow(row, a, b),
        db: {
          open: Number(row.open_price),
          high: Number(row.high_price),
          low: Number(row.low_price),
          close: Number(row.close_price),
          volume: Number(row.volume),
          source: row.source,
          adjusted_price: row.adjusted_price,
          raw_payload_mod_yn: row.raw_payload?.mod_yn ?? null
        },
        kisMode0Adjusted: a ? kisComparable(a) : null,
        kisMode1Original: b ? kisComparable(b) : null
      };
    });

    const basisCounts = counts(classified);
    const decisiveAdjusted = basisCounts.ADJUSTED_MODE_0 || 0;
    const decisiveOriginal = basisCounts.ORIGINAL_MODE_1 || 0;
    const both = basisCounts.BOTH_MODES_IDENTICAL || 0;
    const neither = basisCounts.NEITHER || 0;

    let stockBasis = 'NO_DB_COVERAGE';
    if (db.length) {
      if (decisiveAdjusted > 0 && decisiveOriginal === 0 && neither === 0) {
        stockBasis = 'ADJUSTED';
      } else if (decisiveOriginal > 0 && decisiveAdjusted === 0 && neither === 0) {
        stockBasis = 'ORIGINAL';
      } else if (decisiveAdjusted > 0 && decisiveOriginal > 0) {
        stockBasis = 'MIXED_WITHIN_STOCK_WINDOW';
      } else if (decisiveAdjusted === 0 && decisiveOriginal === 0 && both > 0 && neither === 0) {
        stockBasis = 'AMBIGUOUS_BOTH_MODES_IDENTICAL';
      } else {
        stockBasis = 'REVIEW_REQUIRED';
      }
    }

    targets.push({
      stockCode: f.stock_code,
      actionType: f.action_type,
      effectiveDate: f.effective_date,
      eventPriceFactor: Number(f.event_price_factor),
      window: { start, end },
      dbRows: db.length,
      kisMode0AdjustedRows: mode0.length,
      kisMode1OriginalRows: mode1.length,
      stockBasis,
      basisCounts,
      dbSources: [...new Set(db.map(x => x.source))],
      adjustedPriceFlags: [...new Set(db.map(x => x.adjusted_price))],
      rawPayloadModYnValues: [...new Set(
        db.map(x => x.raw_payload?.mod_yn).filter(x => x !== undefined)
      )],
      rows: classified
    });
  }

  const adjustedStocks = targets.filter(x => x.stockBasis === 'ADJUSTED').length;
  const originalStocks = targets.filter(x => x.stockBasis === 'ORIGINAL').length;
  const mixedStocks = targets.filter(x => x.stockBasis === 'MIXED_WITHIN_STOCK_WINDOW').length;
  const noCoverageStocks = targets.filter(x => x.stockBasis === 'NO_DB_COVERAGE').length;
  const reviewStocks = targets.filter(x =>
    !['ADJUSTED','ORIGINAL','MIXED_WITHIN_STOCK_WINDOW','NO_DB_COVERAGE']
      .includes(x.stockBasis)
  ).length;

  const falseAdjustedFlags = targets.flatMap(t =>
    t.rows
      .filter(r => r.classification === 'ORIGINAL_MODE_1' && r.db.adjusted_price === true)
      .map(r => ({
        stockCode: t.stockCode,
        tradingDate: r.tradingDate,
        source: r.db.source,
        adjusted_price: r.db.adjusted_price,
        classification: r.classification
      }))
  );

  const report = {
    version: VERSION,
    status: 'ROW_LEVEL_PRICE_BASIS_CLASSIFIED',
    endpointContract: {
      apiPath: KIS_PATH,
      fidOrgAdjPrc0: 'ADJUSTED_PRICE',
      fidOrgAdjPrc1: 'ORIGINAL_PRICE'
    },
    summary: {
      targetStocks: targets.length,
      adjustedStocks,
      originalStocks,
      mixedWithinStockWindow: mixedStocks,
      noDbCoverageStocks: noCoverageStocks,
      reviewStocks,
      originalRowsIncorrectlyFlaggedAdjusted:
        falseAdjustedFlags.length
    },
    targets,
    falseAdjustedFlags,
    contractImplication: {
      tableBasisIsUniform:
        originalStocks === 0 &&
        mixedStocks === 0 &&
        falseAdjustedFlags.length === 0,
      adjustedPriceBooleanTrusted:
        falseAdjustedFlags.length === 0,
      productionAdjustmentSafe:
        false,
      reason:
        'Do not consume corporate-action factors against market_daily_bars until all stored rows have one explicit price-basis policy.'
    },
    safety: {
      databaseHttpMethods: ['GET'],
      kisHttpMethods:
        tokenEnv ? ['GET'] : ['POST_TOKEN', 'GET'],
      writesPerformed: 0,
      marketBarsUpdated: 0,
      coveragePromoted: false,
      secretsWrittenToReport: false
    },
    nextGate:
      falseAdjustedFlags.length > 0 || originalStocks > 0 || mixedStocks > 0
        ? 'DESIGN_CONTROLLED_STANDARDIZATION_TO_KIS_MODE_0_ADJUSTED'
        : 'LOCK_ADJUSTED_PRICE_BASIS_CONTRACT'
  };

  saveJson(outputFile, report);

  console.log(JSON.stringify({
    status: report.status,
    ...report.summary,
    targets: targets.map(x => ({
      stockCode: x.stockCode,
      actionType: x.actionType,
      effectiveDate: x.effectiveDate,
      dbRows: x.dbRows,
      stockBasis: x.stockBasis,
      basisCounts: x.basisCounts,
      dbSources: x.dbSources,
      adjustedPriceFlags: x.adjustedPriceFlags,
      rawPayloadModYnValues: x.rawPayloadModYnValues
    })),
    falseAdjustedFlags,
    tableBasisIsUniform: report.contractImplication.tableBasisIsUniform,
    adjustedPriceBooleanTrusted: report.contractImplication.adjustedPriceBooleanTrusted,
    writesPerformed: 0,
    coveragePromoted: false
  }, null, 2));

  console.log(
    'Upload only this report (never upload .env files): ' + outputFile
  );
}

main().catch(err => {
  console.error(
    String(err?.message || err)
      .replace(/[^A-Za-z0-9_]/g, '_')
      .toUpperCase()
  );
  process.exitCode = 1;
});
