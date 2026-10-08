#!/usr/bin/env node
'use strict';

/**
 * Build V9.8.6 replay from the preserved historical implementation.
 *
 * Preserves all extraction logic from scripts/v9806.cjs.
 * Only updates:
 * - VERSION
 * - SOURCE_VERSION
 * - default source path
 * - default output path
 *
 * Evidence input remains the historical V9.8.3.1 artifact.
 *
 * Safety:
 * - no network
 * - no DB
 * - no production writes
 */

const fs = require('node:fs');
const path = require('node:path');

const sourceFile = path.join(
  __dirname,
  'v9806.cjs',
);

const outputFile = path.join(
  __dirname,
  'v9806-replay.cjs',
);

const VERSION =
  'V9_8_6_REPLAY_CANONICAL_CORPORATE_ACTION_FIELD_EXTRACTION';

const SOURCE_VERSION =
  'V9_8_5_1_REPLAY_WITHDRAWAL_CONTROL_ACCOUNTING_FIX';

function replaceOnce(source, regex, replacement, label) {
  const flags = regex.flags.includes('g')
    ? regex.flags
    : regex.flags + 'g';

  const matches =
    source.match(
      new RegExp(regex.source, flags),
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
  /const VERSION\s*=\s*'V9_8_6_CANONICAL_CORPORATE_ACTION_FIELD_EXTRACTION';/,
  `const VERSION =\n  '${VERSION}';`,
  'VERSION',
);

src = replaceOnce(
  src,
  /const SOURCE_VERSION\s*=\s*'V9_8_5_1_WITHDRAWAL_CONTROL_ACCOUNTING_FIX';/,
  `const SOURCE_VERSION =\n  '${SOURCE_VERSION}';`,
  'SOURCE_VERSION',
);

const sourcePathOld =
  'opendart-corporate-action-canonical-source-selection-v9-8-5-1.json';

const sourcePathNew =
  'opendart-corporate-action-canonical-source-selection-v9-8-5-1-replay.json';

const outputPathOld =
  'opendart-corporate-action-field-extraction-v9-8-6.json';

const outputPathNew =
  'opendart-corporate-action-field-extraction-v9-8-6-replay.json';

if (!src.includes(sourcePathOld)) {
  throw new Error(
    'SOURCE_DEFAULT_PATH_MARKER_NOT_FOUND',
  );
}

if (!src.includes(outputPathOld)) {
  throw new Error(
    'OUTPUT_DEFAULT_PATH_MARKER_NOT_FOUND',
  );
}

src = src.replaceAll(
  sourcePathOld,
  sourcePathNew,
);

src = src.replaceAll(
  outputPathOld,
  outputPathNew,
);

fs.writeFileSync(
  outputFile,
  src,
  'utf8',
);

console.log(
  JSON.stringify(
    {
      status:
        'V9_8_6_REPLAY_BUILT',

      versions: {
        replay:
          VERSION,
        source:
          SOURCE_VERSION,
        evidence:
          'V9_8_3_1_OPENDART_PROVIDER_014_EVIDENCE_DISPOSITION',
      },

      defaultInputs: {
        source:
          'logs/opendart-corporate-action-canonical-source-selection-v9-8-5-1-replay.json',
        evidence:
          'logs/opendart-corporate-action-detail-evidence-v9-8-3-1.json',
      },

      output:
        'logs/opendart-corporate-action-field-extraction-v9-8-6-replay.json',

      script:
        'scripts/v9806-replay.cjs',

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
