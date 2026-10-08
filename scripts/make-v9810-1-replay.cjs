#!/usr/bin/env node
'use strict';

/**
 * Build V9.8.10.1 replay from preserved historical implementation.
 *
 * Preserves all structural canonical-date audit logic from scripts/v9810-1.cjs.
 * Only updates:
 * - VERSION
 * - INPUT_VERSION
 * - default input path
 * - default output path
 *
 * Safety:
 * - no network
 * - no DB writes
 * - no production mutation
 */

const fs = require('node:fs');
const path = require('node:path');

const sourceFile = path.join(
  __dirname,
  'v9810-1.cjs',
);

const outputFile = path.join(
  __dirname,
  'v9810-1-replay.cjs',
);

const VERSION =
  'V9_8_10_1_REPLAY_STRUCTURAL_CANONICAL_DATE_AUDIT';

const INPUT_VERSION =
  'V9_8_8_REPLAY_PER_EVENT_FACTOR_REFERENCE_VALIDATION';

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
  /const VERSION\s*=\s*'V9_8_10_1_STRUCTURAL_CANONICAL_DATE_AUDIT';/,
  `const VERSION =\n  '${VERSION}';`,
  'VERSION',
);

src = replaceOnce(
  src,
  /const INPUT_VERSION\s*=\s*'V9_8_8_PER_EVENT_FACTOR_REFERENCE_VALIDATION';/,
  `const INPUT_VERSION =\n  '${INPUT_VERSION}';`,
  'INPUT_VERSION',
);

const inputOld =
  'opendart-corporate-action-factor-validation-v9-8-8.json';

const inputNew =
  'opendart-corporate-action-factor-validation-v9-8-8-replay.json';

const outputOld =
  'opendart-corporate-action-structural-date-audit-v9-8-10-1.json';

const outputNew =
  'opendart-corporate-action-structural-date-audit-v9-8-10-1-replay.json';

if (!src.includes(inputOld)) {
  throw new Error(
    'INPUT_DEFAULT_PATH_MARKER_NOT_FOUND',
  );
}

if (!src.includes(outputOld)) {
  throw new Error(
    'OUTPUT_DEFAULT_PATH_MARKER_NOT_FOUND',
  );
}

src = src.replaceAll(
  inputOld,
  inputNew,
);

src = src.replaceAll(
  outputOld,
  outputNew,
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
        'V9_8_10_1_REPLAY_BUILT',

      versions: {
        replay:
          VERSION,
        input:
          INPUT_VERSION,
      },

      defaultInput:
        'logs/opendart-corporate-action-factor-validation-v9-8-8-replay.json',

      output:
        'logs/opendart-corporate-action-structural-date-audit-v9-8-10-1-replay.json',

      script:
        'scripts/v9810-1-replay.cjs',

      expected: {
        structuralRows:
          37,
      },

      safety: {
        networkRequests:
          0,
        databaseWrites:
          0,
        productionApplied:
          false,
      },
    },
    null,
    2,
  ),
);
