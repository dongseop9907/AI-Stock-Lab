import { createSupabaseServerClient } from "@/lib/supabase";

export type ModelPurpose =
  | "STOCK_SELECTION"
  | "ENTRY_TIMING"
  | "STOP_LOSS"
  | "TRAILING_STOP"
  | "TEST";

export type ModelStatus =
  | "CANDIDATE"
  | "APPROVED"
  | "REJECTED"
  | "RETIRED";

export interface ModelMetrics {
  sampleSize: number;

  /** 거래당 평균 수익률. 2%는 0.02 */
  averageReturn: number;

  /** 총이익 ÷ 총손실 */
  profitFactor: number;

  /** 최대 낙폭. 10%는 0.1 */
  maxDrawdown: number;

  /** 손절 품질 평균. -1부터 1 */
  stopQualityScore: number;

  /** 승률. 55%는 0.55 */
  winRate?: number;
}

export interface RegisterModelInput {
  modelName: string;
  modelVersion: string;
  purpose: ModelPurpose;
  trainingTradeCount: number;
  metrics: ModelMetrics;
  artifactUri?: string;
  description?: string;
}

interface ModelRecord {
  id: string;
  model_name: string;
  model_version: string;
  purpose: ModelPurpose;
  status: ModelStatus;
  training_trade_count: number;
  metrics: ModelMetrics;
}

const VALIDATION_RULE_VERSION =
  "model-validation-v1";

const RULES = Object.freeze({
  minimumSampleSize: 100,
  minimumProfitFactor: 1.1,
  maximumDrawdown: 0.15,
  minimumAverageReturn: 0,
  minimumStopQualityScore: -0.1,
  minimumScoreImprovement: 0.03,
  maximumDrawdownIncreaseRate: 0.1,
});

function clamp(
  value: number,
  minimum = 0,
  maximum = 1,
): number {
  return Math.min(
    maximum,
    Math.max(minimum, value),
  );
}

function assertFiniteNumber(
  value: number,
  fieldName: string,
): void {
  if (!Number.isFinite(value)) {
    throw new Error(
      `${fieldName} 값이 올바르지 않습니다.`,
    );
  }
}

function validateMetrics(
  metrics: ModelMetrics,
): void {
  assertFiniteNumber(
    metrics.sampleSize,
    "sampleSize",
  );

  assertFiniteNumber(
    metrics.averageReturn,
    "averageReturn",
  );

  assertFiniteNumber(
    metrics.profitFactor,
    "profitFactor",
  );

  assertFiniteNumber(
    metrics.maxDrawdown,
    "maxDrawdown",
  );

  assertFiniteNumber(
    metrics.stopQualityScore,
    "stopQualityScore",
  );

  if (
    !Number.isInteger(metrics.sampleSize) ||
    metrics.sampleSize < 0
  ) {
    throw new Error(
      "sampleSize는 0 이상의 정수여야 합니다.",
    );
  }

  if (metrics.profitFactor < 0) {
    throw new Error(
      "profitFactor는 0 이상이어야 합니다.",
    );
  }

  if (
    metrics.maxDrawdown < 0 ||
    metrics.maxDrawdown > 1
  ) {
    throw new Error(
      "maxDrawdown은 0부터 1 사이여야 합니다.",
    );
  }

  if (
    metrics.stopQualityScore < -1 ||
    metrics.stopQualityScore > 1
  ) {
    throw new Error(
      "stopQualityScore는 -1부터 1 사이여야 합니다.",
    );
  }

  if (
    metrics.winRate !== undefined &&
    (
      !Number.isFinite(metrics.winRate) ||
      metrics.winRate < 0 ||
      metrics.winRate > 1
    )
  ) {
    throw new Error(
      "winRate는 0부터 1 사이여야 합니다.",
    );
  }
}

