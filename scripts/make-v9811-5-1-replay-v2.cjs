#!/usr/bin/env node
'use strict';

/**
 * Build V9.8.11.5.1 replay v2.
 *
 * Fixes the first replay builder which missed the historical
 * EXPECTED_INPUT_INSERT_ROWS = 153 guard.
 *
 * Historical snapshot date remains EXACTLY 2026-10-01.
 *
 * Repaired current-state contract:
 *   input insert payload             = 31
 *   existing compatible             = 127
 *   eligible insert at snapshot     = 1
 *   eligible non-structural         = 0
 *   eligible structural             = 1
 *   deferred future structural      = 30
 *   total production eligible       = 128
 *
 * Safety:
 *   no network
 *   no DB writes
 *   no production apply
 */

const fs = require('node:fs');
const path = require('node:path');

const sourceFile = path.join(
  __dirname,
  'v9811-5-1.cjs',
);

const outputFile = path.join(
  __dirname,
  'v9811-5-1-replay-v2.cjs',
);

const VERSION =
  'V9_8_11_5_1_REPLAY_V2_SNAPSHOT_ASOF_PRODUCTION_ELIGIBILITY_GATE';

const INPUT_VERSION =
  'V9_8_11_5_REPLAY_V2_CURRENT_STATE_CANONICAL_EVENT_BULK_INSERT_DRY_RUN';

function replaceRequired(source, regex, replacement, label) {
  const matches = source.match(
    new RegExp(
      regex.source,
      regex.flags.includes('g')
        ? regex.flags
        : regex.flags + 'g',
    ),
  ) ?? [];

  if (matches.length < 1) {
    throw new Error(`${label}_NOT_FOUND`);
  }

  return source.replace(regex, replacement);
}

function replaceExactlyOnce(source, regex, replacement, label) {
  const matches = source.match(
    new RegExp(
      regex.source,
      regex.flags.includes('g')
        ? regex.flags
        : regex.flags + 'g',
    ),
  ) ?? [];

  if (matches.length !== 1) {
    throw new Error(
      `${label}_MATCH_COUNT:${matches.length}`,
    );
  }

  return source.replace(regex, replacement);
}

let src = fs.readFileSync(sourceFile, 'utf8');

// ---------------------------------------------------------------------------
// Version lineage.
// ---------------------------------------------------------------------------

src = replaceExactlyOnce(
  src,
  /const VERSION\s*=\s*[\r\n\s]*'V9_8_11_5_1_SNAPSHOT_ASOF_PRODUCTION_ELIGIBILITY_GATE';/,
  `const VERSION =\n  '${VERSION}';`,
  'VERSION',
);

src = replaceExactlyOnce(
  src,
  /const INPUT_VERSION\s*=\s*[\r\n\s]*'V9_8_11_5_CANONICAL_EVENT_BULK_INSERT_DRY_RUN';/,
  `const INPUT_VERSION =\n  '${INPUT_VERSION}';`,
  'INPUT_VERSION',
);

// ---------------------------------------------------------------------------
// Historical boundary MUST NOT move.
// ---------------------------------------------------------------------------

if (
  !/const SNAPSHOT_AS_OF\s*=\s*[\r\n\s]*'2026-10-01';/.test(src)
) {
  throw new Error(
    'SNAPSHOT_AS_OF_2026_10_01_NOT_FOUND',
  );
}

// ---------------------------------------------------------------------------
// Replace ALL historical count contracts.
// ---------------------------------------------------------------------------

// This is the guard missed by replay v1.
src = replaceRequired(
  src,
  /const EXPECTED_INPUT_INSERT_ROWS\s*=\s*[\r\n\s]*153;/,
  'const EXPECTED_INPUT_INSERT_ROWS = 31;',
  'EXPECTED_INPUT_INSERT_ROWS',
);

// Be defensive in case this historical source used another constant name.
src = src.replace(
  /const EXPECTED_INSERT_ROWS\s*=\s*[\r\n\s]*153;/,
  'const EXPECTED_INSERT_ROWS = 31;',
);

src = replaceRequired(
  src,
  /const EXPECTED_COMPATIBLE\s*=\s*[\r\n\s]*5;/,
  'const EXPECTED_COMPATIBLE = 127;',
  'EXPECTED_COMPATIBLE',
);

src = replaceRequired(
  src,
  /const EXPECTED_FUTURE_STRUCTURAL\s*=\s*[\r\n\s]*30;/,
  'const EXPECTED_FUTURE_STRUCTURAL = 30;',
  'EXPECTED_FUTURE_STRUCTURAL',
);

src = replaceRequired(
  src,
  /const EXPECTED_ELIGIBLE_INSERTS\s*=\s*[\r\n\s]*123;/,
  'const EXPECTED_ELIGIBLE_INSERTS = 1;',
  'EXPECTED_ELIGIBLE_INSERTS',
);

src = replaceRequired(
  src,
  /const EXPECTED_ELIGIBLE_TOTAL\s*=\s*[\r\n\s]*128;/,
  'const EXPECTED_ELIGIBLE_TOTAL = 128;',
  'EXPECTED_ELIGIBLE_TOTAL',
);

