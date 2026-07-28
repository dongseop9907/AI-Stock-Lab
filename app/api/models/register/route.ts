import { NextResponse } from "next/server";

import {
  registerCandidateModel,
  type ModelPurpose,
} from "@/lib/models/model-governance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RegisterRequest {
  modelName?: unknown;
  modelVersion?: unknown;
  purpose?: unknown;
  trainingTradeCount?: unknown;
  metrics?: unknown;
  artifactUri?: unknown;
  description?: unknown;
}

export async function POST(
  request: Request,
) {
  try {
    const body =
      (await request.json()) as RegisterRequest;

    const result =
      await registerCandidateModel({
        modelName: String(
          body.modelName ?? "",
        ),
        modelVersion: String(
          body.modelVersion ?? "",
        ),
        purpose: String(
          body.purpose ?? "",
        ) as ModelPurpose,
        trainingTradeCount: Number(
          body.trainingTradeCount,
        ),
        metrics: body.metrics as {
          sampleSize: number;
          averageReturn: number;
          profitFactor: number;
          maxDrawdown: number;
          stopQualityScore: number;
          winRate?: number;
        },
        artifactUri:
          body.artifactUri === undefined
            ? undefined
            : String(body.artifactUri),
        description:
          body.description === undefined
            ? undefined
            : String(body.description),
      });

    return NextResponse.json({
      ok: true,
      model: result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "후보 모델 등록 중 오류가 발생했습니다.",
      },
      {
        status: 500,
      },
    );
  }
}