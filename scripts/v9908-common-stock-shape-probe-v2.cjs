#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * V9.9.8 common-stock result shape probe V2
 *
 * READ ONLY.
 * Full inspection is written to a JSON file.
 * Console output is intentionally compact.
 *
 * No network.
 * No DB reads/writes.
 */

const fs = require('node:fs');
const path = require('node:path');

const VERSION =
  'V9_9_8_COMMON_STOCK_RESULT_SHAPE_PROBE_V2_COMPACT';

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''),
  );
}

function atomicSaveJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
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
    ? { key: arrays[0].key, rows: arrays[0].rows }
    : { key: null, rows: [] };
}

function walk(value, prefix = '', out = []) {
  if (value === null || value === undefined) {
    out.push({ path: prefix, value });
    return out;
  }

  if (Array.isArray(value)) {
    value.forEach(
      (child, index) =>
        walk(child, `${prefix}[${index}]`, out),
    );
    return out;
  }

  if (typeof value !== 'object') {
    out.push({ path: prefix, value });
    return out;
  }

  for (const [key, child] of Object.entries(value)) {
    const childPath = prefix ? `${prefix}.${key}` : key;
    walk(child, childPath, out);
  }

  return out;
}

function identity(row) {
  const cp = row?.canonicalPreview ?? {};

  return {
    providerEventId: String(
      row.providerEventId ??
      row.provider_event_id ??
      row.rootReceiptNo ??
      row.root_receipt_no ??
      cp.provider_event_id ??
      cp.providerEventId ??
      '',
    ),
    stockCode: String(
      row.stockCode ??
      row.stock_code ??
      cp.stock_code ??
      cp.stockCode ??
      '',
    ).padStart(6, '0'),
    actionType: String(
      row.actionType ??
      row.action_type ??
      cp.action_type ??
      cp.actionType ??
      '',
    ),
  };
}

function interesting(row) {
  return walk(row).filter(({ path, value }) => {
    const p = String(path).toLowerCase();
    const v = String(value ?? '').toUpperCase();

    return (
      /factor|status|reason|effective|ratio|resolution/.test(p) ||
      [
        'FACTOR_READY',
        'STRUCTURAL_BLOCKED',
        'FUTURE_PENDING',
        'EXPLICIT_EVENT_RATIO',
        'LATEST_PRIOR_CANONICAL_ADJUSTED_MARKET_CLOSE',
      ].some((token) => v.includes(token))
    );
  });
}

function uniquePaths(rows) {
  const map = new Map();

  for (const row of rows) {
    for (const item of interesting(row)) {
      if (!map.has(item.path)) {
        map.set(item.path, new Set());
      }

      const set = map.get(item.path);

      if (set.size < 8) {
        set.add(
          typeof item.value === 'string'
            ? item.value
            : JSON.stringify(item.value),
        );
      }
    }
  }

  return [...map.entries()]
    .map(([pathName, values]) => ({
      path: pathName,
      sampleValues: [...values],
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function summarizeArtifact(file) {
  const doc = readJson(file);
  const picked = candidateRows(doc);

  return {
    file: path.basename(file),
    version: doc.version ?? null,
    status: doc.status ?? null,
    rowArrayKey: picked.key,
    rowCount: picked.rows.length,
    topLevelKeys: Object.keys(doc),
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
        doc.counts?.factorStatusCounts ??
        null,
      factorReasonCounts:
        doc.factorReasonCounts ??
        doc.counts?.factorReasonCounts ??
        null,
    },
    discoveredPaths: uniquePaths(picked.rows),
    rows: picked.rows.map((row) => ({
      identity: identity(row),
      directKeys: Object.keys(row),
      canonicalPreviewKeys:
        row.canonicalPreview &&
        typeof row.canonicalPreview === 'object'
          ? Object.keys(row.canonicalPreview)
          : [],
      interestingPaths: interesting(row),
    })),
  };
}

function main() {
  const root = path.resolve(__dirname, '..');

  const files = {
    common63: path.join(
      root,
      'logs',
      'opendart-corporate-action-field-extraction-v9-9-6-3-common-stock-scope.json',
    ),
    common7: path.join(
      root,
      'logs',
      'opendart-corporate-action-market-effective-date-v9-9-7-common-stock-scope.json',
    ),
    common72: path.join(
      root,
      'logs',
      'opendart-corporate-action-effective-date-finalization-v9-9-7-2-common-stock-scope.json',
    ),
    common8: path.join(
      root,
      'logs',
      'opendart-corporate-action-factor-validation-v9-9-8-common-stock-scope.json',
    ),
  };

  for (const file of Object.values(files)) {
    if (!fs.existsSync(file)) {
      throw new Error(
        `INPUT_NOT_FOUND:${path.basename(file)}`,
      );
    }
  }

  const report = {
    status:
      'V9_9_8_COMMON_STOCK_RESULT_SHAPE_PROBE_V2_COMPLETE',
    version: VERSION,
    artifacts: Object.fromEntries(
      Object.entries(files).map(
        ([name, file]) => [
          name,
          summarizeArtifact(file),
        ],
      ),
    ),
    safety: {
      networkRequests: 0,
      databaseReads: 0,
      databaseWrites: 0,
    },
    outputFile:
      'logs/opendart-corporate-action-v9-9-8-common-stock-shape-probe-v2.json',
  };

  const outputFile = path.join(
    root,
    report.outputFile,
  );

  atomicSaveJson(outputFile, report);

  const common8 =
    report.artifacts.common8;

  const row032080 =
    common8.rows.find(
      (row) =>
        row.identity.stockCode === '032080',
    ) ?? null;

  const factorLikePaths =
    common8.discoveredPaths.filter(
      (row) =>
        /factor|status|reason/i.test(row.path),
    );

  const dateRatioPaths =
    common8.discoveredPaths.filter(
      (row) =>
        /effective|ratio/i.test(row.path),
    );

  console.log(
    JSON.stringify(
      {
        status:
          report.status,
        version:
          report.version,

        common8: {
          version:
            common8.version,
          status:
            common8.status,
          rowArrayKey:
            common8.rowArrayKey,
          rowCount:
            common8.rowCount,
          topLevelCounts:
            common8.topLevelCounts,
        },

        factorLikePaths,

        dateRatioPaths,

        stock032080:
          row032080
            ? {
                identity:
                  row032080.identity,
                directKeys:
                  row032080.directKeys,
                canonicalPreviewKeys:
                  row032080.canonicalPreviewKeys,
                interestingPaths:
                  row032080.interestingPaths,
              }
            : null,

        fullOutputFile:
          report.outputFile,

        networkRequests:
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
          'V9_9_8_COMMON_STOCK_RESULT_SHAPE_PROBE_V2_FAILED',
        version:
          VERSION,
        error:
          String(error?.message ?? error),
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
