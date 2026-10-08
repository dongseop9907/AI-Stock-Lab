#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VERSION =
  'ALPHA_V1_DOWNSTREAM_PLUMBING_READ_ONLY_SMOKE_INSTALLER';

const smoke =
  "import fs from \"node:fs\";\nimport path from \"node:path\";\n\nimport {\n  createSupabaseServerClient,\n} from \"../lib/supabase\";\n\nimport {\n  getActiveEntryThreshold,\n} from \"../lib/trading/get-active-entry-threshold\";\n\nimport {\n  getLatestPredictionCandidates,\n  type PredictionCandidate,\n} from \"../lib/trading/get-latest-prediction-candidates\";\n\nimport {\n  calculateEntrySignal,\n  resolveEntryModel,\n  type SnapshotRecord,\n} from \"../lib/trading/generate-entry-signals\";\n\nimport {\n  evaluateReadOnlyBuyRiskPreflight,\n} from \"../lib/trading/read-only-buy-risk-preflight\";\n\nconst VERSION =\n  \"ALPHA_V1_DOWNSTREAM_PLUMBING_READ_ONLY_SMOKE\";\n\nconst ALPHA_LOG =\n  path.resolve(\n    process.cwd(),\n    \"logs\",\n    \"alpha-v1-real-runner-daily-alpha-read-only.json\",\n  );\n\nconst OUTPUT_FILE =\n  path.resolve(\n    process.cwd(),\n    \"logs\",\n    \"alpha-v1-downstream-plumbing-read-only-smoke.json\",\n  );\n\ninterface AlphaRankingRow {\n  rank: number;\n  stockCode: string;\n  stockName?: string;\n  score: number;\n  coverage: number;\n  quality: number;\n  scorerEligibleForEntryTiming: boolean;\n  blockingIssues?: string[];\n}\n\ninterface AlphaReport {\n  status: string;\n  decisionAt: string;\n  track: string;\n  ranking?: AlphaRankingRow[];\n  topRanking?: AlphaRankingRow[];\n  counts?: {\n    analyzedStocks?: number;\n    scorerEligible?: number;\n  };\n}\n\nfunction readJson(\n  file: string,\n) {\n  return JSON.parse(\n    fs.readFileSync(\n      file,\n      \"utf8\",\n    ),\n  );\n}\n\nfunction writeReport(\n  report: unknown,\n) {\n  fs.mkdirSync(\n    path.dirname(\n      OUTPUT_FILE,\n    ),\n    {\n      recursive: true,\n    },\n  );\n\n  fs.writeFileSync(\n    OUTPUT_FILE,\n    JSON.stringify(\n      report,\n      null,\n      2,\n    ) + \"\\n\",\n    \"utf8\",\n  );\n\n  console.log(\n    JSON.stringify(\n      report,\n      null,\n      2,\n    ),\n  );\n}\n\nasync function main() {\n  const alpha =\n    readJson(\n      ALPHA_LOG,\n    ) as AlphaReport;\n\n  const ranking =\n    alpha.ranking ??\n    alpha.topRanking ??\n    [];\n\n  if (\n    ranking.length ===\n    0\n  ) {\n    throw new Error(\n      \"ALPHA_RANKING_EMPTY_FOR_DOWNSTREAM_SMOKE\",\n    );\n  }\n\n  const diagnosticAlpha =\n    [...ranking].sort(\n      (\n        left,\n        right,\n      ) =>\n        left.rank -\n        right.rank,\n    )[0];\n\n  if (\n    !diagnosticAlpha\n  ) {\n    throw new Error(\n      \"DIAGNOSTIC_ALPHA_ROW_NOT_FOUND\",\n    );\n  }\n\n  const model =\n    await resolveEntryModel();\n\n  const entryScoreThreshold =\n    await getActiveEntryThreshold();\n\n  const predictionGate =\n    await getLatestPredictionCandidates({\n      maximumAgeMinutes:\n        180,\n\n      limit:\n        100,\n    });\n\n  const prediction =\n    predictionGate\n      .candidates\n      .find(\n        (\n          row: PredictionCandidate,\n        ) =>\n          row.stockCode ===\n          diagnosticAlpha.stockCode,\n      );\n\n  const supabase =\n    createSupabaseServerClient();\n\n  const snapshotResult =\n    await supabase\n      .from(\n        \"market_snapshots\",\n      )\n      .select(`\n        stock_code,\n        observed_at,\n        close_price,\n        open_price,\n        high_price,\n        low_price,\n        volume\n      `)\n      .eq(\n        \"stock_code\",\n        diagnosticAlpha.stockCode,\n      )\n      .lte(\n        \"observed_at\",\n        new Date()\n          .toISOString(),\n      )\n      .order(\n        \"observed_at\",\n        {\n          ascending:\n            false,\n        },\n      )\n      .limit(\n        1000,\n      );\n\n  if (\n    snapshotResult.error\n  ) {\n    throw new Error(\n      `DOWNSTREAM_SMOKE_SNAPSHOT_READ_FAILED:${snapshotResult.error.message}`,\n    );\n  }\n\n  const snapshots =\n    (\n      snapshotResult.data ??\n      []\n    ) as SnapshotRecord[];\n\n  const entryCandidate =\n    prediction\n      ? calculateEntrySignal(\n          snapshots,\n          prediction,\n          entryScoreThreshold,\n        )\n      : null;\n\n  let riskPreflight:\n    Awaited<\n      ReturnType<\n        typeof evaluateReadOnlyBuyRiskPreflight\n      >\n    > |\n    null =\n    null;\n\n  if (\n    entryCandidate\n  ) {\n    riskPreflight =\n      await evaluateReadOnlyBuyRiskPreflight({\n        stockCode:\n          entryCandidate.stockCode,\n\n        modelId:\n          model.id,\n\n        entryPrice:\n          entryCandidate.entryPrice,\n\n        proposedStopPrice:\n          entryCandidate.stopPrice,\n\n        requestedQuantity:\n          entryCandidate.quantity,\n\n        entryObservedAt:\n          entryCandidate.observedAt,\n      });\n  }\n\n  const report = {\n    status:\n      \"ALPHA_V1_DOWNSTREAM_PLUMBING_READ_ONLY_SMOKE_COMPLETE\",\n\n    version:\n      VERSION,\n\n    alpha: {\n      status:\n        alpha.status,\n\n      decisionAt:\n        alpha.decisionAt,\n\n      track:\n        alpha.track,\n\n      actualScorerEligible:\n        diagnosticAlpha\n          .scorerEligibleForEntryTiming,\n\n      diagnosticOverride:\n        true,\n\n      overrideReason:\n        \"TEST_DOWNSTREAM_WIRING_WITHOUT_CHANGING_ALPHA_POLICY\",\n\n      row: {\n        rank:\n          diagnosticAlpha.rank,\n\n        stockCode:\n          diagnosticAlpha.stockCode,\n\n        stockName:\n          diagnosticAlpha.stockName ??\n          null,\n\n        score:\n          diagnosticAlpha.score,\n\n        coverage:\n          diagnosticAlpha.coverage,\n\n        quality:\n          diagnosticAlpha.quality,\n\n        blockingIssues:\n          diagnosticAlpha\n            .blockingIssues ??\n          [],\n      },\n    },\n\n    entryTiming: {\n      invoked:\n        Boolean(\n          prediction,\n        ),\n\n      model: {\n        id:\n          model.id,\n\n        name:\n          model.model_name,\n\n        version:\n          model.model_version,\n\n        purpose:\n          model.purpose,\n\n        status:\n          model.status,\n      },\n\n      threshold:\n        entryScoreThreshold,\n\n      predictionGateReason:\n        predictionGate.reason,\n\n      predictionAvailable:\n        Boolean(\n          prediction,\n        ),\n\n      snapshotCount:\n        snapshots.length,\n\n      candidate:\n        entryCandidate,\n\n      actualQualifies:\n        entryCandidate\n          ?.qualifies ??\n        false,\n    },\n\n    riskPreflight: {\n      invoked:\n        Boolean(\n          riskPreflight,\n        ),\n\n      result:\n        riskPreflight,\n    },\n\n    production: {\n      alphaPolicyChanged:\n        false,\n\n      alphaThresholdLowered:\n        false,\n\n      entryThresholdChanged:\n        false,\n\n      riskPolicyChanged:\n        false,\n\n      productionExecutionEligible:\n        false,\n\n      reason:\n        \"DIAGNOSTIC_OVERRIDE_MUST_NEVER_CREATE_EXECUTION_ELIGIBILITY\",\n    },\n\n    contract: {\n      alpha:\n        \"REAL_ALPHA_ROW_DIAGNOSTIC_OVERRIDE_ONLY\",\n\n      entryTiming:\n        \"EXISTING_CALCULATE_ENTRY_SIGNAL\",\n\n      risk:\n        \"EXISTING_VALIDATE_BUY_RISK_VIA_READ_ONLY_PREFLIGHT\",\n\n      purpose:\n        \"VERIFY_DOWNSTREAM_WIRING_BEFORE_HISTORICAL_REPLAY\",\n    },\n\n    safety: {\n      databaseWrites:\n        0,\n\n      aiEntrySignalWrites:\n        0,\n\n      riskDecisionWrites:\n        0,\n\n      paperOrderWrites:\n        0,\n\n      ordersCreated:\n        0,\n\n      positionsChanged:\n        0,\n\n      productionDecisionApplied:\n        false,\n    },\n\n    nextGate:\n      entryCandidate &&\n      riskPreflight\n        ? \"ALPHA_V1_HISTORICAL_READ_ONLY_PIPELINE_VALIDATION\"\n        : \"REVIEW_DOWNSTREAM_SMOKE_MISSING_ENTRY_OR_RISK_RESULT\",\n\n    outputFile:\n      \"logs/alpha-v1-downstream-plumbing-read-only-smoke.json\",\n  };\n\n  writeReport(\n    report,\n  );\n}\n\nmain().catch(\n  (\n    error,\n  ) => {\n    console.error(\n      JSON.stringify(\n        {\n          status:\n            \"ALPHA_V1_DOWNSTREAM_PLUMBING_READ_ONLY_SMOKE_FAILED\",\n\n          version:\n            VERSION,\n\n          error:\n            String(\n              error instanceof Error\n                ? error.message\n                : error,\n            ),\n\n          safety: {\n            databaseWrites:\n              0,\n\n            aiEntrySignalWrites:\n              0,\n\n            riskDecisionWrites:\n              0,\n\n            paperOrderWrites:\n              0,\n\n            ordersCreated:\n              0,\n          },\n        },\n        null,\n        2,\n      ),\n    );\n\n    process.exitCode =\n      2;\n  },\n);\n";

