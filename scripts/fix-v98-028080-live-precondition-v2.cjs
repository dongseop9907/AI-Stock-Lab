#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * Fix and resume 028080 LIVE DB precondition V2.
 *
 * Root cause:
 * corporate_action_adjustment_runs has:
 *   started_at, finished_at, error_message
 * but NOT created_at.
 *
 * This patcher changes ONLY the run-table timestamp/error projection
 * and the corresponding sanitizeRun output.
 *
 * It then executes the generated V2 immediately.
 *
 * No DB writes are introduced.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const VERSION =
  'V9_8_028080_LIVE_PRECONDITION_V2_RUN_SCHEMA_FIELD_FIX_PATCHER';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function replaceOnce(source, from, to, label) {
  const first = source.indexOf(from);

  assert(
    first >= 0,
    `PATCH_TARGET_NOT_FOUND:${label}`,
  );

  const second = source.indexOf(
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
      'v98-028080-live-precondition-before-patch.cjs',
    );

  const outputFile =
    path.join(
      root,
      'scripts',
      'v98-028080-live-precondition-before-patch-v2.cjs',
    );

  assert(
    fs.existsSync(inputFile),
    'INPUT_LIVE_PRECONDITION_SCRIPT_NOT_FOUND',
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
      source.slice(shebangIndex);
  }

  source =
    replaceOnce(
      source,
      `'V9_8_028080_LIVE_DB_PRECONDITION_RECHECK_BEFORE_CONTROLLED_PHYSICAL_PATCH'`,
      `'V9_8_028080_LIVE_DB_PRECONDITION_RECHECK_V2_RUN_SCHEMA_FIELD_FIX_BEFORE_CONTROLLED_PHYSICAL_PATCH'`,
      'VERSION',
    );

  const oldRunSelect = `  const runSelect = encodeURIComponent([
    'id',
    'stock_code',
    'version',
    'status',
    'event_count',
    'supported_event_count',
    'unsupported_event_count',
    'factor_count',
    'summary',
    'is_validation',
    'production_applied',
    'created_at',
  ].join(','));`;

  const newRunSelect = `  const runSelect = encodeURIComponent([
    'id',
    'stock_code',
    'version',
    'status',
    'event_count',
    'supported_event_count',
    'unsupported_event_count',
    'factor_count',
    'summary',
    'is_validation',
    'production_applied',
    'started_at',
    'finished_at',
    'error_message',
  ].join(','));`;

  source =
    replaceOnce(
      source,
      oldRunSelect,
      newRunSelect,
      'RUN_SELECT_SCHEMA',
    );

  const oldSanitizeTail = `    is_validation: row.is_validation,
    production_applied: row.production_applied,
    created_at: row.created_at,
  };
}`;

  const newSanitizeTail = `    is_validation: row.is_validation,
    production_applied: row.production_applied,
    started_at: row.started_at,
    finished_at: row.finished_at,
    error_message: row.error_message,
  };
}`;

  // sanitizeEvent also has created_at; make sure we patch the LAST occurrence
  // corresponding to sanitizeRun, not the event serializer.
  const lastIndex =
    source.lastIndexOf(oldSanitizeTail);

  assert(
    lastIndex >= 0,
    'PATCH_TARGET_NOT_FOUND:SANITIZE_RUN_SCHEMA',
  );

  source =
    source.slice(0, lastIndex) +
    newSanitizeTail +
    source.slice(
      lastIndex + oldSanitizeTail.length,
    );

  source =
    replaceOnce(
      source,
      `'logs/opendart-corporate-action-028080-live-precondition-before-physical-patch.json'`,
      `'logs/opendart-corporate-action-028080-live-precondition-before-physical-patch-v2.json'`,
      'REPORT_OUTPUT_DISPLAY_PATH',
    );

  // The physical path declaration uses only the basename string, so patch it too.
  source =
    replaceOnce(
      source,
      `'opendart-corporate-action-028080-live-precondition-before-physical-patch.json'`,
      `'opendart-corporate-action-028080-live-precondition-before-physical-patch-v2.json'`,
      'REPORT_PHYSICAL_OUTPUT_PATH',
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
          'V9_8_028080_LIVE_PRECONDITION_V2_RUN_SCHEMA_FIELD_FIX_READY',

        version:
          VERSION,

        outputScript:
          'scripts/v98-028080-live-precondition-before-patch-v2.cjs',

        fix: {
          table:
            'corporate_action_adjustment_runs',

          removedColumn:
            'created_at',

          addedColumns: [
            'started_at',
            'finished_at',
            'error_message',
          ],
        },

        semanticPolicyRelaxed:
          false,

        databaseWrites:
          0,

        nextAction:
          'EXECUTE_LIVE_PRECONDITION_V2',
      },
      null,
      2,
    ),
  );

  const child =
    spawnSync(
      process.execPath,
      [
        '--env-file=.env.local',
        outputFile,
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
          'V9_8_028080_LIVE_PRECONDITION_V2_RUN_SCHEMA_FIELD_FIX_FAILED',

        version:
          VERSION,

        error:
          String(
            error?.message ??
            error,
          ),

        databaseWrites:
          0,

        physical028080PatchExecuted:
          false,
      },
      null,
      2,
    ),
  );

  process.exitCode = 2;
}
