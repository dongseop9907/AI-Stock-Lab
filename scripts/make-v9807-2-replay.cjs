#!/usr/bin/env node
'use strict';

/**
 * Build V9.8.7.2 replay from preserved historical implementation.
 *
 * Preserves all finalization logic from scripts/v9807-2.cjs.
 *
 * Replay lineage changes only:
 * - VERSION
 * - INPUT_VERSION
 * - default V9.8.7 input path
 * - default V9.8.7.2 output path
 *
 * IMPORTANT:
 * - Reuse the existing independent KIS probe artifact unchanged:
 *     logs/opendart-corporate-action-kis-boundary-probe-v9-8-7-1.json
 * - Keep KIS_PROBE_VERSION unchanged because the probe itself is not being replayed.
 * - Keep historical AS_OF_DATE = 2026-10-01 unchanged for deterministic lineage replay.
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
  'v9807-2.cjs',
);

const outputFile = path.join(
  __dirname,
  'v9807-2-replay.cjs',
);

const VERSION =
  'V9_8_7_2_REPLAY_EFFECTIVE_DATE_FINALIZATION_AFTER_KIS_SUSPENSION_REVIEW';

const INPUT_VERSION =
  'V9_8_7_REPLAY_MARKET_EFFECTIVE_DATE_RESOLUTION';

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
  /const VERSION\s*=\s*'V9_8_7_2_EFFECTIVE_DATE_FINALIZATION_AFTER_KIS_SUSPENSION_REVIEW';/,
  `const VERSION =\n  '${VERSION}';`,
  'VERSION',
);

src = replaceOnce(
  src,
  /const INPUT_VERSION\s*=\s*'V9_8_7_MARKET_EFFECTIVE_DATE_RESOLUTION';/,
  `const INPUT_VERSION =\n  '${INPUT_VERSION}';`,
  'INPUT_VERSION',
);

const inputOld =
  'opendart-corporate-action-market-effective-date-v9-8-7.json';

const inputNew =
  'opendart-corporate-action-market-effective-date-v9-8-7-replay.json';

const outputOld =
  'opendart-corporate-action-market-effective-date-v9-8-7-2.json';

const outputNew =
  'opendart-corporate-action-market-effective-date-v9-8-7-2-replay.json';

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
        'V9_8_7_2_REPLAY_BUILT',

      versions: {
        replay:
          VERSION,
        input:
          INPUT_VERSION,
        reusedKisProbe:
          'V9_8_7_1_KIS_REVERSE_SPLIT_BOUNDARY_PROBE',
      },

      defaultInputs: {
        input:
          'logs/opendart-corporate-action-market-effective-date-v9-8-7-replay.json',
        kisProbe:
          'logs/opendart-corporate-action-kis-boundary-probe-v9-8-7-1.json',
      },

      historicalReplayPolicy: {
        asOfDate:
          '2026-10-01',
        kisProbeReusedWithoutRerun:
          true,
        canvasEffectiveDate:
          '2026-06-12',
        futureDividendRecordDate:
          '2026-10-13',
      },

      output:
        'logs/opendart-corporate-action-market-effective-date-v9-8-7-2-replay.json',

      script:
        'scripts/v9807-2-replay.cjs',

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
