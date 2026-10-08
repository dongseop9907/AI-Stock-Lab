'use strict';

// V9.7.21.4 focused read-only diagnostic for stock 038060.
//
// Goal:
//   Resolve why KIS adjusted/original modes are identical around the
//   REVERSE_SPLIT validation event.
//
// Checks:
//   - corporate_action_events exact event row + metadata
//   - wider KIS mode0/mode1 window
//   - first/last date where modes differ
//   - DB coverage dates and basis classification
//   - whether the event effective_date aligns with any KIS basis transition
//
// No DB writes.
//
// Run:
//   node --env-file=.env.local .\scripts\v9721-4.cjs

const fs = require('node:fs');
const path = require('node:path');

const VERSION = 'V9_7_21_4_FOCUSED_038060_BASIS_DIAGNOSTIC';
const STOCK = '038060';
const KIS_BASE = 'https://openapi.koreainvestment.com:9443';
const KIS_PATH =
  '/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice';
const TR_ID = 'FHKST03010100';

const MIN_GAP_MS = 1300;
const MAX_RETRIES = 6;
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

function creds() {
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

  return { appKey: appKey.value, appSecret: appSecret.value };
}

function tokenEnv() {
  return firstEnv([
    'KIS_ACCESS_TOKEN','KIS_TOKEN','KIS_REAL_ACCESS_TOKEN',
    'KOREA_INVESTMENT_ACCESS_TOKEN'
  ]);
}

function sb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('SUPABASE_URL_REQUIRED');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY_REQUIRED');
  return { url: String(url).replace(/\/+$/, ''), key: String(key) };
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function issueToken(appKey, appSecret) {
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
  const b = JSON.parse(t);

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
  const [y,m,d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0,10);
}

function todayIso() {
  return new Date().toISOString().slice(0,10);
}

async function waitSlot() {
  const elapsed = Date.now() - lastKisAt;
  if (elapsed < MIN_GAP_MS) {
    await sleep(MIN_GAP_MS - elapsed);
  }
}

async function kisOnce(stock, start, end, mode, token, appKey, appSecret) {
  await waitSlot();
  lastKisAt = Date.now();

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

  const ok = r.ok && (b?.rt_cd === undefined || String(b.rt_cd) === '0');

  if (!ok) {
    const code = String(
      b?.msg_cd || b?.error_code || b?.rt_cd || `HTTP_${r.status}`
    );
    const err = new Error(
      `KIS_DAILY_${code.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase()}`
    );
    err.kisCode = code;
    throw err;
  }

  const rows = Array.isArray(b?.output2) ? b.output2 : [];

  return rows.map(x => ({
    date: String(x.stck_bsop_date || ''),
    open: Number(x.stck_oprc),
    high: Number(x.stck_hgpr),
    low: Number(x.stck_lwpr),
    close: Number(x.stck_clpr),
    volume: Number(x.acml_vol),
    modYn: x.mod_yn ?? null,
    revisionReason: x.revl_issu_reas ?? null
  }))
  .filter(x => x.date >= compact(start) && x.date <= compact(end))
  .sort((a,b) => a.date.localeCompare(b.date));
}

async function kis(stock, start, end, mode, token, appKey, appSecret) {
  for (let i = 0; i <= MAX_RETRIES; i++) {
    try {
      return await kisOnce(stock, start, end, mode, token, appKey, appSecret);
    } catch (e) {
      if (e?.kisCode !== 'EGW00201' || i === MAX_RETRIES) throw e;
      await sleep(2000 + i * 700);
      lastKisAt = 0;
    }
  }
  throw new Error('KIS_RETRY_EXHAUSTED');
}

function same(a,b) {
  return !!a && !!b &&
    a.open === b.open &&
    a.high === b.high &&
    a.low === b.low &&
    a.close === b.close &&
    a.volume === b.volume;
}

