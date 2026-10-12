'use strict';

// V9.7.21.1 KIS direct split/reverse-split price-basis probe.
//
// Purpose:
//   Resolve the stored-price basis question using the strongest events:
//   STOCK_SPLIT / REVERSE_SPLIT.
//
// For each persisted validation factor:
//   - Query KIS historical daily bars with FID_ORG_ADJ_PRC=0
//   - Query the same window with FID_ORG_ADJ_PRC=1
//   - Read overlapping market_daily_bars rows from Supabase
//   - Compare DB OHLCV against both KIS modes
//   - Compare event-boundary continuity in both KIS modes
//
// Safety:
//   - Supabase GET only.
//   - KIS GET only, plus OAuth token POST only if no access-token env exists.
//   - NO DB writes.
//   - Secrets/tokens are never printed or written to report.
//
// Run:
//   node --env-file=.env.local .\scripts\v9721-1.cjs

const fs = require('node:fs');
const path = require('node:path');

const VERSION = 'V9_7_21_1_KIS_SPLIT_PRICE_BASIS_PROBE';

const KIS_BASE = 'https://openapi.koreainvestment.com:9443';
const KIS_DAILY_PATH =
  '/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice';
const KIS_DAILY_TR_ID = 'FHKST03010100';

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
    if (v && String(v).trim()) {
      return { name, value: String(v).trim() };
    }
  }
  return null;
}

function regexEnv(regex, exclude = []) {
  const matches = Object.keys(process.env)
    .filter(k => regex.test(k))
    .filter(k => !exclude.some(rx => rx.test(k)))
    .filter(k => process.env[k] && String(process.env[k]).trim());

  if (matches.length === 1) {
    return {
      name: matches[0],
      value: String(process.env[matches[0]]).trim()
    };
  }
  return null;
}

function requireCredentials() {
  const key =
    firstEnv([
      'KIS_APP_KEY',
      'KIS_APPKEY',
      'KIS_REAL_APP_KEY',
      'KIS_REAL_APPKEY',
      'KOREA_INVESTMENT_APP_KEY',
      'KOREA_INVESTMENT_APPKEY'
    ]) ||
    regexEnv(
      /(?:^|_)KIS(?:_|.*)APP(?:_|)?KEY$/i,
      [/SECRET/i, /SUPABASE/i]
    );

  const secret =
    firstEnv([
      'KIS_APP_SECRET',
      'KIS_APPSECRET',
      'KIS_REAL_APP_SECRET',
      'KIS_REAL_APPSECRET',
      'KOREA_INVESTMENT_APP_SECRET',
      'KOREA_INVESTMENT_APPSECRET'
    ]) ||
    regexEnv(
      /(?:^|_)KIS(?:_|.*)APP(?:_|)?SECRET$/i,
      [/SUPABASE/i]
    );

  if (!key) throw new Error('KIS_APP_KEY_REQUIRED');
  if (!secret) throw new Error('KIS_APP_SECRET_REQUIRED');

  return {
    appKey: key.value,
    appSecret: secret.value,
    appKeyEnvName: key.name,
    appSecretEnvName: secret.name
  };
}

function optionalAccessToken() {
  return firstEnv([
    'KIS_ACCESS_TOKEN',
    'KIS_TOKEN',
    'KIS_REAL_ACCESS_TOKEN',
    'KOREA_INVESTMENT_ACCESS_TOKEN'
  ]);
}

function requireSupabase() {
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
      body?.rt_cd ||
      body?.msg_cd ||
      `HTTP_${res.status}`;

    const error = new Error(
      `KIS_TOKEN_${String(code)
        .replace(/[^A-Za-z0-9_]/g, '_')
        .toUpperCase()}`
    );

    error.publicDetail = {
      httpStatus: res.status,
      code,
      message:
        body?.error_description ||
        body?.msg1 ||
        body?.message ||
        null
    };

    throw error;
  }

  return String(body.access_token);
}

