#!/usr/bin/env node
'use strict';

/**
 * Build V9.8.5.1 replay from the preserved historical implementation.
 *
 * The original business logic is NOT rewritten.
 * We only:
 * 1) copy scripts/v9805-1.cjs
 * 2) update version guards to the repaired replay lineage
 * 3) update default source/chain/precision/final-precision/output paths
 *
 * Safety:
 * - no network
 * - no DB
 * - no production writes
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

const sourceFile = path.join(
  __dirname,
  'v9805-1.cjs',
);

const outputFile = path.join(
  __dirname,
  'v9805-1-replay.cjs',
);

const VERSION =
  'V9_8_5_1_REPLAY_WITHDRAWAL_CONTROL_ACCOUNTING_FIX';

const SOURCE_VERSION =
  'V9_8_5_REPLAY_V2_FROM_V9_8_4_3_CANONICAL_CHAIN_COLLAPSE_SOURCE_SELECTION';

const CHAIN_VERSION =
  'V9_8_4_3_REPLAY_CHAIN_VIEW';

const PRECISION_VERSION =
  'V9_8_4_3_REPLAY_PRECISION_VIEW';

const FINAL_PRECISION_VERSION =
  'V9_8_4_3_REPLAY_FINAL_PRECISION_VIEW_V2';

function replaceOnce(source, regex, replacement, label) {
  const flags = regex.flags.includes('g')
    ? regex.flags
    : regex.flags + 'g';

  const matches =
    source.match(
      new RegExp(
        regex.source,
        flags,
      ),
    ) ?? [];

  if (matches.length !== 1) {
    throw new Error(
      `${label}_MATCH_COUNT:${matches.length}`,
    );
  }

  return source.replace(
    regex,
    replacement,
  );
}

let src =
  fs.readFileSync(
    sourceFile,
    'utf8',
  );

src = replaceOnce(
  src,
  /const VERSION\s*=\s*'V9_8_5_1_WITHDRAWAL_CONTROL_ACCOUNTING_FIX';/,
  `const VERSION =\n  '${VERSION}';`,
  'VERSION',
);

src = replaceOnce(
  src,
  /const SOURCE_VERSION\s*=\s*'V9_8_5_CANONICAL_CHAIN_COLLAPSE_SOURCE_SELECTION';/,
  `const SOURCE_VERSION =\n  '${SOURCE_VERSION}';`,
  'SOURCE_VERSION',
);

src = replaceOnce(
  src,
  /const CHAIN_VERSION\s*=\s*'V9_8_4_OPENDART_CORRECTION_WITHDRAWAL_CHAIN_RESOLVER';/,
  `const CHAIN_VERSION =\n  '${CHAIN_VERSION}';`,
  'CHAIN_VERSION',
);

src = replaceOnce(
  src,
  /const PRECISION_VERSION\s*=\s*'V9_8_4_1_PRECISION_CORRECTION_CHAIN_RESOLVER';/,
  `const PRECISION_VERSION =\n  '${PRECISION_VERSION}';`,
  'PRECISION_VERSION',
);

src = replaceOnce(
  src,
  /const FINAL_PRECISION_VERSION\s*=\s*'V9_8_4_2_FINAL_PRECISION_CHAIN_RESOLVER';/,
  `const FINAL_PRECISION_VERSION =\n  '${FINAL_PRECISION_VERSION}';`,
  'FINAL_PRECISION_VERSION',
);

/*
 * Patch historical DEFAULT paths in the copied replay script.
 * CLI overrides remain available if the original parser supports them.
 */
const replacements = [
  [
    /opendart-corporate-action-canonical-source-selection-v9-8-5\.json/g,
    'opendart-corporate-action-canonical-source-selection-v9-8-5-replay-v2.json',
    'SOURCE_DEFAULT',
  ],
  [
    /opendart-corporate-action-chain-resolution-v9-8-4\.json/g,
    'v9805-replay-chain-view.json',
    'CHAIN_DEFAULT',
  ],
  [
    /opendart-corporate-action-chain-resolution-v9-8-4-1\.json/g,
    'v9805-replay-precision-view.json',
    'PRECISION_DEFAULT',
  ],
  [
    /opendart-corporate-action-chain-resolution-v9-8-4-2\.json/g,
    'v9805-replay-final-precision-view-v2.json',
    'FINAL_PRECISION_DEFAULT',
  ],
  [
    /opendart-corporate-action-canonical-source-selection-v9-8-5-1\.json/g,
    'opendart-corporate-action-canonical-source-selection-v9-8-5-1-replay.json',
    'OUTPUT_DEFAULT',
  ],
];

for (const [regex, replacement, label] of replacements) {
  const before = src;
  src = src.replace(
    regex,
    replacement,
  );

  if (src === before) {
    throw new Error(
      `${label}_PATH_MARKER_NOT_FOUND`,
    );
  }
}

fs.writeFileSync(
  outputFile,
  src,
  'utf8',
);

console.log(
  JSON.stringify(
    {
      status:
        'V9_8_5_1_REPLAY_BUILT',

      versions: {
        replay:
          VERSION,

        source:
          SOURCE_VERSION,

        chain:
          CHAIN_VERSION,

        precision:
          PRECISION_VERSION,

        finalPrecision:
          FINAL_PRECISION_VERSION,
      },

      defaultInputs: {
        source:
          'logs/opendart-corporate-action-canonical-source-selection-v9-8-5-replay-v2.json',

        chain:
          'logs/v9805-replay-chain-view.json',

        precision:
          'logs/v9805-replay-precision-view.json',

        finalPrecision:
          'logs/v9805-replay-final-precision-view-v2.json',
      },

      output:
        'logs/opendart-corporate-action-canonical-source-selection-v9-8-5-1-replay.json',

      script:
        'scripts/v9805-1-replay.cjs',

      safety: {
        networkRequests: 0,
        databaseWrites: 0,
        productionApplied: false,
      },
    },
    null,
    2,
  ),
);
