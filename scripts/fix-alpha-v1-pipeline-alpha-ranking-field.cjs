#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VERSION =
  'ALPHA_V1_PIPELINE_ALPHA_RANKING_FIELD_FIX';

const TARGET =
  path.resolve(
    __dirname,
    '..',
    'scripts',
    'alpha-v1-alpha-entry-risk-read-only-pipeline.ts',
  );

function replaceOnce(
  text,
  before,
  after,
  label,
) {
  const count =
    text.split(before).length - 1;

  if (count !== 1) {
    throw new Error(
      `${label}_EXPECTED_ONCE_GOT_${count}`,
    );
  }

  return text.replace(
    before,
    after,
  );
}

function atomicWrite(
  file,
  content,
) {
  const temp =
    `${file}.tmp-${process.pid}-${Date.now()}`;

  fs.writeFileSync(
    temp,
    content,
    'utf8',
  );

  fs.renameSync(
    temp,
    file,
  );
}

try {
  let code =
    fs.readFileSync(
      TARGET,
      'utf8',
    );

  code =
    replaceOnce(
      code,
      `  topRanking: AlphaRankingRow[];
}`,
      `  ranking?: AlphaRankingRow[];
  topRanking?: AlphaRankingRow[];
}`,
      'ALPHA_REPORT_RANKING_SCHEMA',
    );

  code =
    replaceOnce(
      code,
      `  const alphaEligible =
    (
      alpha.topRanking ??
      []
    )
      .filter(`,
      `  const alphaRanking =
    (
      alpha.ranking ??
      alpha.topRanking ??
      []
    );

  const analyzedStocks =
    Number(
      (
        alpha as any
      )
        ?.counts
        ?.analyzedStocks ??
      0,
    );

  if (
    analyzedStocks >
      0 &&
    alphaRanking.length ===
      0
  ) {
    throw new Error(
      \`ALPHA_RANKING_INTEGRITY_FAILED:analyzed=\${analyzedStocks}:ranking=0\`,
    );
  }

  const alphaEligible =
    alphaRanking
      .filter(`,
      'ALPHA_RANKING_NORMALIZATION',
    );

  code =
    replaceOnce(
      code,
      `      topRanking:
        (
          alpha.topRanking ??
          []
        ).map(`,
      `      rankingFieldUsed:
        alpha.ranking
          ? "ranking"
          : alpha.topRanking
          ? "topRanking"
          : "none",

      analyzedStocks,

      rankingCount:
        alphaRanking.length,

      topRanking:
        alphaRanking.map(`,
      'ALPHA_SUMMARY_RANKING',
    );

  atomicWrite(
    TARGET,
    code,
  );

  console.log(
    JSON.stringify(
      {
        status:
          'ALPHA_V1_PIPELINE_ALPHA_RANKING_FIELD_FIX_COMPLETE',

        version:
          VERSION,

        changedFile:
          'scripts/alpha-v1-alpha-entry-risk-read-only-pipeline.ts',

        rootCause: {
          actualAlphaField:
            'ranking',

          pipelineExpectedField:
            'topRanking',

          effect:
            'VALID_5_ROW_ALPHA_RANKING_WAS_NORMALIZED_TO_EMPTY_ARRAY',
        },

        fix: {
          preferredField:
            'ranking',

          backwardCompatibleFallback:
            'topRanking',

          integrityGate:
            'IF_ANALYZED_STOCKS_GT_0_AND_RANKING_EMPTY_THROW_ERROR',

          alphaThresholdChanged:
            false,

          entryFormulaChanged:
            false,

          riskFormulaChanged:
            false,
        },

        safety: {
          databaseWrites:
            0,

          entrySignalWrites:
            0,

          riskDecisionWrites:
            0,

          orderWrites:
            0,

          ordersCreated:
            0,

          positionsChanged:
            0,
        },

        nextAction:
          'RERUN_ALPHA_ENTRY_RISK_READ_ONLY_PIPELINE',
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    JSON.stringify(
      {
        status:
          'ALPHA_V1_PIPELINE_ALPHA_RANKING_FIELD_FIX_FAILED',

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

  process.exitCode = 2;
}
