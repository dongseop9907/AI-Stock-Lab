/* eslint-disable no-console */
'use strict';

/**
 * AI Stock Lab
 * V9.8.11.10.2 - Existing market_daily_bars coverage preflight
 *
 * READ-ONLY.
 * - Supabase GET only
 * - no KIS calls
 * - no market_daily_bars writes
 *
 * Input:
 *   logs/opendart-corporate-action-ratio-refresh-eligibility-v9-8-11-10-1.json
 *
 * Output:
 *   logs/opendart-corporate-action-ratio-refresh-coverage-preflight-v9-8-11-10-2.json
 *
 * Purpose:
 *   Inspect the 18 currently eligible ratio-action stocks and derive the
 *   safest existing-history refresh range before any KIS request is made.
 *
 * Policy:
 *   - evidence/refresh snapshot end = 2026-10-01
 *   - canonical market_daily_bars must be adjusted_price=true
 *   - refresh start = earliest existing canonical bar on/before snapshot
 *   - refresh end   = 2026-10-01
 *   - no corporate-action factor is multiplied into canonical bars
 *   - future ratio events remain excluded upstream
 *
 * Per stock this reads:
 *   - earliest row + exact row count through snapshot
 *   - latest row through snapshot
 *   - exact count of adjusted_price=false through snapshot
 *   - last bar strictly before effective date
 *   - first bar on/after effective date through snapshot
 *
 * Run:
 *   node --env-file=.env.local .\scripts\v9811-10-2.cjs
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_8_11_10_2_RATIO_MARKET_DAILY_BAR_COVERAGE_PREFLIGHT';

const INPUT_VERSION =
  'V9_8_11_10_1_RATIO_KIS_REFRESH_ELIGIBILITY_GATE';

const SNAPSHOT_AS_OF =
  '2026-10-01';

const EXPECTED_ELIGIBLE =
  18;

const CHUNK_DAYS =
  90;

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''),
  );
}

function atomicSaveJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;

  fs.writeFileSync(
    tmp,
    JSON.stringify(value, null, 2),
    'utf8',
  );

  fs.renameSync(tmp, file);
}

function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(value)
    .digest('hex');
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

function parseContentRangeCount(value) {
  if (!value) return null;

  const match =
    String(value).match(/\/(\d+|\*)$/);

  if (!match || match[1] === '*') {
    return null;
  }

  const n = Number(match[1]);

  return Number.isInteger(n)
    ? n
    : null;
}

async function getArrayWithCount(
  url,
  key,
) {
  const response =
    await fetch(
      url,
      {
        method: 'GET',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          Accept: 'application/json',
          Prefer: 'count=exact',
        },
      },
    );

  const text =
    await response.text();

  let body;

  try {
    body =
      JSON.parse(text);
  } catch {
    throw new Error(
      'INVALID_SUPABASE_JSON_RESPONSE',
    );
  }

  if (!response.ok) {
    const error =
      new Error(
        `SUPABASE_READ_FAILED:${body?.code ?? response.status}`,
      );

    error.details = {
      status: response.status,
      code: body?.code ?? null,
      message: body?.message ?? null,
      details: body?.details ?? null,
      hint: body?.hint ?? null,
    };

    throw error;
  }

  if (!Array.isArray(body)) {
    throw new Error(
      'SUPABASE_ARRAY_RESPONSE_REQUIRED',
    );
  }

  return {
    rows: body,
    count:
      parseContentRangeCount(
        response.headers.get(
          'content-range',
        ),
      ),
  };
}

async function getArray(
  url,
  key,
) {
  const response =
    await fetch(
      url,
      {
        method: 'GET',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          Accept: 'application/json',
        },
      },
    );

  const text =
    await response.text();

  let body;

  try {
    body =
      JSON.parse(text);
  } catch {
    throw new Error(
      'INVALID_SUPABASE_JSON_RESPONSE',
    );
  }

  if (!response.ok) {
    const error =
      new Error(
        `SUPABASE_READ_FAILED:${body?.code ?? response.status}`,
      );

    error.details = {
      status: response.status,
      code: body?.code ?? null,
      message: body?.message ?? null,
      details: body?.details ?? null,
      hint: body?.hint ?? null,
    };

    throw error;
  }

  if (!Array.isArray(body)) {
    throw new Error(
      'SUPABASE_ARRAY_RESPONSE_REQUIRED',
    );
  }

  return body;
}

function parseDate(value) {
  const date =
    new Date(
      `${value}T00:00:00Z`,
    );

  if (
    !Number.isFinite(
      date.getTime(),
    )
  ) {
    throw new Error(
      `INVALID_DATE:${value}`,
    );
  }

  return date;
}

function estimateChunks(
  startDate,
  endDate,
  chunkDays,
) {
  const start =
    parseDate(startDate);

  const end =
    parseDate(endDate);

  if (
    start.getTime() >
    end.getTime()
  ) {
    return 0;
  }

  const millisecondsPerDay =
    24 * 60 * 60 * 1000;

  const inclusiveDays =
    Math.floor(
      (
        end.getTime() -
        start.getTime()
      ) /
        millisecondsPerDay,
    ) + 1;

  return Math.ceil(
    inclusiveDays /
    chunkDays,
  );
}

function normalizeBar(row) {
  if (!row) return null;

  return {
    tradingDate:
      row.trading_date,

    adjustedPrice:
      row.adjusted_price,

    source:
      row.source ?? null,
  };
}

async function main() {
  const root =
    path.resolve(
      __dirname,
      '..',
    );

  const inputFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-ratio-refresh-eligibility-v9-8-11-10-1.json',
    );

  const outputFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-ratio-refresh-coverage-preflight-v9-8-11-10-2.json',
    );

  if (
    !fs.existsSync(
      inputFile,
    )
  ) {
    throw new Error(
      `INPUT_NOT_FOUND:${path.basename(inputFile)}`,
    );
  }

  const input =
    readJson(
      inputFile,
    );

  if (
    input.version !==
    INPUT_VERSION
  ) {
    throw new Error(
      'INPUT_VERSION_MISMATCH',
    );
  }

  if (
    input.status !==
    'RATIO_KIS_REFRESH_ELIGIBILITY_READY'
  ) {
    throw new Error(
      'ELIGIBILITY_STAGE_NOT_READY',
    );
  }

  if (
    !Array.isArray(
      input.eligibleRefreshPlan,
    ) ||
    input.eligibleRefreshPlan.length !==
      EXPECTED_ELIGIBLE
  ) {
    throw new Error(
      'EXPECTED_18_ELIGIBLE_REFRESH_ROWS',
    );
  }

  const {
    url,
    key,
  } =
    requireEnv();

  const results = [];

  let networkRequests = 0;

  for (
    let index = 0;
    index <
    input.eligibleRefreshPlan.length;
    index += 1
  ) {
    const event =
      input.eligibleRefreshPlan[index];

    const stockCode =
      event.stockCode;

    const encodedStock =
      encodeURIComponent(
        stockCode,
      );

    const encodedSnapshot =
      encodeURIComponent(
        SNAPSHOT_AS_OF,
      );

    const encodedEffective =
      encodeURIComponent(
        event.effectiveDate,
      );

    const select =
      encodeURIComponent(
        'trading_date,adjusted_price,source',
      );

    const base =
      `${url}/rest/v1/market_daily_bars` +
      `?select=${select}` +
      `&stock_code=eq.${encodedStock}`;

    // Earliest + exact count through snapshot.
    const earliestResult =
      await getArrayWithCount(
        `${base}` +
          `&trading_date=lte.${encodedSnapshot}` +
          `&order=trading_date.asc` +
          `&limit=1`,
        key,
      );

    networkRequests += 1;

    // Latest through snapshot.
    const latestRows =
      await getArray(
        `${base}` +
          `&trading_date=lte.${encodedSnapshot}` +
          `&order=trading_date.desc` +
          `&limit=1`,
        key,
      );

    networkRequests += 1;

    // Exact count of non-adjusted rows through snapshot.
    const unadjustedResult =
      await getArrayWithCount(
        `${base}` +
          `&trading_date=lte.${encodedSnapshot}` +
          `&adjusted_price=eq.false` +
          `&limit=1`,
        key,
      );

    networkRequests += 1;

    // Last bar before event.
    const beforeRows =
      await getArray(
        `${base}` +
          `&trading_date=lt.${encodedEffective}` +
          `&order=trading_date.desc` +
          `&limit=1`,
        key,
      );

    networkRequests += 1;

    // First bar on/after event, capped by snapshot.
    const afterRows =
      await getArray(
        `${base}` +
          `&trading_date=gte.${encodedEffective}` +
          `&trading_date=lte.${encodedSnapshot}` +
          `&order=trading_date.asc` +
          `&limit=1`,
        key,
      );

    networkRequests += 1;

    const earliest =
      normalizeBar(
        earliestResult.rows[0] ??
        null,
      );

    const latest =
      normalizeBar(
        latestRows[0] ??
        null,
      );

    const lastBefore =
      normalizeBar(
        beforeRows[0] ??
        null,
      );

    const firstOnOrAfter =
      normalizeBar(
        afterRows[0] ??
        null,
      );

    const totalRows =
      earliestResult.count ??
      0;

    const unadjustedRows =
      unadjustedResult.count ??
      0;

    const hasCoverage =
      totalRows > 0 &&
      earliest !== null &&
      latest !== null;

    const refreshStart =
      hasCoverage
        ? earliest.tradingDate
        : null;

    const refreshEnd =
      hasCoverage
        ? SNAPSHOT_AS_OF
        : null;

    const estimatedKisRequests =
      hasCoverage
        ? estimateChunks(
            refreshStart,
            refreshEnd,
            CHUNK_DAYS,
          )
        : 0;

    const warnings = [];

    if (!hasCoverage) {
      warnings.push(
        'NO_EXISTING_MARKET_DAILY_BAR_COVERAGE',
      );
    }

    if (unadjustedRows > 0) {
      warnings.push(
        'UNADJUSTED_ROWS_PRESENT_IN_CANONICAL_WINDOW',
      );
    }

    if (!lastBefore) {
      warnings.push(
        'NO_PRE_EVENT_BAR_FOUND',
      );
    }

    if (!firstOnOrAfter) {
      warnings.push(
        'NO_ON_OR_AFTER_EVENT_BAR_THROUGH_SNAPSHOT',
      );
    }

    if (
      latest &&
      latest.tradingDate <
        event.effectiveDate
    ) {
      warnings.push(
        'LATEST_BAR_PRECEDES_EFFECTIVE_DATE',
      );
    }

    results.push({
      stockCode,
      providerEventId:
        event.providerEventId,

      actionType:
        event.actionType,

      effectiveDate:
        event.effectiveDate,

      eventId:
        event.eventId,

      runId:
        event.runId,

      factorId:
        event.factorId,

      totalRowsThroughSnapshot:
        totalRows,

      unadjustedRowsThroughSnapshot:
        unadjustedRows,

      earliestBar:
        earliest,

      latestBar:
        latest,

      lastBarBeforeEffectiveDate:
        lastBefore,

      firstBarOnOrAfterEffectiveDate:
        firstOnOrAfter,

      refreshStart,
      refreshEnd,

      chunkDays:
        CHUNK_DAYS,

      estimatedKisRequests,

      refreshPolicy:
        'REQUERY_EXISTING_CANONICAL_HISTORY_THROUGH_SNAPSHOT_USING_KIS_ADJUSTED',

      applyCorporateActionFactorToCanonicalBars:
        false,

      warnings,
    });

    console.log(
      [
        'COVERAGE_PREFLIGHT',
        `${index + 1}/${input.eligibleRefreshPlan.length}`,
        `stock=${stockCode}`,
        `effective=${event.effectiveDate}`,
        `rows=${totalRows}`,
        `unadjusted=${unadjustedRows}`,
        `range=${refreshStart ?? '-'}..${refreshEnd ?? '-'}`,
        `estimatedKisRequests=${estimatedKisRequests}`,
        `warnings=${warnings.length}`,
      ].join(' '),
    );
  }

  const noCoverage =
    results.filter(
      (row) =>
        !row.refreshStart,
    );

  const withUnadjustedRows =
    results.filter(
      (row) =>
        row.unadjustedRowsThroughSnapshot >
        0,
    );

  const noPreEventBar =
    results.filter(
      (row) =>
        !row.lastBarBeforeEffectiveDate,
    );

  const noPostEventBar =
    results.filter(
      (row) =>
        !row.firstBarOnOrAfterEffectiveDate,
    );

  const latestBeforeEffective =
    results.filter(
      (row) =>
        row.latestBar &&
        row.latestBar.tradingDate <
          row.effectiveDate,
    );

  const totalEstimatedKisRequests =
    results.reduce(
      (sum, row) =>
        sum +
        row.estimatedKisRequests,
      0,
    );

  const blockers = [];

  if (
    noCoverage.length >
    0
  ) {
    blockers.push(
      'MISSING_EXISTING_CANONICAL_BAR_COVERAGE',
    );
  }

  if (
    withUnadjustedRows.length >
    0
  ) {
    blockers.push(
      'CANONICAL_WINDOW_CONTAINS_UNADJUSTED_ROWS',
    );
  }

  const status =
    blockers.length === 0
      ? 'RATIO_MARKET_DAILY_BAR_COVERAGE_PREFLIGHT_READY'
      : 'RATIO_MARKET_DAILY_BAR_COVERAGE_PREFLIGHT_BLOCKED';

  const report = {
    version:
      VERSION,

    status,

    source: {
      inputVersion:
        input.version,

      inputFingerprint:
        input.outputFingerprint,
    },

    policy: {
      snapshotAsOf:
        SNAPSHOT_AS_OF,

      refreshStart:
        'EARLIEST_EXISTING_BAR_THROUGH_SNAPSHOT',

      refreshEnd:
        SNAPSHOT_AS_OF,

      adjustedPrice:
        true,

      chunkDays:
        CHUNK_DAYS,

      writer:
        'EXISTING_SYNC_DAILY_BARS_PATH',

      upsertIdentity:
        'stock_code,trading_date',

      corporateActionFactorApplication:
        'NEVER_APPLY_TO_CANONICAL_KIS_ADJUSTED_BARS',
    },

    counts: {
      eligibleStocks:
        results.length,

      stocksWithCoverage:
        results.length -
        noCoverage.length,

      stocksWithoutCoverage:
        noCoverage.length,

      stocksWithUnadjustedRows:
        withUnadjustedRows.length,

      stocksWithoutPreEventBar:
        noPreEventBar.length,

      stocksWithoutOnOrAfterEventBar:
        noPostEventBar.length,

      stocksLatestBarBeforeEffectiveDate:
        latestBeforeEffective.length,

      totalRowsThroughSnapshot:
        results.reduce(
          (sum, row) =>
            sum +
            row.totalRowsThroughSnapshot,
          0,
        ),

      totalUnadjustedRowsThroughSnapshot:
        results.reduce(
          (sum, row) =>
            sum +
            row.unadjustedRowsThroughSnapshot,
          0,
        ),

      estimatedKisRequests:
        totalEstimatedKisRequests,

      databaseReadRequests:
        networkRequests,
    },

    blockers,

    warnings: {
      noPreEventBar:
        noPreEventBar.map(
          (row) =>
            row.stockCode,
        ),

      noOnOrAfterEventBar:
        noPostEventBar.map(
          (row) =>
            row.stockCode,
        ),

      latestBarBeforeEffectiveDate:
        latestBeforeEffective.map(
          (row) =>
            row.stockCode,
        ),
    },

    refreshPlan:
      results
        .slice()
        .sort(
          (a, b) =>
            `${a.effectiveDate}|${a.stockCode}`
              .localeCompare(
                `${b.effectiveDate}|${b.stockCode}`,
              ),
        ),

    safety: {
      databaseReads:
        networkRequests,

      databaseWrites:
        0,

      kisRequests:
        0,

      marketDailyBarsModified:
        0,

      corporateActionFactorsAppliedToCanonicalBars:
        0,

      coverageWindowAdvanced:
        false,
    },

    nextGate:
      status ===
      'RATIO_MARKET_DAILY_BAR_COVERAGE_PREFLIGHT_READY'
        ? 'BUILD_18_STOCK_KIS_ADJUSTED_HISTORY_REFRESH_APPLY'
        : 'STOP_AND_REVIEW',

    outputFile:
      path
        .relative(
          root,
          outputFile,
        )
        .replaceAll('\\', '/'),
  };

  report.outputFingerprint =
    sha256(
      JSON.stringify({
        version:
          report.version,

        inputFingerprint:
          report.source
            .inputFingerprint,

        status:
          report.status,

        refreshPlan:
          report.refreshPlan.map(
            (row) => [
              row.stockCode,
              row.providerEventId,
              row.actionType,
              row.effectiveDate,
              row.refreshStart,
              row.refreshEnd,
              row.totalRowsThroughSnapshot,
              row.unadjustedRowsThroughSnapshot,
              row.estimatedKisRequests,
            ],
          ),
      }),
    );

  atomicSaveJson(
    outputFile,
    report,
  );

  console.log(
    JSON.stringify(
      {
        status:
          report.status,

        version:
          VERSION,

        ...report.counts,

        blockers:
          report.blockers,

        warnings:
          report.warnings,

        databaseWrites:
          0,

        kisRequests:
          0,

        marketDailyBarsModified:
          0,

        nextGate:
          report.nextGate,

        outputFile:
          report.outputFile,
      },
      null,
      2,
    ),
  );

  if (
    status !==
    'RATIO_MARKET_DAILY_BAR_COVERAGE_PREFLIGHT_READY'
  ) {
    process.exitCode =
      2;
  }
}

main().catch(
  (error) => {
    console.error(
      JSON.stringify(
        {
          status:
            'RATIO_MARKET_DAILY_BAR_COVERAGE_PREFLIGHT_FAILED',

          version:
            VERSION,

          error:
            String(
              error?.message ??
              error,
            ),

          details:
            error?.details ??
            null,

          databaseWrites:
            0,

          kisRequests:
            0,
        },
        null,
        2,
      ),
    );

    process.exitCode =
      1;
  },
);
