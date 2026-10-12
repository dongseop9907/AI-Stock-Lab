'use strict';

// V9.7.23 read-only audit across all 11 generic-supported
// corporate-action validation factors.
//
// Goal:
//   Verify that covered market_daily_bars rows conform to the intended
//   KIS adjusted-price storage policy across:
//     - STOCK_SPLIT
//     - REVERSE_SPLIT
//     - STOCK_DIVIDEND
//     - CASH_DIVIDEND
//
// KIS endpoint contract for this script:
//   FID_ORG_ADJ_PRC=0 -> adjusted price
//   FID_ORG_ADJ_PRC=1 -> original price
//
// This audit DOES NOT prove the entire market_daily_bars table is uniform.
// It proves only the rows covered by the 11 validation-factor event windows.
//
// No DB writes.
//
// Run:
//   node --env-file=.env.local .\scripts\v9723.cjs

const fs = require('node:fs');
const path = require('node:path');

const VERSION = 'V9_7_23_ALL_SUPPORTED_EVENT_PRICE_BASIS_AUDIT';
const RUN_VERSION = 'CORPORATE_ACTION_ADJUSTMENT_V9_7_19_VALIDATION';

const KIS_BASE = 'https://openapi.koreainvestment.com:9443';
const KIS_PATH =
  '/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice';
const TR_ID = 'FHKST03010100';

const KIS_MIN_GAP_MS = 1300;
const KIS_MAX_RATE_RETRIES = 6;
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
    if (v && String(v).trim()) {
      return { name, value: String(v).trim() };
    }
  }
  return null;
}

function regexEnv(regex, excludes = []) {
  const keys = Object.keys(process.env)
    .filter(k => regex.test(k))
    .filter(k => !excludes.some(rx => rx.test(k)))
    .filter(k => process.env[k] && String(process.env[k]).trim());

  if (keys.length === 1) {
    return {
      name: keys[0],
      value: String(process.env[keys[0]]).trim()
    };
  }
  return null;
}

function credentials() {
  const appKey =
    firstEnv([
      'KIS_APP_KEY','KIS_APPKEY',
      'KIS_REAL_APP_KEY','KIS_REAL_APPKEY',
      'KOREA_INVESTMENT_APP_KEY','KOREA_INVESTMENT_APPKEY'
    ]) ||
    regexEnv(
      /(?:^|_)KIS(?:_|.*)APP(?:_|)?KEY$/i,
      [/SECRET/i,/SUPABASE/i]
    );

  const appSecret =
    firstEnv([
      'KIS_APP_SECRET','KIS_APPSECRET',
      'KIS_REAL_APP_SECRET','KIS_REAL_APPSECRET',
      'KOREA_INVESTMENT_APP_SECRET','KOREA_INVESTMENT_APPSECRET'
    ]) ||
    regexEnv(
      /(?:^|_)KIS(?:_|.*)APP(?:_|)?SECRET$/i,
      [/SUPABASE/i]
    );

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
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL;
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
    headers: {
      'content-type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      appkey: appKey,
      appsecret: appSecret
    })
  });

  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error('KIS_TOKEN_INVALID_JSON');
  }

  if (!res.ok || !body?.access_token) {
    const code =
      body?.error_code ||
      body?.error ||
      body?.msg_cd ||
      body?.rt_cd ||
      `HTTP_${res.status}`;

    throw new Error(
      `KIS_TOKEN_${String(code)
        .replace(/[^A-Za-z0-9_]/g, '_')
        .toUpperCase()}`
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
  try {
    body = text ? JSON.parse(text) : [];
  } catch {
    throw new Error('SUPABASE_INVALID_JSON');
  }

  if (!res.ok) {
    const code = body?.code || `HTTP_${res.status}`;
    throw new Error(
      `SUPABASE_${String(code)
        .replace(/[^A-Za-z0-9_]/g, '_')
        .toUpperCase()}`
    );
  }

  if (!Array.isArray(body)) {
    throw new Error('SUPABASE_EXPECTED_ARRAY');
  }

  return body;
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

async function readValidationFactors(sb) {
  const runs = await sbGet(
    `${sb.url}/rest/v1/corporate_action_adjustment_runs` +
    `?select=${encodeURIComponent(
      'id,stock_code,version,status,is_validation,production_applied'
    )}` +
    `&version=eq.${encodeURIComponent(RUN_VERSION)}` +
    `&is_validation=eq.true` +
    `&production_applied=eq.false`,
    sb.key
  );

  if (runs.length !== 15) {
    throw new Error('EXPECTED_15_VALIDATION_RUNS');
  }

  const ids = runs.map(r => r.id).join(',');

  const factors = await sbGet(
    `${sb.url}/rest/v1/corporate_action_adjustment_factors` +
    `?select=${encodeURIComponent(
      'adjustment_run_id,stock_code,effective_date,action_event_id,action_type,event_price_factor,event_share_factor,metadata'
    )}` +
    `&adjustment_run_id=in.(${ids})` +
    `&is_validation=eq.true` +
    `&production_applied=eq.false` +
    `&order=stock_code.asc,effective_date.asc`,
    sb.key
  );

  if (factors.length !== 11) {
    throw new Error('EXPECTED_11_VALIDATION_FACTORS');
  }

  return factors;
}

async function readDbWindow(sb, stock, start, end) {
  return sbGet(
    `${sb.url}/rest/v1/market_daily_bars` +
    `?select=${encodeURIComponent(
      'stock_code,trading_date,open_price,high_price,low_price,close_price,volume,trading_value,source,adjusted_price,raw_payload,collected_at,updated_at'
    )}` +
    `&stock_code=eq.${encodeURIComponent(stock)}` +
    `&trading_date=gte.${encodeURIComponent(start)}` +
    `&trading_date=lte.${encodeURIComponent(end)}` +
    `&order=trading_date.asc`,
    sb.key
  );
}

async function waitKisSlot() {
  const elapsed = Date.now() - lastKisAt;
  if (elapsed < KIS_MIN_GAP_MS) {
    await sleep(KIS_MIN_GAP_MS - elapsed);
  }
}

async function kisOnce(
  stock,
  start,
  end,
  mode,
  token,
  appKey,
  appSecret
) {
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
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error('KIS_DAILY_INVALID_JSON');
  }

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
      `KIS_DAILY_${code
        .replace(/[^A-Za-z0-9_]/g, '_')
        .toUpperCase()}`
    );
    err.kisCode = code;
    throw err;
  }

  const rows = Array.isArray(body?.output2)
    ? body.output2
    : [];

  return rows
    .map(raw => ({
      date: String(raw.stck_bsop_date || ''),
      open: Number(raw.stck_oprc),
      high: Number(raw.stck_hgpr),
      low: Number(raw.stck_lwpr),
      close: Number(raw.stck_clpr),
      volume: Number(raw.acml_vol),
      tradingValue:
        raw.acml_tr_pbmn === '' ||
        raw.acml_tr_pbmn == null
          ? null
          : Number(raw.acml_tr_pbmn),
      modYn: raw.mod_yn ?? null,
      revisionReason: raw.revl_issu_reas ?? null
    }))
    .filter(
      x =>
        x.date >= compact(start) &&
        x.date <= compact(end)
    )
    .sort((a,b) => a.date.localeCompare(b.date));
}

