#!/usr/bin/env node
'use strict';

/**
 * Build V9.8.11.5.1 replay from preserved snapshot-eligibility gate.
 *
 * Source:
 *   scripts/v9811-5-1.cjs
 *
 * Historical snapshot boundary is intentionally preserved:
 *   SNAPSHOT_AS_OF = 2026-10-01
 *
 * Repaired/current-state accounting:
 *   dry-run insert candidates       = 31
 *   existing compatible             = 127
 *   eligible insert at snapshot     = 1
 *   deferred future structural      = 30
 *   total production eligible       = 128
 *
 * Why only 1 insert is eligible:
 * - current 31 insert candidates are all MERGER/SPIN_OFF.
 * - providerEventId 20221013000451 (stock 028080) has effective_date 2026-10-01.
 * - the other 30 structural candidates are after 2026-10-01.
 *
 * No writes. Do NOT advance to production apply automatically.
 */

const fs = require('node:fs');
const path = require('node:path');

const sourceFile = path.join(
  __dirname,
  'v9811-5-1.cjs',
);

const outputFile = path.join(
  __dirname,
  'v9811-5-1-replay.cjs',
);

const VERSION =
  'V9_8_11_5_1_REPLAY_SNAPSHOT_ASOF_PRODUCTION_ELIGIBILITY_GATE';

const INPUT_VERSION =
  'V9_8_11_5_REPLAY_V2_CURRENT_STATE_CANONICAL_EVENT_BULK_INSERT_DRY_RUN';

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

// Version lineage.
src = replaceOnce(
  src,
  /const VERSION\s*=\s*[\r\n\s]*'V9_8_11_5_1_SNAPSHOT_ASOF_PRODUCTION_ELIGIBILITY_GATE';/,
  `const VERSION =\n  '${VERSION}';`,
  'VERSION',
);

src = replaceOnce(
  src,
  /const INPUT_VERSION\s*=\s*[\r\n\s]*'V9_8_11_5_CANONICAL_EVENT_BULK_INSERT_DRY_RUN';/,
  `const INPUT_VERSION =\n  '${INPUT_VERSION}';`,
  'INPUT_VERSION',
);

// Preserve historical snapshot boundary exactly.
if (
  !/const SNAPSHOT_AS_OF\s*=\s*[\r\n\s]*'2026-10-01';/.test(src)
) {
  throw new Error('SNAPSHOT_AS_OF_2026_10_01_NOT_FOUND');
}

// Current repaired accounting.
src = replaceOnce(
  src,
  /const EXPECTED_FUTURE_STRUCTURAL\s*=\s*30;/,
  'const EXPECTED_FUTURE_STRUCTURAL = 30;',
  'EXPECTED_FUTURE_STRUCTURAL',
);

src = replaceOnce(
  src,
  /const EXPECTED_ELIGIBLE_INSERTS\s*=\s*123;/,
  'const EXPECTED_ELIGIBLE_INSERTS = 1;',
  'EXPECTED_ELIGIBLE_INSERTS',
);

src = replaceOnce(
  src,
  /const EXPECTED_ELIGIBLE_TOTAL\s*=\s*128;/,
  'const EXPECTED_ELIGIBLE_TOTAL = 128;',
  'EXPECTED_ELIGIBLE_TOTAL',
);

src = replaceOnce(
  src,
  /const EXPECTED_COMPATIBLE\s*=\s*5;/,
  'const EXPECTED_COMPATIBLE = 127;',
  'EXPECTED_COMPATIBLE',
);

// Historical status contract had 6 newly-inserted structural rows and
// 117 newly-inserted non-structural rows. In the current DB state those
// 127 rows are already compatible, leaving exactly one eligible insert.
src = replaceOnce(
  src,
  /historicalOrCurrentStructural\.length\s*===\s*[\r\n\s]*6\s*&&/,
  `historicalOrCurrentStructural.length ===\n      1 &&`,
  'HISTORICAL_OR_CURRENT_STRUCTURAL_COUNT',
);

