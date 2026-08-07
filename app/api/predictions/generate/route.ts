import { NextResponse } from "next/server";

import { generateStockPredictions } from "@/lib/trading/generate-stock-predictions";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

interface GenerateRequest {
  disclosureLookbackDays?: unknown;
  candidateThreshold?: unknown;
  secret?: unknown;
}

function isLocalRequest(
  request: Request,
): boolean {
  try {
    const hostname =
      new URL(
        request.url,
      ).hostname.toLowerCase();

    return (
      hostname ===
        "localhost" ||
      hostname ===
        "127.0.0.1" ||
      hostname ===
        "::1"
    );
  } catch {
    return false;
  }
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
        )) as GenerateRequest;

    const expectedSecret =
      process.env
        .TRADING_AUTOMATION_SECRET
        ?.trim() ?? "";

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
      process.env.NODE_ENV ===
        "production" &&
      !isLocalRequest(request) &&
      (
        !expectedSecret ||
        expectedSecret !==
          providedSecret
      )
    ) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "AI 예측 생성 권한이 없습니다.",
        },
        {
          status: 401,
        },
      );
    }

    const result =
      await generateStockPredictions({
        disclosureLookbackDays:
          Number(
            body.disclosureLookbackDays ??
              14,
          ),

        candidateThreshold:
          Number(
            body.candidateThreshold ??
              0.62,
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
            : "AI 예측 생성 중 오류가 발생했습니다.",
      },
      {
        status: 500,
      },
    );
  }
}