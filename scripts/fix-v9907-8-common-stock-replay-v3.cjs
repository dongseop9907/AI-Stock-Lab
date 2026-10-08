#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * Fix V9.9.7/7.2/8 replay V2 generation.
 *
 * Previous patcher prepended a comment before the shebang of the generated
 * .cjs file. Node requires "#!/usr/bin/env node" to be the first line.
 *
 * This patcher regenerates V2 directly from the original audit script and:
 * - keeps shebang at byte/line 1,
 * - applies only the previously proven field-path fixes,
 * - preserves all semantic/business guards,
 * - writes a distinct V2 output artifact,
 * - executes the corrected V2 automatically.
 *
 * No network.
 * No DB reads/writes.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PATCHER_VERSION =
  'V9_9_7_7_2_8_REPLAY_V3_SHEBANG_SAFE_FIELD_PATH_FIX_PATCHER';

const INPUT_VERSION =
  'V9_9_7_7_2_8_REPLAY_READ_ONLY_COMMON_STOCK_EFFECTIVE_DATE_FACTOR_REUSE_AUDIT';

const OUTPUT_VERSION =
  'V9_9_7_7_2_8_REPLAY_V2_COMMON_STOCK_EFFECTIVE_DATE_FACTOR_REUSE_AUDIT';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function replaceOnce(source, from, to, label) {
  const first = source.indexOf(from);

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
      'v9907-8-common-stock-replay-reuse-audit.cjs',
    );

  const outputFile =
    path.join(
      root,
      'scripts',
      'v9907-8-common-stock-replay-reuse-audit-v2.cjs',
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

  // Normalize the original so the generated script always starts with shebang.
  const shebangIndex =
    source.indexOf('#!/usr/bin/env node');

  assert(
    shebangIndex >= 0,
    'SOURCE_SHEBANG_NOT_FOUND',
  );

  if (shebangIndex > 0) {
    source =
      source.slice(shebangIndex);
  }

  source =
    replaceOnce(
      source,
      INPUT_VERSION,
      OUTPUT_VERSION,
      'VERSION',
    );

  const oldFactorStatus = `  const factorStatus =
    firstNonEmpty(
      row.factorStatus,
      row.factor_status,
      row.factor?.status,
      row.factorPreview?.status,
      row.factor_preview?.status,
      cp.metadata?.factor_status,
    );`;

  const newFactorStatus = `  const factorStatus =
    firstNonEmpty(
      row.factorValidation?.status,
      row.factor_validation?.status,
      row.factorStatus,
      row.factor_status,
      row.factor?.status,
      row.factorPreview?.status,
      row.factor_preview?.status,
      cp.metadata?.factor_status,
    );`;

  source =
    replaceOnce(
      source,
      oldFactorStatus,
      newFactorStatus,
      'FACTOR_STATUS_PATH',
    );

  const oldFactorReason = `  const factorReason =
    firstNonEmpty(
      row.factorReason,
      row.factor_reason,
      row.reason,
      row.factor?.reason,
      row.factorPreview?.reason,
      row.factor_preview?.reason,
    );`;

  const newFactorReason = `  const factorReason =
    firstNonEmpty(
      row.factorValidation?.reason,
      row.factor_validation?.reason,
      row.factorReason,
      row.factor_reason,
      row.reason,
      row.factor?.reason,
      row.factorPreview?.reason,
      row.factor_preview?.reason,
    );`;

  source =
    replaceOnce(
      source,
      oldFactorReason,
      newFactorReason,
      'FACTOR_REASON_PATH',
    );

  const oldResolutionStatus = `  const resolutionStatus =
    firstNonEmpty(
      row.resolution?.status,
      row.resolutionStatus,
      row.resolution_status,
    );`;

  const newResolutionStatus = `  const resolutionStatus =
    firstNonEmpty(
      row.effectiveDateResolution?.status,
      row.effective_date_resolution?.status,
      row.resolution?.status,
      row.resolutionStatus,
      row.resolution_status,
    );`;

  source =
    replaceOnce(
      source,
      oldResolutionStatus,
      newResolutionStatus,
      'RESOLUTION_STATUS_PATH',
    );

  const oldResolutionReason = `  const resolutionReason =
    firstNonEmpty(
      row.resolution?.reason,
      row.resolutionReason,
      row.resolution_reason,
    );`;

  const newResolutionReason = `  const resolutionReason =
    firstNonEmpty(
      row.effectiveDateResolution?.reason,
      row.effective_date_resolution?.reason,
      row.resolution?.reason,
      row.resolutionReason,
      row.resolution_reason,
    );`;

  source =
    replaceOnce(
      source,
      oldResolutionReason,
      newResolutionReason,
      'RESOLUTION_REASON_PATH',
    );

  source =
    replaceOnce(
      source,
      'logs/opendart-corporate-action-effective-date-factor-reuse-v9-9-7-7-2-8-common-stock-replay.json',
      'logs/opendart-corporate-action-effective-date-factor-reuse-v9-9-7-7-2-8-common-stock-replay-v2.json',
      'OUTPUT_ARTIFACT',
    );

  assert(
    source.startsWith('#!/usr/bin/env node'),
    'GENERATED_SCRIPT_SHEBANG_NOT_FIRST',
  );

  atomicWrite(
    outputFile,
    source,
  );

  console.log(
    JSON.stringify(
      {
        status:
          'V9_9_7_7_2_8_REPLAY_V2_SHEBANG_SAFE_SCRIPT_READY',

        version:
          PATCHER_VERSION,

        outputScript:
          'scripts/v9907-8-common-stock-replay-reuse-audit-v2.cjs',

        shebangFirstLine:
          true,

        fixes: [
          'factorValidation.status',
          'factorValidation.reason',
          'effectiveDateResolution.status',
          'effectiveDateResolution.reason',
        ],

        semanticPolicyRelaxed:
          false,

        networkRequests:
          0,

        databaseWrites:
          0,

        nextAction:
          'EXECUTE_CORRECTED_V2',
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
          'V9_9_7_7_2_8_REPLAY_V2_SHEBANG_SAFE_PATCH_FAILED',

        version:
          PATCHER_VERSION,

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
