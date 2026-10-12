#!/usr/bin/env node
'use strict';

/**
 * Build a CORE7 viewer probe by reusing the exact legacy
 * V9.8.4.2 final-precision resolver implementation.
 *
 * This builder:
 * - reads the preserved legacy resolver source
 * - keeps all of its helper functions exactly as-is
 * - prevents the legacy main() from running
 * - injects a new read-only probe entrypoint that calls the original
 *   fetchDartViewerText() for the 13 relevant receipts
 *
 * Output:
 *   scripts/v9804-2-core7-legacy-viewer-probe.cjs
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

const sourceFile = path.join(
  __dirname,
  'v9804-2-final-precision-backup-20261005-172956.cjs',
);

const outputFile = path.join(
  __dirname,
  'v9804-2-core7-legacy-viewer-probe.cjs',
);

const source = fs.readFileSync(sourceFile, 'utf8');

const marker = '\nmain().catch(';
const markerIndex = source.lastIndexOf(marker);

if (markerIndex < 0) {
  throw new Error('LEGACY_MAIN_ENTRYPOINT_NOT_FOUND');
}

const prefix = source.slice(0, markerIndex);

const injected = String.raw`

async function runCore7LegacyViewerProbe() {
  const receiptNos = [
    '20260422900422',
    '20260518900970',
    '20260804900492',

    '20260814002642',
    '20260814002685',
    '20260814002795',
    '20260814002868',

    '20260818000018',
    '20260818000019',
    '20260818000020',
    '20260818000021',

    '20260826900706',
    '20260826900708',
  ];

  const cacheDir = path.join(
    root,
    'logs',
    'v9-8-4-2-evidence',
    'viewer-text',
  );

  const reportFile = path.join(
    root,
    'logs',
    'v9804-2-core7-legacy-viewer-probe.json',
  );

  fs.mkdirSync(cacheDir, {
    recursive: true,
  });

  const rows = [];
  let networkRequests = 0;

  for (let index = 0; index < receiptNos.length; index += 1) {
    const receiptNo = receiptNos[index];

    const result =
      await fetchDartViewerText(
        receiptNo,
      );

    const requestCount =
      1 +
      (Array.isArray(result.calls)
        ? result.calls.length
        : 0);

    networkRequests += requestCount;

    const cacheFile = path.join(
      cacheDir,
      receiptNo + '.txt',
    );

    if (
      result.status ===
        'DART_VIEWER_TEXT_RECEIVED' &&
      typeof result.text === 'string' &&
      result.text.trim()
    ) {
      fs.writeFileSync(
        cacheFile,
        result.text,
        'utf8',
      );
    }

    const row = {
      receiptNo,
      status:
        result.status ?? null,
      httpStatus:
        result.httpStatus ?? null,
      viewerNodeCount:
        Array.isArray(result.calls)
          ? result.calls.length
          : 0,
      charCount:
        typeof result.text === 'string'
          ? result.text.length
          : 0,
      cacheWritten:
        fs.existsSync(cacheFile),
      networkRequests:
        requestCount,
    };

    rows.push(row);

    console.log(
      [
        'LEGACY_VIEWER_PROBE',
        (index + 1) + '/' + receiptNos.length,
        'receipt=' + receiptNo,
        'status=' + row.status,
        'http=' + (row.httpStatus ?? '-'),
        'nodes=' + row.viewerNodeCount,
        'chars=' + row.charCount,
        'cache=' + row.cacheWritten,
        'requests=' + networkRequests,
      ].join(' '),
    );

    if (
      typeof REQUEST_DELAY_MS === 'number' &&
      REQUEST_DELAY_MS > 0 &&
      index + 1 < receiptNos.length
    ) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  const statusCounts =
    rows.reduce(
      (acc, row) => {
        const key =
          row.status ?? 'UNKNOWN';

        acc[key] =
          (acc[key] ?? 0) + 1;

        return acc;
      },
      {},
    );

  const report = {
    version:
      'V9_8_4_2_CORE7_LEGACY_VIEWER_PROBE',
    status:
      'CORE7_LEGACY_VIEWER_PROBE_COMPLETE',
    sourceImplementation:
      'V9_8_4_2_FINAL_PRECISION_CHAIN_RESOLVER.fetchDartViewerText',
    targetReceipts:
      receiptNos.length,
    textReceived:
      rows.filter(
        (row) =>
          row.status ===
          'DART_VIEWER_TEXT_RECEIVED',
      ).length,
    cacheWritten:
      rows.filter(
        (row) =>
          row.cacheWritten,
      ).length,
    networkRequests,
    databaseWrites: 0,
    productionApplied: false,
    statusCounts,
    rows,
  };

  fs.writeFileSync(
    reportFile,
    JSON.stringify(
      report,
      null,
      2,
    ),
    'utf8',
  );

  console.log(
    JSON.stringify(
      {
        status:
          report.status,
        targetReceipts:
          report.targetReceipts,
        textReceived:
          report.textReceived,
        cacheWritten:
          report.cacheWritten,
        networkRequests:
          report.networkRequests,
        databaseWrites: 0,
        productionApplied: false,
        statusCounts:
          report.statusCounts,
        outputFile:
          path
            .relative(
              root,
              reportFile,
            )
            .replaceAll('\\', '/'),
      },
      null,
      2,
    ),
  );
}

runCore7LegacyViewerProbe().catch(
  (error) => {
    console.error(
      '[CORE7 LEGACY VIEWER PROBE ERROR]',
      error?.stack ?? error,
    );
    process.exitCode = 1;
  },
);
`;

fs.writeFileSync(
  outputFile,
  prefix + injected,
  'utf8',
);

console.log(
  JSON.stringify(
    {
      status:
        'CORE7_LEGACY_VIEWER_PROBE_BUILT',
      sourceFile:
        path
          .relative(root, sourceFile)
          .replaceAll('\\', '/'),
      outputFile:
        path
          .relative(root, outputFile)
          .replaceAll('\\', '/'),
    },
    null,
    2,
  ),
);
