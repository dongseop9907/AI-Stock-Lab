import { NextResponse } from "next/server";

import { refreshModelMetrics } from "@/lib/models/refresh-model-metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RefreshMetricsRequest {
  modelId?: unknown;
}

export async function POST(
  request: Request,
) {
  try {
    const body =
      (await request
        .json()
        .catch(() => ({}))) as RefreshMetricsRequest;

    const modelId =
      body.modelId === undefined ||
      body.modelId === null ||
      String(body.modelId).trim() === ""
        ? undefined
        : String(body.modelId).trim();

    const models =
      await refreshModelMetrics(modelId);

    return NextResponse.json({
      ok: true,
      count: models.length,
      models,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "모델 지표 갱신 중 오류가 발생했습니다.",
      },
      {
        status: 500,
      },
    );
  }
}