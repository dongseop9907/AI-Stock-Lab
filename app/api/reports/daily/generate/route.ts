import { NextResponse } from "next/server";

import { generateDailyPerformanceReport } from "@/lib/trading/generate-daily-performance-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface DailyReportRequest {
  reportDate?: unknown;
  accountName?: unknown;
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
        )) as DailyReportRequest;

    if (
      process.env.NODE_ENV ===
      "production"
    ) {
      const expectedSecret =
        process.env
          .TRADING_AUTOMATION_SECRET;

      const providedSecret =
        request.headers.get(
          "x-automation-secret",
        ) ??
        String(
          body.secret ?? "",
        );

      if (
        !expectedSecret ||
        providedSecret !==
          expectedSecret
      ) {
        return NextResponse.json(
          {
            ok: false,
            message:
              "일일 보고서 생성 권한이 없습니다.",
          },
          {
            status: 401,
          },
        );
      }
    }

    const reportDate =
      typeof body.reportDate ===
      "string"
        ? body.reportDate
        : undefined;

    const accountName =
      typeof body.accountName ===
      "string"
        ? body.accountName
        : undefined;

    const result =
      await generateDailyPerformanceReport({
        reportDate,
        accountName,
      });

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
            : "일일 성과 보고서 생성 중 오류가 발생했습니다.",
      },
      {
        status: 500,
      },
    );
  }
}