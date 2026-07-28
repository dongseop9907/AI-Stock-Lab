import { NextResponse } from "next/server";

import { evaluatePaperTrades } from "@/lib/trading/evaluate-paper-trades";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result =
      await evaluatePaperTrades();

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
            : "매도 후 거래 평가 중 오류가 발생했습니다.",
      },
      {
        status: 500,
      },
    );
  }
}