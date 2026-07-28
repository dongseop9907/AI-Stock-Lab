import { NextResponse } from "next/server";

import { checkAndExecuteStopLosses } from "@/lib/trading/check-stop-losses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result =
      await checkAndExecuteStopLosses();

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
            : "손절가 검사 중 오류가 발생했습니다.",
      },
      {
        status: 500,
      },
    );
  }
}