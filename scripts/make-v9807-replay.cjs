#!/usr/bin/env node
'use strict';

/**
 * Build V9.8.7 replay from preserved historical implementation.
 *
 * Preserves all market effective-date resolution logic from scripts/v9807.cjs.
 * Only updates:
 * - VERSION
 * - INPUT_VERSION
 * - default input path
 * - default output path
 *
 * Important:
 * - market calendar read remains the original read-only Supabase query
 * - no DB writes are introduced
 * - provider-014 fallback schedule remains non-promotable in this stage
 *
 * Safety:
 * - read-only network behavior preserved from v9807.cjs
 * - no DB writes
 * - no production mutation
 */

const fs = require('node:fs');
const path = require('node:path');

const sourceFile = path.join(
  __dirname,
  'v9807.cjs',
);

const outputFile = path.join(
  __dirname,
  'v9807-replay.cjs',
);

const VERSION =
  'V9_8_7_REPLAY_MARKET_EFFECTIVE_DATE_RESOLUTION';

const INPUT_VERSION =
  'V9_8_6_3_REPLAY_REMAINING_REVERSE_SPLIT_RECOVERY';

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
  /const VERSION\s*=\s*'V9_8_7_MARKET_EFFECTIVE_DATE_RESOLUTION';/,
  `const VERSION =\n  '${VERSION}';`,
  'VERSION',
);

src = replaceOnce(
  src,
  /const INPUT_VERSION\s*=\s*'V9_8_6_3_REMAINING_REVERSE_SPLIT_RECOVERY';/,
  `const INPUT_VERSION =\n  '${INPUT_VERSION}';`,
  'INPUT_VERSION',
);

const inputOld =
  'opendart-corporate-action-field-extraction-v9-8-6-3.json';

const inputNew =
  'opendart-corporate-action-field-extraction-v9-8-6-3-replay.json';

const outputOld =
  'opendart-corporate-action-market-effective-date-v9-8-7.json';

const outputNew =
  'opendart-corporate-action-market-effective-date-v9-8-7-replay.json';

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
        'V9_8_7_REPLAY_BUILT',

      versions: {
        replay:
          VERSION,
        input:
          INPUT_VERSION,
      },

      defaultInput:
        'logs/opendart-corporate-action-field-extraction-v9-8-6-3-replay.json',

      output:
        'logs/opendart-corporate-action-market-effective-date-v9-8-7-replay.json',

      script:
        'scripts/v9807-replay.cjs',

      preservedPolicy: {
        cashDividend:
          'LATEST_KRX_TRADING_DATE_STRICTLY_BEFORE_RECORD_DATE',
        splitReverseSplit:
          'FINAL_CANONICAL_DART_SOURCE_EFFECTIVE_DATE',
        provider014Fallback:
          'DO_NOT_PROMOTE_REQUIRE_INDEPENDENT_MARKET_VERIFICATION',
        structural:
          'NO_GENERIC_EFFECTIVE_DATE_PROMOTION',
      },

      safety: {
        databaseWrites: 0,
        productionApplied: false,
      },
    },
    null,
    2,
  ),
);
