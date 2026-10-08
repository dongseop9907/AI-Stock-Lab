#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VERSION =
  'ALPHA_V1_BACKFILL_CONFLICT_CLASSIFIER';

const INPUT_FILE =
  path.resolve(
    process.cwd(),
    'logs',
    'alpha-v1-controlled-3-stock-daily-bar-backfill-plan.json',
  );

const OUTPUT_FILE =
  path.resolve(
    process.cwd(),
    'logs',
    'alpha-v1-controlled-3-stock-daily-bar-backfill-conflict-analysis.json',
  );

const SEMANTIC_FIELDS = [
  'open_price',
  'high_price',
  'low_price',
  'close_price',
  'volume',
  'trading_value',
  'source',
  'adjusted_price',
];

const PRICE_FIELDS = new Set([
  'open_price',
  'high_price',
  'low_price',
  'close_price',
]);

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(
      file,
      'utf8',
    ),
  );
}

function countBy(items, keyFn) {
  const map = new Map();

  for (const item of items) {
    const key = keyFn(item);

    map.set(
      key,
      (map.get(key) ?? 0) + 1,
    );
  }

  return Object.fromEntries(
    [...map.entries()]
      .sort(
        (a, b) =>
          String(a[0])
            .localeCompare(
              String(b[0]),
            ),
      ),
  );
}

function stockCodeFromKey(key) {
  return String(key ?? '')
    .split('|')[0] ?? '';
}

function diffFields(existing, desired) {
  return SEMANTIC_FIELDS
    .filter(
      (field) =>
        existing?.[field] !==
        desired?.[field],
    );
}

function numericRatio(
  existing,
  desired,
) {
  const a = Number(existing);
  const b = Number(desired);

  if (
    !Number.isFinite(a) ||
    !Number.isFinite(b) ||
    b === 0
  ) {
    return null;
  }

  return a / b;
}

function roundRatio(value) {
  if (
    value === null ||
    !Number.isFinite(value)
  ) {
    return null;
  }

  return Number(
    value.toFixed(8),
  );
}

function classifyConflict(conflict) {
  const fields =
    diffFields(
      conflict.existing,
      conflict.desired,
    );

  const priceFields =
    fields.filter(
      (field) =>
        PRICE_FIELDS.has(field),
    );

  const hasVolume =
    fields.includes(
      'volume',
    );

  const hasTradingValue =
    fields.includes(
      'trading_value',
    );

  const hasSource =
    fields.includes(
      'source',
    );

  const hasAdjusted =
    fields.includes(
      'adjusted_price',
    );

  const onlyMetadata =
    fields.length > 0 &&
    fields.every(
      (field) =>
        field === 'source' ||
        field === 'adjusted_price',
    );

  const priceRatios =
    Object.fromEntries(
      [...PRICE_FIELDS]
        .map(
          (field) => [
            field,
            roundRatio(
              numericRatio(
                conflict.existing?.[field],
                conflict.desired?.[field],
              ),
            ),
          ],
        ),
    );

  const finitePriceRatios =
    Object.values(
      priceRatios,
    )
      .filter(
        (value) =>
          typeof value === 'number' &&
          Number.isFinite(value),
      );

  let commonPriceFactor =
    null;

  if (
    priceFields.length > 0 &&
    finitePriceRatios.length === 4
  ) {
    const first =
      finitePriceRatios[0];

    const allClose =
      finitePriceRatios.every(
        (value) =>
          Math.abs(
            value - first,
          ) <= 1e-8,
      );

    if (allClose) {
      commonPriceFactor =
        first;
    }
  }

  return {
    key:
      conflict.key,

    stockCode:
      stockCodeFromKey(
        conflict.key,
      ),

    differingFields:
      fields,

    category:
      onlyMetadata
        ? 'METADATA_ONLY'
        : priceFields.length > 0
          ? (
              commonPriceFactor !== null
                ? 'PRICE_FACTOR_DIFFERENCE'
                : 'PRICE_VALUE_DIFFERENCE'
            )
          : (
              hasVolume ||
              hasTradingValue
                ? 'VOLUME_OR_VALUE_DIFFERENCE'
                : 'OTHER_SEMANTIC_DIFFERENCE'
            ),

    commonPriceFactor,

    priceRatios,

    hasPriceDifference:
      priceFields.length > 0,

    hasVolumeDifference:
      hasVolume,

    hasTradingValueDifference:
      hasTradingValue,

    hasSourceDifference:
      hasSource,

    hasAdjustedFlagDifference:
      hasAdjusted,

    existing:
      conflict.existing,

    desired:
      conflict.desired,
  };
}

