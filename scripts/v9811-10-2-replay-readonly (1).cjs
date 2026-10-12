#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * V9.8.11.10.2 replay
 *
 * Existing market_daily_bars coverage preflight.
 *
 * READ ONLY.
 * - Supabase GET only
 * - no KIS calls
 * - no market_daily_bars writes
 *
 * Input:
 *   logs/opendart-corporate-action-ratio-refresh-eligibility-v9-8-11-10-1-replay.json
 *
 * Historical policy preserved:
 * - evidence / refresh snapshot end = 2026-10-01
 * - canonical market_daily_bars must be adjusted_price=true
 * - refresh start = earliest existing canonical bar on/before snapshot
 * - refresh end   = 2026-10-01
 * - no corporate-action factor is multiplied into canonical bars
 * - future ratio events remain excluded upstream
 *
 * Important:
 * This stage intentionally preserves the old raw-preflight behavior.
 * Stocks with zero canonical bar surface are blockers HERE.
 * V9.8.11.10.2.1 is the later policy repair that reclassifies the known
 * 900110 / 900270 zero-surface cases as non-blocking.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_8_11_10_2_REPLAY_RATIO_MARKET_DAILY_BAR_COVERAGE_PREFLIGHT';

const INPUT_VERSION =
  'V9_8_11_10_1_REPLAY_RATIO_KIS_REFRESH_ELIGIBILITY_GATE';

const SNAPSHOT_AS_OF =
  '2026-10-01';

const EXPECTED_ELIGIBLE = 18;
const CHUNK_DAYS = 90;

const DATE_FIELD_CANDIDATES = [
  'date',
  'trade_date',
  'trading_date',
  'market_date',
  'bar_date',
  'business_date',
];

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''),
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(value)
    .digest('hex');
}

function atomicSaveJson(file, value) {
  fs.mkdirSync(path.dirname(file), {
    recursive: true,
  });

  const tmp =
    `${file}.tmp-${process.pid}-${Date.now()}`;

  fs.writeFileSync(
    tmp,
    JSON.stringify(value, null, 2) + '\n',
    'utf8',
  );

  fs.renameSync(tmp, file);
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
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY_REQUIRED',
    );
  }

  return {
    url: String(url).replace(/\/+$/, ''),
    key: String(key),
  };
}

async function getJson(url, key, extraHeaders = {}) {
  const response =
    await fetch(url, {
      method: 'GET',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
        ...extraHeaders,
      },
    });

  const text =
    await response.text();

  let body;

  try {
    body =
      text.length > 0
        ? JSON.parse(text)
        : [];
  } catch {
    throw new Error(
      `INVALID_SUPABASE_JSON_RESPONSE:${response.status}`,
    );
  }

  if (!response.ok) {
    const error =
      new Error(
        `SUPABASE_READ_FAILED:${body?.code ?? response.status}`,
      );

    error.details = {
      status: response.status,
      body,
      url,
    };

    throw error;
  }

  if (!Array.isArray(body)) {
    throw new Error(
      'EXPECTED_SUPABASE_ARRAY_RESPONSE',
    );
  }

  return {
    body,
    headers: response.headers,
  };
}

function parseContentRangeTotal(value) {
  if (!value) return null;

  const match =
    String(value).match(/\/(\d+|\*)$/);

  if (!match) return null;

  if (match[1] === '*') {
    return null;
  }

  return Number(match[1]);
}

async function countRows(
  baseUrl,
  key,
  filters,
) {
  const params =
    new URLSearchParams();

  params.set('select', 'stock_code');

  for (
    const [field, operatorValue]
    of Object.entries(filters)
  ) {
    params.set(
      field,
      operatorValue,
    );
  }

  params.set('limit', '1');

  const {
    headers,
  } =
    await getJson(
      `${baseUrl}?${params.toString()}`,
      key,
      {
        Prefer: 'count=exact',
        Range: '0-0',
      },
    );

  const total =
    parseContentRangeTotal(
      headers.get('content-range'),
    );

  if (
    !Number.isInteger(total) ||
    total < 0
  ) {
    throw new Error(
      `COUNT_HEADER_MISSING:${headers.get('content-range')}`,
    );
  }

  return total;
}

async function firstOrLastRow(
  baseUrl,
  key,
  dateField,
  stockCode,
  direction,
) {
  const params =
    new URLSearchParams();

  params.set(
    'select',
    `${dateField},adjusted_price`,
  );

  params.set(
    'stock_code',
    `eq.${stockCode}`,
  );

  params.set(
    dateField,
    `lte.${SNAPSHOT_AS_OF}`,
  );

  params.set(
    'order',
    `${dateField}.${direction}`,
  );

  params.set(
    'limit',
    '1',
  );

  const {
    body,
  } =
    await getJson(
      `${baseUrl}?${params.toString()}`,
      key,
    );

  return body[0] ?? null;
}