function calculateModelScore(
  metrics: ModelMetrics,
): number {
  /*
   * 각 지표를 0~1로 정규화한다.
   * 이 가중치는 초기 버전이며 검증 결과에 따라 변경한다.
   */
  const returnScore = clamp(
    (metrics.averageReturn + 0.02) / 0.12,
  );

  const profitFactorScore = clamp(
    (metrics.profitFactor - 1) / 1,
  );

  const drawdownScore = clamp(
    1 - metrics.maxDrawdown / 0.2,
  );

  const stopScore = clamp(
    (metrics.stopQualityScore + 1) / 2,
  );

  const winRateScore = clamp(
    metrics.winRate ?? 0.5,
  );

  return (
    returnScore * 0.3 +
    profitFactorScore * 0.25 +
    drawdownScore * 0.25 +
    stopScore * 0.15 +
    winRateScore * 0.05
  );
}

export async function registerCandidateModel(
  input: RegisterModelInput,
) {
  if (!input.modelName.trim()) {
    throw new Error("모델 이름이 없습니다.");
  }

  if (!input.modelVersion.trim()) {
    throw new Error("모델 버전이 없습니다.");
  }

  validateMetrics(input.metrics);

  const supabase = createSupabaseServerClient();

  const { data, error } = await supabase
    .from("ai_model_versions")
    .insert({
      model_name: input.modelName.trim(),
      model_version: input.modelVersion.trim(),
      purpose: input.purpose,
      status: "CANDIDATE",
      training_trade_count:
        input.trainingTradeCount,
      metrics: input.metrics,
      artifact_uri:
        input.artifactUri?.trim() || null,
      description:
        input.description?.trim() || null,
    })
    .select(`
      id,
      model_name,
      model_version,
      purpose,
      status,
      training_trade_count,
      metrics,
      created_at
    `)
    .single();

  if (error || !data) {
    throw new Error(
      `후보 모델 등록 실패: ${
        error?.message ?? "결과가 없습니다."
      }`,
    );
  }

  return data;
}

