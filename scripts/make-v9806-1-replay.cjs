#!/usr/bin/env node
'use strict';

/**
 * Build V9.8.6.1 replay from preserved historical implementation.
 *
 * Preserves all XML/text-node extraction logic from scripts/v9806-1.cjs.
 * Only updates:
 * - VERSION
 * - INPUT_VERSION
 * - default input path
 * - default output path
 *
 * Evidence input remains V9.8.3.1.
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
  'v9806-1.cjs',
);

const outputFile = path.join(
  __dirname,
  'v9806-1-replay.cjs',
);

const VERSION =
  'V9_8_6_1_REPLAY_PROVEN_XML_TEXT_NODE_FIELD_EXTRACTION';

const INPUT_VERSION =
  'V9_8_6_REPLAY_CANONICAL_CORPORATE_ACTION_FIELD_EXTRACTION';

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
  /const VERSION\s*=\s*'V9_8_6_1_PROVEN_XML_TEXT_NODE_FIELD_EXTRACTION';/,
  `const VERSION =\n  '${VERSION}';`,
  'VERSION',
);

src = replaceOnce(
  src,
  /const INPUT_VERSION\s*=\s*'V9_8_6_CANONICAL_CORPORATE_ACTION_FIELD_EXTRACTION';/,
  `const INPUT_VERSION =\n  '${INPUT_VERSION}';`,
  'INPUT_VERSION',
);

const inputOld =
  'opendart-corporate-action-field-extraction-v9-8-6.json';

const inputNew =
  'opendart-corporate-action-field-extraction-v9-8-6-replay.json';

const outputOld =
  'opendart-corporate-action-field-extraction-v9-8-6-1.json';

const outputNew =
  'opendart-corporate-action-field-extraction-v9-8-6-1-replay.json';

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
        'V9_8_6_1_REPLAY_BUILT',

      versions: {
        replay:
          VERSION,
        input:
          INPUT_VERSION,
        evidence:
          'V9_8_3_1_OPENDART_PROVIDER_014_EVIDENCE_DISPOSITION',
      },

      defaultInputs: {
        input:
          'logs/opendart-corporate-action-field-extraction-v9-8-6-replay.json',
        evidence:
          'logs/opendart-corporate-action-detail-evidence-v9-8-3-1.json',
      },

      output:
        'logs/opendart-corporate-action-field-extraction-v9-8-6-1-replay.json',

      script:
        'scripts/v9806-1-replay.cjs',

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
