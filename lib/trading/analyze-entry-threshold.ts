import { createSupabaseServerClient } from "@/lib/supabase";

type DecisionLabel =
  | "GOOD_SKIP"
  | "BAD_SKIP"
  | "GOOD_ENTRY"
  | "BAD_ENTRY";

type RecommendationStatus =
  | "INSUFFICIENT_DATA"
  | "NO_CHANGE"
  | "RECOMMENDED";

interface ShadowTrackRecord {
  model_id: string | null;

  signal_score:
    | number
    | string
    | null;

  decision_label:
    DecisionLabel;

  completed_at:
    | string
    | null;
}

interface ThresholdSample {
  score: number;
  shouldEnter: boolean;
  label: DecisionLabel;
}

interface ThresholdMetrics {
  threshold: number;

  truePositive: number;
  falsePositive: number;
  trueNegative: number;
  falseNegative: number;

  predictedEntryCount: number;
  predictedSkipCount: number;

  accuracy: number;
  precision: number;
  recall: number;
  specificity: number;
  balancedAccuracy: number;
  f1Score: number;

  objectiveScore: number;
}

export interface AnalyzeEntryThresholdInput {
  modelId?: string | null;

  currentThreshold?: number;

  lookbackDays?: number;
  limit?: number;

  minimumSamples?: number;
  minimumClassSamples?: number;

  maximumThresholdChange?: number;
  minimumImprovement?: number;
}

export interface AnalyzeEntryThresholdResult {
  recommendationId: string;

  status:
    RecommendationStatus;

  modelId: string | null;

  sampleCount: number;
  positiveCount: number;
  negativeCount: number;

  currentThreshold: number;

  rawBestThreshold:
    | number
    | null;

  recommendedThreshold:
    | number
    | null;

  currentMetrics:
    | ThresholdMetrics
    | null;

  recommendedMetrics:
    | ThresholdMetrics
    | null;

  objectiveImprovement:
    | number
    | null;

  reason: string;
}

function clamp(
  value: number,
  minimum: number,
  maximum: number,
): number {
  return Math.min(
    maximum,
    Math.max(
      minimum,
      value,
    ),
  );
}

function roundThreshold(
  value: number,
): number {
  return Number(
    value.toFixed(2),
  );
}

