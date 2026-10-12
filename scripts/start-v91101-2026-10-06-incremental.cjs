#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * Prepare + run V9.11.1 incremental inventory for 2026-10-06.
 *
 * Source of truth:
 *   scripts/v91001.cjs
 *
 * Policy:
 * - Preserve V9.10.1 business logic.
 * - Change only explicit version/output lineage from V9.10.1 -> V9.11.1.
 * - Force start/through = 2026-10-06.
 * - No --refresh.
 * - Inventory stage remains read-only with respect to production canonical data.
 *
 * Generated:
 *   scripts/v91101.cjs
 *
 * Output:
 *   logs/opendart-corporate-action-incremental-v9-11-1.json
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const VERSION =
  'V9_11_1_2026_10_06_INCREMENTAL_INVENTORY_INSTALL_AND_RUN';

const RUN_DATE = '2026-10-06';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, file);
}

function main() {
  const root = path.resolve(__dirname, '..');

  const inputFile = path.join(
    root,
    'scripts',
    'v91001.cjs',
  );

  const outputScript = path.join(
    root,
    'scripts',
    'v91101.cjs',
  );

  const outputLog = path.join(
    root,
    'logs',
    'opendart-corporate-action-incremental-v9-11-1.json',
  );

  assert(
    fs.existsSync(inputFile),
    'INPUT_SCRIPT_NOT_FOUND:scripts/v91001.cjs',
  );

  let source = fs
    .readFileSync(inputFile, 'utf8')
    .replace(/^\uFEFF/, '');

  // Preserve shebang as first line if present.
  const shebangIndex = source.indexOf('#!/usr/bin/env node');
  if (shebangIndex >= 0) {
    source = source.slice(shebangIndex);
  }

  const before = source;

  // Version lineage only.
  source = source
    .replaceAll('V9_10_1', 'V9_11_1')
    .replaceAll('V9.10.1', 'V9.11.1')
    .replaceAll('v9-10-1', 'v9-11-1');

  assert(
    source !== before,
    'VERSION_LINEAGE_PATCH_DID_NOT_CHANGE_SOURCE',
  );

  // Fail if stale executable lineage remains.
  assert(
    !source.includes(
      "'V9_10_1_INCREMENTAL_OPENDART_CORPORATE_ACTION_INVENTORY'",
    ),
    'STALE_VERSION_CONSTANT_REMAINS',
  );

  // Do not accidentally enable refresh.
  assert(
    !process.argv.includes('--refresh'),
    'REFRESH_NOT_ALLOWED_IN_INSTALLER',
  );

  atomicWrite(
    outputScript,
    source,
  );

  console.log(
    JSON.stringify(
      {
        status:
          'V9_11_1_INCREMENTAL_INVENTORY_SCRIPT_READY',

        version: VERSION,

        generatedScript:
          'scripts/v91101.cjs',

        runDate:
          RUN_DATE,

        outputFile:
          'logs/opendart-corporate-action-incremental-v9-11-1.json',

        policy: {
          businessLogic:
            'PRESERVE_V9_10_1',

          versionLineage:
            'V9_11_1',

          refresh:
            false,

          productionWriteIntent:
            false,
        },

        nextAction:
          'EXECUTE_V9_11_1_FOR_2026_10_06',
      },
      null,
      2,
    ),
  );

  const child = spawnSync(
    process.execPath,
    [
      '--env-file=.env.local',
      outputScript,
      `--start=${RUN_DATE}`,
      `--through=${RUN_DATE}`,
      `--output=${outputLog}`,
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
          'V9_11_1_INCREMENTAL_INVENTORY_INSTALL_OR_RUN_FAILED',

        version: VERSION,

        error:
          String(error?.message ?? error),

        runDate:
          RUN_DATE,

        refreshUsed:
          false,

        physicalRepairWrites:
          0,
      },
      null,
      2,
    ),
  );

  process.exitCode = 2;
}
