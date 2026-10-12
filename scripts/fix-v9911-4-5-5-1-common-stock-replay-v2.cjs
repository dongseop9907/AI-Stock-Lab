#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * Fix V9.9.11.4 / 11.5 / 11.5.1 reuse audit V2
 *
 * V1 false blocker:
 * deferredFutureStructuralRows stores effectiveDate (camelCase),
 * while V1 validated only row.effective_date.
 *
 * This patcher:
 * - reads the original V1 audit script,
 * - changes ONLY deferred structural date lookup to support
 *   effective_date OR effectiveDate,
 * - writes a V2 audit script,
 * - executes V2 immediately.
 *
 * No network.
 * No DB reads/writes.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const VERSION =
  'V9_9_11_4_5_5_1_REPLAY_V2_DEFERRED_EFFECTIVE_DATE_FIELD_PATH_FIX_PATCHER';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function replaceOnce(source, from, to, label) {
  const first =
    source.indexOf(from);

  assert(
    first >= 0,
    `PATCH_TARGET_NOT_FOUND:${label}`,
  );

  const second =
    source.indexOf(
      from,
      first + from.length,
    );

  assert(
    second === -1,
    `PATCH_TARGET_NOT_UNIQUE:${label}`,
  );

  return (
    source.slice(0, first) +
    to +
    source.slice(first + from.length)
  );
}

function atomicWrite(file, content) {
  fs.mkdirSync(
    path.dirname(file),
    { recursive: true },
  );

  const tmp =
    `${file}.tmp-${process.pid}-${Date.now()}`;

  fs.writeFileSync(
    tmp,
    content,
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

  const inputFile =
    path.join(
      root,
      'scripts',
      'v9911-4-5-5-1-common-stock-replay-reuse-audit.cjs',
    );

  const outputFile =
    path.join(
      root,
      'scripts',
      'v9911-4-5-5-1-common-stock-replay-reuse-audit-v2.cjs',
    );

  assert(
    fs.existsSync(inputFile),
    'INPUT_AUDIT_SCRIPT_NOT_FOUND',
  );

  let source =
    fs.readFileSync(
      inputFile,
      'utf8',
    ).replace(/^\uFEFF/, '');

  // Keep shebang first if present.
  const shebangIndex =
    source.indexOf(
      '#!/usr/bin/env node',
    );

  if (shebangIndex >= 0) {
    source =
      source.slice(
        shebangIndex,
      );
  }

  source =
    replaceOnce(
      source,
      `'V9_9_11_4_5_5_1_REPLAY_READ_ONLY_COMMON_STOCK_PREFLIGHT_DRYRUN_SNAPSHOT_REUSE_AUDIT'`,
      `'V9_9_11_4_5_5_1_REPLAY_V2_DEFERRED_EFFECTIVE_DATE_FIELD_PATH_AWARE_COMMON_STOCK_REUSE_AUDIT'`,
      'VERSION',
    );

  const oldBlock = `  for (
    const row
    of deferredFutureStructuralRows
  ) {
    if (
      !isIsoDate(
        row.effective_date,
      )
    ) {
      issues.push({
        check:
          'eligibility1151.deferredStructuralEffectiveDate',
        row,
      });
    } else if (
      row.effective_date <=
      SNAPSHOT_AS_OF
    ) {
      issues.push({
        check:
          'eligibility1151.deferredStructuralMustBeFuture',
        row,
        snapshotAsOf:
          SNAPSHOT_AS_OF,
      });
    }
  }`;

  const newBlock = `  for (
    const row
    of deferredFutureStructuralRows
  ) {
    const deferredEffectiveDate =
      firstNonEmpty(
        row.effective_date,
        row.effectiveDate,
      );

    if (
      !isIsoDate(
        deferredEffectiveDate,
      )
    ) {
      issues.push({
        check:
          'eligibility1151.deferredStructuralEffectiveDate',
        row,
        resolvedEffectiveDate:
          deferredEffectiveDate,
      });
    } else if (
      String(
        deferredEffectiveDate,
      ) <=
      SNAPSHOT_AS_OF
    ) {
      issues.push({
        check:
          'eligibility1151.deferredStructuralMustBeFuture',
        row,
        resolvedEffectiveDate:
          deferredEffectiveDate,
        snapshotAsOf:
          SNAPSHOT_AS_OF,
      });
    }
  }`;

  source =
    replaceOnce(
      source,
      oldBlock,
      newBlock,
      'DEFERRED_EFFECTIVE_DATE_FIELD_PATH',
    );

  source =
    replaceOnce(
      source,
      `'HISTORICAL_V9_9_11_4_5_5_1_COMMON_STOCK_PREFLIGHT_DRYRUN_SNAPSHOT_RESULTS_REUSABLE'`,
      `'HISTORICAL_V9_9_11_4_5_5_1_COMMON_STOCK_PREFLIGHT_DRYRUN_SNAPSHOT_RESULTS_REUSABLE_AFTER_EFFECTIVE_DATE_FIELD_PATH_FIX'`,
      'SUCCESS_STATUS',
    );

  source =
    replaceOnce(
      source,
      `'logs/opendart-corporate-action-preflight-dryrun-snapshot-reuse-v9-9-11-4-5-5-1-common-stock-replay.json'`,
      `'logs/opendart-corporate-action-preflight-dryrun-snapshot-reuse-v9-9-11-4-5-5-1-common-stock-replay-v2.json'`,
      'REPORT_OUTPUT_PATH',
    );

  assert(
    !source.startsWith('#!') ||
      source.startsWith('#!/usr/bin/env node'),
    'SHEBANG_INVALID',
  );

  atomicWrite(
    outputFile,
    source,
  );

  console.log(
    JSON.stringify(
      {
        status:
          'V9_9_11_4_5_5_1_REPLAY_V2_FIELD_PATH_FIX_READY',

        version:
          VERSION,

        outputScript:
          'scripts/v9911-4-5-5-1-common-stock-replay-reuse-audit-v2.cjs',

        fix:
          'deferredFutureStructuralRows effective_date OR effectiveDate',

        semanticPolicyRelaxed:
          false,

        networkRequests:
          0,

        databaseWrites:
          0,

        nextAction:
          'EXECUTE_V2_AUDIT',
      },
      null,
      2,
    ),
  );

  const child =
    spawnSync(
      process.execPath,
      [outputFile],
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
          'V9_9_11_4_5_5_1_REPLAY_V2_FIELD_PATH_FIX_FAILED',

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
