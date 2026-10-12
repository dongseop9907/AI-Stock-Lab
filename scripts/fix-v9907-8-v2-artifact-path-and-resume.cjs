#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * Repair the V9.9.7/7.2/8 replay V2 artifact path and continue to V9.9.9/10.
 *
 * The corrected V2 audit passed, but its physical save path remained the V1
 * filename while report.outputFile said "...replay-v2.json".
 *
 * This script:
 * 1) reads the actual saved V1-path artifact,
 * 2) verifies it is really the PASSED V2 report,
 * 3) writes an identical copy to the intended V2 filename,
 * 4) runs v9909-10-common-stock-replay-reuse-audit.cjs automatically.
 *
 * No network.
 * No DB reads/writes.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const VERSION =
  'V9_9_7_7_2_8_REPLAY_V2_ARTIFACT_PATH_REPAIR_AND_V9_9_9_10_RESUME';

const EXPECTED_VERSION =
  'V9_9_7_7_2_8_REPLAY_V2_COMMON_STOCK_EFFECTIVE_DATE_FACTOR_REUSE_AUDIT';

const EXPECTED_STATUS =
  'HISTORICAL_V9_9_7_7_2_8_COMMON_STOCK_EFFECTIVE_DATE_FACTOR_RESULTS_REUSABLE';

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''),
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
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

function main() {
  const root =
    path.resolve(__dirname, '..');

  const actualSavedFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-effective-date-factor-reuse-v9-9-7-7-2-8-common-stock-replay.json',
    );

  const intendedV2File =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-effective-date-factor-reuse-v9-9-7-7-2-8-common-stock-replay-v2.json',
    );

  const nextScript =
    path.join(
      root,
      'scripts',
      'v9909-10-common-stock-replay-reuse-audit.cjs',
    );

  assert(
    fs.existsSync(actualSavedFile),
    'ACTUAL_V2_REPORT_AT_V1_PATH_NOT_FOUND',
  );

  assert(
    fs.existsSync(nextScript),
    'V9_9_9_10_REUSE_AUDIT_SCRIPT_NOT_FOUND',
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
    Number(report.counts?.issues ?? -1) === 0,
    `SOURCE_REPORT_HAS_ISSUES:${report.counts?.issues}`,
  );

  assert(
    report.conclusion
      ?.historicalV998FactorValidationReusable === true,
    'V9_9_8_REUSE_NOT_PROVEN',
  );

  assert(
    report.conclusion
      ?.safeToAdvanceToHistoricalV999_10ReuseAudit === true,
    'V9_9_9_10_ADVANCE_NOT_ALLOWED',
  );

  // Keep the report content/fingerprint untouched. This is a path repair only.
  atomicSaveJson(
    intendedV2File,
    report,
  );

  console.log(
    JSON.stringify(
      {
        status:
          'V9_9_7_7_2_8_REPLAY_V2_ARTIFACT_PATH_REPAIRED',

        version:
          VERSION,

        sourcePhysicalFile:
          'logs/opendart-corporate-action-effective-date-factor-reuse-v9-9-7-7-2-8-common-stock-replay.json',

        repairedPhysicalFile:
          'logs/opendart-corporate-action-effective-date-factor-reuse-v9-9-7-7-2-8-common-stock-replay-v2.json',

        reportVersion:
          report.version,

        reportStatus:
          report.status,

        reportIssues:
          report.counts?.issues ?? null,

        reportContentModified:
          false,

        databaseWrites:
          0,

        networkRequests:
          0,

        nextAction:
          'EXECUTE_V9_9_9_10_REUSE_AUDIT',
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
          'V9_9_7_7_2_8_REPLAY_V2_ARTIFACT_PATH_REPAIR_FAILED',

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

        productionApplied:
          false,
      },
      null,
      2,
    ),
  );

  process.exitCode = 2;
}
