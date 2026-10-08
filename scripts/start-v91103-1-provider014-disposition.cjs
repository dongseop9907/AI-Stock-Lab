#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * Prepare + run V9.11.3.1 provider-014 evidence disposition.
 *
 * Source:
 *   scripts/v9803-1.cjs
 *
 * Input:
 *   logs/opendart-corporate-action-detail-evidence-v9-11-3.json
 *
 * Output:
 *   logs/opendart-corporate-action-detail-evidence-v9-11-3-1.json
 *
 * Policy:
 * - Preserve proven provider-014 disposition logic.
 * - No network.
 * - No DB writes.
 * - No retry of identical document.xml request.
 * - Correction candidate must remain non-canonical until chain resolution.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const INSTALLER_VERSION =
  'V9_11_3_1_PROVIDER_014_DISPOSITION_INSTALL_AND_RUN';

const TARGET = Object.freeze({
  stockCode: '043910',
  receiptNo: '20261006000033',
  actionType: 'MERGER',
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''),
  );
}

function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, file);
}

function main() {
  const root = path.resolve(__dirname, '..');

  const sourceScript = path.join(
    root,
    'scripts',
    'v9803-1.cjs',
  );

  const generatedScript = path.join(
    root,
    'scripts',
    'v91103-1.cjs',
  );

  const inputFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-detail-evidence-v9-11-3.json',
  );

  const outputFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-detail-evidence-v9-11-3-1.json',
  );

  assert(
    fs.existsSync(sourceScript),
    'SOURCE_SCRIPT_NOT_FOUND:scripts/v9803-1.cjs',
  );

  assert(
    fs.existsSync(inputFile),
    'V9_11_3_EVIDENCE_NOT_FOUND',
  );

  const input = readJson(inputFile);

  assert(
    input.version ===
      'V9_11_3_OPENDART_INCREMENTAL_DETAIL_EVIDENCE_COLLECTOR',
    `INPUT_VERSION_INVALID:${input.version}`,
  );

  assert(
    input.status ===
      'DETAIL_EVIDENCE_COMPLETE_WITH_FAILURES',
    `INPUT_STATUS_INVALID:${input.status}`,
  );

  assert(
    Array.isArray(input.results) &&
      input.results.length === 1,
    `EXPECTED_1_RESULT_GOT_${
      Array.isArray(input.results)
        ? input.results.length
        : 'NOT_ARRAY'
    }`,
  );

  const row = input.results[0];
  const work = row.workItem ?? row.work ?? row;

  const stockCode = String(
    work.stockCode ??
    row.stockCode ??
    '',
  ).padStart(6, '0');

  const receiptNo = String(
    work.receiptNo ??
    row.receiptNo ??
    '',
  );

  const actionType = String(
    work.actionType ??
    row.actionType ??
    '',
  ).toUpperCase();

  assert(
    stockCode === TARGET.stockCode,
    `TARGET_STOCK_MISMATCH:${stockCode}`,
  );

  assert(
    receiptNo === TARGET.receiptNo,
    `TARGET_RECEIPT_MISMATCH:${receiptNo}`,
  );

  assert(
    actionType === TARGET.actionType,
    `TARGET_ACTION_MISMATCH:${actionType}`,
  );

  assert(
    row.document?.status ===
      'DOCUMENT_SOURCE_UNAVAILABLE',
    `EXPECTED_DOCUMENT_SOURCE_UNAVAILABLE_GOT_${row.document?.status}`,
  );

  assert(
    row.structured?.status ===
      'STRUCTURED_DATA_RECEIVED',
    `EXPECTED_STRUCTURED_DATA_RECEIVED_GOT_${row.structured?.status}`,
  );

  let source = fs
    .readFileSync(sourceScript, 'utf8')
    .replace(/^\uFEFF/, '');

  const shebangIndex =
    source.indexOf('#!/usr/bin/env node');

  if (shebangIndex >= 0) {
    source = source.slice(shebangIndex);
  }

  const before = source;

  source = source
    .replaceAll(
      'V9_8_3_1_OPENDART_PROVIDER_014_EVIDENCE_DISPOSITION',
      'V9_11_3_1_OPENDART_PROVIDER_014_EVIDENCE_DISPOSITION',
    )
    .replaceAll(
      'V9_8_3_OPENDART_INCREMENTAL_DETAIL_EVIDENCE_COLLECTOR',
      'V9_11_3_OPENDART_INCREMENTAL_DETAIL_EVIDENCE_COLLECTOR',
    )
    .replaceAll(
      'opendart-corporate-action-detail-evidence-v9-8-3.json',
      'opendart-corporate-action-detail-evidence-v9-11-3.json',
    )
    .replaceAll(
      'opendart-corporate-action-detail-evidence-v9-8-3-1.json',
      'opendart-corporate-action-detail-evidence-v9-11-3-1.json',
    )
    .replaceAll(
      'V9_8_3_INPUT_VERSION_MISMATCH',
      'V9_11_3_INPUT_VERSION_MISMATCH',
    )
    .replaceAll(
      'V9_8_3_RESULTS_MISSING',
      'V9_11_3_RESULTS_MISSING',
    );

  assert(
    source !== before,
    'LINEAGE_PATCH_DID_NOT_CHANGE_SOURCE',
  );

  assert(
    !source.includes(
      "'V9_8_3_1_OPENDART_PROVIDER_014_EVIDENCE_DISPOSITION'",
    ),
    'STALE_DISPOSITION_VERSION_REMAINS',
  );

  assert(
    !source.includes(
      "'V9_8_3_OPENDART_INCREMENTAL_DETAIL_EVIDENCE_COLLECTOR'",
    ),
    'STALE_INPUT_VERSION_REMAINS',
  );

  atomicWrite(generatedScript, source);

  console.log(
    JSON.stringify(
      {
        status:
          'V9_11_3_1_PROVIDER_014_DISPOSITION_SCRIPT_READY',
        version: INSTALLER_VERSION,
        target: TARGET,
        inputEvidence: {
          status: input.status,
          documentStatus: row.document?.status ?? null,
          documentProviderStatus:
            row.document?.providerStatus ?? null,
          structuredStatus:
            row.structured?.status ?? null,
          exactStructuredReceiptMatch:
            row.structured?.exactReceiptMatch ?? null,
        },
        generatedScript:
          'scripts/v91103-1.cjs',
        outputFile:
          'logs/opendart-corporate-action-detail-evidence-v9-11-3-1.json',
        safety: {
          networkRequests: 0,
          retrySameDocumentReceipt: false,
          databaseWrites: 0,
          canonicalization: false,
        },
        nextAction:
          'CLASSIFY_PROVIDER_014_AND_BUILD_CHAIN_RESOLUTION_QUEUE',
      },
      null,
      2,
    ),
  );

  const child = spawnSync(
    process.execPath,
    [
      generatedScript,
      `--input=${inputFile}`,
      `--output=${outputFile}`,
    ],
    {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
    },
  );

  if (child.error) {
    throw child.error;
  }

  if (child.status !== 0) {
    process.exitCode = child.status ?? 2;
  }
}

try {
  main();
} catch (error) {
  console.error(
    JSON.stringify(
      {
        status:
          'V9_11_3_1_PROVIDER_014_DISPOSITION_INSTALL_OR_RUN_FAILED',
        version: INSTALLER_VERSION,
        error: String(error?.message ?? error),
        networkRequests: 0,
        databaseWrites: 0,
      },
      null,
      2,
    ),
  );

  process.exitCode = 2;
}
