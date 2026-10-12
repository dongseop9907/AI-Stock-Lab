import { createSupabaseServerClient } from "@/lib/supabase";

interface CandidateQueryInput {
  maximumAgeMinutes?: number;
  limit?: number;
}

interface LatestPredictionRecord {
  prediction_date: string;
  generated_at: string;
  model_name: string;
  model_version: string;
}

interface PredictionCandidateRecord {
  id: string;
  stock_code: string;

  prediction_date: string;
  generated_at: string;

  model_name: string;
  model_version: string;

  score: number | string;
  confidence: number | string;

  direction:
    | "UP"
    | "NEUTRAL"
    | "DOWN";

  is_candidate: boolean;

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

  reasons: unknown;
}

export interface PredictionCandidate {
  predictionId: string;
  stockCode: string;

  predictionDate: string;
  generatedAt: string;

  modelName: string;
  modelVersion: string;

  score: number;
  confidence: number;

  disclosureScore: number | null;
  priceMomentum: number | null;
  intradayReturn: number | null;
  volumeRatio: number | null;

  reasons: string[];
}

export interface LatestPredictionCandidatesResult {
  available: boolean;
  fresh: boolean;

  predictionDate: string | null;
  generatedAt: string | null;

  modelName: string | null;
  modelVersion: string | null;

  ageMinutes: number | null;
  maximumAgeMinutes: number;

  candidateCount: number;
  stockCodes: string[];

  candidates: PredictionCandidate[];

  reason:
    | "OK"
    | "NO_PREDICTION"
    | "STALE_PREDICTION"
    | "NO_CANDIDATE";
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
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (
      item,
    ): item is string =>
      typeof item === "string" &&
      item.trim().length > 0,
  );
}

export async function getLatestPredictionCandidates(
  input: CandidateQueryInput = {},
): Promise<LatestPredictionCandidatesResult> {
  const supabase =
    createSupabaseServerClient();

  const maximumAgeMinutes =
    Math.min(
      7 * 24 * 60,
      Math.max(
        10,
        Math.floor(
          input.maximumAgeMinutes ??
            24 * 60,
        ),
      ),
    );

  const limit =
    Math.min(
      100,
      Math.max(
        1,
        Math.floor(
          input.limit ?? 20,
        ),
      ),
    );

  const {
    data: latestData,
    error: latestError,
  } = await supabase
    .from("ai_stock_predictions")
    .select(`
      prediction_date,
      generated_at,
      model_name,
      model_version
    `)
    .order("generated_at", {
      ascending: false,
    })
    .limit(1)
    .maybeSingle();

  if (latestError) {
    throw new Error(
      `최신 AI 예측 조회 실패: ${latestError.message}`,
    );
  }

  if (!latestData) {
    return {
      available: false,
      fresh: false,

      predictionDate: null,
      generatedAt: null,

      modelName: null,
      modelVersion: null,

      ageMinutes: null,
      maximumAgeMinutes,

      candidateCount: 0,
      stockCodes: [],
      candidates: [],

      reason:
        "NO_PREDICTION",
    };
  }

  const latest =
    latestData as
      LatestPredictionRecord;

  const generatedTime =
    new Date(
      latest.generated_at,
    ).getTime();

  const ageMinutes =
    Number.isFinite(
      generatedTime,
    )
      ? Math.max(
          0,
          (
            Date.now() -
            generatedTime
          ) /
            (
              60 *
              1000
            ),
        )
      : Number.POSITIVE_INFINITY;

  if (
    ageMinutes >
    maximumAgeMinutes
  ) {
    return {
      available: true,
      fresh: false,

      predictionDate:
        latest.prediction_date,

      generatedAt:
        latest.generated_at,

      modelName:
        latest.model_name,

      modelVersion:
        latest.model_version,

      ageMinutes:
        Number.isFinite(
          ageMinutes,
        )
          ? Number(
              ageMinutes.toFixed(
                2,
              ),
            )
          : null,

      maximumAgeMinutes,

      candidateCount: 0,
      stockCodes: [],
      candidates: [],

      reason:
        "STALE_PREDICTION",
    };
  }

  const {
    data,
    error,
  } = await supabase
    .from("ai_stock_predictions")
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
      latest.prediction_date,
    )
    .eq(
      "model_name",
      latest.model_name,
    )
    .eq(
      "model_version",
      latest.model_version,
    )
    .eq(
      "is_candidate",
      true,
    )
    .eq(
      "direction",
      "UP",
    )
    .order("score", {
      ascending: false,
    })
    .limit(limit);

  if (error) {
    throw new Error(
      `AI 상승 후보 조회 실패: ${error.message}`,
    );
  }

  const records =
    (data ??
      []) as PredictionCandidateRecord[];

  const candidates:
    PredictionCandidate[] =
    records.map(
      (record) => ({
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
      }),
    );

  return {
    available: true,
    fresh: true,

    predictionDate:
      latest.prediction_date,

    generatedAt:
      latest.generated_at,

    modelName:
      latest.model_name,

    modelVersion:
      latest.model_version,

    ageMinutes:
      Number(
        ageMinutes.toFixed(2),
      ),

    maximumAgeMinutes,

    candidateCount:
      candidates.length,

    stockCodes:
      candidates.map(
        (candidate) =>
          candidate.stockCode,
      ),

    candidates,

    reason:
      candidates.length > 0
        ? "OK"
        : "NO_CANDIDATE",
  };
}