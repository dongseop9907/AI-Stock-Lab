'use strict';

// V9.7.21 read-only stored-price-basis / shadow-adjustment audit.
//
// Purpose:
//   Determine whether applying corporate-action factors to market_daily_bars
//   would improve or worsen event-boundary price continuity.
//
// This is NOT a production adjustment.
// This script never writes to DB.
//
// For each of 11 persisted validation factor rows:
//   prior = latest stored bar before effective_date
//   next  = earliest stored bar on/after effective_date
//
// Hypotheses:
//   RAW_SERIES:
//     adjustedPrior = priorClose * event_price_factor
//     should move closer to nextClose around material ratio events.
//
//   ALREADY_ADJUSTED_SERIES:
//     stored prior/next prices are already comparable;
//     multiplying prior by event factor would usually worsen continuity.
//
// Cash dividends and small stock dividends can be naturally noisy,
// so material ratio events are treated as the strongest evidence.
//
// Run:
//   node --env-file=.env.local .\scripts\v9721.cjs

const fs = require('node:fs');
const path = require('node:path');

const VERSION = 'V9_7_21_STORED_PRICE_BASIS_SHADOW_AUDIT';
const FACTOR_TABLE = 'corporate_action_adjustment_factors';
const RUN_TABLE = 'corporate_action_adjustment_runs';
const BAR_TABLE = 'market_daily_bars';
const RUN_VERSION = 'CORPORATE_ACTION_ADJUSTMENT_V9_7_19_VALIDATION';

function saveJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function requireEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('SUPABASE_URL_REQUIRED');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY_REQUIRED');
  return { url: String(url).replace(/\/+$/, ''), key: String(key) };
}

async function getArray(url, key) {
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
    throw new Error('INVALID_SUPABASE_JSON');
  }

  if (!res.ok) {
    const code = body?.code || `HTTP_${res.status}`;
    throw new Error(
      String(code).replace(/[^A-Za-z0-9_]/g, '_').toUpperCase()
    );
  }

  if (!Array.isArray(body)) throw new Error('EXPECTED_ARRAY_RESPONSE');
  return body;
}

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function round(v, sig = 15) {
  return Number(Number(v).toPrecision(sig));
}

async function readValidationRuns(base, key) {
  const select = 'id,stock_code,version,status,is_validation,production_applied';

  return getArray(
    `${base}/rest/v1/${RUN_TABLE}` +
    `?select=${encodeURIComponent(select)}` +
    `&version=eq.${encodeURIComponent(RUN_VERSION)}` +
    `&is_validation=eq.true` +
    `&production_applied=eq.false` +
    `&order=stock_code.asc`,
    key
  );
}

async function readFactors(base, key, runIds) {
  const select = [
    'adjustment_run_id',
    'stock_code',
    'effective_date',
    'action_event_id',
    'action_type',
    'event_price_factor',
    'event_share_factor',
    'cumulative_price_factor',
    'cumulative_share_factor',
    'metadata',
    'is_validation',
    'production_applied'
  ].join(',');

  return getArray(
    `${base}/rest/v1/${FACTOR_TABLE}` +
    `?select=${encodeURIComponent(select)}` +
    `&adjustment_run_id=in.(${runIds.join(',')})` +
    `&is_validation=eq.true` +
    `&production_applied=eq.false` +
    `&order=stock_code.asc,effective_date.asc`,
    key
  );
}

async function priorBar(base, key, stock, date) {
  const select =
    'stock_code,trading_date,open_price,high_price,low_price,close_price,volume,source,adjusted_price,raw_payload';

  return getArray(
    `${base}/rest/v1/${BAR_TABLE}` +
    `?select=${encodeURIComponent(select)}` +
    `&stock_code=eq.${encodeURIComponent(stock)}` +
    `&trading_date=lt.${encodeURIComponent(date)}` +
    `&order=trading_date.desc&limit=1`,
    key
  );
}

async function nextBar(base, key, stock, date) {
  const select =
    'stock_code,trading_date,open_price,high_price,low_price,close_price,volume,source,adjusted_price,raw_payload';

  return getArray(
    `${base}/rest/v1/${BAR_TABLE}` +
    `?select=${encodeURIComponent(select)}` +
    `&stock_code=eq.${encodeURIComponent(stock)}` +
    `&trading_date=gte.${encodeURIComponent(date)}` +
    `&order=trading_date.asc&limit=1`,
    key
  );
}

function logDistance(a, b) {
  if (!(a > 0) || !(b > 0)) return null;
  return Math.abs(Math.log(a / b));
}