async function kis(
  stock,
  start,
  end,
  mode,
  token,
  appKey,
  appSecret
) {
  for (
    let attempt = 0;
    attempt <= KIS_MAX_RATE_RETRIES;
    attempt++
  ) {
    try {
      return await kisOnce(
        stock,
        start,
        end,
        mode,
        token,
        appKey,
        appSecret
      );
    } catch (err) {
      if (
        err?.kisCode !== 'EGW00201' ||
        attempt === KIS_MAX_RATE_RETRIES
      ) {
        throw err;
      }

      await sleep(2000 + attempt * 700);
      lastKisAt = 0;
    }
  }

  throw new Error('KIS_RATE_RETRY_EXHAUSTED');
}

function sameOhlcv(db, kisRow) {
  return !!db && !!kisRow &&
    Number(db.open_price) === kisRow.open &&
    Number(db.high_price) === kisRow.high &&
    Number(db.low_price) === kisRow.low &&
    Number(db.close_price) === kisRow.close &&
    Number(db.volume) === kisRow.volume;
}

function nearPrice(a,b) {
  return Math.abs(Number(a) - Number(b)) <= 1;
}

function factorTransforms(db, adjusted, factor) {
  if (!db || !adjusted || !(factor > 0)) {
    return false;
  }

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
  const limit =
    new Date(`${effectiveDate}T00:00:00Z`).getTime();
  return Number.isFinite(value) && value < limit;
}

function classifyDbRow(
  db,
  adjusted,
  original,
  factor,
  effectiveDate
) {
  const eq0 = sameOhlcv(db, adjusted);
  const eq1 = sameOhlcv(db, original);

  let classification = 'NEITHER';
  if (eq0 && eq1) {
    classification = 'BOTH_MODES_IDENTICAL';
  } else if (eq0) {
    classification = 'ADJUSTED_MODE_0';
  } else if (eq1) {
    classification = 'ORIGINAL_MODE_1';
  }

  const staleCandidate =
    classification === 'ORIGINAL_MODE_1' &&
    factorTransforms(db, adjusted, factor) &&
    timestampBefore(db.collected_at, effectiveDate) &&
    timestampBefore(db.updated_at, effectiveDate);

  return {
    classification,
    staleCandidate
  };
}

