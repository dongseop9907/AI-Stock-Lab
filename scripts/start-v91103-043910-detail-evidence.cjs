#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * Prepare + run V9.11.3 detail evidence collector.
 *
 * Source:
 *   scripts/v9903.cjs
 *
 * Scope:
 *   2026-10-06 single correction MERGER candidate
 *   043910 / 자연과환경 / receipt 20261006000033
 *
 * Policy:
 * - Preserve proven V9.8.3/V9.9.3 business logic.
 * - Change only version/input/output/cache lineage to V9.11.3.
 * - Fetch official OpenDART detail evidence.
 * - No production DB writes.
 * - Do NOT use --refresh.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const INSTALLER_VERSION =
  'V9_11_3_2026_10_06_DETAIL_EVIDENCE_INSTALL_AND_RUN';

const EXPECTED_WORKSET_VERSION =
  'V9_11_2_INCREMENTAL_CORPORATE_ACTION_DETAIL_WORKSET';

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
    'v9903.cjs',
  );

  const generatedScript = path.join(
    root,
    'scripts',
    'v91103.cjs',
  );

  const inputFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-detail-workset-v9-11-2.json',
  );

  const reconFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-workset-carryforward-reconciliation-v9-11-2-1.json',
  );

  const outputFile = path.join(
    root,
    'logs',
    'opendart-corporate-action-detail-evidence-v9-11-3.json',
  );

  assert(
    fs.existsSync(sourceScript),
    'SOURCE_SCRIPT_NOT_FOUND:scripts/v9903.cjs',
  );

  assert(
    fs.existsSync(inputFile),
    'WORKSET_NOT_FOUND',
  );

  assert(
    fs.existsSync(reconFile),
    'RECONCILIATION_NOT_FOUND',
  );

  const workset = readJson(inputFile);
  const recon = readJson(reconFile);

  assert(
    workset.status === 'DETAIL_WORKSET_READY',
    `WORKSET_STATUS_INVALID:${workset.status}`,
  );

  assert(
    workset.version === EXPECTED_WORKSET_VERSION,
    `WORKSET_VERSION_INVALID:${workset.version}`,
  );

  assert(
    recon.status === 'WORKSET_CARRY_FORWARD_RECONCILIATION_READY',
    `RECON_STATUS_INVALID:${recon.status}`,
  );

  assert(
    recon.conclusion?.candidateTouchesExistingCarryForward === true,
    'EXPECTED_EXISTING_CARRY_FORWARD_OVERLAP',
  );

  assert(
    recon.conclusion?.safeToFetchDetailEvidence === true,
    'DETAIL_EVIDENCE_NOT_SAFE',
  );

  const rows = Array.isArray(workset.detailFetchQueue)
    ? workset.detailFetchQueue
    : [];

  assert(
    rows.length === 1,
    `EXPECTED_1_DETAIL_ROW_GOT_${rows.length}`,
  );

  const row = rows[0];

  assert(
    String(row.stockCode ?? '').padStart(6, '0') === TARGET.stockCode,
    `TARGET_STOCK_MISMATCH:${row.stockCode}`,
  );

  assert(
    String(row.receiptNo ?? '') === TARGET.receiptNo,
    `TARGET_RECEIPT_MISMATCH:${row.receiptNo}`,
  );

  assert(
    String(row.actionType ?? '').toUpperCase() === TARGET.actionType,
    `TARGET_ACTION_MISMATCH:${row.actionType}`,
  );

  assert(
    row.correction === true,
    'TARGET_MUST_BE_CORRECTION',
  );

  assert(
    row.needsChainLookup === true,
    'TARGET_MUST_REQUIRE_CHAIN_LOOKUP',
  );

  let source = fs
    .readFileSync(sourceScript, 'utf8')
    .replace(/^\uFEFF/, '');

  const shebangIndex = source.indexOf('#!/usr/bin/env node');
  if (shebangIndex >= 0) {
    source = source.slice(shebangIndex);
  }

  const before = source;

  source = source
    .replaceAll(
      'V9_8_3_OPENDART_INCREMENTAL_DETAIL_EVIDENCE_COLLECTOR',
      'V9_11_3_OPENDART_INCREMENTAL_DETAIL_EVIDENCE_COLLECTOR',
    )
    .replaceAll(
      'V9_8_2_INCREMENTAL_CORPORATE_ACTION_DETAIL_WORKSET',
      'V9_11_2_INCREMENTAL_CORPORATE_ACTION_DETAIL_WORKSET',
    )
    .replaceAll(
      'opendart-corporate-action-detail-workset-v9-8-2.json',
      'opendart-corporate-action-detail-workset-v9-11-2.json',
    )
    .replaceAll(
      'opendart-corporate-action-detail-evidence-v9-8-3.json',
      'opendart-corporate-action-detail-evidence-v9-11-3.json',
    )
    .replaceAll(
      'v9-9-3-dart-documents',
      'v9-11-3-dart-documents',
    )
    .replaceAll(
      'v9-9-3-dart-structured',
      'v9-11-3-dart-structured',
    )
    .replaceAll(
      'v9-8-3-dart-documents',
      'v9-11-3-dart-documents',
    )
    .replaceAll(
      'v9-8-3-dart-structured',
      'v9-11-3-dart-structured',
    );

  assert(
    source !== before,
    'V9_11_3_LINEAGE_PATCH_DID_NOT_CHANGE_SOURCE',
  );

  assert(
    !source.includes(
      "'V9_8_3_OPENDART_INCREMENTAL_DETAIL_EVIDENCE_COLLECTOR'",
    ),
    'STALE_OUTPUT_VERSION_REMAINS',
  );

  assert(
    !source.includes(
      "'V9_8_2_INCREMENTAL_CORPORATE_ACTION_DETAIL_WORKSET'",
    ),
    'STALE_INPUT_VERSION_REMAINS',
  );

  atomicWrite(generatedScript, source);

  console.log(
    JSON.stringify(
      {
        status: 'V9_11_3_DETAIL_EVIDENCE_SCRIPT_READY',
        version: INSTALLER_VERSION,
        target: TARGET,
        generatedScript: 'scripts/v91103.cjs',
        inputFile:
          'logs/opendart-corporate-action-detail-workset-v9-11-2.json',
        outputFile:
          'logs/opendart-corporate-action-detail-evidence-v9-11-3.json',
        cacheDirectories: [
          'logs/v9-11-3-dart-documents',
          'logs/v9-11-3-dart-structured',
        ],
        safety: {
          refresh: false,
          productionDbWritesExpected: 0,
          canonicalIdentityAssignment: false,
          factorMutation: false,
        },
        nextAction: 'FETCH_OFFICIAL_OPENDART_DETAIL_EVIDENCE',
      },
      null,
      2,
    ),
  );

  const child = spawnSync(
    process.execPath,
    [
      '--env-file=.env.local',
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
        status: 'V9_11_3_DETAIL_EVIDENCE_INSTALL_OR_RUN_FAILED',
        version: INSTALLER_VERSION,
        error: String(error?.message ?? error),
        productionDbWrites: 0,
        canonicalIdentityAssignment: false,
      },
      null,
      2,
    ),
  );

  process.exitCode = 2;
}
