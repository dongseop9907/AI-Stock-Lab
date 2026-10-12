/* eslint-disable no-console */
'use strict';

/**
 * AI Stock Lab
 * V9.8.10 - Single-event cumulative-factor preview
 *
 * READ-ONLY. No network. No DB writes.
 *
 * Inputs:
 *   logs/opendart-corporate-action-factor-validation-v9-9-8-common-stock-scope.json
 *   logs/opendart-corporate-action-multi-event-audit-v9-9-9-common-stock-scope.json
 *
 * Output:
 *   logs/opendart-corporate-action-cumulative-factor-preview-v9-9-10-common-stock-scope.json
 *
 * V9.8.9 proved:
 *   - 121 FACTOR_READY events
 *   - 121 distinct stocks
 *   - every stock has exactly one factor-ready event
 *   - no same-date collisions
 *
 * Therefore for this batch only:
 *   cumulative_price_factor = event_price_factor
 *   cumulative_share_factor = event_share_factor
 *
 * This is NOT a general multi-event accumulation implementation.
 * If a later batch contains >1 factor-ready event for the same stock,
 * this script must fail closed.
 *
 * Run:
 *   node .\scripts\v9810.cjs
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_8_10_SINGLE_EVENT_CUMULATIVE_FACTOR_PREVIEW';

const FACTOR_INPUT_VERSION =
  'V9_8_8_PER_EVENT_FACTOR_REFERENCE_VALIDATION';

const AUDIT_INPUT_VERSION =
  'V9_8_9_PER_STOCK_MULTI_EVENT_ORDERING_COLLISION_AUDIT';

const EXPECTED_FACTOR_READY =
  2;

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''),
  );
}

function atomicSaveJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const temp =
    `${file}.tmp`;

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

function deterministicUuid(input) {
  const bytes =
    crypto
      .createHash('sha256')
      .update(input)
      .digest()
      .subarray(0, 16);

  bytes[6] =
    (bytes[6] & 0x0f) |
    0x50;

  bytes[8] =
    (bytes[8] & 0x3f) |
    0x80;

  const hex =
    bytes.toString('hex');

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
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

function num(value) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

function main() {
  const root =
    path.resolve(
      __dirname,
      '..',
    );

  const factorFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-factor-validation-v9-9-8-common-stock-scope.json',
    );

  const auditFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-multi-event-audit-v9-9-9-common-stock-scope.json',
    );

  const outputFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-cumulative-factor-preview-v9-9-10-common-stock-scope.json',
    );

  for (const file of [
    factorFile,
    auditFile,
  ]) {
    if (!fs.existsSync(file)) {
      throw new Error(
        `INPUT_NOT_FOUND:${path.basename(file)}`,
      );
    }
  }

  const factorInput =
    readJson(
      factorFile,
    );

  const auditInput =
    readJson(
      auditFile,
    );

  if (
    factorInput.version !==
    FACTOR_INPUT_VERSION
  ) {
    throw new Error(
      'FACTOR_INPUT_VERSION_MISMATCH',
    );
  }

  if (
    auditInput.version !==
    AUDIT_INPUT_VERSION
  ) {
    throw new Error(
      'AUDIT_INPUT_VERSION_MISMATCH',
    );
  }

  if (
    factorInput.status !==
    'PER_EVENT_FACTOR_VALIDATION_COMPLETE'
  ) {
    throw new Error(
      'FACTOR_VALIDATION_NOT_COMPLETE',
    );
  }

  if (
    auditInput.status !==
    'MULTI_EVENT_AUDIT_COMPLETE'
  ) {
    throw new Error(
      'MULTI_EVENT_AUDIT_NOT_CLEAN',
    );
  }

  if (
    auditInput.counts
      ?.factorReadyEvents !==
      EXPECTED_FACTOR_READY ||
    auditInput.counts
      ?.distinctStocks !==
      EXPECTED_FACTOR_READY ||
    auditInput.counts
      ?.singleEventStocks !==
      EXPECTED_FACTOR_READY ||
    auditInput.counts
      ?.multiEventStocks !==
      0 ||
    auditInput.counts
      ?.sameDateCollisionStocks !==
      0 ||
    auditInput.counts
      ?.sameDateCollisionBuckets !==
      0
  ) {
    throw new Error(
      'SINGLE_EVENT_TOPOLOGY_CONTRACT_FAILED',
    );
  }

  if (
    !Array.isArray(
      factorInput.results,
    )
  ) {
    throw new Error(
      'FACTOR_RESULTS_MISSING',
    );
  }

  const factorReadyRows =
    factorInput.results
      .filter(
        (row) =>
          row.factorValidation
            ?.status ===
          'FACTOR_READY',
      )
      .slice()
      .sort(
        (a, b) =>
          [
            a.stockCode,
            a.canonicalPreview
              ?.effective_date,
            a.providerEventId,
          ]
            .join('|')
            .localeCompare(
              [
                b.stockCode,
                b.canonicalPreview
                  ?.effective_date,
                b.providerEventId,
              ].join('|'),
            ),
      );

  if (
    factorReadyRows.length !==
    EXPECTED_FACTOR_READY
  ) {
    throw new Error(
      'FACTOR_READY_ROW_COUNT_MISMATCH',
    );
  }

  const stockCounts =
    new Map();

  for (const row of factorReadyRows) {
    stockCounts.set(
      row.stockCode,
      (
        stockCounts.get(
          row.stockCode,
        ) ??
        0
      ) + 1,
    );
  }

  const multiEventStockCodes =
    [...stockCounts.entries()]
      .filter(
        ([, count]) =>
          count > 1,
      )
      .map(
        ([stockCode]) =>
          stockCode,
      );

  if (
    multiEventStockCodes.length >
    0
  ) {
    throw new Error(
      'MULTI_EVENT_STOCK_DETECTED_FAIL_CLOSED',
    );
  }

  const runs = [];
  const factors = [];

  for (
    let index = 0;
    index <
    factorReadyRows.length;
    index += 1
  ) {
    const row =
      factorReadyRows[index];

    const eventPriceFactor =
      num(
        row.factorValidation
          ?.factor
          ?.eventPriceFactor,
      );

    const eventShareFactor =
      num(
        row.factorValidation
          ?.factor
          ?.eventShareFactor,
      );

    if (
      !(eventPriceFactor > 0) ||
      !(eventShareFactor > 0)
    ) {
      throw new Error(
        `INVALID_EVENT_FACTOR:${row.providerEventId}`,
      );
    }

    const runIdentity =
      [
        VERSION,
        row.stockCode,
        row.providerEventId,
        row.canonicalPreview
          ?.effective_date,
      ].join('|');

    const runId =
      deterministicUuid(
        runIdentity,
      );

    const cumulativePriceFactor =
      eventPriceFactor;

    const cumulativeShareFactor =
      eventShareFactor;

    runs.push({
      runId,

      stockCode:
        row.stockCode,

      status:
        'READY',

      eventCount:
        1,

      supportedEventCount:
        1,

      factorCount:
        1,

      eventProviderEventIds: [
        row.providerEventId,
      ],

      actionTypes: [
        row.actionType,
      ],

      firstEffectiveDate:
        row.canonicalPreview
          ?.effective_date,

      lastEffectiveDate:
        row.canonicalPreview
          ?.effective_date,

      cumulativePriceFactor,

      cumulativeShareFactor,

      summary: {
        cumulative_contract:
          'SINGLE_EVENT_CUMULATIVE_EQUALS_EVENT_FACTOR',

        multi_event_accumulation_policy:
          'NOT_NEEDED_FOR_CURRENT_BATCH_V9_8_10',

        deterministic_run_identity:
          runIdentity,

        provider_event_id:
          row.providerEventId,

        source_fingerprint:
          row.sourceFingerprint,

        canonical_adjusted_bar_policy:
          'FACTOR_MUST_NOT_BE_APPLIED_TO_ALREADY_ADJUSTED_MARKET_DAILY_BARS',
      },
    });

    factors.push({
      runId,

      stockCode:
        row.stockCode,

      providerEventId:
        row.providerEventId,

      sourceReceiptNo:
        row.sourceReceiptNo,

      sourceFingerprint:
        row.sourceFingerprint,

      effectiveDate:
        row.canonicalPreview
          ?.effective_date,

      actionType:
        row.actionType,

      eventPriceFactor,

      eventShareFactor,

      cumulativePriceFactor,

      cumulativeShareFactor,

      factorMetadata:
        row.factorValidation
          ?.factor
          ?.metadata ??
        {},

      cumulativeMetadata: {
        cumulative_rule:
          'SINGLE_EVENT_CUMULATIVE_EQUALS_EVENT_FACTOR',

        event_order:
          1,

        event_count:
          1,
      },
    });

    console.log(
      [
        'CUMULATIVE',
        `${index + 1}/${factorReadyRows.length}`,
        `stock=${row.stockCode}`,
        `root=${row.providerEventId}`,
        `action=${row.actionType}`,
        `price=${eventPriceFactor}`,
        `share=${eventShareFactor}`,
      ].join(' '),
    );
  }

  const cumulativeEqualsEvent =
    factors.every(
      (row) =>
        row.eventPriceFactor ===
          row.cumulativePriceFactor &&
        row.eventShareFactor ===
          row.cumulativeShareFactor,
    );

  const uniqueRunIds =
    new Set(
      runs.map(
        (row) =>
          row.runId,
      ),
    ).size;

  const uniqueFactorIdentities =
    new Set(
      factors.map(
        (row) =>
          `${row.runId}|${row.providerEventId}`,
      ),
    ).size;

  const positiveCumulativeFactors =
    factors.every(
      (row) =>
        row.cumulativePriceFactor >
          0 &&
        row.cumulativeShareFactor >
          0,
    );

  const allSingleEvent =
    runs.every(
      (row) =>
        row.eventCount ===
          1 &&
        row.factorCount ===
          1,
    );

  const status =
    runs.length ===
      EXPECTED_FACTOR_READY &&
    factors.length ===
      EXPECTED_FACTOR_READY &&
    uniqueRunIds ===
      EXPECTED_FACTOR_READY &&
    uniqueFactorIdentities ===
      EXPECTED_FACTOR_READY &&
    cumulativeEqualsEvent &&
    positiveCumulativeFactors &&
    allSingleEvent
      ? 'SINGLE_EVENT_CUMULATIVE_FACTOR_PREVIEW_PROVEN'
      : 'SINGLE_EVENT_CUMULATIVE_FACTOR_PREVIEW_INVALID';

  const report = {
    version:
      VERSION,

    status,

    source: {
      factorInputVersion:
        factorInput.version,

      factorInputFingerprint:
        factorInput.outputFingerprint,

      auditInputVersion:
        auditInput.version,

      auditInputFingerprint:
        auditInput.outputFingerprint,
    },

    counts: {
      inputFactorReadyEvents:
        factorReadyRows.length,

      runRows:
        runs.length,

      factorRows:
        factors.length,

      distinctStocks:
        new Set(
          runs.map(
            (row) =>
              row.stockCode,
          ),
        ).size,

      uniqueRunIds,

      uniqueFactorIdentities,

      multiEventStocksDetected:
        multiEventStockCodes.length,

      futurePendingPreserved:
        factorInput.counts
          ?.futurePending ??
        0,

      structuralBlockedPreserved:
        factorInput.counts
          ?.structuralBlocked ??
        0,
    },

    checks: {
      cumulativeEqualsEvent,

      positiveCumulativeFactors,

      allSingleEvent,

      noMultiEventStocks:
        multiEventStockCodes.length ===
        0,

      noSameDateCollisions:
        auditInput.counts
          ?.sameDateCollisionStocks ===
        0,
    },

    actionTypeCounts:
      countBy(
        factors,
        (row) =>
          row.actionType,
      ),

    runs,

    factors,

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

      adjustmentRunsPersisted:
        0,

      factorRowsPersisted:
        0,

      canonicalAdjustedBarsMutated:
        false,

      coverageWindowAdvanced:
        false,
    },

    policy: {
      currentBatchAccumulation:
        'ONE_FACTOR_READY_EVENT_PER_STOCK',

      cumulativePriceFactor:
        'EQUALS_EVENT_PRICE_FACTOR',

      cumulativeShareFactor:
        'EQUALS_EVENT_SHARE_FACTOR',

      multiEventFutureBehavior:
        'FAIL_CLOSED_AND_REQUIRE_SEPARATE_ORDERED_ACCUMULATION_CONTRACT',

      canonicalBars:
        'DO_NOT_APPLY_FACTORS_TO_ALREADY_ADJUSTED_MARKET_DAILY_BARS',

      persistence:
        'NO_WRITES_IN_V9_8_10',
    },

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

        factorInputFingerprint:
          report.source
            .factorInputFingerprint,

        auditInputFingerprint:
          report.source
            .auditInputFingerprint,

        runs:
          runs.map(
            (row) => [
              row.runId,
              row.stockCode,
              row.eventProviderEventIds,
              row.cumulativePriceFactor,
              row.cumulativeShareFactor,
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

        checks:
          report.checks,

        actionTypeCounts:
          report.actionTypeCounts,

        networkRequests:
          0,

        databaseWrites:
          0,

        productionApplied:
          false,

        adjustmentRunsPersisted:
          0,

        factorRowsPersisted:
          0,

        canonicalAdjustedBarsMutated:
          false,

        coverageWindowAdvanced:
          false,

        outputFile:
          report.outputFile,
      },
      null,
      2,
    ),
  );

  if (
    status ===
    'SINGLE_EVENT_CUMULATIVE_FACTOR_PREVIEW_INVALID'
  ) {
    process.exitCode =
      2;
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

  process.exitCode =
    1;
}
