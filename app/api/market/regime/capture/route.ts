import { NextResponse } from "next/server";

import {
  captureCurrentMarketRegimeShadow,
} from "@/lib/trading/capture-market-regime-shadow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result =
      await captureCurrentMarketRegimeShadow();

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
            : "시장 Regime SHADOW 저장 중 오류가 발생했습니다.",
      },
      {
        status: 500,
      },
    );
  }
}