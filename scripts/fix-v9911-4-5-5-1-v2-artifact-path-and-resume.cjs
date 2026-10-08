#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * Repair V9.9.11.4/5/5.1 replay V2 artifact path and resume 11.7/8.1 audit.
 *
 * The V2 audit passed, but its physical output path remained the original
 * "...common-stock-replay.json" while report.outputFile advertised
 * "...common-stock-replay-v2.json".
 *
 * This script:
 * 1) reads the actual saved report at the old physical path,
 * 2) verifies it is the PASSED V2 report,
 * 3) copies the exact report to the intended V2 path,
 * 4) executes v9911-7-8-1-common-stock-replay-reuse-audit.cjs.
 *
 * No network.
 * No DB reads/writes.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const VERSION =
  'V9_9_11_4_5_5_1_REPLAY_V2_ARTIFACT_PATH_REPAIR_AND_11_7_8_1_RESUME';

const EXPECTED_VERSION =
  'V9_9_11_4_5_5_1_REPLAY_V2_DEFERRED_EFFECTIVE_DATE_FIELD_PATH_AWARE_COMMON_STOCK_REUSE_AUDIT';

const EXPECTED_STATUS =
  'HISTORICAL_V9_9_11_4_5_5_1_COMMON_STOCK_PREFLIGHT_DRYRUN_SNAPSHOT_RESULTS_REUSABLE_AFTER_EFFECTIVE_DATE_FIELD_PATH_FIX';

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''),
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function atomicSaveJson(file, value) {
  fs.mkdirSync(
    path.dirname(file),
    { recursive: true },
  );

  const tmp =
    `${file}.tmp-${process.pid}-${Date.now()}`;

  fs.writeFileSync(
    tmp,
    JSON.stringify(value, null, 2) + '\n',
    'utf8',
  );

  fs.renameSync(
    tmp,
    file,
  );
}

function main() {
  const root =
    path.resolve(__dirname, '..');

  const actualSavedFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-preflight-dryrun-snapshot-reuse-v9-9-11-4-5-5-1-common-stock-replay.json',
    );

  const intendedV2File =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-preflight-dryrun-snapshot-reuse-v9-9-11-4-5-5-1-common-stock-replay-v2.json',
    );

  const nextScript =
    path.join(
      root,
      'scripts',
      'v9911-7-8-1-common-stock-replay-reuse-audit.cjs',
    );

  assert(
    fs.existsSync(actualSavedFile),
    'PASSED_V2_REPORT_AT_OLD_PHYSICAL_PATH_NOT_FOUND',
  );

  assert(
    fs.existsSync(nextScript),
    'V9_9_11_7_8_1_REUSE_AUDIT_SCRIPT_NOT_FOUND',
  );

  const report =
    readJson(actualSavedFile);

  assert(
    report.version === EXPECTED_VERSION,
    `SOURCE_REPORT_VERSION_MISMATCH:${report.version}`,
  );

  assert(
    report.status === EXPECTED_STATUS,
    `SOURCE_REPORT_STATUS_MISMATCH:${report.status}`,
  );

  assert(
    Array.isArray(report.issues) &&
      report.issues.length === 0,
    `SOURCE_REPORT_HAS_ISSUES:${report.issues?.length ?? 'UNKNOWN'}`,
  );

  assert(
    report.conclusion
      ?.historicalV9911_4PreflightReusable === true,
    'V9_9_11_4_REUSE_NOT_PROVEN',
  );

  assert(
    report.conclusion
      ?.historicalV9911_5DryRunReusable === true,
    'V9_9_11_5_REUSE_NOT_PROVEN',
  );

  assert(
    report.conclusion
      ?.historicalV9911_5_1SnapshotEligibilityReusable === true,
    'V9_9_11_5_1_REUSE_NOT_PROVEN',
  );

  assert(
    report.conclusion
      ?.safeToAdvanceToHistoricalV9_9_11_7_8ReadOnlyPostPersistenceReuseAudit ===
      true,
    'V9_9_11_7_8_ADVANCE_NOT_ALLOWED',
  );

  assert(
    report.eligibility1151
      ?.eligibleInsertRows === 2,
    `ELIGIBLE_INSERT_ROWS_MISMATCH:${report.eligibility1151?.eligibleInsertRows}`,
  );

  assert(
    report.eligibility1151
      ?.deferredFutureStructuralRows === 3,
    `DEFERRED_STRUCTURAL_ROWS_MISMATCH:${report.eligibility1151?.deferredFutureStructuralRows}`,
  );

  // Path-only repair. Do not alter report semantics or fingerprint.
  atomicSaveJson(
    intendedV2File,
    report,
  );

  console.log(
    JSON.stringify(
      {
        status:
          'V9_9_11_4_5_5_1_REPLAY_V2_ARTIFACT_PATH_REPAIRED',

        version:
          VERSION,

        sourcePhysicalFile:
          'logs/opendart-corporate-action-preflight-dryrun-snapshot-reuse-v9-9-11-4-5-5-1-common-stock-replay.json',

        repairedPhysicalFile:
          'logs/opendart-corporate-action-preflight-dryrun-snapshot-reuse-v9-9-11-4-5-5-1-common-stock-replay-v2.json',

        reportVersion:
          report.version,

        reportStatus:
          report.status,

        reportIssues:
          report.issues.length,

        eligibleInsertRows:
          report.eligibility1151
            ?.eligibleInsertRows,

        deferredFutureStructuralRows:
          report.eligibility1151
            ?.deferredFutureStructuralRows,

        reportContentModified:
          false,

        historicalV9911_6ApplyExecuted:
          false,

        networkRequests:
          0,

        databaseReads:
          0,

        databaseWrites:
          0,

        nextAction:
          'EXECUTE_V9_9_11_7_8_1_REUSE_AUDIT',
      },
      null,
      2,
    ),
  );

  const child =
    spawnSync(
      process.execPath,
      [nextScript],
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
    process.exitCode =
      child.status ?? 2;
  }
}

try {
  main();
} catch (error) {
  console.error(
    JSON.stringify(
      {
        status:
          'V9_9_11_4_5_5_1_REPLAY_V2_ARTIFACT_PATH_REPAIR_FAILED',

        version:
          VERSION,

        error:
          String(
            error?.message ??
            error,
          ),

        historicalV9911_6ApplyExecuted:
          false,

        networkRequests:
          0,

        databaseReads:
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
