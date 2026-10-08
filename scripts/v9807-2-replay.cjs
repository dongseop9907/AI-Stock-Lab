/* eslint-disable no-console */
'use strict';

/**
 * AI Stock Lab
 * V9.8.7.2 - Effective-date finalization after KIS suspension review
 *
 * READ-ONLY. No network. No DB writes.
 *
 * Inputs:
 *   logs/opendart-corporate-action-market-effective-date-v9-8-7-replay.json
 *   logs/opendart-corporate-action-kis-boundary-probe-v9-8-7-1.json
 *
 * Output:
 *   logs/opendart-corporate-action-market-effective-date-v9-8-7-2-replay.json
 *
 * Resolution policy:
 *
 * 1) 210120 / provider_event_id 20260424900689
 *    - ratio_from = 5
 *    - ratio_to   = 2
 *    - latest source receipt document was provider-014 unavailable
 *    - prior same-chain DART document retained source effective-date candidate
 *      2026-06-12
 *    - KIS mode0/mode1 boundary probe was INCONCLUSIVE because a long trading
 *      suspension caused the adjusted/original series to behave as a suspended
 *      reference series rather than a clean multiplicative boundary.
 *
 *    Official KRX/KIND disclosure chain independently keeps:
 *      신주의 효력발생일 = 2026-06-12
 *
 *    Therefore promote 2026-06-12 as the canonical effective_date.
 *
 * 2) 478560 / provider_event_id 20260928900449
 *    - dividend record date = 2026-10-13
 *    - as-of date for this run = 2026-10-01
 *    - keep unresolved as FUTURE_MARKET_DATE_PENDING.
 *
 * This stage finalizes CURRENTLY RESOLVABLE dates only.
 * It does not insert corporate_action_events or compute/persist factors.
 *
 * Run:
 *   node .\scripts\v9807-2.cjs
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_8_7_2_REPLAY_EFFECTIVE_DATE_FINALIZATION_AFTER_KIS_SUSPENSION_REVIEW';

const INPUT_VERSION =
  'V9_8_7_REPLAY_MARKET_EFFECTIVE_DATE_RESOLUTION';

const KIS_PROBE_VERSION =
  'V9_8_7_1_KIS_REVERSE_SPLIT_BOUNDARY_PROBE';

const AS_OF_DATE =
  '2026-10-01';

const CANVAS_STOCK_CODE =
  '210120';

const CANVAS_PROVIDER_EVENT_ID =
  '20260424900689';

const CANVAS_EFFECTIVE_DATE =
  '2026-06-12';

const FUTURE_DIVIDEND_STOCK_CODE =
  '478560';

const FUTURE_DIVIDEND_PROVIDER_EVENT_ID =
  '20260928900449';

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''),
  );
}

function atomicSaveJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;

  fs.writeFileSync(
    temp,
    JSON.stringify(value, null, 2),
    'utf8',
  );

  fs.renameSync(temp, file);
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

function isIsoDate(value) {
  if (
    typeof value !== 'string' ||
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

function main() {
  const root =
    path.resolve(
      __dirname,
      '..',
    );

  const inputFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-market-effective-date-v9-8-7-replay.json',
    );

  const kisProbeFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-kis-boundary-probe-v9-8-7-1.json',
    );

  const outputFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-market-effective-date-v9-8-7-2-replay.json',
    );

  for (const file of [
    inputFile,
    kisProbeFile,
  ]) {
    if (!fs.existsSync(file)) {
      throw new Error(
        `INPUT_NOT_FOUND:${path.basename(file)}`,
      );
    }
  }

  const input =
    readJson(inputFile);

  const kisProbe =
    readJson(kisProbeFile);

  if (
    input.version !==
    INPUT_VERSION
  ) {
    throw new Error(
      'INPUT_VERSION_MISMATCH',
    );
  }

  if (
    kisProbe.version !==
    KIS_PROBE_VERSION
  ) {
    throw new Error(
      'KIS_PROBE_VERSION_MISMATCH',
    );
  }

  if (
    !Array.isArray(input.results)
  ) {
    throw new Error(
      'INPUT_RESULTS_MISSING',
    );
  }

  const canvasRow =
    input.results.find(
      (row) =>
        row.stockCode ===
          CANVAS_STOCK_CODE &&
        row.providerEventId ===
          CANVAS_PROVIDER_EVENT_ID,
    );

  if (!canvasRow) {
    throw new Error(
      'CANVAS_TARGET_NOT_FOUND',
    );
  }

  if (
    canvasRow.actionType !==
      'REVERSE_SPLIT' ||
    canvasRow.canonicalPreview
      ?.ratio_from !==
      5 ||
    canvasRow.canonicalPreview
      ?.ratio_to !==
      2
  ) {
    throw new Error(
      'CANVAS_TARGET_CONTRACT_MISMATCH',
    );
  }

  if (
    kisProbe.target
      ?.stockCode !==
      CANVAS_STOCK_CODE ||
    kisProbe.target
      ?.providerEventId !==
      CANVAS_PROVIDER_EVENT_ID
  ) {
    throw new Error(
      'KIS_PROBE_TARGET_MISMATCH',
    );
  }

  if (
    kisProbe.status !==
      'KIS_BOUNDARY_INCONCLUSIVE'
  ) {
    throw new Error(
      `UNEXPECTED_KIS_PROBE_STATUS:${kisProbe.status}`,
    );
  }

  if (
    kisProbe.boundary
      ?.exactMarketDateProven !==
      false
  ) {
    throw new Error(
      'KIS_PROBE_UNEXPECTED_EXACT_PROOF',
    );
  }

  if (
    canvasRow.parsed
      ?.fallbackSourceEffectiveDateCandidate !==
      CANVAS_EFFECTIVE_DATE
  ) {
    throw new Error(
      'CANVAS_FALLBACK_EFFECTIVE_DATE_MISMATCH',
    );
  }

  const futureDividendRow =
    input.results.find(
      (row) =>
        row.stockCode ===
          FUTURE_DIVIDEND_STOCK_CODE &&
        row.providerEventId ===
          FUTURE_DIVIDEND_PROVIDER_EVENT_ID,
    );

  if (!futureDividendRow) {
    throw new Error(
      'FUTURE_DIVIDEND_TARGET_NOT_FOUND',
    );
  }

  const futureRecordDate =
    futureDividendRow.parsed
      ?.recordDate ??
    null;

  if (
    !isIsoDate(futureRecordDate) ||
    futureRecordDate <=
      AS_OF_DATE
  ) {
    throw new Error(
      'FUTURE_DIVIDEND_RECORD_DATE_NOT_FUTURE',
    );
  }

  const results =
    input.results.map(
      (row) => {
        if (
          row.stockCode ===
            CANVAS_STOCK_CODE &&
          row.providerEventId ===
            CANVAS_PROVIDER_EVENT_ID
        ) {
          return {
            ...row,

            effectiveDateResolution: {
              status:
                'RESOLVED',

              reason:
                'OFFICIAL_KRX_DISCLOSURE_CONFIRMS_EFFECTIVE_DATE_KIS_SUSPENSION_SERIES_INCONCLUSIVE',

              effectiveDate:
                CANVAS_EFFECTIVE_DATE,

              evidence: {
                fallbackDartSourceReceiptNo:
                  row.parsed
                    ?.recovery
                    ?.selectedReceiptNo ??
                  null,

                fallbackDartEffectiveDateCandidate:
                  row.parsed
                    ?.fallbackSourceEffectiveDateCandidate ??
                  null,

                ratioFrom:
                  row.canonicalPreview
                    ?.ratio_from ??
                  null,

                ratioTo:
                  row.canonicalPreview
                    ?.ratio_to ??
                  null,

                officialKrxDisclosureChain: [
                  {
                    disclosureDate:
                      '2026-04-24',
                    effectiveDate:
                      '2026-06-12',
                    note:
                      'ORIGINAL_KRX_KIND_REVERSE_SPLIT_DISCLOSURE',
                  },
                  {
                    disclosureDate:
                      '2026-06-29',
                    effectiveDate:
                      '2026-06-12',
                    note:
                      'LISTING_SCHEDULE_DELAY_EFFECTIVE_DATE_UNCHANGED',
                  },
                  {
                    disclosureDate:
                      '2026-07-07',
                    effectiveDate:
                      '2026-06-12',
                    note:
                      'LISTING_SCHEDULE_DELAY_EFFECTIVE_DATE_UNCHANGED',
                  },
                  {
                    disclosureDate:
                      '2026-07-21',
                    effectiveDate:
                      '2026-06-12',
                    note:
                      'LISTING_SCHEDULE_DELAY_EFFECTIVE_DATE_UNCHANGED',
                  },
                  {
                    disclosureDate:
                      '2026-07-28',
                    effectiveDate:
                      '2026-06-12',
                    note:
                      'LISTING_SCHEDULE_DELAY_EFFECTIVE_DATE_UNCHANGED',
                  },
                ],

                kisBoundaryProbe: {
                  status:
                    kisProbe.status,

                  expectedPriceFactor:
                    kisProbe.target
                      ?.expectedPriceFactor ??
                    null,

                  lastTradingBeforeCandidate:
                    kisProbe.boundary
                      ?.lastTradingBeforeCandidate ??
                    null,

                  firstEqualOnOrAfterCandidate:
                    kisProbe.boundary
                      ?.firstEqualOnOrAfterCandidate ??
                    null,

                  exactMarketDateProven:
                    false,

                  interpretation:
                    'LONG_TRADING_SUSPENSION_MAKES_MODE0_MODE1_RATIO_UNSUITABLE_AS_EXACT_DATE_BOUNDARY',
                },
              },
            },

            canonicalPreview: {
              ...row.canonicalPreview,

              effective_date:
                CANVAS_EFFECTIVE_DATE,

              event_insert_allowed:
                false,
            },

            nextStage: {
              ...row.nextStage,

              marketEffectiveDateResolutionRequired:
                false,

              effectiveDateResolved:
                true,

              independentMarketVerificationRequired:
                false,
            },

            v9872Disposition:
              'RESOLVED_FROM_OFFICIAL_KRX_DISCLOSURE_CHAIN',
          };
        }

        if (
          row.stockCode ===
            FUTURE_DIVIDEND_STOCK_CODE &&
          row.providerEventId ===
            FUTURE_DIVIDEND_PROVIDER_EVENT_ID
        ) {
          return {
            ...row,

            effectiveDateResolution: {
              status:
                'FUTURE_PENDING',

              reason:
                'FUTURE_MARKET_DATE_PENDING',

              effectiveDate:
                null,

              evidence: {
                asOfDate:
                  AS_OF_DATE,

                recordDate:
                  futureRecordDate,

                previousReason:
                  row.effectiveDateResolution
                    ?.reason ??
                  null,

                policy:
                  'DO_NOT_INFER_FUTURE_TRADING_CALENDAR',
              },
            },

            canonicalPreview: {
              ...row.canonicalPreview,

              effective_date:
                null,

              event_insert_allowed:
                false,
            },

            nextStage: {
              ...row.nextStage,

              marketEffectiveDateResolutionRequired:
                true,

              effectiveDateResolved:
                false,

              futureMarketDatePending:
                true,
            },

            v9872Disposition:
              'FUTURE_EVENT_PENDING',
          };
        }

        return {
          ...row,

          v9872Disposition:
            'UNCHANGED_FROM_V9_8_7',
        };
      },
    );

  const resolved =
    results.filter(
      (row) =>
        row.effectiveDateResolution
          ?.status ===
        'RESOLVED',
    );

  const futurePending =
    results.filter(
      (row) =>
        row.effectiveDateResolution
          ?.status ===
        'FUTURE_PENDING',
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

  const invalidResolved =
    resolved.filter(
      (row) =>
        !isIsoDate(
          row.canonicalPreview
            ?.effective_date,
        ),
    );

  const duplicateCanonicalIdentities =
    results.length -
    new Set(
      results.map(
        (row) =>
          `${row.provider}|${row.providerEventId}`,
      ),
    ).size;

  const unchangedBefore =
    input.results
      .filter(
        (row) =>
          !(
            row.providerEventId ===
              CANVAS_PROVIDER_EVENT_ID ||
            row.providerEventId ===
              FUTURE_DIVIDEND_PROVIDER_EVENT_ID
          ),
      )
      .map(
        (row) => [
          row.providerEventId,
          row.effectiveDateResolution,
          row.canonicalPreview,
        ],
      );

  const unchangedAfter =
    results
      .filter(
        (row) =>
          !(
            row.providerEventId ===
              CANVAS_PROVIDER_EVENT_ID ||
            row.providerEventId ===
              FUTURE_DIVIDEND_PROVIDER_EVENT_ID
          ),
      )
      .map(
        (row) => [
          row.providerEventId,
          row.effectiveDateResolution,
          row.canonicalPreview,
        ],
      );

  const untouchedRowsStable =
    sha256(
      JSON.stringify(unchangedBefore),
    ) ===
    sha256(
      JSON.stringify(unchangedAfter),
    );

  const status =
    invalidResolved.length > 0 ||
    duplicateCanonicalIdentities > 0 ||
    unresolved.length > 0 ||
    !untouchedRowsStable
      ? 'EFFECTIVE_DATE_FINALIZATION_INVALID'
      : 'EFFECTIVE_DATE_FINALIZATION_COMPLETE_WITH_FUTURE_PENDING';

  const report = {
    version:
      VERSION,

    status,

    asOfDate:
      AS_OF_DATE,

    source: {
      inputVersion:
        input.version,

      kisProbeVersion:
        kisProbe.version,

      inputFingerprint:
        input.outputFingerprint,

      kisProbeFingerprint:
        kisProbe.outputFingerprint ??
        null,
    },

    counts: {
      inputRows:
        input.results.length,

      outputRows:
        results.length,

      resolvedEffectiveDates:
        resolved.length,

      futurePending:
        futurePending.length,

      unresolvedEffectiveDates:
        unresolved.length,

      structuralBlocked:
        structural.length,

      duplicateCanonicalIdentities,

      invalidResolved:
        invalidResolved.length,

      newlyResolvedByOfficialKrxEvidence:
        results.filter(
          (row) =>
            row.v9872Disposition ===
            'RESOLVED_FROM_OFFICIAL_KRX_DISCLOSURE_CHAIN',
        ).length,

      futureEventsReclassified:
        results.filter(
          (row) =>
            row.v9872Disposition ===
            'FUTURE_EVENT_PENDING',
        ).length,
    },

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

    futurePendingRows:
      futurePending.map(
        (row) => ({
          providerEventId:
            row.providerEventId,

          stockCode:
            row.stockCode,

          actionType:
            row.actionType,

          recordDate:
            row.parsed
              ?.recordDate ??
            null,

          effectiveDate:
            null,

          reason:
            row.effectiveDateResolution
              ?.reason,
        }),
      ),

    newlyResolvedRows:
      results
        .filter(
          (row) =>
            row.v9872Disposition ===
            'RESOLVED_FROM_OFFICIAL_KRX_DISCLOSURE_CHAIN',
        )
        .map(
          (row) => ({
            providerEventId:
              row.providerEventId,

            stockCode:
              row.stockCode,

            actionType:
              row.actionType,

            ratioFrom:
              row.canonicalPreview
                ?.ratio_from,

            ratioTo:
              row.canonicalPreview
                ?.ratio_to,

            effectiveDate:
              row.canonicalPreview
                ?.effective_date,

            reason:
              row.effectiveDateResolution
                ?.reason,
          }),
        ),

    safety: {
      networkRequests:
        0,

      databaseReads:
        0,

      databaseWrites:
        0,

      productionApplied:
        false,

      canonicalEventsCreated:
        0,

      providerEventIdsPersisted:
        0,

      effectiveDatesPersisted:
        0,

      marketFactorsPersisted:
        0,

      coverageWindowAdvanced:
        false,

      eventInsertAllowed:
        false,

      untouchedRowsStable,
    },

    policy: {
      suspendedReverseSplit:
        'OFFICIAL_KRX_DART_EFFECTIVE_DATE_OVERRIDES_INCONCLUSIVE_KIS_MODE_RATIO_BOUNDARY',

      futureCashDividend:
        'KEEP_PENDING_UNTIL_MARKET_CALENDAR_REACHES_RECORD_DATE',

      structural:
        'REMAIN_FACTOR_BLOCKED',

      eventInsert:
        'BLOCKED_IN_V9_8_7_2',
    },

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

        source:
          report.source,

        asOfDate:
          AS_OF_DATE,

        rows:
          results.map(
            (row) => [
              row.providerEventId,
              row.actionType,
              row.effectiveDateResolution
                ?.status,
              row.effectiveDateResolution
                ?.reason,
              row.canonicalPreview
                ?.effective_date ??
                null,
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

        asOfDate:
          AS_OF_DATE,

        ...report.counts,

        resolutionStatusCounts:
          report.resolutionStatusCounts,

        newlyResolvedRows:
          report.newlyResolvedRows,

        futurePendingRows:
          report.futurePendingRows,

        networkRequests:
          0,

        databaseWrites:
          0,

        productionApplied:
          false,

        canonicalEventsCreated:
          0,

        effectiveDatesPersisted:
          0,

        coverageWindowAdvanced:
          false,

        untouchedRowsStable,

        outputFile:
          report.outputFile,
      },
      null,
      2,
    ),
  );

  if (
    status ===
    'EFFECTIVE_DATE_FINALIZATION_INVALID'
  ) {
    process.exitCode = 2;
  }
}

try {
  main();
} catch (error) {
  console.error(
    String(
      error?.message ??
      error,
    ),
  );

  process.exitCode = 1;
}
