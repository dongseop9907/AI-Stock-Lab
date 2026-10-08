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

const bad =
  '      rawRanking:\\n        ranking,\\n      diagnostics,\\n    });';

const good =
`      rawRanking:
        ranking,
      diagnostics,
    });`;

if (
  source.includes(
    bad,
  )
) {
  source =
    source.replace(
      bad,
      good,
    );
}

fs.writeFileSync(
  file,
  source,
  'utf8',
);

console.log(
  JSON.stringify(
    {
      status:
        'ALPHA_V1_COMPONENT_DIAG_NEWLINE_FIX_COMPLETE',
      changedFile:
        'scripts/alpha-v1-alpha-only-historical-replay-read-only.ts',
      thresholdsChanged:
        false,
      weightsChanged:
        false,
      nextAction:
        'RERUN_REPLAY_AND_COMPONENT_DIAG',
    },
    null,
    2,
  ),
);