// Old output composition expected 6 newly-inserted structural rows and
// 117 newly-inserted non-structural rows. Current DB already contains those
// historical rows; only 028080 remains newly eligible in this 31-row payload.
src = replaceExactlyOnce(
  src,
  /historicalOrCurrentStructural\.length\s*===\s*[\r\n\s]*6\s*&&/,
  `historicalOrCurrentStructural.length ===\n      1 &&`,
  'ELIGIBLE_STRUCTURAL_COUNT',
);

src = replaceExactlyOnce(
  src,
  /eligibleNonStructural\.length\s*===\s*[\r\n\s]*117\s*&&/,
  `eligibleNonStructural.length ===\n      0 &&`,
  'ELIGIBLE_NON_STRUCTURAL_COUNT',
);

// ---------------------------------------------------------------------------
// Replay paths.
// ---------------------------------------------------------------------------

const oldInput =
  'opendart-corporate-action-bulk-insert-dry-run-v9-8-11-5.json';

const newInput =
  'opendart-corporate-action-bulk-insert-dry-run-v9-8-11-5-replay-v2.json';

const oldOutput =
  'opendart-corporate-action-snapshot-eligibility-v9-8-11-5-1.json';

const newOutput =
  'opendart-corporate-action-snapshot-eligibility-v9-8-11-5-1-replay-v2.json';

if (!src.includes(oldInput)) {
  throw new Error('INPUT_PATH_MARKER_NOT_FOUND');
}

if (!src.includes(oldOutput)) {
  throw new Error('OUTPUT_PATH_MARKER_NOT_FOUND');
}

src = src.replaceAll(oldInput, newInput);
src = src.replaceAll(oldOutput, newOutput);

// Change stale diagnostic wording where present.
src = src.replaceAll(
  'EXPECTED_153_INSERT_ROWS',
  'EXPECTED_31_INPUT_INSERT_ROWS',
);

src = src.replaceAll(
  'BUILD_123_ROW_BULK_INSERT_APPLY',
  'STOP_BEFORE_WRITE_AND_BUILD_READ_ONLY_POST_ELIGIBILITY_REPLAY',
);

// ---------------------------------------------------------------------------
// Add repaired-lineage identity guards before status calculation.
// ---------------------------------------------------------------------------

const statusMarker = '  const status =';

const statusIndex = src.indexOf(statusMarker);

if (statusIndex < 0) {
  throw new Error('STATUS_MARKER_NOT_FOUND');
}

const guard = `
  // Repaired-lineage identity guards.
  const repairedEligibleIds =
    eligibleInsertPayload
      .map((row) => String(row.provider_event_id))
      .sort();

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

src =
  src.slice(0, statusIndex) +
  guard +
  src.slice(statusIndex);

// ---------------------------------------------------------------------------
// Build-time stale-contract audit.
// ---------------------------------------------------------------------------

const stalePatterns = [
  {
    label: 'STALE_EXPECTED_INPUT_153',
    regex:
      /EXPECTED_INPUT_INSERT_ROWS\s*=\s*[\r\n\s]*153\b/,
  },
  {
    label: 'STALE_DIRECT_INPUT_LENGTH_153',
    regex:
      /input\.insertPayload\.length\s*!==\s*153\b/,
  },
  {
    label: 'STALE_ELIGIBLE_123',
    regex:
      /EXPECTED_ELIGIBLE_INSERTS\s*=\s*[\r\n\s]*123\b/,
  },
  {
    label: 'STALE_COMPATIBLE_5',
    regex:
      /EXPECTED_COMPATIBLE\s*=\s*[\r\n\s]*5\b/,
  },
  {
    label: 'STALE_ELIGIBLE_STRUCTURAL_6',
    regex:
      /historicalOrCurrentStructural\.length\s*===\s*[\r\n\s]*6\b/,
  },
  {
    label: 'STALE_ELIGIBLE_NONSTRUCTURAL_117',
    regex:
      /eligibleNonStructural\.length\s*===\s*[\r\n\s]*117\b/,
  },
];

for (const check of stalePatterns) {
  if (check.regex.test(src)) {
    throw new Error(check.label);
  }
}

// Historical snapshot must still remain.
if (!src.includes("'2026-10-01'")) {
  throw new Error('SNAPSHOT_BOUNDARY_LOST');
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
        'V9_8_11_5_1_REPLAY_V2_BUILT',

      version:
        VERSION,

      inputVersion:
        INPUT_VERSION,

      snapshotAsOf:
        '2026-10-01',

      input:
        'logs/opendart-corporate-action-bulk-insert-dry-run-v9-8-11-5-replay-v2.json',

      output:
        'logs/opendart-corporate-action-snapshot-eligibility-v9-8-11-5-1-replay-v2.json',

      script:
        'scripts/v9811-5-1-replay-v2.cjs',

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

      buildAudit: {
        stale153InputGuard: false,
        stale123EligibleContract: false,
        stale5CompatibleContract: false,
        stale6StructuralContract: false,
        stale117NonStructuralContract: false,
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
