#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * V9.9.8 common-stock result shape probe
 *
 * READ ONLY.
 * No network.
 * No DB reads/writes.
 *
 * Purpose:
 * Inspect the actual storage paths for factor status/reason and
 * effective-date fields in the historical common-stock V9.9 artifacts.
 */

const fs = require('node:fs');
const path = require('node:path');

const VERSION =
  'V9_9_8_COMMON_STOCK_RESULT_SHAPE_PROBE';

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''),
  );
}

function candidateRows(doc) {
  for (const key of [
    'results',
    'repairedRows',
    'rows',
    'outputRows',
    'events',
    'canonicalRows',
  ]) {
    if (Array.isArray(doc?.[key])) {
      return { key, rows: doc[key] };
    }
  }

  const arrays = Object.entries(doc ?? {})
    .filter(([, value]) => Array.isArray(value))
    .map(([key, value]) => ({
      key,
      rows: value,
      score: value.filter(
        (row) =>
          row &&
          typeof row === 'object' &&
          (
            row.stockCode ||
            row.stock_code ||
            row.canonicalPreview?.stock_code
          ),
      ).length,
    }))
    .sort((a, b) => b.score - a.score);

  return arrays[0]?.score > 0
    ? {
        key: arrays[0].key,
        rows: arrays[0].rows,
      }
    : {
        key: null,
        rows: [],
      };
}

function walk(value, prefix = '', out = []) {
  if (
    value === null ||
    value === undefined
  ) {
    return out;
  }

  if (Array.isArray(value)) {
    value.forEach(
      (child, index) =>
        walk(
          child,
          `${prefix}[${index}]`,
          out,
        ),
    );
    return out;
  }

  if (typeof value !== 'object') {
    out.push({
      path: prefix,
      value,
    });
    return out;
  }

  for (
    const [key, child]
    of Object.entries(value)
  ) {
    const childPath =
      prefix
        ? `${prefix}.${key}`
        : key;

    walk(child, childPath, out);
  }

  return out;
}

function rowIdentity(row) {
  const cp =
    row?.canonicalPreview ?? {};

  return {
    providerEventId:
      String(
        row.providerEventId ??
        row.provider_event_id ??
        row.rootReceiptNo ??
        row.root_receipt_no ??
        cp.provider_event_id ??
        cp.providerEventId ??
        '',
      ),

    stockCode:
      String(
        row.stockCode ??
        row.stock_code ??
        cp.stock_code ??
        cp.stockCode ??
        '',
      ).padStart(6, '0'),

    actionType:
      String(
        row.actionType ??
        row.action_type ??
        cp.action_type ??
        cp.actionType ??
        '',
      ),
  };
}

function interestingPaths(row) {
  const flat =
    walk(row);

  return flat.filter(
    ({ path, value }) => {
      const p =
        String(path).toLowerCase();

      const v =
        String(value ?? '')
          .toUpperCase();

      return (
        /factor|status|reason|effective|ratio|canonicalpreview|resolution/.test(p) ||
        [
          'FACTOR_READY',
          'STRUCTURAL_BLOCKED',
          'FUTURE_PENDING',
          'EXPLICIT_EVENT_RATIO',
          'LATEST_PRIOR_CANONICAL_ADJUSTED_MARKET_CLOSE',
        ].some(
          (token) =>
            v.includes(token),
        )
      );
    },
  );
}

function summarize(file) {
  const doc =
    readJson(file);

  const picked =
    candidateRows(doc);

  return {
    file:
      path.basename(file),

    version:
      doc.version ?? null,

    status:
      doc.status ?? null,

    topLevelKeys:
      Object.keys(doc),

    rowArrayKey:
      picked.key,

    rowCount:
      picked.rows.length,

    topLevelCounts: {
      factorReady:
        doc.factorReady ??
        doc.counts?.factorReady ??
        null,

      cashDividendFactorReady:
        doc.cashDividendFactorReady ??
        doc.counts?.cashDividendFactorReady ??
        null,

      ratioFactorReady:
        doc.ratioFactorReady ??
        doc.counts?.ratioFactorReady ??
        null,

      factorReviewRequired:
        doc.factorReviewRequired ??
        doc.counts?.factorReviewRequired ??
        null,

      futurePending:
        doc.futurePending ??
        doc.counts?.futurePending ??
        null,

      structuralBlocked:
        doc.structuralBlocked ??
        doc.counts?.structuralBlocked ??
        null,

      factorStatusCounts:
        doc.factorStatusCounts ??
        null,

      factorReasonCounts:
        doc.factorReasonCounts ??
        null,
    },

    rows:
      picked.rows.map(
        (row) => ({
          identity:
            rowIdentity(row),

          directKeys:
            Object.keys(row),

          canonicalPreviewKeys:
            row.canonicalPreview &&
            typeof row.canonicalPreview === 'object'
              ? Object.keys(
                  row.canonicalPreview,
                )
              : [],

          interestingPaths:
            interestingPaths(row),
        }),
      ),
  };
}

function main() {
  const root =
    path.resolve(__dirname, '..');

  const files = [
    path.join(
      root,
      'logs',
      'opendart-corporate-action-field-extraction-v9-9-6-3-common-stock-scope.json',
    ),
    path.join(
      root,
      'logs',
      'opendart-corporate-action-market-effective-date-v9-9-7-common-stock-scope.json',
    ),
    path.join(
      root,
      'logs',
      'opendart-corporate-action-effective-date-finalization-v9-9-7-2-common-stock-scope.json',
    ),
    path.join(
      root,
      'logs',
      'opendart-corporate-action-factor-validation-v9-9-8-common-stock-scope.json',
    ),
  ];

  for (const file of files) {
    if (!fs.existsSync(file)) {
      throw new Error(
        `INPUT_NOT_FOUND:${path.basename(file)}`,
      );
    }
  }

  const reports =
    files.map(summarize);

  console.log(
    JSON.stringify(
      {
        status:
          'V9_9_8_COMMON_STOCK_RESULT_SHAPE_PROBE_COMPLETE',

        version:
          VERSION,

        reports,

        networkRequests:
          0,

        databaseReads:
          0,

        databaseWrites:
          0,
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
          'V9_9_8_COMMON_STOCK_RESULT_SHAPE_PROBE_FAILED',

        version:
          VERSION,

        error:
          String(
            error?.message ??
            error,
          ),

        networkRequests:
          0,

        databaseWrites:
          0,
      },
      null,
      2,
    ),
  );

  process.exitCode = 2;
}
