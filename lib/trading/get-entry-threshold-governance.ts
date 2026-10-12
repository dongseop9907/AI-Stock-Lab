import { createSupabaseServerClient } from "@/lib/supabase";

export type ThresholdRecommendationStatus =
  | "INSUFFICIENT_DATA"
  | "NO_CHANGE"
  | "RECOMMENDED"
  | "APPROVED"
  | "REJECTED"
  | "APPLIED";

interface SettingRecord {
  active_threshold:
    | number
    | string;

  previous_threshold:
    | number
    | string
    | null;

  applied_recommendation_id:
    | string
    | null;

  updated_by: string;
  updated_at: string;
}

interface RecommendationRecord {
  id: string;
  model_id: string | null;

  analyzed_from:
    | string
    | null;

  analyzed_to:
    | string
    | null;

  current_threshold:
    | number
    | string;

  raw_best_threshold:
    | number
    | string
    | null;

  recommended_threshold:
    | number
    | string
    | null;

  sample_count:
    | number
    | string;

  positive_count:
    | number
    | string;

  negative_count:
    | number
    | string;

  current_objective_score:
    | number
    | string
    | null;

  recommended_objective_score:
    | number
    | string
    | null;

  objective_improvement:
    | number
    | string
    | null;

  status:
    ThresholdRecommendationStatus;

  approved_at:
    | string
    | null;

  approved_by:
    | string
    | null;

  applied_at:
    | string
    | null;

  created_at: string;
  updated_at: string;
}

export interface EntryThresholdRecommendation {
  id: string;
  modelId: string | null;

  analyzedFrom: string | null;
  analyzedTo: string | null;

  currentThreshold: number;
  rawBestThreshold: number | null;
  recommendedThreshold: number | null;

  sampleCount: number;
  positiveCount: number;
  negativeCount: number;

  currentObjectiveScore:
    | number
    | null;

  recommendedObjectiveScore:
    | number
    | null;

  objectiveImprovement:
    | number
    | null;

  status:
    ThresholdRecommendationStatus;

  approvedAt: string | null;
  approvedBy: string | null;
  appliedAt: string | null;

  createdAt: string;
  updatedAt: string;
}

export interface EntryThresholdGovernance {
  setting: {
    activeThreshold: number;
    previousThreshold: number | null;

    appliedRecommendationId:
      | string
      | null;

    updatedBy: string;
    updatedAt: string;
  };

  latestRecommendation:
    | EntryThresholdRecommendation
    | null;

  recommendations:
    EntryThresholdRecommendation[];
}

function toNumber(
  value: unknown,
): number {
  const parsed =
    Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : 0;
}

function toNullableNumber(
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

function mapRecommendation(
  record: RecommendationRecord,
): EntryThresholdRecommendation {
  return {
    id:
      record.id,

    modelId:
      record.model_id,

    analyzedFrom:
      record.analyzed_from,

    analyzedTo:
      record.analyzed_to,

    currentThreshold:
      toNumber(
        record.current_threshold,
      ),

    rawBestThreshold:
      toNullableNumber(
        record.raw_best_threshold,
      ),

    recommendedThreshold:
      toNullableNumber(
        record.recommended_threshold,
      ),

    sampleCount:
      toNumber(
        record.sample_count,
      ),

    positiveCount:
      toNumber(
        record.positive_count,
      ),

    negativeCount:
      toNumber(
        record.negative_count,
      ),

    currentObjectiveScore:
      toNullableNumber(
        record.current_objective_score,
      ),

    recommendedObjectiveScore:
      toNullableNumber(
        record.recommended_objective_score,
      ),

    objectiveImprovement:
      toNullableNumber(
        record.objective_improvement,
      ),

    status:
      record.status,

    approvedAt:
      record.approved_at,

    approvedBy:
      record.approved_by,

    appliedAt:
      record.applied_at,

    createdAt:
      record.created_at,

    updatedAt:
      record.updated_at,
  };
}

export async function getEntryThresholdGovernance(): Promise<EntryThresholdGovernance> {
  const supabase =
    createSupabaseServerClient();

  const [
    settingResult,
    recommendationResult,
  ] =
    await Promise.all([
      supabase
        .from(
          "entry_signal_settings",
        )
        .select(`
          active_threshold,
          previous_threshold,
          applied_recommendation_id,
          updated_by,
          updated_at
        `)
        .eq(
          "setting_key",
          "global",
        )
        .maybeSingle(),

      supabase
        .from(
          "entry_threshold_recommendations",
        )
        .select(`
          id,
          model_id,
          analyzed_from,
          analyzed_to,
          current_threshold,
          raw_best_threshold,
          recommended_threshold,
          sample_count,
          positive_count,
          negative_count,
          current_objective_score,
          recommended_objective_score,
          objective_improvement,
          status,
          approved_at,
          approved_by,
          applied_at,
          created_at,
          updated_at
        `)
        .order(
          "created_at",
          {
            ascending: false,
          },
        )
        .limit(20),
    ]);

  if (
    settingResult.error
  ) {
    throw new Error(
      `기준점수 설정 조회 실패: ${settingResult.error.message}`,
    );
  }

  if (
    recommendationResult.error
  ) {
    throw new Error(
      `기준점수 추천 조회 실패: ${recommendationResult.error.message}`,
    );
  }

  const setting =
    settingResult.data as
      | SettingRecord
      | null;

  const recommendations =
    (
      (
        recommendationResult.data ??
        []
      ) as RecommendationRecord[]
    ).map(
      mapRecommendation,
    );

  return {
    setting: {
      activeThreshold:
        setting
          ? toNumber(
              setting.active_threshold,
            )
          : 0.62,

      previousThreshold:
        setting
          ? toNullableNumber(
              setting.previous_threshold,
            )
          : null,

      appliedRecommendationId:
        setting
          ?.applied_recommendation_id ??
        null,

      updatedBy:
        setting?.updated_by ??
        "SYSTEM",

      updatedAt:
        setting?.updated_at ??
        new Date(0).toISOString(),
    },

    latestRecommendation:
      recommendations[0] ??
      null,

    recommendations,
  };
}