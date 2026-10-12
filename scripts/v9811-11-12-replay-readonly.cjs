#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * V9.8.11.11~12 replay
 *
 * READ-ONLY historical refresh + vendor-verification reuse audit.
 *
 * Goal:
 * Reuse the already-executed historical V9.8.11.11.1 / V9.8.11.12
 * instead of re-running KIS refresh/upserts.
 *
 * Conditions:
 * 1) Current replay disposition has the same 16 refreshable stocks/ranges
 *    as historical V9.8.11.11.1 completed rows.
 * 2) Historical V9.8.11.11.1 status is COMPLETE.
 * 3) Historical V9.8.11.12 vendor verification status is COMPLETE.
 * 4) Historical V9.8.11.13 closure confirms 16 verified stocks / 656 rows.
 * 5) Current DB still has exact historical post-refresh row counts/boundaries
 *    for each of the 16 ranges, with no unadjusted rows.
 *
 * No KIS calls.
 * No DB writes.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_8_11_11_12_REPLAY_READ_ONLY_HISTORICAL_REFRESH_VENDOR_REUSE_AUDIT';

const DISPOSITION_VERSION =
  'V9_8_11_10_2_1_REPLAY_RATIO_REFRESH_COVERAGE_DISPOSITION_REPAIR';

const HIST_APPLY_VERSION =
  'V9_8_11_11_1_16_STOCK_DIRECT_KIS_ADJUSTED_HISTORY_REFRESH_APPLY';

const HIST_VENDOR_VERSION =
  'V9_8_11_12_POST_REFRESH_16_STOCK_VENDOR_ADJUSTED_VERIFICATION';

const HIST_CLOSURE_VERSION =
  'V9_8_11_13_CORPORATE_ACTION_CYCLE_CLOSURE_AUDIT';

const EXPECTED_STOCKS = 16;
const EXPECTED_NO_SURFACE = 2;
const EXPECTED_VENDOR_ROWS = 656;
const CANONICAL_SOURCE = 'KIS_DAILY_V8_3';

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
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const tmp =
    `${file}.tmp-${process.pid}-${Date.now()}`;

  fs.writeFileSync(
    tmp,
    JSON.stringify(value, null, 2) + '\n',
    'utf8',
  );

  fs.renameSync(tmp, file);
}

function getPath(obj, pathExpr) {
  const parts =
    String(pathExpr).split('.');

  let cur = obj;

  for (const part of parts) {
    if (
      cur === null ||
      cur === undefined ||
      !Object.prototype.hasOwnProperty.call(cur, part)
    ) {
      return undefined;
    }

    cur = cur[part];
  }

  return cur;
}

function pick(obj, paths, fallback = undefined) {
  for (const p of paths) {
    const value = getPath(obj, p);

    if (value !== undefined) {
      return value;
    }
  }

  return fallback;
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

  if (!match || match[1] === '*') {
    return null;
  }

  return Number(match[1]);
}

