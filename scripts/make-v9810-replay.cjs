#!/usr/bin/env node
'use strict';

/**
 * Build V9.8.10 replay from preserved historical implementation.
 *
 * Preserves all cumulative-factor preview logic from scripts/v9810.cjs.
 * Only updates:
 * - VERSION
 * - FACTOR_INPUT_VERSION
 * - AUDIT_INPUT_VERSION
 * - default factor input path
 * - default audit input path
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
  'v9810.cjs',
);

const outputFile = path.join(
  __dirname,
  'v9810-replay.cjs',
);

const VERSION =
  'V9_8_10_REPLAY_SINGLE_EVENT_CUMULATIVE_FACTOR_PREVIEW';

const FACTOR_INPUT_VERSION =
  'V9_8_8_REPLAY_PER_EVENT_FACTOR_REFERENCE_VALIDATION';

const AUDIT_INPUT_VERSION =
  'V9_8_9_REPLAY_PER_STOCK_MULTI_EVENT_ORDERING_COLLISION_AUDIT';

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
  /const VERSION\s*=\s*'V9_8_10_SINGLE_EVENT_CUMULATIVE_FACTOR_PREVIEW';/,
  `const VERSION =\n  '${VERSION}';`,
  'VERSION',
);

src = replaceOnce(
  src,
  /const FACTOR_INPUT_VERSION\s*=\s*'V9_8_8_PER_EVENT_FACTOR_REFERENCE_VALIDATION';/,
  `const FACTOR_INPUT_VERSION =\n  '${FACTOR_INPUT_VERSION}';`,
  'FACTOR_INPUT_VERSION',
);

src = replaceOnce(
  src,
  /const AUDIT_INPUT_VERSION\s*=\s*'V9_8_9_PER_STOCK_MULTI_EVENT_ORDERING_COLLISION_AUDIT';/,
  `const AUDIT_INPUT_VERSION =\n  '${AUDIT_INPUT_VERSION}';`,
  'AUDIT_INPUT_VERSION',
);

const replacements = [
  [
    'opendart-corporate-action-factor-validation-v9-8-8.json',
    'opendart-corporate-action-factor-validation-v9-8-8-replay.json',
    'FACTOR_INPUT_PATH',
  ],
  [
    'opendart-corporate-action-multi-event-audit-v9-8-9.json',
    'opendart-corporate-action-multi-event-audit-v9-8-9-replay.json',
    'AUDIT_INPUT_PATH',
  ],
  [
    'opendart-corporate-action-cumulative-factor-preview-v9-8-10.json',
    'opendart-corporate-action-cumulative-factor-preview-v9-8-10-replay.json',
    'OUTPUT_PATH',
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
        'V9_8_10_REPLAY_BUILT',

      versions: {
        replay:
          VERSION,
        factorInput:
          FACTOR_INPUT_VERSION,
        auditInput:
          AUDIT_INPUT_VERSION,
      },

      defaultInputs: {
        factor:
          'logs/opendart-corporate-action-factor-validation-v9-8-8-replay.json',
        audit:
          'logs/opendart-corporate-action-multi-event-audit-v9-8-9-replay.json',
      },

      output:
        'logs/opendart-corporate-action-cumulative-factor-preview-v9-8-10-replay.json',

      script:
        'scripts/v9810-replay.cjs',

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
