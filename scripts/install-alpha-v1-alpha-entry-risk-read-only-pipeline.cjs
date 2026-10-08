#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VERSION =
  'ALPHA_V1_ALPHA_ENTRY_RISK_READ_ONLY_PIPELINE_INSTALLER';

const pipeline =
  "import fs from \"node:fs\";\nimport path from \"node:path\";\nimport {\n  spawnSync,\n} from \"node:child_process\";\n\nimport {\n  createSupabaseServerClient,\n} from \"../lib/supabase\";\n\nimport {\n  getActiveEntryThreshold,\n} from \"../lib/trading/get-active-entry-threshold\";\n\nimport {\n  getLatestPredictionCandidates,\n  type PredictionCandidate,\n} from \"../lib/trading/get-latest-prediction-candidates\";\n\nimport {\n  calculateEntrySignal,\n  resolveEntryModel,\n  type SignalCandidate,\n  type SnapshotRecord,\n} from \"../lib/trading/generate-entry-signals\";\n\nimport {\n  evaluateReadOnlyBuyRiskPreflight,\n} from \"../lib/trading/read-only-buy-risk-preflight\";\n\nconst VERSION =\n  \"ALPHA_V1_ALPHA_ENTRY_RISK_READ_ONLY_PIPELINE\";\n\nconst ALPHA_SCRIPT =\n  path.resolve(\n    process.cwd(),\n    \"scripts\",\n    \"alpha-v1-real-runner-daily-alpha-read-only.ts\",\n  );\n\nconst ALPHA_LOG =\n  path.resolve(\n    process.cwd(),\n    \"logs\",\n    \"alpha-v1-real-runner-daily-alpha-read-only.json\",\n  );\n\nconst OUTPUT_FILE =\n  path.resolve(\n    process.cwd(),\n    \"logs\",\n    \"alpha-v1-alpha-entry-risk-read-only-pipeline.json\",\n  );\n\nconst DEFAULT_MAX_ORDERS =\n  3;\n\nconst DEFAULT_MAX_PREDICTION_AGE_MINUTES =\n  180;\n\ninterface AlphaRankingRow {\n  rank: number;\n  stockCode: string;\n  stockName?: string;\n  score: number;\n  coverage: number;\n  quality: number;\n  scorerEligibleForEntryTiming: boolean;\n  blockingIssues?: string[];\n}\n\ninterface AlphaReport {\n  status: string;\n  version: string;\n  decisionAt: string;\n  track: string;\n\n  counts?: {\n    scorerEligible?: number;\n  };\n\n  topRanking: AlphaRankingRow[];\n}\n\nfunction readJson(\n  file: string,\n) {\n  return JSON.parse(\n    fs.readFileSync(\n      file,\n      \"utf8\",\n    ),\n  );\n}\n\nfunction runFreshAlphaReadOnly() {\n  const nodeDir =\n    path.dirname(\n      process.execPath,\n    );\n\n  const npxExecutable =\n    process.platform ===\n    \"win32\"\n      ? path.join(\n          nodeDir,\n          \"npx.cmd\",\n        )\n      : \"npx\";\n\n  const child =\n    spawnSync(\n      npxExecutable,\n      [\n        \"tsx\",\n        ALPHA_SCRIPT,\n      ],\n      {\n        cwd:\n          process.cwd(),\n\n        env:\n          process.env,\n\n        encoding:\n          \"utf8\",\n\n        stdio: [\n          \"ignore\",\n          \"pipe\",\n          \"pipe\",\n        ],\n      },\n    );\n\n  if (\n    child.status !==\n    0\n  ) {\n    throw new Error(\n      [\n        \"FRESH_ALPHA_RUN_FAILED\",\n        `exit=${child.status}`,\n        `stdout=${String(child.stdout ?? \"\").slice(-2000)}`,\n        `stderr=${String(child.stderr ?? \"\").slice(-2000)}`,\n      ].join(\"|\"),\n    );\n  }\n\n  if (\n    !fs.existsSync(\n      ALPHA_LOG,\n    )\n  ) {\n    throw new Error(\n      `ALPHA_LOG_NOT_FOUND:${ALPHA_LOG}`,\n    );\n  }\n\n  const report =\n    readJson(\n      ALPHA_LOG,\n    ) as AlphaReport;\n\n  if (\n    report.status !==\n    \"ALPHA_V1_REAL_RUNNER_DAILY_ALPHA_READ_ONLY_COMPLETE\"\n  ) {\n    throw new Error(\n      `UNEXPECTED_ALPHA_STATUS:${report.status}`,\n    );\n  }\n\n  return {\n    report,\n\n    childStdoutTail:\n      String(\n        child.stdout ??\n        \"\",\n      ).slice(\n        -2500,\n      ),\n  };\n}\n\nfunction groupSnapshots(\n  rows: SnapshotRecord[],\n) {\n  const grouped =\n    new Map<\n      string,\n      SnapshotRecord[]\n    >();\n\n  for (\n    const row\n    of rows\n  ) {\n    const current =\n      grouped.get(\n        row.stock_code,\n      ) ??\n      [];\n\n    current.push(\n      row,\n    );\n\n    grouped.set(\n      row.stock_code,\n      current,\n    );\n  }\n\n  return grouped;\n}\n\nfunction writeReport(\n  report: unknown,\n) {\n  fs.mkdirSync(\n    path.dirname(\n      OUTPUT_FILE,\n    ),\n    {\n      recursive:\n        true,\n    },\n  );\n\n  fs.writeFileSync(\n    OUTPUT_FILE,\n    JSON.stringify(\n      report,\n      null,\n      2,\n    ) + \"\\n\",\n    \"utf8\",\n  );\n\n  console.log(\n    JSON.stringify(\n      report,\n      null,\n      2,\n    ),\n  );\n}\n\nasync function main() {\n  const startedAt =\n    new Date()\n      .toISOString();\n\n  const alphaRun =\n    runFreshAlphaReadOnly();\n\n  const alpha =\n    alphaRun.report;\n\n  const alphaEligible =\n    (\n      alpha.topRanking ??\n      []\n    )\n      .filter(\n        (\n          row,\n        ) =>\n          row\n            .scorerEligibleForEntryTiming ===\n          true,\n      )\n      .sort(\n        (\n          left,\n          right,\n        ) =>\n          left.rank -\n          right.rank,\n      );\n\n  const alphaSummary =\n    {\n      status:\n        alpha.status,\n\n      version:\n        alpha.version,\n\n      decisionAt:\n        alpha.decisionAt,\n\n      track:\n        alpha.track,\n\n      scorerEligible:\n        alphaEligible.length,\n\n      topRanking:\n        (\n          alpha.topRanking ??\n          []\n        ).map(\n          (\n            row,\n          ) => ({\n            rank:\n              row.rank,\n\n            stockCode:\n              row.stockCode,\n\n            stockName:\n              row.stockName ??\n              null,\n\n            score:\n              row.score,\n\n            coverage:\n              row.coverage,\n\n            quality:\n              row.quality,\n\n            scorerEligibleForEntryTiming:\n              row.scorerEligibleForEntryTiming,\n\n            blockingIssues:\n              row.blockingIssues ??\n              [],\n          }),\n        ),\n    };\n\n  if (\n    alphaEligible.length ===\n    0\n  ) {\n    const report = {\n      status:\n        \"ALPHA_V1_READ_ONLY_PIPELINE_NO_ALPHA_ELIGIBLE_CANDIDATES\",\n\n      version:\n        VERSION,\n\n      startedAt,\n\n      finishedAt:\n        new Date()\n          .toISOString(),\n\n      alpha:\n        alphaSummary,\n\n      entryTiming: {\n        invoked:\n          false,\n\n        reason:\n          \"NO_ALPHA_ELIGIBLE_CANDIDATES\",\n      },\n\n      riskPreflight: {\n        invoked:\n          false,\n\n        reason:\n          \"NO_ENTRY_TIMING_CANDIDATES\",\n      },\n\n      execution: {\n        eligibleCount:\n          0,\n\n        eligible:\n          [],\n      },\n\n      contract: {\n        alphaGate:\n          \"MUST_PASS_SCORER_ELIGIBLE_FOR_ENTRY_TIMING\",\n\n        entryTiming:\n          \"EXISTING_CALCULATE_ENTRY_SIGNAL\",\n\n        risk:\n          \"EXISTING_VALIDATE_BUY_RISK_VIA_READ_ONLY_PREFLIGHT\",\n\n        activePositionGate:\n          \"MATCH_GENERATE_ENTRY_SIGNALS\",\n\n        activeOrderGate:\n          \"BUY_STATUS_RISK_APPROVED\",\n\n        maximumSelected:\n          DEFAULT_MAX_ORDERS,\n      },\n\n      safety: {\n        databaseWrites:\n          0,\n\n        alphaWrites:\n          0,\n\n        entrySignalWrites:\n          0,\n\n        riskDecisionWrites:\n          0,\n\n        orderWrites:\n          0,\n\n        ordersCreated:\n          0,\n\n        positionsChanged:\n          0,\n\n        productionDecisionApplied:\n          false,\n      },\n\n      nextGate:\n        \"WAIT_FOR_REAL_ALPHA_ELIGIBLE_CANDIDATE_OR_RUN_HISTORICAL_PIPELINE_VALIDATION\",\n\n      outputFile:\n        \"logs/alpha-v1-alpha-entry-risk-read-only-pipeline.json\",\n    };\n\n    writeReport(\n      report,\n    );\n\n    return;\n  }\n\n  const stockCodes =\n    alphaEligible.map(\n      (\n        row,\n      ) =>\n        row.stockCode,\n    );\n\n  const model =\n    await resolveEntryModel();\n\n  const entryScoreThreshold =\n    await getActiveEntryThreshold();\n\n  const predictionGate =\n    await getLatestPredictionCandidates({\n      maximumAgeMinutes:\n        DEFAULT_MAX_PREDICTION_AGE_MINUTES,\n\n      limit:\n        100,\n    });\n\n  const predictionMap =\n    new Map<\n      string,\n      PredictionCandidate\n    >(\n      predictionGate\n        .candidates\n        .map(\n          (\n            prediction,\n          ) => [\n            prediction.stockCode,\n            prediction,\n          ],\n        ),\n    );\n\n  const supabase =\n    createSupabaseServerClient();\n\n  const snapshotResult =\n    await supabase\n      .from(\n        \"market_snapshots\",\n      )\n      .select(`\n        stock_code,\n        observed_at,\n        close_price,\n        open_price,\n        high_price,\n        low_price,\n        volume\n      `)\n      .in(\n        \"stock_code\",\n        stockCodes,\n      )\n      .lte(\n        \"observed_at\",\n        new Date()\n          .toISOString(),\n      )\n      .order(\n        \"observed_at\",\n        {\n          ascending:\n            false,\n        },\n      )\n      .limit(\n        1000,\n      );\n\n  if (\n    snapshotResult.error\n  ) {\n    throw new Error(\n      `PIPELINE_SNAPSHOT_READ_FAILED:${snapshotResult.error.message}`,\n    );\n  }\n\n  const snapshots =\n    (\n      snapshotResult.data ??\n      []\n    ) as SnapshotRecord[];\n\n  const groupedSnapshots =\n    groupSnapshots(\n      snapshots,\n    );\n\n  const entryResults:\n    Array<{\n      alpha:\n        AlphaRankingRow;\n\n      predictionAvailable:\n        boolean;\n\n      candidate:\n        SignalCandidate |\n        null;\n\n      blockers:\n        string[];\n    }> =\n    [];\n\n  for (\n    const alphaRow\n    of alphaEligible\n  ) {\n    const prediction =\n      predictionMap.get(\n        alphaRow.stockCode,\n      );\n\n    if (\n      !prediction\n    ) {\n      entryResults.push({\n        alpha:\n          alphaRow,\n\n        predictionAvailable:\n          false,\n\n        candidate:\n          null,\n\n        blockers: [\n          \"NO_CURRENT_ENTRY_PREDICTION\",\n        ],\n      });\n\n      continue;\n    }\n\n    const stockSnapshots =\n      groupedSnapshots.get(\n        alphaRow.stockCode,\n      ) ??\n      [];\n\n    const candidate =\n      calculateEntrySignal(\n        stockSnapshots,\n        prediction,\n        entryScoreThreshold,\n      );\n\n    entryResults.push({\n      alpha:\n        alphaRow,\n\n      predictionAvailable:\n        true,\n\n      candidate,\n\n      blockers:\n        candidate\n          ? (\n              candidate.qualifies\n                ? []\n                : [\n                    \"ENTRY_TIMING_NOT_QUALIFIED\",\n                  ]\n            )\n          : [\n              \"ENTRY_TIMING_CANDIDATE_UNAVAILABLE\",\n            ],\n    });\n  }\n\n  const calculatedCandidates =\n    entryResults\n      .map(\n        (\n          row,\n        ) =>\n          row.candidate,\n      )\n      .filter(\n        (\n          candidate,\n        ): candidate is SignalCandidate =>\n          candidate !==\n          null,\n      )\n      .sort(\n        (\n          left,\n          right,\n        ) =>\n          right.score -\n          left.score,\n      );\n\n  const calculatedStockCodes =\n    calculatedCandidates.map(\n      (\n        candidate,\n      ) =>\n        candidate.stockCode,\n    );\n\n  const activePositionCodes =\n    new Set<string>();\n\n  const activeOrderCodes =\n    new Set<string>();\n\n  if (\n    calculatedStockCodes.length >\n    0\n  ) {\n    const {\n      data:\n        positionData,\n      error:\n        positionError,\n    } =\n      await supabase\n        .from(\n          \"paper_positions\",\n        )\n        .select(\n          \"stock_code\",\n        )\n        .in(\n          \"stock_code\",\n          calculatedStockCodes,\n        );\n\n    if (\n      positionError\n    ) {\n      throw new Error(\n        `PIPELINE_POSITION_READ_FAILED:${positionError.message}`,\n      );\n    }\n\n    for (\n      const position\n      of positionData ??\n      []\n    ) {\n      activePositionCodes\n        .add(\n          String(\n            position.stock_code,\n          ),\n        );\n    }\n\n    const {\n      data:\n        orderData,\n      error:\n        orderError,\n    } =\n      await supabase\n        .from(\n          \"paper_order_requests\",\n        )\n        .select(\n          \"stock_code\",\n        )\n        .eq(\n          \"side\",\n          \"BUY\",\n        )\n        .eq(\n          \"status\",\n          \"RISK_APPROVED\",\n        )\n        .in(\n          \"stock_code\",\n          calculatedStockCodes,\n        );\n\n    if (\n      orderError\n    ) {\n      throw new Error(\n        `PIPELINE_ORDER_READ_FAILED:${orderError.message}`,\n      );\n    }\n\n    for (\n      const order\n      of orderData ??\n      []\n    ) {\n      activeOrderCodes\n        .add(\n          String(\n            order.stock_code,\n          ),\n        );\n    }\n  }\n\n  const entryEligible =\n    calculatedCandidates\n      .filter(\n        (\n          candidate,\n        ) =>\n          candidate.qualifies &&\n          !activePositionCodes\n            .has(\n              candidate.stockCode,\n            ) &&\n          !activeOrderCodes\n            .has(\n              candidate.stockCode,\n            ),\n      );\n\n  const selectedForRisk =\n    entryEligible.slice(\n      0,\n      DEFAULT_MAX_ORDERS,\n    );\n\n  const riskResults =\n    [];\n\n  for (\n    const candidate\n    of selectedForRisk\n  ) {\n    const preflight =\n      await evaluateReadOnlyBuyRiskPreflight({\n        stockCode:\n          candidate.stockCode,\n\n        modelId:\n          model.id,\n\n        entryPrice:\n          candidate.entryPrice,\n\n        proposedStopPrice:\n          candidate.stopPrice,\n\n        requestedQuantity:\n          candidate.quantity,\n\n        entryObservedAt:\n          candidate.observedAt,\n      });\n\n    riskResults.push({\n      stockCode:\n        candidate.stockCode,\n\n      entryScore:\n        candidate.score,\n\n      entryQualifies:\n        candidate.qualifies,\n\n      entryPrice:\n        candidate.entryPrice,\n\n      stopPrice:\n        candidate.stopPrice,\n\n      quantity:\n        candidate.quantity,\n\n      preflight,\n    });\n  }\n\n  const executionEligible =\n    riskResults.filter(\n      (\n        row,\n      ) =>\n        row.preflight\n          .executionEligible ===\n        true,\n    );\n\n  const report = {\n    status:\n      \"ALPHA_V1_ALPHA_ENTRY_RISK_READ_ONLY_PIPELINE_COMPLETE\",\n\n    version:\n      VERSION,\n\n    startedAt,\n\n    finishedAt:\n      new Date()\n        .toISOString(),\n\n    alpha:\n      alphaSummary,\n\n    entryTiming: {\n      invoked:\n        true,\n\n      model: {\n        id:\n          model.id,\n\n        name:\n          model.model_name,\n\n        version:\n          model.model_version,\n\n        purpose:\n          model.purpose,\n\n        status:\n          model.status,\n      },\n\n      threshold:\n        entryScoreThreshold,\n\n      maximumPredictionAgeMinutes:\n        DEFAULT_MAX_PREDICTION_AGE_MINUTES,\n\n      predictionGate: {\n        reason:\n          predictionGate.reason,\n\n        candidateCount:\n          predictionGate\n            .candidates\n            .length,\n      },\n\n      snapshotsRead:\n        snapshots.length,\n\n      results:\n        entryResults.map(\n          (\n            row,\n          ) => ({\n            alphaRank:\n              row.alpha.rank,\n\n            stockCode:\n              row.alpha.stockCode,\n\n            alphaScore:\n              row.alpha.score,\n\n            predictionAvailable:\n              row.predictionAvailable,\n\n            candidate:\n              row.candidate,\n\n            blockers:\n              [\n                ...row.blockers,\n\n                ...(\n                  row.candidate &&\n                  activePositionCodes\n                    .has(\n                      row.candidate\n                        .stockCode,\n                    )\n                    ? [\n                        \"ACTIVE_POSITION_EXISTS\",\n                      ]\n                    : []\n                ),\n\n                ...(\n                  row.candidate &&\n                  activeOrderCodes\n                    .has(\n                      row.candidate\n                        .stockCode,\n                    )\n                    ? [\n                        \"RISK_APPROVED_BUY_ORDER_EXISTS\",\n                      ]\n                    : []\n                ),\n              ],\n          }),\n        ),\n\n      qualifiedCount:\n        calculatedCandidates\n          .filter(\n            (\n              candidate,\n            ) =>\n              candidate.qualifies,\n          )\n          .length,\n\n      eligibleAfterPositionOrderGate:\n        entryEligible.length,\n\n      selectedForRisk:\n        selectedForRisk.map(\n          (\n            candidate,\n          ) =>\n            candidate.stockCode,\n        ),\n    },\n\n    riskPreflight: {\n      invoked:\n        selectedForRisk.length >\n        0,\n\n      evaluated:\n        riskResults.length,\n\n      approved:\n        riskResults.filter(\n          (\n            row,\n          ) =>\n            row.preflight\n              .approved ===\n            true,\n        ).length,\n\n      executionEligible:\n        executionEligible.length,\n\n      results:\n        riskResults,\n    },\n\n    execution: {\n      eligibleCount:\n        executionEligible.length,\n\n      eligible:\n        executionEligible.map(\n          (\n            row,\n          ) => ({\n            stockCode:\n              row.stockCode,\n\n            entryPrice:\n              row.entryPrice,\n\n            stopPrice:\n              row.stopPrice,\n\n            quantity:\n              row.quantity,\n\n            entryScore:\n              row.entryScore,\n\n            riskApproved:\n              row.preflight\n                .approved,\n\n            executionEligible:\n              row.preflight\n                .executionEligible,\n\n            blockers:\n              row.preflight\n                .executionBlockers,\n          }),\n        ),\n\n      action:\n        \"READ_ONLY_NO_ORDER_CREATION\",\n    },\n\n    contract: {\n      alphaGate:\n        \"SCORER_ELIGIBLE_FOR_ENTRY_TIMING\",\n\n      entryTiming:\n        \"EXISTING_EXPORTED_CALCULATE_ENTRY_SIGNAL\",\n\n      entryFormulaChanged:\n        false,\n\n      positionGate:\n        \"NO_EXISTING_PAPER_POSITION\",\n\n      orderGate:\n        \"NO_EXISTING_BUY_RISK_APPROVED_ORDER\",\n\n      maxOrders:\n        DEFAULT_MAX_ORDERS,\n\n      risk:\n        \"EXISTING_VALIDATE_BUY_RISK_VIA_READ_ONLY_PREFLIGHT\",\n\n      orderCreation:\n        \"DISABLED\",\n    },\n\n    safety: {\n      databaseWrites:\n        0,\n\n      alphaWrites:\n        0,\n\n      entrySignalWrites:\n        0,\n\n      riskDecisionWrites:\n        0,\n\n      orderWrites:\n        0,\n\n      ordersCreated:\n        0,\n\n      positionsChanged:\n        0,\n\n      productionDecisionApplied:\n        false,\n    },\n\n    nextGate:\n      executionEligible.length >\n        0\n        ? \"REVIEW_EXECUTION_ELIGIBLE_READ_ONLY_CANDIDATES_BEFORE_ANY_PAPER_ORDER_BINDING\"\n        : \"NO_EXECUTION_ELIGIBLE_CANDIDATES_KEEP_PIPELINE_READ_ONLY\",\n\n    outputFile:\n      \"logs/alpha-v1-alpha-entry-risk-read-only-pipeline.json\",\n  };\n\n  writeReport(\n    report,\n  );\n}\n\nmain().catch(\n  (\n    error,\n  ) => {\n    console.error(\n      JSON.stringify(\n        {\n          status:\n            \"ALPHA_V1_ALPHA_ENTRY_RISK_READ_ONLY_PIPELINE_FAILED\",\n\n          version:\n            VERSION,\n\n          error:\n            String(\n              error instanceof Error\n                ? error.message\n                : error,\n            ),\n\n          safety: {\n            databaseWrites:\n              0,\n\n            entrySignalWrites:\n              0,\n\n            riskDecisionWrites:\n              0,\n\n            orderWrites:\n              0,\n\n            ordersCreated:\n              0,\n          },\n\n          nextGate:\n            \"REVIEW_PIPELINE_FAILURE_BEFORE_ANY_PRODUCTION_BINDING\",\n        },\n        null,\n        2,\n      ),\n    );\n\n    process.exitCode =\n      2;\n  },\n);\n";

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

  const tmp =
    `${file}.tmp-${process.pid}-${Date.now()}`;

  fs.writeFileSync(
    tmp,
    content,
    'utf8',
  );

  fs.renameSync(
    tmp,
    file,
  );
}

