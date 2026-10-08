'use strict';

// V9.7.16.3 KIS missing-window dry-run probe.
//
// Purpose:
//   - Fetch the two missing market_daily_bars windows directly from KIS.
//   - Query both FID_ORG_ADJ_PRC modes ("0" and "1") because historical
//     documentation/sample comments have used inconsistent wording.
//   - Compare returned OHLCV rows before any database write.
//   - Confirm the expected reference dates exist:
//       0001A0 -> 2026-08-13
//       204610 -> 2026-08-27
//
// Safety:
//   - KIS GET requests only (plus OAuth token POST only if no usable token env exists).
//   - Supabase GET requests only.
//   - NO INSERT / UPDATE / DELETE / UPSERT.
//   - Secrets/tokens are never written to the report or printed.
//
// Run:
//   node --env-file=.env.local .\scripts\v9716-3.cjs

const fs = require('node:fs');
const path = require('node:path');

const VERSION = 'V9_7_16_3_KIS_MISSING_WINDOW_DRY_RUN';
const KIS_BASE = 'https://openapi.koreainvestment.com:9443';
const KIS_DAILY_PATH =
  '/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice';
const KIS_DAILY_TR_ID = 'FHKST03010100';

const TARGETS = [
  {
    stockCode: '0001A0',
    startDate: '20260801',
    endDate: '20260813',
    requiredReferenceDate: '20260813'
  },
  {
    stockCode: '204610',
    startDate: '20260815',
    endDate: '20260827',
    requiredReferenceDate: '20260827'
  }
];

function safeError(error) {
  const m = error instanceof Error ? error.message : String(error ?? 'UNKNOWN_ERROR');
  return /^[A-Z0-9_]+$/.test(m) ? m : 'V9_7_16_3_FAILED';
}

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

function regexEnv(regex, exclude = []) {
  const matches = Object.keys(process.env)
    .filter(k => regex.test(k))
    .filter(k => !exclude.some(rx => rx.test(k)))
    .filter(k => process.env[k] && String(process.env[k]).trim());

  if (matches.length === 1) {
    return { name: matches[0], value: String(process.env[matches[0]]).trim() };
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
    regexEnv(/(?:^|_)KIS(?:_|.*)APP(?:_|)?KEY$/i, [/SECRET/i, /SUPABASE/i]);

  const secret =
    firstEnv([
      'KIS_APP_SECRET',
      'KIS_APPSECRET',
      'KIS_REAL_APP_SECRET',
      'KIS_REAL_APPSECRET',
      'KOREA_INVESTMENT_APP_SECRET',
      'KOREA_INVESTMENT_APPSECRET'
    ]) ||
    regexEnv(/(?:^|_)KIS(?:_|.*)APP(?:_|)?SECRET$/i, [/SUPABASE/i]);

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
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error('SUPABASE_URL_REQUIRED');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY_REQUIRED');

  return { url: String(url).replace(/\/+$/, ''), key: String(key) };
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
      `HTTP_${res.status}`;
    throw new Error(
      `KIS_TOKEN_${String(code).replace(/[^A-Za-z0-9_]/g, '_').toUpperCase()}`
    );
  }

  return String(body.access_token);
}

function kisQuery(target, mode) {
  const q = new URLSearchParams({
    FID_COND_MRKT_DIV_CODE: 'J',
    FID_INPUT_ISCD: target.stockCode,
    FID_INPUT_DATE_1: target.startDate,
    FID_INPUT_DATE_2: target.endDate,
    FID_PERIOD_DIV_CODE: 'D',
    FID_ORG_ADJ_PRC: mode
  });
  return q.toString();
}

async function fetchKisDaily(target, mode, token, appKey, appSecret) {
  const url = `${KIS_BASE}${KIS_DAILY_PATH}?${kisQuery(target, mode)}`;

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

  if (!res.ok || (body?.rt_cd !== undefined && String(body.rt_cd) !== '0')) {
    const code =
      body?.msg_cd ||
      body?.error_code ||
      body?.rt_cd ||
      `HTTP_${res.status}`;
    const err = new Error(
      `KIS_DAILY_${String(code).replace(/[^A-Za-z0-9_]/g, '_').toUpperCase()}`
    );
    err.publicDetail = {
      stockCode: target.stockCode,
      mode,
      httpStatus: res.status,
      rtCd: body?.rt_cd ?? null,
      msgCd: body?.msg_cd ?? null,
      msg1: body?.msg1 ?? body?.error_description ?? null
    };
    throw err;
  }

  const rows = Array.isArray(body?.output2) ? body.output2 : [];

  return rows
    .filter(r => {
      const d = String(r?.stck_bsop_date ?? '');
      return d >= target.startDate && d <= target.endDate;
    })
    .map(r => ({
      stck_bsop_date: String(r?.stck_bsop_date ?? ''),
      stck_oprc: String(r?.stck_oprc ?? ''),
      stck_hgpr: String(r?.stck_hgpr ?? ''),
      stck_lwpr: String(r?.stck_lwpr ?? ''),
      stck_clpr: String(r?.stck_clpr ?? ''),
      acml_vol: String(r?.acml_vol ?? ''),
      acml_tr_pbmn:
        r?.acml_tr_pbmn === undefined || r?.acml_tr_pbmn === null
          ? null
          : String(r.acml_tr_pbmn),
      mod_yn: r?.mod_yn ?? null,
      revl_issu_reas: r?.revl_issu_reas ?? null,
      prdy_vrss: r?.prdy_vrss ?? null,
      prdy_vrss_sign: r?.prdy_vrss_sign ?? null,
      prtt_rate: r?.prtt_rate ?? null,
      flng_cls_code: r?.flng_cls_code ?? null
    }))
    .sort((a, b) => a.stck_bsop_date.localeCompare(b.stck_bsop_date));
}

