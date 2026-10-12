#!/usr/bin/env node
'use strict';

/**
 * Build V9.8.10.3 replay from preserved historical implementation.
 *
 * Preserves all structural canonical-date finalization-preview logic
 * from scripts/v9810-3.cjs.
 *
 * Replay lineage changes only:
 * - VERSION
 * - FACTOR_VERSION
 * - AUDIT_VERSION
 * - PROBE_VERSION
 * - default factor/audit/probe input paths
 * - default output path
 *
 * Safety:
 * - no network
 * - no DB reads/writes
 * - no production mutation
 * - no factor persistence
 * - structural factor status remains blocked by original policy
 */

const fs = require('node:fs');
const path = require('node:path');

const sourceFile = path.join(
  __dirname,
  'v9810-3.cjs',
);

const outputFile = path.join(
  __dirname,
  'v9810-3-replay.cjs',
);

const VERSION =
  'V9_8_10_3_REPLAY_STRUCTURAL_CANONICAL_DATE_FINALIZATION_PREVIEW';

const FACTOR_VERSION =
  'V9_8_8_REPLAY_PER_EVENT_FACTOR_REFERENCE_VALIDATION';

const AUDIT_VERSION =
  'V9_8_10_1_REPLAY_STRUCTURAL_CANONICAL_DATE_AUDIT';

const PROBE_VERSION =
  'V9_8_10_2_1_REPLAY_STRUCTURAL_EVIDENCE_PATH_EXACT_LABEL_PROBE';

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
  /const VERSION\s*=\s*'V9_8_10_3_STRUCTURAL_CANONICAL_DATE_FINALIZATION_PREVIEW';/,
  `const VERSION =\n  '${VERSION}';`,
  'VERSION',
);

src = replaceOnce(
  src,
  /const FACTOR_VERSION\s*=\s*'V9_8_8_PER_EVENT_FACTOR_REFERENCE_VALIDATION';/,
  `const FACTOR_VERSION =\n  '${FACTOR_VERSION}';`,
  'FACTOR_VERSION',
);

src = replaceOnce(
  src,
  /const AUDIT_VERSION\s*=\s*'V9_8_10_1_STRUCTURAL_CANONICAL_DATE_AUDIT';/,
  `const AUDIT_VERSION =\n  '${AUDIT_VERSION}';`,
  'AUDIT_VERSION',
);

src = replaceOnce(
  src,
  /const PROBE_VERSION\s*=\s*'V9_8_10_2_1_STRUCTURAL_EVIDENCE_PATH_EXACT_LABEL_PROBE';/,
  `const PROBE_VERSION =\n  '${PROBE_VERSION}';`,
  'PROBE_VERSION',
);

const replacements = [
  [
    'opendart-corporate-action-factor-validation-v9-8-8.json',
    'opendart-corporate-action-factor-validation-v9-8-8-replay.json',
    'FACTOR_INPUT_PATH',
  ],
  [
    'opendart-corporate-action-structural-date-audit-v9-8-10-1.json',
    'opendart-corporate-action-structural-date-audit-v9-8-10-1-replay.json',
    'AUDIT_INPUT_PATH',
  ],
  [
    'opendart-corporate-action-structural-date-probe-v9-8-10-2-1.json',
    'opendart-corporate-action-structural-date-probe-v9-8-10-2-1-replay.json',
    'PROBE_INPUT_PATH',
  ],
  [
    'opendart-corporate-action-structural-date-finalization-v9-8-10-3.json',
    'opendart-corporate-action-structural-date-finalization-v9-8-10-3-replay.json',
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
        'V9_8_10_3_REPLAY_BUILT',

      versions: {
        replay:
          VERSION,
        factor:
          FACTOR_VERSION,
        audit:
          AUDIT_VERSION,
        probe:
          PROBE_VERSION,
      },

      defaultInputs: {
        factor:
          'logs/opendart-corporate-action-factor-validation-v9-8-8-replay.json',
        audit:
          'logs/opendart-corporate-action-structural-date-audit-v9-8-10-1-replay.json',
        probe:
          'logs/opendart-corporate-action-structural-date-probe-v9-8-10-2-1-replay.json',
      },

      output:
        'logs/opendart-corporate-action-structural-date-finalization-v9-8-10-3-replay.json',

      script:
        'scripts/v9810-3-replay.cjs',

      safety: {
        networkRequests:
          0,
        databaseReads:
          0,
        databaseWrites:
          0,
        productionApplied:
          false,
        structuralEffectiveDatesPersisted:
          0,
        factorsPersisted:
          0,
      },
    },
    null,
    2,
  ),
);
