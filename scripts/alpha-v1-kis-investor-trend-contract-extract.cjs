#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VERSION =
  'ALPHA_V1_KIS_INVESTOR_TREND_CONTRACT_EXTRACTOR';

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
      'kis',
      'client.ts',
    );

  const lines =
    fs
      .readFileSync(
        file,
        'utf8',
      )
      .split(/\r?\n/);

  const functionIndex =
    lines.findIndex(
      (line) =>
        line.includes(
          'getDomesticInvestorTrend',
        ),
    );

  if (
    functionIndex <
    0
  ) {
    throw new Error(
      'GET_DOMESTIC_INVESTOR_TREND_NOT_FOUND',
    );
  }

  const endpointIndexes =
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
            'inquire-investor',
          ) ||
          row.line.includes(
            'FHKST01010900',
          ),
      )
      .map(
        (row) =>
          row.index,
      );

  const from =
    Math.max(
      0,
      functionIndex -
      30,
    );

  const to =
    Math.min(
      lines.length,
      functionIndex +
      180,
    );

  const endpointWindows =
    endpointIndexes.map(
      (index) => ({
        from:
          Math.max(
            0,
            index -
            35,
          ),

        to:
          Math.min(
            lines.length,
            index +
            70,
          ),
      }),
    );

  const render =
    (
      start,
      end,
    ) =>
      lines
        .slice(
          start,
          end,
        )
        .map(
          (line, offset) =>
            `${start + offset + 1}: ${line}`,
        )
        .join('\n');

  const report = {
    status:
      'ALPHA_V1_KIS_INVESTOR_TREND_CONTRACT_EXTRACT_COMPLETE',

    version:
      VERSION,

    file:
      'lib/kis/client.ts',

    lineCount:
      lines.length,

    function: {
      firstMatchLine:
        functionIndex +
        1,

      snippet:
        render(
          from,
          to,
        ),
    },

    endpointReferences:
      endpointWindows.map(
        (
          window,
          index,
        ) => ({
          ordinal:
            index + 1,

          line:
            endpointIndexes[index] +
            1,

          snippet:
            render(
              window.from,
              window.to,
            ),
        }),
      ),

    questionsToResolve: [
      'FUNCTION_ARGUMENTS',
      'REQUEST_QUERY_PARAMS',
      'DATE_PARAMETER_SUPPORTED_OR_NOT',
      'PAGINATION_OR_CONTINUATION_SUPPORTED_OR_NOT',
      'FIXED_RECENT_30_ROWS_OR_HISTORICAL_CURSOR',
    ],

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
      'ALPHA_V1_DECIDE_HISTORICAL_FLOW_RECOVERY_PATH',
  };

  const outputFile =
    path.join(
      root,
      'logs',
      'alpha-v1-kis-investor-trend-contract-extract.json',
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
          'ALPHA_V1_KIS_INVESTOR_TREND_CONTRACT_EXTRACT_FAILED',

        version:
          VERSION,

        error:
          String(
            error?.message ??
            error,
          ),

        databaseWrites:
          0,

        networkRequests:
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
