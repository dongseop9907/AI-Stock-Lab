'use strict';

// V9.7.21.3 read-only stale-history vs ingestion-mode provenance audit.
//
// Goal:
//   Distinguish:
//     A) "196450 was ingested using original-price mode", from
//     B) "196450 was ingested before the reverse split and its old history
//        was never refreshed after KIS retroactively adjusted history".
//
// Evidence:
//   - DB collected_at / updated_at relative to effective_date
//   - current KIS mode0(adjusted) / mode1(original)
//   - whether current KIS mode0 ~= DB * event_price_factor
//   - whether DB == current KIS mode1
//
// No DB writes.
//
// Run:
//   node --env-file=.env.local .\scripts\v9721-3.cjs

const path = require('node:path');
const fs = require('node:fs');

const VERSION = 'V9_7_21_3_STALE_HISTORY_PROVENANCE_AUDIT';
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
    'KIS_ACCESS_TOKEN','KIS_TOKEN','KIS_REAL_ACCESS_TOKEN',
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
  const [y,m,d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0,10);
}

function todayIso() {
  return new Date().toISOString().slice(0,10);
}

async function factors(sb) {
  const runs = await sbGet(
    `${sb.url}/rest/v1/corporate_action_adjustment_runs` +
    `?select=${encodeURIComponent('id')}` +
    `&version=eq.${encodeURIComponent(RUN_VERSION)}` +
    `&is_validation=eq.true&production_applied=eq.false`,
    sb.key
  );

  const ids = runs.map(x => x.id).join(',');

  return sbGet(
    `${sb.url}/rest/v1/corporate_action_adjustment_factors` +
    `?select=${encodeURIComponent(
      'stock_code,effective_date,action_type,event_price_factor,event_share_factor'
    )}` +
    `&adjustment_run_id=in.(${ids})` +
    `&action_type=in.(STOCK_SPLIT,REVERSE_SPLIT)` +
    `&is_validation=eq.true&production_applied=eq.false` +
    `&order=stock_code.asc`,
    sb.key
  );
}

