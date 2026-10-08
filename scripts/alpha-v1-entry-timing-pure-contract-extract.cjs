#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VERSION =
  'ALPHA_V1_ENTRY_TIMING_PURE_CONTRACT_EXTRACTOR';

function main() {
  const root =
    path.resolve(
      __dirname,
      '..',
    );

  const file =
    path.join(
      root,
      'lib',
      'trading',
      'generate-entry-signals.ts',
    );

  const lines =
    fs
      .readFileSync(
        file,
        'utf8',
      )
      .split(/\r?\n/);

  const declarationIndex =
    lines.findIndex(
      (line) =>
        line.includes(
          'function calculateEntrySignal(',
        ),
    );

  if (
    declarationIndex <
    0
  ) {
    throw new Error(
      'CALCULATE_ENTRY_SIGNAL_DECLARATION_NOT_FOUND',
    );
  }

  const callIndexes =
    lines
      .map(
        (line, index) => ({
          line,
          index,
        }),
      )
      .filter(
        (row) =>
          row.line.includes(
            'calculateEntrySignal(',
          ) &&
          row.index !==
            declarationIndex,
      )
      .map(
        (row) =>
          row.index,
      );

  const declarationFrom =
    Math.max(
      0,
      declarationIndex -
      12,
    );

  const declarationTo =
    Math.min(
      lines.length,
      declarationIndex +
      55,
    );

  const callWindows =
    callIndexes.map(
      (index) => ({
        from:
          Math.max(
            0,
            index -
            18,
          ),

        to:
          Math.min(
            lines.length,
            index +
            28,
          ),
      }),
    );

  const render =
    (
      from,
      to,
    ) =>
      lines
        .slice(
          from,
          to,
        )
        .map(
          (line, offset) =>
            `${from + offset + 1}: ${line}`,
        )
        .join('\n');

  const report = {
    status:
      'ALPHA_V1_ENTRY_TIMING_PURE_CONTRACT_EXTRACT_COMPLETE',

    version:
      VERSION,

    file:
      'lib/trading/generate-entry-signals.ts',

    lineCount:
      lines.length,

    declaration: {
      line:
        declarationIndex +
        1,

      snippet:
        render(
          declarationFrom,
          declarationTo,
        ),
    },

    callSites:
      callWindows.map(
        (
          window,
          index,
        ) => ({
          ordinal:
            index + 1,

          line:
            callIndexes[index] +
            1,

          snippet:
            render(
              window.from,
              window.to,
            ),
        }),
      ),

    intendedNextRefactor: {
      productionBehaviorChange:
        false,

      intendedChange:
        'EXPORT_EXISTING_PURE_CALCULATOR_WITHOUT_CHANGING_FORMULA',

      readOnlyPipeline:
        [
          'ALPHA_CANDIDATE',
          'EXISTING_ENTRY_TIMING_CALCULATOR',
          'READ_ONLY_BUY_RISK_PREFLIGHT',
        ],

      duplicateEntryFormula:
        false,

      writes:
        0,
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
      'ALPHA_V1_EXPORT_ENTRY_TIMING_PURE_CALCULATOR_AND_BUILD_READ_ONLY_PIPELINE',
  };

  const outputFile =
    path.join(
      root,
      'logs',
      'alpha-v1-entry-timing-pure-contract-extract.json',
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
          'ALPHA_V1_ENTRY_TIMING_PURE_CONTRACT_EXTRACT_FAILED',

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
