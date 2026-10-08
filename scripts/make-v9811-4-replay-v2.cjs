#!/usr/bin/env node
'use strict';

/**
 * Build V9.8.11.4 replay v2 from preserved corrected preflight.
 *
 * Source:
 *   scripts/v9811-4.cjs
 *
 * Replay lineage:
 *   V9.8.10.3 replay v3
 *     -> V9.8.11.4 replay v2
 *
 * Changes only:
 * - VERSION
 * - INPUT_VERSION
 * - default input artifact
 * - default output artifact
 *
 * Preserved:
 * - corrected production row contract
 * - current DB overlap discovery
 * - Supabase READ-only behavior
 * - no DB writes / no production apply
 */

const fs = require('node:fs');
const path = require('node:path');

const sourceFile = path.join(
  __dirname,
  'v9811-4.cjs',
);

const outputFile = path.join(
  __dirname,
  'v9811-4-replay-v2.cjs',
);

const VERSION =
  'V9_8_11_4_REPLAY_V2_CORRECTED_PRODUCTION_CANONICAL_EVENT_PREFLIGHT_FROM_V9_8_10_3_REPLAY_V3';

const INPUT_VERSION =
  'V9_8_10_3_REPLAY_V3_TARGETED_STRUCTURAL_FALSE_SAFE_DATE_CORRECTION';

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
  /const VERSION\s*=\s*[\r\n\s]*'V9_8_11_4_CORRECTED_PRODUCTION_CANONICAL_EVENT_PREFLIGHT';/,
  `const VERSION =\n  '${VERSION}';`,
  'VERSION',
);

src = replaceOnce(
  src,
  /const INPUT_VERSION\s*=\s*[\r\n\s]*'V9_8_10_3_STRUCTURAL_CANONICAL_DATE_FINALIZATION_PREVIEW';/,
  `const INPUT_VERSION =\n  '${INPUT_VERSION}';`,
  'INPUT_VERSION',
);

const inputOld =
  'opendart-corporate-action-structural-date-finalization-v9-8-10-3.json';

const inputNew =
  'opendart-corporate-action-structural-date-finalization-v9-8-10-3-replay-v3.json';

const outputOld =
  'opendart-corporate-action-production-event-preflight-v9-8-11-4.json';

const outputNew =
  'opendart-corporate-action-production-event-preflight-v9-8-11-4-replay-v2.json';

if (!src.includes(inputOld)) {
  throw new Error(
    'INPUT_PATH_MARKER_NOT_FOUND',
  );
}

if (!src.includes(outputOld)) {
  throw new Error(
    'OUTPUT_PATH_MARKER_NOT_FOUND',
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
        'V9_8_11_4_REPLAY_V2_BUILT',

      version:
        VERSION,

      inputVersion:
        INPUT_VERSION,

      input:
        'logs/opendart-corporate-action-structural-date-finalization-v9-8-10-3-replay-v3.json',

      output:
        'logs/opendart-corporate-action-production-event-preflight-v9-8-11-4-replay-v2.json',

      script:
        'scripts/v9811-4-replay-v2.cjs',

      expectedBatchContract: {
        totalCanonicalIdentities: 159,
        persistableNow: 158,
        factorSupported: 121,
        structuralBlocked: 37,
        futurePending: 1,
      },

      correctedTarget: {
        providerEventId:
          '20260807000649',
        stockCode:
          '003580',
        effectiveDate:
          '2026-10-12',
      },

      safety: {
        supabaseReadsPreserved: true,
        databaseWrites: 0,
        productionApplied: false,
        canonicalEventsInserted: 0,
      },
    },
    null,
    2,
  ),
);
