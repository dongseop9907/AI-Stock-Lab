#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root =
  path.resolve(__dirname, '..');

const file =
  path.join(
    root,
    'lib',
    'alpha',
    'daily-market-adapters.ts',
  );

if (!fs.existsSync(file)) {
  console.error(JSON.stringify({
    status:
      'ALPHA_V3_PRICEVOLUME_FUNCTION_PROBE_FAILED',
    reason:
      'FILE_NOT_FOUND',
    file:
      'lib/alpha/daily-market-adapters.ts',
  }, null, 2));

  process.exit(2);
}

const source =
  fs.readFileSync(
    file,
    'utf8',
  );

const startMarker =
  'export function buildDailyPriceVolumeEvidence(';

const endMarker =
  '\nexport function buildDailyLiquidityEvidence(';

const start =
  source.indexOf(startMarker);

const end =
  source.indexOf(
    endMarker,
    start,
  );

if (start < 0) {
  console.error(JSON.stringify({
    status:
      'ALPHA_V3_PRICEVOLUME_FUNCTION_PROBE_FAILED',
    reason:
      'FUNCTION_NOT_FOUND',
    file:
      'lib/alpha/daily-market-adapters.ts',
  }, null, 2));

  process.exit(2);
}

const functionSource =
  source
    .slice(
      start,
      end > start
        ? end
        : source.length,
    )
    .trim();

const lines =
  source.split(/\r?\n/);

const typeMarkers = [
  'export interface DailyAlphaBarLike',
  'interface DailyAlphaBarLike',
  'type DailyAlphaBarLike',
  'export type DailyAlphaBarLike',
  'export interface V7MarketRegimeFeatureVectorLike',
  'interface V7MarketRegimeFeatureVectorLike',
  'type V7MarketRegimeFeatureVectorLike',
  'export type V7MarketRegimeFeatureVectorLike',
];

const typeSnippets = [];

for (const marker of typeMarkers) {
  const index =
    lines.findIndex(
      (line) =>
        line.includes(marker),
    );

  if (index >= 0) {
    typeSnippets.push({
      marker,
      line:
        index + 1,
      snippet:
        lines
          .slice(
            index,
            Math.min(
              lines.length,
              index + 80,
            ),
          )
          .join('\n'),
    });
  }
}

const helperNames = [
  'completedTradingDateAvailableAt',
  'clamp01',
  'scale',
  'median',
  'average',
];

const helperSnippets = [];

for (const helper of helperNames) {
  const index =
    lines.findIndex(
      (line) =>
        line.includes(
          `function ${helper}`,
        ) ||
        line.includes(
          `const ${helper}`,
        ),
    );

  if (index >= 0) {
    helperSnippets.push({
      helper,
      line:
        index + 1,
      snippet:
        lines
          .slice(
            Math.max(0, index - 4),
            Math.min(
              lines.length,
              index + 50,
            ),
          )
          .join('\n'),
    });
  }
}

console.log(JSON.stringify({
  status:
    'ALPHA_V3_PRICEVOLUME_FUNCTION_PROBE_COMPLETE',

  file:
    'lib/alpha/daily-market-adapters.ts',

  productionChanged:
    false,

  databaseWrites:
    0,

  ordersCreated:
    0,

  typeSnippets,

  helperSnippets,

  functionSource,

  nextGate:
    'BUILD_EXTENDED_PRICEVOLUME_TOP1_HISTORY'
}, null, 2));
