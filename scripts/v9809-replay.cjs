/* eslint-disable no-console */
'use strict';

/**
 * AI Stock Lab
 * V9.8.9 - Per-stock multi-event ordering/collision audit
 *
 * READ-ONLY. No network. No DB writes.
 *
 * Input:
 *   logs/opendart-corporate-action-factor-validation-v9-8-8-replay.json
 *
 * Output:
 *   logs/opendart-corporate-action-multi-event-audit-v9-8-9-replay.json
 *
 * Purpose:
 *   Before introducing cumulative corporate-action factors, prove the event
 *   topology first:
 *
 *   - how many stocks have 1 vs multiple FACTOR_READY events
 *   - deterministic chronological ordering
 *   - same-stock + same-effective-date collisions
 *   - mixed action-type sequences
 *   - whether any factor-ready event lacks a positive event factor
 *
 * This stage DOES NOT compute cumulative factors.
 *
 * Run:
 *   node .\scripts\v9809.cjs
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const VERSION =
  'V9_8_9_REPLAY_PER_STOCK_MULTI_EVENT_ORDERING_COLLISION_AUDIT';

const INPUT_VERSION =
  'V9_8_8_REPLAY_PER_EVENT_FACTOR_REFERENCE_VALIDATION';

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

function eventSortKey(row) {
  return [
    row.canonicalPreview?.effective_date ?? '',
    row.providerEventId ?? '',
    row.sourceReceiptNo ?? '',
  ].join('|');
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
      'opendart-corporate-action-factor-validation-v9-8-8-replay.json',
    );

  const outputFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-multi-event-audit-v9-8-9-replay.json',
    );

  if (!fs.existsSync(inputFile)) {
    throw new Error(
      `INPUT_NOT_FOUND:${path.basename(inputFile)}`,
    );
  }

  const input =
    readJson(inputFile);

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
    'PER_EVENT_FACTOR_VALIDATION_COMPLETE'
  ) {
    throw new Error(
      'FACTOR_VALIDATION_NOT_COMPLETE',
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

  const factorReady =
    input.results.filter(
      (row) =>
        row.factorValidation
          ?.status ===
        'FACTOR_READY',
    );

  if (
    factorReady.length !==
    input.counts?.factorReady
  ) {
    throw new Error(
      'FACTOR_READY_COUNT_MISMATCH',
    );
  }

  const invalidFactorEvents =
    factorReady.filter(
      (row) => {
        const price =
          num(
            row.factorValidation
              ?.factor
              ?.eventPriceFactor,
          );

        const share =
          num(
            row.factorValidation
              ?.factor
              ?.eventShareFactor,
          );

        return (
          !(price > 0) ||
          !(share > 0) ||
          !row.stockCode ||
          !row.providerEventId ||
          !row.canonicalPreview
            ?.effective_date
        );
      },
    );

  const groups =
    new Map();

  for (const row of factorReady) {
    if (
      !groups.has(
        row.stockCode,
      )
    ) {
      groups.set(
        row.stockCode,
        [],
      );
    }

    groups
      .get(row.stockCode)
      .push(row);
  }

  const stockGroups =
    [...groups.entries()]
      .map(
        ([stockCode, rows]) => {
          const sorted =
            rows
              .slice()
              .sort(
                (a, b) =>
                  eventSortKey(a)
                    .localeCompare(
                      eventSortKey(b),
                    ),
              );

          const dateGroups =
            new Map();

          for (const row of sorted) {
            const date =
              row.canonicalPreview
                ?.effective_date;

            if (!dateGroups.has(date)) {
              dateGroups.set(
                date,
                [],
              );
            }

            dateGroups
              .get(date)
              .push(row);
          }

          const sameDateCollisions =
            [...dateGroups.entries()]
              .filter(
                ([, dateRows]) =>
                  dateRows.length >
                  1,
              )
              .map(
                ([effectiveDate, dateRows]) => ({
                  effectiveDate,

                  eventCount:
                    dateRows.length,

                  events:
                    dateRows.map(
                      (row) => ({
                        providerEventId:
                          row.providerEventId,

                        actionType:
                          row.actionType,

                        eventPriceFactor:
                          row.factorValidation
                            ?.factor
                            ?.eventPriceFactor,

                        eventShareFactor:
                          row.factorValidation
                            ?.factor
                            ?.eventShareFactor,
                      }),
                    ),
                }),
              );

          const actionTypes =
            [
              ...new Set(
                sorted.map(
                  (row) =>
                    row.actionType,
                ),
              ),
            ];

          const orderedEvents =
            sorted.map(
              (row, index) => ({
                order:
                  index + 1,

                effectiveDate:
                  row.canonicalPreview
                    ?.effective_date,

                providerEventId:
                  row.providerEventId,

                sourceReceiptNo:
                  row.sourceReceiptNo,

                actionType:
                  row.actionType,

                eventPriceFactor:
                  row.factorValidation
                    ?.factor
                    ?.eventPriceFactor,

                eventShareFactor:
                  row.factorValidation
                    ?.factor
                    ?.eventShareFactor,

                factorReason:
                  row.factorValidation
                    ?.reason,

                referenceTradingDate:
                  row.factorValidation
                    ?.factor
                    ?.metadata
                    ?.reference_trading_date ??
                  null,
              }),
            );

          return {
            stockCode,

            eventCount:
              sorted.length,

            firstEffectiveDate:
              sorted[0]
                ?.canonicalPreview
                ?.effective_date ??
              null,

            lastEffectiveDate:
              sorted.at(-1)
                ?.canonicalPreview
                ?.effective_date ??
              null,

            actionTypes,

            mixedActionTypes:
              actionTypes.length >
              1,

            sameDateCollisionCount:
              sameDateCollisions.length,

            sameDateCollisions,

            orderedEvents,
          };
        },
      )
      .sort(
        (a, b) =>
          a.stockCode.localeCompare(
            b.stockCode,
          ),
      );

  const singleEventGroups =
    stockGroups.filter(
      (group) =>
        group.eventCount ===
        1,
    );

  const multiEventGroups =
    stockGroups.filter(
      (group) =>
        group.eventCount >
        1,
    );

  const collisionGroups =
    stockGroups.filter(
      (group) =>
        group.sameDateCollisionCount >
        0,
    );

  const mixedTypeGroups =
    stockGroups.filter(
      (group) =>
        group.mixedActionTypes,
    );

  const totalGroupedEvents =
    stockGroups.reduce(
      (sum, group) =>
        sum +
        group.eventCount,
      0,
    );

  const duplicateProviderEventIds =
    factorReady.length -
    new Set(
      factorReady.map(
        (row) =>
          row.providerEventId,
      ),
    ).size;

  const deterministicOrderStable =
    stockGroups.every(
      (group) =>
        group.orderedEvents.every(
          (event, index, arr) => {
            if (index === 0) {
              return true;
            }

            const previous =
              arr[index - 1];

            const prevKey =
              [
                previous.effectiveDate,
                previous.providerEventId,
                previous.sourceReceiptNo,
              ].join('|');

            const currentKey =
              [
                event.effectiveDate,
                event.providerEventId,
                event.sourceReceiptNo,
              ].join('|');

            return (
              prevKey.localeCompare(
                currentKey,
              ) <= 0
            );
          },
        ),
    );

  const blockedReasons = [];

  if (
    invalidFactorEvents.length >
    0
  ) {
    blockedReasons.push(
      'INVALID_FACTOR_READY_EVENT',
    );
  }

  if (
    duplicateProviderEventIds >
    0
  ) {
    blockedReasons.push(
      'DUPLICATE_PROVIDER_EVENT_ID',
    );
  }

  if (
    totalGroupedEvents !==
    factorReady.length
  ) {
    blockedReasons.push(
      'GROUPED_EVENT_COUNT_MISMATCH',
    );
  }

  if (
    !deterministicOrderStable
  ) {
    blockedReasons.push(
      'DETERMINISTIC_ORDER_FAILED',
    );
  }

  /*
   * Same-date collisions are not automatically invalid.
   * They require an explicit accumulation policy before cumulative factors.
   */
  const status =
    blockedReasons.length >
    0
      ? 'MULTI_EVENT_AUDIT_INVALID'
      : collisionGroups.length >
        0
        ? 'MULTI_EVENT_AUDIT_COMPLETE_WITH_SAME_DATE_COLLISIONS'
        : 'MULTI_EVENT_AUDIT_COMPLETE';

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

    counts: {
      factorReadyEvents:
        factorReady.length,

      distinctStocks:
        stockGroups.length,

      singleEventStocks:
        singleEventGroups.length,

      multiEventStocks:
        multiEventGroups.length,

      maxEventsPerStock:
        stockGroups.reduce(
          (max, group) =>
            Math.max(
              max,
              group.eventCount,
            ),
          0,
        ),

      mixedActionTypeStocks:
        mixedTypeGroups.length,

      sameDateCollisionStocks:
        collisionGroups.length,

      sameDateCollisionBuckets:
        collisionGroups.reduce(
          (sum, group) =>
            sum +
            group.sameDateCollisionCount,
          0,
        ),

      invalidFactorEvents:
        invalidFactorEvents.length,

      duplicateProviderEventIds,

      totalGroupedEvents,
    },

    eventsPerStockDistribution:
      countBy(
        stockGroups,
        (group) =>
          String(
            group.eventCount,
          ),
      ),

    multiEventActionPatternCounts:
      countBy(
        multiEventGroups,
        (group) =>
          group.actionTypes
            .slice()
            .sort()
            .join('+'),
      ),

    blockedReasons,

    collisionGroups:
      collisionGroups.map(
        (group) => ({
          stockCode:
            group.stockCode,

          eventCount:
            group.eventCount,

          sameDateCollisionCount:
            group.sameDateCollisionCount,

          sameDateCollisions:
            group.sameDateCollisions,
        }),
      ),

    multiEventGroups:
      multiEventGroups.map(
        (group) => ({
          stockCode:
            group.stockCode,

          eventCount:
            group.eventCount,

          actionTypes:
            group.actionTypes,

          mixedActionTypes:
            group.mixedActionTypes,

          firstEffectiveDate:
            group.firstEffectiveDate,

          lastEffectiveDate:
            group.lastEffectiveDate,

          sameDateCollisionCount:
            group.sameDateCollisionCount,

          orderedEvents:
            group.orderedEvents,
        }),
      ),

    stockGroups,

    safety: {
      networkRequests:
        0,

      databaseReads:
        0,

      databaseWrites:
        0,

      productionApplied:
        false,

      factorsPersisted:
        0,

      cumulativeFactorsComputed:
        false,

      cumulativeFactorsPersisted:
        false,

      canonicalAdjustedBarsMutated:
        false,

      coverageWindowAdvanced:
        false,
    },

    policy: {
      ordering:
        'EFFECTIVE_DATE_THEN_PROVIDER_EVENT_ID_THEN_SOURCE_RECEIPT',

      sameDateCollision:
        'AUDIT_ONLY_DO_NOT_ACCUMULATE_UNTIL_EXPLICIT_POLICY',

      cumulativeFactor:
        'NOT_COMPUTED_IN_V9_8_9',

      canonicalBars:
        'NO_MUTATION',
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

        inputFingerprint:
          report.source.inputFingerprint,

        groups:
          stockGroups.map(
            (group) => [
              group.stockCode,
              group.orderedEvents.map(
                (event) => [
                  event.effectiveDate,
                  event.providerEventId,
                  event.actionType,
                  event.eventPriceFactor,
                  event.eventShareFactor,
                ],
              ),
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

        eventsPerStockDistribution:
          report.eventsPerStockDistribution,

        multiEventActionPatternCounts:
          report.multiEventActionPatternCounts,

        blockedReasons:
          report.blockedReasons,

        collisionGroups:
          report.collisionGroups,

        multiEventGroups:
          report.multiEventGroups,

        networkRequests:
          0,

        databaseWrites:
          0,

        productionApplied:
          false,

        cumulativeFactorsComputed:
          false,

        cumulativeFactorsPersisted:
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
    'MULTI_EVENT_AUDIT_INVALID'
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
