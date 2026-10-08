'use strict';

// V9.7.14 read-only adjustment-readiness validation.
// Reads the 15 validation corporate_action_events and classifies whether
// an adjustment factor can be computed safely from the stored event alone.
//
// No DB writes. No factor rows inserted.
//
// Classification:
//   READY_RATIO_ONLY
//     STOCK_SPLIT / REVERSE_SPLIT / STOCK_DIVIDEND
//     -> share_factor = ratio_to / ratio_from
//     -> price_factor = ratio_from / ratio_to
//
//   NEEDS_REFERENCE_PRICE
//     CASH_DIVIDEND
//     -> share_factor = 1
//     -> price_factor cannot be proven without a pre-event reference price
//
//   STRUCTURAL_REVIEW_REQUIRED
//     MERGER / SPIN_OFF
//     -> generic price/share factors are not applied automatically
//
// Requires:
//   NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Run:
//   node --env-file=.env.local .\scripts\v9714.cjs

const fs = require('node:fs');
const path = require('node:path');

const VERSION = 'V9_7_14_ADJUSTMENT_READINESS_PROBE';
const TABLE = 'corporate_action_events';
const PROVIDER = 'DART_KRX_CANONICAL';
const EXPECTED_ROWS = 15;

function safeError(error) {
  const m = error instanceof Error ? error.message : String(error ?? 'UNKNOWN_ERROR');
  return /^[A-Z0-9_]+$/.test(m) ? m : 'V9_7_14_FAILED';
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

async function readRows(baseUrl, key) {
  const select = [
    'id',
    'stock_code',
    'action_type',
    'effective_date',
    'ratio_from',
    'ratio_to',
    'cash_amount',
    'currency',
    'provider',
    'provider_event_id',
    'source_fingerprint',
    'status',
    'metadata',
    'is_validation',
    'production_applied',
    'created_at'
  ].join(',');

  const url =
    `${baseUrl}/rest/v1/${TABLE}` +
    `?select=${encodeURIComponent(select)}` +
    `&provider=eq.${encodeURIComponent(PROVIDER)}` +
    `&is_validation=eq.true` +
    `&production_applied=eq.false` +
    `&order=effective_date.asc,stock_code.asc,provider_event_id.asc`;

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
    throw new Error('INVALID_EVENT_ROWS_RESPONSE');
  }

  return body;
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function roundFactor(v) {
  return Number(Number(v).toPrecision(15));
}

function classify(row) {
  const ratioFrom = num(row.ratio_from);
  const ratioTo = num(row.ratio_to);
  const cashAmount = num(row.cash_amount);

  switch (row.action_type) {
    case 'STOCK_SPLIT':
    case 'REVERSE_SPLIT':
    case 'STOCK_DIVIDEND': {
      if (!(ratioFrom > 0) || !(ratioTo > 0)) {
        return {
          readiness: 'INVALID',
          reason: 'RATIO_REQUIRED_BUT_MISSING_OR_NONPOSITIVE',
          event_price_factor: null,
          event_share_factor: null
        };
      }

      const shareFactor = ratioTo / ratioFrom;
      const priceFactor = ratioFrom / ratioTo;

      return {
        readiness: 'READY_RATIO_ONLY',
        reason: 'EXPLICIT_PRE_POST_ACTION_RATIO',
        event_price_factor: roundFactor(priceFactor),
        event_share_factor: roundFactor(shareFactor),
        factorInvariantProduct: roundFactor(priceFactor * shareFactor)
      };
    }

    case 'CASH_DIVIDEND': {
      if (!(cashAmount >= 0)) {
        return {
          readiness: 'INVALID',
          reason: 'CASH_AMOUNT_PER_SHARE_MISSING',
          event_price_factor: null,
          event_share_factor: null
        };
      }

      return {
        readiness: 'NEEDS_REFERENCE_PRICE',
        reason: 'CASH_DIVIDEND_PRICE_FACTOR_REQUIRES_PRE_EVENT_REFERENCE_PRICE',
        event_price_factor: null,
        event_share_factor: 1,
        cash_amount_per_share: cashAmount,
        currency: row.currency ?? 'KRW'
      };
    }

    case 'MERGER':
      return {
        readiness: 'STRUCTURAL_REVIEW_REQUIRED',
        reason: 'MERGER_NOT_SAFE_FOR_GENERIC_RATIO_BACK_ADJUSTMENT_WITHOUT_SECURITY_CONTINUITY_POLICY',
        event_price_factor: null,
        event_share_factor: null,
        source_ratio_from: ratioFrom,
        source_ratio_to: ratioTo
      };

    case 'SPIN_OFF':
      return {
        readiness: 'STRUCTURAL_REVIEW_REQUIRED',
        reason: 'SPIN_OFF_REQUIRES_VALUE_ALLOCATION_OR_EXCHANGE_REFERENCE_BEYOND_GENERIC_RATIO',
        event_price_factor: null,
        event_share_factor: null
      };

    default:
      return {
        readiness: 'INVALID',
        reason: 'UNEXPECTED_ACTION_TYPE',
        event_price_factor: null,
        event_share_factor: null
      };
  }
}

function summarize(rows) {
  const counts = {};
  for (const row of rows) {
    counts[row.adjustment.readiness] =
      (counts[row.adjustment.readiness] || 0) + 1;
  }
  return counts;
}

function assertEventRow(row) {
  if (row.provider !== PROVIDER) throw new Error('UNEXPECTED_PROVIDER');
  if (row.is_validation !== true) throw new Error('NON_VALIDATION_ROW_FOUND');
  if (row.production_applied !== false) throw new Error('PRODUCTION_APPLIED_ROW_FOUND');
  if (row.status !== 'RECORDED') throw new Error('UNEXPECTED_DB_LIFECYCLE_STATUS');
  if (!/^\d{14}$/.test(row.provider_event_id ?? '')) {
    throw new Error('INVALID_PROVIDER_EVENT_ID');
  }
  if (!row.stock_code || !row.action_type || !row.effective_date) {
    throw new Error('REQUIRED_EVENT_FIELD_MISSING');
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
        'corporate-action-adjustment-readiness-v9-7-14.json'
      );

  const { url, key } = requireEnv();
  const rawRows = await readRows(url, key);

  if (rawRows.length !== EXPECTED_ROWS) {
    throw new Error('EXPECTED_15_VALIDATION_EVENTS');
  }

  const seen = new Set();
  const analyzed = rawRows.map(row => {
    assertEventRow(row);

    const identity = `${row.provider}|${row.provider_event_id}|${row.is_validation}`;
    if (seen.has(identity)) {
      throw new Error('DUPLICATE_PROVIDER_EVENT_IDENTITY');
    }
    seen.add(identity);

    return {
      id: row.id,
      stock_code: row.stock_code,
      action_type: row.action_type,
      effective_date: row.effective_date,
      provider_event_id: row.provider_event_id,
      status: row.status,
      metadata: row.metadata,
      adjustment: classify(row)
    };
  });

  const counts = summarize(analyzed);

  const invalidRows = analyzed.filter(
    r => r.adjustment.readiness === 'INVALID'
  );

  const ratioReady = analyzed.filter(
    r => r.adjustment.readiness === 'READY_RATIO_ONLY'
  );

  const badProduct = ratioReady.filter(r =>
    Math.abs((r.adjustment.factorInvariantProduct ?? 0) - 1) > 1e-10
  );

  const expectedCounts = {
    READY_RATIO_ONLY: 8,
    NEEDS_REFERENCE_PRICE: 3,
    STRUCTURAL_REVIEW_REQUIRED: 4,
    INVALID: 0
  };

  const invariantClosed =
    rawRows.length === 15 &&
    (counts.READY_RATIO_ONLY || 0) === expectedCounts.READY_RATIO_ONLY &&
    (counts.NEEDS_REFERENCE_PRICE || 0) === expectedCounts.NEEDS_REFERENCE_PRICE &&
    (counts.STRUCTURAL_REVIEW_REQUIRED || 0) === expectedCounts.STRUCTURAL_REVIEW_REQUIRED &&
    (counts.INVALID || 0) === 0 &&
    invalidRows.length === 0 &&
    badProduct.length === 0;

  const state = {
    version: VERSION,
    status: invariantClosed
      ? 'ADJUSTMENT_READINESS_CLASSIFIED'
      : 'ADJUSTMENT_READINESS_REVIEW_REQUIRED',
    source: {
      table: TABLE,
      provider: PROVIDER,
      validationOnly: true,
      productionApplied: false,
      rowsRead: rawRows.length
    },
    summary: {
      counts: {
        READY_RATIO_ONLY: counts.READY_RATIO_ONLY || 0,
        NEEDS_REFERENCE_PRICE: counts.NEEDS_REFERENCE_PRICE || 0,
        STRUCTURAL_REVIEW_REQUIRED: counts.STRUCTURAL_REVIEW_REQUIRED || 0,
        INVALID: counts.INVALID || 0
      },
      expectedCounts,
      ratioFactorInverseInvariantFailures: badProduct.length
    },
    rows: analyzed,
    policy: {
      READY_RATIO_ONLY:
        'Safe to compute event share/price factors directly from ratio_from/to.',
      NEEDS_REFERENCE_PRICE:
        'Cash dividend requires a verified pre-event market reference price before price factor calculation.',
      STRUCTURAL_REVIEW_REQUIRED:
        'Merger/spin-off must not be forced through the generic ratio factor pipeline.'
    },
    safety: {
      databaseConnected: true,
      httpMethodsUsed: ['GET'],
      writesPerformed: 0,
      adjustmentRowsInserted: 0,
      eventRowsUpdated: 0,
      productionAppliedRows: 0,
      coveragePromoted: false
    },
    nextGate: invariantClosed
      ? 'RESOLVE_REFERENCE_PRICES_FOR_3_CASH_DIVIDENDS_AND_DEFINE_STRUCTURAL_POLICY_FOR_3_MERGERS_PLUS_1_SPIN_OFF'
      : 'REVIEW_INVALID_OR_UNEXPECTED_ADJUSTMENT_CLASSIFICATION'
  };

  saveJson(outputFile, state);

  console.log(JSON.stringify({
    status: state.status,
    validationEventsRead: rawRows.length,
    readyRatioOnly: state.summary.counts.READY_RATIO_ONLY,
    needsReferencePrice: state.summary.counts.NEEDS_REFERENCE_PRICE,
    structuralReviewRequired:
      state.summary.counts.STRUCTURAL_REVIEW_REQUIRED,
    invalid: state.summary.counts.INVALID,
    ratioFactorInverseInvariantFailures:
      state.summary.ratioFactorInverseInvariantFailures,
    writesPerformed: 0,
    adjustmentRowsInserted: 0,
    coveragePromoted: false
  }, null, 2));

  console.log(
    'Upload only this report (never upload .env files): ' +
    outputFile
  );

  if (!invariantClosed) process.exitCode = 2;
}

if (require.main === module) {
  main().catch(error => {
    console.error(safeError(error));
    process.exitCode = 1;
  });
}
