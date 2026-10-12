#!/usr/bin/env node
'use strict';

/**
 * Build V9.8.11.5 replay from preserved historical dry-run.
 *
 * Source:
 *   scripts/v9811-5.cjs
 *
 * Repaired/current-state contract:
 * - input preflight version is replay V9.8.11.4
 * - frozen preflight says:
 *     wouldInsert       = 31
 *     alreadyCompatible = 127
 *     persistableNow    = 158
 *     futurePending     = 1
 *
 * Safety logic is otherwise preserved:
 * - re-read production namespace
 * - fail if any target appeared since preflight
 * - fail on compatible drift
 * - fail on source fingerprint collision
 * - validate modeled remote CHECK constraints
 * - GET only / no POST/PATCH/DELETE
 *
 * IMPORTANT:
 * The next gate is snapshot eligibility V9.8.11.5.1 replay,
 * NOT any production write.
 */

const fs = require('node:fs');
const path = require('node:path');

const sourceFile = path.join(
  __dirname,
  'v9811-5.cjs',
);

const outputFile = path.join(
  __dirname,
  'v9811-5-replay.cjs',
);

const VERSION =
  'V9_8_11_5_REPLAY_CURRENT_STATE_CANONICAL_EVENT_BULK_INSERT_DRY_RUN';

const INPUT_VERSION =
  'V9_8_11_4_REPLAY_CORRECTED_PRODUCTION_CANONICAL_EVENT_PREFLIGHT';

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

  return source.replace(regex, replacement);
}

let src = fs.readFileSync(sourceFile, 'utf8');

src = replaceOnce(
  src,
  /const VERSION\s*=\s*[\r\n\s]*'V9_8_11_5_CANONICAL_EVENT_BULK_INSERT_DRY_RUN';/,
  `const VERSION =\n  '${VERSION}';`,
  'VERSION',
);

src = replaceOnce(
  src,
  /const INPUT_VERSION\s*=\s*[\r\n\s]*'V9_8_11_4_CORRECTED_PRODUCTION_CANONICAL_EVENT_PREFLIGHT';/,
  `const INPUT_VERSION =\n  '${INPUT_VERSION}';`,
  'INPUT_VERSION',
);

src = replaceOnce(
  src,
  /const EXPECTED_INSERT_ROWS\s*=\s*153;/,
  'const EXPECTED_INSERT_ROWS = 31;',
  'EXPECTED_INSERT_ROWS',
);

src = replaceOnce(
  src,
  /const EXPECTED_COMPATIBLE_ROWS\s*=\s*5;/,
  'const EXPECTED_COMPATIBLE_ROWS = 127;',
  'EXPECTED_COMPATIBLE_ROWS',
);

const inputOld =
  'opendart-corporate-action-production-event-preflight-v9-8-11-4.json';

const inputNew =
  'opendart-corporate-action-production-event-preflight-v9-8-11-4-replay.json';

const outputOld =
  'opendart-corporate-action-bulk-insert-dry-run-v9-8-11-5.json';

const outputNew =
  'opendart-corporate-action-bulk-insert-dry-run-v9-8-11-5-replay.json';

if (!src.includes(inputOld)) {
  throw new Error('INPUT_PATH_MARKER_NOT_FOUND');
}

if (!src.includes(outputOld)) {
  throw new Error('OUTPUT_PATH_MARKER_NOT_FOUND');
}

src = src.replaceAll(inputOld, inputNew);
src = src.replaceAll(outputOld, outputNew);

// Make stale historical count diagnostics explicit for this replay.
src = src.replaceAll(
  'EXPECTED_153_INSERT_PREVIEW_ROWS',
  'EXPECTED_31_INSERT_PREVIEW_ROWS',
);

src = src.replaceAll(
  'RE_READ_ALL_153_IDENTITIES_AND_COMPARE_EXACT_CANONICAL_FIELDS',
  'RE_READ_ALL_31_IDENTITIES_AND_COMPARE_EXACT_CANONICAL_FIELDS',
);

// Do not point the replay at a write stage.
src = src.replaceAll(
  'BUILD_V9_8_11_6_BULK_INSERT_APPLY',
  'BUILD_V9_8_11_5_1_REPLAY_SNAPSHOT_ELIGIBILITY_GATE',
);

fs.writeFileSync(outputFile, src, 'utf8');

console.log(
  JSON.stringify(
    {
      status:
        'V9_8_11_5_REPLAY_BUILT',

      version:
        VERSION,

      inputVersion:
        INPUT_VERSION,

      input:
        'logs/opendart-corporate-action-production-event-preflight-v9-8-11-4-replay.json',

      output:
        'logs/opendart-corporate-action-bulk-insert-dry-run-v9-8-11-5-replay.json',

      script:
        'scripts/v9811-5-replay.cjs',

      frozenPreflightContract: {
        wouldInsert: 31,
        alreadyCompatible: 127,
        persistableNow: 158,
        futurePending: 1,
        conflicts: 0,
      },

      preservedChecks: {
        duplicateCanonicalIdentity: true,
        duplicateSourceFingerprint: true,
        targetAppearedSincePreflight: true,
        compatibleDrift: true,
        productionFingerprintCollision: true,
        modeledRemoteConstraints: true,
      },

      nextGate:
        'V9_8_11_5_1_REPLAY_SNAPSHOT_ELIGIBILITY_GATE',

      safety: {
        supabaseReadsPreserved: true,
        httpMethodsUsed: ['GET'],
        databaseWrites: 0,
        insertRequestsExecuted: 0,
        canonicalEventsInserted: 0,
        productionApplied: false,
      },
    },
    null,
    2,
  ),
);
