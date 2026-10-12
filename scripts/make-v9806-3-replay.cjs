#!/usr/bin/env node
'use strict';

/**
 * Build V9.8.6.3 replay from preserved historical implementation.
 *
 * Preserves all recovery logic from scripts/v9806-3.cjs.
 * Only updates:
 * - VERSION
 * - INPUT_VERSION
 * - PROBE_VERSION
 * - default input/probe/output paths
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
  'v9806-3.cjs',
);

const outputFile = path.join(
  __dirname,
  'v9806-3-replay.cjs',
);

const VERSION =
  'V9_8_6_3_REPLAY_REMAINING_REVERSE_SPLIT_RECOVERY';

const INPUT_VERSION =
  'V9_8_6_1_REPLAY_PROVEN_XML_TEXT_NODE_FIELD_EXTRACTION';

const PROBE_VERSION =
  'V9_8_6_2_REPLAY_REMAINING_REVERSE_SPLIT_XML_STRUCTURE_PROBE';

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
  /const VERSION\s*=\s*'V9_8_6_3_REMAINING_REVERSE_SPLIT_RECOVERY';/,
  `const VERSION =\n  '${VERSION}';`,
  'VERSION',
);

src = replaceOnce(
  src,
  /const INPUT_VERSION\s*=\s*'V9_8_6_1_PROVEN_XML_TEXT_NODE_FIELD_EXTRACTION';/,
  `const INPUT_VERSION =\n  '${INPUT_VERSION}';`,
  'INPUT_VERSION',
);

src = replaceOnce(
  src,
  /const PROBE_VERSION\s*=\s*'V9_8_6_2_REMAINING_REVERSE_SPLIT_XML_STRUCTURE_PROBE';/,
  `const PROBE_VERSION =\n  '${PROBE_VERSION}';`,
  'PROBE_VERSION',
);

const replacements = [
  [
    'opendart-corporate-action-field-extraction-v9-8-6-1.json',
    'opendart-corporate-action-field-extraction-v9-8-6-1-replay.json',
    'INPUT_DEFAULT_PATH',
  ],
  [
    'opendart-corporate-action-reverse-split-probe-v9-8-6-2.json',
    'opendart-corporate-action-reverse-split-probe-v9-8-6-2-replay.json',
    'PROBE_DEFAULT_PATH',
  ],
  [
    'opendart-corporate-action-field-extraction-v9-8-6-3.json',
    'opendart-corporate-action-field-extraction-v9-8-6-3-replay.json',
    'OUTPUT_DEFAULT_PATH',
  ],
];

for (const [oldValue, newValue, label] of replacements) {
  if (!src.includes(oldValue)) {
    throw new Error(
      `${label}_MARKER_NOT_FOUND`,
    );
  }

  src = src.replaceAll(
    oldValue,
    newValue,
  );
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
        'V9_8_6_3_REPLAY_BUILT',

      versions: {
        replay:
          VERSION,
        input:
          INPUT_VERSION,
        probe:
          PROBE_VERSION,
      },

      defaultInputs: {
        input:
          'logs/opendart-corporate-action-field-extraction-v9-8-6-1-replay.json',
        probe:
          'logs/opendart-corporate-action-reverse-split-probe-v9-8-6-2-replay.json',
      },

      output:
        'logs/opendart-corporate-action-field-extraction-v9-8-6-3-replay.json',

      script:
        'scripts/v9806-3-replay.cjs',

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