function classifyEvidence(actionType, factor, rawDistance, shadowDistance) {
  if (rawDistance === null || shadowDistance === null) {
    return 'UNRESOLVED';
  }

  const factorMagnitude = Math.abs(Math.log(factor));
  const improvement = rawDistance - shadowDistance;

  // Small-factor corporate actions are much more exposed to normal daily
  // market movement, so avoid strong basis conclusions from those alone.
  const material =
    ['STOCK_SPLIT', 'REVERSE_SPLIT'].includes(actionType) ||
    factorMagnitude >= 0.10;

  if (!material) {
    if (improvement > 0.05) return 'WEAK_SUPPORTS_RAW_SERIES';
    if (improvement < -0.05) return 'WEAK_SUPPORTS_ALREADY_ADJUSTED_SERIES';
    return 'AMBIGUOUS_SMALL_FACTOR';
  }

  if (improvement > 0.10) return 'SUPPORTS_RAW_SERIES';
  if (improvement < -0.10) return 'SUPPORTS_ALREADY_ADJUSTED_SERIES';
  return 'AMBIGUOUS_MATERIAL_EVENT';
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
        'stored-price-basis-shadow-audit-v9-7-21.json'
      );

  const { url, key } = requireEnv();

  const runs = await readValidationRuns(url, key);

  if (runs.length !== 15) {
    throw new Error('EXPECTED_15_VALIDATION_RUNS');
  }

  const runIds = runs.map(r => r.id);
  const factors = await readFactors(url, key, runIds);

  if (factors.length !== 11) {
    throw new Error('EXPECTED_11_VALIDATION_FACTORS');
  }

  const rows = [];

  for (const f of factors) {
    const [beforeRows, afterRows] = await Promise.all([
      priorBar(url, key, f.stock_code, f.effective_date),
      nextBar(url, key, f.stock_code, f.effective_date)
    ]);

    if (!beforeRows.length || !afterRows.length) {
      rows.push({
        stockCode: f.stock_code,
        actionType: f.action_type,
        effectiveDate: f.effective_date,
        eventPriceFactor: n(f.event_price_factor),
        status: 'UNRESOLVED_BAR_CONTEXT',
        priorBarPresent: beforeRows.length === 1,
        nextBarPresent: afterRows.length === 1
      });
      continue;
    }

    const before = beforeRows[0];
    const after = afterRows[0];

    const priorClose = n(before.close_price);
    const nextClose = n(after.close_price);
    const priorVolume = n(before.volume);
    const factor = n(f.event_price_factor);
    const shareFactor = n(f.event_share_factor);

    if (
      !(priorClose > 0) ||
      !(nextClose > 0) ||
      !(factor > 0) ||
      !(shareFactor > 0)
    ) {
      throw new Error('INVALID_FACTOR_OR_BAR_VALUE');
    }

    const shadowAdjustedPriorClose = priorClose * factor;
    const shadowAdjustedPriorVolume =
      priorVolume === null ? null : priorVolume * shareFactor;

    const rawDistance = logDistance(nextClose, priorClose);
    const shadowDistance =
      logDistance(nextClose, shadowAdjustedPriorClose);

    const evidence = classifyEvidence(
      f.action_type,
      factor,
      rawDistance,
      shadowDistance
    );

    rows.push({
      stockCode: f.stock_code,
      actionType: f.action_type,
      effectiveDate: f.effective_date,
      eventPriceFactor: factor,
      eventShareFactor: shareFactor,
      prior: {
        tradingDate: before.trading_date,
        close: priorClose,
        volume: priorVolume,
        source: before.source,
        adjustedPriceFlag: before.adjusted_price,
        rawPayloadModYn: before.raw_payload?.mod_yn ?? null
      },
      next: {
        tradingDate: after.trading_date,
        close: nextClose,
        volume: n(after.volume),
        source: after.source,
        adjustedPriceFlag: after.adjusted_price,
        rawPayloadModYn: after.raw_payload?.mod_yn ?? null
      },
      shadow: {
        adjustedPriorClose: round(shadowAdjustedPriorClose),
        adjustedPriorVolume:
          shadowAdjustedPriorVolume === null
            ? null
            : round(shadowAdjustedPriorVolume),
        rawLogDistance: round(rawDistance),
        shadowAdjustedLogDistance: round(shadowDistance),
        continuityImprovement:
          round(rawDistance - shadowDistance)
      },
      evidence,
      status: 'RESOLVED'
    });
  }

  const resolved = rows.filter(r => r.status === 'RESOLVED');
  const unresolved = rows.filter(r => r.status !== 'RESOLVED');

  const counts = {};
  for (const r of resolved) {
    counts[r.evidence] = (counts[r.evidence] || 0) + 1;
  }

  const materialRatioRows = resolved.filter(r =>
    ['STOCK_SPLIT', 'REVERSE_SPLIT'].includes(r.actionType)
  );

  const materialRawSupport = materialRatioRows.filter(
    r => r.evidence === 'SUPPORTS_RAW_SERIES'
  ).length;

  const materialAdjustedSupport = materialRatioRows.filter(
    r => r.evidence === 'SUPPORTS_ALREADY_ADJUSTED_SERIES'
  ).length;

  let basisConclusion = 'INCONCLUSIVE';

  if (
    materialRatioRows.length > 0 &&
    materialRawSupport === materialRatioRows.length
  ) {
    basisConclusion = 'STORED_SERIES_BEHAVES_LIKE_RAW_AROUND_SPLIT_EVENTS';
  } else if (
    materialRatioRows.length > 0 &&
    materialAdjustedSupport === materialRatioRows.length
  ) {
    basisConclusion =
      'STORED_SERIES_BEHAVES_LIKE_ALREADY_ADJUSTED_AROUND_SPLIT_EVENTS';
  } else if (
    materialRawSupport > 0 &&
    materialAdjustedSupport === 0
  ) {
    basisConclusion = 'EVIDENCE_LEANS_RAW_BUT_NOT_UNANIMOUS';
  } else if (
    materialAdjustedSupport > 0 &&
    materialRawSupport === 0
  ) {
    basisConclusion =
      'EVIDENCE_LEANS_ALREADY_ADJUSTED_BUT_NOT_UNANIMOUS';
  } else if (
    materialRawSupport > 0 &&
    materialAdjustedSupport > 0
  ) {
    basisConclusion =
      'MIXED_PRICE_BASIS_OR_EVENT_DATA_REQUIRES_REVIEW';
  }

  const report = {
    version: VERSION,
    status:
      unresolved.length === 0
        ? 'STORED_PRICE_BASIS_SHADOW_AUDIT_COMPLETE'
        : 'STORED_PRICE_BASIS_SHADOW_AUDIT_REVIEW_REQUIRED',
    summary: {
      validationRuns: runs.length,
      validationFactors: factors.length,
      resolvedFactorContexts: resolved.length,
      unresolvedFactorContexts: unresolved.length,
      evidenceCounts: counts,
      materialSplitReverseSplitEvents: materialRatioRows.length,
      materialSplitRawSupport: materialRawSupport,
      materialSplitAlreadyAdjustedSupport:
        materialAdjustedSupport,
      basisConclusion
    },
    rows,
    interpretation: {
      adjusted_price_column_warning:
        'The database adjusted_price flag alone is not accepted as proof of price basis.',
      raw_payload_mod_yn_warning:
        'KIS raw_payload.mod_yn and stored adjusted_price may use different semantics; event-boundary behavior is audited directly.',
      productionRule:
        'DO_NOT_APPLY_PERSISTED_FACTORS_TO_STORED_MARKET_BARS_UNTIL_PRICE_BASIS_IS_CONFIRMED.',
      currentAudit:
        'READ_ONLY_SHADOW_CALCULATION_ONLY'
    },
    safety: {
      databaseConnected: true,
      httpMethodsUsed: ['GET'],
      writesPerformed: 0,
      marketBarsUpdated: 0,
      adjustmentFactorsUpdated: 0,
      productionAppliedRows: 0,
      coveragePromoted: false
    }
  };

  saveJson(outputFile, report);

  console.log(JSON.stringify({
    status: report.status,
    validationRuns: report.summary.validationRuns,
    validationFactors: report.summary.validationFactors,
    resolvedFactorContexts:
      report.summary.resolvedFactorContexts,
    unresolvedFactorContexts:
      report.summary.unresolvedFactorContexts,
    evidenceCounts: report.summary.evidenceCounts,
    materialSplitReverseSplitEvents:
      report.summary.materialSplitReverseSplitEvents,
    materialSplitRawSupport:
      report.summary.materialSplitRawSupport,
    materialSplitAlreadyAdjustedSupport:
      report.summary.materialSplitAlreadyAdjustedSupport,
    basisConclusion:
      report.summary.basisConclusion,
    rows: rows.map(r => ({
      stockCode: r.stockCode,
      actionType: r.actionType,
      effectiveDate: r.effectiveDate,
      eventPriceFactor: r.eventPriceFactor,
      priorDate: r.prior?.tradingDate ?? null,
      priorClose: r.prior?.close ?? null,
      nextDate: r.next?.tradingDate ?? null,
      nextClose: r.next?.close ?? null,
      adjustedPriceFlags:
        r.prior
          ? [r.prior.adjustedPriceFlag, r.next.adjustedPriceFlag]
          : null,
      rawPayloadModYn:
        r.prior
          ? [r.prior.rawPayloadModYn, r.next.rawPayloadModYn]
          : null,
      rawLogDistance:
        r.shadow?.rawLogDistance ?? null,
      shadowAdjustedLogDistance:
        r.shadow?.shadowAdjustedLogDistance ?? null,
      continuityImprovement:
        r.shadow?.continuityImprovement ?? null,
      evidence: r.evidence ?? null,
      status: r.status
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
