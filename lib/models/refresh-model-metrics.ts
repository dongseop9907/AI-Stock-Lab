import { createSupabaseServerClient } from "@/lib/supabase";

interface RefreshMetricsRecord {
  refreshed_model_id: string;
  refreshed_model_name: string;
  refreshed_model_version: string;
  refreshed_sample_size: number | string;
  refreshed_metrics: Record<string, unknown>;
  refreshed_at: string;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export async function refreshModelMetrics(
  modelId?: string,
) {
  if (
    modelId !== undefined &&
    !isUuid(modelId)
  ) {
    throw new Error("INVALID_MODEL_ID");
  }

  const supabase =
    createSupabaseServerClient();

  const { data, error } =
    await supabase.rpc(
      "refresh_ai_model_metrics",
      {
        p_model_id: modelId ?? null,
      },
    );

  if (error) {
    throw new Error(
      `모델 자동 지표 갱신 실패: ${error.message}`,
    );
  }

  return (
    (data ?? []) as RefreshMetricsRecord[]
  ).map((row) => ({
    modelId: row.refreshed_model_id,
    modelName:
      row.refreshed_model_name,
    modelVersion:
      row.refreshed_model_version,
    sampleSize:
      Number(row.refreshed_sample_size),
    metrics:
      row.refreshed_metrics ?? {},
    refreshedAt:
      row.refreshed_at,
  }));
}