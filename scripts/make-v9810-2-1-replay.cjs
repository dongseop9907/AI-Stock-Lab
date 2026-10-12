#!/usr/bin/env node
'use strict';

/**
 * Build V9.8.10.2.1 replay from preserved historical implementation.
 *
 * Preserves the fixed structural evidence-path / exact-label probe logic
 * from scripts/v9810-2-1.cjs.
 *
 * Replay lineage changes only:
 * - VERSION
 * - AUDIT_VERSION
 * - default audit input path
 * - default output path
 *
 * Evidence lineage is intentionally unchanged:
 *   V9_8_3_1_OPENDART_PROVIDER_014_EVIDENCE_DISPOSITION
 *
 * Safety:
 * - no network
 * - no DB reads/writes
 * - no production mutation
 * - no structural effective-date promotion
 */

const fs = require('node:fs');
const path = require('node:path');

const sourceFile = path.join(
  __dirname,
  'v9810-2-1.cjs',
);

const outputFile = path.join(
  __dirname,
  'v9810-2-1-replay.cjs',
);

const VERSION =
  'V9_8_10_2_1_REPLAY_STRUCTURAL_EVIDENCE_PATH_EXACT_LABEL_PROBE';

const AUDIT_VERSION =
  'V9_8_10_1_REPLAY_STRUCTURAL_CANONICAL_DATE_AUDIT';

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
  /const VERSION\s*=\s*'V9_8_10_2_1_STRUCTURAL_EVIDENCE_PATH_EXACT_LABEL_PROBE';/,
  `const VERSION =\n  '${VERSION}';`,
  'VERSION',
);

src = replaceOnce(
  src,
  /const AUDIT_VERSION\s*=\s*'V9_8_10_1_STRUCTURAL_CANONICAL_DATE_AUDIT';/,
  `const AUDIT_VERSION =\n  '${AUDIT_VERSION}';`,
  'AUDIT_VERSION',
);

const auditOld =
  'opendart-corporate-action-structural-date-audit-v9-8-10-1.json';

const auditNew =
  'opendart-corporate-action-structural-date-audit-v9-8-10-1-replay.json';

const outputOld =
  'opendart-corporate-action-structural-date-probe-v9-8-10-2-1.json';

const outputNew =
  'opendart-corporate-action-structural-date-probe-v9-8-10-2-1-replay.json';

if (!src.includes(auditOld)) {
  throw new Error(
    'AUDIT_INPUT_PATH_MARKER_NOT_FOUND',
  );
}

if (!src.includes(outputOld)) {
  throw new Error(
    'OUTPUT_PATH_MARKER_NOT_FOUND',
  );
}

src = src.replaceAll(
  auditOld,
  auditNew,
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
        'V9_8_10_2_1_REPLAY_BUILT',

      versions: {
        replay:
          VERSION,
        audit:
          AUDIT_VERSION,
        evidence:
          'V9_8_3_1_OPENDART_PROVIDER_014_EVIDENCE_DISPOSITION',
      },

      defaultInputs: {
        audit:
          'logs/opendart-corporate-action-structural-date-audit-v9-8-10-1-replay.json',
        evidence:
          'logs/opendart-corporate-action-detail-evidence-v9-8-3-1.json',
      },

      output:
        'logs/opendart-corporate-action-structural-date-probe-v9-8-10-2-1-replay.json',

      script:
        'scripts/v9810-2-1-replay.cjs',

      expected: {
        reviewTargets:
          15,
      },

      safety: {
        networkRequests:
          0,
        databaseReads:
          0,
        databaseWrites:
          0,
        productionApplied:
          false,
        structuralEffectiveDatesPromoted:
          0,
      },
    },
    null,
    2,
  ),
);
