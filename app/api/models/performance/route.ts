import { NextResponse } from "next/server";

import { getModelPerformance } from "@/lib/models/get-model-performance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const models =
      await getModelPerformance();

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
            : "모델 성과 조회 중 오류가 발생했습니다.",
      },
      {
        status: 500,
      },
    );
  }
}