src = replaceOnce(
  src,
  /eligibleNonStructural\.length\s*===\s*[\r\n\s]*117\s*&&/,
  `eligibleNonStructural.length ===\n      0 &&`,
  'ELIGIBLE_NON_STRUCTURAL_COUNT',
);

// Replay input/output paths.
const inputOld =
  'opendart-corporate-action-bulk-insert-dry-run-v9-8-11-5.json';

const inputNew =
  'opendart-corporate-action-bulk-insert-dry-run-v9-8-11-5-replay-v2.json';

const outputOld =
  'opendart-corporate-action-snapshot-eligibility-v9-8-11-5-1.json';

const outputNew =
  'opendart-corporate-action-snapshot-eligibility-v9-8-11-5-1-replay.json';

if (!src.includes(inputOld)) {
  throw new Error('INPUT_PATH_MARKER_NOT_FOUND');
}

if (!src.includes(outputOld)) {
  throw new Error('OUTPUT_PATH_MARKER_NOT_FOUND');
}

src = src.replaceAll(inputOld, inputNew);
src = src.replaceAll(outputOld, outputNew);

// Never suggest executing historical write/apply from the replay gate.
src = src.replaceAll(
  'BUILD_123_ROW_BULK_INSERT_APPLY',
  'STOP_BEFORE_WRITE_AND_BUILD_READ_ONLY_POST_ELIGIBILITY_REPLAY',
);

// Add a strict repaired-lineage identity guard immediately after the
// eligible/deferred sets have been formed and before status is calculated.
const statusMarker = '  const status =';

if (src.indexOf(statusMarker) < 0) {
  throw new Error('STATUS_MARKER_NOT_FOUND');
}

const guard = `
  // Repaired-lineage snapshot guard.
  const repairedEligibleIds =
    eligibleInsertPayload.map(
      (row) => String(row.provider_event_id),
    );

  if (
    repairedEligibleIds.length !== 1 ||
    repairedEligibleIds[0] !== '20221013000451'
  ) {
    throw new Error(
      \`REPAIRED_ELIGIBLE_IDENTITY_MISMATCH:\${repairedEligibleIds.join(',')}\`,
    );
  }

  const repaired003580Deferred =
    deferredFutureStructural.find(
      (row) =>
        String(row.provider_event_id) ===
        '20260807000649',
    );

  if (
    !repaired003580Deferred ||
    repaired003580Deferred.effective_date !==
      '2026-10-12'
  ) {
    throw new Error(
      'REPAIRED_003580_NOT_DEFERRED_AT_2026_10_12',
    );
  }

`;

src = src.replace(
  statusMarker,
  guard + statusMarker,
);

fs.writeFileSync(outputFile, src, 'utf8');

console.log(
  JSON.stringify(
    {
      status:
        'V9_8_11_5_1_REPLAY_BUILT',

      version:
        VERSION,

      inputVersion:
        INPUT_VERSION,

      snapshotAsOf:
        '2026-10-01',

      input:
        'logs/opendart-corporate-action-bulk-insert-dry-run-v9-8-11-5-replay-v2.json',

      output:
        'logs/opendart-corporate-action-snapshot-eligibility-v9-8-11-5-1-replay.json',

      script:
        'scripts/v9811-5-1-replay.cjs',

      expected: {
        inputInsertRows: 31,
        existingCompatibleRows: 127,
        eligibleInsertRows: 1,
        eligibleNonStructuralRows: 0,
        eligibleHistoricalOrCurrentStructuralRows: 1,
        deferredFutureStructuralRows: 30,
        totalProductionEligibleNow: 128,
        eligibleProviderEventId:
          '20221013000451',
        corrected003580Disposition:
          'DEFER_AT_2026_10_12',
      },

      safety: {
        networkRequests: 0,
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