async function main() {
  const root =
    path.resolve(__dirname, '..');

  const dispositionFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-ratio-refresh-coverage-disposition-v9-8-11-10-2-1-replay.json',
    );

  const historicalApplyFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-ratio-refresh-direct-apply-v9-8-11-11-1.json',
    );

  const historicalVendorFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-post-refresh-vendor-verification-v9-8-11-12.json',
    );

  const historicalClosureFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-cycle-closure-v9-8-11-13.json',
    );

  const outputFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-historical-refresh-vendor-reuse-audit-v9-8-11-11-12-replay.json',
    );

  for (const file of [
    dispositionFile,
    historicalApplyFile,
    historicalVendorFile,
    historicalClosureFile,
  ]) {
    assert(
      fs.existsSync(file),
      `INPUT_NOT_FOUND:${path.basename(file)}`,
    );
  }

  const disposition =
    readJson(dispositionFile);

  const historicalApply =
    readJson(historicalApplyFile);

  const historicalVendor =
    readJson(historicalVendorFile);

  const historicalClosure =
    readJson(historicalClosureFile);

  assert(
    disposition.version ===
      DISPOSITION_VERSION,
    `DISPOSITION_VERSION_MISMATCH:${disposition.version}`,
  );

  assert(
    disposition.status ===
      'RATIO_REFRESH_COVERAGE_DISPOSITION_READY',
    `DISPOSITION_NOT_READY:${disposition.status}`,
  );

  assert(
    historicalApply.version ===
      HIST_APPLY_VERSION,
    `HIST_APPLY_VERSION_MISMATCH:${historicalApply.version}`,
  );

  assert(
    historicalApply.status ===
      'DIRECT_KIS_ADJUSTED_HISTORY_REFRESH_APPLY_COMPLETE',
    `HIST_APPLY_NOT_COMPLETE:${historicalApply.status}`,
  );

  assert(
    historicalVendor.version ===
      HIST_VENDOR_VERSION,
    `HIST_VENDOR_VERSION_MISMATCH:${historicalVendor.version}`,
  );

  assert(
    historicalVendor.status ===
      'POST_REFRESH_VENDOR_ADJUSTED_VERIFICATION_COMPLETE',
    `HIST_VENDOR_NOT_COMPLETE:${historicalVendor.status}`,
  );

  assert(
    historicalClosure.version ===
      HIST_CLOSURE_VERSION,
    `HIST_CLOSURE_VERSION_MISMATCH:${historicalClosure.version}`,
  );

  assert(
    historicalClosure.status ===
      'V9_8_CURRENT_CYCLE_CLOSED_AT_2026_10_01',
    `HIST_CLOSURE_NOT_COMPLETE:${historicalClosure.status}`,
  );

  assert(
    Array.isArray(disposition.refreshablePlan) &&
      disposition.refreshablePlan.length === EXPECTED_STOCKS,
    `CURRENT_REFRESHABLE_COUNT:${disposition.refreshablePlan?.length}`,
  );

  assert(
    Array.isArray(disposition.noCanonicalBarSurface) &&
      disposition.noCanonicalBarSurface.length === EXPECTED_NO_SURFACE,
    `CURRENT_NO_SURFACE_COUNT:${disposition.noCanonicalBarSurface?.length}`,
  );

  assert(
    Array.isArray(historicalApply.completed) &&
      historicalApply.completed.length === EXPECTED_STOCKS,
    `HIST_COMPLETED_COUNT:${historicalApply.completed?.length}`,
  );

  const currentPlanByStock =
    new Map(
      disposition.refreshablePlan.map(
        (row) => [
          String(row.stockCode),
          row,
        ],
      ),
    );

  const historicalCompletedByStock =
    new Map(
      historicalApply.completed.map(
        (row) => [
          String(row.stockCode),
          row,
        ],
      ),
    );

  assert(
    currentPlanByStock.size === EXPECTED_STOCKS,
    'CURRENT_REFRESHABLE_DUPLICATE_STOCKS',
  );

  assert(
    historicalCompletedByStock.size === EXPECTED_STOCKS,
    'HIST_COMPLETED_DUPLICATE_STOCKS',
  );

  const lineageMismatches = [];

  for (
    const [stockCode, currentPlan]
    of currentPlanByStock.entries()
  ) {
    const hist =
      historicalCompletedByStock.get(
        stockCode,
      );

    if (!hist) {
      lineageMismatches.push({
        stockCode,
        field:
          'historicalCompleted',
        actual:
          null,
        expected:
          'PRESENT',
      });
      continue;
    }

    const comparisons = [
      [
        'refreshStart',
        hist.refreshStart,
        currentPlan.refreshStart,
      ],
      [
        'refreshEnd',
        hist.refreshEnd,
        currentPlan.refreshEnd,
      ],
    ];

    // Compare optional fields only when historical artifact carries them.
    if (
      hist.actionType !== undefined
    ) {
      comparisons.push([
        'actionType',
        hist.actionType,
        currentPlan.actionType,
      ]);
    }

    if (
      hist.effectiveDate !== undefined
    ) {
      comparisons.push([
        'effectiveDate',
        hist.effectiveDate,
        currentPlan.effectiveDate,
      ]);
    }

    if (
      hist.providerEventId !== undefined
    ) {
      comparisons.push([
        'providerEventId',
        hist.providerEventId,
        currentPlan.providerEventId,
      ]);
    }

    for (
      const [field, actual, expected]
      of comparisons
    ) {
      if (
        String(actual ?? '') !==
        String(expected ?? '')
      ) {
        lineageMismatches.push({
          stockCode,
          field,
          actual:
            actual ?? null,
          expected:
            expected ?? null,
        });
      }
    }
  }

  for (
    const stockCode
    of historicalCompletedByStock.keys()
  ) {
    if (
      !currentPlanByStock.has(
        stockCode,
      )
    ) {
      lineageMismatches.push({
        stockCode,
        field:
          'currentPlan',
        actual:
          null,
        expected:
          'PRESENT',
      });
    }
  }

  // Historical vendor/closure summary evidence.
  const histVendorResults =
    Array.isArray(
      historicalVendor.results,
    )
      ? historicalVendor.results
      : [];

  const histVendorBlockers =
    Array.isArray(
      historicalVendor.blockers,
    )
      ? historicalVendor.blockers
      : [];

  const closureAccounting =
    historicalClosure.accounting ?? {};

  const closureVerifiedStocks =
    Number(
      closureAccounting.vendorVerifiedStocks ??
      pick(
        historicalClosure,
        [
          'vendorVerifiedStocks',
          'counts.vendorVerifiedStocks',
        ],
        NaN,
      ),
    );

  const closureVendorRows =
    Number(
      closureAccounting.vendorVerifiedRows ??
      closureAccounting.vendorRows ??
      pick(
        historicalClosure,
        [
          'vendorVerifiedRows',
          'counts.vendorVerifiedRows',
          'vendorRows',
          'counts.vendorRows',
        ],
        NaN,
      ),
    );

  const vendorEvidenceIssues = [];

  if (
    histVendorBlockers.length !== 0
  ) {
    vendorEvidenceIssues.push({
      check:
        'historicalVendor.blockers',
      actual:
        histVendorBlockers.length,
      expected:
        0,
    });
  }

  if (
    histVendorResults.length > 0 &&
    histVendorResults.length !==
      EXPECTED_STOCKS
  ) {
    vendorEvidenceIssues.push({
      check:
        'historicalVendor.results.length',
      actual:
        histVendorResults.length,
      expected:
        EXPECTED_STOCKS,
    });
  }

  if (
    !Number.isFinite(
      closureVerifiedStocks,
    ) ||
    closureVerifiedStocks !==
      EXPECTED_STOCKS
  ) {
    vendorEvidenceIssues.push({
      check:
        'closure.vendorVerifiedStocks',
      actual:
        Number.isFinite(
          closureVerifiedStocks,
        )
          ? closureVerifiedStocks
          : null,
      expected:
        EXPECTED_STOCKS,
    });
  }

  if (
    !Number.isFinite(
      closureVendorRows,
    ) ||
    closureVendorRows !==
      EXPECTED_VENDOR_ROWS
  ) {
    vendorEvidenceIssues.push({
      check:
        'closure.vendorVerifiedRows',
      actual:
        Number.isFinite(
          closureVendorRows,
        )
          ? closureVendorRows
          : null,
      expected:
        EXPECTED_VENDOR_ROWS,
    });
  }

  // Fresh current DB audit.
  const {
    url,
    key,
  } = requireEnv();

  const baseUrl =
    `${url}/rest/v1/market_daily_bars`;

  let networkRequests = 0;

  async function trackedGet(
    targetUrl,
    headers = {},
  ) {
    networkRequests += 1;

    return getJson(
      targetUrl,
      key,
      headers,
    );
  }

  async function countRows(
    stockCode,
    start,
    end,
    extraFilters = {},
  ) {
    const params =
      new URLSearchParams();

    params.set(
      'select',
      'stock_code',
    );

    params.set(
      'stock_code',
      `eq.${stockCode}`,
    );

    params.set(
      'trading_date',
      `gte.${start}`,
    );

    // PostgREST needs a separate key for the upper bound.
    // Build it manually below rather than overwriting URLSearchParams key.
    let query =
      `${baseUrl}?${params.toString()}` +
      `&trading_date=lte.${encodeURIComponent(end)}`;

    for (
      const [field, opValue]
      of Object.entries(extraFilters)
    ) {
      query +=
        `&${encodeURIComponent(field)}=` +
        encodeURIComponent(opValue);
    }

    query +=
      '&limit=1';

    const {
      headers,
    } =
      await trackedGet(
        query,
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
        `COUNT_HEADER_MISSING:${stockCode}:${headers.get('content-range')}`,
      );
    }

    return total;
  }

  async function edgeRow(
    stockCode,
    start,
    end,
    direction,
  ) {
    const query =
      `${baseUrl}` +
      `?select=${encodeURIComponent('trading_date,adjusted_price,source')}` +
      `&stock_code=eq.${encodeURIComponent(stockCode)}` +
      `&trading_date=gte.${encodeURIComponent(start)}` +
      `&trading_date=lte.${encodeURIComponent(end)}` +
      `&order=trading_date.${direction}` +
      `&limit=1`;

    const {
      body,
    } =
      await trackedGet(query);

    return body[0] ?? null;
  }

  const dbAudit = [];
  const dbDriftRows = [];

  for (
    const currentPlan
    of disposition.refreshablePlan
  ) {
    const stockCode =
      String(
        currentPlan.stockCode,
      );

    const hist =
      historicalCompletedByStock.get(
        stockCode,
      );

    assert(
      hist,
      `HIST_COMPLETED_MISSING:${stockCode}`,
    );

    const start =
      String(
        currentPlan.refreshStart,
      );

    const end =
      String(
        currentPlan.refreshEnd,
      );

    const totalRows =
      await countRows(
        stockCode,
        start,
        end,
      );

    const adjustedRows =
      await countRows(
        stockCode,
        start,
        end,
        {
          adjusted_price:
            'eq.true',
        },
      );

    const unadjustedRows =
      await countRows(
        stockCode,
        start,
        end,
        {
          adjusted_price:
            'eq.false',
        },
      );

    const sourceRows =
      await countRows(
        stockCode,
        start,
        end,
        {
          source:
            `eq.${CANONICAL_SOURCE}`,
        },
      );

    const earliest =
      totalRows > 0
        ? await edgeRow(
            stockCode,
            start,
            end,
            'asc',
          )
        : null;

    const latest =
      totalRows > 0
        ? await edgeRow(
            stockCode,
            start,
            end,
            'desc',
          )
        : null;

    const nullAdjustedRows =
      totalRows -
      adjustedRows -
      unadjustedRows;

    const historicalAfter =
      hist.after ?? {};

    const row = {
      stockCode,
      refreshStart:
        start,
      refreshEnd:
        end,

      historicalAfter: {
        rowCount:
          historicalAfter.rowCount ??
          null,

        unadjustedCount:
          historicalAfter.unadjustedCount ??
          null,

        earliestDate:
          historicalAfter.earliestDate ??
          null,

        latestDate:
          historicalAfter.latestDate ??
          null,
      },

      current: {
        rowCount:
          totalRows,

        adjustedRows,

        unadjustedRows,

        nullAdjustedRows,

        canonicalSourceRows:
          sourceRows,

        earliestDate:
          earliest
            ?.trading_date ??
          null,

        latestDate:
          latest
            ?.trading_date ??
          null,
      },
    };

    const issues = [];

    if (totalRows <= 0) {
      issues.push(
        'CURRENT_WINDOW_EMPTY',
      );
    }

    if (
      unadjustedRows !== 0 ||
      nullAdjustedRows !== 0 ||
      adjustedRows !== totalRows
    ) {
      issues.push(
        'CURRENT_WINDOW_NOT_ADJUSTED_ONLY',
      );
    }

    if (
      sourceRows !==
      totalRows
    ) {
      issues.push(
        'CURRENT_WINDOW_SOURCE_NOT_ALL_KIS_DAILY_V8_3',
      );
    }

    if (
      historicalAfter.rowCount !==
        undefined &&
      historicalAfter.rowCount !==
        null &&
      Number(
        historicalAfter.rowCount,
      ) !== totalRows
    ) {
      issues.push(
        'CURRENT_ROW_COUNT_DIFFERS_FROM_HISTORICAL_POST_REFRESH',
      );
    }

    if (
      historicalAfter.unadjustedCount !==
        undefined &&
      historicalAfter.unadjustedCount !==
        null &&
      Number(
        historicalAfter.unadjustedCount,
      ) !== unadjustedRows
    ) {
      issues.push(
        'CURRENT_UNADJUSTED_COUNT_DIFFERS_FROM_HISTORICAL',
      );
    }

    if (
      historicalAfter.earliestDate &&
      String(
        historicalAfter.earliestDate,
      ) !==
      String(
        earliest?.trading_date ??
        '',
      )
    ) {
      issues.push(
        'CURRENT_EARLIEST_DATE_DIFFERS_FROM_HISTORICAL',
      );
    }

    if (
      historicalAfter.latestDate &&
      String(
        historicalAfter.latestDate,
      ) !==
      String(
        latest?.trading_date ??
        '',
      )
    ) {
      issues.push(
        'CURRENT_LATEST_DATE_DIFFERS_FROM_HISTORICAL',
      );
    }

    if (
      earliest?.trading_date !==
      start
    ) {
      issues.push(
        'CURRENT_START_BOUNDARY_DIFFERS_FROM_REFRESH_START',
      );
    }

    if (
      latest?.trading_date &&
      latest.trading_date >
      end
    ) {
      issues.push(
        'CURRENT_END_BOUNDARY_EXCEEDS_REFRESH_END',
      );
    }

    row.issues =
      issues;

    dbAudit.push(row);

    if (
      issues.length > 0
    ) {
      dbDriftRows.push(row);
    }
  }

  const blockers = [];

  if (
    lineageMismatches.length > 0
  ) {
    blockers.push(
      'CURRENT_REPLAY_PLAN_DIFFERS_FROM_HISTORICAL_REFRESH_PLAN',
    );
  }

  if (
    vendorEvidenceIssues.length > 0
  ) {
    blockers.push(
      'HISTORICAL_VENDOR_EVIDENCE_INCOMPLETE_OR_INCONSISTENT',
    );
  }

  if (
    dbDriftRows.length > 0
  ) {
    blockers.push(
      'CURRENT_DB_DIFFERS_FROM_HISTORICAL_POST_REFRESH_STATE',
    );
  }

  const status =
    blockers.length === 0
      ? 'HISTORICAL_11_1_12_REFRESH_VENDOR_RESULTS_REUSABLE'
      : 'HISTORICAL_11_1_12_REFRESH_VENDOR_REUSE_BLOCKED';

  const report = {
    status,
    version: VERSION,

    source: {
      dispositionVersion:
        disposition.version,

      dispositionFingerprint:
        disposition.outputFingerprint ??
        null,

      historicalApplyVersion:
        historicalApply.version,

      historicalApplyFingerprint:
        historicalApply.outputFingerprint ??
        null,

      historicalVendorVersion:
        historicalVendor.version,

      historicalVendorFingerprint:
        historicalVendor.outputFingerprint ??
        null,

      historicalClosureVersion:
        historicalClosure.version,

      historicalClosureFingerprint:
        historicalClosure.outputFingerprint ??
        null,
    },

    counts: {
      currentRefreshableStocks:
        disposition.refreshablePlan.length,

      historicalCompletedStocks:
        historicalApply.completed.length,

      currentNoSurfaceStocks:
        disposition.noCanonicalBarSurface.length,

      lineageMismatchRows:
        lineageMismatches.length,

      historicalVendorResultRows:
        histVendorResults.length,

      historicalVendorBlockers:
        histVendorBlockers.length,

      historicalClosureVendorVerifiedStocks:
        Number.isFinite(
          closureVerifiedStocks,
        )
          ? closureVerifiedStocks
          : null,

      historicalClosureVendorRows:
        Number.isFinite(
          closureVendorRows,
        )
          ? closureVendorRows
          : null,

      vendorEvidenceIssueRows:
        vendorEvidenceIssues.length,

      currentDbAuditedStocks:
        dbAudit.length,

      currentDbDriftStocks:
        dbDriftRows.length,

      currentDbUnadjustedStocks:
        dbAudit.filter(
          (row) =>
            row.current
              .unadjustedRows !== 0 ||
            row.current
              .nullAdjustedRows !== 0,
        ).length,

      currentDbNonCanonicalSourceStocks:
        dbAudit.filter(
          (row) =>
            row.current
              .canonicalSourceRows !==
            row.current.rowCount,
        ).length,

      blockers:
        blockers.length,
    },

    historicalEvidence: {
      refreshApplyStatus:
        historicalApply.status,

      vendorVerificationStatus:
        historicalVendor.status,

      cycleClosureStatus:
        historicalClosure.status,

      vendorVerifiedStocks:
        closureVerifiedStocks,

      vendorVerifiedRows:
        closureVendorRows,

      noVendorMismatchClaim:
        historicalVendor.status ===
          'POST_REFRESH_VENDOR_ADJUSTED_VERIFICATION_COMPLETE' &&
        histVendorBlockers.length === 0,
    },

    lineageMismatches,
    vendorEvidenceIssues,
    currentDbAudit:
      dbAudit,
    currentDbDriftRows:
      dbDriftRows,

    conclusion: {
      historicalKisRefreshCanBeReused:
        blockers.length === 0,

      historicalVendorVerificationCanBeReused:
        blockers.length === 0,

      rerunV9811_11Required:
        false,

      rerunV9811_11_1Required:
        false,

      rerunV9811_12Required:
        false,

      kisCallsRequiredNow:
        0,

      marketDailyBarWritesRequiredNow:
        0,

      reason:
        blockers.length === 0
          ? 'CURRENT_REPLAY_PLAN_MATCHES_HISTORICAL_REFRESH_AND_CURRENT_DB_STILL_MATCHES_POST_REFRESH_STATE'
          : 'REUSE_NOT_PROVEN',
    },

    blockers,

    safety: {
      httpMethodsUsed: ['GET'],
      networkRequests,
      databaseReads:
        networkRequests,
      databaseWrites: 0,
      kisRequests: 0,
      marketDailyBarsModified: 0,
      productionApplied:
        false,
    },

    nextGate:
      status ===
      'HISTORICAL_11_1_12_REFRESH_VENDOR_RESULTS_REUSABLE'
        ? 'BUILD_V9_8_11_13_REPLAY_CYCLE_CLOSURE_AUDIT'
        : 'STOP_AND_REVIEW',

    outputFile:
      'logs/opendart-corporate-action-historical-refresh-vendor-reuse-audit-v9-8-11-11-12-replay.json',
  };

  report.outputFingerprint =
    sha256(
      JSON.stringify({
        version:
          report.version,

        source:
          report.source,

        counts:
          report.counts,

        currentDbAudit:
          dbAudit.map(
            (row) => [
              row.stockCode,
              row.refreshStart,
              row.refreshEnd,
              row.historicalAfter,
              row.current,
              row.issues,
            ],
          ),

        conclusion:
          report.conclusion,
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

        ...report.counts,

        historicalEvidence:
          report.historicalEvidence,

        lineageMismatches:
          report.lineageMismatches,

        currentDbDriftRows:
          report.currentDbDriftRows,

        conclusion:
          report.conclusion,

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

  if (
    status !==
    'HISTORICAL_11_1_12_REFRESH_VENDOR_RESULTS_REUSABLE'
  ) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status:
          'HISTORICAL_11_1_12_REFRESH_VENDOR_REUSE_AUDIT_FAILED',

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
