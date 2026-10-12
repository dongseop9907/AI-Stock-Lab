#!/usr/bin/env node
'use strict';

/**
 * Build V9.8.8 replay from preserved historical implementation.
 *
 * Preserves all factor/reference-price validation logic from scripts/v9808.cjs.
 * Only updates:
 * - VERSION
 * - INPUT_VERSION
 * - default input path
 * - default output path
 *
 * Original behavior preserved:
 * - ratio factors computed locally
 * - cash-dividend reference bars read read-only from Supabase market_daily_bars
 * - no DB writes
 * - no factor persistence
 * - no mutation of canonical adjusted bars
 */

const fs = require('node:fs');
const path = require('node:path');

const sourceFile = path.join(
  __dirname,
  'v9808.cjs',
);

const outputFile = path.join(
  __dirname,
  'v9808-replay.cjs',
);

const VERSION =
  'V9_8_8_REPLAY_PER_EVENT_FACTOR_REFERENCE_VALIDATION';

const INPUT_VERSION =
  'V9_8_7_2_REPLAY_EFFECTIVE_DATE_FINALIZATION_AFTER_KIS_SUSPENSION_REVIEW';

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
  /const VERSION\s*=\s*'V9_8_8_PER_EVENT_FACTOR_REFERENCE_VALIDATION';/,
  `const VERSION =\n  '${VERSION}';`,
  'VERSION',
);

src = replaceOnce(
  src,
  /const INPUT_VERSION\s*=\s*'V9_8_7_2_EFFECTIVE_DATE_FINALIZATION_AFTER_KIS_SUSPENSION_REVIEW';/,
  `const INPUT_VERSION =\n  '${INPUT_VERSION}';`,
  'INPUT_VERSION',
);

const inputOld =
  'opendart-corporate-action-market-effective-date-v9-8-7-2.json';

const inputNew =
  'opendart-corporate-action-market-effective-date-v9-8-7-2-replay.json';

const outputOld =
  'opendart-corporate-action-factor-validation-v9-8-8.json';

const outputNew =
  'opendart-corporate-action-factor-validation-v9-8-8-replay.json';

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
        'V9_8_8_REPLAY_BUILT',

      versions: {
        replay:
          VERSION,
        input:
          INPUT_VERSION,
      },

      defaultInput:
        'logs/opendart-corporate-action-market-effective-date-v9-8-7-2-replay.json',

      output:
        'logs/opendart-corporate-action-factor-validation-v9-8-8-replay.json',

      script:
        'scripts/v9808-replay.cjs',

      preservedPolicy: {
        ratioFactor:
          'PRICE_RATIO_FROM_OVER_TO_SHARE_RATIO_TO_OVER_FROM',
        cashFactor:
          'LATEST_MARKET_CLOSE_STRICTLY_BEFORE_EFFECTIVE_DATE',
        cashReferenceBar:
          'REQUIRE_CANONICAL_ADJUSTED_PRICE_TRUE',
        canonicalBars:
          'DO_NOT_APPLY_FACTOR_TO_ALREADY_ADJUSTED_MARKET_DAILY_BARS',
        structural:
          'NO_GENERIC_FACTOR',
      },

      safety: {
        readOnlyMarketDataReadsPreserved: true,
        databaseWrites: 0,
        productionApplied: false,
      },
    },
    null,
    2,
  ),
);
