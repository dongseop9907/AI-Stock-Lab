#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root =
  path.resolve(
    __dirname,
    '..',
  );

const file =
  path.join(
    root,
    'scripts',
    'alpha-v1-alpha-only-historical-replay-read-only.ts',
  );

let source =
  fs.readFileSync(
    file,
    'utf8',
  );

const before =
  'score:\n              row.finalScore,';

const after =
  'score:\n              row.score,';

if (!source.includes(before)) {
  console.error(
    JSON.stringify(
      {
        status:
          'ALPHA_V1_REPLAY_SCORE_FIELD_FIX_NOT_APPLIED',
        reason:
          'EXPECTED_FINAL_SCORE_MAPPING_NOT_FOUND',
      },
      null,
      2,
    ),
  );

  process.exitCode = 2;
} else {
  source =
    source.replace(
      before,
      after,
    );

  fs.writeFileSync(
    file,
    source,
    'utf8',
  );

  console.log(
    JSON.stringify(
      {
        status:
          'ALPHA_V1_REPLAY_SCORE_FIELD_FIX_COMPLETE',
        changedFile:
          'scripts/alpha-v1-alpha-only-historical-replay-read-only.ts',
        change:
          'row.finalScore -> row.score',
        thresholdsChanged:
          false,
        weightsChanged:
          false,
        nextAction:
          'RERUN_ALPHA_ONLY_REPLAY_THEN_DISTRIBUTION_DIAG',
      },
      null,
      2,
    ),
  );
}
