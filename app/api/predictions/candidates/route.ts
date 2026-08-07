import { NextResponse } from "next/server";

import { getLatestPredictionCandidates } from "@/lib/trading/get-latest-prediction-candidates";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

export async function GET(
  request: Request,
) {
  try {
    const url =
      new URL(request.url);

    const maximumAgeMinutes =
      Number(
        url.searchParams.get(
          "maximumAgeMinutes",
        ) ??
          1440,
      );

    const limit =
      Number(
        url.searchParams.get(
          "limit",
        ) ??
          20,
      );

    const result =
      await getLatestPredictionCandidates({
        maximumAgeMinutes,
        limit,
      });

    return NextResponse.json({
      ok: true,
      result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,

        message:
          error instanceof Error
            ? error.message
            : "AI 상승 후보 조회 중 오류가 발생했습니다.",
      },
      {
        status: 500,
      },
    );
  }
}