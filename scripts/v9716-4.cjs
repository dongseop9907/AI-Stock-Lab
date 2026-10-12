'use strict';

// V9.7.16.4 controlled idempotent KIS backfill for market_daily_bars.
//
// Targets:
//   0001A0: 2026-08-01..2026-08-13  (expected 9 trading rows)
//   204610: 2026-08-15..2026-08-27  (expected 8 trading rows)
//
// Safety:
//   - default = dry-run
//   - writes only with --apply
//   - KIS mode 0 and mode 1 MUST be identical before write
//   - abort if any existing target-window row conflicts with fresh KIS mapping
//   - upsert identity = (stock_code, trading_date)
//   - second identical upsert proves idempotency
//   - no DELETE
//   - no schema migration
//   - no corporate-action/adjustment writes
//
// Run:
//   node --env-file=.env.local .\scripts\v9716-4.cjs
//   node --env-file=.env.local .\scripts\v9716-4.cjs --apply

const fs = require('node:fs');
const path = require('node:path');

const VERSION = 'V9_7_16_4_CONTROLLED_KIS_MARKET_BAR_BACKFILL';
const KIS_BASE = 'https://openapi.koreainvestment.com:9443';
const KIS_DAILY_PATH =
  '/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice';
const KIS_DAILY_TR_ID = 'FHKST03010100';

const TABLE = 'market_daily_bars';
const SOURCE = 'KIS_DAILY_V8_3';

const TARGETS = [
  {
    stockCode: '0001A0',
    startDate: '20260801',
    endDate: '20260813',
    requiredReferenceDate: '20260813',
    expectedRows: 9
  },
  {
    stockCode: '204610',
    startDate: '20260815',
    endDate: '20260827',
    requiredReferenceDate: '20260827',
    expectedRows: 8
  }
];

const EXPECTED_TOTAL_ROWS = TARGETS.reduce((n, x) => n + x.expectedRows, 0);

function safeError(error) {
  const m = error instanceof Error ? error.message : String(error ?? 'UNKNOWN_ERROR');
  return /^[A-Z0-9_]+$/.test(m) ? m : 'V9_7_16_4_FAILED';
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

function requireKisCredentials() {
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
      `HTTP_${res.status}`;

    throw new Error(
      `KIS_TOKEN_${String(code).replace(/[^A-Za-z0-9_]/g, '_').toUpperCase()}`
    );
  }

  return String(body.access_token);
}