function main() {
  if (!fs.existsSync(INPUT_FILE)) {
    throw new Error(
      `INPUT_FILE_NOT_FOUND:${INPUT_FILE}`,
    );
  }

  const plan =
    readJson(
      INPUT_FILE,
    );

  const conflicts =
    Array.isArray(
      plan.semanticConflicts,
    )
      ? plan.semanticConflicts
      : [];

  const actions =
    Array.isArray(
      plan.actions,
    )
      ? plan.actions
      : [];

  const classified =
    conflicts.map(
      classifyConflict,
    );

  const actionSummaryByStock = {};

  for (const action of actions) {
    const stockCode =
      stockCodeFromKey(
        action.key,
      );

    if (!actionSummaryByStock[stockCode]) {
      actionSummaryByStock[stockCode] = {
        INSERT: 0,
        NOOP_IDENTICAL: 0,
        UPDATE_SEMANTIC_DIFFERENCE: 0,
      };
    }

    const actionName =
      String(
        action.action ?? '',
      );

    if (
      Object.prototype
        .hasOwnProperty
        .call(
          actionSummaryByStock[stockCode],
          actionName,
        )
    ) {
      actionSummaryByStock[
        stockCode
      ][actionName] += 1;
    }
  }

  const fieldDifferenceCounts =
    Object.fromEntries(
      SEMANTIC_FIELDS.map(
        (field) => [
          field,
          classified.filter(
            (row) =>
              row.differingFields
                .includes(
                  field,
                ),
          ).length,
        ],
      ),
    );

  const categoryCounts =
    countBy(
      classified,
      (row) =>
        row.category,
    );

  const priceFactorRows =
    classified.filter(
      (row) =>
        row.category ===
          'PRICE_FACTOR_DIFFERENCE' &&
        typeof row.commonPriceFactor ===
          'number',
    );

  const priceFactorCounts =
    countBy(
      priceFactorRows,
      (row) =>
        String(
          row.commonPriceFactor,
        ),
    );

  const nonMetadataConflicts =
    classified.filter(
      (row) =>
        row.category !==
        'METADATA_ONLY',
    );

  const priceConflicts =
    classified.filter(
      (row) =>
        row.hasPriceDifference,
    );

  const volumeOrValueConflicts =
    classified.filter(
      (row) =>
        row.hasVolumeDifference ||
        row.hasTradingValueDifference,
    );

  const sourceOnlyConflicts =
    classified.filter(
      (row) =>
        row.differingFields.length === 1 &&
        row.differingFields[0] ===
          'source',
    );

  const adjustedOnlyConflicts =
    classified.filter(
      (row) =>
        row.differingFields.length === 1 &&
        row.differingFields[0] ===
          'adjusted_price',
    );

  const perStockConflictSummary =
    {};

  for (
    const stockCode
    of [
      ...new Set(
        classified.map(
          (row) =>
            row.stockCode,
        ),
      ),
    ].sort()
  ) {
    const rows =
      classified.filter(
        (row) =>
          row.stockCode ===
          stockCode,
      );

    perStockConflictSummary[
      stockCode
    ] = {
      conflicts:
        rows.length,

      categoryCounts:
        countBy(
          rows,
          (row) =>
            row.category,
        ),

      fieldDifferenceCounts:
        Object.fromEntries(
          SEMANTIC_FIELDS.map(
            (field) => [
              field,
              rows.filter(
                (row) =>
                  row.differingFields
                    .includes(
                      field,
                    ),
              ).length,
            ],
          ),
        ),

      priceFactorCounts:
        countBy(
          rows.filter(
            (row) =>
              typeof row
                .commonPriceFactor ===
                'number',
          ),
          (row) =>
            String(
              row.commonPriceFactor,
            ),
        ),
    };
  }

  let conclusion;

  if (
    conflicts.length === 0
  ) {
    conclusion = {
      status:
        'NO_SEMANTIC_CONFLICTS',

      safeToProceedToControlledApply:
        true,

      reason:
        'PLAN_CONTAINS_NO_SEMANTIC_UPDATES',
    };
  } else if (
    nonMetadataConflicts.length === 0
  ) {
    conclusion = {
      status:
        'METADATA_ONLY_CONFLICTS',

      safeToProceedToControlledApply:
        false,

      reason:
        'NO_PRICE_VOLUME_VALUE_CONFLICTS_BUT_METADATA_LINEAGE_MUST_BE_REVIEWED_BEFORE_OVERWRITE',

      nextGate:
        'REVIEW_METADATA_LINEAGE_THEN_DECIDE_INSERT_ONLY_OR_METADATA_ENRICHMENT',
    };
  } else {
    conclusion = {
      status:
        'BUSINESS_VALUE_CONFLICTS_PRESENT',

      safeToProceedToControlledApply:
        false,

      reason:
        'EXISTING_AND_PROVIDER_ROWS_DIFFER_IN_PRICE_VOLUME_OR_TRADING_VALUE',

      nextGate:
        'TRACE_EXISTING_ROW_LINEAGE_AND_ADJUSTMENT_MODE_BEFORE_ANY_WRITE',
    };
  }

  const report = {
    status:
      'ALPHA_V1_BACKFILL_CONFLICT_CLASSIFICATION_COMPLETE',

    version:
      VERSION,

    input: {
      file:
        'logs/alpha-v1-controlled-3-stock-daily-bar-backfill-plan.json',

      planStatus:
        plan.status ??
        null,

      desiredRows:
        plan.plan
          ?.desiredRows ??
        null,

      existingRowsInScope:
        plan.databaseBefore
          ?.existingRowsInScope ??
        null,

      insertCount:
        plan.plan
          ?.insertCount ??
        null,

      noopIdenticalCount:
        plan.plan
          ?.noopIdenticalCount ??
        null,

      semanticUpdateCount:
        plan.plan
          ?.semanticUpdateCount ??
        null,
    },

    actionSummaryByStock,

    conflictSummary: {
      total:
        classified.length,

      categoryCounts,

      fieldDifferenceCounts,

      metadataOnlyCount:
        classified.filter(
          (row) =>
            row.category ===
            'METADATA_ONLY',
        ).length,

      sourceOnlyCount:
        sourceOnlyConflicts.length,

      adjustedOnlyCount:
        adjustedOnlyConflicts.length,

      priceConflictCount:
        priceConflicts.length,

      volumeOrTradingValueConflictCount:
        volumeOrValueConflicts.length,

      commonPriceFactorCounts:
        priceFactorCounts,
    },

    perStockConflictSummary,

    sampleConflicts:
      classified.slice(
        0,
        25,
      ),

    allConflicts:
      classified,

    conclusion,

    safety: {
      databaseReads:
        0,

      databaseWrites:
        0,

      networkRequests:
        0,

      deletes:
        0,

      ordersCreated:
        0,

      positionsChanged:
        0,

      productionDecisionApplied:
        false,
    },

    nextGate:
      conclusion.nextGate ??
      (
        conclusion
          .safeToProceedToControlledApply
          ? 'CONTROLLED_APPLY_CAN_BE_PREPARED'
          : 'REVIEW_REQUIRED'
      ),
  };

  fs.mkdirSync(
    path.dirname(
      OUTPUT_FILE,
    ),
    {
      recursive:
        true,
    },
  );

  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify(
      report,
      null,
      2,
    ) + '\n',
    'utf8',
  );

  console.log(
    JSON.stringify(
      {
        status:
          report.status,

        version:
          report.version,

        input:
          report.input,

        actionSummaryByStock:
          report.actionSummaryByStock,

        conflictSummary:
          report.conflictSummary,

        perStockConflictSummary:
          report.perStockConflictSummary,

        conclusion:
          report.conclusion,

        safety:
          report.safety,

        nextGate:
          report.nextGate,

        outputFile:
          'logs/alpha-v1-controlled-3-stock-daily-bar-backfill-conflict-analysis.json',
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
          'ALPHA_V1_BACKFILL_CONFLICT_CLASSIFICATION_FAILED',

        version:
          VERSION,

        error:
          String(
            error?.message ??
            error,
          ),

        safety: {
          databaseWrites:
            0,

          networkRequests:
            0,

          ordersCreated:
            0,
        },
      },
      null,
      2,
    ),
  );

  process.exitCode =
    2;
}