function dbSame(db, kisRow) {
  return !!db && !!kisRow &&
    Number(db.open_price) === kisRow.open &&
    Number(db.high_price) === kisRow.high &&
    Number(db.low_price) === kisRow.low &&
    Number(db.close_price) === kisRow.close &&
    Number(db.volume) === kisRow.volume;
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
    : path.join(root, 'logs', 'focused-038060-basis-v9-7-21-4.json');

  const supa = sb();
  const c = creds();
  const te = tokenEnv();
  const token = te ? te.value : await issueToken(c.appKey, c.appSecret);

  const events = await sbGet(
    `${supa.url}/rest/v1/corporate_action_events` +
    `?select=${encodeURIComponent(
      'id,stock_code,action_type,effective_date,ratio_from,ratio_to,provider_event_id,metadata,status,is_validation,production_applied'
    )}` +
    `&stock_code=eq.${STOCK}` +
    `&action_type=eq.REVERSE_SPLIT` +
    `&provider=eq.DART_KRX_CANONICAL` +
    `&is_validation=eq.true` +
    `&production_applied=eq.false`,
    supa.key
  );

  if (events.length !== 1) throw new Error('EXPECTED_ONE_038060_EVENT');

  const event = events[0];
  const effective = String(event.effective_date);

  // Wider window than prior probes.
  const start = addDays(effective, -120);
  const end = todayIso();

  const db = await sbGet(
    `${supa.url}/rest/v1/market_daily_bars` +
    `?select=${encodeURIComponent(
      'trading_date,open_price,high_price,low_price,close_price,volume,source,adjusted_price,raw_payload,collected_at,updated_at'
    )}` +
    `&stock_code=eq.${STOCK}` +
    `&trading_date=gte.${encodeURIComponent(start)}` +
    `&trading_date=lte.${encodeURIComponent(end)}` +
    `&order=trading_date.asc`,
    supa.key
  );

  const mode0 = await kis(STOCK, start, end, '0', token, c.appKey, c.appSecret);
  const mode1 = await kis(STOCK, start, end, '1', token, c.appKey, c.appSecret);

  const m0 = new Map(mode0.map(x => [x.date, x]));
  const m1 = new Map(mode1.map(x => [x.date, x]));

  const allDates = [...new Set([...m0.keys(), ...m1.keys()])].sort();

  const modeDiffs = [];
  for (const d of allDates) {
    const a = m0.get(d) || null;
    const b = m1.get(d) || null;
    if (!same(a,b)) {
      modeDiffs.push({
        date: d,
        mode0Adjusted: a,
        mode1Original: b
      });
    }
  }

  const dbRows = db.map(r => {
    const d = compact(r.trading_date);
    const a = m0.get(d) || null;
    const b = m1.get(d) || null;

    let classification = 'NEITHER';
    const eq0 = dbSame(r,a);
    const eq1 = dbSame(r,b);

    if (eq0 && eq1) classification = 'BOTH_MODES_IDENTICAL';
    else if (eq0) classification = 'ADJUSTED_MODE_0';
    else if (eq1) classification = 'ORIGINAL_MODE_1';

    return {
      tradingDate: r.trading_date,
      classification,
      dbClose: Number(r.close_price),
      mode0Close: a?.close ?? null,
      mode1Close: b?.close ?? null,
      source: r.source,
      adjustedPriceFlag: r.adjusted_price,
      rawPayloadModYn: r.raw_payload?.mod_yn ?? null,
      collectedAt: r.collected_at,
      updatedAt: r.updated_at
    };
  });

  const basisCounts = {};
  for (const r of dbRows) {
    basisCounts[r.classification] = (basisCounts[r.classification] || 0) + 1;
  }

  const effectiveCompact = compact(effective);

  const beforeDiffs = modeDiffs.filter(x => x.date < effectiveCompact);
  const onOrAfterDiffs = modeDiffs.filter(x => x.date >= effectiveCompact);

  let conclusion = 'REVIEW_REQUIRED';

  if (modeDiffs.length === 0) {
    conclusion = 'KIS_MODES_IDENTICAL_ACROSS_WIDE_WINDOW';
  } else if (beforeDiffs.length > 0 && onOrAfterDiffs.length === 0) {
    conclusion = 'KIS_MODES_DIFFER_ONLY_BEFORE_EFFECTIVE_DATE';
  } else if (beforeDiffs.length === 0 && onOrAfterDiffs.length > 0) {
    conclusion = 'KIS_MODES_DIFFER_ONLY_ON_OR_AFTER_EFFECTIVE_DATE';
  } else {
    conclusion = 'KIS_MODES_DIFFER_ACROSS_BOTH_SIDES_OF_EVENT';
  }

  const report = {
    version: VERSION,
    status: 'FOCUSED_038060_BASIS_DIAGNOSTIC_COMPLETE',
    event,
    window: { start, end },
    summary: {
      dbRows: dbRows.length,
      kisMode0Rows: mode0.length,
      kisMode1Rows: mode1.length,
      modeDifferenceDates: modeDiffs.length,
      firstModeDifferenceDate: modeDiffs[0]?.date ?? null,
      lastModeDifferenceDate: modeDiffs.at(-1)?.date ?? null,
      beforeEffectiveDifferenceDates: beforeDiffs.length,
      onOrAfterEffectiveDifferenceDates: onOrAfterDiffs.length,
      dbBasisCounts: basisCounts,
      conclusion
    },
    dbRows,
    modeDifferences: modeDiffs,
    interpretation: {
      ifModesIdentical:
        'KIS adjusted/original modes cannot distinguish basis for this event/window; do not infer stale or original basis from adjusted_price flag alone.',
      ifModesDifferBeforeEffective:
        'Use row-level DB-vs-KIS comparison to classify stale history.',
      safePolicy:
        'Do not refresh 038060 until KIS mode divergence or another authoritative basis signal exists.'
    },
    safety: {
      databaseHttpMethods: ['GET'],
      kisHttpMethods: te ? ['GET'] : ['POST_TOKEN','GET'],
      writesPerformed: 0,
      coveragePromoted: false
    }
  };

  saveJson(outputFile, report);

  console.log(JSON.stringify({
    status: report.status,
    stockCode: STOCK,
    actionType: event.action_type,
    effectiveDate: effective,
    ratioFrom: event.ratio_from,
    ratioTo: event.ratio_to,
    dbRows: report.summary.dbRows,
    kisMode0Rows: report.summary.kisMode0Rows,
    kisMode1Rows: report.summary.kisMode1Rows,
    modeDifferenceDates: report.summary.modeDifferenceDates,
    firstModeDifferenceDate: report.summary.firstModeDifferenceDate,
    lastModeDifferenceDate: report.summary.lastModeDifferenceDate,
    beforeEffectiveDifferenceDates:
      report.summary.beforeEffectiveDifferenceDates,
    onOrAfterEffectiveDifferenceDates:
      report.summary.onOrAfterEffectiveDifferenceDates,
    dbBasisCounts: report.summary.dbBasisCounts,
    conclusion: report.summary.conclusion,
    writesPerformed: 0,
    coveragePromoted: false
  }, null, 2));

  console.log(
    'Upload only this report (never upload .env files): ' + outputFile
  );
}

main().catch(e => {
  console.error(
    String(e?.message || e)
      .replace(/[^A-Za-z0-9_]/g, '_')
      .toUpperCase()
  );
  process.exitCode = 1;
});