async function sleep(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

function kisQuery(target, mode) {
  return new URLSearchParams({
    FID_COND_MRKT_DIV_CODE: 'J',
    FID_INPUT_ISCD: target.stockCode,
    FID_INPUT_DATE_1: target.startDate,
    FID_INPUT_DATE_2: target.endDate,
    FID_PERIOD_DIV_CODE: 'D',
    FID_ORG_ADJ_PRC: mode
  }).toString();
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
    .sort((a, b) =>
      String(a.stck_bsop_date).localeCompare(String(b.stck_bsop_date))
    );
}

function canonicalComparableKisRow(r) {
  return {
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
        : Number(r.acml_tr_pbmn)
  };
}

function compareModes(rows0, rows1) {
  const a = new Map(
    rows0.map(r => [String(r.stck_bsop_date), canonicalComparableKisRow(r)])
  );
  const b = new Map(
    rows1.map(r => [String(r.stck_bsop_date), canonicalComparableKisRow(r)])
  );

  const dates = [...new Set([...a.keys(), ...b.keys()])].sort();
  const differences = [];

  for (const date of dates) {
    const x = a.get(date) ?? null;
    const y = b.get(date) ?? null;

    if (JSON.stringify(x) !== JSON.stringify(y)) {
      differences.push({ date, mode0: x, mode1: y });
    }
  }

  return {
    identical: differences.length === 0 && a.size === b.size,
    differences
  };
}

function ymdToIso(ymd) {
  return `${ymd.slice(0,4)}-${ymd.slice(4,6)}-${ymd.slice(6,8)}`;
}

function toDbRow(stockCode, r, collectedAt) {
  const open = Number(r.stck_oprc);
  const high = Number(r.stck_hgpr);
  const low = Number(r.stck_lwpr);
  const close = Number(r.stck_clpr);
  const volume = Number(r.acml_vol);
  const tradingValue =
    r?.acml_tr_pbmn === null ||
    r?.acml_tr_pbmn === undefined ||
    r?.acml_tr_pbmn === ''
      ? null
      : Number(r.acml_tr_pbmn);

  if (
    !Number.isFinite(open) ||
    !Number.isFinite(high) ||
    !Number.isFinite(low) ||
    !Number.isFinite(close) ||
    !Number.isFinite(volume) ||
    open <= 0 ||
    high <= 0 ||
    low <= 0 ||
    close <= 0 ||
    volume < 0 ||
    high < low ||
    high < open ||
    high < close ||
    low > open ||
    low > close
  ) {
    throw new Error('KIS_ROW_FAILED_OHLC_CONTRACT');
  }

  return {
    stock_code: stockCode,
    trading_date: ymdToIso(String(r.stck_bsop_date)),
    open_price: open,
    high_price: high,
    low_price: low,
    close_price: close,
    volume,
    trading_value: tradingValue,
    source: SOURCE,
    adjusted_price: true,
    raw_payload: {
      mod_yn: r?.mod_yn ?? null,
      acml_vol: r?.acml_vol ?? null,
      prdy_vrss: r?.prdy_vrss ?? null,
      prtt_rate: r?.prtt_rate ?? null,
      stck_clpr: r?.stck_clpr ?? null,
      stck_hgpr: r?.stck_hgpr ?? null,
      stck_lwpr: r?.stck_lwpr ?? null,
      stck_oprc: r?.stck_oprc ?? null,
      acml_tr_pbmn: r?.acml_tr_pbmn ?? null,
      flng_cls_code: r?.flng_cls_code ?? null,
      prdy_vrss_sign: r?.prdy_vrss_sign ?? null,
      revl_issu_reas: r?.revl_issu_reas ?? null,
      stck_bsop_date: r?.stck_bsop_date ?? null
    },
    collected_at: collectedAt,
    updated_at: collectedAt
  };
}

async function supabaseJson(url, key, options = {}) {
  const res = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
      ...(options.body
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...(options.prefer
        ? { Prefer: options.prefer }
        : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const text = await res.text();
  let body = null;

  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error('SUPABASE_INVALID_JSON');
    }
  }

  if (!res.ok) {
    const code = body?.code ? String(body.code) : `HTTP_${res.status}`;
    const err = new Error(
      `SUPABASE_${code.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase()}`
    );
    err.supabase = {
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

async function readWindow(sb, target) {
  const select = [
    'id',
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
    'raw_payload',
    'collected_at',
    'created_at',
    'updated_at'
  ].join(',');

  const start = ymdToIso(target.startDate);
  const end = ymdToIso(target.endDate);

  const url =
    `${sb.url}/rest/v1/${TABLE}` +
    `?select=${encodeURIComponent(select)}` +
    `&stock_code=eq.${encodeURIComponent(target.stockCode)}` +
    `&trading_date=gte.${encodeURIComponent(start)}` +
    `&trading_date=lte.${encodeURIComponent(end)}` +
    `&order=trading_date.asc`;

  const rows = await supabaseJson(url, sb.key);
  if (!Array.isArray(rows)) throw new Error('SUPABASE_EXPECTED_ARRAY');
  return rows;
}

function dbComparable(row) {
  return {
    stock_code: String(row.stock_code),
    trading_date: String(row.trading_date),
    open_price: Number(row.open_price),
    high_price: Number(row.high_price),
    low_price: Number(row.low_price),
    close_price: Number(row.close_price),
    volume: Number(row.volume),
    trading_value:
      row.trading_value === null || row.trading_value === undefined
        ? null
        : Number(row.trading_value),
    source: String(row.source),
    adjusted_price: row.adjusted_price === true
  };
}

function mappedComparable(row) {
  return {
    stock_code: row.stock_code,
    trading_date: row.trading_date,
    open_price: Number(row.open_price),
    high_price: Number(row.high_price),
    low_price: Number(row.low_price),
    close_price: Number(row.close_price),
    volume: Number(row.volume),
    trading_value:
      row.trading_value === null || row.trading_value === undefined
        ? null
        : Number(row.trading_value),
    source: row.source,
    adjusted_price: row.adjusted_price === true
  };
}

function classifyExisting(existing, mapped) {
  const expected = new Map(
    mapped.map(r => [
      `${r.stock_code}|${r.trading_date}`,
      mappedComparable(r)
    ])
  );

  let exact = 0;
  let conflicts = 0;
  const conflictRows = [];

  for (const row of existing) {
    const key = `${row.stock_code}|${row.trading_date}`;
    const want = expected.get(key);

    if (!want) {
      conflicts++;
      conflictRows.push({
        key,
        reason: 'UNEXPECTED_DB_ROW_IN_TARGET_WINDOW',
        live: dbComparable(row),
        expected: null
      });
      continue;
    }

    const live = dbComparable(row);

    if (JSON.stringify(live) === JSON.stringify(want)) {
      exact++;
    } else {
      conflicts++;
      conflictRows.push({
        key,
        reason: 'LIVE_ROW_DIFFERS_FROM_FRESH_KIS',
        live,
        expected: want
      });
    }
  }

  return {
    exact,
    conflicts,
    missing: mapped.length - exact,
    conflictRows
  };
}

async function upsertRows(sb, rows) {
  const url =
    `${sb.url}/rest/v1/${TABLE}` +
    `?on_conflict=${encodeURIComponent('stock_code,trading_date')}`;

  const body = await supabaseJson(url, sb.key, {
    method: 'POST',
    body: rows,
    prefer: 'resolution=merge-duplicates,return=representation'
  });

  if (!Array.isArray(body)) {
    throw new Error('UPSERT_RESPONSE_NOT_ARRAY');
  }
  return body;
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const args = process.argv.slice(2);

  const apply = args.includes('--apply');
  const allowed = new Set(['--apply']);

  for (const a of args) {
    if (!allowed.has(a) && !a.startsWith('--output=')) {
      throw new Error('UNKNOWN_OPTION');
    }
  }

  const outputArg = args.find(a => a.startsWith('--output='));
  const outputFile = outputArg
    ? path.resolve(outputArg.slice('--output='.length))
    : path.join(
        root,
        'logs',
        'market-daily-bars-backfill-v9-7-16-4.json'
      );

  const creds = requireKisCredentials();
  const sb = requireSupabase();

  const tokenEnv = optionalAccessToken();
  const token = tokenEnv
    ? tokenEnv.value
    : await issueToken(creds.appKey, creds.appSecret);

  const collectedAt = new Date().toISOString();
  const targetStates = [];
  const mappedRows = [];

  for (const target of TARGETS) {
    const mode0 = await fetchKisDaily(
      target, '0', token, creds.appKey, creds.appSecret
    );
    await sleep(350);

    const mode1 = await fetchKisDaily(
      target, '1', token, creds.appKey, creds.appSecret
    );
    await sleep(350);

    if (mode0.length !== target.expectedRows) {
      throw new Error('UNEXPECTED_KIS_MODE0_ROW_COUNT');
    }
    if (mode1.length !== target.expectedRows) {
      throw new Error('UNEXPECTED_KIS_MODE1_ROW_COUNT');
    }

    const comparison = compareModes(mode0, mode1);
    if (!comparison.identical) {
      throw new Error('KIS_ORG_ADJ_MODES_DIFFER');
    }

    const reference = mode0.find(
      r => String(r.stck_bsop_date) === target.requiredReferenceDate
    );
    if (!reference) throw new Error('REQUIRED_REFERENCE_DATE_MISSING');

    const mapped = mode0.map(r =>
      toDbRow(target.stockCode, r, collectedAt)
    );

    const existing = await readWindow(sb, target);
    const before = classifyExisting(existing, mapped);

    if (before.conflicts > 0) {
      throw new Error('LIVE_MARKET_BAR_CONFLICT');
    }

    mappedRows.push(...mapped);

    targetStates.push({
      target,
      kisRows: mode0.length,
      requiredReference: canonicalComparableKisRow(reference),
      existingRowsBefore: existing.length,
      exactBefore: before.exact,
      missingBefore: before.missing,
      conflictsBefore: before.conflicts,
      modeDifferences: comparison.differences.length
    });
  }

  if (mappedRows.length !== EXPECTED_TOTAL_ROWS) {
    throw new Error('EXPECTED_17_BACKFILL_ROWS');
  }

  const identities = new Set(
    mappedRows.map(r => `${r.stock_code}|${r.trading_date}`)
  );

  if (identities.size !== EXPECTED_TOTAL_ROWS) {
    throw new Error('DUPLICATE_MAPPED_STOCK_DATE');
  }

  const exactBefore = targetStates.reduce((n, x) => n + x.exactBefore, 0);
  const missingBefore = targetStates.reduce((n, x) => n + x.missingBefore, 0);
  const conflictsBefore = targetStates.reduce((n, x) => n + x.conflictsBefore, 0);

  if (!apply) {
    const state = {
      version: VERSION,
      status: 'DRY_RUN_READY_FOR_APPLY',
      applyRequested: false,
      mappedRows: mappedRows.length,
      exactBefore,
      missingBefore,
      conflictsBefore,
      targets: targetStates,
      mapping: {
        table: TABLE,
        source: SOURCE,
        adjusted_price: true,
        upsertIdentity: ['stock_code', 'trading_date'],
        rawPayloadPreserved: true
      },
      safety: {
        writesPerformed: 0,
        marketBarsInsertedOrMerged: 0,
        adjustmentRowsInserted: 0,
        corporateActionRowsUpdated: 0,
        coveragePromoted: false
      },
      nextCommand:
        'node --env-file=.env.local .\\scripts\\v9716-4.cjs --apply'
    };

    saveJson(outputFile, state);

    console.log(JSON.stringify({
      status: state.status,
      mappedRows: state.mappedRows,
      exactBefore,
      missingBefore,
      conflictsBefore,
      targets: targetStates.map(x => ({
        stockCode: x.target.stockCode,
        kisRows: x.kisRows,
        exactBefore: x.exactBefore,
        missingBefore: x.missingBefore,
        conflictsBefore: x.conflictsBefore,
        requiredReference: x.requiredReference
      })),
      writesPerformed: 0,
      marketBarsInsertedOrMerged: 0,
      adjustmentRowsInserted: 0,
      coveragePromoted: false,
      nextCommand: state.nextCommand
    }, null, 2));

    console.log('Dry-run only. Add --apply to perform the controlled backfill.');
    console.log(
      'Upload only this report (never upload .env files): ' + outputFile
    );
    return;
  }

  const first = await upsertRows(sb, mappedRows);

  const afterFirstTargets = [];
  let afterFirstExact = 0;
  let afterFirstConflicts = 0;
  let afterFirstRows = 0;

  for (const target of TARGETS) {
    const mapped = mappedRows.filter(r => r.stock_code === target.stockCode);
    const live = await readWindow(sb, target);
    const cls = classifyExisting(live, mapped);

    afterFirstTargets.push({
      stockCode: target.stockCode,
      liveRows: live.length,
      exact: cls.exact,
      missing: cls.missing,
      conflicts: cls.conflicts
    });

    afterFirstRows += live.length;
    afterFirstExact += cls.exact;
    afterFirstConflicts += cls.conflicts;
  }

  if (
    afterFirstRows !== EXPECTED_TOTAL_ROWS ||
    afterFirstExact !== EXPECTED_TOTAL_ROWS ||
    afterFirstConflicts !== 0
  ) {
    throw new Error('FIRST_BACKFILL_VERIFICATION_FAILED');
  }

  const second = await upsertRows(sb, mappedRows);

  const afterSecondTargets = [];
  let afterSecondRows = 0;
  let afterSecondExact = 0;
  let afterSecondConflicts = 0;

  for (const target of TARGETS) {
    const mapped = mappedRows.filter(r => r.stock_code === target.stockCode);
    const live = await readWindow(sb, target);
    const cls = classifyExisting(live, mapped);

    afterSecondTargets.push({
      stockCode: target.stockCode,
      liveRows: live.length,
      exact: cls.exact,
      missing: cls.missing,
      conflicts: cls.conflicts
    });

    afterSecondRows += live.length;
    afterSecondExact += cls.exact;
    afterSecondConflicts += cls.conflicts;
  }

  const idempotencyProven =
    afterSecondRows === EXPECTED_TOTAL_ROWS &&
    afterSecondExact === EXPECTED_TOTAL_ROWS &&
    afterSecondConflicts === 0;

  if (!idempotencyProven) {
    throw new Error('SECOND_BACKFILL_IDEMPOTENCY_FAILED');
  }

  const state = {
    version: VERSION,
    status: 'MARKET_BAR_BACKFILL_AND_IDEMPOTENCY_PROVEN',
    applyRequested: true,
    mappedRows: mappedRows.length,
    exactBefore,
    missingBefore,
    conflictsBefore,
    firstUpsertResponseRows: first.length,
    rowsAfterFirstUpsert: afterFirstRows,
    exactAfterFirstUpsert: afterFirstExact,
    conflictsAfterFirstUpsert: afterFirstConflicts,
    secondUpsertResponseRows: second.length,
    rowsAfterSecondUpsert: afterSecondRows,
    exactAfterSecondUpsert: afterSecondExact,
    conflictsAfterSecondUpsert: afterSecondConflicts,
    idempotencyProven,
    targetsBefore: targetStates,
    targetsAfterFirst: afterFirstTargets,
    targetsAfterSecond: afterSecondTargets,
    mapping: {
      table: TABLE,
      source: SOURCE,
      adjusted_price: true,
      upsertIdentity: ['stock_code', 'trading_date'],
      rawPayloadPreserved: true
    },
    safety: {
      writesPerformed: 2,
      rowsTargetedPerUpsert: EXPECTED_TOTAL_ROWS,
      deleteOperations: 0,
      schemaMigrations: 0,
      adjustmentRowsInserted: 0,
      corporateActionRowsUpdated: 0,
      coveragePromoted: false
    },
    nextGate:
      'RERUN_V9_7_16_1_THEN_V9_7_16_TO_CONFIRM_REFERENCE_PRICES_AND_CASH_DIVIDEND_FACTORS'
  };

  saveJson(outputFile, state);

  console.log(JSON.stringify({
    status: state.status,
    mappedRows: state.mappedRows,
    exactBefore,
    missingBefore,
    conflictsBefore,
    firstUpsertResponseRows: state.firstUpsertResponseRows,
    rowsAfterFirstUpsert: state.rowsAfterFirstUpsert,
    secondUpsertResponseRows: state.secondUpsertResponseRows,
    rowsAfterSecondUpsert: state.rowsAfterSecondUpsert,
    conflictsAfterSecondUpsert: state.conflictsAfterSecondUpsert,
    idempotencyProven: state.idempotencyProven,
    writesPerformed: 2,
    adjustmentRowsInserted: 0,
    coveragePromoted: false
  }, null, 2));

  console.log(
    'Upload only this report (never upload .env files): ' + outputFile
  );
}

if (require.main === module) {
  main().catch(error => {
    if (error?.supabase) {
      console.error(JSON.stringify({
        error: safeError(error),
        supabase: error.supabase
      }, null, 2));
    } else if (error?.publicDetail) {
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
