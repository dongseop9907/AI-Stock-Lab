#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VERSION =
  'ALPHA_V1_REAL_RUNNER_FEATURE_BREAKDOWN_PATCH';

function replaceOnce(
  text,
  needle,
  replacement,
  label,
) {
  const count =
    text.split(needle).length - 1;

  if (count !== 1) {
    throw new Error(
      `${label}_EXPECTED_ONCE_GOT_${count}`,
    );
  }

  return text.replace(
    needle,
    replacement,
  );
}

function main() {
  const root =
    path.resolve(__dirname, '..');

  const file =
    path.join(
      root,
      'scripts',
      'alpha-v1-real-runner-kis-flow-read-only.ts',
    );

  if (!fs.existsSync(file)) {
    throw new Error(
      `FILE_NOT_FOUND:${file}`,
    );
  }

  let code =
    fs.readFileSync(
      file,
      'utf8',
    );

  // Fix the completion identity so log status matches the runner version.
  code =
    replaceOnce(
      code,
      `status:
      "ALPHA_V1_REAL_RUNNER_DB_READ_ONLY_COMPLETE",`,
      `status:
      "ALPHA_V1_REAL_RUNNER_KIS_FLOW_READ_ONLY_COMPLETE",`,
      'PATCH_STATUS_IDENTITY',
    );

  // Capture the candidate input once for feature-level diagnostics.
  code =
    replaceOnce(
      code,
      `        const featurePresence =
          (
            inputs.find(
              (input) =>
                input.stockCode ===
                row.stockCode,
            )
              ?.metadata as`,
      `        const sourceInput =
          inputs.find(
            (input) =>
              input.stockCode ===
              row.stockCode,
          );

        const featurePresence =
          (
            sourceInput
              ?.metadata as`,
      'PATCH_SOURCE_INPUT',
    );

  // Add complete raw feature evidence next to featurePresence.
  code =
    replaceOnce(
      code,
      `          featurePresence,

          blockingIssues:
            row.blockingIssues,`,
      `          featurePresence,

          featureBreakdown:
            Object.fromEntries(
              Object.entries(
                sourceInput?.features ??
                {},
              ).map(
                ([name, evidence]) => [
                  name,
                  evidence
                    ? {
                        score:
                          evidence.score,

                        confidence:
                          evidence.confidence,

                        source:
                          evidence.source,

                        sourceVersion:
                          evidence.sourceVersion ??
                          null,

                        availableAt:
                          evidence.availableAt,

                        observedAt:
                          evidence.observedAt ??
                          null,

                        maxAgeMinutes:
                          evidence.maxAgeMinutes ??
                          null,
                      }
                    : null,
                ],
              ),
            ),

          blockingIssues:
            row.blockingIssues,`,
      'PATCH_FEATURE_BREAKDOWN',
    );

  fs.writeFileSync(
    file,
    code,
    'utf8',
  );

  console.log(
    JSON.stringify(
      {
        status:
          'ALPHA_V1_REAL_RUNNER_FEATURE_BREAKDOWN_PATCH_COMPLETE',

        version:
          VERSION,

        changedFile:
          'scripts/alpha-v1-real-runner-kis-flow-read-only.ts',

        additions: [
          'CORRECT_KIS_FLOW_RUNNER_COMPLETION_STATUS',
          'PER_STOCK_RAW_FEATURE_SCORE',
          'PER_STOCK_FEATURE_CONFIDENCE',
          'PER_STOCK_FEATURE_SOURCE',
          'PER_STOCK_FEATURE_AVAILABLE_AT',
          'PER_STOCK_FEATURE_MAX_AGE',
        ],

        thresholdsChanged:
          false,

        weightsChanged:
          false,

        riskPolicyChanged:
          false,

        safety: {
          databaseWrites:
            0,

          ordersCreated:
            0,

          positionsChanged:
            0,
        },

        nextAction:
          'RERUN_ALPHA_V1_REAL_RUNNER_WITH_KIS_FLOW_FOR_FEATURE_BREAKDOWN',
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
          'ALPHA_V1_REAL_RUNNER_FEATURE_BREAKDOWN_PATCH_FAILED',

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
