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

const startMarker =
  'export function buildV7MarketRegimeEvidence';

const endMarker =
  'export function buildDailyPriceVolumeEvidence';

const start =
  source.indexOf(
    startMarker,
  );

const end =
  source.indexOf(
    endMarker,
    start + startMarker.length,
  );

if (
  start < 0 ||
  end < 0 ||
  end <= start
) {
  console.error(
    JSON.stringify(
      {
        status:
          'ALPHA_V1_REGIME_ADAPTER_SOURCE_PROBE_V2_FAILED',
        startFound:
          start >= 0,
        endFound:
          end >= 0,
      },
      null,
      2,
    ),
  );

  process.exit(2);
}

const functionSource =
  source
    .slice(
      start,
      end,
    )
    .trim();

console.log(
  JSON.stringify(
    {
      status:
        'ALPHA_V1_REGIME_ADAPTER_SOURCE_PROBE_V2_COMPLETE',
      file:
        'lib/alpha/daily-market-adapters.ts',
      function:
        'buildV7MarketRegimeEvidence',
      productionChanged:
        false,
      thresholdsChanged:
        false,
      weightsChanged:
        false,
      safety: {
        databaseReads: 0,
        databaseWrites: 0,
        ordersCreated: 0,
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
