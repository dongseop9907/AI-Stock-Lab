import { NextResponse } from "next/server";

import { evaluateShadowSignals } from "@/lib/trading/evaluate-shadow-signals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface EvaluateRequest {
  limit?: unknown;
  secret?: unknown;
}

export async function POST(
  request: Request,
) {
  try {
    const body =
      (await request
        .json()
        .catch(
          () => ({}),
        )) as EvaluateRequest;

    if (
      process.env.NODE_ENV ===
      "production"
    ) {
      const expectedSecret =
        process.env
          .TRADING_AUTOMATION_SECRET
          ?.trim();

      const providedSecret =
        request.headers
          .get(
            "x-automation-secret",
          )
          ?.trim() ??
        String(
          body.secret ?? "",
        ).trim();

      if (
        !expectedSecret ||
        providedSecret !==
          expectedSecret
      ) {
        return NextResponse.json(
          {
            ok: false,
            message:
              "그림자 신호 평가 권한이 없습니다.",
          },
          {
            status: 401,
          },
        );
      }
    }

    const result =
      await evaluateShadowSignals({
        limit:
          Number(
            body.limit ??
              300,
          ),
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
            : "그림자 신호 평가 중 오류가 발생했습니다.",
      },
      {
        status: 500,
      },
    );
  }
}