async function supabaseGetArray(url, serviceKey) {
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Accept: 'application/json'
    }
  });

  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error('SUPABASE_INVALID_JSON');
  }

  if (!res.ok) {
    const code = body?.code ? String(body.code) : `HTTP_${res.status}`;
    throw new Error(
      `SUPABASE_${code.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase()}`
    );
  }

  if (!Array.isArray(body)) throw new Error('SUPABASE_EXPECTED_ARRAY');
  return body;
}

async function readExistingWindow(sb, target) {
  const start = `${target.startDate.slice(0,4)}-${target.startDate.slice(4,6)}-${target.startDate.slice(6,8)}`;
  const end = `${target.endDate.slice(0,4)}-${target.endDate.slice(4,6)}-${target.endDate.slice(6,8)}`;

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
    'adjusted_price'
  ].join(',');

  const url =
    `${sb.url}/rest/v1/market_daily_bars` +
    `?select=${encodeURIComponent(select)}` +
    `&stock_code=eq.${encodeURIComponent(target.stockCode)}` +
    `&trading_date=gte.${encodeURIComponent(start)}` +
    `&trading_date=lte.${encodeURIComponent(end)}` +
    `&order=trading_date.asc`;

  return supabaseGetArray(url, sb.key);
}

function canonicalPriceRow(r) {
  return {
    date: r.stck_bsop_date,
    open: Number(r.stck_oprc),
    high: Number(r.stck_hgpr),
    low: Number(r.stck_lwpr),
    close: Number(r.stck_clpr),
    volume: Number(r.acml_vol),
    tradingValue:
      r.acml_tr_pbmn === null || r.acml_tr_pbmn === ''
        ? null
        : Number(r.acml_tr_pbmn)
  };
}

function validOhlc(r) {
  return (
    Number.isFinite(r.open) &&
    Number.isFinite(r.high) &&
    Number.isFinite(r.low) &&
    Number.isFinite(r.close) &&
    r.open > 0 &&
    r.high > 0 &&
    r.low > 0 &&
    r.close > 0 &&
    r.high >= r.low &&
    r.high >= r.open &&
    r.high >= r.close &&
    r.low <= r.open &&
    r.low <= r.close &&
    Number.isFinite(r.volume) &&
    r.volume >= 0
  );
}

function compareModes(rows0, rows1) {
  const a = new Map(rows0.map(r => [r.stck_bsop_date, canonicalPriceRow(r)]));
  const b = new Map(rows1.map(r => [r.stck_bsop_date, canonicalPriceRow(r)]));
  const dates = [...new Set([...a.keys(), ...b.keys()])].sort();

  const differences = [];
  for (const d of dates) {
    const x = a.get(d) ?? null;
    const y = b.get(d) ?? null;
    if (JSON.stringify(x) !== JSON.stringify(y)) {
      differences.push({ date: d, mode0: x, mode1: y });
    }
  }

  return {
    identical: differences.length === 0 && a.size === b.size,
    mode0Rows: a.size,
    mode1Rows: b.size,
    differences
  };
}

