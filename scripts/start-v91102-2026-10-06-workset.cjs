#!/usr/bin/env node
'use strict';

/**
 * AI Stock Lab
 * Prepare + run V9.11.2 detail workset for the 2026-10-06 inventory.
 *
 * Source:
 *   scripts/v91002.cjs
 *
 * Policy:
 * - Preserve V9.10.2 business logic.
 * - Change only version/input/output lineage to V9.11.x.
 * - Read-only: no network, no DB writes.
 *
 * Input:
 *   logs/opendart-corporate-action-incremental-v9-11-1.json
 *
 * Generated:
 *   scripts/v91102.cjs
 *
 * Output:
 *   logs/opendart-corporate-action-detail-workset-v9-11-2.json
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const VERSION =
  'V9_11_2_2026_10_06_DETAIL_WORKSET_INSTALL_AND_RUN';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const tmp =
    `${file}.tmp-${process.pid}-${Date.now()}`;

  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, file);
}

function main() {
  const root =
    path.resolve(__dirname, '..');

  const inputScript =
    path.join(
      root,
      'scripts',
      'v91002.cjs',
    );

  const outputScript =
    path.join(
      root,
      'scripts',
      'v91102.cjs',
    );

  const inventoryFile =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-incremental-v9-11-1.json',
    );

  const outputLog =
    path.join(
      root,
      'logs',
      'opendart-corporate-action-detail-workset-v9-11-2.json',
    );

  assert(
    fs.existsSync(inputScript),
    'INPUT_SCRIPT_NOT_FOUND:scripts/v91002.cjs',
  );

  assert(
    fs.existsSync(inventoryFile),
    'V9_11_1_INVENTORY_NOT_FOUND',
  );

  const inventory =
    JSON.parse(
      fs.readFileSync(
        inventoryFile,
        'utf8',
      ).replace(/^\uFEFF/, ''),
    );

  assert(
    inventory.status ===
      'INCREMENTAL_INVENTORY_COMPLETE',
    `INVENTORY_STATUS_INVALID:${inventory.status}`,
  );

  assert(
    inventory.version ===
      'V9_11_1_INCREMENTAL_OPENDART_CORPORATE_ACTION_INVENTORY',
    `INVENTORY_VERSION_INVALID:${inventory.version}`,
  );

  assert(
    inventory.startDate === '2026-10-06' &&
    inventory.throughDate === '2026-10-06',
    'INVENTORY_DATE_BOUNDARY_INVALID',
  );

  assert(
    Array.isArray(inventory.candidates) &&
    inventory.candidates.length === 1,
    `EXPECTED_1_CANDIDATE_GOT_${Array.isArray(inventory.candidates) ? inventory.candidates.length : 'NOT_ARRAY'}`,
  );

  let source =
    fs.readFileSync(
      inputScript,
      'utf8',
    ).replace(/^\uFEFF/, '');

  const shebangIndex =
    source.indexOf(
      '#!/usr/bin/env node',
    );

  if (shebangIndex >= 0) {
    source =
      source.slice(shebangIndex);
  }

  const before = source;

  // Exact lineage upgrade only.
  source = source
    .replaceAll(
      'V9_10_2_INCREMENTAL_CORPORATE_ACTION_DETAIL_WORKSET',
      'V9_11_2_INCREMENTAL_CORPORATE_ACTION_DETAIL_WORKSET',
    )
    .replaceAll(
      'V9_10_1_INCREMENTAL_OPENDART_CORPORATE_ACTION_INVENTORY',
      'V9_11_1_INCREMENTAL_OPENDART_CORPORATE_ACTION_INVENTORY',
    )
    .replaceAll(
      'opendart-corporate-action-incremental-v9-10-1.json',
      'opendart-corporate-action-incremental-v9-11-1.json',
    )
    .replaceAll(
      'opendart-corporate-action-detail-workset-v9-10-2.json',
      'opendart-corporate-action-detail-workset-v9-11-2.json',
    )
    .replaceAll(
      'V9.10.2',
      'V9.11.2',
    );

  assert(
    source !== before,
    'LINEAGE_PATCH_DID_NOT_CHANGE_SOURCE',
  );

  assert(
    !source.includes(
      "'V9_10_1_INCREMENTAL_OPENDART_CORPORATE_ACTION_INVENTORY'",
    ),
    'STALE_INPUT_VERSION_REMAINS',
  );

  assert(
    !source.includes(
      "'V9_10_2_INCREMENTAL_CORPORATE_ACTION_DETAIL_WORKSET'",
    ),
    'STALE_OUTPUT_VERSION_REMAINS',
  );

  atomicWrite(
    outputScript,
    source,
  );

  console.log(
    JSON.stringify(
      {
        status:
          'V9_11_2_DETAIL_WORKSET_SCRIPT_READY',

        version:
          VERSION,

        input: {
          file:
            'logs/opendart-corporate-action-incremental-v9-11-1.json',

          candidates:
            inventory.candidates.length,

          correctionOrWithdrawalCandidates:
            inventory.summary
              ?.correctionOrWithdrawalCandidates ??
            null,
        },

        generatedScript:
          'scripts/v91102.cjs',

        outputFile:
          'logs/opendart-corporate-action-detail-workset-v9-11-2.json',

        safety: {
          networkRequestsExpected:
            0,

          databaseWritesExpected:
            0,

          productionMutationIntent:
            false,
        },

        nextAction:
          'EXECUTE_V9_11_2_DETAIL_WORKSET',
      },
      null,
      2,
    ),
  );

  const child =
    spawnSync(
      process.execPath,
      [
        outputScript,
        `--input=${inventoryFile}`,
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
          'V9_11_2_DETAIL_WORKSET_INSTALL_OR_RUN_FAILED',

        version:
          VERSION,

        error:
          String(
            error?.message ??
            error,
          ),

        databaseWrites:
          0,

        productionMutationIntent:
          false,
      },
      null,
      2,
    ),
  );

  process.exitCode = 2;
}