function eventDiagnosis(rows) {
  if (rows.length === 0) return 'NO_DB_COVERAGE';

  const c = {};
  for (const r of rows) {
    c[r.classification] =
      (c[r.classification] || 0) + 1;
  }

  const adjusted = c.ADJUSTED_MODE_0 || 0;
  const original = c.ORIGINAL_MODE_1 || 0;
  const both = c.BOTH_MODES_IDENTICAL || 0;
  const neither = c.NEITHER || 0;

  if (
    adjusted > 0 &&
    original === 0 &&
    neither === 0
  ) {
    return 'CURRENTLY_ADJUSTED';
  }

  if (
    original > 0 &&
    adjusted === 0 &&
    neither === 0 &&
    both === 0
  ) {
    return 'CURRENTLY_ORIGINAL';
  }

  if (
    both === rows.length
  ) {
    return 'AMBIGUOUS_BOTH_MODES_IDENTICAL';
  }

  if (
    adjusted > 0 &&
    original > 0
  ) {
    return 'MIXED_ADJUSTED_AND_ORIGINAL';
  }

  return 'REVIEW_REQUIRED';
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const args = process.argv.slice(2);

  if (args.some(a => !a.startsWith('--output='))) {
    throw new Error('UNKNOWN_OPTION');
  }

  const outputArg =
    args.find(a => a.startsWith('--output='));

  const outputFile = outputArg
    ? path.resolve(
        outputArg.slice('--output='.length)
      )
    : path.join(
        root,
        'logs',
        'all-supported-event-price-basis-audit-v9-7-23.json'
      );

  const sb = supabase();
  const c = credentials();
  const tokenEnv = existingToken();
  const token = tokenEnv
    ? tokenEnv.value
    : await issueToken(
        c.appKey,
        c.appSecret
      );

  const factors =
    await readValidationFactors(sb);

  const events = [];

  for (const f of factors) {
    const effectiveDate =
      String(f.effective_date);

    const start =
      addDays(effectiveDate, -45);

    const requestedEnd =
      addDays(effectiveDate, 10);

    const end =
      requestedEnd < todayIso()
        ? requestedEnd
        : todayIso();

    const db = await readDbWindow(
      sb,
      f.stock_code,
      start,
      end
    );

    const mode0 = await kis(
      f.stock_code,
      start,
      end,
      '0',
      token,
      c.appKey,
      c.appSecret
    );

    const mode1 = await kis(
      f.stock_code,
      start,
      end,
      '1',
      token,
      c.appKey,
      c.appSecret
    );

    const m0 =
      new Map(mode0.map(x => [x.date, x]));

    const m1 =
      new Map(mode1.map(x => [x.date, x]));

    const rows = db.map(row => {
      const date = compact(row.trading_date);
      const adjusted = m0.get(date) || null;
      const original = m1.get(date) || null;

      const classification = classifyDbRow(
        row,
        adjusted,
        original,
        Number(f.event_price_factor),
        effectiveDate
      );

      return {
        tradingDate: row.trading_date,
        classification:
          classification.classification,
        staleCandidate:
          classification.staleCandidate,
        adjustedPriceFlag:
          row.adjusted_price,
        source:
          row.source,
        rawPayloadModYn:
          row.raw_payload?.mod_yn ?? null,
        collectedAt:
          row.collected_at,
        updatedAt:
          row.updated_at,
        dbClose:
          Number(row.close_price),
        kisMode0AdjustedClose:
          adjusted?.close ?? null,
        kisMode1OriginalClose:
          original?.close ?? null
      };
    });

    const basisCounts = {};
    for (const r of rows) {
      basisCounts[r.classification] =
        (basisCounts[r.classification] || 0) + 1;
    }

    events.push({
      stockCode:
        f.stock_code,
      actionType:
        f.action_type,
      effectiveDate,
      eventPriceFactor:
        Number(f.event_price_factor),
      eventShareFactor:
        Number(f.event_share_factor),
      dbRows:
        db.length,
      kisMode0Rows:
        mode0.length,
      kisMode1Rows:
        mode1.length,
      diagnosis:
        eventDiagnosis(rows),
      basisCounts,
      staleCandidateRows:
        rows.filter(x => x.staleCandidate).length,
      adjustedPriceFalseRows:
        rows.filter(
          x => x.adjustedPriceFlag !== true
        ).length,
      rows
    });
  }

  const covered =
    events.filter(
      e => e.diagnosis !== 'NO_DB_COVERAGE'
    );

  const currentlyAdjusted =
    events.filter(
      e => e.diagnosis === 'CURRENTLY_ADJUSTED'
    );

  const currentlyOriginal =
    events.filter(
      e => e.diagnosis === 'CURRENTLY_ORIGINAL'
    );

  const ambiguousBoth =
    events.filter(
      e =>
        e.diagnosis ===
        'AMBIGUOUS_BOTH_MODES_IDENTICAL'
    );

  const mixed =
    events.filter(
      e =>
        e.diagnosis ===
        'MIXED_ADJUSTED_AND_ORIGINAL'
    );

  const review =
    events.filter(
      e => e.diagnosis === 'REVIEW_REQUIRED'
    );

  const noCoverage =
    events.filter(
      e => e.diagnosis === 'NO_DB_COVERAGE'
    );

  const staleCandidates =
    events.reduce(
      (sum,e) => sum + e.staleCandidateRows,
      0
    );

  const adjustedFlagFalse =
    events.reduce(
      (sum,e) => sum + e.adjustedPriceFalseRows,
      0
    );

  const decisiveViolationCount =
    currentlyOriginal.length +
    mixed.length +
    review.length +
    staleCandidates;

  const coveredRowsConformToAdjustedPolicy =
    decisiveViolationCount === 0;

  const report = {
    version: VERSION,
    status:
      coveredRowsConformToAdjustedPolicy
        ? 'SUPPORTED_EVENT_PRICE_BASIS_AUDIT_PASSED'
        : 'SUPPORTED_EVENT_PRICE_BASIS_AUDIT_REVIEW_REQUIRED',
    summary: {
      validationFactorEvents:
        events.length,
      eventsWithDbCoverage:
        covered.length,
      currentlyAdjustedEvents:
        currentlyAdjusted.length,
      currentlyOriginalEvents:
        currentlyOriginal.length,
      ambiguousBothModesEvents:
        ambiguousBoth.length,
      mixedBasisEvents:
        mixed.length,
      reviewRequiredEvents:
        review.length,
      noDbCoverageEvents:
        noCoverage.length,
      staleCandidateRows:
        staleCandidates,
      adjustedPriceFalseRows:
        adjustedFlagFalse,
      coveredRowsConformToAdjustedPolicy
    },
    events,
    storageContractCandidate: {
      marketDailyBarsPriceBasis:
        'KIS_MODE_0_ADJUSTED',
      adjustedPriceFlagMeaning:
        'TRUE_MEANS_ROW_IS_VERIFIED_OR_INGESTED_AS_ADJUSTED_PRICE',
      corporateActionFactorUsage:
        'DO_NOT_MULTIPLY_FACTORS_INTO_ROWS_ALREADY_STORED_AS_KIS_MODE_0_ADJUSTED',
      postCorporateActionPolicy:
        'REQUERY_RELEVANT_HISTORICAL_WINDOW_FROM_KIS_MODE_0_AND_IDEMPOTENTLY_REFRESH_STALE_ROWS',
      globalTableUniformityProven:
        false,
      reason:
        'This validation covers only the 11 canonical generic-supported corporate-action event windows, not every row in market_daily_bars.'
    },
    safety: {
      databaseHttpMethods: ['GET'],
      kisHttpMethods:
        tokenEnv
          ? ['GET']
          : ['POST_TOKEN','GET'],
      writesPerformed: 0,
      marketBarsUpdated: 0,
      coveragePromoted: false,
      secretsWrittenToReport: false
    },
    nextGate:
      coveredRowsConformToAdjustedPolicy
        ? 'LOCK_STORAGE_CONTRACT_AND_DESIGN_AUTOMATIC_POST_ACTION_REFRESH'
        : 'REVIEW_EVENT_LEVEL_PRICE_BASIS_BEFORE_LOCKING_STORAGE_CONTRACT'
  };

  saveJson(outputFile, report);

  console.log(JSON.stringify({
    status:
      report.status,
    ...report.summary,
    events:
      events.map(e => ({
        stockCode:
          e.stockCode,
        actionType:
          e.actionType,
        effectiveDate:
          e.effectiveDate,
        dbRows:
          e.dbRows,
        diagnosis:
          e.diagnosis,
        basisCounts:
          e.basisCounts,
        staleCandidateRows:
          e.staleCandidateRows,
        adjustedPriceFalseRows:
          e.adjustedPriceFalseRows
      })),
    globalTableUniformityProven:
      false,
    writesPerformed:
      0,
    coveragePromoted:
      false
  }, null, 2));

  console.log(
    'Upload only this report (never upload .env files): ' +
    outputFile
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