function findReference(rows, requiredDate) {
  const r = rows.find(x => x.stck_bsop_date === requiredDate);
  return r ? canonicalPriceRow(r) : null;
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
    : path.join(
        root,
        'logs',
        'kis-missing-window-dry-run-v9-7-16-3.json'
      );

  const creds = requireCredentials();
  const sb = requireSupabase();

  const tokenEnv = optionalAccessToken();
  const token = tokenEnv
    ? tokenEnv.value
    : await issueToken(creds.appKey, creds.appSecret);

  const analyzed = [];

  for (const target of TARGETS) {
    const existing = await readExistingWindow(sb, target);

    const mode0 = await fetchKisDaily(
      target, '0', token, creds.appKey, creds.appSecret
    );
    await sleep(350);
    const mode1 = await fetchKisDaily(
      target, '1', token, creds.appKey, creds.appSecret
    );
    await sleep(350);

    const comparison = compareModes(mode0, mode1);
    const ref0 = findReference(mode0, target.requiredReferenceDate);
    const ref1 = findReference(mode1, target.requiredReferenceDate);

    const allValid0 = mode0.map(canonicalPriceRow).every(validOhlc);
    const allValid1 = mode1.map(canonicalPriceRow).every(validOhlc);

    analyzed.push({
      target,
      existingDbRowsInWindow: existing,
      existingDbRowCount: existing.length,
      mode0: {
        rowCount: mode0.length,
        requiredReference: ref0,
        allRowsPassOhlcChecks: allValid0,
        rows: mode0
      },
      mode1: {
        rowCount: mode1.length,
        requiredReference: ref1,
        allRowsPassOhlcChecks: allValid1,
        rows: mode1
      },
      comparison
    });
  }

  const noExistingRows = analyzed.every(x => x.existingDbRowCount === 0);
  const bothReferencesPresent = analyzed.every(
    x => x.mode0.requiredReference && x.mode1.requiredReference
  );
  const allOhlcValid = analyzed.every(
    x => x.mode0.allRowsPassOhlcChecks && x.mode1.allRowsPassOhlcChecks
  );
  const modesIdentical = analyzed.every(x => x.comparison.identical);

  const status =
    noExistingRows &&
    bothReferencesPresent &&
    allOhlcValid &&
    modesIdentical
      ? 'KIS_BACKFILL_DRY_RUN_READY_FOR_MAPPING'
      : 'KIS_BACKFILL_DRY_RUN_REVIEW_REQUIRED';

  const state = {
    version: VERSION,
    status,
    officialContract: {
      baseUrl: KIS_BASE,
      endpoint: KIS_DAILY_PATH,
      trId: KIS_DAILY_TR_ID,
      marketCode: 'J',
      periodCode: 'D',
      orgAdjModesCompared: ['0', '1']
    },
    credentialDiscovery: {
      appKeyEnvName: creds.appKeyEnvName,
      appSecretEnvName: creds.appSecretEnvName,
      accessTokenSource: tokenEnv
        ? `ENV:${tokenEnv.name}`
        : 'OAUTH_TOKENP_ISSUED_FOR_THIS_RUN'
    },
    summary: {
      targets: analyzed.length,
      existingDbRowsAcrossTargetWindows: analyzed.reduce(
        (n, x) => n + x.existingDbRowCount, 0
      ),
      noExistingRows,
      bothReferencesPresent,
      allOhlcValid,
      modesIdentical
    },
    targets: analyzed,
    safety: {
      supabaseHttpMethodsUsed: ['GET'],
      kisHttpMethodsUsed: tokenEnv ? ['GET'] : ['POST_TOKEN', 'GET'],
      writesPerformed: 0,
      marketBarsInserted: 0,
      marketBarsUpdated: 0,
      adjustmentRowsInserted: 0,
      coveragePromoted: false,
      secretsWrittenToReport: false
    },
    nextGate:
      status === 'KIS_BACKFILL_DRY_RUN_READY_FOR_MAPPING'
        ? 'BUILD_CONTROLLED_IDEMPOTENT_MARKET_DAILY_BARS_BACKFILL'
        : 'REVIEW_KIS_MODE_DIFFERENCES_OR_EXISTING_TARGET_WINDOW_ROWS'
  };

  saveJson(outputFile, state);

  console.log(JSON.stringify({
    status,
    existingDbRowsAcrossTargetWindows:
      state.summary.existingDbRowsAcrossTargetWindows,
    bothReferencesPresent,
    allOhlcValid,
    modesIdentical,
    targets: analyzed.map(x => ({
      stockCode: x.target.stockCode,
      window: `${x.target.startDate}-${x.target.endDate}`,
      existingDbRows: x.existingDbRowCount,
      mode0Rows: x.mode0.rowCount,
      mode1Rows: x.mode1.rowCount,
      mode0Reference: x.mode0.requiredReference,
      mode1Reference: x.mode1.requiredReference,
      modeDifferences: x.comparison.differences.length
    })),
    writesPerformed: 0,
    marketBarsInserted: 0,
    adjustmentRowsInserted: 0,
    coveragePromoted: false
  }, null, 2));

  console.log(
    'Upload only this report (never upload .env files): ' + outputFile
  );

  if (status !== 'KIS_BACKFILL_DRY_RUN_READY_FOR_MAPPING') {
    process.exitCode = 2;
  }
}

if (require.main === module) {
  main().catch(error => {
    if (error?.publicDetail) {
      console.error(JSON.stringify({
        error: safeError(error),
        detail: error.publicDetail
      }, null, 2));
    } else {
      console.error(safeError(error));
    }
    process.exitCode = 1;
  });
}
