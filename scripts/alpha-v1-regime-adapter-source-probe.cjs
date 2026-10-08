#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root =
  path.resolve(
    __dirname,
    '..',
  );

const target =
  path.join(
    root,
    'lib',
    'alpha',
    'daily-market-adapters.ts',
  );

const source =
  fs.readFileSync(
    target,
    'utf8',
  );

const marker =
  'export function buildV7MarketRegimeEvidence';

const start =
  source.indexOf(
    marker,
  );

if (start < 0) {
  console.error(
    JSON.stringify(
      {
        status:
          'ALPHA_V1_REGIME_ADAPTER_SOURCE_PROBE_FAILED',
        reason:
          'FUNCTION_NOT_FOUND',
        file:
          'lib/alpha/daily-market-adapters.ts',
      },
      null,
      2,
    ),
  );

  process.exit(2);
}

const braceStart =
  source.indexOf(
    '{',
    start,
  );

let depth = 0;
let end = -1;

for (
  let i = braceStart;
  i < source.length;
  i += 1
) {
  const ch =
    source[i];

  if (ch === '{') {
    depth += 1;
  } else if (ch === '}') {
    depth -= 1;

    if (depth === 0) {
      end =
        i + 1;
      break;
    }
  }
}

if (end < 0) {
  console.error(
    JSON.stringify(
      {
        status:
          'ALPHA_V1_REGIME_ADAPTER_SOURCE_PROBE_FAILED',
        reason:
          'FUNCTION_END_NOT_FOUND',
      },
      null,
      2,
    ),
  );

  process.exit(2);
}

const functionSource =
  source.slice(
    start,
    end,
  );

console.log(
  JSON.stringify(
    {
      status:
        'ALPHA_V1_REGIME_ADAPTER_SOURCE_PROBE_COMPLETE',
      file:
        'lib/alpha/daily-market-adapters.ts',
      function:
        'buildV7MarketRegimeEvidence',
      thresholdsChanged:
        false,
      weightsChanged:
        false,
      productionChanged:
        false,
      safety: {
        databaseReads:
          0,
        databaseWrites:
          0,
        ordersCreated:
          0,
      },
    },
    null,
    2,
  ),
);

console.log(
  '\n----- FUNCTION SOURCE -----\n',
);

console.log(
  functionSource,
);

console.log(
  '\n----- END FUNCTION SOURCE -----',
);