function toNumber(
  value: unknown,
): number | null {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const parsed =
    Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function safeDivide(
  numerator: number,
  denominator: number,
): number {
  return denominator > 0
    ? numerator / denominator
    : 0;
}

function getShouldEnter(
  label: DecisionLabel,
): boolean {
  /*
   * BAD_SKIP:
   * 매수하지 않았지만 상승했으므로
   * 진입했어야 했던 신호
   *
   * GOOD_ENTRY:
   * 실제 진입 판단이 좋았던 신호
   */
  return (
    label === "BAD_SKIP" ||
    label === "GOOD_ENTRY"
  );
}

function evaluateThreshold(
  samples: ThresholdSample[],
  threshold: number,
): ThresholdMetrics {
  let truePositive = 0;
  let falsePositive = 0;
  let trueNegative = 0;
  let falseNegative = 0;

  for (const sample of samples) {
    const predictedEntry =
      sample.score >= threshold;

    if (
      predictedEntry &&
      sample.shouldEnter
    ) {
      truePositive += 1;
    } else if (
      predictedEntry &&
      !sample.shouldEnter
    ) {
      falsePositive += 1;
    } else if (
      !predictedEntry &&
      !sample.shouldEnter
    ) {
      trueNegative += 1;
    } else {
      falseNegative += 1;
    }
  }

  const sampleCount =
    samples.length;

  const predictedEntryCount =
    truePositive +
    falsePositive;

  const predictedSkipCount =
    trueNegative +
    falseNegative;

  const accuracy =
    safeDivide(
      truePositive +
        trueNegative,
      sampleCount,
    );

  const precision =
    safeDivide(
      truePositive,
      truePositive +
        falsePositive,
    );

  const recall =
    safeDivide(
      truePositive,
      truePositive +
        falseNegative,
    );

  const specificity =
    safeDivide(
      trueNegative,
      trueNegative +
        falsePositive,
    );

  const balancedAccuracy =
    (
      recall +
      specificity
    ) / 2;

  const f1Score =
    precision +
      recall >
    0
      ? (
          2 *
          precision *
          recall
        ) /
        (
          precision +
          recall
        )
      : 0;

  /*
   * 손실 방지를 중요하게 보므로
   * 잘못된 진입을 줄이는 precision과
   * specificity 비중을 높게 둔다.
   */
  let objectiveScore =
    precision * 0.35 +
    recall * 0.2 +
    specificity * 0.25 +
    balancedAccuracy * 0.15 +
    accuracy * 0.05;

  /*
   * 모든 신호를 매수하거나
   * 모든 신호를 건너뛰는 기준점수는
   * 실전 활용성이 낮으므로 감점한다.
   */
  if (
    predictedEntryCount === 0 ||
    predictedSkipCount === 0
  ) {
    objectiveScore -= 0.15;
  }

  return {
    threshold:
      roundThreshold(
        threshold,
      ),

    truePositive,
    falsePositive,
    trueNegative,
    falseNegative,

    predictedEntryCount,
    predictedSkipCount,

    accuracy,
    precision,
    recall,
    specificity,
    balancedAccuracy,
    f1Score,

    objectiveScore,
  };
}

export async function analyzeEntryThreshold(
  input: AnalyzeEntryThresholdInput = {},
): Promise<AnalyzeEntryThresholdResult> {
  const supabase =
    createSupabaseServerClient();

  const modelId =
    input.modelId?.trim() ||
    null;

  const currentThreshold =
    roundThreshold(
      clamp(
        Number.isFinite(
          input.currentThreshold,
        )
          ? Number(
              input.currentThreshold,
            )
          : 0.62,
        0.1,
        0.9,
      ),
    );

  const lookbackDays =
    Math.min(
      365,
      Math.max(
        7,
        Math.floor(
          input.lookbackDays ??
            90,
        ),
      ),
    );

  const limit =
    Math.min(
      10000,
      Math.max(
        100,
        Math.floor(
          input.limit ??
            3000,
        ),
      ),
    );

  const minimumSamples =
    Math.max(
      20,
      Math.floor(
        input.minimumSamples ??
          30,
      ),
    );

  const minimumClassSamples =
    Math.max(
      3,
      Math.floor(
        input.minimumClassSamples ??
          5,
      ),
    );

  const maximumThresholdChange =
    clamp(
      Number.isFinite(
        input.maximumThresholdChange,
      )
        ? Number(
            input.maximumThresholdChange,
          )
        : 0.05,
      0.01,
      0.15,
    );

  const minimumImprovement =
    clamp(
      Number.isFinite(
        input.minimumImprovement,
      )
        ? Number(
            input.minimumImprovement,
          )
        : 0.015,
      0,
      0.2,
    );

  const since =
    new Date(
      Date.now() -
        lookbackDays *
          24 *
          60 *
          60 *
          1000,
    ).toISOString();

  let query =
    supabase
      .from(
        "shadow_signal_tracks",
      )
      .select(`
        model_id,
        signal_score,
        decision_label,
        completed_at
      `)
      .eq(
        "evaluation_status",
        "COMPLETE",
      )
      .in(
        "decision_label",
        [
          "GOOD_SKIP",
          "BAD_SKIP",
          "GOOD_ENTRY",
          "BAD_ENTRY",
        ],
      )
      .gte(
        "completed_at",
        since,
      )
      .order(
        "completed_at",
        {
          ascending: false,
        },
      )
      .limit(limit);

  if (modelId) {
    query =
      query.eq(
        "model_id",
        modelId,
      );
  }

  const {
    data,
    error,
  } = await query;

  if (error) {
    throw new Error(
      `진입 기준 분석 데이터 조회 실패: ${error.message}`,
    );
  }

  const records =
    (data ??
      []) as ShadowTrackRecord[];

  const samples:
    ThresholdSample[] =
    records
      .map((record) => {
        const score =
          toNumber(
            record.signal_score,
          );

        if (
          score === null ||
          score < 0 ||
          score > 1
        ) {
          return null;
        }

        return {
          score,

          shouldEnter:
            getShouldEnter(
              record.decision_label,
            ),

          label:
            record.decision_label,
        };
      })
      .filter(
        (
          sample,
        ): sample is ThresholdSample =>
          sample !== null,
      );

  const positiveCount =
    samples.filter(
      (sample) =>
        sample.shouldEnter,
    ).length;

  const negativeCount =
    samples.length -
    positiveCount;

  const completedDates =
    records
      .map(
        (record) =>
          record.completed_at,
      )
      .filter(
        (
          value,
        ): value is string =>
          typeof value ===
            "string" &&
          value.length > 0,
      )
      .sort();

  const analyzedFrom =
    completedDates[0] ??
    null;

  const analyzedTo =
    completedDates.at(-1) ??
    null;

  const hasEnoughData =
    samples.length >=
      minimumSamples &&
    positiveCount >=
      minimumClassSamples &&
    negativeCount >=
      minimumClassSamples;

  if (!hasEnoughData) {
    const {
      data: saved,
      error: saveError,
    } = await supabase
      .from(
        "entry_threshold_recommendations",
      )
      .insert({
        model_id:
          modelId,

        analyzed_from:
          analyzedFrom,

        analyzed_to:
          analyzedTo,

        current_threshold:
          currentThreshold,

        raw_best_threshold:
          null,

        recommended_threshold:
          null,

        sample_count:
          samples.length,

        positive_count:
          positiveCount,

        negative_count:
          negativeCount,

        current_objective_score:
          null,

        recommended_objective_score:
          null,

        objective_improvement:
          null,

        status:
          "INSUFFICIENT_DATA",

        metrics: {
          minimumSamples,
          minimumClassSamples,

          reason:
            "NOT_ENOUGH_BALANCED_SAMPLES",
        },
      })
      .select("id")
      .single();

    if (saveError) {
      throw new Error(
        `기준점수 분석 결과 저장 실패: ${saveError.message}`,
      );
    }

    return {
      recommendationId:
        saved.id,

      status:
        "INSUFFICIENT_DATA",

      modelId,

      sampleCount:
        samples.length,

      positiveCount,
      negativeCount,

      currentThreshold,

      rawBestThreshold:
        null,

      recommendedThreshold:
        null,

      currentMetrics:
        null,

      recommendedMetrics:
        null,

      objectiveImprovement:
        null,

      reason:
        `표본이 부족합니다. 전체 ${samples.length}/${minimumSamples}개, 진입 필요 ${positiveCount}/${minimumClassSamples}개, 진입 불필요 ${negativeCount}/${minimumClassSamples}개입니다.`,
    };
  }

  const currentMetrics =
    evaluateThreshold(
      samples,
      currentThreshold,
    );

  const candidates:
    ThresholdMetrics[] =
    [];

  for (
    let value = 0.1;
    value <= 0.9;
    value += 0.01
  ) {
    candidates.push(
      evaluateThreshold(
        samples,
        roundThreshold(
          value,
        ),
      ),
    );
  }

  candidates.sort(
    (left, right) => {
      if (
        right.objectiveScore !==
        left.objectiveScore
      ) {
        return (
          right.objectiveScore -
          left.objectiveScore
        );
      }

      /*
       * 점수가 같으면 현재 기준점수에서
       * 가까운 후보를 선택한다.
       */
      return (
        Math.abs(
          left.threshold -
            currentThreshold,
        ) -
        Math.abs(
          right.threshold -
            currentThreshold,
        )
      );
    },
  );

  const rawBest =
    candidates[0];

  const recommendedThreshold =
    roundThreshold(
      clamp(
        rawBest.threshold,
        currentThreshold -
          maximumThresholdChange,
        currentThreshold +
          maximumThresholdChange,
      ),
    );

  const recommendedMetrics =
    evaluateThreshold(
      samples,
      recommendedThreshold,
    );

  const objectiveImprovement =
    recommendedMetrics.objectiveScore -
    currentMetrics.objectiveScore;

  const status:
    RecommendationStatus =
    objectiveImprovement >=
      minimumImprovement &&
    recommendedThreshold !==
      currentThreshold
      ? "RECOMMENDED"
      : "NO_CHANGE";

  const {
    data: saved,
    error: saveError,
  } = await supabase
    .from(
      "entry_threshold_recommendations",
    )
    .insert({
      model_id:
        modelId,

      analyzed_from:
        analyzedFrom,

      analyzed_to:
        analyzedTo,

      current_threshold:
        currentThreshold,

      raw_best_threshold:
        rawBest.threshold,

      recommended_threshold:
        recommendedThreshold,

      sample_count:
        samples.length,

      positive_count:
        positiveCount,

      negative_count:
        negativeCount,

      current_objective_score:
        currentMetrics.objectiveScore,

      recommended_objective_score:
        recommendedMetrics.objectiveScore,

      objective_improvement:
        objectiveImprovement,

      status,

      metrics: {
        lookbackDays,
        minimumSamples,
        minimumClassSamples,
        maximumThresholdChange,
        minimumImprovement,

        current:
          currentMetrics,

        recommended:
          recommendedMetrics,

        rawBest,

        topCandidates:
          candidates.slice(
            0,
            10,
          ),
      },
    })
    .select("id")
    .single();

  if (saveError) {
    throw new Error(
      `기준점수 추천 결과 저장 실패: ${saveError.message}`,
    );
  }

  return {
    recommendationId:
      saved.id,

    status,
    modelId,

    sampleCount:
      samples.length,

    positiveCount,
    negativeCount,

    currentThreshold,

    rawBestThreshold:
      rawBest.threshold,

    recommendedThreshold,

    currentMetrics,
    recommendedMetrics,

    objectiveImprovement,

    reason:
      status ===
      "RECOMMENDED"
        ? `현재 ${currentThreshold.toFixed(2)}에서 ${recommendedThreshold.toFixed(2)}로 조정하는 것이 추천됩니다.`
        : "현재 기준점수를 변경할 만큼 뚜렷한 성능 개선이 없습니다.",
  };
}