function atomicWrite(
  file,
  content,
) {
  fs.mkdirSync(
    path.dirname(file),
    {
      recursive:
        true,
    },
  );

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
  const root =
    path.resolve(
      __dirname,
      '..',
    );

  const target =
    path.join(
      root,
      'scripts',
      'alpha-v1-downstream-plumbing-read-only-smoke.ts',
    );

  atomicWrite(
    target,
    smoke,
  );

  console.log(
    JSON.stringify(
      {
        status:
          'ALPHA_V1_DOWNSTREAM_PLUMBING_READ_ONLY_SMOKE_INSTALLED',

        version:
          VERSION,

        generatedFile:
          'scripts/alpha-v1-downstream-plumbing-read-only-smoke.ts',

        behavior: {
          alphaGateBypassedForDiagnosticOnly:
            true,

          productionEligibilityGranted:
            false,

          alphaThresholdLowered:
            false,

          entryThresholdChanged:
            false,

          riskPolicyChanged:
            false,

          usesExistingEntryCalculator:
            true,

          usesExistingRiskValidator:
            true,
        },

        safety: {
          databaseWrites:
            0,

          aiEntrySignalWrites:
            0,

          riskDecisionWrites:
            0,

          paperOrderWrites:
            0,

          ordersCreated:
            0,

          positionsChanged:
            0,
        },

        nextAction:
          'RUN_DOWNSTREAM_PLUMBING_READ_ONLY_SMOKE',
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
          'ALPHA_V1_DOWNSTREAM_PLUMBING_READ_ONLY_SMOKE_INSTALL_FAILED',

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
