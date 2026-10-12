#!/usr/bin/env node
'use strict';

/**
 * Build V9.8.11.4 replay from preserved corrected preflight.
 *
 * Source:
 *   scripts/v9811-4.cjs
 *
 * Replay changes only:
 * - VERSION
 * - INPUT_VERSION
 * - default input artifact
 * - default output artifact
 *
 * Important:
 * - corrected DB contract is preserved:
 *     is_validation = false
 *     production_applied = false
 *     metadata.canonical_validation_status = VALIDATED
 * - existing/current DB overlap is discovered dynamically.
 * - historical 5-compatible / 153-insert overlap is NOT hardcoded by replay.
 * - Supabase reads are preserved.
 * - no DB writes / no production apply.
 */

const fs = require('node:fs');
const path = require('node:path');

const sourceFile = path.join(
  __dirname,
  'v9811-4.cjs',
);

const outputFile = path.join(
  __dirname,
  'v9811-4-replay.cjs',
);

const VERSION =
  'V9_8_11_4_REPLAY_CORRECTED_PRODUCTION_CANONICAL_EVENT_PREFLIGHT';

const INPUT_VERSION =
  'V9_8_10_3_REPLAY_V2_STRUCTURAL_CANONICAL_DATE_FINALIZATION_WITH_RECONCILIATION';

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
  'opendart-corporate-action-structural-date-finalization-v9-8-10-3-replay-v2.json';

const outputOld =
  'opendart-corporate-action-production-event-preflight-v9-8-11-4.json';

const outputNew =
  'opendart-corporate-action-production-event-preflight-v9-8-11-4-replay.json';

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
        'V9_8_11_4_REPLAY_BUILT',

      version:
        VERSION,

      inputVersion:
        INPUT_VERSION,

      input:
        'logs/opendart-corporate-action-structural-date-finalization-v9-8-10-3-replay-v2.json',

      output:
        'logs/opendart-corporate-action-production-event-preflight-v9-8-11-4-replay.json',

      script:
        'scripts/v9811-4-replay.cjs',

      expectedBatchContract: {
        totalCanonicalIdentities: 159,
        persistableNow: 158,
        factorSupported: 121,
        structuralBlocked: 37,
        futurePending: 1,
      },

      dbOverlapPolicy: {
        historicalOverlapCountsHardcoded: false,
        discoveredFromCurrentDatabase: true,
        accountingMustEqualPersistable: 158,
        conflictsMustBeZero: true,
      },

      correctedRemoteContract: {
        isValidation: false,
        productionApplied: false,
        canonicalValidationStatus:
          'VALIDATED',
      },

      safety: {
        supabaseReadsPreserved: true,
        databaseWrites: 0,
        productionAppliedMutations: 0,
        canonicalEventsInserted: 0,
      },
    },
    null,
    2,
  ),
);
