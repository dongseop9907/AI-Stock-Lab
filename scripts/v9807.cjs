/* eslint-disable no-console */
'use strict';

/**
 * AI Stock Lab
 * V9.8.7 - Market effective-date resolution
 *
 * READ-ONLY. No DB writes.
 *
 * Input:
 *   logs/opendart-corporate-action-field-extraction-v9-8-6-3.json
 *
 * Output:
 *   logs/opendart-corporate-action-market-effective-date-v9-8-7.json
 *
 * Contract:
 *
 * CASH_DIVIDEND
 *   effective_date = latest KRX trading date strictly BEFORE dividend recordDate.
 *
 *   This preserves the validated V9.7 cash-factor contract:
 *     factor reference bar = latest trading close strictly before effective_date.
 *
 *   Calendar source:
 *     public.market_index_daily_bars (read-only)
 *
 *   A cash date is resolved only when market-calendar coverage reaches or
 *   passes the record date, so future/unknown holidays fail closed.
 *
 * STOCK_SPLIT / REVERSE_SPLIT
 *   If the canonical latest DART document supplied sourceEffectiveDate:
 *     effective_date = sourceEffectiveDate
 *
 *   If V9.8.6.3 recovered ratio from an earlier chain document because the
 *   latest receipt was provider-014 unavailable:
 *     DO NOT promote fallback schedule.
 *     Leave effective_date null and queue independent market verification.
 *
 * MERGER / SPIN_OFF
 *   Structural only. No generic market factor / effective-date promotion here.
 *
 * No factors are computed in this stage.
 * No corporate_action_events rows are inserted.
 *
 * Run:
 *   node --env-file=.env.local .\scripts\v9807.cjs
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_8_7_MARKET_EFFECTIVE_DATE_RESOLUTION';

const INPUT_VERSION =
  'V9_8_6_3_REMAINING_REVERSE_SPLIT_RECOVERY';

const STRUCTURAL =
  new Set([
    'MERGER',
    'SPIN_OFF',
  ]);

const RATIO_ACTIONS =
  new Set([
    'STOCK_SPLIT',
    'REVERSE_SPLIT',
    'STOCK_DIVIDEND',
  ]);

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

function countBy(rows, selector) {
  const out = {};

  for (const row of rows) {
    const key =
      String(selector(row) ?? 'NULL');

    out[key] =
      (out[key] ?? 0) + 1;
  }

  return Object.fromEntries(
    Object.entries(out)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

function parseArgs(argv) {
  const out = {
    input: null,
    output: null,
  };

  for (const arg of argv) {
    if (arg.startsWith('--input=')) {
      out.input =
        arg.slice('--input='.length);
      continue;
    }

    if (arg.startsWith('--output=')) {
      out.output =
        arg.slice('--output='.length);
      continue;
    }

    throw new Error(`UNKNOWN_OPTION:${arg}`);
  }

  return out;
}

function requireSupabaseEnv() {
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
    url:
      String(url).replace(/\/+$/, ''),
    key:
      String(key),
  };
}

async function getArray(url, key) {
  const response =
    await fetch(
      url,
      {
        method:
          'GET',

        headers: {
          apikey:
            key,

          Authorization:
            `Bearer ${key}`,

          Accept:
            'application/json',
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
    const code =
      body?.code ??
      `HTTP_${response.status}`;

    throw new Error(
      `SUPABASE_READ_FAILED:${code}`,
    );
  }

  if (!Array.isArray(body)) {
    throw new Error(
      'SUPABASE_ARRAY_RESPONSE_REQUIRED',
    );
  }

  return body;
}

function isIsoDate(value) {
  if (
    typeof value !==
    'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return false;
  }

  const date =
    new Date(`${value}T00:00:00Z`);

  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

function addDays(iso, days) {
  const date =
    new Date(`${iso}T00:00:00Z`);

  date.setUTCDate(
    date.getUTCDate() + days,
  );

  return date
    .toISOString()
    .slice(0, 10);
}

function minDate(values) {
  return values
    .filter(isIsoDate)
    .sort()[0] ?? null;
}

function maxDate(values) {
  const sorted =
    values
      .filter(isIsoDate)
      .sort();

  return sorted.at(-1) ?? null;
}

async function readMarketCalendar({
  base,
  key,
  startDate,
  endDate,
}) {
  const select =
    'trading_date';

  const url =
    `${base}/rest/v1/market_index_daily_bars` +
    `?select=${encodeURIComponent(select)}` +
    `&trading_date=gte.${encodeURIComponent(startDate)}` +
    `&trading_date=lte.${encodeURIComponent(endDate)}` +
    `&order=trading_date.asc`;

  const rows =
    await getArray(url, key);

  const dates =
    [
      ...new Set(
        rows
          .map(
            (row) =>
              row.trading_date,
          )
          .filter(isIsoDate),
      ),
    ].sort();

  return {
    rowsRead:
      rows.length,

    dates,

    firstDate:
      dates[0] ?? null,

    lastDate:
      dates.at(-1) ?? null,
  };
}

function latestTradingDateBefore(
  dates,
  targetDate,
) {
  let candidate =
    null;

  for (const date of dates) {
    if (date >= targetDate) {
      break;
    }

    candidate =
      date;
  }

  return candidate;
}

function firstTradingDateOnOrAfter(
  dates,
  targetDate,
) {
  return (
    dates.find(
      (date) =>
        date >= targetDate,
    ) ??
    null
  );
}

function resolveCashDividend(
  row,
  marketCalendar,
) {
  const recordDate =
    row.parsed?.recordDate ??
    null;

  if (!isIsoDate(recordDate)) {
    return {
      status:
        'UNRESOLVED',
      reason:
        'DIVIDEND_RECORD_DATE_MISSING',
      effectiveDate:
        null,
      evidence: {
        recordDate,
      },
    };
  }

  const calendarHasReachedRecordDate =
    marketCalendar.lastDate !== null &&
    marketCalendar.lastDate >= recordDate;

  if (!calendarHasReachedRecordDate) {
    return {
      status:
        'UNRESOLVED',
      reason:
        'MARKET_CALENDAR_NOT_COMPLETE_THROUGH_RECORD_DATE',
      effectiveDate:
        null,
      evidence: {
        recordDate,
        calendarFirstDate:
          marketCalendar.firstDate,
        calendarLastDate:
          marketCalendar.lastDate,
      },
    };
  }

  const effectiveDate =
    latestTradingDateBefore(
      marketCalendar.dates,
      recordDate,
    );

  if (!effectiveDate) {
    return {
      status:
        'UNRESOLVED',
      reason:
        'NO_PRIOR_KRX_TRADING_DATE_IN_CALENDAR_WINDOW',
      effectiveDate:
        null,
      evidence: {
        recordDate,
        calendarFirstDate:
          marketCalendar.firstDate,
        calendarLastDate:
          marketCalendar.lastDate,
      },
    };
  }

  const nextTradingDate =
    firstTradingDateOnOrAfter(
      marketCalendar.dates,
      recordDate,
    );

  return {
    status:
      'RESOLVED',

    reason:
      'DIVIDEND_RECORD_DATE_PREVIOUS_KRX_TRADING_DAY',

    effectiveDate,

    evidence: {
      recordDate,

      effectiveDate,

      firstTradingDateOnOrAfterRecordDate:
        nextTradingDate,

      calendarFirstDate:
        marketCalendar.firstDate,

      calendarLastDate:
        marketCalendar.lastDate,

      calendarSource:
        'market_index_daily_bars',

      rule:
        'LATEST_TRADING_DATE_STRICTLY_BEFORE_RECORD_DATE',
    },
  };
}

function resolveRatioAction(row) {
  const fallbackUsed =
    row.parsed
      ?.recovery
      ?.fallbackUsed ===
    true;

  const independentRequired =
    row.nextStage
      ?.independentMarketVerificationRequired ===
    true;

  if (
    fallbackUsed ||
    independentRequired
  ) {
    return {
      status:
        'UNRESOLVED',

      reason:
        'PROVIDER_014_INDEPENDENT_MARKET_VERIFICATION_REQUIRED',

      effectiveDate:
        null,

      evidence: {
        sourceEffectiveDate:
          row.parsed
            ?.sourceEffectiveDate ??
          null,

        fallbackSourceEffectiveDateCandidate:
          row.parsed
            ?.fallbackSourceEffectiveDateCandidate ??
          null,

        fallbackListingDateCandidate:
          row.parsed
            ?.fallbackListingDateCandidate ??
          null,

        fallbackSourceReceiptNo:
          row.parsed
            ?.recovery
            ?.selectedReceiptNo ??
          null,

        fallbackSchedulePromoted:
          false,
      },
    };
  }

  const sourceEffectiveDate =
    row.parsed
      ?.sourceEffectiveDate ??
    null;

  if (
    !isIsoDate(
      sourceEffectiveDate,
    )
  ) {
    /*
     * STOCK_DIVIDEND, if introduced later, requires its own market-date
     * rule instead of silently treating recordDate as effective_date.
     */
    if (
      row.actionType ===
      'STOCK_DIVIDEND'
    ) {
      return {
        status:
          'UNRESOLVED',

        reason:
          'STOCK_DIVIDEND_MARKET_DATE_POLICY_REQUIRED',

        effectiveDate:
          null,

        evidence: {
          recordDate:
            row.parsed
              ?.recordDate ??
            null,
        },
      };
    }

    return {
      status:
        'UNRESOLVED',

      reason:
        'SOURCE_EFFECTIVE_DATE_MISSING',

      effectiveDate:
        null,

      evidence: {
        sourceEffectiveDate,
      },
    };
  }

  return {
    status:
      'RESOLVED',

    reason:
      'FINAL_DART_SOURCE_EFFECTIVE_DATE',

    effectiveDate:
      sourceEffectiveDate,

    evidence: {
      sourceEffectiveDate,

      listingDate:
        row.parsed
          ?.listingDate ??
        null,

      sourceReceiptNo:
        row.sourceReceiptNo,

      sourceIsCorrection:
        row.sourceIsCorrection,

      rule:
        'CANONICAL_LATEST_DART_DOCUMENT_SOURCE_EFFECTIVE_DATE',
    },
  };
}

