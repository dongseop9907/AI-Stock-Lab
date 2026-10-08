#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * V9.11.8 - Structural factor validation for 043910 MERGER
 *
 * READ ONLY / NETWORK 0 / KIS 0 / DB 0
 *
 * Input:
 *   logs/opendart-corporate-action-effective-date-reconfirmation-v9-11-7.json
 *
 * Contract:
 * - MERGER / SPIN_OFF are structural corporate actions.
 * - Generic price/share factors MUST NOT be generated for them.
 * - Structural events must keep ratio_from / ratio_to / cash_amount null.
 * - 043910 effective_date = 2026-12-31 is future relative to 2026-10-06.
 * - Therefore:
 *     factor_status = STRUCTURAL_BLOCKED
 *     factor row count = 0
 *     KIS refresh = not required now
 *     carry forward until future structural reconfirmation cycle
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_11_8_043910_STRUCTURAL_FACTOR_VALIDATION';

const AS_OF_DATE = '2026-10-06';

const TARGET = Object.freeze({
  providerEventId: '20261002000418',
  stockCode: '043910',
  actionType: 'MERGER',
  latestSourceReceiptNo: '20261006000033',
  effectiveDate: '2026-12-31',
});

const STRUCTURAL_ACTIONS = new Set([
  'MERGER',
  'SPIN_OFF',
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''),
  );
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

function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(value)
    .digest('hex');
}

function isIsoDate(value) {
  const s = String(value ?? '');

  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return false;
  }

  const d = new Date(`${s}T00:00:00Z`);

  return (
    Number.isFinite(d.getTime()) &&
    d.toISOString().slice(0, 10) === s
  );
}

