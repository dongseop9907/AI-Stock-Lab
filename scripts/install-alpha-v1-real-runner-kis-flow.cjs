#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VERSION =
  'ALPHA_V1_BIND_KIS_FLOW_TO_REAL_RUNNER_INSTALLER';

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

  const sourceFile =
    path.join(
      root,
      'scripts',
      'alpha-v1-real-runner-db-read-only.ts',
    );

  const targetFile =
    path.join(
      root,
      'scripts',
      'alpha-v1-real-runner-kis-flow-read-only.ts',
    );

  if (!fs.existsSync(sourceFile)) {
    throw new Error(
      `SOURCE_RUNNER_NOT_FOUND:${sourceFile}`,
    );
  }

  let code =
    fs.readFileSync(
      sourceFile,
      'utf8',
    );

  // ------------------------------------------------------------
  // Version / output identity
  // ------------------------------------------------------------

  code =
    replaceOnce(
      code,
      `const VERSION =
  "ALPHA_V1_REAL_RUNNER_DB_READ_ONLY";`,
      `const VERSION =
  "ALPHA_V1_REAL_RUNNER_KIS_FLOW_READ_ONLY";`,
      'PATCH_VERSION',
    );

  // ------------------------------------------------------------
  // Imports
  // ------------------------------------------------------------

  code =
    replaceOnce(
      code,
      `import {
  buildEventPersistenceEvidence,
  type PredictionHistoryLike,
} from "../lib/alpha/confirmed-source-adapters";`,
      `import {
  buildEventPersistenceEvidence,
  type PredictionHistoryLike,
} from "../lib/alpha/confirmed-source-adapters";

import {
  buildKisInvestorFlowEvidence,
} from "../lib/alpha/kis-flow-adapter";

import {
  getDomesticInvestorTrend,
  getKisAccessToken,
  type KisDomesticInvestorTrendOutput,
} from "../lib/kis/client";`,
      'PATCH_IMPORTS',
    );

  // ------------------------------------------------------------
  // Constants + sleep
  // ------------------------------------------------------------

  code =
    replaceOnce(
      code,
      `const PREDICTION_FRESH_MINUTES = 180;`,
      `const PREDICTION_FRESH_MINUTES = 180;

const KIS_FLOW_REQUEST_DELAY_MS =
  700;`,
      'PATCH_CONSTANTS',
    );

  code =
    replaceOnce(
      code,
      `type JsonRecord =
  Record<string, unknown>;`,
      `type JsonRecord =
  Record<string, unknown>;

function sleep(
  milliseconds: number,
) {
  return new Promise(
    (resolve) => {
      setTimeout(
        resolve,
        milliseconds,
      );
    },
  );
}`,
      'PATCH_SLEEP',
    );

  // ------------------------------------------------------------
  // Add KIS flow fetch helper before printCompact()
  // ------------------------------------------------------------

  const fetchHelper = `
async function readKisInvestorFlow(
  stockCodes: string[],
): Promise<{
  byStock: Map<
    string,
    KisDomesticInvestorTrendOutput[]
  >;
  attempted: number;
  successful: number;
  failed: number;
  errors: Array<{
    stockCode: string;
    error: string;
  }>;
}> {
  const byStock =
    new Map<
      string,
      KisDomesticInvestorTrendOutput[]
    >();

  const errors:
    Array<{
      stockCode: string;
      error: string;
    }> = [];

  const accessToken =
    await getKisAccessToken();

  let successful = 0;
  let failed = 0;

  for (
    let index = 0;
    index < stockCodes.length;
    index += 1
  ) {
    const stockCode =
      stockCodes[index];

    try {
      const response =
        await getDomesticInvestorTrend(
          stockCode,
          accessToken,
        );

      const rows =
        Array.isArray(
          response.output,
        )
          ? response.output
          : [];

      byStock.set(
        stockCode,
        rows,
      );

      successful += 1;
    } catch (error) {
      failed += 1;

      errors.push({
        stockCode,

        error:
          String(
            error instanceof Error
              ? error.message
              : error,
          ),
      });
    }

    if (
      index <
      stockCodes.length - 1
    ) {
      await sleep(
        KIS_FLOW_REQUEST_DELAY_MS,
      );
    }
  }

  return {
    byStock,

    attempted:
      stockCodes.length,

    successful,

    failed,

    errors,
  };
}

`;

  code =
    replaceOnce(
      code,
      `function printCompact(
  value: unknown,
) {`,
      `${fetchHelper}function printCompact(
  value: unknown,
) {`,
      'PATCH_FETCH_HELPER',
    );

  // ------------------------------------------------------------
  // Fetch KIS flow after stock universe is known.
  // ------------------------------------------------------------

  code =
    replaceOnce(
      code,
      `  const regime =
    computeMarketRegimeProxy(
      snapshots,
      stockCodes,
    );

  const inputs =`,
      `  const regime =
    computeMarketRegimeProxy(
      snapshots,
      stockCodes,
    );

  const kisFlow =
    await readKisInvestorFlow(
      stockCodes,
    );

  for (
    const error
    of kisFlow.errors
  ) {
    warnings.push(
      \`KIS_FLOW_READ_FAILED:\${error.stockCode}:\${error.error}\`,
    );
  }

  const inputs =`,
      'PATCH_KIS_FETCH',
    );

  // ------------------------------------------------------------
  // Build real flow evidence and inject into candidate input.
  // ------------------------------------------------------------

  code =
    replaceOnce(
      code,
      `        const eventPersistence =
          buildEventPersistenceEvidence({
            stockCode,

            decisionAt:
              config.decisionAt,

            predictions:
              predictionResult.normalized,

            lookbackHours:
              72,
          });

        const candidateInput =
          buildAlphaCandidateInputFromRealSources({`,
      `        const eventPersistence =
          buildEventPersistenceEvidence({
            stockCode,

            decisionAt:
              config.decisionAt,

            predictions:
              predictionResult.normalized,

            lookbackHours:
              72,
          });

        const flowEvidence =
          buildKisInvestorFlowEvidence({
            decisionAt:
              config.decisionAt,

            rows:
              kisFlow.byStock.get(
                stockCode,
              ) ?? [],

            lookbackRows:
              7,
          });

        const candidateInput =
          buildAlphaCandidateInputFromRealSources({`,
      'PATCH_FLOW_EVIDENCE',
    );

  code =
    replaceOnce(
      code,
      `          /**
           * No confirmed investor flow source yet.
           */
          flowEvidence:
            undefined,`,
      `          flowEvidence,`,
      'PATCH_FLOW_BINDING',
    );

  // ------------------------------------------------------------
  // Dynamic execution blockers: flow blocker only if unavailable.
  // ------------------------------------------------------------

  code =
    replaceOnce(
      code,
      `          executionBlockers: [
            "READ_ONLY_DIAGNOSTIC_RUN",
            "FLOW_SOURCE_NOT_CONNECTED",
            "RISK_VALIDATION_NOT_BOUND_TO_PROPOSED_TRADE",
          ],`,
      `          executionBlockers: [
            "READ_ONLY_DIAGNOSTIC_RUN",

            ...(
              featurePresence.flow
                ? []
                : [
                    "FLOW_SOURCE_UNAVAILABLE_FOR_STOCK",
                  ]
            ),

            "RISK_VALIDATION_NOT_BOUND_TO_PROPOSED_TRADE",
          ],`,
      'PATCH_EXECUTION_BLOCKERS',
    );

  // ------------------------------------------------------------
  // Source status + counts
  // ------------------------------------------------------------

  code =
    replaceOnce(
      code,
      `      flow:
        "UNAVAILABLE_NO_CONFIRMED_SOURCE",`,
      `      flow:
        kisFlow.successful ===
          stockCodes.length
          ? "CONNECTED_KIS_INQUIRE_INVESTOR"
          : "PARTIAL_KIS_INQUIRE_INVESTOR",`,
      'PATCH_SOURCE_STATUS',
    );

  code =
    replaceOnce(
      code,
      `      executionEligible:
        0,
    },

    ranking:
      diagnosticRows,`,
      `      executionEligible:
        0,

      flowRequestsAttempted:
        kisFlow.attempted,

      flowRequestsSuccessful:
        kisFlow.successful,

      flowRequestsFailed:
        kisFlow.failed,

      stocksWithFlowEvidence:
        inputs.filter(
          (input) =>
            Boolean(
              input.features.flow,
            ),
        ).length,
    },

    flowDiagnostics:
      inputs.map(
        (input) => ({
          stockCode:
            input.stockCode,

          present:
            Boolean(
              input.features.flow,
            ),

          score:
            input.features.flow
              ?.score ??
            null,

          confidence:
            input.features.flow
              ?.confidence ??
            null,

          source:
            input.features.flow
              ?.source ??
            null,

          latestCompletedTradingDate:
            input.features.flow
              ?.metadata
              ?.latestCompletedTradingDate ??
            null,

          usableRows:
            input.features.flow
              ?.metadata
              ?.usableRows ??
            null,

          basisAmountRows:
            input.features.flow
              ?.metadata
              ?.amountRows ??
            null,

          basisQuantityFallbackRows:
            input.features.flow
              ?.metadata
              ?.quantityFallbackRows ??
            null,
        }),
      ),

    ranking:
      diagnosticRows,`,
      'PATCH_COUNTS_AND_DIAGNOSTICS',
    );

  // ------------------------------------------------------------
  // Safety accounting.
  // DB writes/orders remain zero.
  // ------------------------------------------------------------

  code =
    replaceOnce(
      code,
      `      networkRequests:
        3,`,
      `      networkRequests:
        3 +
        1 +
        kisFlow.attempted,

      supabaseReadRequests:
        3,

      kisTokenRequests:
        1,

      kisInvestorRequests:
        kisFlow.attempted,`,
      'PATCH_SAFETY_REQUESTS',
    );

  // ------------------------------------------------------------
  // Next gate / output file
  // ------------------------------------------------------------

  code =
    replaceOnce(
      code,
      `    nextGate:
      "ALPHA_V1_REVIEW_REAL_RANKING_THEN_ADD_FLOW_SOURCE_OR_PRE_ENTRY_RISK_BINDING",`,
      `    nextGate:
      "ALPHA_V1_REVIEW_FULL_FEATURE_RANKING_THEN_BIND_PRE_ENTRY_RISK",`,
      'PATCH_NEXT_GATE',
    );

  code =
    replaceOnce(
      code,
      `"alpha-v1-real-runner-db-read-only.json",`,
      `"alpha-v1-real-runner-kis-flow-read-only.json",`,
      'PATCH_OUTPUT_PATH',
    );

  code =
    replaceOnce(
      code,
      `      "logs/alpha-v1-real-runner-db-read-only.json",`,
      `      "logs/alpha-v1-real-runner-kis-flow-read-only.json",`,
      'PATCH_OUTPUT_DISPLAY',
    );

  fs.writeFileSync(
    targetFile,
    code,
    'utf8',
  );

  console.log(
    JSON.stringify(
      {
        status:
          'ALPHA_V1_KIS_FLOW_BOUND_REAL_RUNNER_INSTALLED',

        version:
          VERSION,

        sourceRunner:
          'scripts/alpha-v1-real-runner-db-read-only.ts',

        newRunner:
          'scripts/alpha-v1-real-runner-kis-flow-read-only.ts',

        flowContract: {
          source:
            'KIS_INQUIRE_INVESTOR',

          trId:
            'FHKST01010900',

          flowWeight:
            0.20,

          completedTradingDaysOnly:
            true,

          preferredNormalization:
            'NET_BUY_TRADING_AMOUNT',

          lookbackRows:
            7,
        },

        unchanged: {
          stableThreshold:
            0.68,

          aggressiveThreshold:
            0.60,

          riskPolicy:
            'DEFER_TO_PREFLIGHT',

          executionEligible:
            false,
        },

        safety: {
          databaseWrites:
            0,

          ordersCreated:
            0,

          positionsChanged:
            0,

          productionDecisionApplied:
            false,
        },

        nextAction:
          'RUN_ALPHA_V1_REAL_RUNNER_WITH_KIS_FLOW',
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
          'ALPHA_V1_BIND_KIS_FLOW_TO_REAL_RUNNER_INSTALL_FAILED',

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
