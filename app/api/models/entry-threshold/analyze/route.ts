import { NextResponse } from "next/server";

import { analyzeEntryThreshold } from "@/lib/trading/analyze-entry-threshold";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AnalyzeRequest {
  modelId?: unknown;
  currentThreshold?: unknown;
  lookbackDays?: unknown;
  minimumSamples?: unknown;
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
        )) as AnalyzeRequest;

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
      process.env.NODE_ENV ===
        "production" &&
      (
        !expectedSecret ||
        providedSecret !==
          expectedSecret
      )
    ) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "진입 기준 분석 권한이 없습니다.",
        },
        {
          status: 401,
        },
      );
    }

    const result =
      await analyzeEntryThreshold({
        modelId:
          typeof body.modelId ===
            "string"
            ? body.modelId
            : null,

        currentThreshold:
          Number(
            body.currentThreshold ??
              0.62,
          ),

        lookbackDays:
          Number(
            body.lookbackDays ??
              90,
          ),

        minimumSamples:
          Number(
            body.minimumSamples ??
              30,
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
            : "진입 기준 분석 중 오류가 발생했습니다.",
      },
      {
        status: 500,
      },
    );
  }
}