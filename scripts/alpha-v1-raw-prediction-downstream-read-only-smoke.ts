import fs from "node:fs";
import path from "node:path";

import {
  createSupabaseServerClient,
} from "../lib/supabase";

import {
  getActiveEntryThreshold,
} from "../lib/trading/get-active-entry-threshold";

import type {
  PredictionCandidate,
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
  "ALPHA_V1_RAW_PREDICTION_DOWNSTREAM_READ_ONLY_SMOKE";

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
    "alpha-v1-raw-prediction-downstream-read-only-smoke.json",
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
}

interface LatestPredictionRecord {
  prediction_date: string;
  generated_at: string;
  model_name: string;
  model_version: string;
}

interface RawPredictionRecord {
  id: string;
  stock_code: string;
  prediction_date: string;
  generated_at: string;
  model_name: string;
  model_version: string;

  score:
    | number
    | string;

  confidence:
    | number
    | string;

  direction:
    | "UP"
    | "NEUTRAL"
    | "DOWN";

  is_candidate:
    boolean;

  disclosure_score:
    | number
    | string
    | null;

  price_momentum:
    | number
    | string
    | null;

  intraday_return:
    | number
    | string
    | null;

  volume_ratio:
    | number
    | string
    | null;

  reasons:
    unknown;
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

function toNumber(
  value: unknown,
): number | null {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const parsed =
    Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function toReasons(
  value: unknown,
): string[] {
  if (
    !Array.isArray(value)
  ) {
    return [];
  }

  return value.filter(
    (
      item,
    ): item is string =>
      typeof item ===
        "string" &&
      item
        .trim()
        .length >
        0,
  );
}

function mapRawPrediction(
  record: RawPredictionRecord,
): PredictionCandidate {
  return {
    predictionId:
      record.id,

    stockCode:
      record.stock_code,

    predictionDate:
      record.prediction_date,

    generatedAt:
      record.generated_at,

    modelName:
      record.model_name,

    modelVersion:
      record.model_version,

    score:
      toNumber(
        record.score,
      ) ??
      0,

    confidence:
      toNumber(
        record.confidence,
      ) ??
      0,

    disclosureScore:
      toNumber(
        record.disclosure_score,
      ),

    priceMomentum:
      toNumber(
        record.price_momentum,
      ),

    intradayReturn:
      toNumber(
        record.intraday_return,
      ),

    volumeRatio:
      toNumber(
        record.volume_ratio,
      ),

    reasons:
      toReasons(
        record.reasons,
      ),
  };
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
  const alpha =
    readJson(
      ALPHA_LOG,
    ) as AlphaReport;

  const ranking =
    alpha.ranking ??
    alpha.topRanking ??
    [];

  const diagnosticAlpha =
    [...ranking]
      .sort(
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
      "ALPHA_RANKING_EMPTY_FOR_RAW_PREDICTION_SMOKE",
    );
  }

  const supabase =
    createSupabaseServerClient();

  const {
    data:
      latestPredictionData,
    error:
      latestPredictionError,
  } =
    await supabase
      .from(
        "ai_stock_predictions",
      )
      .select(`
        prediction_date,
        generated_at,
        model_name,
        model_version
      `)
      .order(
        "generated_at",
        {
          ascending:
            false,
        },
      )
      .limit(1)
      .maybeSingle();

  if (
    latestPredictionError ||
    !latestPredictionData
  ) {
    throw new Error(
      `LATEST_RAW_PREDICTION_COHORT_READ_FAILED:${
        latestPredictionError
          ?.message ??
        "NO_PREDICTION"
      }`,
    );
  }

  const latest =
    latestPredictionData as
      LatestPredictionRecord;

  const {
    data:
      rawPredictionData,
    error:
      rawPredictionError,
  } =
    await supabase
      .from(
        "ai_stock_predictions",
      )
      .select(`
        id,
        stock_code,
        prediction_date,
        generated_at,
        model_name,
        model_version,
        score,
        confidence,
        direction,
        is_candidate,
        disclosure_score,
        price_momentum,
        intraday_return,
        volume_ratio,
        reasons
      `)
      .eq(
        "prediction_date",
        latest
          .prediction_date,
      )
      .eq(
        "model_name",
        latest
          .model_name,
      )
      .eq(
        "model_version",
        latest
          .model_version,
      )
      .eq(
        "stock_code",
        diagnosticAlpha
          .stockCode,
      )
      .order(
        "generated_at",
        {
          ascending:
            false,
        },
      )
      .limit(1)
      .maybeSingle();

  if (
    rawPredictionError ||
    !rawPredictionData
  ) {
    throw new Error(
      `TARGET_RAW_PREDICTION_READ_FAILED:${
        rawPredictionError
          ?.message ??
        diagnosticAlpha
          .stockCode
      }`,
    );
  }

  const rawPrediction =
    rawPredictionData as
      RawPredictionRecord;

  const diagnosticPrediction =
    mapRawPrediction(
      rawPrediction,
    );

  const model =
    await resolveEntryModel();

  const entryScoreThreshold =
    await getActiveEntryThreshold();

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
        diagnosticAlpha
          .stockCode,
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
      `RAW_PREDICTION_SMOKE_SNAPSHOT_READ_FAILED:${snapshotResult.error.message}`,
    );
  }

  const snapshots =
    (
      snapshotResult.data ??
      []
    ) as
      SnapshotRecord[];

  const entryCandidate =
    calculateEntrySignal(
      snapshots,
      diagnosticPrediction,
      entryScoreThreshold,
    );

  if (
    !entryCandidate
  ) {
    throw new Error(
      "ENTRY_CALCULATOR_RETURNED_NULL_FOR_DIAGNOSTIC_RAW_PREDICTION",
    );
  }

  const riskPreflight =
    await evaluateReadOnlyBuyRiskPreflight({
      stockCode:
        entryCandidate
          .stockCode,

      modelId:
        model.id,

      entryPrice:
        entryCandidate
          .entryPrice,

      proposedStopPrice:
        entryCandidate
          .stopPrice,

      requestedQuantity:
        entryCandidate
          .quantity,

      entryObservedAt:
        entryCandidate
          .observedAt,
    });

  const report = {
    status:
      "ALPHA_V1_RAW_PREDICTION_DOWNSTREAM_READ_ONLY_SMOKE_COMPLETE",

    version:
      VERSION,

    alpha: {
      status:
        alpha.status,

      decisionAt:
        alpha.decisionAt,

      track:
        alpha.track,

      row: {
        rank:
          diagnosticAlpha.rank,

        stockCode:
          diagnosticAlpha
            .stockCode,

        stockName:
          diagnosticAlpha
            .stockName ??
          null,

        score:
          diagnosticAlpha.score,

        coverage:
          diagnosticAlpha
            .coverage,

        quality:
          diagnosticAlpha
            .quality,

        actualScorerEligible:
          diagnosticAlpha
            .scorerEligibleForEntryTiming,

        blockingIssues:
          diagnosticAlpha
            .blockingIssues ??
          [],
      },

      diagnosticOverride:
        true,

      productionAlphaGateBypassed:
        false,
    },

    rawPrediction: {
      diagnosticOverride:
        true,

      sourceTable:
        "ai_stock_predictions",

      cohort: {
        predictionDate:
          latest
            .prediction_date,

        modelName:
          latest
            .model_name,

        modelVersion:
          latest
            .model_version,

        latestGeneratedAt:
          latest
            .generated_at,
      },

      originalFlags: {
        direction:
          rawPrediction
            .direction,

        isCandidate:
          rawPrediction
            .is_candidate,
      },

      mappedPredictionCandidate:
        diagnosticPrediction,

      productionCandidateFilterSatisfied:
        rawPrediction
          .is_candidate ===
          true &&
        rawPrediction
          .direction ===
          "UP",

      overridePurpose:
        "DOWNSTREAM_WIRING_DIAGNOSTIC_ONLY",
    },

    entryTiming: {
      invoked:
        true,

      model: {
        id:
          model.id,

        name:
          model
            .model_name,

        version:
          model
            .model_version,

        purpose:
          model
            .purpose,

        status:
          model.status,
      },

      threshold:
        entryScoreThreshold,

      snapshotCount:
        snapshots.length,

      candidate:
        entryCandidate,

      actualQualifies:
        entryCandidate
          .qualifies,
    },

    riskPreflight: {
      invoked:
        true,

      result:
        riskPreflight,
    },

    production: {
      alphaThresholdLowered:
        false,

      predictionCandidatePolicyChanged:
        false,

      predictionRowPromoted:
        false,

      entryThresholdChanged:
        false,

      riskPolicyChanged:
        false,

      productionExecutionEligible:
        false,

      diagnosticOnly:
        true,
    },

    contract: {
      predictionMapping:
        "EXACT_GET_LATEST_PREDICTION_CANDIDATES_FIELD_MAPPING",

      entryTiming:
        "EXISTING_CALCULATE_ENTRY_SIGNAL",

      risk:
        "EXISTING_VALIDATE_BUY_RISK_VIA_READ_ONLY_PREFLIGHT",

      successCondition:
        "ENTRY_CANDIDATE_NON_NULL_AND_RISK_PREFLIGHT_RETURNED",
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

      productionDecisionApplied:
        false,
    },

    nextGate:
      "ALPHA_V1_HISTORICAL_READ_ONLY_PIPELINE_VALIDATION",

    outputFile:
      "logs/alpha-v1-raw-prediction-downstream-read-only-smoke.json",
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
            "ALPHA_V1_RAW_PREDICTION_DOWNSTREAM_READ_ONLY_SMOKE_FAILED",

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