function inclusiveDays(
  start,
  end,
) {
  if (!start || !end) {
    return 0;
  }

  const a =
    Date.parse(`${start}T00:00:00Z`);

  const b =
    Date.parse(`${end}T00:00:00Z`);

  if (
    !Number.isFinite(a) ||
    !Number.isFinite(b) ||
    b < a
  ) {
    return 0;
  }

  const millisecondsPerDay =
    24 * 60 * 60 * 1000;

  return (
    Math.floor(
      (b - a) /
      millisecondsPerDay,
    ) + 1
  );
}

async function detectDateField(
  baseUrl,
  key,
  stockCodes,
) {
  for (
    const stockCode
    of stockCodes
  ) {
    const params =
      new URLSearchParams();

    params.set(
      'select',
      '*',
    );

    params.set(
      'stock_code',
      `eq.${stockCode}`,
    );

    params.set(
      'limit',
      '1',
    );

    const {
      body,
    } =
      await getJson(
        `${baseUrl}?${params.toString()}`,
        key,
      );

    if (
      body.length === 0
    ) {
      continue;
    }

    const sample =
      body[0];

    const dateField =
      DATE_FIELD_CANDIDATES.find(
        (field) =>
          Object.prototype.hasOwnProperty.call(
            sample,
            field,
          ),
      );

    if (!dateField) {
      throw new Error(
        `MARKET_DAILY_BAR_DATE_FIELD_NOT_DETECTED:${Object.keys(sample).sort().join(',')}`,
      );
    }

    if (
      !Object.prototype.hasOwnProperty.call(
        sample,
        'adjusted_price',
      )
    ) {
      throw new Error(
        'MARKET_DAILY_BAR_ADJUSTED_PRICE_FIELD_MISSING',
      );
    }

    return {
      dateField,
      detectedFromStock:
        stockCode,
      sampleKeys:
        Object.keys(sample)
          .sort(),
    };
  }

  throw new Error(
    'NO_ELIGIBLE_STOCK_HAS_ANY_MARKET_DAILY_BAR_FOR_SCHEMA_DETECTION',
  );
}

