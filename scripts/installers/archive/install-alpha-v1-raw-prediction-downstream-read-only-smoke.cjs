#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VERSION =
  'ALPHA_V1_RAW_PREDICTION_DOWNSTREAM_READ_ONLY_SMOKE_INSTALLER';

const smoke =
  "import fs from \"node:fs\";\nimport path from \"node:path\";\n\nimport {\n  createSupabaseServerClient,\n} from \"../lib/supabase\";\n\nimport {\n  getActiveEntryThreshold,\n} from \"../lib/trading/get-active-entry-threshold\";\n\nimport type {\n  PredictionCandidate,\n} from \"../lib/trading/get-latest-prediction-candidates\";\n\nimport {\n  calculateEntrySignal,\n  resolveEntryModel,\n  type SnapshotRecord,\n} from \"../lib/trading/generate-entry-signals\";\n\nimport {\n  evaluateReadOnlyBuyRiskPreflight,\n} from \"../lib/trading/read-only-buy-risk-preflight\";\n\nconst VERSION =\n  \"ALPHA_V1_RAW_PREDICTION_DOWNSTREAM_READ_ONLY_SMOKE\";\n\nconst ALPHA_LOG =\n  path.resolve(\n    process.cwd(),\n    \"logs\",\n    \"alpha-v1-real-runner-daily-alpha-read-only.json\",\n  );\n\nconst OUTPUT_FILE =\n  path.resolve(\n    process.cwd(),\n    \"logs\",\n    \"alpha-v1-raw-prediction-downstream-read-only-smoke.json\",\n  );\n\ninterface AlphaRankingRow {\n  rank: number;\n  stockCode: string;\n  stockName?: string;\n  score: number;\n  coverage: number;\n  quality: number;\n  scorerEligibleForEntryTiming: boolean;\n  blockingIssues?: string[];\n}\n\ninterface AlphaReport {\n  status: string;\n  decisionAt: string;\n  track: string;\n  ranking?: AlphaRankingRow[];\n  topRanking?: AlphaRankingRow[];\n}\n\ninterface LatestPredictionRecord {\n  prediction_date: string;\n  generated_at: string;\n  model_name: string;\n  model_version: string;\n}\n\ninterface RawPredictionRecord {\n  id: string;\n  stock_code: string;\n  prediction_date: string;\n  generated_at: string;\n  model_name: string;\n  model_version: string;\n\n  score:\n    | number\n    | string;\n\n  confidence:\n    | number\n    | string;\n\n  direction:\n    | \"UP\"\n    | \"NEUTRAL\"\n    | \"DOWN\";\n\n  is_candidate:\n    boolean;\n\n  disclosure_score:\n    | number\n    | string\n    | null;\n\n  price_momentum:\n    | number\n    | string\n    | null;\n\n  intraday_return:\n    | number\n    | string\n    | null;\n\n  volume_ratio:\n    | number\n    | string\n    | null;\n\n  reasons:\n    unknown;\n}\n\nfunction readJson(\n  file: string,\n) {\n  return JSON.parse(\n    fs.readFileSync(\n      file,\n      \"utf8\",\n    ),\n  );\n}\n\nfunction toNumber(\n  value: unknown,\n): number | null {\n  if (\n    value === null ||\n    value === undefined ||\n    value === \"\"\n  ) {\n    return null;\n  }\n\n  const parsed =\n    Number(value);\n\n  return Number.isFinite(parsed)\n    ? parsed\n    : null;\n}\n\nfunction toReasons(\n  value: unknown,\n): string[] {\n  if (\n    !Array.isArray(value)\n  ) {\n    return [];\n  }\n\n  return value.filter(\n    (\n      item,\n    ): item is string =>\n      typeof item ===\n        \"string\" &&\n      item\n        .trim()\n        .length >\n        0,\n  );\n}\n\nfunction mapRawPrediction(\n  record: RawPredictionRecord,\n): PredictionCandidate {\n  return {\n    predictionId:\n      record.id,\n\n    stockCode:\n      record.stock_code,\n\n    predictionDate:\n      record.prediction_date,\n\n    generatedAt:\n      record.generated_at,\n\n    modelName:\n      record.model_name,\n\n    modelVersion:\n      record.model_version,\n\n    score:\n      toNumber(\n        record.score,\n      ) ??\n      0,\n\n    confidence:\n      toNumber(\n        record.confidence,\n      ) ??\n      0,\n\n    disclosureScore:\n      toNumber(\n        record.disclosure_score,\n      ),\n\n    priceMomentum:\n      toNumber(\n        record.price_momentum,\n      ),\n\n    intradayReturn:\n      toNumber(\n        record.intraday_return,\n      ),\n\n    volumeRatio:\n      toNumber(\n        record.volume_ratio,\n      ),\n\n    reasons:\n      toReasons(\n        record.reasons,\n      ),\n  };\n}\n\nfunction writeReport(\n  report: unknown,\n) {\n  fs.mkdirSync(\n    path.dirname(\n      OUTPUT_FILE,\n    ),\n    {\n      recursive:\n        true,\n    },\n  );\n\n  fs.writeFileSync(\n    OUTPUT_FILE,\n    JSON.stringify(\n      report,\n      null,\n      2,\n    ) + \"\\n\",\n    \"utf8\",\n  );\n\n  console.log(\n    JSON.stringify(\n      report,\n      null,\n      2,\n    ),\n  );\n}\n\nasync function main() {\n  const alpha =\n    readJson(\n      ALPHA_LOG,\n    ) as AlphaReport;\n\n  const ranking =\n    alpha.ranking ??\n    alpha.topRanking ??\n    [];\n\n  const diagnosticAlpha =\n    [...ranking]\n      .sort(\n        (\n          left,\n          right,\n        ) =>\n          left.rank -\n          right.rank,\n      )[0];\n\n  if (\n    !diagnosticAlpha\n  ) {\n    throw new Error(\n      \"ALPHA_RANKING_EMPTY_FOR_RAW_PREDICTION_SMOKE\",\n    );\n  }\n\n  const supabase =\n    createSupabaseServerClient();\n\n  const {\n    data:\n      latestPredictionData,\n    error:\n      latestPredictionError,\n  } =\n    await supabase\n      .from(\n        \"ai_stock_predictions\",\n      )\n      .select(`\n        prediction_date,\n        generated_at,\n        model_name,\n        model_version\n      `)\n      .order(\n        \"generated_at\",\n        {\n          ascending:\n            false,\n        },\n      )\n      .limit(1)\n      .maybeSingle();\n\n  if (\n    latestPredictionError ||\n    !latestPredictionData\n  ) {\n    throw new Error(\n      `LATEST_RAW_PREDICTION_COHORT_READ_FAILED:${\n        latestPredictionError\n          ?.message ??\n        \"NO_PREDICTION\"\n      }`,\n    );\n  }\n\n  const latest =\n    latestPredictionData as\n      LatestPredictionRecord;\n\n  const {\n    data:\n      rawPredictionData,\n    error:\n      rawPredictionError,\n  } =\n    await supabase\n      .from(\n        \"ai_stock_predictions\",\n      )\n      .select(`\n        id,\n        stock_code,\n        prediction_date,\n        generated_at,\n        model_name,\n        model_version,\n        score,\n        confidence,\n        direction,\n        is_candidate,\n        disclosure_score,\n        price_momentum,\n        intraday_return,\n        volume_ratio,\n        reasons\n      `)\n      .eq(\n        \"prediction_date\",\n        latest\n          .prediction_date,\n      )\n      .eq(\n        \"model_name\",\n        latest\n          .model_name,\n      )\n      .eq(\n        \"model_version\",\n        latest\n          .model_version,\n      )\n      .eq(\n        \"stock_code\",\n        diagnosticAlpha\n          .stockCode,\n      )\n      .order(\n        \"generated_at\",\n        {\n          ascending:\n            false,\n        },\n      )\n      .limit(1)\n      .maybeSingle();\n\n  if (\n    rawPredictionError ||\n    !rawPredictionData\n  ) {\n    throw new Error(\n      `TARGET_RAW_PREDICTION_READ_FAILED:${\n        rawPredictionError\n          ?.message ??\n        diagnosticAlpha\n          .stockCode\n      }`,\n    );\n  }\n\n  const rawPrediction =\n    rawPredictionData as\n      RawPredictionRecord;\n\n  const diagnosticPrediction =\n    mapRawPrediction(\n      rawPrediction,\n    );\n\n  const model =\n    await resolveEntryModel();\n\n  const entryScoreThreshold =\n    await getActiveEntryThreshold();\n\n  const snapshotResult =\n    await supabase\n      .from(\n        \"market_snapshots\",\n      )\n      .select(`\n        stock_code,\n        observed_at,\n        close_price,\n        open_price,\n        high_price,\n        low_price,\n        volume\n      `)\n      .eq(\n        \"stock_code\",\n        diagnosticAlpha\n          .stockCode,\n      )\n      .lte(\n        \"observed_at\",\n        new Date()\n          .toISOString(),\n      )\n      .order(\n        \"observed_at\",\n        {\n          ascending:\n            false,\n        },\n      )\n      .limit(\n        1000,\n      );\n\n  if (\n    snapshotResult.error\n  ) {\n    throw new Error(\n      `RAW_PREDICTION_SMOKE_SNAPSHOT_READ_FAILED:${snapshotResult.error.message}`,\n    );\n  }\n\n  const snapshots =\n    (\n      snapshotResult.data ??\n      []\n    ) as\n      SnapshotRecord[];\n\n  const entryCandidate =\n    calculateEntrySignal(\n      snapshots,\n      diagnosticPrediction,\n      entryScoreThreshold,\n    );\n\n  if (\n    !entryCandidate\n  ) {\n    throw new Error(\n      \"ENTRY_CALCULATOR_RETURNED_NULL_FOR_DIAGNOSTIC_RAW_PREDICTION\",\n    );\n  }\n\n  const riskPreflight =\n    await evaluateReadOnlyBuyRiskPreflight({\n      stockCode:\n        entryCandidate\n          .stockCode,\n\n      modelId:\n        model.id,\n\n      entryPrice:\n        entryCandidate\n          .entryPrice,\n\n      proposedStopPrice:\n        entryCandidate\n          .stopPrice,\n\n      requestedQuantity:\n        entryCandidate\n          .quantity,\n\n      entryObservedAt:\n        entryCandidate\n          .observedAt,\n    });\n\n  const report = {\n    status:\n      \"ALPHA_V1_RAW_PREDICTION_DOWNSTREAM_READ_ONLY_SMOKE_COMPLETE\",\n\n    version:\n      VERSION,\n\n    alpha: {\n      status:\n        alpha.status,\n\n      decisionAt:\n        alpha.decisionAt,\n\n      track:\n        alpha.track,\n\n      row: {\n        rank:\n          diagnosticAlpha.rank,\n\n        stockCode:\n          diagnosticAlpha\n            .stockCode,\n\n        stockName:\n          diagnosticAlpha\n            .stockName ??\n          null,\n\n        score:\n          diagnosticAlpha.score,\n\n        coverage:\n          diagnosticAlpha\n            .coverage,\n\n        quality:\n          diagnosticAlpha\n            .quality,\n\n        actualScorerEligible:\n          diagnosticAlpha\n            .scorerEligibleForEntryTiming,\n\n        blockingIssues:\n          diagnosticAlpha\n            .blockingIssues ??\n          [],\n      },\n\n      diagnosticOverride:\n        true,\n\n      productionAlphaGateBypassed:\n        false,\n    },\n\n    rawPrediction: {\n      diagnosticOverride:\n        true,\n\n      sourceTable:\n        \"ai_stock_predictions\",\n\n      cohort: {\n        predictionDate:\n          latest\n            .prediction_date,\n\n        modelName:\n          latest\n            .model_name,\n\n        modelVersion:\n          latest\n            .model_version,\n\n        latestGeneratedAt:\n          latest\n            .generated_at,\n      },\n\n      originalFlags: {\n        direction:\n          rawPrediction\n            .direction,\n\n        isCandidate:\n          rawPrediction\n            .is_candidate,\n      },\n\n      mappedPredictionCandidate:\n        diagnosticPrediction,\n\n      productionCandidateFilterSatisfied:\n        rawPrediction\n          .is_candidate ===\n          true &&\n        rawPrediction\n          .direction ===\n          \"UP\",\n\n      overridePurpose:\n        \"DOWNSTREAM_WIRING_DIAGNOSTIC_ONLY\",\n    },\n\n    entryTiming: {\n      invoked:\n        true,\n\n      model: {\n        id:\n          model.id,\n\n        name:\n          model\n            .model_name,\n\n        version:\n          model\n            .model_version,\n\n        purpose:\n          model\n            .purpose,\n\n        status:\n          model.status,\n      },\n\n      threshold:\n        entryScoreThreshold,\n\n      snapshotCount:\n        snapshots.length,\n\n      candidate:\n        entryCandidate,\n\n      actualQualifies:\n        entryCandidate\n          .qualifies,\n    },\n\n    riskPreflight: {\n      invoked:\n        true,\n\n      result:\n        riskPreflight,\n    },\n\n    production: {\n      alphaThresholdLowered:\n        false,\n\n      predictionCandidatePolicyChanged:\n        false,\n\n      predictionRowPromoted:\n        false,\n\n      entryThresholdChanged:\n        false,\n\n      riskPolicyChanged:\n        false,\n\n      productionExecutionEligible:\n        false,\n\n      diagnosticOnly:\n        true,\n    },\n\n    contract: {\n      predictionMapping:\n        \"EXACT_GET_LATEST_PREDICTION_CANDIDATES_FIELD_MAPPING\",\n\n      entryTiming:\n        \"EXISTING_CALCULATE_ENTRY_SIGNAL\",\n\n      risk:\n        \"EXISTING_VALIDATE_BUY_RISK_VIA_READ_ONLY_PREFLIGHT\",\n\n      successCondition:\n        \"ENTRY_CANDIDATE_NON_NULL_AND_RISK_PREFLIGHT_RETURNED\",\n    },\n\n    safety: {\n      databaseWrites:\n        0,\n\n      aiStockPredictionWrites:\n        0,\n\n      aiEntrySignalWrites:\n        0,\n\n      riskDecisionWrites:\n        0,\n\n      paperOrderWrites:\n        0,\n\n      ordersCreated:\n        0,\n\n      positionsChanged:\n        0,\n\n      productionDecisionApplied:\n        false,\n    },\n\n    nextGate:\n      \"ALPHA_V1_HISTORICAL_READ_ONLY_PIPELINE_VALIDATION\",\n\n    outputFile:\n      \"logs/alpha-v1-raw-prediction-downstream-read-only-smoke.json\",\n  };\n\n  writeReport(\n    report,\n  );\n}\n\nmain().catch(\n  (\n    error,\n  ) => {\n    console.error(\n      JSON.stringify(\n        {\n          status:\n            \"ALPHA_V1_RAW_PREDICTION_DOWNSTREAM_READ_ONLY_SMOKE_FAILED\",\n\n          version:\n            VERSION,\n\n          error:\n            String(\n              error instanceof Error\n                ? error.message\n                : error,\n            ),\n\n          safety: {\n            databaseWrites:\n              0,\n\n            aiStockPredictionWrites:\n              0,\n\n            aiEntrySignalWrites:\n              0,\n\n            riskDecisionWrites:\n              0,\n\n            paperOrderWrites:\n              0,\n\n            ordersCreated:\n              0,\n          },\n        },\n        null,\n        2,\n      ),\n    );\n\n    process.exitCode =\n      2;\n  },\n);\n";

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
      'alpha-v1-raw-prediction-downstream-read-only-smoke.ts',
    );

  atomicWrite(
    target,
    smoke,
  );

  console.log(
    JSON.stringify(
      {
        status:
          'ALPHA_V1_RAW_PREDICTION_DOWNSTREAM_READ_ONLY_SMOKE_INSTALLED',

        version:
          VERSION,

        generatedFile:
          'scripts/alpha-v1-raw-prediction-downstream-read-only-smoke.ts',

        diagnosticOverride: {
          alphaThresholdLowered:
            false,

          predictionPolicyChanged:
            false,

          usesRawPredictionOnlyAsFunctionInput:
            true,

          databasePredictionMutation:
            false,

          productionCandidatePromotion:
            false,

          executionEligibilityGranted:
            false,
        },

        reuse: {
          predictionMapping:
            'EXACT_CURRENT_CONTRACT',

          entryCalculator:
            'EXISTING_CALCULATE_ENTRY_SIGNAL',

          riskValidator:
            'EXISTING_VALIDATE_BUY_RISK',
        },

        safety: {
          databaseWrites:
            0,

          aiStockPredictionWrites:
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
          'RUN_RAW_PREDICTION_DOWNSTREAM_READ_ONLY_SMOKE',
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
          'ALPHA_V1_RAW_PREDICTION_DOWNSTREAM_READ_ONLY_SMOKE_INSTALL_FAILED',

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
