import { NextResponse } from "next/server";

import { captureShadowSignals } from "@/lib/trading/capture-shadow-signals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CaptureRequest {
  lookbackHours?: unknown;
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
        )) as CaptureRequest;

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
              "그림자 신호 등록 권한이 없습니다.",
          },
          {
            status: 401,
          },
        );
      }
    }

    const result =
      await captureShadowSignals({
        lookbackHours:
          Number(
            body.lookbackHours ??
              48,
          ),

        limit:
          Number(
            body.limit ??
              500,
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
            : "그림자 신호 등록 중 오류가 발생했습니다.",
      },
      {
        status: 500,
      },
    );
  }
}