function exportDeclaration(
  text,
  plain,
  exported,
  label,
) {
  if (
    text.includes(
      exported,
    )
  ) {
    return {
      text,
      changed:
        false,
    };
  }

  const count =
    text.split(
      plain,
    ).length -
    1;

  if (
    count !==
    1
  ) {
    throw new Error(
      `${label}_EXPECTED_ONCE_GOT_${count}`,
    );
  }

  return {
    text:
      text.replace(
        plain,
        exported,
      ),

    changed:
      true,
  };
}

try {
  const root =
    path.resolve(
      __dirname,
      '..',
    );

  const entryFile =
    path.join(
      root,
      'lib',
      'trading',
      'generate-entry-signals.ts',
    );

  let entryCode =
    fs.readFileSync(
      entryFile,
      'utf8',
    );

  const changes =
    [];

  const patches = [
    [
      'interface SnapshotRecord {',
      'export interface SnapshotRecord {',
      'EXPORT_SNAPSHOT_RECORD',
    ],
    [
      'interface EntryModelRecord {',
      'export interface EntryModelRecord {',
      'EXPORT_ENTRY_MODEL_RECORD',
    ],
    [
      'interface SignalCandidate {',
      'export interface SignalCandidate {',
      'EXPORT_SIGNAL_CANDIDATE',
    ],
    [
      'async function resolveEntryModel(',
      'export async function resolveEntryModel(',
      'EXPORT_RESOLVE_ENTRY_MODEL',
    ],
    [
      'function calculateEntrySignal(',
      'export function calculateEntrySignal(',
      'EXPORT_CALCULATE_ENTRY_SIGNAL',
    ],
  ];

  for (
    const [
      plain,
      exported,
      label,
    ]
    of patches
  ) {
    const result =
      exportDeclaration(
        entryCode,
        plain,
        exported,
        label,
      );

    entryCode =
      result.text;

    if (
      result.changed
    ) {
      changes.push(
        label,
      );
    }
  }

  atomicWrite(
    entryFile,
    entryCode,
  );

  const pipelineFile =
    path.join(
      root,
      'scripts',
      'alpha-v1-alpha-entry-risk-read-only-pipeline.ts',
    );

  atomicWrite(
    pipelineFile,
    pipeline,
  );

  console.log(
    JSON.stringify(
      {
        status:
          'ALPHA_V1_ALPHA_ENTRY_RISK_READ_ONLY_PIPELINE_INSTALLED',

        version:
          VERSION,

        changedProductionSource: {
          file:
            'lib/trading/generate-entry-signals.ts',

          changes,

          behaviorChanged:
            false,

          formulasChanged:
            false,

          purpose:
            'EXPORT_EXISTING_TYPES_AND_PURE_FUNCTIONS_ONLY',
        },

        generatedFile:
          'scripts/alpha-v1-alpha-entry-risk-read-only-pipeline.ts',

        pipeline: [
          'FRESH_DAILY_ALPHA_READ_ONLY',
          'ALPHA_SCORER_ELIGIBILITY_GATE',
          'EXISTING_ENTRY_TIMING_CALCULATOR',
          'POSITION_AND_RISK_APPROVED_ORDER_GATE',
          'READ_ONLY_BUY_RISK_PREFLIGHT',
          'NO_ORDER_CREATION',
        ],

        currentExpectedBehavior: {
          currentAlphaEligible:
            0,

          expectedCurrentPipelineStatus:
            'ALPHA_V1_READ_ONLY_PIPELINE_NO_ALPHA_ELIGIBLE_CANDIDATES',

          lowerAlphaThreshold:
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
          'RUN_ALPHA_ENTRY_RISK_READ_ONLY_PIPELINE',
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
          'ALPHA_V1_ALPHA_ENTRY_RISK_READ_ONLY_PIPELINE_INSTALL_FAILED',

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
