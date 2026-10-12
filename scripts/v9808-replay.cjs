/* eslint-disable no-console */
'use strict';

/**
 * AI Stock Lab
 * V9.8.8 - Per-event factor/reference-price validation
 *
 * READ-ONLY. No DB writes.
 *
 * Input:
 *   logs/opendart-corporate-action-market-effective-date-v9-8-7-2-replay.json
 *
 * Output:
 *   logs/opendart-corporate-action-factor-validation-v9-8-8-replay.json
 *
 * Proven V9.7 factor contract:
 *   Ratio actions:
 *     event_price_factor = ratio_from / ratio_to
 *     event_share_factor = ratio_to / ratio_from
 *
 *   Cash dividend:
 *     reference bar = latest market_daily_bars row strictly BEFORE effective_date
 *     event_price_factor = (reference_close - cash_amount) / reference_close
 *     event_share_factor = 1
 *
 * Canonical market_daily_bars is KIS mode0 adjusted-price data.
 * These preview factors must NEVER be multiplied into already-adjusted canonical bars.
 *
 * Run:
 *   node --env-file=.env.local .\scripts\v9808.cjs
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_8_8_REPLAY_PER_EVENT_FACTOR_REFERENCE_VALIDATION';
const INPUT_VERSION =
  'V9_8_7_2_REPLAY_EFFECTIVE_DATE_FINALIZATION_AFTER_KIS_SUSPENSION_REVIEW';

const RATIO_ACTIONS = new Set([
  'STOCK_SPLIT',
  'REVERSE_SPLIT',
  'STOCK_DIVIDEND',
]);

const STRUCTURAL_ACTIONS = new Set([
  'MERGER',
  'SPIN_OFF',
]);

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''),
  );
}

function atomicSaveJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temp, file);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function countBy(rows, selector) {
  const out = {};
  for (const row of rows) {
    const key = String(selector(row) ?? 'NULL');
    out[key] = (out[key] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(out).sort(([a], [b]) => a.localeCompare(b)),
  );
}

function num(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundFactor(value) {
  return Number(Number(value).toPrecision(15));
}

function isIsoDate(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return false;
  }

  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

function requireEnv() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error('SUPABASE_URL_REQUIRED');
  }
  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY_REQUIRED');
  }

  return {
    url: String(url).replace(/\/+$/, ''),
    key: String(key),
  };
}

async function getArray(url, key) {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
    },
  });

  const text = await response.text();
  let body;

  try {
    body = JSON.parse(text);
  } catch {
    throw new Error('INVALID_SUPABASE_JSON_RESPONSE');
  }

  if (!response.ok) {
    const code = body?.code ?? `HTTP_${response.status}`;
    throw new Error(`SUPABASE_READ_FAILED:${String(code)}`);
  }

  if (!Array.isArray(body)) {
    throw new Error('SUPABASE_ARRAY_RESPONSE_REQUIRED');
  }

  return body;
}

async function readPriorBar(base, key, stockCode, effectiveDate) {
  const select = [
    'stock_code',
    'trading_date',
    'close_price',
    'source',
    'adjusted_price',
  ].join(',');

  return getArray(
    `${base}/rest/v1/market_daily_bars` +
      `?select=${encodeURIComponent(select)}` +
      `&stock_code=eq.${encodeURIComponent(stockCode)}` +
      `&trading_date=lt.${encodeURIComponent(effectiveDate)}` +
      `&order=trading_date.desc&limit=1`,
    key,
  );
}

function validateRatioEvent(row) {
  const ratioFrom = num(row.canonicalPreview?.ratio_from);
  const ratioTo = num(row.canonicalPreview?.ratio_to);

  if (!(ratioFrom > 0) || !(ratioTo > 0)) {
    return {
      status: 'REVIEW_REQUIRED',
      reason: 'RATIO_EVENT_MISSING_POSITIVE_RATIO',
      factor: null,
    };
  }

  const eventPriceFactor = roundFactor(ratioFrom / ratioTo);
  const eventShareFactor = roundFactor(ratioTo / ratioFrom);
  const reciprocalProduct = roundFactor(
    eventPriceFactor * eventShareFactor,
  );
  const reciprocalError = Math.abs(reciprocalProduct - 1);

  if (
    !(eventPriceFactor > 0) ||
    !(eventShareFactor > 0) ||
    reciprocalError > 1e-12
  ) {
    return {
      status: 'REVIEW_REQUIRED',
      reason: 'RATIO_FACTOR_CONTRACT_FAILED',
      factor: {
        eventPriceFactor,
        eventShareFactor,
        reciprocalProduct,
        reciprocalError,
      },
    };
  }

  return {
    status: 'FACTOR_READY',
    reason: 'EXPLICIT_EVENT_RATIO',
    factor: {
      eventPriceFactor,
      eventShareFactor,
      metadata: {
        factor_source: 'EXPLICIT_EVENT_RATIO',
        ratio_from: ratioFrom,
        ratio_to: ratioTo,
        ratio_contract: 'PRE_ACTION_UNITS_TO_POST_ACTION_UNITS',
        reciprocal_product: reciprocalProduct,
      },
    },
  };
}

async function validateCashDividend(row, base, key) {
  const effectiveDate = row.canonicalPreview?.effective_date;
  const cash = num(row.canonicalPreview?.cash_amount);

  if (!isIsoDate(effectiveDate)) {
    return {
      status: 'REVIEW_REQUIRED',
      reason: 'CASH_EFFECTIVE_DATE_INVALID',
      factor: null,
      databaseReads: 0,
    };
  }

  if (cash === null || cash < 0) {
    return {
      status: 'REVIEW_REQUIRED',
      reason: 'CASH_AMOUNT_INVALID',
      factor: null,
      databaseReads: 0,
    };
  }

  const bars = await readPriorBar(
    base,
    key,
    row.stockCode,
    effectiveDate,
  );

  if (bars.length !== 1) {
    return {
      status: 'REVIEW_REQUIRED',
      reason: 'CASH_REFERENCE_BAR_REQUIRED',
      factor: null,
      databaseReads: 1,
      evidence: {
        returnedRows: bars.length,
      },
    };
  }

  const reference = bars[0];
  const close = num(reference.close_price);

  if (
    !isIsoDate(reference.trading_date) ||
    reference.trading_date >= effectiveDate
  ) {
    return {
      status: 'REVIEW_REQUIRED',
      reason: 'REFERENCE_TRADING_DATE_CONTRACT_FAILED',
      factor: null,
      databaseReads: 1,
      evidence: {
        reference,
        effectiveDate,
      },
    };
  }

  if (reference.adjusted_price !== true) {
    return {
      status: 'REVIEW_REQUIRED',
      reason: 'REFERENCE_BAR_NOT_CANONICAL_ADJUSTED_PRICE',
      factor: null,
      databaseReads: 1,
      evidence: {
        reference,
      },
    };
  }

  if (!(close > 0) || !(close > cash)) {
    return {
      status: 'REVIEW_REQUIRED',
      reason: 'INVALID_CASH_REFERENCE_FACTOR_INPUT',
      factor: null,
      databaseReads: 1,
      evidence: {
        referenceClose: close,
        cashAmount: cash,
      },
    };
  }

  const eventPriceFactor = roundFactor((close - cash) / close);

  if (!(eventPriceFactor > 0) || eventPriceFactor > 1) {
    return {
      status: 'REVIEW_REQUIRED',
      reason: 'CASH_FACTOR_OUT_OF_RANGE',
      factor: null,
      databaseReads: 1,
      evidence: {
        referenceClose: close,
        cashAmount: cash,
        eventPriceFactor,
      },
    };
  }

  return {
    status: 'FACTOR_READY',
    reason: 'LATEST_PRIOR_CANONICAL_ADJUSTED_MARKET_CLOSE',
    factor: {
      eventPriceFactor,
      eventShareFactor: 1,
      metadata: {
        factor_source: 'LATEST_PRIOR_MARKET_CLOSE',
        reference_trading_date: reference.trading_date,
        reference_close_price: close,
        reference_source: reference.source,
        reference_adjusted_price_flag: reference.adjusted_price,
        cash_amount_per_share: cash,
        currency: row.canonicalPreview?.currency ?? 'KRW',
        canonical_bar_application_policy:
          'DO_NOT_APPLY_FACTOR_TO_ALREADY_ADJUSTED_MARKET_DAILY_BARS',
      },
    },
    databaseReads: 1,
  };
}

async function main() {
  if (typeof fetch !== 'function') {
    throw new Error('NODE_18_OR_NEWER_REQUIRED');
  }

  const root = path.resolve(__dirname, '..');

  const inputFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-market-effective-date-v9-8-7-2-replay.json',
  );

  const outputFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-factor-validation-v9-8-8-replay.json',
  );

  if (!fs.existsSync(inputFile)) {
    throw new Error(`INPUT_NOT_FOUND:${path.basename(inputFile)}`);
  }

  const input = readJson(inputFile);

  if (input.version !== INPUT_VERSION) {
    throw new Error('INPUT_VERSION_MISMATCH');
  }

  if (
    input.status !==
    'EFFECTIVE_DATE_FINALIZATION_COMPLETE_WITH_FUTURE_PENDING'
  ) {
    throw new Error('EFFECTIVE_DATE_STAGE_NOT_READY');
  }

  if (!Array.isArray(input.results)) {
    throw new Error('INPUT_RESULTS_MISSING');
  }

  const { url, key } = requireEnv();

  const results = [];
  let databaseReads = 0;

  for (
    let index = 0;
    index < input.results.length;
    index += 1
  ) {
    const row = input.results[index];
    const dateStatus =
      row.effectiveDateResolution?.status;

    if (dateStatus === 'FUTURE_PENDING') {
      results.push({
        ...row,
        factorValidation: {
          status: 'FUTURE_PENDING',
          reason: 'EFFECTIVE_DATE_NOT_YET_RESOLVED',
          factor: null,
        },
        v988Disposition: 'FUTURE_PENDING_NO_FACTOR',
      });

      console.log(
        [
          'FACTOR',
          `${index + 1}/${input.results.length}`,
          `root=${row.providerEventId}`,
          `action=${row.actionType}`,
          'status=FUTURE_PENDING',
        ].join(' '),
      );

      continue;
    }

    if (dateStatus === 'STRUCTURAL_BLOCKED') {
      if (!STRUCTURAL_ACTIONS.has(row.actionType)) {
        throw new Error(
          `STRUCTURAL_STATUS_ACTION_MISMATCH:${row.providerEventId}`,
        );
      }

      results.push({
        ...row,
        factorValidation: {
          status: 'STRUCTURAL_BLOCKED',
          reason:
            row.actionType === 'MERGER'
              ? 'MERGER_SECURITY_CONTINUITY_POLICY_REQUIRED'
              : 'SPIN_OFF_VALUE_ALLOCATION_POLICY_REQUIRED',
          factor: null,
        },
        v988Disposition: 'STRUCTURAL_NO_GENERIC_FACTOR',
      });

      console.log(
        [
          'FACTOR',
          `${index + 1}/${input.results.length}`,
          `root=${row.providerEventId}`,
          `action=${row.actionType}`,
          'status=STRUCTURAL_BLOCKED',
        ].join(' '),
      );

      continue;
    }

    if (dateStatus !== 'RESOLVED') {
      throw new Error(
        `UNEXPECTED_EFFECTIVE_DATE_STATUS:${dateStatus}`,
      );
    }

    let validation;

    if (RATIO_ACTIONS.has(row.actionType)) {
      validation = validateRatioEvent(row);
    } else if (row.actionType === 'CASH_DIVIDEND') {
      validation = await validateCashDividend(
        row,
        url,
        key,
      );
      databaseReads += validation.databaseReads ?? 0;
    } else {
      throw new Error(
        `UNEXPECTED_RESOLVED_ACTION_TYPE:${row.actionType}`,
      );
    }

    results.push({
      ...row,
      factorValidation: {
        status: validation.status,
        reason: validation.reason,
        factor: validation.factor,
        evidence: validation.evidence ?? null,
      },
      v988Disposition:
        validation.status === 'FACTOR_READY'
          ? 'PER_EVENT_FACTOR_READY'
          : 'FACTOR_REVIEW_REQUIRED',
    });

    console.log(
      [
        'FACTOR',
        `${index + 1}/${input.results.length}`,
        `root=${row.providerEventId}`,
        `action=${row.actionType}`,
        `status=${validation.status}`,
        `reason=${validation.reason}`,
      ].join(' '),
    );
  }

  const factorReady = results.filter(
    (row) =>
      row.factorValidation?.status === 'FACTOR_READY',
  );

  const reviewRequired = results.filter(
    (row) =>
      row.factorValidation?.status === 'REVIEW_REQUIRED',
  );

  const futurePending = results.filter(
    (row) =>
      row.factorValidation?.status === 'FUTURE_PENDING',
  );

  const structuralBlocked = results.filter(
    (row) =>
      row.factorValidation?.status === 'STRUCTURAL_BLOCKED',
  );

  const cashReady = factorReady.filter(
    (row) =>
      row.actionType === 'CASH_DIVIDEND',
  );

  const ratioReady = factorReady.filter(
    (row) =>
      RATIO_ACTIONS.has(row.actionType),
  );

  const invalidFactorRows = factorReady.filter(
    (row) => {
      const price = num(
        row.factorValidation?.factor?.eventPriceFactor,
      );
      const share = num(
        row.factorValidation?.factor?.eventShareFactor,
      );

      return !(price > 0) || !(share > 0);
    },
  );

  const nonCanonicalCashReferenceBars = cashReady.filter(
    (row) =>
      row.factorValidation?.factor?.metadata
        ?.reference_adjusted_price_flag !== true,
  );

  const duplicateCanonicalIdentities =
    results.length -
    new Set(
      results.map(
        (row) =>
          `${row.provider}|${row.providerEventId}`,
      ),
    ).size;

  const inputStable =
    results.length === input.results.length;

  const status =
    !inputStable ||
    duplicateCanonicalIdentities > 0 ||
    invalidFactorRows.length > 0 ||
    nonCanonicalCashReferenceBars.length > 0
      ? 'PER_EVENT_FACTOR_VALIDATION_INVALID'
      : reviewRequired.length === 0
        ? 'PER_EVENT_FACTOR_VALIDATION_COMPLETE'
        : 'PER_EVENT_FACTOR_VALIDATION_COMPLETE_WITH_REVIEW';

  const report = {
    version: VERSION,
    status,

    source: {
      inputVersion: input.version,
      inputFingerprint: input.outputFingerprint,
    },

    counts: {
      inputRows: input.results.length,
      outputRows: results.length,
      factorReady: factorReady.length,
      cashDividendFactorReady: cashReady.length,
      ratioFactorReady: ratioReady.length,
      factorReviewRequired: reviewRequired.length,
      futurePending: futurePending.length,
      structuralBlocked: structuralBlocked.length,
      duplicateCanonicalIdentities,
      invalidFactorRows: invalidFactorRows.length,
      nonCanonicalCashReferenceBars:
        nonCanonicalCashReferenceBars.length,
    },

    factorStatusCounts: countBy(
      results,
      (row) => row.factorValidation?.status,
    ),

    factorReasonCounts: countBy(
      results,
      (row) => row.factorValidation?.reason,
    ),

    factorReadyActionTypeCounts: countBy(
      factorReady,
      (row) => row.actionType,
    ),

    reviewActionTypeCounts: countBy(
      reviewRequired,
      (row) => row.actionType,
    ),

    reviewReasonCounts: countBy(
      reviewRequired,
      (row) => row.factorValidation?.reason,
    ),

    reviewQueue: reviewRequired.map(
      (row) => ({
        providerEventId: row.providerEventId,
        sourceReceiptNo: row.sourceReceiptNo,
        stockCode: row.stockCode,
        actionType: row.actionType,
        effectiveDate:
          row.canonicalPreview?.effective_date ?? null,
        ratioFrom:
          row.canonicalPreview?.ratio_from ?? null,
        ratioTo:
          row.canonicalPreview?.ratio_to ?? null,
        cashAmount:
          row.canonicalPreview?.cash_amount ?? null,
        factorValidation: row.factorValidation,
      }),
    ),

    futurePendingRows: futurePending.map(
      (row) => ({
        providerEventId: row.providerEventId,
        stockCode: row.stockCode,
        actionType: row.actionType,
        recordDate: row.parsed?.recordDate ?? null,
        factorStatus: row.factorValidation?.status,
      }),
    ),

    safety: {
      networkRequests: databaseReads,
      databaseReads,
      databaseWrites: 0,
      productionApplied: false,
      canonicalEventsCreated: 0,
      providerEventIdsPersisted: 0,
      factorsPersisted: 0,
      cumulativeFactorsComputed: false,
      canonicalAdjustedBarsMutated: false,
      coverageWindowAdvanced: false,
      eventInsertAllowed: false,
    },

    policy: {
      ratioFactor:
        'PRICE_RATIO_FROM_OVER_TO_SHARE_RATIO_TO_OVER_FROM',
      cashFactor:
        'LATEST_MARKET_CLOSE_STRICTLY_BEFORE_EFFECTIVE_DATE',
      cashFormula:
        '(REFERENCE_CLOSE_MINUS_CASH_PER_SHARE)_DIVIDED_BY_REFERENCE_CLOSE',
      cashReferenceBar:
        'REQUIRE_CANONICAL_ADJUSTED_PRICE_TRUE',
      canonicalBars:
        'DO_NOT_APPLY_CORPORATE_ACTION_FACTOR_TO_ALREADY_ADJUSTED_MARKET_DAILY_BARS',
      structural:
        'NO_GENERIC_FACTOR',
      cumulativeFactor:
        'DEFER_TO_LATER_ORDERED_PER_STOCK_ACCUMULATION_STAGE',
      persistence:
        'NO_WRITES_IN_V9_8_8',
    },

    results,

    outputFile: path
      .relative(root, outputFile)
      .replaceAll('\\', '/'),
  };

  report.outputFingerprint =
    sha256(
      JSON.stringify({
        version: report.version,
        inputFingerprint: report.source.inputFingerprint,
        rows: results.map(
          (row) => [
            row.providerEventId,
            row.actionType,
            row.factorValidation?.status,
            row.factorValidation?.reason,
            row.factorValidation?.factor
              ?.eventPriceFactor ?? null,
            row.factorValidation?.factor
              ?.eventShareFactor ?? null,
            row.factorValidation?.factor
              ?.metadata
              ?.reference_trading_date ?? null,
          ],
        ),
      }),
    );

  atomicSaveJson(outputFile, report);

  console.log(
    JSON.stringify(
      {
        status: report.status,
        version: VERSION,
        ...report.counts,
        factorStatusCounts: report.factorStatusCounts,
        factorReadyActionTypeCounts:
          report.factorReadyActionTypeCounts,
        reviewActionTypeCounts:
          report.reviewActionTypeCounts,
        reviewReasonCounts:
          report.reviewReasonCounts,
        reviewQueue: report.reviewQueue,
        futurePendingRows:
          report.futurePendingRows,
        networkRequests: databaseReads,
        databaseWrites: 0,
        productionApplied: false,
        canonicalEventsCreated: 0,
        factorsPersisted: 0,
        cumulativeFactorsComputed: false,
        canonicalAdjustedBarsMutated: false,
        coverageWindowAdvanced: false,
        outputFile: report.outputFile,
      },
      null,
      2,
    ),
  );

  if (
    status ===
    'PER_EVENT_FACTOR_VALIDATION_INVALID'
  ) {
    process.exitCode = 2;
  }
}

main().catch(
  (error) => {
    console.error(
      String(error?.message ?? error),
    );
    process.exitCode = 1;
  },
);
