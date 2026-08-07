import {
  NextResponse,
} from "next/server";

import {
  captureMarketRegimeShadowComparisonV73,
} from "@/lib/market/capture-market-regime-shadow-comparison-v7-3";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

export async function POST() {
  try {
    const result =
      await captureMarketRegimeShadowComparisonV73();

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
            : "Market Regime v7.3 shadow capture failed.",
      },
      {
        status: 500,
      },
    );
  }
}