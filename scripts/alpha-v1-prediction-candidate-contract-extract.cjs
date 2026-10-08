#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VERSION =
  'ALPHA_V1_PREDICTION_CANDIDATE_CONTRACT_EXTRACTOR';

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
      'get-latest-prediction-candidates.ts',
    );

  if (!fs.existsSync(file)) {
    throw new Error(
      'GET_LATEST_PREDICTION_CANDIDATES_FILE_NOT_FOUND',
    );
  }

  const lines =
    fs
      .readFileSync(
        file,
        'utf8',
      )
      .split(/\r?\n/);

  const report = {
    status:
      'ALPHA_V1_PREDICTION_CANDIDATE_CONTRACT_EXTRACT_COMPLETE',

    version:
      VERSION,

    file:
      'lib/trading/get-latest-prediction-candidates.ts',

    lineCount:
      lines.length,

    fullSource:
      lines
        .map(
          (
            line,
            index,
          ) =>
            `${index + 1}: ${line}`,
        )
        .join('\n'),

    safety: {
      databaseReads:
        0,

      databaseWrites:
        0,

      networkRequests:
        0,

      ordersCreated:
        0,
    },

    nextGate:
      'ALPHA_V1_BUILD_DIAGNOSTIC_RAW_PREDICTION_DOWNSTREAM_SMOKE',
  };

  const output =
    path.join(
      root,
      'logs',
      'alpha-v1-prediction-candidate-contract-extract.json',
    );

  fs.mkdirSync(
    path.dirname(output),
    {
      recursive:
        true,
    },
  );

  fs.writeFileSync(
    output,
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
          'ALPHA_V1_PREDICTION_CANDIDATE_CONTRACT_EXTRACT_FAILED',

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