async function main() {
  const root =
    path.resolve(__dirname, '..');

  const inputFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-ratio-refresh-eligibility-v9-8-11-10-1-replay.json',
    );

  const outputFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-ratio-refresh-coverage-preflight-v9-8-11-10-2-replay.json',
    );

  assert(
    fs.existsSync(inputFile),
    `INPUT_NOT_FOUND:${path.basename(inputFile)}`,
  );

  const input =
    readJson(inputFile);

  assert(
    input.version ===
      INPUT_VERSION,
    `INPUT_VERSION_MISMATCH:${input.version}`,
  );

  assert(
    input.status ===
      'RATIO_KIS_REFRESH_ELIGIBILITY_READY',
    `INPUT_STATUS_NOT_READY:${input.status}`,
  );

  assert(
    Array.isArray(
      input.eligibleRefreshPlan,
    ),
    'ELIGIBLE_REFRESH_PLAN_MISSING',
  );

  assert(
    input.eligibleRefreshPlan.length ===
      EXPECTED_ELIGIBLE,
    `EXPECTED_18_ELIGIBLE_REFRESH_ROWS:${input.eligibleRefreshPlan.length}`,
  );

  const stockCodes =
    input.eligibleRefreshPlan.map(
      (row) =>
        String(row.stockCode),
    );

  assert(
    new Set(stockCodes).size ===
      EXPECTED_ELIGIBLE,
    'ELIGIBLE_STOCK_DUPLICATION',
  );

  const {
    url,
    key,
  } = requireEnv();

  const baseUrl =
    `${url}/rest/v1/market_daily_bars`;

  let networkRequests = 0;

  async function trackedGet(
    targetUrl,
    extraHeaders = {},
  ) {
    networkRequests += 1;

    return getJson(
      targetUrl,
      key,
      extraHeaders,
    );
  }

  // Detect actual schema once from a covered eligible stock.
  let dateField = null;
  let schemaDetection = null;

  for (
    const stockCode
    of stockCodes
  ) {
    const params =
      new URLSearchParams();

    params.set(
      'select',
      '*',
    );

    params.set(
      'stock_code',
      `eq.${stockCode}`,
    );

    params.set(
      'limit',
      '1',
    );

    const {
      body,
    } =
      await trackedGet(
        `${baseUrl}?${params.toString()}`,
      );

    if (
      body.length === 0
    ) {
      continue;
    }

    const sample =
      body[0];

    dateField =
      DATE_FIELD_CANDIDATES.find(
        (field) =>
          Object.prototype.hasOwnProperty.call(
            sample,
            field,
          ),
      );

    if (!dateField) {
      throw new Error(
        `MARKET_DAILY_BAR_DATE_FIELD_NOT_DETECTED:${Object.keys(sample).sort().join(',')}`,
      );
    }

    if (
      !Object.prototype.hasOwnProperty.call(
        sample,
        'adjusted_price',
      )
    ) {
      throw new Error(
        'MARKET_DAILY_BAR_ADJUSTED_PRICE_FIELD_MISSING',
      );
    }

    schemaDetection = {
      dateField,
      detectedFromStock:
        stockCode,
      sampleKeys:
        Object.keys(sample)
          .sort(),
    };

    break;
  }

  assert(
    dateField,
    'MARKET_DAILY_BAR_SCHEMA_DETECTION_FAILED',
  );

  async function trackedCount(
    filters,
  ) {
    const params =
      new URLSearchParams();

    params.set(
      'select',
      'stock_code',
    );

    for (
      const [field, operatorValue]
      of Object.entries(filters)
    ) {
      params.set(
        field,
        operatorValue,
      );
    }

    params.set(
      'limit',
      '1',
    );

    const {
      headers,
    } =
      await trackedGet(
        `${baseUrl}?${params.toString()}`,
        {
          Prefer:
            'count=exact',
          Range:
            '0-0',
        },
      );

    const total =
      parseContentRangeTotal(
        headers.get(
          'content-range',
        ),
      );

    if (
      !Number.isInteger(total) ||
      total < 0
    ) {
      throw new Error(
        `COUNT_HEADER_MISSING:${headers.get('content-range')}`,
      );
    }

    return total;
  }

  async function trackedEdgeRow(
    stockCode,
    direction,
  ) {
    const params =
      new URLSearchParams();

    params.set(
      'select',
      `${dateField},adjusted_price`,
    );

    params.set(
      'stock_code',
      `eq.${stockCode}`,
    );

    params.set(
      dateField,
      `lte.${SNAPSHOT_AS_OF}`,
    );

    params.set(
      'order',
      `${dateField}.${direction}`,
    );

    params.set(
      'limit',
      '1',
    );

    const {
      body,
    } =
      await trackedGet(
        `${baseUrl}?${params.toString()}`,
      );

    return body[0] ?? null;
  }

  const refreshPlan = [];

  for (
    const sourceRow
    of input.eligibleRefreshPlan
  ) {
    const stockCode =
      String(
        sourceRow.stockCode,
      );

    const commonFilters = {
      stock_code:
        `eq.${stockCode}`,

      [dateField]:
        `lte.${SNAPSHOT_AS_OF}`,
    };

    const totalRowsThroughSnapshot =
      await trackedCount(
        commonFilters,
      );

    const adjustedRowsThroughSnapshot =
      await trackedCount({
        ...commonFilters,
        adjusted_price:
          'eq.true',
      });

    const unadjustedRowsThroughSnapshot =
      await trackedCount({
        ...commonFilters,
        adjusted_price:
          'eq.false',
      });

    const nullAdjustedFlagRowsThroughSnapshot =
      totalRowsThroughSnapshot -
      adjustedRowsThroughSnapshot -
      unadjustedRowsThroughSnapshot;

    let earliestRow =
      null;

    let latestRow =
      null;

    if (
      totalRowsThroughSnapshot > 0
    ) {
      earliestRow =
        await trackedEdgeRow(
          stockCode,
          'asc',
        );

      latestRow =
        await trackedEdgeRow(
          stockCode,
          'desc',
        );
    }

    const refreshStart =
      earliestRow?.[dateField] ??
      null;

    const latestExistingDate =
      latestRow?.[dateField] ??
      null;

    const refreshDays =
      refreshStart
        ? inclusiveDays(
            refreshStart,
            SNAPSHOT_AS_OF,
          )
        : 0;

    const estimatedKisRequests =
      refreshDays > 0
        ? Math.ceil(
            refreshDays /
            CHUNK_DAYS,
          )
        : 0;

    refreshPlan.push({
      stockCode,
      providerEventId:
        sourceRow.providerEventId,
      eventId:
        sourceRow.eventId,
      actionType:
        sourceRow.actionType,
      effectiveDate:
        sourceRow.effectiveDate,
      adjustmentRunId:
        sourceRow.adjustmentRunId,
      adjustmentFactorId:
        sourceRow.adjustmentFactorId,

      totalRowsThroughSnapshot,
      adjustedRowsThroughSnapshot,
      unadjustedRowsThroughSnapshot,
      nullAdjustedFlagRowsThroughSnapshot,

      earliestExistingDate:
        refreshStart,
      latestExistingDate,

      refreshStart,
      refreshEnd:
        SNAPSHOT_AS_OF,
      refreshInclusiveDays:
        refreshDays,
      chunkDays:
        CHUNK_DAYS,
      estimatedKisRequests,

      canonicalSurface:
        totalRowsThroughSnapshot > 0,

      canonicalAdjustedOnly:
        totalRowsThroughSnapshot > 0 &&
        adjustedRowsThroughSnapshot ===
          totalRowsThroughSnapshot &&
        unadjustedRowsThroughSnapshot === 0 &&
        nullAdjustedFlagRowsThroughSnapshot === 0,

      applyCorporateActionFactorToCanonicalBars:
        false,
    });
  }

  const noCanonicalSurface =
    refreshPlan.filter(
      (row) =>
        row.totalRowsThroughSnapshot === 0,
    );

  const covered =
    refreshPlan.filter(
      (row) =>
        row.totalRowsThroughSnapshot > 0,
    );

  const coveredWithUnadjusted =
    covered.filter(
      (row) =>
        row.unadjustedRowsThroughSnapshot > 0 ||
        row.nullAdjustedFlagRowsThroughSnapshot > 0,
    );

  const invalidRefreshRanges =
    covered.filter(
      (row) =>
        !row.refreshStart ||
        row.refreshStart >
          SNAPSHOT_AS_OF ||
        row.refreshEnd !==
          SNAPSHOT_AS_OF,
    );

  const duplicateStocks =
    refreshPlan.length -
    new Set(
      refreshPlan.map(
        (row) =>
          row.stockCode,
      ),
    ).size;

  const blockers = [];

  // Historical/raw 10.2 behavior:
  // zero canonical surface is still considered a blocker here.
  if (
    noCanonicalSurface.length > 0
  ) {
    blockers.push(
      'NO_EXISTING_CANONICAL_MARKET_DAILY_BARS',
    );
  }

  if (
    coveredWithUnadjusted.length > 0
  ) {
    blockers.push(
      'CANONICAL_WINDOW_CONTAINS_UNADJUSTED_ROWS',
    );
  }

  if (
    invalidRefreshRanges.length > 0
  ) {
    blockers.push(
      'INVALID_REFRESH_RANGE',
    );
  }

  if (
    duplicateStocks !== 0
  ) {
    blockers.push(
      'DUPLICATE_REFRESH_STOCKS',
    );
  }

  const status =
    blockers.length === 0
      ? 'RATIO_MARKET_DAILY_BAR_COVERAGE_PREFLIGHT_READY'
      : 'RATIO_MARKET_DAILY_BAR_COVERAGE_PREFLIGHT_BLOCKED';

  const report = {
    status,
    version: VERSION,

    source: {
      inputVersion:
        input.version,

      inputFingerprint:
        input.outputFingerprint ?? null,
    },

    policy: {
      evidenceSnapshotAsOf:
        SNAPSHOT_AS_OF,

      canonicalBarsRequireAdjustedPrice:
        true,

      refreshStart:
        'EARLIEST_EXISTING_CANONICAL_BAR_ON_OR_BEFORE_SNAPSHOT',

      refreshEnd:
        SNAPSHOT_AS_OF,

      chunkDays:
        CHUNK_DAYS,

      corporateActionFactorApplication:
        'PROHIBITED_ON_CANONICAL_KIS_ADJUSTED_BARS',

      rawPreflightNoSurfacePolicy:
        'BLOCK_HERE_AND_RECLASSIFY_IN_V9_8_11_10_2_1',
    },

    schemaDetection,

    counts: {
      inputEligibleRows:
        input.eligibleRefreshPlan.length,

      refreshPlanRows:
        refreshPlan.length,

      coveredStocks:
        covered.length,

      noCanonicalBarSurfaceStocks:
        noCanonicalSurface.length,

      coveredStocksWithUnadjustedRows:
        coveredWithUnadjusted.length,

      invalidRefreshRanges:
        invalidRefreshRanges.length,

      duplicateStocks,

      estimatedKisRequests:
        covered.reduce(
          (sum, row) =>
            sum +
            Number(
              row.estimatedKisRequests ??
              0,
            ),
          0,
        ),

      blockers:
        blockers.length,
    },

    refreshPlan,

    noCanonicalBarSurface:
      noCanonicalSurface.map(
        (row) => ({
          stockCode:
            row.stockCode,
          providerEventId:
            row.providerEventId,
          actionType:
            row.actionType,
          effectiveDate:
            row.effectiveDate,
          totalRowsThroughSnapshot:
            0,
          reason:
            'NO_EXISTING_MARKET_DAILY_BARS_TO_REFRESH',
        }),
      ),

    coveredWithUnadjusted,

    invalidRefreshRanges,

    blockers,

    safety: {
      httpMethodsUsed: ['GET'],
      networkRequests,
      databaseReads:
        networkRequests,
      databaseWrites: 0,
      kisRequests: 0,
      marketDailyBarsModified: 0,
      corporateActionFactorsAppliedToCanonicalBars:
        0,
      productionApplied:
        false,
    },

    nextGate:
      status ===
      'RATIO_MARKET_DAILY_BAR_COVERAGE_PREFLIGHT_READY'
        ? 'BUILD_V9_8_11_10_2_1_COVERAGE_DISPOSITION_REPLAY'
        : noCanonicalSurface.length > 0 &&
          coveredWithUnadjusted.length === 0 &&
          invalidRefreshRanges.length === 0 &&
          duplicateStocks === 0
          ? 'BUILD_V9_8_11_10_2_1_COVERAGE_DISPOSITION_REPLAY'
          : 'STOP_AND_REVIEW',

    outputFile:
      'logs/opendart-corporate-action-ratio-refresh-coverage-preflight-v9-8-11-10-2-replay.json',
  };

  report.outputFingerprint =
    sha256(
      JSON.stringify({
        version:
          report.version,
        inputFingerprint:
          report.source.inputFingerprint,
        snapshotAsOf:
          SNAPSHOT_AS_OF,
        schemaDetection:
          report.schemaDetection,
        refreshPlan:
          refreshPlan.map(
            (row) => [
              row.stockCode,
              row.providerEventId,
              row.actionType,
              row.effectiveDate,
              row.totalRowsThroughSnapshot,
              row.adjustedRowsThroughSnapshot,
              row.unadjustedRowsThroughSnapshot,
              row.earliestExistingDate,
              row.latestExistingDate,
              row.estimatedKisRequests,
            ],
          ),
        blockers:
          report.blockers,
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
          report.version,

        evidenceSnapshotAsOf:
          SNAPSHOT_AS_OF,

        dateField:
          schemaDetection.dateField,

        ...report.counts,

        noCanonicalBarSurface:
          report.noCanonicalBarSurface,

        coveredWithUnadjusted:
          report.coveredWithUnadjusted.map(
            (row) => ({
              stockCode:
                row.stockCode,
              totalRowsThroughSnapshot:
                row.totalRowsThroughSnapshot,
              adjustedRowsThroughSnapshot:
                row.adjustedRowsThroughSnapshot,
              unadjustedRowsThroughSnapshot:
                row.unadjustedRowsThroughSnapshot,
              nullAdjustedFlagRowsThroughSnapshot:
                row.nullAdjustedFlagRowsThroughSnapshot,
            }),
          ),

        blockers:
          report.blockers,

        databaseWrites:
          0,

        kisRequests:
          0,

        marketDailyBarsModified:
          0,

        productionApplied:
          false,

        nextGate:
          report.nextGate,

        outputFile:
          report.outputFile,
      },
      null,
      2,
    ),
  );

  // Historical/raw stage is allowed to be BLOCKED only by zero-surface rows,
  // because V9.8.11.10.2.1 is specifically the disposition repair for that.
  const onlyExpectedNoSurfaceBlock =
    status ===
      'RATIO_MARKET_DAILY_BAR_COVERAGE_PREFLIGHT_BLOCKED' &&
    blockers.length === 1 &&
    blockers[0] ===
      'NO_EXISTING_CANONICAL_MARKET_DAILY_BARS';

  if (
    status !==
      'RATIO_MARKET_DAILY_BAR_COVERAGE_PREFLIGHT_READY' &&
    !onlyExpectedNoSurfaceBlock
  ) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
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
          error?.details ?? null,

        databaseWrites:
          0,

        kisRequests:
          0,

        marketDailyBarsModified:
          0,

        productionApplied:
          false,
      },
      null,
      2,
    ),
  );

  process.exitCode = 2;
});