async function sbGetArray(url, key) {
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

function compactDate(iso) {
  return String(iso).replaceAll('-', '');
}

function isoDate(compact) {
  return `${compact.slice(0,4)}-${compact.slice(4,6)}-${compact.slice(6,8)}`;
}

function addDaysIso(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function minIso(a, b) {
  return a < b ? a : b;
}

async function readValidationSplitFactors(sb) {
  const runs = await sbGetArray(
    `${sb.url}/rest/v1/corporate_action_adjustment_runs` +
    `?select=${encodeURIComponent('id,stock_code,version,status,is_validation,production_applied')}` +
    `&version=eq.${encodeURIComponent(RUN_VERSION)}` +
    `&is_validation=eq.true` +
    `&production_applied=eq.false`,
    sb.key
  );

  if (runs.length !== 15) {
    throw new Error('EXPECTED_15_VALIDATION_RUNS');
  }

  const runIds = runs.map(r => r.id).join(',');

  const factors = await sbGetArray(
    `${sb.url}/rest/v1/corporate_action_adjustment_factors` +
    `?select=${encodeURIComponent(
      'adjustment_run_id,stock_code,effective_date,action_event_id,action_type,event_price_factor,event_share_factor'
    )}` +
    `&adjustment_run_id=in.(${runIds})` +
    `&action_type=in.(STOCK_SPLIT,REVERSE_SPLIT)` +
    `&is_validation=eq.true` +
    `&production_applied=eq.false` +
    `&order=stock_code.asc`,
    sb.key
  );

  if (factors.length !== 5) {
    throw new Error('EXPECTED_5_SPLIT_OR_REVERSE_SPLIT_FACTORS');
  }

  return factors;
}

async function readDbWindow(sb, stockCode, startIso, endIso) {
  const select = [
    'stock_code',
    'trading_date',
    'open_price',
    'high_price',
    'low_price',
    'close_price',
    'volume',
    'trading_value',
    'source',
    'adjusted_price',
    'raw_payload'
  ].join(',');

  return sbGetArray(
    `${sb.url}/rest/v1/market_daily_bars` +
    `?select=${encodeURIComponent(select)}` +
    `&stock_code=eq.${encodeURIComponent(stockCode)}` +
    `&trading_date=gte.${encodeURIComponent(startIso)}` +
    `&trading_date=lte.${encodeURIComponent(endIso)}` +
    `&order=trading_date.asc`,
    sb.key
  );
}

function kisQuery(stockCode, startCompact, endCompact, mode) {
  return new URLSearchParams({
    FID_COND_MRKT_DIV_CODE: 'J',
    FID_INPUT_ISCD: stockCode,
    FID_INPUT_DATE_1: startCompact,
    FID_INPUT_DATE_2: endCompact,
    FID_PERIOD_DIV_CODE: 'D',
    FID_ORG_ADJ_PRC: mode
  }).toString();
}

async function fetchKisDaily(
  stockCode,
  startCompact,
  endCompact,
  mode,
  token,
  appKey,
  appSecret
) {
  const url =
    `${KIS_BASE}${KIS_DAILY_PATH}?` +
    kisQuery(stockCode, startCompact, endCompact, mode);

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'content-type': 'application/json; charset=utf-8',
      authorization: `Bearer ${token}`,
      appkey: appKey,
      appsecret: appSecret,
      tr_id: KIS_DAILY_TR_ID,
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

  if (
    !res.ok ||
    (body?.rt_cd !== undefined && String(body.rt_cd) !== '0')
  ) {
    const code =
      body?.msg_cd ||
      body?.error_code ||
      body?.rt_cd ||
      `HTTP_${res.status}`;

    const err = new Error(
      `KIS_DAILY_${String(code)
        .replace(/[^A-Za-z0-9_]/g, '_')
        .toUpperCase()}`
    );

    err.publicDetail = {
      stockCode,
      mode,
      httpStatus: res.status,
      rtCd: body?.rt_cd ?? null,
      msgCd: body?.msg_cd ?? null,
      msg1:
        body?.msg1 ??
        body?.error_description ??
        null
    };

    throw err;
  }

  const rows = Array.isArray(body?.output2)
    ? body.output2
    : [];

  return rows
    .filter(r => {
      const d = String(r?.stck_bsop_date ?? '');
      return d >= startCompact && d <= endCompact;
    })
    .map(r => ({
      date: String(r?.stck_bsop_date ?? ''),
      open: Number(r?.stck_oprc),
      high: Number(r?.stck_hgpr),
      low: Number(r?.stck_lwpr),
      close: Number(r?.stck_clpr),
      volume: Number(r?.acml_vol),
      tradingValue:
        r?.acml_tr_pbmn === null ||
        r?.acml_tr_pbmn === undefined ||
        r?.acml_tr_pbmn === ''
          ? null
          : Number(r.acml_tr_pbmn),
      modYn: r?.mod_yn ?? null,
      revisionReason: r?.revl_issu_reas ?? null
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function canonicalDb(r) {
  return {
    date: compactDate(r.trading_date),
    open: Number(r.open_price),
    high: Number(r.high_price),
    low: Number(r.low_price),
    close: Number(r.close_price),
    volume: Number(r.volume),
    tradingValue:
      r.trading_value === null ||
      r.trading_value === undefined
        ? null
        : Number(r.trading_value)
  };
}

function priceEqual(a, b) {
  if (!a || !b) return false;

  return (
    a.date === b.date &&
    a.open === b.open &&
    a.high === b.high &&
    a.low === b.low &&
    a.close === b.close &&
    a.volume === b.volume
  );
}

function compareDbToMode(dbRows, modeRows) {
  const db = new Map(
    dbRows.map(r => {
      const c = canonicalDb(r);
      return [c.date, c];
    })
  );

  const mode = new Map(modeRows.map(r => [r.date, r]));
  const dates = [...db.keys()]
    .filter(d => mode.has(d))
    .sort();

  let exactOhlcvMatches = 0;
  let closeMatches = 0;
  const differences = [];

  for (const d of dates) {
    const a = db.get(d);
    const b = mode.get(d);

    if (a.close === b.close) {
      closeMatches++;
    }

    if (priceEqual(a, b)) {
      exactOhlcvMatches++;
    } else {
      differences.push({
        date: d,
        db: a,
        kis: {
          date: b.date,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
          volume: b.volume,
          tradingValue: b.tradingValue
        }
      });
    }
  }

  return {
    overlappingDates: dates.length,
    exactOhlcvMatches,
    closeMatches,
    exactOhlcvMatchRate:
      dates.length ? exactOhlcvMatches / dates.length : null,
    closeMatchRate:
      dates.length ? closeMatches / dates.length : null,
    differences
  };
}

function compareModes(mode0, mode1) {
  const a = new Map(mode0.map(r => [r.date, r]));
  const b = new Map(mode1.map(r => [r.date, r]));
  const dates =
    [...new Set([...a.keys(), ...b.keys()])].sort();

  const differences = [];

  for (const d of dates) {
    const x = a.get(d) ?? null;
    const y = b.get(d) ?? null;

    const cx = x && {
      date: x.date,
      open: x.open,
      high: x.high,
      low: x.low,
      close: x.close,
      volume: x.volume
    };

    const cy = y && {
      date: y.date,
      open: y.open,
      high: y.high,
      low: y.low,
      close: y.close,
      volume: y.volume
    };

    if (JSON.stringify(cx) !== JSON.stringify(cy)) {
      differences.push({
        date: d,
        mode0: cx,
        mode1: cy
      });
    }
  }

  return {
    identical:
      differences.length === 0 &&
      a.size === b.size,
    mode0Rows: a.size,
    mode1Rows: b.size,
    differingDates: differences.length,
    differences
  };
}

function boundary(rows, effectiveCompact) {
  const prior = rows
    .filter(r => r.date < effectiveCompact)
    .sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;

  const next = rows
    .filter(r => r.date >= effectiveCompact)
    .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;

  if (!prior || !next) {
    return {
      prior,
      next,
      logDistance: null,
      ratio: null
    };
  }

  return {
    prior,
    next,
    logDistance:
      Math.abs(Math.log(next.close / prior.close)),
    ratio:
      next.close / prior.close
  };
}

function classifyModeBasis(boundaryInfo, factor) {
  if (
    !boundaryInfo.prior ||
    !boundaryInfo.next ||
    !(factor > 0)
  ) {
    return 'UNRESOLVED';
  }

  const rawExpectedRatio = 1 / factor;
  const observedRatio = boundaryInfo.ratio;

  const rawError =
    Math.abs(Math.log(observedRatio / rawExpectedRatio));

  const adjustedError =
    Math.abs(Math.log(observedRatio));

  if (rawError + 0.15 < adjustedError) {
    return 'BEHAVES_LIKE_RAW';
  }

  if (adjustedError + 0.15 < rawError) {
    return 'BEHAVES_LIKE_ADJUSTED';
  }

  return 'AMBIGUOUS';
}

function chooseDbBasis(db0, db1) {
  const score0 = [
    db0.exactOhlcvMatches,
    db0.closeMatches,
    db0.overlappingDates
  ];

  const score1 = [
    db1.exactOhlcvMatches,
    db1.closeMatches,
    db1.overlappingDates
  ];

  const cmp = (a, b) => {
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return a[i] - b[i];
    }
    return 0;
  };

  const c = cmp(score0, score1);

  if (c > 0) return 'DB_MATCHES_MODE_0_BETTER';
  if (c < 0) return 'DB_MATCHES_MODE_1_BETTER';

  if (
    db0.overlappingDates > 0 &&
    db0.exactOhlcvMatches === db0.overlappingDates &&
    db1.exactOhlcvMatches === db1.overlappingDates
  ) {
    return 'DB_MATCHES_BOTH_MODES_IDENTICALLY';
  }

  return 'DB_MODE_MATCH_INCONCLUSIVE';
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

  const outputArg =
    args.find(a => a.startsWith('--output='));

  const outputFile = outputArg
    ? path.resolve(
        outputArg.slice('--output='.length)
      )
    : path.join(
        root,
        'logs',
        'kis-split-price-basis-probe-v9-7-21-1.json'
      );

  const creds = requireCredentials();
  const sb = requireSupabase();

  const tokenEnv = optionalAccessToken();

  const token = tokenEnv
    ? tokenEnv.value
    : await issueToken(
        creds.appKey,
        creds.appSecret
      );

  const factors =
    await readValidationSplitFactors(sb);

  const analyzed = [];

  for (const f of factors) {
    const effectiveIso =
      String(f.effective_date);

    const startIso =
      addDaysIso(effectiveIso, -14);

    const requestedEndIso =
      addDaysIso(effectiveIso, 7);

    const endIso =
      minIso(requestedEndIso, todayIso());

    const startCompact =
      compactDate(startIso);

    const endCompact =
      compactDate(endIso);

    const effectiveCompact =
      compactDate(effectiveIso);

    const [
      dbRows,
      mode0,
      mode1
    ] = await Promise.all([
      readDbWindow(
        sb,
        f.stock_code,
        startIso,
        endIso
      ),
      fetchKisDaily(
        f.stock_code,
        startCompact,
        endCompact,
        '0',
        token,
        creds.appKey,
        creds.appSecret
      ),
      fetchKisDaily(
        f.stock_code,
        startCompact,
        endCompact,
        '1',
        token,
        creds.appKey,
        creds.appSecret
      )
    ]);

    await sleep(400);

    const modeComparison =
      compareModes(mode0, mode1);

    const dbVsMode0 =
      compareDbToMode(dbRows, mode0);

    const dbVsMode1 =
      compareDbToMode(dbRows, mode1);

    const b0 =
      boundary(mode0, effectiveCompact);

    const b1 =
      boundary(mode1, effectiveCompact);

    const factor =
      Number(f.event_price_factor);

    analyzed.push({
      stockCode: f.stock_code,
      actionType: f.action_type,
      effectiveDate: effectiveIso,
      eventPriceFactor: factor,
      eventShareFactor:
        Number(f.event_share_factor),
      window: {
        startIso,
        endIso
      },
      db: {
        rows: dbRows.length,
        adjustedPriceFlags:
          [...new Set(
            dbRows.map(r => r.adjusted_price)
          )],
        sources:
          [...new Set(
            dbRows.map(r => r.source)
          )],
        rawPayloadModYn:
          [...new Set(
            dbRows
              .map(r => r.raw_payload?.mod_yn)
              .filter(v => v !== undefined)
          )]
      },
      kis: {
        mode0Rows: mode0.length,
        mode1Rows: mode1.length,
        modesIdentical:
          modeComparison.identical,
        differingDates:
          modeComparison.differingDates
      },
      dbVsMode0,
      dbVsMode1,
      dbModeMatch:
        chooseDbBasis(
          dbVsMode0,
          dbVsMode1
        ),
      mode0Boundary: {
        priorDate: b0.prior?.date ?? null,
        priorClose: b0.prior?.close ?? null,
        nextDate: b0.next?.date ?? null,
        nextClose: b0.next?.close ?? null,
        observedNextPriorRatio:
          b0.ratio,
        basisEvidence:
          classifyModeBasis(b0, factor)
      },
      mode1Boundary: {
        priorDate: b1.prior?.date ?? null,
        priorClose: b1.prior?.close ?? null,
        nextDate: b1.next?.date ?? null,
        nextClose: b1.next?.close ?? null,
        observedNextPriorRatio:
          b1.ratio,
        basisEvidence:
          classifyModeBasis(b1, factor)
      },
      modeDifferences:
        modeComparison.differences
    });
  }

  const mode0Raw =
    analyzed.filter(
      x =>
        x.mode0Boundary.basisEvidence ===
        'BEHAVES_LIKE_RAW'
    ).length;

  const mode0Adjusted =
    analyzed.filter(
      x =>
        x.mode0Boundary.basisEvidence ===
        'BEHAVES_LIKE_ADJUSTED'
    ).length;

  const mode1Raw =
    analyzed.filter(
      x =>
        x.mode1Boundary.basisEvidence ===
        'BEHAVES_LIKE_RAW'
    ).length;

  const mode1Adjusted =
    analyzed.filter(
      x =>
        x.mode1Boundary.basisEvidence ===
        'BEHAVES_LIKE_ADJUSTED'
    ).length;

  const dbMatch0 =
    analyzed.filter(
      x =>
        x.dbModeMatch ===
        'DB_MATCHES_MODE_0_BETTER'
    ).length;

  const dbMatch1 =
    analyzed.filter(
      x =>
        x.dbModeMatch ===
        'DB_MATCHES_MODE_1_BETTER'
    ).length;

  const dbMatchBoth =
    analyzed.filter(
      x =>
        x.dbModeMatch ===
        'DB_MATCHES_BOTH_MODES_IDENTICALLY'
    ).length;

  let conclusion =
    'KIS_PRICE_BASIS_REVIEW_REQUIRED';

  const mode0LooksAdjusted =
    mode0Adjusted > mode0Raw;

  const mode1LooksAdjusted =
    mode1Adjusted > mode1Raw;

  const mode0LooksRaw =
    mode0Raw > mode0Adjusted;

  const mode1LooksRaw =
    mode1Raw > mode1Adjusted;

  if (
    mode0LooksAdjusted &&
    mode1LooksRaw &&
    dbMatch0 > dbMatch1
  ) {
    conclusion =
      'DB_MATCHES_KIS_ADJUSTED_MODE_0';
  } else if (
    mode1LooksAdjusted &&
    mode0LooksRaw &&
    dbMatch1 > dbMatch0
  ) {
    conclusion =
      'DB_MATCHES_KIS_ADJUSTED_MODE_1';
  } else if (
    analyzed.every(x => x.kis.modesIdentical) &&
    analyzed.every(
      x =>
        x.mode0Boundary.basisEvidence ===
        'BEHAVES_LIKE_ADJUSTED' ||
        x.mode0Boundary.basisEvidence ===
        'UNRESOLVED'
    )
  ) {
    conclusion =
      'KIS_MODES_IDENTICAL_AND_SERIES_BEHAVES_ADJUSTED';
  } else if (
    dbMatchBoth > 0 &&
    mode0Adjusted > 0 &&
    mode1Adjusted > 0
  ) {
    conclusion =
      'DB_MATCHES_BOTH_KIS_MODES_AND_BOTH_BEHAVE_ADJUSTED';
  }

  const report = {
    version: VERSION,
    status:
      conclusion ===
      'KIS_PRICE_BASIS_REVIEW_REQUIRED'
        ? 'KIS_SPLIT_PRICE_BASIS_REVIEW_REQUIRED'
        : 'KIS_SPLIT_PRICE_BASIS_RESOLVED',
    conclusion,
    summary: {
      targets: analyzed.length,
      mode0Raw,
      mode0Adjusted,
      mode1Raw,
      mode1Adjusted,
      dbMatch0,
      dbMatch1,
      dbMatchBoth,
      targetsWithModeDifferences:
        analyzed.filter(
          x => !x.kis.modesIdentical
        ).length
    },
    credentialDiscovery: {
      appKeyEnvName:
        creds.appKeyEnvName,
      appSecretEnvName:
        creds.appSecretEnvName,
      accessTokenSource:
        tokenEnv
          ? `ENV:${tokenEnv.name}`
          : 'OAUTH_TOKENP_ISSUED_FOR_THIS_RUN'
    },
    targets: analyzed,
    interpretation: {
      eventPriceFactor:
        'PRE_ACTION_RAW_PRICE_TO_POST_ACTION_COMPARABLE_PRICE_MULTIPLIER',
      rawBoundaryExpectation:
        'For a raw series, next/prior price ratio should roughly track 1/event_price_factor around a pure split or reverse split.',
      adjustedBoundaryExpectation:
        'For an adjusted series, prior and next prices should remain roughly comparable across a pure split or reverse split.',
      safetyRule:
        'Do not apply corporate-action price factors to market_daily_bars if the stored series is already adjusted.'
    },
    safety: {
      supabaseHttpMethodsUsed: ['GET'],
      kisHttpMethodsUsed:
        tokenEnv
          ? ['GET']
          : ['POST_TOKEN', 'GET'],
      writesPerformed: 0,
      marketBarsInserted: 0,
      marketBarsUpdated: 0,
      adjustmentRowsUpdated: 0,
      productionAppliedRows: 0,
      coveragePromoted: false,
      secretsWrittenToReport: false
    },
    nextGate:
      conclusion ===
      'KIS_PRICE_BASIS_REVIEW_REQUIRED'
        ? 'REVIEW_PER_EVENT_KIS_MODE_AND_DB_MATCHES'
        : 'LOCK_MARKET_DAILY_BARS_PRICE_BASIS_POLICY_BEFORE_BUILDING_ADJUSTMENT_CONSUMER'
  };

  saveJson(outputFile, report);

  console.log(JSON.stringify({
    status: report.status,
    conclusion,
    ...report.summary,
    targets: analyzed.map(x => ({
      stockCode: x.stockCode,
      actionType: x.actionType,
      effectiveDate: x.effectiveDate,
      eventPriceFactor:
        x.eventPriceFactor,
      dbRows: x.db.rows,
      mode0Rows: x.kis.mode0Rows,
      mode1Rows: x.kis.mode1Rows,
      modesIdentical:
        x.kis.modesIdentical,
      differingDates:
        x.kis.differingDates,
      dbModeMatch:
        x.dbModeMatch,
      mode0Boundary:
        x.mode0Boundary,
      mode1Boundary:
        x.mode1Boundary
    })),
    writesPerformed: 0,
    coveragePromoted: false
  }, null, 2));

  console.log(
    'Upload only this report (never upload .env files): ' +
    outputFile
  );
}

main().catch(error => {
  if (error?.publicDetail) {
    console.error(JSON.stringify({
      error:
        String(error.message)
          .replace(/[^A-Za-z0-9_]/g, '_')
          .toUpperCase(),
      detail: error.publicDetail
    }, null, 2));
  } else {
    console.error(
      String(error?.message || error)
        .replace(/[^A-Za-z0-9_]/g, '_')
        .toUpperCase()
    );
  }
  process.exitCode = 1;
});