export async function evaluateCandidateModel(
  modelId: string,
) {
  const supabase = createSupabaseServerClient();

  const { data: candidateData, error: candidateError } =
    await supabase
      .from("ai_model_versions")
      .select(`
        id,
        model_name,
        model_version,
        purpose,
        status,
        training_trade_count,
        metrics
      `)
      .eq("id", modelId)
      .single();

  if (candidateError || !candidateData) {
    throw new Error(
      `후보 모델 조회 실패: ${
        candidateError?.message ??
        "모델이 없습니다."
      }`,
    );
  }

  const candidate =
    candidateData as ModelRecord;

  if (candidate.status !== "CANDIDATE") {
    throw new Error(
      "CANDIDATE 상태의 모델만 평가할 수 있습니다.",
    );
  }

  validateMetrics(candidate.metrics);

  const { data: incumbentData, error: incumbentError } =
    await supabase
      .from("ai_model_versions")
      .select(`
        id,
        model_name,
        model_version,
        purpose,
        status,
        training_trade_count,
        metrics
      `)
      .eq("purpose", candidate.purpose)
      .eq("status", "APPROVED")
      .maybeSingle();

  if (incumbentError) {
    throw new Error(
      `기존 승인 모델 조회 실패: ${incumbentError.message}`,
    );
  }

  const incumbent =
    (incumbentData as ModelRecord | null) ??
    null;

  if (incumbent) {
    validateMetrics(incumbent.metrics);
  }

  const candidateScore =
    calculateModelScore(candidate.metrics);

  const incumbentScore = incumbent
    ? calculateModelScore(
        incumbent.metrics,
      )
    : null;

  const failureReasons: string[] = [];

  if (
    candidate.metrics.sampleSize <
    RULES.minimumSampleSize
  ) {
    failureReasons.push(
      `검증 표본이 ${RULES.minimumSampleSize}건 미만입니다.`,
    );
  }

  if (
    candidate.metrics.profitFactor <
    RULES.minimumProfitFactor
  ) {
    failureReasons.push(
      `Profit Factor가 ${RULES.minimumProfitFactor} 미만입니다.`,
    );
  }

  if (
    candidate.metrics.maxDrawdown >
    RULES.maximumDrawdown
  ) {
    failureReasons.push(
      `최대 낙폭이 ${
        RULES.maximumDrawdown * 100
      }%를 초과합니다.`,
    );
  }

  if (
    candidate.metrics.averageReturn <=
    RULES.minimumAverageReturn
  ) {
    failureReasons.push(
      "평균 거래 수익률이 0 이하입니다.",
    );
  }

  if (
    candidate.metrics.stopQualityScore <
    RULES.minimumStopQualityScore
  ) {
    failureReasons.push(
      "손절 품질 점수가 최소 기준보다 낮습니다.",
    );
  }

  const absoluteRulesPassed =
    failureReasons.length === 0;

  let comparisonRulesPassed = true;

  if (
    incumbent &&
    incumbentScore !== null
  ) {
    if (
      candidateScore <
      incumbentScore +
        RULES.minimumScoreImprovement
    ) {
      comparisonRulesPassed = false;

      failureReasons.push(
        "후보 모델 점수가 기존 모델보다 충분히 개선되지 않았습니다.",
      );
    }

    const maximumAllowedDrawdown =
      incumbent.metrics.maxDrawdown *
      (
        1 +
        RULES.maximumDrawdownIncreaseRate
      );

    if (
      candidate.metrics.maxDrawdown >
      maximumAllowedDrawdown
    ) {
      comparisonRulesPassed = false;

      failureReasons.push(
        "후보 모델의 최대 낙폭이 기존 모델보다 지나치게 높습니다.",
      );
    }
  }

  const passed =
    absoluteRulesPassed &&
    comparisonRulesPassed;

  const {
    data: validationData,
    error: validationError,
  } = await supabase
    .from("ai_model_validation_runs")
    .insert({
      candidate_model_id: candidate.id,
      incumbent_model_id:
        incumbent?.id ?? null,
      validation_rule_version:
        VALIDATION_RULE_VERSION,
      passed,
      candidate_score: candidateScore,
      incumbent_score: incumbentScore,
      absolute_rules_passed:
        absoluteRulesPassed,
      comparison_rules_passed:
        comparisonRulesPassed,
      rules: RULES,
      metrics_snapshot: {
        candidate: candidate.metrics,
        incumbent:
          incumbent?.metrics ?? null,
      },
      failure_reasons: failureReasons,
    })
    .select("id")
    .single();

  if (
    validationError ||
    !validationData
  ) {
    throw new Error(
      `모델 검증 결과 저장 실패: ${
        validationError?.message ??
        "결과가 없습니다."
      }`,
    );
  }

  if (!passed) {
    const { error: rejectError } =
      await supabase
        .from("ai_model_versions")
        .update({
          status: "REJECTED",
          evaluated_at:
            new Date().toISOString(),
          rejected_at:
            new Date().toISOString(),
        })
        .eq("id", candidate.id);

    if (rejectError) {
      throw new Error(
        `모델 거절 상태 저장 실패: ${rejectError.message}`,
      );
    }

    return {
      passed: false,
      promoted: false,
      candidateScore,
      incumbentScore,
      validationRunId:
        validationData.id,
      failureReasons,
    };
  }

  const {
    data: promotionData,
    error: promotionError,
  } = await supabase.rpc(
    "promote_ai_model",
    {
      p_model_id: candidate.id,
      p_validation_run_id:
        validationData.id,
    },
  );

  if (promotionError) {
    throw new Error(
      `모델 승인 실패: ${promotionError.message}`,
    );
  }

  return {
    passed: true,
    promoted: true,
    candidateScore,
    incumbentScore,
    validationRunId:
      validationData.id,
    failureReasons: [],
    model: promotionData,
  };
}