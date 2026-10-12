#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VERSION =
  'ALPHA_V1_V7_EXACT_CONTRACT_EXTRACTOR';

const TARGETS = [
  {
    file:
      'lib/market/get-current-market-regime-features-v7.ts',

    tokens: [
      'export async function getCurrentMarketRegimeFeaturesV7',
      'return {',
      '.from("market_index_daily_bars")',
      '.from("market_daily_bars")',
      'latestMarketDate',
      'breadth20',
      'breadth60',
      'kospiReturn20',
      'kospiReturn60',
      'kosdaqReturn20',
      'kosdaqReturn60',
      'averageVolatility20',
      'kospiDrawdown60',
      'kosdaqDrawdown60',
    ],
  },
  {
    file:
      'lib/market/market-regime-v7-policy.ts',

    tokens: [
      'export interface MarketRegimeV7PolicyThresholds',
      'export const DEFAULT_MARKET_REGIME_V7_THRESHOLDS',
      'export function evaluateMarketRegimeV7Policy',
      'return {',
      'breadth20',
      'averageVolatility20',
      'kosdaqReturn20',
      'wouldBlock',
      'reasons',
    ],
  },
  {
    file:
      'lib/alpha/feature-adapters.ts',

    tokens: [
      'export interface MarketRegimeShadow',
      'function adaptMarketRegime',
      'marketRegime',
      'priceVolume',
      'buildAlphaCandidateInputFromRealSources',
      'features:',
    ],
  },
  {
    file:
      'scripts/alpha-v1-real-runner-kis-flow-read-only.ts',

    tokens: [
      'computeMarketRegimeProxy',
      'buildAlphaCandidateInputFromRealSources',
      'marketRegime:',
      'snapshots:',
      'priceVolume',
      'sourceStatus',
    ],
  },
];

function readLines(file) {
  return fs
    .readFileSync(
      file,
      'utf8',
    )
    .split(/\r?\n/);
}

function mergeWindows(
  windows,
  maxLine,
) {
  const sorted =
    windows
      .map(
        (window) => ({
          start:
            Math.max(
              1,
              window.start,
            ),

          end:
            Math.min(
              maxLine,
              window.end,
            ),
        }),
      )
      .sort(
        (a, b) =>
          a.start -
          b.start,
      );

  const merged = [];

  for (const window of sorted) {
    const previous =
      merged.at(-1);

    if (
      previous &&
      window.start <=
        previous.end + 3
    ) {
      previous.end =
        Math.max(
          previous.end,
          window.end,
        );
    } else {
      merged.push({
        ...window,
      });
    }
  }

  return merged;
}

function extract(
  root,
  target,
) {
  const full =
    path.join(
      root,
      target.file,
    );

  if (!fs.existsSync(full)) {
    return {
      file:
        target.file,

      exists:
        false,

      snippets:
        [],
    };
  }

  const lines =
    readLines(full);

  const windows = [];

  target.tokens.forEach(
    (token) => {
      lines.forEach(
        (line, index) => {
          if (
            line.includes(
              token,
            )
          ) {
            windows.push({
              start:
                index + 1 - 12,

              end:
                index + 1 + 28,
            });
          }
        },
      );
    },
  );

  // Ensure exported declarations near the top are visible.
  windows.push({
    start:
      1,

    end:
      Math.min(
        120,
        lines.length,
      ),
  });

  const merged =
    mergeWindows(
      windows,
      lines.length,
    );

  return {
    file:
      target.file,

    exists:
      true,

    lineCount:
      lines.length,

    snippets:
      merged.map(
        (window) => ({
          fromLine:
            window.start,

          toLine:
            window.end,

          text:
            lines
              .slice(
                window.start - 1,
                window.end,
              )
              .map(
                (line, offset) =>
                  `${window.start + offset}: ${line}`,
              )
              .join('\n'),
        }),
      ),
  };
}

function main() {
  const root =
    path.resolve(
      __dirname,
      '..',
    );

  const files =
    TARGETS.map(
      (target) =>
        extract(
          root,
          target,
        ),
    );

  const report = {
    status:
      'ALPHA_V1_V7_EXACT_CONTRACT_EXTRACT_COMPLETE',

    version:
      VERSION,

    filesFound:
      files.filter(
        (file) =>
          file.exists,
      ).length,

    filesMissing:
      files
        .filter(
          (file) =>
            !file.exists,
        )
        .map(
          (file) =>
            file.file,
        ),

    files,

    purpose: {
      regime:
        'EXTRACT_EXACT_GET_CURRENT_V7_RETURN_SHAPE_AND_POLICY_SIGNATURE',

      alpha:
        'EXTRACT_CURRENT_MARKET_REGIME_AND_PRICE_VOLUME_BINDING_POINTS',

      implementationAfter:
        'BUILD_DAILY_BAR_PRICE_VOLUME_ADAPTER_AND_BIND_EXISTING_V7_REGIME_WITHOUT_DUPLICATING_V7_LOGIC',
    },

    safety: {
      databaseReads:
        0,

      databaseWrites:
        0,

      networkRequests:
        0,

      ordersCreated:
        0,

      positionsChanged:
        0,
    },

    nextGate:
      'ALPHA_V1_IMPLEMENT_DAILY_MARKET_FEATURES',
  };

  const outputFile =
    path.join(
      root,
      'logs',
      'alpha-v1-v7-exact-contract-extract.json',
    );

  fs.mkdirSync(
    path.dirname(
      outputFile,
    ),
    {
      recursive:
        true,
    },
  );

  fs.writeFileSync(
    outputFile,
    JSON.stringify(
      report,
      null,
      2,
    ) + '\n',
    'utf8',
  );

  console.log(
    JSON.stringify(
      report,
      null,
      2,
    ),
  );
}

try {
  main();
} catch (error) {
  console.error(
    JSON.stringify(
      {
        status:
          'ALPHA_V1_V7_EXACT_CONTRACT_EXTRACT_FAILED',

        version:
          VERSION,

        error:
          String(
            error?.message ??
            error,
          ),

        databaseWrites:
          0,

        ordersCreated:
          0,
      },
      null,
      2,
    ),
  );

  process.exitCode =
    2;
}
