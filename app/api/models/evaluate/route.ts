import { NextResponse } from "next/server";

import { evaluateCandidateModel } from "@/lib/models/model-governance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface EvaluateRequest {
  modelId?: unknown;
}

export async function POST(
  request: Request,
) {
  try {
    const body =
      (await request.json()) as EvaluateRequest;

    const modelId = String(
      body.modelId ?? "",
    );

    if (!modelId) {
      return NextResponse.json(
        {
          ok: false,
          message: "modelId가 없습니다.",
        },
        {
          status: 400,
        },
      );
    }

    const result =
      await evaluateCandidateModel(modelId);

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "모델 평가 중 오류가 발생했습니다.",
      },
      {
        status: 500,
      },
    );
  }
}