async function main() {
  if (
    typeof fetch !==
    'function'
  ) {
    throw new Error(
      'NODE_18_OR_NEWER_REQUIRED',
    );
  }

  const args =
    parseArgs(
      process.argv.slice(2),
    );

  const root =
    path.resolve(
      __dirname,
      '..',
    );

  const inputFile =
    path.resolve(
      args.input ??
      path.join(
        root,
        'logs',
        'opendart-corporate-action-field-extraction-v9-8-6-3.json',
      ),
    );

  const outputFile =
    path.resolve(
      args.output ??
      path.join(
        root,
        'logs',
        'opendart-corporate-action-market-effective-date-v9-8-7.json',
      ),
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
    'REVERSE_SPLIT_RECOVERY_COMPLETE'
  ) {
    throw new Error(
      'FIELD_EXTRACTION_NOT_COMPLETE',
    );
  }

  if (
    input.counts
      ?.sourceFieldsIncomplete !==
    0
  ) {
    throw new Error(
      'SOURCE_FIELDS_INCOMPLETE',
    );
  }

  if (
    !Array.isArray(
      input.results,
    )
  ) {
    throw new Error(
      'INPUT_RESULTS_MISSING',
    );
  }

  const cashRows =
    input.results.filter(
      (row) =>
        row.actionType ===
        'CASH_DIVIDEND',
    );

  const cashRecordDates =
    cashRows
      .map(
        (row) =>
          row.parsed
            ?.recordDate ??
          null,
      )
      .filter(isIsoDate);

  const earliestRecordDate =
    minDate(
      cashRecordDates,
    );

  const latestRecordDate =
    maxDate(
      cashRecordDates,
    );

  let marketCalendar = {
    rowsRead:
      0,
    dates:
      [],
    firstDate:
      null,
    lastDate:
      null,
    requestedStartDate:
      null,
    requestedEndDate:
      null,
  };

  let networkRequests =
    0;

  if (
    earliestRecordDate &&
    latestRecordDate
  ) {
    const env =
      requireSupabaseEnv();

    const requestedStartDate =
      addDays(
        earliestRecordDate,
        -14,
      );

    /*
     * Do not invent future exchange holidays. Query through 14 days after
     * the latest record date; Supabase simply returns existing rows.
     */
    const requestedEndDate =
      addDays(
        latestRecordDate,
        14,
      );

    const calendar =
      await readMarketCalendar({
        base:
          env.url,
        key:
          env.key,
        startDate:
          requestedStartDate,
        endDate:
          requestedEndDate,
      });

    networkRequests += 1;

    marketCalendar = {
      ...calendar,
      requestedStartDate,
      requestedEndDate,
    };
  }

  const results = [];

  for (
    let index = 0;
    index < input.results.length;
    index += 1
  ) {
    const row =
      input.results[index];

    if (
      STRUCTURAL.has(
        row.actionType,
      )
    ) {
      results.push({
        ...row,

        effectiveDateResolution: {
          status:
            'STRUCTURAL_BLOCKED',

          reason:
            'STRUCTURAL_ACTION_GENERIC_EFFECTIVE_DATE_NOT_PROMOTED',

          effectiveDate:
            null,
        },

        canonicalPreview: {
          ...row.canonicalPreview,

          effective_date:
            null,

          event_insert_allowed:
            false,
        },

        v987Disposition:
          'STRUCTURAL_PRESERVED',
      });

      console.log(
        [
          'DATE',
          `${index + 1}/${input.results.length}`,
          `root=${row.providerEventId}`,
          `action=${row.actionType}`,
          'status=STRUCTURAL_BLOCKED',
        ].join(' '),
      );

      continue;
    }

    let resolution;

    if (
      row.actionType ===
      'CASH_DIVIDEND'
    ) {
      resolution =
        resolveCashDividend(
          row,
          marketCalendar,
        );
    } else if (
      RATIO_ACTIONS.has(
        row.actionType,
      )
    ) {
      resolution =
        resolveRatioAction(
          row,
        );
    } else {
      resolution = {
        status:
          'UNRESOLVED',

        reason:
          'UNEXPECTED_NONSTRUCTURAL_ACTION_TYPE',

        effectiveDate:
          null,

        evidence: {},
      };
    }

    results.push({
      ...row,

      effectiveDateResolution:
        resolution,

      canonicalPreview: {
        ...row.canonicalPreview,

        effective_date:
          resolution.status ===
          'RESOLVED'
            ? resolution.effectiveDate
            : null,

        event_insert_allowed:
          false,
      },

      nextStage: {
        ...row.nextStage,

        marketEffectiveDateResolutionRequired:
          resolution.status !==
          'RESOLVED',

        effectiveDateResolved:
          resolution.status ===
          'RESOLVED',

        independentMarketVerificationRequired:
          resolution.reason ===
          'PROVIDER_014_INDEPENDENT_MARKET_VERIFICATION_REQUIRED',
      },

      v987Disposition:
        resolution.status ===
        'RESOLVED'
          ? 'EFFECTIVE_DATE_RESOLVED'
          : 'EFFECTIVE_DATE_REVIEW_REQUIRED',
    });

    console.log(
      [
        'DATE',
        `${index + 1}/${input.results.length}`,
        `root=${row.providerEventId}`,
        `action=${row.actionType}`,
        `status=${resolution.status}`,
        `effective=${resolution.effectiveDate ?? '-'}`,
        `reason=${resolution.reason}`,
      ].join(' '),
    );
  }

  const resolved =
    results.filter(
      (row) =>
        row.effectiveDateResolution
          ?.status ===
        'RESOLVED',
    );

  const unresolved =
    results.filter(
      (row) =>
        row.effectiveDateResolution
          ?.status ===
        'UNRESOLVED',
    );

  const structural =
    results.filter(
      (row) =>
        row.effectiveDateResolution
          ?.status ===
        'STRUCTURAL_BLOCKED',
    );

  const duplicateIdentityCount =
    results.length -
    new Set(
      results.map(
        (row) =>
          `${row.provider}|${row.providerEventId}`,
      ),
    ).size;

  const invalidResolved =
    resolved.filter(
      (row) =>
        !isIsoDate(
          row.canonicalPreview
            ?.effective_date,
        ),
    );

  const fallbackPromoted =
    results.filter(
      (row) =>
        row.parsed
          ?.recovery
          ?.fallbackUsed ===
          true &&
        row.canonicalPreview
          ?.effective_date !==
          null,
    );

  const structuralPromoted =
    structural.filter(
      (row) =>
        row.canonicalPreview
          ?.effective_date !==
          null,
    );

  const status =
    duplicateIdentityCount > 0 ||
    invalidResolved.length > 0 ||
    fallbackPromoted.length > 0 ||
    structuralPromoted.length > 0
      ? 'MARKET_EFFECTIVE_DATE_RESOLUTION_INVALID'
      : unresolved.length === 0
        ? 'MARKET_EFFECTIVE_DATE_RESOLUTION_COMPLETE'
        : 'MARKET_EFFECTIVE_DATE_RESOLUTION_COMPLETE_WITH_REVIEW';

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

    marketCalendar: {
      source:
        'market_index_daily_bars',

      requestedStartDate:
        marketCalendar.requestedStartDate,

      requestedEndDate:
        marketCalendar.requestedEndDate,

      rowsRead:
        marketCalendar.rowsRead,

      distinctTradingDates:
        marketCalendar.dates.length,

      firstDate:
        marketCalendar.firstDate,

      lastDate:
        marketCalendar.lastDate,
    },

    counts: {
      inputRows:
        input.results.length,

      outputRows:
        results.length,

      resolvedEffectiveDates:
        resolved.length,

      unresolvedEffectiveDates:
        unresolved.length,

      structuralBlocked:
        structural.length,

      cashDividendsResolved:
        resolved.filter(
          (row) =>
            row.actionType ===
            'CASH_DIVIDEND',
        ).length,

      ratioActionsResolved:
        resolved.filter(
          (row) =>
            RATIO_ACTIONS.has(
              row.actionType,
            ),
        ).length,

      independentMarketVerificationRequired:
        unresolved.filter(
          (row) =>
            row.effectiveDateResolution
              ?.reason ===
            'PROVIDER_014_INDEPENDENT_MARKET_VERIFICATION_REQUIRED',
        ).length,

      duplicateCanonicalIdentities:
        duplicateIdentityCount,

      invalidResolved:
        invalidResolved.length,
    },

    actionTypeCounts:
      countBy(
        results,
        (row) =>
          row.actionType,
      ),

    resolutionStatusCounts:
      countBy(
        results,
        (row) =>
          row.effectiveDateResolution
            ?.status,
      ),

    resolutionReasonCounts:
      countBy(
        results,
        (row) =>
          row.effectiveDateResolution
            ?.reason,
      ),

    unresolvedActionTypeCounts:
      countBy(
        unresolved,
        (row) =>
          row.actionType,
      ),

    safety: {
      networkRequests,

      databaseReads:
        networkRequests,

      databaseWrites:
        0,

      productionApplied:
        false,

      canonicalEventsCreated:
        0,

      providerEventIdsPersisted:
        0,

      finalEffectiveDatesAssignedInDatabase:
        0,

      marketFactorsComputed:
        0,

      coverageWindowAdvanced:
        false,

      fallbackSchedulePromoted:
        fallbackPromoted.length,

      structuralEffectiveDatesPromoted:
        structuralPromoted.length,

      eventInsertAllowed:
        false,
    },

    policy: {
      cashDividendEffectiveDate:
        'LATEST_KRX_TRADING_DATE_STRICTLY_BEFORE_DIVIDEND_RECORD_DATE',

      cashDividendCalendarCompleteness:
        'REQUIRE_CALENDAR_LAST_DATE_GTE_RECORD_DATE',

      splitReverseEffectiveDate:
        'FINAL_CANONICAL_DART_SOURCE_EFFECTIVE_DATE',

      provider014Fallback:
        'DO_NOT_PROMOTE_FALLBACK_SCHEDULE_REQUIRE_INDEPENDENT_MARKET_VERIFICATION',

      structural:
        'NO_GENERIC_EFFECTIVE_DATE_PROMOTION',

      marketDailyBarsBasis:
        'KIS_MODE0_ADJUSTED_CANONICAL_DO_NOT_DOUBLE_ADJUST',

      eventInsert:
        'BLOCKED_IN_V9_8_7',
    },

    reviewQueue:
      unresolved.map(
        (row) => ({
          providerEventId:
            row.providerEventId,

          sourceReceiptNo:
            row.sourceReceiptNo,

          stockCode:
            row.stockCode,

          actionType:
            row.actionType,

          ratioFrom:
            row.canonicalPreview
              ?.ratio_from ??
            null,

          ratioTo:
            row.canonicalPreview
              ?.ratio_to ??
            null,

          cashAmount:
            row.canonicalPreview
              ?.cash_amount ??
            null,

          recordDate:
            row.parsed
              ?.recordDate ??
            null,

          sourceEffectiveDate:
            row.parsed
              ?.sourceEffectiveDate ??
            null,

          fallbackSourceEffectiveDateCandidate:
            row.parsed
              ?.fallbackSourceEffectiveDateCandidate ??
            null,

          fallbackListingDateCandidate:
            row.parsed
              ?.fallbackListingDateCandidate ??
            null,

          resolution:
            row.effectiveDateResolution,
        }),
      ),

    resolvedPreview:
      resolved.map(
        (row) => ({
          providerEventId:
            row.providerEventId,

          stockCode:
            row.stockCode,

          actionType:
            row.actionType,

          effectiveDate:
            row.canonicalPreview
              .effective_date,

          ratioFrom:
            row.canonicalPreview
              .ratio_from,

          ratioTo:
            row.canonicalPreview
              .ratio_to,

          cashAmount:
            row.canonicalPreview
              .cash_amount,

          resolutionReason:
            row.effectiveDateResolution
              .reason,
        }),
      ),

    results,

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
          report.source.inputFingerprint,

        calendar: {
          first:
            report.marketCalendar.firstDate,

          last:
            report.marketCalendar.lastDate,

          dates:
            report.marketCalendar.distinctTradingDates,
        },

        rows:
          results.map(
            (row) => [
              row.providerEventId,
              row.actionType,
              row.canonicalPreview
                ?.effective_date ??
                null,
              row.effectiveDateResolution
                ?.status,
              row.effectiveDateResolution
                ?.reason,
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

        marketCalendar:
          report.marketCalendar,

        ...report.counts,

        actionTypeCounts:
          report.actionTypeCounts,

        resolutionStatusCounts:
          report.resolutionStatusCounts,

        resolutionReasonCounts:
          report.resolutionReasonCounts,

        unresolvedActionTypeCounts:
          report.unresolvedActionTypeCounts,

        reviewQueue:
          report.reviewQueue,

        networkRequests,

        databaseWrites:
          0,

        productionApplied:
          false,

        canonicalEventsCreated:
          0,

        providerEventIdsPersisted:
          0,

        finalEffectiveDatesAssignedInDatabase:
          0,

        marketFactorsComputed:
          0,

        coverageWindowAdvanced:
          false,

        fallbackSchedulePromoted:
          fallbackPromoted.length,

        structuralEffectiveDatesPromoted:
          structuralPromoted.length,

        outputFile:
          report.outputFile,
      },
      null,
      2,
    ),
  );

  if (
    status ===
    'MARKET_EFFECTIVE_DATE_RESOLUTION_INVALID'
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