async function dbBars(sb, stock, start, end) {
  return sbGet(
    `${sb.url}/rest/v1/market_daily_bars` +
    `?select=${encodeURIComponent(
      'stock_code,trading_date,open_price,high_price,low_price,close_price,volume,source,adjusted_price,raw_payload,collected_at,created_at,updated_at'
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
    volume: Number(x.acml_vol)
  })).filter(x => x.date >= compact(start) && x.date <= compact(end))
    .sort((a,b) => a.date.localeCompare(b.date));
}

function same(a,b) {
  return !!a && !!b &&
    Number(a.open_price) === b.open &&
    Number(a.high_price) === b.high &&
    Number(a.low_price) === b.low &&
    Number(a.close_price) === b.close &&
    Number(a.volume) === b.volume;
}

function approx(a,b,tol=1e-9) {
  return Math.abs(a-b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
}

function scaledMatches(db, adjusted, factor) {
  if (!db || !adjusted) return false;

  // Price should scale by event price factor.
  // Volume is intentionally not included in this proof because vendor
  // volume adjustment conventions can differ.
  return (
    approx(Number(db.open_price) * factor, adjusted.open, 1e-6) &&
    approx(Number(db.high_price) * factor, adjusted.high, 1e-6) &&
    approx(Number(db.low_price) * factor, adjusted.low, 1e-6) &&
    approx(Number(db.close_price) * factor, adjusted.close, 1e-6)
  );
}

function tsBeforeEffective(ts, effectiveDate) {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;

  const effective = new Date(`${effectiveDate}T00:00:00Z`);
  return d.getTime() < effective.getTime();
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
    : path.join(root, 'logs', 'stale-history-provenance-v9-7-21-3.json');

  const sb = supabase();
  const c = credentials();
  const tok = existingToken();
  const token = tok ? tok.value : await issueToken(c.appKey, c.appSecret);

  const fsplits = await factors(sb);
  if (fsplits.length !== 5) throw new Error('EXPECTED_5_SPLIT_FACTORS');

  const results = [];

  for (const f of fsplits) {
    const start = addDays(String(f.effective_date), -45);
    const requestedEnd = addDays(String(f.effective_date), 10);
    const end = requestedEnd < todayIso() ? requestedEnd : todayIso();

    const [db, m0, m1] = await Promise.all([
      dbBars(sb, f.stock_code, start, end),
      kisBars(f.stock_code, start, end, '0', token, c.appKey, c.appSecret),
      kisBars(f.stock_code, start, end, '1', token, c.appKey, c.appSecret)
    ]);

    const z = new Map(m0.map(x => [x.date, x]));
    const o = new Map(m1.map(x => [x.date, x]));
    const factor = Number(f.event_price_factor);

    const rows = db.map(r => {
      const d = compact(r.trading_date);
      const adj = z.get(d) || null;
      const orig = o.get(d) || null;

      const dbIsOriginal = same(r, orig);
      const dbIsAdjusted = same(r, adj);
      const factorTransformsDbToAdjusted = scaledMatches(r, adj, factor);

      const collectedBefore = tsBeforeEffective(r.collected_at, f.effective_date);
      const updatedBefore = tsBeforeEffective(r.updated_at, f.effective_date);

      let diagnosis = 'UNRESOLVED';

      if (
        dbIsOriginal &&
        !dbIsAdjusted &&
        factorTransformsDbToAdjusted &&
        collectedBefore === true &&
        updatedBefore === true
      ) {
        diagnosis = 'STALE_PRE_ACTION_HISTORY_NOT_REFRESHED';
      } else if (
        dbIsOriginal &&
        !dbIsAdjusted &&
        collectedBefore === false
      ) {
        diagnosis = 'POST_ACTION_ORIGINAL_MODE_INGESTION_SUSPECTED';
      } else if (dbIsAdjusted && !dbIsOriginal) {
        diagnosis = 'CURRENTLY_ADJUSTED';
      } else if (dbIsAdjusted && dbIsOriginal) {
        diagnosis = 'BOTH_MODES_IDENTICAL';
      } else if (dbIsOriginal && !dbIsAdjusted) {
        diagnosis = 'ORIGINAL_BASIS_CAUSE_UNRESOLVED';
      }

      return {
        tradingDate: r.trading_date,
        dbSource: r.source,
        adjustedPriceFlag: r.adjusted_price,
        rawPayloadModYn: r.raw_payload?.mod_yn ?? null,
        collectedAt: r.collected_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        collectedBeforeEffectiveDate: collectedBefore,
        updatedBeforeEffectiveDate: updatedBefore,
        dbMatchesCurrentAdjustedMode0: dbIsAdjusted,
        dbMatchesCurrentOriginalMode1: dbIsOriginal,
        eventPriceFactorTransformsDbToCurrentAdjusted:
          factorTransformsDbToAdjusted,
        dbClose: Number(r.close_price),
        currentAdjustedClose: adj?.close ?? null,
        currentOriginalClose: orig?.close ?? null,
        diagnosis
      };
    });

    const counts = {};
    for (const r of rows) counts[r.diagnosis] = (counts[r.diagnosis] || 0) + 1;

    let stockDiagnosis = 'NO_DB_COVERAGE';
    if (rows.length) {
      const stale = counts.STALE_PRE_ACTION_HISTORY_NOT_REFRESHED || 0;
      const adjusted = counts.CURRENTLY_ADJUSTED || 0;
      const originalPost = counts.POST_ACTION_ORIGINAL_MODE_INGESTION_SUSPECTED || 0;
      const unresolved =
        rows.length - stale - adjusted -
        (counts.BOTH_MODES_IDENTICAL || 0) - originalPost;

      if (stale === rows.length) {
        stockDiagnosis = 'STALE_PRE_ACTION_HISTORY_NOT_REFRESHED';
      } else if (adjusted === rows.length) {
        stockDiagnosis = 'CURRENTLY_ADJUSTED';
      } else if (originalPost > 0) {
        stockDiagnosis = 'ORIGINAL_MODE_INGESTION_SUSPECTED';
      } else if (stale > 0 && adjusted > 0 && unresolved === 0) {
        stockDiagnosis = 'MIXED_STALE_AND_ADJUSTED_HISTORY';
      } else {
        stockDiagnosis = 'REVIEW_REQUIRED';
      }
    }

    results.push({
      stockCode: f.stock_code,
      actionType: f.action_type,
      effectiveDate: f.effective_date,
      eventPriceFactor: factor,
      dbRows: rows.length,
      stockDiagnosis,
      diagnosisCounts: counts,
      minCollectedAt:
        rows.length
          ? rows.map(r => r.collectedAt).filter(Boolean).sort()[0] ?? null
          : null,
      maxCollectedAt:
        rows.length
          ? rows.map(r => r.collectedAt).filter(Boolean).sort().at(-1) ?? null
          : null,
      minUpdatedAt:
        rows.length
          ? rows.map(r => r.updatedAt).filter(Boolean).sort()[0] ?? null
          : null,
      maxUpdatedAt:
        rows.length
          ? rows.map(r => r.updatedAt).filter(Boolean).sort().at(-1) ?? null
          : null,
      rows
    });
  }

  const staleStocks = results.filter(
    x => x.stockDiagnosis === 'STALE_PRE_ACTION_HISTORY_NOT_REFRESHED'
  ).length;

  const adjustedStocks = results.filter(
    x => x.stockDiagnosis === 'CURRENTLY_ADJUSTED'
  ).length;

  const ingestionModeSuspects = results.filter(
    x => x.stockDiagnosis === 'ORIGINAL_MODE_INGESTION_SUSPECTED'
  ).length;

  const noCoverage = results.filter(
    x => x.stockDiagnosis === 'NO_DB_COVERAGE'
  ).length;

  const staleRows = results.flatMap(x =>
    x.rows
      .filter(r => r.diagnosis === 'STALE_PRE_ACTION_HISTORY_NOT_REFRESHED')
      .map(r => ({
        stockCode: x.stockCode,
        tradingDate: r.tradingDate,
        collectedAt: r.collectedAt,
        updatedAt: r.updatedAt,
        dbClose: r.dbClose,
        currentAdjustedClose: r.currentAdjustedClose,
        currentOriginalClose: r.currentOriginalClose,
        eventPriceFactor: x.eventPriceFactor
      }))
  );

  const report = {
    version: VERSION,
    status: 'STALE_HISTORY_PROVENANCE_AUDIT_COMPLETE',
    endpointContract: {
      apiPath: KIS_PATH,
      fidOrgAdjPrc0: 'ADJUSTED_PRICE',
      fidOrgAdjPrc1: 'ORIGINAL_PRICE'
    },
    summary: {
      targetStocks: results.length,
      staleHistoryStocks: staleStocks,
      currentlyAdjustedStocks: adjustedStocks,
      originalModeIngestionSuspects: ingestionModeSuspects,
      noDbCoverageStocks: noCoverage,
      staleRows: staleRows.length
    },
    targets: results,
    staleRows,
    interpretation: {
      staleHistoryDefinition:
        'DB row still equals current KIS original mode, differs from current KIS adjusted mode, DB*event_price_factor matches current adjusted price, and DB collected/updated timestamps precede the effective date.',
      ingestionModeDefinition:
        'DB row equals current KIS original mode even though it was collected after the effective date.',
      safeRemediation:
        'Refresh only proven stale rows from KIS adjusted mode 0 using stock_code,trading_date idempotent upsert; do not apply the corporate-action factor a second time to rows already matching adjusted mode 0.'
    },
    safety: {
      databaseHttpMethods: ['GET'],
      kisHttpMethods: tok ? ['GET'] : ['POST_TOKEN','GET'],
      writesPerformed: 0,
      coveragePromoted: false,
      secretsWrittenToReport: false
    },
    nextGate:
      staleRows.length > 0 && ingestionModeSuspects === 0
        ? 'BUILD_CONTROLLED_KIS_MODE0_STALE_HISTORY_REFRESH_DRY_RUN'
        : 'REVIEW_INGESTION_MODE_OR_UNRESOLVED_PROVENANCE_BEFORE_WRITE'
  };

  saveJson(outputFile, report);

  console.log(JSON.stringify({
    status: report.status,
    ...report.summary,
    targets: results.map(x => ({
      stockCode: x.stockCode,
      actionType: x.actionType,
      effectiveDate: x.effectiveDate,
      eventPriceFactor: x.eventPriceFactor,
      dbRows: x.dbRows,
      stockDiagnosis: x.stockDiagnosis,
      diagnosisCounts: x.diagnosisCounts,
      minCollectedAt: x.minCollectedAt,
      maxCollectedAt: x.maxCollectedAt,
      minUpdatedAt: x.minUpdatedAt,
      maxUpdatedAt: x.maxUpdatedAt
    })),
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
