#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VERSION =
  'ALPHA_V1_V7_REGIME_SOURCE_EXTRACTOR';

const TARGETS = [
  'lib/market/get-current-market-regime-features-v7.ts',
  'lib/market/market-regime-v7-policy.ts',
  'lib/market/capture-market-regime-shadow-comparison-v7-3.ts',
  'lib/alpha/feature-adapters.ts',
  'scripts/alpha-v1-real-runner-kis-flow-read-only.ts',
];

const PATTERNS = [
  /^import\s/m,
  /^export\s/m,
  /function\s+[A-Za-z0-9_]+/g,
  /const\s+[A-Za-z0-9_]+\s*=/g,
  /\.from\(\s*["'`]market_daily_bars["'`]\s*\)/g,
  /\.from\(\s*["'`]market_index_daily_bars["'`]\s*\)/g,
  /breadth20/g,
  /breadth60/g,
  /kospiReturn20/g,
  /kospiReturn60/g,
  /kosdaqReturn20/g,
  /kosdaqReturn60/g,
  /averageVolatility20/g,
  /Drawdown60/g,
  /BLOCK_BREADTH_OR_HIGH_VOL/g,
  /buildAlphaCandidateInputFromRealSources/g,
  /marketRegime/g,
  /priceVolume/g,
];

function readLines(file) {
  return fs
    .readFileSync(
      file,
      'utf8',
    )
    .split(/\r?\n/);
}

function addWindow(
  windows,
  start,
  end,
) {
  windows.push({
    start:
      Math.max(
        1,
        start,
      ),

    end,
  });
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
        previous.end + 2
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

function extractFile(
  root,
  relativeFile,
) {
  const full =
    path.join(
      root,
      relativeFile,
    );

  if (!fs.existsSync(full)) {
    return {
      file:
        relativeFile,

      exists:
        false,

      lineCount:
        0,

      snippets:
        [],
    };
  }

  const lines =
    readLines(full);

  const text =
    lines.join('\n');

  const windows = [];

  // Always include imports / first declarations.
  addWindow(
    windows,
    1,
    Math.min(
      90,
      lines.length,
    ),
  );

  // Locate relevant patterns line-by-line.
  lines.forEach(
    (line, index) => {
      const lineNo =
        index + 1;

      const relevant =
        [
          'export ',
          'market_daily_bars',
          'market_index_daily_bars',
          'breadth20',
          'breadth60',
          'kospiReturn20',
          'kospiReturn60',
          'kosdaqReturn20',
          'kosdaqReturn60',
          'averageVolatility20',
          'Drawdown60',
          'BLOCK_BREADTH_OR_HIGH_VOL',
          'buildAlphaCandidateInputFromRealSources',
          'marketRegime',
          'priceVolume',
          'supabase',
          '.select(',
        ].some(
          (token) =>
            line.includes(
              token,
            ),
        );

      if (relevant) {
        addWindow(
          windows,
          lineNo - 8,
          lineNo + 18,
        );
      }
    },
  );

  const merged =
    mergeWindows(
      windows,
      lines.length,
    );

  const snippets =
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
    );

  const exports =
    lines
      .map(
        (line, index) => ({
          line:
            index + 1,

          text:
            line.trim(),
        }),
      )
      .filter(
        (row) =>
          row.text.startsWith(
            'export ',
          ),
      );

  return {
    file:
      relativeFile,

    exists:
      true,

    lineCount:
      lines.length,

    exports,

    snippets,

    simpleSignals: {
      marketDailyBarsMentions:
        (
          text.match(
            /market_daily_bars/g,
          ) ?? []
        ).length,

      marketIndexDailyBarsMentions:
        (
          text.match(
            /market_index_daily_bars/g,
          ) ?? []
        ).length,

      breadth20Mentions:
        (
          text.match(
            /breadth20/g,
          ) ?? []
        ).length,

      marketRegimeMentions:
        (
          text.match(
            /marketRegime/g,
          ) ?? []
        ).length,

      priceVolumeMentions:
        (
          text.match(
            /priceVolume/g,
          ) ?? []
        ).length,
    },
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
      (file) =>
        extractFile(
          root,
          file,
        ),
    );

  const report = {
    status:
      'ALPHA_V1_V7_REGIME_SOURCE_EXTRACT_COMPLETE',

    version:
      VERSION,

    targetFiles:
      TARGETS.length,

    filesFound:
      files.filter(
        (file) =>
          file.exists,
      ).length,

    filesMissing:
      files.filter(
        (file) =>
          !file.exists,
      ).map(
        (file) =>
          file.file,
      ),

    files,

    architecturalGoal: {
      alphaPriceVolume:
        'MARKET_DAILY_BARS_MULTI_DAY',

      alphaMarketRegime:
        'REUSE_EXISTING_V7_DAILY_BAR_IMPLEMENTATION_IF_CALLABLE',

      entryTiming:
        'KEEP_MARKET_SNAPSHOTS_INTRADAY',

      thresholdsChanged:
        false,

      weightsChanged:
        false,

      databaseWrites:
        0,
    },

    nextGate:
      'ALPHA_V1_IMPLEMENT_DAILY_BAR_ALPHA_ADAPTERS_WITH_EXACT_V7_CONTRACT',
  };

  const outputFile =
    path.join(
      root,
      'logs',
      'alpha-v1-v7-regime-source-extract.json',
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
      {
        status:
          report.status,

        version:
          report.version,

        targetFiles:
          report.targetFiles,

        filesFound:
          report.filesFound,

        filesMissing:
          report.filesMissing,

        exports:
          Object.fromEntries(
            files
              .filter(
                (file) =>
                  file.exists,
              )
              .map(
                (file) => [
                  file.file,
                  file.exports,
                ],
              ),
          ),

        signals:
          Object.fromEntries(
            files
              .filter(
                (file) =>
                  file.exists,
              )
              .map(
                (file) => [
                  file.file,
                  file.simpleSignals,
                ],
              ),
          ),

        nextGate:
          report.nextGate,

        outputFile:
          'logs/alpha-v1-v7-regime-source-extract.json',
      },
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
          'ALPHA_V1_V7_REGIME_SOURCE_EXTRACT_FAILED',

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
