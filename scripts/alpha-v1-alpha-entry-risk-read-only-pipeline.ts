import fs from "node:fs";
import path from "node:path";
import {
  spawnSync,
} from "node:child_process";

import {
  createSupabaseServerClient,
} from "../lib/supabase";

import {
  getActiveEntryThreshold,
} from "../lib/trading/get-active-entry-threshold";

import {
  getLatestPredictionCandidates,
  type PredictionCandidate,
} from "../lib/trading/get-latest-prediction-candidates";

import {
  calculateEntrySignal,
  resolveEntryModel,
  type SignalCandidate,
  type SnapshotRecord,
} from "../lib/trading/generate-entry-signals";

import {
  evaluateReadOnlyBuyRiskPreflight,
} from "../lib/trading/read-only-buy-risk-preflight";

const VERSION =
  "ALPHA_V1_ALPHA_ENTRY_RISK_READ_ONLY_PIPELINE";

const ALPHA_SCRIPT =
  path.resolve(
    process.cwd(),
    "scripts",
    "alpha-v1-real-runner-daily-alpha-read-only.ts",
  );

const ALPHA_LOG =
  path.resolve(
    process.cwd(),
    "logs",
    "alpha-v1-real-runner-daily-alpha-read-only.json",
  );

const OUTPUT_FILE =
  path.resolve(
    process.cwd(),
    "logs",
    "alpha-v1-alpha-entry-risk-read-only-pipeline.json",
  );

const DEFAULT_MAX_ORDERS =
  3;

const DEFAULT_MAX_PREDICTION_AGE_MINUTES =
  180;

interface AlphaRankingRow {
  rank: number;
  stockCode: string;
  stockName?: string;
  score: number;
  coverage: number;
  quality: number;
  scorerEligibleForEntryTiming: boolean;
  blockingIssues?: string[];
}

interface AlphaReport {
  status: string;
  version: string;
  decisionAt: string;
  track: string;

  counts?: {
    scorerEligible?: number;
  };

  ranking?: AlphaRankingRow[];
  topRanking?: AlphaRankingRow[];
}

function readJson(
  file: string,
) {
  return JSON.parse(
    fs.readFileSync(
      file,
      "utf8",
    ),
  );
}

function runFreshAlphaReadOnly() {
  const nodeDir =
    path.dirname(
      process.execPath,
    );

  const npxExecutable =
    process.platform ===
    "win32"
      ? path.join(
          nodeDir,
          "npx.cmd",
        )
      : "npx";

  const npxCliJs =
    path.join(
      nodeDir,
      "node_modules",
      "npm",
      "bin",
      "npx-cli.js",
    );

  const child =
    process.platform ===
    "win32"
      ? spawnSync(
          process.execPath,
          [
            npxCliJs,
            "tsx",
            ALPHA_SCRIPT,
          ],
          {
            cwd:
              process.cwd(),

            env:
              process.env,

            encoding:
              "utf8",

            stdio: [
              "ignore",
              "pipe",
              "pipe",
            ],
          },
        )
      : spawnSync(
          npxExecutable,
          [
            "tsx",
            ALPHA_SCRIPT,
          ],
          {
            cwd:
              process.cwd(),

            env:
              process.env,

            encoding:
              "utf8",

            stdio: [
              "ignore",
              "pipe",
              "pipe",
            ],
          },
        );

  if (
    process.platform ===
      "win32" &&
    !fs.existsSync(
      npxCliJs,
    )
  ) {
    throw new Error(
      `WINDOWS_NPX_CLI_NOT_FOUND:${npxCliJs}`,
    );
  }

  if (
    child.error
  ) {
    throw new Error(
      [
        "FRESH_ALPHA_SPAWN_FAILED",
        `name=${child.error.name}`,
        `message=${child.error.message}`,
        `code=${(child.error as NodeJS.ErrnoException).code ?? "UNKNOWN"}`,
      ].join("|"),
    );
  }

  if (
    child.status !==
    0
  ) {
    throw new Error(
      [
        "FRESH_ALPHA_RUN_FAILED",
        `exit=${child.status}`,
        `signal=${child.signal ?? "NONE"}`,
        `stdout=${String(child.stdout ?? "").slice(-2000)}`,
        `stderr=${String(child.stderr ?? "").slice(-2000)}`,
      ].join("|"),
    );
  }

  if (
    !fs.existsSync(
      ALPHA_LOG,
    )
  ) {
    throw new Error(
      `ALPHA_LOG_NOT_FOUND:${ALPHA_LOG}`,
    );
  }

  const report =
    readJson(
      ALPHA_LOG,
    ) as AlphaReport;

  if (
    report.status !==
    "ALPHA_V1_REAL_RUNNER_DAILY_ALPHA_READ_ONLY_COMPLETE"
  ) {
    throw new Error(
      `UNEXPECTED_ALPHA_STATUS:${report.status}`,
    );
  }

  return {
    report,

    childStdoutTail:
      String(
        child.stdout ??
        "",
      ).slice(
        -2500,
      ),
  };
}