function main() {
  const root =
    path.resolve(__dirname, '..');

  const inputFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-effective-date-reconfirmation-v9-11-7.json',
    );

  const outputFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-factor-validation-v9-11-8.json',
    );

  assert(
    fs.existsSync(inputFile),
    'V9_11_7_EFFECTIVE_DATE_RECONFIRMATION_NOT_FOUND',
  );

  const input =
    readJson(inputFile);

  assert(
    input.status ===
      'EFFECTIVE_DATE_RECONFIRMATION_COMPLETE_WITH_FUTURE_PENDING',
    `INPUT_STATUS_INVALID:${input.status}`,
  );

  assert(
    input.version ===
      'V9_11_7_043910_STRUCTURAL_EFFECTIVE_DATE_RECONFIRMATION',
    `INPUT_VERSION_INVALID:${input.version}`,
  );

  assert(
    input.asOfDate === AS_OF_DATE,
    `AS_OF_DATE_INVALID:${input.asOfDate}`,
  );

  assert(
    input.conclusion?.providerEventId ===
      TARGET.providerEventId,
    'PROVIDER_EVENT_ID_MISMATCH',
  );

  assert(
    input.conclusion?.latestValidSourceReceiptNo ===
      TARGET.latestSourceReceiptNo,
    'LATEST_SOURCE_RECEIPT_MISMATCH',
  );

  assert(
    input.conclusion?.effectiveDate ===
      TARGET.effectiveDate,
    `EFFECTIVE_DATE_MISMATCH:${input.conclusion?.effectiveDate}`,
  );

  assert(
    input.conclusion?.effectiveDateReconfirmed === true,
    'EFFECTIVE_DATE_NOT_RECONFIRMED',
  );

  assert(
    input.conclusion?.futureStructuralPending === true,
    'EXPECTED_FUTURE_STRUCTURAL_PENDING',
  );

  assert(
    input.conclusion?.genericFactorMustRemainBlocked === true,
    'STRUCTURAL_FACTOR_BLOCK_NOT_PROVEN',
  );

  assert(
    input.conclusion?.kisRefreshRequiredNow === false,
    'KIS_REFRESH_MUST_NOT_BE_REQUIRED_NOW',
  );

  assert(
    STRUCTURAL_ACTIONS.has(TARGET.actionType),
    `NOT_STRUCTURAL_ACTION:${TARGET.actionType}`,
  );

  assert(
    isIsoDate(TARGET.effectiveDate),
    `INVALID_EFFECTIVE_DATE:${TARGET.effectiveDate}`,
  );

  assert(
    TARGET.effectiveDate > AS_OF_DATE,
    'EXPECTED_FUTURE_EFFECTIVE_DATE',
  );

  const row =
    input.results?.[0];

  assert(
    row,
    'INPUT_RESULT_ROW_MISSING',
  );

  assert(
    row.providerEventId ===
      TARGET.providerEventId,
    `ROW_PROVIDER_EVENT_ID_MISMATCH:${row.providerEventId}`,
  );

  assert(
    row.stockCode ===
      TARGET.stockCode,
    `ROW_STOCK_CODE_MISMATCH:${row.stockCode}`,
  );

  assert(
    row.actionType ===
      TARGET.actionType,
    `ROW_ACTION_TYPE_MISMATCH:${row.actionType}`,
  );

  assert(
    row.canonicalPreview?.provider_event_id ===
      TARGET.providerEventId,
    'CANONICAL_PREVIEW_PROVIDER_ID_MISMATCH',
  );

  assert(
    row.canonicalPreview?.stock_code ===
      TARGET.stockCode,
    'CANONICAL_PREVIEW_STOCK_MISMATCH',
  );

  assert(
    row.canonicalPreview?.action_type ===
      TARGET.actionType,
    'CANONICAL_PREVIEW_ACTION_MISMATCH',
  );

  assert(
    row.canonicalPreview?.effective_date ===
      TARGET.effectiveDate,
    `CANONICAL_PREVIEW_EFFECTIVE_DATE_MISMATCH:${row.canonicalPreview?.effective_date}`,
  );

  assert(
    row.canonicalPreview?.ratio_from == null,
    'STRUCTURAL_RATIO_FROM_MUST_BE_NULL',
  );

  assert(
    row.canonicalPreview?.ratio_to == null,
    'STRUCTURAL_RATIO_TO_MUST_BE_NULL',
  );

  assert(
    row.canonicalPreview?.cash_amount == null,
    'STRUCTURAL_CASH_AMOUNT_MUST_BE_NULL',
  );

  const outputRow =
    JSON.parse(
      JSON.stringify(row),
    );

  outputRow.factorValidation = {
    status:
      'STRUCTURAL_BLOCKED',

    reason:
      'MERGER_IS_STRUCTURAL_EVENT_NO_GENERIC_PRICE_SHARE_FACTOR',

    factor:
      null,

    eventPriceFactor:
      null,

    eventShareFactor:
      null,

    referencePrice:
      null,

    referenceTradingDate:
      null,

    kisRequired:
      false,

    futureStructuralPending:
      true,

    effectiveDate:
      TARGET.effectiveDate,

    asOfDate:
      AS_OF_DATE,

    metadata: {
      structuralAction:
        true,

      genericFactorBlocked:
        true,

      ratioFrom:
        null,

      ratioTo:
        null,

      cashAmount:
        null,

      canonicalAdjustedBarPolicy:
        'DO_NOT_DOUBLE_ADJUST',

      sourceReceiptNo:
        TARGET.latestSourceReceiptNo,

      providerEventId:
        TARGET.providerEventId,
    },
  };

  outputRow.v9118Disposition = {
    status:
      'STRUCTURAL_BLOCKED_FUTURE_PENDING',

    factorRowAllowed:
      false,

    adjustmentRunDisposition:
      'BLOCKED_UNSUPPORTED_ACTION',

    persistenceDisposition:
      'DEFER_FUTURE_STRUCTURAL_EVENT',

    kisRefreshDisposition:
      'NOT_REQUIRED_BEFORE_EFFECTIVE_DATE',

    reason:
      'MERGER_STRUCTURAL_EVENT_EFFECTIVE_DATE_AFTER_2026_10_06',
  };

  outputRow.nextStage = {
    ...(outputRow.nextStage ?? {}),

    structuralFactorBlocked:
      true,

    factorReady:
      false,

    factorRowAllowed:
      false,

    futureStructuralPending:
      true,

    persistencePreflightRequiredNow:
      false,

    kisRefreshRequiredNow:
      false,
  };

  const report = {
    status:
      'FACTOR_VALIDATION_COMPLETE_WITH_FUTURE_STRUCTURAL_PENDING',

    version:
      VERSION,

    asOfDate:
      AS_OF_DATE,

    source: {
      inputVersion:
        input.version,

      inputStatus:
        input.status,

      inputFile:
        'logs/opendart-corporate-action-effective-date-reconfirmation-v9-11-7.json',
    },

    counts: {
      targetRows:
        1,

      factorReady:
        0,

      structuralBlocked:
        1,

      futurePending:
        1,

      reviewRequired:
        0,

      factorRowsGenerated:
        0,

      kisRefreshRequired:
        0,
    },

    factorStatusCounts: {
      STRUCTURAL_BLOCKED:
        1,
    },

    factorReasonCounts: {
      MERGER_IS_STRUCTURAL_EVENT_NO_GENERIC_PRICE_SHARE_FACTOR:
        1,
    },

    results: [
      outputRow,
    ],

    factorRows: [],

    reviewQueue: [],

    safety: {
      networkRequests:
        0,

      kisRequests:
        0,

      databaseReads:
        0,

      databaseWrites:
        0,

      productionApplied:
        false,

      adjustmentRunsCreated:
        0,

      factorRowsPersisted:
        0,

      canonicalEventsCreated:
        0,

      coverageWindowAdvanced:
        false,
    },

    policy: {
      structuralActions:
        [
          'MERGER',
          'SPIN_OFF',
        ],

      structuralFactor:
        'GENERIC_PRICE_SHARE_FACTOR_FORBIDDEN',

      structuralNumericFields:
        'RATIO_FROM_RATIO_TO_CASH_AMOUNT_MUST_BE_NULL',

      futureStructural:
        'DEFER_UNTIL_EFFECTIVE_DATE_RECONFIRMATION_CYCLE',

      kisRefresh:
        'NOT_REQUIRED_FOR_FUTURE_STRUCTURAL_BLOCKED_EVENT',

      marketDailyBars:
        'KIS_ADJUSTED_DO_NOT_DOUBLE_ADJUST',
    },

    conclusion: {
      providerEventId:
        TARGET.providerEventId,

      stockCode:
        TARGET.stockCode,

      actionType:
        TARGET.actionType,

      latestValidSourceReceiptNo:
        TARGET.latestSourceReceiptNo,

      effectiveDate:
        TARGET.effectiveDate,

      factorStatus:
        'STRUCTURAL_BLOCKED',

      genericFactorAllowed:
        false,

      factorRowsGenerated:
        0,

      futureStructuralPending:
        true,

      kisRefreshRequiredNow:
        false,

      persistenceRequiredNow:
        false,

      safeToCarryForward:
        true,

      safeToProceedToCycleClosure:
        true,

      safeToWriteProductionNow:
        false,
    },

    nextGate:
      'V9_11_9_2026_10_06_CYCLE_CLOSURE',

    outputFile:
      'logs/opendart-corporate-action-factor-validation-v9-11-8.json',
  };

  report.outputFingerprint =
    sha256(
      JSON.stringify({
        version:
          report.version,

        source:
          report.source,

        results:
          report.results,

        factorRows:
          report.factorRows,

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

        asOfDate:
          report.asOfDate,

        counts:
          report.counts,

        target: {
          providerEventId:
            TARGET.providerEventId,

          stockCode:
            TARGET.stockCode,

          actionType:
            TARGET.actionType,

          latestValidSourceReceiptNo:
            TARGET.latestSourceReceiptNo,

          effectiveDate:
            TARGET.effectiveDate,

          factorStatus:
            'STRUCTURAL_BLOCKED',
        },

        conclusion:
          report.conclusion,

        networkRequests:
          0,

        kisRequests:
          0,

        databaseWrites:
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
}

try {
  main();
} catch (error) {
  console.error(
    JSON.stringify(
      {
        status:
          'V9_11_8_STRUCTURAL_FACTOR_VALIDATION_FAILED',

        version:
          VERSION,

        error:
          String(error?.message ?? error),

        networkRequests:
          0,

        kisRequests:
          0,

        databaseWrites:
          0,

        productionApplied:
          false,
      },
      null,
      2,
    ),
  );

  process.exitCode = 2;
}
