import fs from "node:fs";
import path from "node:path";

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
  type SnapshotRecord,
} from "../lib/trading/generate-entry-signals";

import {
  evaluateReadOnlyBuyRiskPreflight,
} from "../lib/trading/read-only-buy-risk-preflight";

const VERSION =
  "ALPHA_V1_DOWNSTREAM_PLUMBING_READ_ONLY_SMOKE";

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
    "alpha-v1-downstream-plumbing-read-only-smoke.json",
  );

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
  decisionAt: string;
  track: string;
  ranking?: AlphaRankingRow[];
  topRanking?: AlphaRankingRow[];
  counts?: {
    analyzedStocks?: number;
    scorerEligible?: number;
  };
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

function writeReport(
  report: unknown,
) {
  fs.mkdirSync(
    path.dirname(
      OUTPUT_FILE,
    ),
    {
      recursive: true,
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
  const alpha =
    readJson(
      ALPHA_LOG,
    ) as AlphaReport;

  const ranking =
    alpha.ranking ??
    alpha.topRanking ??
    [];

  if (
    ranking.length ===
    0
  ) {
    throw new Error(
      "ALPHA_RANKING_EMPTY_FOR_DOWNSTREAM_SMOKE",
    );
  }

  const diagnosticAlpha =
    [...ranking].sort(
      (
        left,
        right,
      ) =>
        left.rank -
        right.rank,
    )[0];

  if (
    !diagnosticAlpha
  ) {
    throw new Error(
      "DIAGNOSTIC_ALPHA_ROW_NOT_FOUND",
    );
  }

  const model =
    await resolveEntryModel();

  const entryScoreThreshold =
    await getActiveEntryThreshold();

  const predictionGate =
    await getLatestPredictionCandidates({
      maximumAgeMinutes:
        180,

      limit:
        100,
    });

  const prediction =
    predictionGate
      .candidates
      .find(
        (
          row: PredictionCandidate,
        ) =>
          row.stockCode ===
          diagnosticAlpha.stockCode,
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
      .eq(
        "stock_code",
        diagnosticAlpha.stockCode,
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
      `DOWNSTREAM_SMOKE_SNAPSHOT_READ_FAILED:${snapshotResult.error.message}`,
    );
  }

  const snapshots =
    (
      snapshotResult.data ??
      []
    ) as SnapshotRecord[];

  const entryCandidate =
    prediction
      ? calculateEntrySignal(
          snapshots,
          prediction,
          entryScoreThreshold,
        )
      : null;

  let riskPreflight:
    Awaited<
      ReturnType<
        typeof evaluateReadOnlyBuyRiskPreflight
      >
    > |
    null =
    null;

  if (
    entryCandidate
  ) {
    riskPreflight =
      await evaluateReadOnlyBuyRiskPreflight({
        stockCode:
          entryCandidate.stockCode,

        modelId:
          model.id,

        entryPrice:
          entryCandidate.entryPrice,

        proposedStopPrice:
          entryCandidate.stopPrice,

        requestedQuantity:
          entryCandidate.quantity,

        entryObservedAt:
          entryCandidate.observedAt,
      });
  }

  const report = {
    status:
      "ALPHA_V1_DOWNSTREAM_PLUMBING_READ_ONLY_SMOKE_COMPLETE",

    version:
      VERSION,

    alpha: {
      status:
        alpha.status,

      decisionAt:
        alpha.decisionAt,

      track:
        alpha.track,

      actualScorerEligible:
        diagnosticAlpha
          .scorerEligibleForEntryTiming,

      diagnosticOverride:
        true,

      overrideReason:
        "TEST_DOWNSTREAM_WIRING_WITHOUT_CHANGING_ALPHA_POLICY",

      row: {
        rank:
          diagnosticAlpha.rank,

        stockCode:
          diagnosticAlpha.stockCode,

        stockName:
          diagnosticAlpha.stockName ??
          null,

        score:
          diagnosticAlpha.score,

        coverage:
          diagnosticAlpha.coverage,

        quality:
          diagnosticAlpha.quality,

        blockingIssues:
          diagnosticAlpha
            .blockingIssues ??
          [],
      },
    },

    entryTiming: {
      invoked:
        Boolean(
          prediction,
        ),

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

      predictionGateReason:
        predictionGate.reason,

      predictionAvailable:
        Boolean(
          prediction,
        ),

      snapshotCount:
        snapshots.length,

      candidate:
        entryCandidate,

      actualQualifies:
        entryCandidate
          ?.qualifies ??
        false,
    },

    riskPreflight: {
      invoked:
        Boolean(
          riskPreflight,
        ),

      result:
        riskPreflight,
    },

    production: {
      alphaPolicyChanged:
        false,

      alphaThresholdLowered:
        false,

      entryThresholdChanged:
        false,

      riskPolicyChanged:
        false,

      productionExecutionEligible:
        false,

      reason:
        "DIAGNOSTIC_OVERRIDE_MUST_NEVER_CREATE_EXECUTION_ELIGIBILITY",
    },

    contract: {
      alpha:
        "REAL_ALPHA_ROW_DIAGNOSTIC_OVERRIDE_ONLY",

      entryTiming:
        "EXISTING_CALCULATE_ENTRY_SIGNAL",

      risk:
        "EXISTING_VALIDATE_BUY_RISK_VIA_READ_ONLY_PREFLIGHT",

      purpose:
        "VERIFY_DOWNSTREAM_WIRING_BEFORE_HISTORICAL_REPLAY",
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

      productionDecisionApplied:
        false,
    },

    nextGate:
      entryCandidate &&
      riskPreflight
        ? "ALPHA_V1_HISTORICAL_READ_ONLY_PIPELINE_VALIDATION"
        : "REVIEW_DOWNSTREAM_SMOKE_MISSING_ENTRY_OR_RISK_RESULT",

    outputFile:
      "logs/alpha-v1-downstream-plumbing-read-only-smoke.json",
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
            "ALPHA_V1_DOWNSTREAM_PLUMBING_READ_ONLY_SMOKE_FAILED",

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

            aiEntrySignalWrites:
              0,

            riskDecisionWrites:
              0,

            paperOrderWrites:
              0,

            ordersCreated:
              0,
          },
        },
        null,
        2,
      ),
    );

    process.exitCode =
      2;
  },
);