function groupSnapshots(
  rows: SnapshotRecord[],
) {
  const grouped =
    new Map<
      string,
      SnapshotRecord[]
    >();

  for (
    const row
    of rows
  ) {
    const current =
      grouped.get(
        row.stock_code,
      ) ??
      [];

    current.push(
      row,
    );

    grouped.set(
      row.stock_code,
      current,
    );
  }

  return grouped;
}

function writeReport(
  report: unknown,
) {
  fs.mkdirSync(
    path.dirname(
      OUTPUT_FILE,
    ),
    {
      recursive:
        true,
    },
  );

  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify(
      report,
      null,
      2,
    ) + "\n",
    "utf8",
  );

  console.log(
    JSON.stringify(
      report,
      null,
      2,
    ),
  );
}

async function main() {
  const startedAt =
    new Date()
      .toISOString();

  const alphaRun =
    runFreshAlphaReadOnly();

  const alpha =
    alphaRun.report;

  const alphaRanking =
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
      `ALPHA_RANKING_INTEGRITY_FAILED:analyzed=${analyzedStocks}:ranking=0`,
    );
  }

  const alphaEligible =
    alphaRanking
      .filter(
        (
          row,
        ) =>
          row
            .scorerEligibleForEntryTiming ===
          true,
      )
      .sort(
        (
          left,
          right,
        ) =>
          left.rank -
          right.rank,
      );

  const alphaSummary =
    {
      status:
        alpha.status,

      version:
        alpha.version,

      decisionAt:
        alpha.decisionAt,

      track:
        alpha.track,

      scorerEligible:
        alphaEligible.length,

      rankingFieldUsed:
        alpha.ranking
          ? "ranking"
          : alpha.topRanking
          ? "topRanking"
          : "none",

      analyzedStocks,

      rankingCount:
        alphaRanking.length,

      topRanking:
        alphaRanking.map(
          (
            row,
          ) => ({
            rank:
              row.rank,

            stockCode:
              row.stockCode,

            stockName:
              row.stockName ??
              null,

            score:
              row.score,

            coverage:
              row.coverage,

            quality:
              row.quality,

            scorerEligibleForEntryTiming:
              row.scorerEligibleForEntryTiming,

            blockingIssues:
              row.blockingIssues ??
              [],
          }),
        ),
    };

  if (
    alphaEligible.length ===
    0
  ) {
    const report = {
      status:
        "ALPHA_V1_READ_ONLY_PIPELINE_NO_ALPHA_ELIGIBLE_CANDIDATES",

      version:
        VERSION,

      startedAt,

      finishedAt:
        new Date()
          .toISOString(),

      alpha:
        alphaSummary,

      entryTiming: {
        invoked:
          false,

        reason:
          "NO_ALPHA_ELIGIBLE_CANDIDATES",
      },

      riskPreflight: {
        invoked:
          false,

        reason:
          "NO_ENTRY_TIMING_CANDIDATES",
      },

      execution: {
        eligibleCount:
          0,

        eligible:
          [],
      },

      contract: {
        alphaGate:
          "MUST_PASS_SCORER_ELIGIBLE_FOR_ENTRY_TIMING",

        entryTiming:
          "EXISTING_CALCULATE_ENTRY_SIGNAL",

        risk:
          "EXISTING_VALIDATE_BUY_RISK_VIA_READ_ONLY_PREFLIGHT",

        activePositionGate:
          "MATCH_GENERATE_ENTRY_SIGNALS",

        activeOrderGate:
          "BUY_STATUS_RISK_APPROVED",

        maximumSelected:
          DEFAULT_MAX_ORDERS,
      },

      safety: {
        databaseWrites:
          0,

        alphaWrites:
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

        productionDecisionApplied:
          false,
      },

      nextGate:
        "WAIT_FOR_REAL_ALPHA_ELIGIBLE_CANDIDATE_OR_RUN_HISTORICAL_PIPELINE_VALIDATION",

      outputFile:
        "logs/alpha-v1-alpha-entry-risk-read-only-pipeline.json",
    };

    writeReport(
      report,
    );

    return;
  }

  const stockCodes =
    alphaEligible.map(
      (
        row,
      ) =>
        row.stockCode,
    );

  const model =
    await resolveEntryModel();

  const entryScoreThreshold =
    await getActiveEntryThreshold();

  const predictionGate =
    await getLatestPredictionCandidates({
      maximumAgeMinutes:
        DEFAULT_MAX_PREDICTION_AGE_MINUTES,

      limit:
        100,
    });

  const predictionMap =
    new Map<
      string,
      PredictionCandidate
    >(
      predictionGate
        .candidates
        .map(
          (
            prediction,
          ) => [
            prediction.stockCode,
            prediction,
          ],
        ),
    );

  const supabase =
    createSupabaseServerClient();

  const snapshotResult =
    await supabase
      .from(
        "market_snapshots",
      )
      .select(`
        stock_code,
        observed_at,
        close_price,
        open_price,
        high_price,
        low_price,
        volume
      `)
      .in(
        "stock_code",
        stockCodes,
      )
      .lte(
        "observed_at",
        new Date()
          .toISOString(),
      )
      .order(
        "observed_at",
        {
          ascending:
            false,
        },
      )
      .limit(
        1000,
      );

  if (
    snapshotResult.error
  ) {
    throw new Error(
      `PIPELINE_SNAPSHOT_READ_FAILED:${snapshotResult.error.message}`,
    );
  }

  const snapshots =
    (
      snapshotResult.data ??
      []
    ) as SnapshotRecord[];

  const groupedSnapshots =
    groupSnapshots(
      snapshots,
    );

  const entryResults:
    Array<{
      alpha:
        AlphaRankingRow;

      predictionAvailable:
        boolean;

      candidate:
        SignalCandidate |
        null;

      blockers:
        string[];
    }> =
    [];

  for (
    const alphaRow
    of alphaEligible
  ) {
    const prediction =
      predictionMap.get(
        alphaRow.stockCode,
      );

    if (
      !prediction
    ) {
      entryResults.push({
        alpha:
          alphaRow,

        predictionAvailable:
          false,

        candidate:
          null,

        blockers: [
          "NO_CURRENT_ENTRY_PREDICTION",
        ],
      });

      continue;
    }

    const stockSnapshots =
      groupedSnapshots.get(
        alphaRow.stockCode,
      ) ??
      [];

    const candidate =
      calculateEntrySignal(
        stockSnapshots,
        prediction,
        entryScoreThreshold,
      );

    entryResults.push({
      alpha:
        alphaRow,

      predictionAvailable:
        true,

      candidate,

      blockers:
        candidate
          ? (
              candidate.qualifies
                ? []
                : [
                    "ENTRY_TIMING_NOT_QUALIFIED",
                  ]
            )
          : [
              "ENTRY_TIMING_CANDIDATE_UNAVAILABLE",
            ],
    });
  }

  const calculatedCandidates =
    entryResults
      .map(
        (
          row,
        ) =>
          row.candidate,
      )
      .filter(
        (
          candidate,
        ): candidate is SignalCandidate =>
          candidate !==
          null,
      )
      .sort(
        (
          left,
          right,
        ) =>
          right.score -
          left.score,
      );

  const calculatedStockCodes =
    calculatedCandidates.map(
      (
        candidate,
      ) =>
        candidate.stockCode,
    );

  const activePositionCodes =
    new Set<string>();

  const activeOrderCodes =
    new Set<string>();

  if (
    calculatedStockCodes.length >
    0
  ) {
    const {
      data:
        positionData,
      error:
        positionError,
    } =
      await supabase
        .from(
          "paper_positions",
        )
        .select(
          "stock_code",
        )
        .in(
          "stock_code",
          calculatedStockCodes,
        );

    if (
      positionError
    ) {
      throw new Error(
        `PIPELINE_POSITION_READ_FAILED:${positionError.message}`,
      );
    }

    for (
      const position
      of positionData ??
      []
    ) {
      activePositionCodes
        .add(
          String(
            position.stock_code,
          ),
        );
    }

    const {
      data:
        orderData,
      error:
        orderError,
    } =
      await supabase
        .from(
          "paper_order_requests",
        )
        .select(
          "stock_code",
        )
        .eq(
          "side",
          "BUY",
        )
        .eq(
          "status",
          "RISK_APPROVED",
        )
        .in(
          "stock_code",
          calculatedStockCodes,
        );

    if (
      orderError
    ) {
      throw new Error(
        `PIPELINE_ORDER_READ_FAILED:${orderError.message}`,
      );
    }

    for (
      const order
      of orderData ??
      []
    ) {
      activeOrderCodes
        .add(
          String(
            order.stock_code,
          ),
        );
    }
  }

  const entryEligible =
    calculatedCandidates
      .filter(
        (
          candidate,
        ) =>
          candidate.qualifies &&
          !activePositionCodes
            .has(
              candidate.stockCode,
            ) &&
          !activeOrderCodes
            .has(
              candidate.stockCode,
            ),
      );

  const selectedForRisk =
    entryEligible.slice(
      0,
      DEFAULT_MAX_ORDERS,
    );

  const riskResults =
    [];

  for (
    const candidate
    of selectedForRisk
  ) {
    const preflight =
      await evaluateReadOnlyBuyRiskPreflight({
        stockCode:
          candidate.stockCode,

        modelId:
          model.id,

        entryPrice:
          candidate.entryPrice,

        proposedStopPrice:
          candidate.stopPrice,

        requestedQuantity:
          candidate.quantity,

        entryObservedAt:
          candidate.observedAt,
      });

    riskResults.push({
      stockCode:
        candidate.stockCode,

      entryScore:
        candidate.score,

      entryQualifies:
        candidate.qualifies,

      entryPrice:
        candidate.entryPrice,

      stopPrice:
        candidate.stopPrice,

      quantity:
        candidate.quantity,

      preflight,
    });
  }

  const executionEligible =
    riskResults.filter(
      (
        row,
      ) =>
        row.preflight
          .executionEligible ===
        true,
    );

  const report = {
    status:
      "ALPHA_V1_ALPHA_ENTRY_RISK_READ_ONLY_PIPELINE_COMPLETE",

    version:
      VERSION,

    startedAt,

    finishedAt:
      new Date()
        .toISOString(),

    alpha:
      alphaSummary,

    entryTiming: {
      invoked:
        true,

      model: {
        id:
          model.id,

        name:
          model.model_name,

        version:
          model.model_version,

        purpose:
          model.purpose,

        status:
          model.status,
      },

      threshold:
        entryScoreThreshold,

      maximumPredictionAgeMinutes:
        DEFAULT_MAX_PREDICTION_AGE_MINUTES,

      predictionGate: {
        reason:
          predictionGate.reason,

        candidateCount:
          predictionGate
            .candidates
            .length,
      },

      snapshotsRead:
        snapshots.length,

      results:
        entryResults.map(
          (
            row,
          ) => ({
            alphaRank:
              row.alpha.rank,

            stockCode:
              row.alpha.stockCode,

            alphaScore:
              row.alpha.score,

            predictionAvailable:
              row.predictionAvailable,

            candidate:
              row.candidate,

            blockers:
              [
                ...row.blockers,

                ...(
                  row.candidate &&
                  activePositionCodes
                    .has(
                      row.candidate
                        .stockCode,
                    )
                    ? [
                        "ACTIVE_POSITION_EXISTS",
                      ]
                    : []
                ),

                ...(
                  row.candidate &&
                  activeOrderCodes
                    .has(
                      row.candidate
                        .stockCode,
                    )
                    ? [
                        "RISK_APPROVED_BUY_ORDER_EXISTS",
                      ]
                    : []
                ),
              ],
          }),
        ),

      qualifiedCount:
        calculatedCandidates
          .filter(
            (
              candidate,
            ) =>
              candidate.qualifies,
          )
          .length,

      eligibleAfterPositionOrderGate:
        entryEligible.length,

      selectedForRisk:
        selectedForRisk.map(
          (
            candidate,
          ) =>
            candidate.stockCode,
        ),
    },

    riskPreflight: {
      invoked:
        selectedForRisk.length >
        0,

      evaluated:
        riskResults.length,

      approved:
        riskResults.filter(
          (
            row,
          ) =>
            row.preflight
              .approved ===
            true,
        ).length,

      executionEligible:
        executionEligible.length,

      results:
        riskResults,
    },

    execution: {
      eligibleCount:
        executionEligible.length,

      eligible:
        executionEligible.map(
          (
            row,
          ) => ({
            stockCode:
              row.stockCode,

            entryPrice:
              row.entryPrice,

            stopPrice:
              row.stopPrice,

            quantity:
              row.quantity,

            entryScore:
              row.entryScore,

            riskApproved:
              row.preflight
                .approved,

            executionEligible:
              row.preflight
                .executionEligible,

            blockers:
              row.preflight
                .executionBlockers,
          }),
        ),

      action:
        "READ_ONLY_NO_ORDER_CREATION",
    },

    contract: {
      alphaGate:
        "SCORER_ELIGIBLE_FOR_ENTRY_TIMING",

      entryTiming:
        "EXISTING_EXPORTED_CALCULATE_ENTRY_SIGNAL",

      entryFormulaChanged:
        false,

      positionGate:
        "NO_EXISTING_PAPER_POSITION",

      orderGate:
        "NO_EXISTING_BUY_RISK_APPROVED_ORDER",

      maxOrders:
        DEFAULT_MAX_ORDERS,

      risk:
        "EXISTING_VALIDATE_BUY_RISK_VIA_READ_ONLY_PREFLIGHT",

      orderCreation:
        "DISABLED",
    },

    safety: {
      databaseWrites:
        0,

      alphaWrites:
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

      productionDecisionApplied:
        false,
    },

    nextGate:
      executionEligible.length >
        0
        ? "REVIEW_EXECUTION_ELIGIBLE_READ_ONLY_CANDIDATES_BEFORE_ANY_PAPER_ORDER_BINDING"
        : "NO_EXECUTION_ELIGIBLE_CANDIDATES_KEEP_PIPELINE_READ_ONLY",

    outputFile:
      "logs/alpha-v1-alpha-entry-risk-read-only-pipeline.json",
  };

  writeReport(
    report,
  );
}

main().catch(
  (
    error,
  ) => {
    console.error(
      JSON.stringify(
        {
          status:
            "ALPHA_V1_ALPHA_ENTRY_RISK_READ_ONLY_PIPELINE_FAILED",

          version:
            VERSION,

          error:
            String(
              error instanceof Error
                ? error.message
                : error,
            ),

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
          },

          nextGate:
            "REVIEW_PIPELINE_FAILURE_BEFORE_ANY_PRODUCTION_BINDING",
        },
        null,
        2,
      ),
    );

    process.exitCode =
      2;
  },
);
